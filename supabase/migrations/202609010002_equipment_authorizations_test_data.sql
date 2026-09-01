-- Datos ficticios para validar el flujo docente antes de cargar padrones oficiales.
-- Profesor de prueba: adrian.delgado.torres@una.cr / cedula 999999999.

do $$
declare
  test_teacher public.profiles;
  current_cycle_id uuid;
  test_room_id bigint;
  student_record record;
begin
  select * into test_teacher
  from public.profiles
  where lower(email) = 'adrian.delgado.torres@una.cr'
  limit 1;

  if not found then
    raise notice 'No existe la cuenta adrian.delgado.torres@una.cr; se omite el curso docente de prueba';
    return;
  end if;

  update public.profiles
  set national_id = '999999999'
  where id = test_teacher.id;

  update public.teacher_registry
  set national_id = '999999999'
  where lower(email) = 'adrian.delgado.torres@una.cr';

  select id into current_cycle_id
  from public.reservation_cycles
  where is_current = true
  limit 1;

  select id into test_room_id
  from public.classrooms
  where active = true
  order by sort_order, id
  limit 1;

  if current_cycle_id is null or test_room_id is null then
    raise notice 'No existe ciclo o aula activa; se omite el curso docente de prueba';
    return;
  end if;

  if not exists (
    select 1 from public.fixed_occupancies
    where cycle_id = current_cycle_id and nrc = 'TEST-001'
  ) then
    insert into public.fixed_occupancies (
      cycle_id, classroom_id, day_of_week, start_time, end_time, label,
      professor_name, course_code, course_name, nrc, group_code
    ) values (
      current_cycle_id, test_room_id, 6, time '19:30', time '20:30',
      'EQPTEST · CURSO DE PRUEBA — PRÉSTAMO DE EQUIPOS',
      test_teacher.full_name, 'EQPTEST', 'CURSO DE PRUEBA — PRÉSTAMO DE EQUIPOS', 'TEST-001', '01'
    );
  end if;

  insert into public.academic_students (national_id, full_name, email, career)
  values
    ('900000001', 'Ana Prueba Rodríguez', 'ana.prueba@example.com', 'Ingeniería en Ciencias Forestales'),
    ('900000002', 'Bruno Prueba Vargas', 'bruno.prueba@example.com', 'Ingeniería en Gestión Ambiental'),
    ('900000003', 'Carla Prueba Jiménez', 'carla.prueba@example.com', 'Ingeniería en Ciencias Forestales'),
    ('900000004', 'Diego Prueba Solís', 'diego.prueba@example.com', 'Ingeniería en Gestión Ambiental'),
    ('900000005', 'Elena Prueba Mora', 'elena.prueba@example.com', 'Ingeniería en Ciencias Forestales')
  on conflict (national_id) do update
  set full_name = excluded.full_name,
      email = excluded.email,
      career = excluded.career,
      active = true;

  for student_record in
    select id from public.academic_students where national_id like '90000000%'
  loop
    insert into public.course_enrollments (
      cycle_id, student_id, course_code, course_name, nrc, group_code
    ) values (
      current_cycle_id, student_record.id, 'EQPTEST',
      'CURSO DE PRUEBA — PRÉSTAMO DE EQUIPOS', 'TEST-001', '01'
    ) on conflict (cycle_id, student_id, nrc) do update
      set course_code = excluded.course_code,
          course_name = excluded.course_name,
          group_code = excluded.group_code;
  end loop;
end;
$$;
