-- Índices para las relaciones usadas al listar y proteger el inventario.
create index if not exists equipment_units_catalog_id_idx
  on public.equipment_units (catalog_id);

create index if not exists loan_request_unit_assignments_equipment_unit_id_idx
  on public.loan_request_unit_assignments (equipment_unit_id);

create index if not exists equipment_unit_deletion_audit_deleted_by_idx
  on public.equipment_unit_deletion_audit (deleted_by);
