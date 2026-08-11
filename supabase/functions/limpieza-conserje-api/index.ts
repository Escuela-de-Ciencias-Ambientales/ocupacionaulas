import 'jsr:@supabase/functions-js/edge-runtime.d.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const allowedOrigins = new Set([
  'https://escuela-de-ciencias-ambientales.github.io',
  'http://127.0.0.1:8781',
  'http://localhost:8781'
]);
const maxBodyBytes = 1_500_000;
const maxPhotoBytes = 1_048_576;

function corsHeaders(origin: string | null) {
  const allowed = origin && allowedOrigins.has(origin)
    ? origin
    : 'https://escuela-de-ciencias-ambientales.github.io';
  return {
    'Access-Control-Allow-Origin': allowed,
    'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Vary': 'Origin'
  };
}

function response(origin: string | null, body: Record<string, unknown>, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders(origin), 'Content-Type': 'application/json', 'Cache-Control': 'no-store' }
  });
}

function validPassword(value: unknown) {
  return typeof value === 'string' && value.length >= 4 && value.length <= 128;
}

function validSlug(value: unknown) {
  return typeof value === 'string' && /^[a-z0-9-]{2,80}$/.test(value);
}

function decodePhoto(base64: unknown) {
  if (typeof base64 !== 'string' || !base64 || base64.length > 1_400_000) return null;
  if (!/^[A-Za-z0-9+/]+={0,2}$/.test(base64)) return null;
  try {
    const binary = atob(base64);
    const bytes = Uint8Array.from(binary, (char) => char.charCodeAt(0));
    return bytes.length > 0 && bytes.length <= maxPhotoBytes ? bytes : null;
  } catch {
    return null;
  }
}

Deno.serve(async (request) => {
  const origin = request.headers.get('Origin');
  if (request.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders(origin) });
  if (request.method !== 'POST') return response(origin, { ok: false, error: 'Método no permitido.' }, 405);
  if (origin && !allowedOrigins.has(origin)) return response(origin, { ok: false, error: 'Origen no permitido.' }, 403);

  const contentLength = Number(request.headers.get('content-length') || 0);
  if (contentLength > maxBodyBytes) return response(origin, { ok: false, error: 'La fotografía es demasiado grande.' }, 413);

  const supabaseUrl = Deno.env.get('SUPABASE_URL');
  const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  const anonKey = Deno.env.get('SUPABASE_ANON_KEY');
  if (!supabaseUrl || !serviceRoleKey || !anonKey || request.headers.get('apikey') !== anonKey) {
    return response(origin, { ok: false, error: 'Solicitud no autorizada.' }, 401);
  }

  try {
    const payload = await request.json();
    const action = String(payload.action || '');
    const password = payload.password;
    if (!validPassword(password)) return response(origin, { ok: false, error: 'Credenciales inválidas.' }, 401);

    const admin = createClient(supabaseUrl, serviceRoleKey, {
      auth: { persistSession: false, autoRefreshToken: false }
    });

    if (action === 'login') {
      const { data, error } = await admin.rpc('limpieza_api_login', { p_password: password });
      if (error || !data?.length) return response(origin, { ok: false, error: 'Contraseña incorrecta.' }, 401);
      return response(origin, { ok: true, conserje: data[0] });
    }

    if (action === 'summary') {
      const date = String(payload.date || '');
      if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return response(origin, { ok: false, error: 'Fecha inválida.' }, 400);
      const { data, error } = await admin.rpc('limpieza_api_resumen', { p_password: password, p_fecha: date });
      if (error) return response(origin, { ok: false, error: 'No fue posible cargar el resumen.' }, 400);
      return response(origin, { ok: true, items: data || [] });
    }

    const slug = payload.slug;
    if (!validSlug(slug)) return response(origin, { ok: false, error: 'Código QR no reconocido.' }, 400);
    const { data: contextData, error: contextError } = await admin.rpc('limpieza_api_contexto', {
      p_password: password,
      p_slug: slug
    });
    if (contextError || !contextData?.length) {
      const message = contextError?.message?.includes('asignado a otro')
        ? 'Este aposento está asignado a otro conserje para hoy.'
        : 'No fue posible abrir el formulario de este aposento.';
      return response(origin, { ok: false, error: message }, 400);
    }
    const context = contextData[0];

    if (action === 'context') return response(origin, { ok: true, context });
    if (action !== 'report') return response(origin, { ok: false, error: 'Acción no válida.' }, 400);

    const checklist = Array.isArray(payload.checklist) ? payload.checklist : null;
    if (!checklist || checklist.length > 100) return response(origin, { ok: false, error: 'Checklist inválido.' }, 400);
    const observations = typeof payload.observations === 'string' ? payload.observations.trim() : '';
    if (observations.length > 2000) return response(origin, { ok: false, error: 'Las observaciones son demasiado extensas.' }, 400);

    let photoBytes: Uint8Array | null = null;
    if (payload.photoBase64 != null) {
      photoBytes = decodePhoto(payload.photoBase64);
      if (!photoBytes) return response(origin, { ok: false, error: 'La fotografía no es válida o supera 1 MB.' }, 400);
    }
    if (context.foto_requerida && !photoBytes) {
      return response(origin, { ok: false, error: 'Este turno requiere al menos una fotografía.' }, 400);
    }

    const reportId = crypto.randomUUID();
    const dateCr = new Intl.DateTimeFormat('en-CA', {
      timeZone: 'America/Costa_Rica', year: 'numeric', month: '2-digit', day: '2-digit'
    }).format(new Date());
    const photoPath = photoBytes ? `${context.conserje_id}/${dateCr}/${reportId}.jpg` : null;

    if (photoBytes && photoPath) {
      const { error: uploadError } = await admin.storage.from('limpieza-reportes').upload(photoPath, photoBytes, {
        contentType: 'image/jpeg', cacheControl: '3600', upsert: false
      });
      if (uploadError) return response(origin, { ok: false, error: 'No fue posible guardar la fotografía.' }, 500);
    }

    const { data, error } = await admin.rpc('limpieza_api_crear_reporte', {
      p_report_id: reportId,
      p_aposento_slug: slug,
      p_conserje_password: password,
      p_checklist: checklist,
      p_observaciones: observations || null,
      p_foto_path: photoPath,
      p_foto_mime: photoPath ? 'image/jpeg' : null,
      p_foto_bytes: photoBytes?.length || null
    });
    if (error || !data?.[0]?.ok) {
      if (photoPath) await admin.storage.from('limpieza-reportes').remove([photoPath]);
      return response(origin, { ok: false, error: error?.message || 'No fue posible enviar el reporte.' }, 400);
    }

    return response(origin, { ok: true, result: data[0] });
  } catch (error) {
    console.error('limpieza-conserje-api:', error instanceof Error ? error.message : 'error inesperado');
    return response(origin, { ok: false, error: 'Ocurrió un error inesperado. Intenta nuevamente.' }, 500);
  }
});
