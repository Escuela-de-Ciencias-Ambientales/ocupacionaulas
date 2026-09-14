-- El padrón maestro ya usa national_id. Eliminar la columna temporal creada
-- antes de alinear la bitácora pública con el registro institucional.

alter table public.teacher_registry
  drop constraint if exists teacher_registry_id_number_check;
drop index if exists public.teacher_registry_id_number_unique_idx;
alter table public.teacher_registry
  drop column if exists id_number;

create unique index if not exists teacher_registry_national_id_unique_idx
  on public.teacher_registry (nullif(national_id, ''))
  where nullif(national_id, '') is not null;
