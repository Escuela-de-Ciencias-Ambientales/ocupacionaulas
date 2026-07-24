import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS'
};
const teacherEmailPattern = /^[a-z0-9-]+\.[a-z0-9-]+\.[a-z0-9-]+@una\.cr$/;
const adminEmailPattern = /^[a-z0-9._-]+@una\.cr$/;
const allowedUnits = new Set(['Docencia', 'Administrativo', 'LAA', 'PROCAME']);

function response(body: Record<string, unknown>, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' }
  });
}

function normalizedRole(value: unknown) {
  if (value === 'superadmin') return { role: 'admin', admin_scope: 'superadmin' };
  if (value === 'reservation_admin') return { role: 'admin', admin_scope: 'reservations' };
  return { role: 'teacher', admin_scope: null };
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
    const { data: caller, error: callerError } = await adminClient
      .from('profiles')
      .select('id,role,admin_scope,active')
      .eq('id', userData.user.id)
      .single();
    if (callerError || caller?.role !== 'admin' || !caller.active) {
      return response({ ok: false, error: 'Se requiere acceso de administrador.' }, 403);
    }

    const payload = await request.json();
    const action = String(payload.action || '');
    const targetId = String(payload.userId || '');
    if (!targetId) return response({ ok: false, error: 'Selecciona un usuario.' }, 400);

    const { data: target, error: targetError } = await adminClient
      .from('profiles')
      .select('*')
      .eq('id', targetId)
      .single();
    if (targetError || !target) return response({ ok: false, error: 'El usuario no existe.' }, 404);

    const callerIsSuperadmin = caller.admin_scope === 'superadmin';
    const targetIsSuperadmin = target.role === 'admin' && target.admin_scope === 'superadmin';
    if (!callerIsSuperadmin && targetIsSuperadmin) {
      return response({ ok: false, error: 'El superadministrador solo puede ser modificado por otro superadministrador.' }, 403);
    }
    if (!callerIsSuperadmin && target.role === 'admin' && target.id !== caller.id) {
      return response({ ok: false, error: 'No puedes modificar la cuenta de otro administrador de reservas.' }, 403);
    }

    if (action === 'update') {
      const fullName = String(payload.fullName || '').trim();
      const email = String(payload.email || '').trim().toLowerCase();
      const unit = String(payload.unit || '').trim();
      const nextRole = normalizedRole(payload.accessType);
      const roleChanged = nextRole.role !== target.role || nextRole.admin_scope !== target.admin_scope;

      if (fullName.length < 3 || fullName.length > 100) {
        return response({ ok: false, error: 'El nombre completo no es válido.' }, 400);
      }
      if (!allowedUnits.has(unit)) {
        return response({ ok: false, error: 'Selecciona una unidad institucional válida.' }, 400);
      }
      if (!(nextRole.role === 'teacher' ? teacherEmailPattern : adminEmailPattern).test(email)) {
        return response({ ok: false, error: 'El correo institucional no tiene un formato válido para ese tipo de acceso.' }, 400);
      }
      if (!callerIsSuperadmin && roleChanged) {
        return response({ ok: false, error: 'Solo el superadministrador puede cambiar roles de acceso.' }, 403);
      }
      if (target.id === caller.id && roleChanged) {
        return response({ ok: false, error: 'No puedes cambiar tu propio rol administrativo.' }, 400);
      }

      if (targetIsSuperadmin && roleChanged) {
        const { count } = await adminClient
          .from('profiles')
          .select('id', { count: 'exact', head: true })
          .eq('role', 'admin')
          .eq('admin_scope', 'superadmin')
          .eq('active', true);
        if ((count || 0) <= 1) {
          return response({ ok: false, error: 'Debe permanecer al menos un superadministrador activo.' }, 409);
        }
      }

      const { error: authError } = await adminClient.auth.admin.updateUserById(target.id, {
        email,
        email_confirm: true,
        user_metadata: {
          full_name: fullName,
          role: nextRole.role,
          admin_scope: nextRole.admin_scope,
          unit
        }
      });
      if (authError) return response({ ok: false, error: authError.message }, 400);

      const { error: profileError } = await adminClient.from('profiles').update({
        full_name: fullName,
        email,
        unit,
        role: nextRole.role,
        admin_scope: nextRole.admin_scope
      }).eq('id', target.id);
      if (profileError) return response({ ok: false, error: profileError.message }, 400);

      if (nextRole.role === 'teacher') {
        if (target.email !== email) {
          await adminClient.from('teacher_registry').update({ active: false }).eq('email', target.email);
        }
        await adminClient.from('teacher_registry').upsert({
          email,
          full_name: fullName,
          unit,
          active: target.active,
          claimed_at: target.created_at
        }, { onConflict: 'email' });
      } else if (target.role === 'teacher') {
        await adminClient.from('teacher_registry').update({ active: false }).eq('email', target.email);
      }

      return response({ ok: true, message: 'Datos del usuario actualizados.' });
    }

    if (action === 'block' || action === 'unblock') {
      const blocked = action === 'block';
      const reason = String(payload.reason || '').trim();
      if (target.id === caller.id) {
        return response({ ok: false, error: 'No puedes bloquear las reservas de tu propia cuenta administrativa.' }, 400);
      }
      if (blocked && reason.length < 5) {
        return response({ ok: false, error: 'Indica el motivo del bloqueo de reservas.' }, 400);
      }
      const { error } = await adminClient.from('profiles').update({
        reservations_blocked: blocked,
        reservations_block_reason: blocked ? reason : null,
        reservations_blocked_at: blocked ? new Date().toISOString() : null,
        reservations_blocked_by: blocked ? caller.id : null
      }).eq('id', target.id);
      if (error) return response({ ok: false, error: error.message }, 400);
      return response({ ok: true, message: blocked ? 'Las reservas fueron bloqueadas.' : 'Las reservas fueron habilitadas.' });
    }

    if (action === 'deactivate' || action === 'reactivate') {
      const active = action === 'reactivate';
      if (target.id === caller.id && !active) {
        return response({ ok: false, error: 'No puedes eliminar tu propio acceso administrativo.' }, 400);
      }
      if (targetIsSuperadmin && !active) {
        const { count } = await adminClient
          .from('profiles')
          .select('id', { count: 'exact', head: true })
          .eq('role', 'admin')
          .eq('admin_scope', 'superadmin')
          .eq('active', true);
        if ((count || 0) <= 1) {
          return response({ ok: false, error: 'Debe permanecer al menos un superadministrador activo.' }, 409);
        }
      }
      const { error } = await adminClient.from('profiles').update({ active }).eq('id', target.id);
      if (error) return response({ ok: false, error: error.message }, 400);
      if (target.role === 'teacher') {
        await adminClient.from('teacher_registry').update({ active }).eq('email', target.email);
      }
      return response({
        ok: true,
        message: active ? 'El acceso fue reactivado.' : 'El usuario fue eliminado del acceso activo; su historial se conservó.'
      });
    }

    return response({ ok: false, error: 'Acción no válida.' }, 400);
  } catch (error) {
    return response({ ok: false, error: error instanceof Error ? error.message : 'Error inesperado.' }, 500);
  }
});
