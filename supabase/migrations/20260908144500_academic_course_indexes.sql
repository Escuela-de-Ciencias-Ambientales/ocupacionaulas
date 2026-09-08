create index if not exists equipment_teacher_courses_cycle_idx
  on public.equipment_teacher_courses(cycle_id);

create index if not exists equipment_authorizations_teacher_registry_idx
  on public.equipment_authorizations(teacher_registry_id, authorized_at desc);
