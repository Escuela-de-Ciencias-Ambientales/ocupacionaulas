create index limpieza_programacion_created_by_idx
  on public.limpieza_programacion (created_by)
  where created_by is not null;
