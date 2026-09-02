alter table public.equipment_authorizations
  add column if not exists signature_data text;

alter table public.equipment_authorizations
  drop constraint if exists equipment_authorizations_signature_data_check;
alter table public.equipment_authorizations
  add constraint equipment_authorizations_signature_data_check
  check (signature_data is null or (signature_data like 'data:image/png;base64,%' and char_length(signature_data) between 100 and 300000));

create or replace function public.public_authorize_equipment_course(
  p_teacher_national_id text, p_cycle_id uuid, p_nrc text, p_reason text,
  p_reason_detail text, p_signature_data text
)
returns uuid language plpgsql security definer set search_path = '' as $$
declare teacher public.profiles; selected_course record; saved_id uuid;
begin
  select * into teacher from public.profiles
  where active and role = 'teacher'
    and regexp_replace(coalesce(national_id, ''), '[^0-9]', '', 'g') = regexp_replace(coalesce(p_teacher_national_id, ''), '[^0-9]', '', 'g') limit 1;
  if not found then raise exception using errcode = '42501', message = 'Profesor no registrado'; end if;
  if p_reason not in ('course_trip', 'supervised_practice', 'other') or (p_reason = 'other' and char_length(trim(coalesce(p_reason_detail, ''))) < 3) then
    raise exception using errcode = '22023', message = 'Indique un motivo válido';
  end if;
  if p_signature_data is null or p_signature_data not like 'data:image/png;base64,%' or char_length(p_signature_data) not between 100 and 300000 then
    raise exception using errcode = '22023', message = 'La firma táctil es obligatoria';
  end if;
  select f.course_code, f.course_name, f.nrc, f.group_code into selected_course
  from public.fixed_occupancies f join public.reservation_cycles c on c.id = f.cycle_id and c.is_current
  where f.cycle_id = p_cycle_id and f.nrc = trim(p_nrc)
    and regexp_replace(upper(coalesce(f.professor_name, '')), '[^A-Z0-9]', '', 'g') like '%' || regexp_replace(upper(teacher.full_name), '[^A-Z0-9]', '', 'g') || '%' limit 1;
  if not found then raise exception using errcode = '42501', message = 'El curso no pertenece al profesor'; end if;
  update public.equipment_authorizations set active = false, revoked_at = now()
  where teacher_id = teacher.id and cycle_id = p_cycle_id and scope = 'course' and nrc = selected_course.nrc and active;
  insert into public.equipment_authorizations
    (teacher_id, cycle_id, scope, course_code, course_name, nrc, group_code, reason, reason_detail, signature_data)
  values (teacher.id, p_cycle_id, 'course', selected_course.course_code, selected_course.course_name, selected_course.nrc,
    selected_course.group_code, p_reason, nullif(trim(coalesce(p_reason_detail, '')), ''), p_signature_data)
  returning id into saved_id;
  return saved_id;
end; $$;

create or replace function public.public_authorize_equipment_student(
  p_teacher_national_id text, p_student_id bigint, p_reason text,
  p_reason_detail text, p_signature_data text
)
returns uuid language plpgsql security definer set search_path = '' as $$
declare teacher public.profiles; saved_id uuid;
begin
  select * into teacher from public.profiles where active and role = 'teacher'
    and regexp_replace(coalesce(national_id, ''), '[^0-9]', '', 'g') = regexp_replace(coalesce(p_teacher_national_id, ''), '[^0-9]', '', 'g') limit 1;
  if not found then raise exception using errcode = '42501', message = 'Profesor no registrado'; end if;
  if not exists (select 1 from public.academic_students where id = p_student_id and active) then raise exception using errcode = 'P0002', message = 'Estudiante no encontrado'; end if;
  if p_reason not in ('course_trip', 'supervised_practice', 'other') or (p_reason = 'other' and char_length(trim(coalesce(p_reason_detail, ''))) < 3) then raise exception using errcode = '22023', message = 'Indique un motivo válido'; end if;
  if p_signature_data is null or p_signature_data not like 'data:image/png;base64,%' or char_length(p_signature_data) not between 100 and 300000 then raise exception using errcode = '22023', message = 'La firma táctil es obligatoria'; end if;
  insert into public.equipment_authorizations (teacher_id, scope, student_id, reason, reason_detail, signature_data)
  values (teacher.id, 'individual', p_student_id, p_reason, nullif(trim(coalesce(p_reason_detail, '')), ''), p_signature_data)
  returning id into saved_id;
  return saved_id;
end; $$;

revoke all on function public.public_authorize_equipment_course(text, uuid, text, text, text) from anon;
revoke all on function public.public_authorize_equipment_student(text, bigint, text, text) from anon;
revoke all on function public.public_authorize_equipment_course(text, uuid, text, text, text, text) from public, authenticated;
revoke all on function public.public_authorize_equipment_student(text, bigint, text, text, text) from public, authenticated;
grant execute on function public.public_authorize_equipment_course(text, uuid, text, text, text, text) to anon;
grant execute on function public.public_authorize_equipment_student(text, bigint, text, text, text) to anon;
