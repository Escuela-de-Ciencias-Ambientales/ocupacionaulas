create or replace function public.warehouse_authorization_data()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare result jsonb;
begin
  if not public.is_warehouse_staff() then
    raise exception using errcode = '42501', message = 'Acceso exclusivo para personal de bodega';
  end if;

  select jsonb_build_object(
    'courses', (
      select coalesce(jsonb_agg(to_jsonb(course_row) order by course_row.course_name, course_row.nrc), '[]'::jsonb)
      from (
        select distinct f.cycle_id, f.course_code, f.course_name, f.nrc, f.group_code
        from public.fixed_occupancies f
        join public.reservation_cycles c on c.id = f.cycle_id and c.is_current
        where f.nrc is not null
      ) course_row
    ),
    'authorizations', (
      select coalesce(jsonb_agg(jsonb_build_object(
        'id', a.id,
        'scope', a.scope,
        'course_code', a.course_code,
        'course_name', a.course_name,
        'nrc', a.nrc,
        'group_code', a.group_code,
        'student_name', s.full_name,
        'student_national_id', s.national_id,
        'reason', a.reason,
        'reason_detail', a.reason_detail,
        'authorized_at', a.authorized_at,
        'authorized_by', p.full_name
      ) order by a.authorized_at desc), '[]'::jsonb)
      from public.equipment_authorizations a
      join public.profiles p on p.id = a.teacher_id
      left join public.academic_students s on s.id = a.student_id
      where a.active
    )
  ) into result;
  return result;
end;
$$;

create or replace function public.warehouse_authorize_course(
  p_cycle_id uuid,
  p_nrc text,
  p_reason text,
  p_reason_detail text default null
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare selected_course record; saved_id uuid;
begin
  if not public.is_warehouse_staff() then
    raise exception using errcode = '42501', message = 'Acceso exclusivo para personal de bodega';
  end if;
  if p_reason not in ('course_trip', 'supervised_practice', 'other')
     or (p_reason = 'other' and char_length(trim(coalesce(p_reason_detail, ''))) < 3) then
    raise exception using errcode = '22023', message = 'Indique un motivo válido';
  end if;

  select distinct f.course_code, f.course_name, f.nrc, f.group_code
  into selected_course
  from public.fixed_occupancies f
  join public.reservation_cycles c on c.id = f.cycle_id and c.is_current
  where f.cycle_id = p_cycle_id and f.nrc = trim(p_nrc)
  limit 1;
  if not found then raise exception using errcode = 'P0002', message = 'Curso no encontrado'; end if;

  update public.equipment_authorizations
  set active = false, revoked_at = now()
  where cycle_id = p_cycle_id and scope = 'course' and nrc = selected_course.nrc and active;

  insert into public.equipment_authorizations
    (teacher_id, cycle_id, scope, course_code, course_name, nrc, group_code, reason, reason_detail)
  values
    ((select auth.uid()), p_cycle_id, 'course', selected_course.course_code, selected_course.course_name,
     selected_course.nrc, selected_course.group_code, p_reason, nullif(trim(coalesce(p_reason_detail, '')), ''))
  returning id into saved_id;
  return saved_id;
end;
$$;

create or replace function public.warehouse_authorize_student(
  p_student_id bigint,
  p_reason text,
  p_reason_detail text default null
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare saved_id uuid;
begin
  if not public.is_warehouse_staff() then
    raise exception using errcode = '42501', message = 'Acceso exclusivo para personal de bodega';
  end if;
  if not exists (select 1 from public.academic_students where id = p_student_id and active) then
    raise exception using errcode = 'P0002', message = 'Estudiante no encontrado';
  end if;
  if p_reason not in ('course_trip', 'supervised_practice', 'other')
     or (p_reason = 'other' and char_length(trim(coalesce(p_reason_detail, ''))) < 3) then
    raise exception using errcode = '22023', message = 'Indique un motivo válido';
  end if;

  update public.equipment_authorizations
  set active = false, revoked_at = now()
  where scope = 'individual' and student_id = p_student_id and active;

  insert into public.equipment_authorizations
    (teacher_id, scope, student_id, reason, reason_detail)
  values
    ((select auth.uid()), 'individual', p_student_id, p_reason, nullif(trim(coalesce(p_reason_detail, '')), ''))
  returning id into saved_id;
  return saved_id;
end;
$$;

create or replace function public.warehouse_revoke_authorization(p_authorization_id uuid)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not public.is_warehouse_staff() then
    raise exception using errcode = '42501', message = 'Acceso exclusivo para personal de bodega';
  end if;
  update public.equipment_authorizations
  set active = false, revoked_at = now()
  where id = p_authorization_id and active;
  return found;
end;
$$;

revoke all on function public.warehouse_authorization_data() from public, anon;
revoke all on function public.warehouse_authorize_course(uuid, text, text, text) from public, anon;
revoke all on function public.warehouse_authorize_student(bigint, text, text) from public, anon;
revoke all on function public.warehouse_revoke_authorization(uuid) from public, anon;
grant execute on function public.warehouse_authorization_data() to authenticated;
grant execute on function public.warehouse_authorize_course(uuid, text, text, text) to authenticated;
grant execute on function public.warehouse_authorize_student(bigint, text, text) to authenticated;
grant execute on function public.warehouse_revoke_authorization(uuid) to authenticated;
