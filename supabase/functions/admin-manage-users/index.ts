import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS'
};
const teacherEmailPattern = /^[^\s@]+@una\.cr$/iu;
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
  if (value === 'operations_admin') return { role: 'admin', admin_scope: 'operations' };
  if (value === 'reservation_admin') return { role: 'admin', admin_scope: 'reservations' };
  if (value === 'conserjeria_admin') return { role: 'admin', admin_scope: 'conserjeria' };
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
    if (callerError || caller?.role !== 'admin'
      || !['superadmin', 'operations', 'reservations'].includes(caller.admin_scope)
      || !caller.active) {
      return response({ ok: false, error: 'Se requiere acceso de administrador.' }, 403);
    }

    const payload = await request.json();
    const action = String(payload.action || '');
    const callerIsSuperadmin = caller.admin_scope === 'superadmin';
    if (action === 'create') {
      if (!callerIsSuperadmin) return response({ok:false,error:'Solo superadministración puede registrar usuarios.'},403);
      const fullName=String(payload.fullName||'').trim(), nationalId=String(payload.nationalId||'').replace(/\D/g,''), email=String(payload.email||'').trim().toLowerCase(), unit=String(payload.unit||''), accessType=String(payload.accessType||'teacher'), password=String(payload.password||'');
      if(fullName.length<3||fullName.length>100||nationalId.length<7||nationalId.length>20||!teacherEmailPattern.test(email)||!allowedUnits.has(unit)||!['teacher','reservation_admin','operations_admin','superadmin'].includes(accessType)) return response({ok:false,error:'Revise nombre, cédula, correo institucional, unidad y acceso.'},400);
      if(!/^(?=.*[A-Z])(?=.*\d).{8,}$/.test(password)) return response({ok:false,error:'La contraseña debe tener al menos 8 caracteres, una mayúscula y un número.'},400);
      const duplicates=await Promise.all([adminClient.from('profiles').select('id').eq('email',email).limit(1),adminClient.from('profiles').select('id').eq('national_id',nationalId).limit(1)]);
      const lookupError=duplicates.find(x=>x.error)?.error;
      if(lookupError)return response({ok:false,error:lookupError.message},400);
      if(duplicates.some(x=>x.data?.length))return response({ok:false,error:'Correo o cédula ya registrados. Edite o reactive la cuenta existente.'},409);
      const {data:created,error:createError}=await adminClient.auth.admin.createUser({email,password,email_confirm:true,user_metadata:{full_name:fullName,unit}});
      if(createError||!created.user)return response({ok:false,error:createError?.message||'No se pudo crear la cuenta.'},400);
      const {error:finalizeError}=await callerClient.rpc('superadmin_finalize_user',{p_user_id:created.user.id,p_name:fullName,p_national_id:nationalId,p_email:email,p_unit:unit,p_access:accessType});
      if(finalizeError){
        const {error:cleanupError}=await adminClient.auth.admin.deleteUser(created.user.id);
        return response({ok:false,error:finalizeError.message+(cleanupError?' La cuenta recién creada requiere revisión administrativa.':'')},400);
      }
      return response({ok:true,message:'Usuario registrado. Ya puede ingresar con su correo y contraseña.',userId:created.user.id});
    }
    const targetId = String(payload.userId || '');
    if (!targetId) return response({ ok: false, error: 'Selecciona un usuario.' }, 400);

    const { data: target, error: targetError } = await adminClient
      .from('profiles')
      .select('*')
      .eq('id', targetId)
      .single();
    if (targetError || !target) return response({ ok: false, error: 'El usuario no existe.' }, 404);

    const targetIsSuperadmin = target.role === 'admin' && target.admin_scope === 'superadmin';
    if (!callerIsSuperadmin && targetIsSuperadmin) {
      return response({ ok: false, error: 'El superadministrador solo puede ser modificado por otro superadministrador.' }, 403);
    }
    if (!callerIsSuperadmin && target.role === 'admin' && target.id !== caller.id) {
      return response({ ok: false, error: 'No puedes modificar la cuenta de otro administrador de reservas.' }, 403);
    }
    if(!callerIsSuperadmin && (target.access_blocked || target.access_removed_at))return response({ok:false,error:'Esta cuenta requiere gestión del superadministrador.'},403);

    if(action==='detail') {
      if(!callerIsSuperadmin)return response({ok:false,error:'Solo superadministración puede ver el detalle completo.'},403);
      const {data:account,error}=await adminClient.auth.admin.getUserById(target.id);
      if(error)return response({ok:false,error:error.message},400);
      const {data:history,error:historyError}=await callerClient.rpc('superadmin_user_history',{p_user_id:target.id});
      if(historyError)return response({ok:false,error:historyError.message},400);
      return response({ok:true,detail:{...target,registered_at:account.user.created_at,last_sign_in_at:account.user.last_sign_in_at,email_confirmed_at:account.user.email_confirmed_at,banned_until:account.user.banned_until,history}});
    }
    if(['access_block','access_unblock','access_remove','access_restore'].includes(action)){
      if(!callerIsSuperadmin)return response({ok:false,error:'Solo superadministración puede administrar el acceso completo.'},403);
      const {error}=await callerClient.rpc('superadmin_set_user_access',{p_user_id:target.id,p_action:action,p_reason:String(payload.reason||'').trim()});
      if(error)return response({ok:false,error:error.message},400);
      const {error:banError}=await adminClient.auth.admin.updateUserById(target.id,{ban_duration:['access_block','access_remove'].includes(action)?'876000h':'none'});
      if(banError)return response({ok:false,error:'El estado de acceso fue actualizado, pero Auth no pudo sincronizarse. Repita la acción: '+banError.message},500);
      return response({ok:true,message:action==='access_block'?'Cuenta bloqueada en todo el sistema.':action==='access_remove'?'Cuenta retirada del registro activo; historial conservado.':'Acceso de la cuenta habilitado.'});
    }

    if (action === 'update') {
      const fullName = String(payload.fullName || '').trim();
      const nationalId = String(payload.nationalId || '').replace(/[^0-9]/g, '');
      const email = String(payload.email || '').trim().toLowerCase();
      const unit = String(payload.unit || '').trim();
      const nextRole = normalizedRole(payload.accessType);
      const roleChanged = nextRole.role !== target.role || nextRole.admin_scope !== target.admin_scope;

      if (fullName.length < 3 || fullName.length > 100) {
        return response({ ok: false, error: 'El nombre completo no es válido.' }, 400);
      }
      if (nationalId.length < 7 || nationalId.length > 20) {
        return response({ ok: false, error: 'La cédula debe contener entre 7 y 20 dígitos.' }, 400);
      }
      const { data: duplicateProfile } = await adminClient.from('profiles')
        .select('id').eq('national_id', nationalId).neq('id', target.id).maybeSingle();
      if (duplicateProfile) {
        return response({ ok: false, error: 'La cédula ya está asignada a otro usuario.' }, 409);
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
          unit,
          national_id: nationalId
        }
      });
      if (authError) return response({ ok: false, error: authError.message }, 400);

      const { error: profileError } = await adminClient.from('profiles').update({
        full_name: fullName,
        national_id: nationalId,
        email,
        unit,
        role: nextRole.role,
        admin_scope: nextRole.admin_scope
      }).eq('id', target.id);
      if (profileError) return response({ ok: false, error: profileError.message }, 400);

      const {data:registry, error:registryLookupError}=await adminClient.from('teacher_registry').select('id').eq('email',target.email).maybeSingle();
      if(registryLookupError)return response({ok:false,error:registryLookupError.message},400);
      if (registry || nextRole.role === 'teacher') {
        const registryValues={
          email,
          full_name: fullName,
          national_id: nationalId,
          unit,
          active: target.active,
          claimed_at: target.created_at
        };
        const {error:registryError}=registry?await adminClient.from('teacher_registry').update(registryValues).eq('id',registry.id):await adminClient.from('teacher_registry').insert(registryValues);
        if(registryError)return response({ok:false,error:registryError.message},400);
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
