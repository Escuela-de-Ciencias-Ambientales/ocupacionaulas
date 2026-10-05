create or replace function public.superadmin_set_user_access(p_user_id uuid,p_action text,p_reason text default null) returns void
language plpgsql security definer set search_path='' as $$
declare target public.profiles; enabled boolean;
begin
 perform pg_advisory_xact_lock(hashtext('superadmin_user_access'));
 if not public.is_superadmin() then raise exception using errcode='42501',message='Se requiere superadministración';end if;
 if p_user_id=auth.uid() then raise exception 'No puede bloquear ni eliminar su propia cuenta';end if;
 select * into target from public.profiles where id=p_user_id for update;
 if not found then raise exception 'Usuario no encontrado';end if;
 if p_action not in ('access_block','access_unblock','access_remove','access_restore') then raise exception 'Acción inválida';end if;
 if p_action in ('access_block','access_remove') and char_length(trim(coalesce(p_reason,''))) not between 5 and 500 then raise exception 'Indique un motivo de 5 a 500 caracteres';end if;
 if target.role='admin' and target.admin_scope='superadmin' and p_action in ('access_block','access_remove') and (select count(*) from public.profiles where active and role='admin' and admin_scope='superadmin')<=1 then raise exception 'Debe permanecer un superadministrador activo';end if;
 enabled:=p_action in ('access_unblock','access_restore');
 update public.profiles set active=enabled,access_blocked=(p_action='access_block'),access_block_reason=case when p_action='access_block' then trim(p_reason) end,access_blocked_at=case when p_action='access_block' then now() end,access_removed_at=case when p_action='access_remove' then now() end where id=p_user_id;
 update public.teacher_registry set active=enabled where lower(email)=lower(target.email);
 insert into public.user_access_history(user_id,actor_id,action,reason) values(p_user_id,auth.uid(),p_action,nullif(trim(coalesce(p_reason,'')),''));
end $$;
create index user_access_history_user_idx on public.user_access_history(user_id,created_at desc);

