alter table public.profiles add column access_blocked boolean not null default false, add column access_block_reason text, add column access_blocked_at timestamptz, add column access_removed_at timestamptz;
create table public.user_access_history(id bigint generated always as identity primary key,user_id uuid not null references public.profiles(id),actor_id uuid not null references public.profiles(id),action text not null,reason text,created_at timestamptz not null default now());
alter table public.user_access_history enable row level security;
revoke all on public.user_access_history from public,anon,authenticated;
create function public.superadmin_set_user_access(p_user_id uuid,p_action text,p_reason text default null) returns void
language plpgsql security definer set search_path='' as $$
declare target public.profiles; enabled boolean;
begin
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
create function public.superadmin_finalize_user(p_user_id uuid,p_name text,p_national_id text,p_email text,p_unit text,p_access text) returns void
language plpgsql security definer set search_path='' as $$
declare registry_id bigint; other_id bigint; wanted_role public.user_role; scope text;
begin
 if not public.is_superadmin() then raise exception using errcode='42501',message='Se requiere superadministración';end if;
 if p_access not in ('teacher','reservation_admin','operations_admin','superadmin') then raise exception 'Tipo de acceso inválido';end if;
 if char_length(trim(p_name)) not between 3 and 100 or p_national_id !~ '^[0-9]{7,20}$' or p_email !~ '^[^ @]+@una[.]cr$' or p_unit not in ('Docencia','Administrativo','LAA','PROCAME') then raise exception 'Datos de registro inválidos';end if;
 if not exists(select 1 from auth.users where id=p_user_id and lower(email)=lower(p_email)) then raise exception 'Cuenta no encontrada';end if;
 if exists(select 1 from public.profiles where id<>p_user_id and (lower(email)=lower(p_email) or national_id=p_national_id)) then raise exception 'Correo o cédula ya registrados';end if;
 select id into registry_id from public.teacher_registry where lower(email)=lower(p_email);
 select id into other_id from public.teacher_registry where national_id=p_national_id;
 if registry_id is not null and other_id is not null and registry_id<>other_id then raise exception 'Correo y cédula pertenecen a registros diferentes';end if;
 if registry_id is null and other_id is not null then raise exception 'La cédula ya pertenece a otro correo del padrón';end if;
 if registry_id is not null and exists(select 1 from public.teacher_registry where id=registry_id and not active) then raise exception 'El registro del padrón está desactivado';end if;
 wanted_role:=case when p_access='teacher' then 'teacher'::public.user_role else 'admin'::public.user_role end;
 scope:=case p_access when 'superadmin' then 'superadmin' when 'operations_admin' then 'operations' when 'reservation_admin' then 'reservations' end;
 update public.profiles set full_name=trim(p_name),national_id=p_national_id,email=lower(p_email),unit=p_unit,role=wanted_role,admin_scope=scope where id=p_user_id;
 if registry_id is null then insert into public.teacher_registry(full_name,national_id,email,unit,active,claimed_at) values(trim(p_name),p_national_id,lower(p_email),p_unit,true,now());
 else update public.teacher_registry set full_name=trim(p_name),national_id=p_national_id,unit=p_unit,claimed_at=now() where id=registry_id;end if;
 insert into public.user_access_history(user_id,actor_id,action) values(p_user_id,auth.uid(),'created');
end $$;
create function public.superadmin_user_history(p_user_id uuid) returns jsonb
language plpgsql stable security definer set search_path='' as $$
begin
 if not public.is_superadmin() then raise exception using errcode='42501',message='Se requiere superadministración';end if;
 return (select coalesce(jsonb_agg(jsonb_build_object('action',h.action,'reason',h.reason,'created_at',h.created_at,'actor',p.full_name) order by h.created_at desc,h.id desc),'[]'::jsonb) from public.user_access_history h join public.profiles p on p.id=h.actor_id where user_id=p_user_id);
end $$;
revoke all on function public.superadmin_set_user_access(uuid,text,text),public.superadmin_finalize_user(uuid,text,text,text,text,text),public.superadmin_user_history(uuid) from public,anon,authenticated;
grant execute on function public.superadmin_set_user_access(uuid,text,text),public.superadmin_finalize_user(uuid,text,text,text,text,text),public.superadmin_user_history(uuid) to authenticated;
