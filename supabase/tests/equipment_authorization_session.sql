begin;
do $$
declare actor record; other_id text; borrower bigint; catalog bigint; saved uuid; courses record; f record; context jsonb;
begin
 for f in select oid,oid::regprocedure::text signature from pg_proc where pronamespace='public'::regnamespace and proname in ('public_authorize_equipment_course','public_authorize_equipment_student','public_authorize_direction_equipment','public_direction_find_borrower','public_direction_search_borrowers','public_equipment_direction_context','public_equipment_teacher_context','public_find_equipment_student','equipment_authorization_session_context','authorize_equipment_course','authorize_equipment_student') loop
 if has_function_privilege('anon',f.oid,'EXECUTE') then raise exception 'RPC público: %',f.signature; end if;
 end loop;
 select p.id user_id,t.id teacher_id,t.national_id into actor from public.teacher_registry t join auth.users u on lower(trim(u.email))=lower(trim(t.email)) join public.profiles p on p.id=u.id where t.active and p.active and p.role in ('teacher','admin') and t.national_id is not null limit 1;
 if actor.user_id is null then raise exception 'Falta cuenta para validación'; end if;
 perform set_config('request.jwt.claim.sub','',true);
 begin perform public.equipment_authorization_session_context();raise exception 'Permitió anónimo';exception when insufficient_privilege then null;end;
 perform set_config('request.jwt.claim.sub',actor.user_id::text,true);
 context:=public.equipment_authorization_session_context();
 if context->>'national_id'<>actor.national_id then raise exception 'Identidad incorrecta';end if;
 select national_id into other_id from public.teacher_registry where id<>actor.teacher_id and active and national_id<>actor.national_id limit 1;
 begin perform public.public_equipment_teacher_context(other_id);raise exception 'Permitió suplantación';exception when insufficient_privilege then null;end;
 begin perform public.public_authorize_equipment_student(other_id,0,'other','test','data:image/png;base64,test');raise exception 'Permitió firma ajena';exception when insufficient_privilege then null;end;
 select id into borrower from public.academic_students where active limit 1;
 saved:=public.public_authorize_equipment_student(actor.national_id,borrower,'other','Validación revertida','data:image/png;base64,'||repeat('A',150));
 if not exists(select 1 from public.equipment_authorizations where id=saved and teacher_id=actor.user_id and teacher_registry_id=actor.teacher_id) then raise exception 'Firmante incorrecto';end if;
 select * into courses from public.equipment_teacher_courses where teacher_registry_id=actor.teacher_id limit 1;
 if courses.id is not null then perform public.public_authorize_equipment_course(actor.national_id,courses.cycle_id,courses.nrc,'other','Validación revertida','data:image/png;base64,'||repeat('A',150));end if;
 if public.equipment_direction_role(actor.national_id) is null then
 begin perform public.public_direction_search_borrowers(actor.national_id,'ana','student');raise exception 'Permitió docente sin cargo';exception when insufficient_privilege then null;end;
 end if;
 update public.equipment_direction_roles set teacher_registry_id=null where teacher_registry_id=actor.teacher_id;
 update public.equipment_direction_roles set teacher_registry_id=actor.teacher_id where role='director';
 perform public.public_direction_search_borrowers(actor.national_id,'ana','student');
 select id into catalog from public.equipment_catalog where active and public.equipment_requires_direction(id) limit 1;
 perform public.public_authorize_direction_equipment(actor.national_id,borrower,'student',catalog,1,now()+interval '7 days','Validación revertida','data:image/png;base64,'||repeat('A',150));
 update public.profiles set active=false where id=actor.user_id;
 begin perform public.equipment_authorization_session_context();raise exception 'Permitió cuenta desactivada';exception when insufficient_privilege then null;end;
end $$;
rollback;
select 'Sesión, suplantación, cargos, cuenta inactiva y firmas verificados; cambios revertidos' as resultado;
