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

type RequestedUser = { fullName: string; email: string; password: string; role: 'teacher' | 'reservation_admin' | 'admin' };

function normalizeUser(source: Record<string, unknown>): RequestedUser {
  return {
    fullName: String(source.fullName || '').trim(),
    email: String(source.email || '').trim().toLowerCase(),
    password: String(source.password || ''),
    role: source.role === 'admin' ? 'admin' : source.role === 'reservation_admin' ? 'reservation_admin' : 'teacher'
  };
}

function validateUser(user: RequestedUser, allowEmptyPassword: boolean) {
  if (user.fullName.length < 3 || user.fullName.length > 100) return 'El nombre no es válido.';
  if (!emailPattern.test(user.email)) return 'El correo debe tener el formato nombre.apellido.apellido@una.cr.';
  if ((!allowEmptyPassword || user.password) && !passwordPattern.test(user.password)) {
    return 'La contraseña debe tener al menos 8 caracteres, una mayúscula y un número.';
  }
  return '';
}

Deno.serve(async (request) => {
  if (request.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  if (request.method !== 'POST') return response({ ok: false, error: 'Método no permitido.' }, 405);

  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL');
    const anonKey = Deno.env.get('SUPABASE_ANON_KEY');
    const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
    const authorization = request.headers.get('Authorization');
    if (!supabaseUrl || !anonKey || !serviceRoleKey || !authorization) {
      return response({ ok: false, error: 'Configuración o sesión incompleta.' }, 401);
    }

    const callerClient = createClient(supabaseUrl, anonKey, {
      global: { headers: { Authorization: authorization } },
      auth: { persistSession: false }
    });
    const { data: userData, error: userError } = await callerClient.auth.getUser();
    if (userError || !userData.user) return response({ ok: false, error: 'Sesión no válida.' }, 401);

    const adminClient = createClient(supabaseUrl, serviceRoleKey, { auth: { persistSession: false } });
    const { data: callerProfile, error: profileError } = await adminClient
      .from('profiles').select('role,admin_scope,active').eq('id', userData.user.id).single();
    if (profileError || callerProfile?.role !== 'admin' || !callerProfile.active) {
      return response({ ok: false, error: 'Se requiere acceso de administrador.' }, 403);
    }

    const payload = await request.json();
    const isBulk = Array.isArray(payload.users);
    const isSuperadmin = callerProfile.admin_scope === 'superadmin';
    if (isBulk && !isSuperadmin) {
      return response({ ok: false, error: 'La carga masiva requiere acceso de superadministrador.' }, 403);
    }
    const users = (isBulk ? payload.users : [payload]).map((item: Record<string, unknown>) => normalizeUser(item));
    if (!users.length) return response({ ok: false, error: 'No se recibieron docentes.' }, 400);
    if (users.length > 50) return response({ ok: false, error: 'El archivo no puede contener más de 50 docentes.' }, 400);
    if (!isSuperadmin && users.some((user) => user.role !== 'teacher')) {
      return response({ ok: false, error: 'El administrador de reservas solo puede crear cuentas docentes.' }, 403);
    }

    const emails = new Set<string>();
    for (const user of users) {
      const validation = validateUser(user, isBulk);
      if (validation) return response({ ok: false, error: `${user.email || 'Fila sin correo'}: ${validation}` }, 400);
      if (emails.has(user.email)) return response({ ok: false, error: `El correo ${user.email} está repetido.` }, 400);
      emails.add(user.email);
    }

    const { count, error: countError } = await adminClient
      .from('teacher_registry').select('id', { count: 'exact', head: true }).eq('active', true);
    if (countError) return response({ ok: false, error: countError.message }, 400);
    const teacherEmails = users.filter((user) => user.role === 'teacher').map((user) => user.email);
    const { data: existingRegistry, error: existingError } = teacherEmails.length
      ? await adminClient.from('teacher_registry').select('email').in('email', teacherEmails)
      : { data: [], error: null };
    if (existingError) return response({ ok: false, error: existingError.message }, 400);
    const existingEmails = new Set((existingRegistry || []).map((item) => item.email));
    const newEmails = teacherEmails.filter((email) => !existingEmails.has(email)).length;
    if ((count || 0) + newEmails > 50) return response({ ok: false, error: 'La carga supera el máximo de 50 docentes autorizados.' }, 409);

    const results: Array<Record<string, unknown>> = [];
    let createdCount = 0;
    let authorizedCount = 0;
    for (const user of users) {
      if (user.role === 'teacher') {
        const { error: registryError } = await adminClient.from('teacher_registry').upsert({
          email: user.email,
          full_name: user.fullName,
          active: true
        }, { onConflict: 'email' });
        if (registryError) {
          results.push({ email: user.email, ok: false, error: registryError.message });
          continue;
        }
      }

      if (!user.password) {
        authorizedCount += 1;
        results.push({ email: user.email, ok: true, status: 'authorized' });
        continue;
      }

      const { data: created, error: createError } = await adminClient.auth.admin.createUser({
        email: user.email,
        password: user.password,
        email_confirm: true,
        user_metadata: {
          full_name: user.fullName,
          role: user.role === 'teacher' ? 'teacher' : 'admin',
          admin_scope: user.role === 'admin' ? 'superadmin' : user.role === 'reservation_admin' ? 'reservations' : null
        }
      });
      if (createError) results.push({ email: user.email, ok: false, error: createError.message });
      else {
        createdCount += 1;
        results.push({ email: user.email, ok: true, status: 'created', userId: created.user?.id });
        if (user.role === 'teacher') {
          await adminClient.from('teacher_registry').update({ claimed_at: new Date().toISOString() }).eq('email', user.email);
        }
      }
    }

    if (!isBulk) {
      const result = results[0];
      return result?.ok ? response({ ok: true, userId: result.userId }) : response({ ok: false, error: result?.error || 'No fue posible crear la cuenta.' }, 400);
    }
    return response({ ok: true, createdCount, authorizedCount, results });
  } catch (error) {
    return response({ ok: false, error: error instanceof Error ? error.message : 'Error inesperado.' }, 500);
  }
});
