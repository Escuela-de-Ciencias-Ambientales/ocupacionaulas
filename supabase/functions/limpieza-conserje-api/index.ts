import 'jsr:@supabase/functions-js/edge-runtime.d.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.112.3';

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

function validSessionToken(value: unknown): value is string {
  return typeof value === 'string' && /^[A-Za-z0-9_-]{43,128}$/.test(value);
}

function validSlug(value: unknown) {
  return typeof value === 'string' && /^[a-z0-9-]{2,80}$/.test(value);
}

function validUuid(value: unknown): value is string {
  return typeof value === 'string'
    && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}

function newSessionToken() {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  return btoa(String.fromCharCode(...bytes))
    .replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/, '');
}

async function sha256(value: string) {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value));
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('');
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
    const admin = createClient(supabaseUrl, serviceRoleKey, {
      auth: { persistSession: false, autoRefreshToken: false }
    });

    if (action === 'login') {
      if (!validPassword(payload.password)) return response(origin, { ok: false, error: 'Credenciales inválidas.' }, 401);
      const sessionToken = newSessionToken();
      const tokenHash = await sha256(sessionToken);
      const { data, error } = await admin.rpc('limpieza_api_crear_sesion', {
        p_password: payload.password,
        p_token_hash: tokenHash
      });
      if (error || !data?.length) return response(origin, { ok: false, error: 'Contraseña incorrecta.' }, 401);
      return response(origin, { ok: true, conserje: data[0], sessionToken });
    }

    const hasSession = validSessionToken(payload.sessionToken);
    if (!hasSession) {
      return response(origin, { ok: false, error: 'La sesión no es válida.', sessionExpired: true }, 401);
    }
    const tokenHash = await sha256(payload.sessionToken);

    if (action === 'logout') {
      await admin.rpc('limpieza_api_cerrar_sesion', { p_token_hash: tokenHash });
      return response(origin, { ok: true });
    }

    if (action === 'summary' || action === 'reports') {
      const date = String(payload.date || '');
      if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return response(origin, { ok: false, error: 'Fecha inválida.' }, 400);
      const rpcName = action === 'reports' ? 'limpieza_api_reportes_v4' : 'limpieza_api_resumen_v4';
      const { data, error } = await admin.rpc(rpcName, { p_token_hash: tokenHash, p_fecha: date });
      if (error) {
        const sessionExpired = Boolean(tokenHash && error.message.includes('Sesion invalida'));
        return response(origin, {
          ok: false,
          error: sessionExpired ? 'La sesión venció. Ingresa nuevamente.' : 'No fue posible cargar la información.',
          sessionExpired
        }, sessionExpired ? 401 : 400);
      }
      return response(origin, { ok: true, [action === 'reports' ? 'reports' : 'items']: data || [] });
    }

    if (action === 'context') {
      const slug = payload.slug;
      if (!validSlug(slug)) return response(origin, { ok: false, error: 'Código QR no reconocido.' }, 400);
      const { data: contextData, error: contextError } = await admin.rpc('limpieza_api_contexto_v4', {
        p_token_hash: tokenHash,
        p_slug: slug
      });
      if (contextError || !contextData?.length) {
        const raw = contextError?.message || '';
        const sessionExpired = raw.includes('Sesion invalida');
        let message = 'No fue posible abrir el formulario de este recinto.';
        if (sessionExpired) message = 'La sesión venció. Ingresa nuevamente.';
        else if (raw.includes('asignado a otro')) message = 'Este recinto está asignado a otro conserje para hoy.';
        else if (raw.includes('no esta programado')) message = 'Este recinto no está programado para ti hoy.';
        else if (raw.includes('Ya completaste')) message = 'Ya completaste las tareas programadas para este recinto hoy.';
        else if (raw.includes('no tiene labores')) message = 'Este turno todavía no tiene labores configuradas.';
        return response(origin, { ok: false, error: message, sessionExpired }, sessionExpired ? 401 : 400);
      }
      return response(origin, { ok: true, context: contextData[0] });
    }
    if (action !== 'report') return response(origin, { ok: false, error: 'Acción no válida.' }, 400);

    const scanId = payload.scanId;
    if (!validUuid(scanId)) return response(origin, { ok: false, error: 'Escaneo inválido. Escanea nuevamente el código QR.' }, 400);

    const checklist = Array.isArray(payload.checklist) ? payload.checklist : null;
    if (!checklist || checklist.length > 100) return response(origin, { ok: false, error: 'Checklist inválido.' }, 400);
    const observations = typeof payload.observations === 'string' ? payload.observations.trim() : '';
    if (observations.length > 2000) return response(origin, { ok: false, error: 'Las observaciones son demasiado extensas.' }, 400);

    let photoBytes: Uint8Array | null = null;
    if (payload.photoBase64 != null) {
      photoBytes = decodePhoto(payload.photoBase64);
      if (!photoBytes) return response(origin, { ok: false, error: 'La fotografía no es válida o supera 1 MB.' }, 400);
    }
    const reportId = crypto.randomUUID();
    const photoPath = photoBytes ? `escaneos/${scanId}/${reportId}.jpg` : null;

    if (photoBytes && photoPath) {
      const { error: uploadError } = await admin.storage.from('limpieza-reportes').upload(photoPath, photoBytes, {
        contentType: 'image/jpeg', cacheControl: '3600', upsert: false
      });
      if (uploadError) return response(origin, { ok: false, error: 'No fue posible guardar la fotografía.' }, 500);
    }

    const reportParams = {
      p_report_id: reportId,
      p_escaneo_id: scanId,
      p_token_hash: tokenHash,
      p_checklist: checklist,
      p_observaciones: observations || null,
      p_foto_path: photoPath,
      p_foto_mime: photoPath ? 'image/jpeg' : null,
      p_foto_bytes: photoBytes?.length || null
    };
    const { data, error } = await admin.rpc('limpieza_api_crear_reporte_v4', reportParams);
    if (error || !data?.[0]?.ok) {
      if (photoPath) await admin.storage.from('limpieza-reportes').remove([photoPath]);
      const sessionExpired = Boolean(tokenHash && error?.message?.includes('Sesion invalida'));
      return response(origin, {
        ok: false,
        error: sessionExpired ? 'La sesión venció. Ingresa nuevamente.' : error?.message || 'No fue posible enviar el reporte.',
        sessionExpired
      }, sessionExpired ? 401 : 400);
    }

    return response(origin, { ok: true, result: data[0] });
  } catch (error) {
    console.error('limpieza-conserje-api:', error instanceof Error ? error.message : 'error inesperado');
    return response(origin, { ok: false, error: 'Ocurrió un error inesperado. Intenta nuevamente.' }, 500);
  }
});
