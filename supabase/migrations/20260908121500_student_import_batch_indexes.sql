create index if not exists student_import_batches_cycle_idx
  on public.student_import_batches(cycle_id, imported_at desc);

create index if not exists student_import_batches_imported_by_idx
  on public.student_import_batches(imported_by, imported_at desc);
