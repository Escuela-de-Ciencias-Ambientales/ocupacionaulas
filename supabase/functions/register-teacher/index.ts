import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS'
};
const emailPattern = /^[a-z0-9-]+\.[a-z0-9-]+\.[a-z0-9-]+@una\.cr$/;
const passwordPattern = /^(?=.*[A-Z])(?=.*\d).{8,}$/;

function response(body: Record<string, unknown>, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' }
  });
}

Deno.serve(async (request) => {
  if (request.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  if (request.method !== 'POST') return response({ ok: false, error: 'Método no permitido.' }, 405);

  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL');
    const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
    if (!supabaseUrl || !serviceRoleKey) return response({ ok: false, error: 'Servicio no configurado.' }, 500);

    const payload = await request.json();
    const fullName = String(payload.fullName || '').trim();
    const email = String(payload.email || '').trim().toLowerCase();
    const password = String(payload.password || '');
    if (fullName.length < 3 || fullName.length > 100) return response({ ok: false, error: 'Ingresa tu nombre completo.' }, 400);
    if (!emailPattern.test(email)) return response({ ok: false, error: 'Usa tu correo institucional nombre.apellido.apellido@una.cr.' }, 400);
    if (!passwordPattern.test(password)) return response({ ok: false, error: 'La contraseña debe tener al menos 8 caracteres, una mayúscula y un número.' }, 400);

    const adminClient = createClient(supabaseUrl, serviceRoleKey, { auth: { persistSession: false } });
    const { data: authorized, error: lookupError } = await adminClient
      .from('teacher_registry').select('id,full_name,active,claimed_at').eq('email', email).maybeSingle();
    if (lookupError) return response({ ok: false, error: lookupError.message }, 400);
    if (!authorized?.active) return response({ ok: false, error: 'Este correo no está autorizado. Solicita acceso a la administración.' }, 403);
    if (authorized.claimed_at) return response({ ok: false, error: 'Este correo ya tiene una cuenta. Utiliza la opción Ingresar.' }, 409);
    if (authorized.full_name.localeCompare(fullName, 'es', { sensitivity: 'base' }) !== 0) {
      return response({ ok: false, error: 'El nombre no coincide con el registro administrativo. Verifica los datos o contacta a la administración.' }, 403);
    }

    const { data: created, error: createError } = await adminClient.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
      user_metadata: { full_name: authorized.full_name, role: 'teacher' }
    });
    if (createError) return response({ ok: false, error: createError.message }, 400);
    await adminClient.from('teacher_registry').update({ claimed_at: new Date().toISOString() }).eq('id', authorized.id);
    return response({ ok: true, userId: created.user?.id });
  } catch (error) {
    return response({ ok: false, error: error instanceof Error ? error.message : 'Error inesperado.' }, 500);
  }
});
