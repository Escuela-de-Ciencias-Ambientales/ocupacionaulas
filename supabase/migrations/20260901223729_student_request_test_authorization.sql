insert into public.equipment_authorizations (
  teacher_id,
  cycle_id,
  scope,
  course_code,
  course_name,
  nrc,
  group_code,
  reason
)
select
  teacher.id,
  cycle.id,
  'course',
  'EQPTEST',
  'CURSO DE PRUEBA — PRÉSTAMO DE EQUIPOS',
  'TEST-001',
  '01',
  'course_trip'
from public.profiles as teacher
cross join public.reservation_cycles as cycle
where teacher.email = 'profe.prueba.primero@una.cr'
  and cycle.is_current
  and not exists (
    select 1
    from public.equipment_authorizations as existing
    where existing.teacher_id = teacher.id
      and existing.cycle_id = cycle.id
      and existing.scope = 'course'
      and existing.nrc = 'TEST-001'
      and existing.revoked_at is null
  );
