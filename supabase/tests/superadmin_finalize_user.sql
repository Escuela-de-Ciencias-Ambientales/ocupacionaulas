begin;
do $$
declare actor uuid; target record; previous_id bigint;
begin
 select id into actor from public.profiles where active and role='admin' and admin_scope='superadmin' limit 1;
 select p.id,t.id registry_id,t.full_name,t.national_id,t.email,t.unit into target from public.profiles p join public.teacher_registry t on lower(p.email)=lower(t.email) where p.active and p.role='teacher' and t.active and t.national_id is not null limit 1;
 perform set_config('request.jwt.claim.sub',target.id::text,true);
 begin perform public.superadmin_finalize_user(target.id,target.full_name,target.national_id,target.email,coalesce(target.unit,'Docencia'),'teacher');raise exception 'Registro por docente permitido';exception when insufficient_privilege then null;end;
 perform set_config('request.jwt.claim.sub',actor::text,true);
 perform public.superadmin_finalize_user(target.id,target.full_name,target.national_id,target.email,coalesce(target.unit,'Docencia'),'teacher');
 if not exists(select 1 from public.teacher_registry where id=target.registry_id and email=target.email and national_id=target.national_id) then raise exception 'Identidad del padrón alterada';end if;
 if (select count(*) from public.teacher_registry where email=target.email)<>1 then raise exception 'Duplicación de padrón';end if;
end $$;
rollback;
select 'Finalización de registro y permisos comprobados sin duplicar padrón; cambios revertidos' resultado;
