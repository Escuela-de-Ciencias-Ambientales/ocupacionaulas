create function public.equipment_session_teacher() returns public.teacher_registry
language plpgsql stable security definer set search_path='' as $$
declare teacher public.teacher_registry;
begin
 if auth.uid() is null then raise exception using errcode='42501',message='Inicie sesión con su usuario y contraseña'; end if;
 select t.* into teacher from public.teacher_registry t
 join auth.users u on lower(trim(u.email))=lower(trim(t.email))
 join public.profiles p on p.id=u.id and p.active and p.role in ('teacher','admin')
 where u.id=auth.uid() and t.active;
 if not found then raise exception using errcode='42501',message='Se requiere una cuenta académica activa vinculada al padrón institucional'; end if;
 return teacher;
end $$;
revoke all on function public.equipment_session_teacher() from public,anon,authenticated;
CREATE OR REPLACE FUNCTION public.public_authorize_direction_equipment(p_director_national_id text, p_borrower_id bigint, p_kind text, p_catalog_id bigint, p_quantity integer, p_valid_until timestamp with time zone, p_reason text, p_signature_data text)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare authority record; saved uuid;
begin
 if regexp_replace(coalesce(p_director_national_id,''),'[^0-9]','','g') is distinct from regexp_replace((public.equipment_session_teacher()).national_id,'[^0-9]','','g') then raise exception using errcode='42501',message='La identidad debe corresponder a la sesión actual'; end if;

 select d.role,t.id,t.full_name into authority from public.equipment_direction_roles d join public.teacher_registry t on t.id=d.teacher_registry_id
 where t.active and regexp_replace(t.national_id,'[^0-9]','','g')=regexp_replace(p_director_national_id,'[^0-9]','','g') for update of d;
 if not found then raise exception using errcode='42501',message='Solo Dirección o Subdirección puede autorizar GNSS Trimble'; end if;
 if p_quantity is null or p_quantity not between 1 and 20 or p_valid_until is null or p_valid_until<=now() or p_valid_until>now()+interval '90 days' then raise exception 'Revise cantidad y fecha límite (máximo 90 días)'; end if;
 if p_reason is null or char_length(trim(p_reason)) not between 3 and 500 or p_signature_data is null or p_signature_data not like 'data:image/png;base64,%' or char_length(p_signature_data) not between 100 and 300000 then raise exception 'Indique el motivo y registre su firma'; end if;
 if not exists(select 1 from public.equipment_catalog where id=p_catalog_id and active and public.equipment_requires_direction(id)) then raise exception 'Seleccione un equipo GNSS Trimble'; end if;
 if p_kind='student' then
   if not exists(select 1 from public.academic_students where id=p_borrower_id and active) then raise exception 'Estudiante no encontrado'; end if;
 elsif p_kind='academic' then
   if not exists(select 1 from public.teacher_registry where id=p_borrower_id and active) then raise exception 'Académico no encontrado'; end if;
 else raise exception 'Tipo de persona inválido'; end if;
 insert into public.equipment_direction_authorizations(student_id,borrower_teacher_id,catalog_id,quantity,authorized_by,approver_name,approver_role,valid_until,reason,signature_data)
 values(case when p_kind='student' then p_borrower_id end,case when p_kind='academic' then p_borrower_id end,p_catalog_id,p_quantity,authority.id,authority.full_name,authority.role,p_valid_until,trim(p_reason),p_signature_data) returning id into saved;
 return saved;
end $function$
;
revoke all on function public.public_authorize_direction_equipment(text,bigint,text,bigint,integer,timestamp with time zone,text,text) from public,anon,authenticated;
grant execute on function public.public_authorize_direction_equipment(text,bigint,text,bigint,integer,timestamp with time zone,text,text) to authenticated;
CREATE OR REPLACE FUNCTION public.public_authorize_equipment_course(p_teacher_national_id text, p_cycle_id uuid, p_nrc text, p_reason text, p_reason_detail text DEFAULT NULL::text, p_signature_data text DEFAULT NULL::text)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare teacher public.teacher_registry; profile_id uuid; selected_course record; saved_id uuid;
begin
 if regexp_replace(coalesce(p_teacher_national_id,''),'[^0-9]','','g') is distinct from regexp_replace((public.equipment_session_teacher()).national_id,'[^0-9]','','g') then raise exception using errcode='42501',message='La identidad debe corresponder a la sesión actual'; end if;

  select * into teacher from public.teacher_registry where active and regexp_replace(coalesce(national_id,''),'[^0-9]','','g')=regexp_replace(coalesce(p_teacher_national_id,''),'[^0-9]','','g') limit 1;
  if not found then raise exception using errcode='42501',message='Profesor no registrado'; end if;
  if p_reason not in ('course_trip','supervised_practice','other') or (p_reason='other' and char_length(trim(coalesce(p_reason_detail,'')))<3) then raise exception using errcode='22023',message='Indique un motivo válido'; end if;
  if p_signature_data is null or p_signature_data !~ '^data:image/png;base64,' then raise exception using errcode='22023',message='La firma del profesor es obligatoria'; end if;
  select x.course_code,x.course_name,x.nrc,x.group_code into selected_course from public.equipment_teacher_courses x where x.teacher_registry_id=teacher.id and x.cycle_id=p_cycle_id and x.nrc=trim(p_nrc) limit 1;
  if not found then raise exception using errcode='42501',message='El curso no está asignado al profesor'; end if;
  profile_id:=auth.uid();
  update public.equipment_authorizations set active=false,revoked_at=now() where teacher_registry_id=teacher.id and cycle_id=p_cycle_id and scope='course' and nrc=selected_course.nrc and active;
  insert into public.equipment_authorizations(teacher_id,teacher_registry_id,cycle_id,scope,course_code,course_name,nrc,group_code,reason,reason_detail,signature_data)
  values(profile_id,teacher.id,p_cycle_id,'course',selected_course.course_code,selected_course.course_name,selected_course.nrc,selected_course.group_code,p_reason,nullif(trim(coalesce(p_reason_detail,'')),''),p_signature_data) returning id into saved_id;
  return saved_id;
end $function$
;
revoke all on function public.public_authorize_equipment_course(text,uuid,text,text,text,text) from public,anon,authenticated;
grant execute on function public.public_authorize_equipment_course(text,uuid,text,text,text,text) to authenticated;
CREATE OR REPLACE FUNCTION public.public_authorize_equipment_student(p_teacher_national_id text, p_student_id bigint, p_reason text, p_reason_detail text DEFAULT NULL::text, p_signature_data text DEFAULT NULL::text)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare teacher public.teacher_registry; profile_id uuid; saved_id uuid;
begin
 if regexp_replace(coalesce(p_teacher_national_id,''),'[^0-9]','','g') is distinct from regexp_replace((public.equipment_session_teacher()).national_id,'[^0-9]','','g') then raise exception using errcode='42501',message='La identidad debe corresponder a la sesión actual'; end if;

  select * into teacher from public.teacher_registry where active and regexp_replace(coalesce(national_id,''),'[^0-9]','','g')=regexp_replace(coalesce(p_teacher_national_id,''),'[^0-9]','','g') limit 1;
  if not found then raise exception using errcode='42501',message='Profesor no registrado'; end if;
  if not exists(select 1 from public.academic_students where id=p_student_id and active) then raise exception using errcode='P0002',message='Estudiante no encontrado'; end if;
  if p_reason not in ('course_trip','supervised_practice','other') or (p_reason='other' and char_length(trim(coalesce(p_reason_detail,'')))<3) then raise exception using errcode='22023',message='Indique un motivo válido'; end if;
  if p_signature_data is null or p_signature_data !~ '^data:image/png;base64,' then raise exception using errcode='22023',message='La firma del profesor es obligatoria'; end if;
  profile_id:=auth.uid();
  insert into public.equipment_authorizations(teacher_id,teacher_registry_id,scope,student_id,reason,reason_detail,signature_data)
  values(profile_id,teacher.id,'individual',p_student_id,p_reason,nullif(trim(coalesce(p_reason_detail,'')),''),p_signature_data) returning id into saved_id;
  return saved_id;
end $function$
;
revoke all on function public.public_authorize_equipment_student(text,bigint,text,text,text) from public,anon,authenticated;
grant execute on function public.public_authorize_equipment_student(text,bigint,text,text,text) to authenticated;
CREATE OR REPLACE FUNCTION public.public_direction_find_borrower(p_director_national_id text, p_national_id text, p_kind text)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare result jsonb;
begin
 if regexp_replace(coalesce(p_director_national_id,''),'[^0-9]','','g') is distinct from regexp_replace((public.equipment_session_teacher()).national_id,'[^0-9]','','g') then raise exception using errcode='42501',message='La identidad debe corresponder a la sesión actual'; end if;

 if public.equipment_direction_role(p_director_national_id) is null then raise exception using errcode='42501',message='Solo Dirección o Subdirección puede autorizar GNSS Trimble'; end if;
 if p_kind='student' then select jsonb_build_object('found',true,'id',id,'full_name',full_name) into result from public.academic_students where active and regexp_replace(national_id,'[^0-9]','','g')=regexp_replace(p_national_id,'[^0-9]','','g');
 elsif p_kind='academic' then select jsonb_build_object('found',true,'id',id,'full_name',full_name) into result from public.teacher_registry where active and regexp_replace(national_id,'[^0-9]','','g')=regexp_replace(p_national_id,'[^0-9]','','g');
 else raise exception 'Tipo de persona inválido'; end if;
 return coalesce(result,jsonb_build_object('found',false));
end $function$
;
revoke all on function public.public_direction_find_borrower(text,text,text) from public,anon,authenticated;
grant execute on function public.public_direction_find_borrower(text,text,text) to authenticated;
CREATE OR REPLACE FUNCTION public.public_direction_search_borrowers(p_director_national_id text, p_query text, p_kind text)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare q text; result jsonb;
begin
 if regexp_replace(coalesce(p_director_national_id,''),'[^0-9]','','g') is distinct from regexp_replace((public.equipment_session_teacher()).national_id,'[^0-9]','','g') then raise exception using errcode='42501',message='La identidad debe corresponder a la sesión actual'; end if;

 if public.equipment_direction_role(p_director_national_id) is null then raise exception using errcode='42501',message='Solo Dirección o Subdirección puede buscar solicitantes GNSS'; end if;
 if p_kind not in ('student','academic') or p_kind is null then raise exception 'Tipo de persona inválido'; end if;
 q:=translate(lower(trim(coalesce(p_query,''))),'áéíóúüñ','aeiouun');
 if char_length(q)<2 then return '[]'::jsonb; end if;
 if char_length(q)>100 then raise exception 'Búsqueda demasiado larga'; end if;
 select coalesce(jsonb_agg(to_jsonb(r) order by r.full_name,r.id),'[]'::jsonb) into result from (
 select b.id,b.full_name,b.national_id from (
 select id,full_name,national_id from public.academic_students where active and p_kind='student'
 union all select id,full_name,national_id from public.teacher_registry where active and p_kind='academic'
 ) b where not exists (
 select 1 from regexp_split_to_table(q,'\s+') word where strpos(translate(lower(b.full_name),'áéíóúüñ','aeiouun'),word)=0
 ) order by b.full_name,b.id limit 30
 ) r;
 return result;
end $function$
;
revoke all on function public.public_direction_search_borrowers(text,text,text) from public,anon,authenticated;
grant execute on function public.public_direction_search_borrowers(text,text,text) to authenticated;
CREATE OR REPLACE FUNCTION public.public_equipment_direction_context(p_national_id text)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare role_name text;
begin
 if regexp_replace(coalesce(p_national_id,''),'[^0-9]','','g') is distinct from regexp_replace((public.equipment_session_teacher()).national_id,'[^0-9]','','g') then raise exception using errcode='42501',message='La identidad debe corresponder a la sesión actual'; end if;

 role_name:=public.equipment_direction_role(p_national_id);
 return jsonb_build_object('can_authorize',role_name is not null,'role',role_name,
 'equipment',case when role_name is not null then (select coalesce(jsonb_agg(jsonb_build_object('id',id,'name',name) order by name),'[]') from public.equipment_catalog where active and public.equipment_requires_direction(id)) else '[]'::jsonb end);
end $function$
;
revoke all on function public.public_equipment_direction_context(text) from public,anon,authenticated;
grant execute on function public.public_equipment_direction_context(text) to authenticated;
CREATE OR REPLACE FUNCTION public.public_equipment_teacher_context(p_national_id text)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare teacher public.teacher_registry; result jsonb;
begin
 if regexp_replace(coalesce(p_national_id,''),'[^0-9]','','g') is distinct from regexp_replace((public.equipment_session_teacher()).national_id,'[^0-9]','','g') then raise exception using errcode='42501',message='La identidad debe corresponder a la sesión actual'; end if;

  if char_length(regexp_replace(coalesce(p_national_id,''),'[^0-9]','','g')) not between 7 and 20 then raise exception using errcode='22023',message='Revise el número de cédula'; end if;
  select * into teacher from public.teacher_registry where active and regexp_replace(coalesce(national_id,''),'[^0-9]','','g')=regexp_replace(p_national_id,'[^0-9]','','g') limit 1;
  if not found then return jsonb_build_object('found',false); end if;
  select jsonb_build_object('found',true,'teacher_name',teacher.full_name,'courses',(
    select coalesce(jsonb_agg(to_jsonb(q) order by q.cycle_name,q.course_name,q.nrc),'[]'::jsonb) from (
      select x.cycle_id,c.name cycle_name,x.course_code,x.course_name,x.nrc,x.group_code
      from public.equipment_teacher_courses x join public.reservation_cycles c on c.id=x.cycle_id
      where x.teacher_registry_id=teacher.id) q)) into result;
  return result;
end $function$
;
revoke all on function public.public_equipment_teacher_context(text) from public,anon,authenticated;
grant execute on function public.public_equipment_teacher_context(text) to authenticated;
CREATE OR REPLACE FUNCTION public.public_find_equipment_student(p_national_id text)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare student public.academic_students;
begin
 perform public.equipment_session_teacher();

  if char_length(regexp_replace(coalesce(p_national_id, ''), '[^0-9]', '', 'g')) not between 7 and 20 then
    raise exception using errcode = '22023', message = 'Revise la cédula del estudiante';
  end if;
  select * into student from public.academic_students
  where active and regexp_replace(national_id, '[^0-9]', '', 'g') = regexp_replace(p_national_id, '[^0-9]', '', 'g')
  limit 1;
  if not found then return jsonb_build_object('found', false); end if;
  return jsonb_build_object('found', true, 'student_id', student.id, 'national_id', student.national_id, 'full_name', student.full_name, 'career', student.career);
end;
$function$
;
revoke all on function public.public_find_equipment_student(text) from public,anon,authenticated;
grant execute on function public.public_find_equipment_student(text) to authenticated;

create function public.equipment_authorization_session_context() returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare t public.teacher_registry; result jsonb;
begin
 t:=public.equipment_session_teacher();
 result:=public.public_equipment_teacher_context(t.national_id);
 return result||jsonb_build_object('national_id',t.national_id,'direction',public.public_equipment_direction_context(t.national_id));
end $$;
revoke all on function public.equipment_authorization_session_context() from public,anon,authenticated;
grant execute on function public.equipment_authorization_session_context() to authenticated;;
revoke all on function public.public_authorize_equipment_course(text,uuid,text,text,text),public.public_authorize_equipment_student(text,bigint,text,text),public.authorize_equipment_course(uuid,text,text,text),public.authorize_equipment_student(bigint,text,text) from public,anon,authenticated;

