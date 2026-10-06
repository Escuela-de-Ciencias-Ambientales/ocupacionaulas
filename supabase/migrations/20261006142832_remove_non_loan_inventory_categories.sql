-- Retiro definitivo solicitado para bienes que no forman parte del inventario
-- operativo de préstamos. La migración aborta si encuentra trazabilidad.
do $$
declare
  target_ids bigint[] := array[99,119,121,130,131,132,133,134,137,138,139,140,141,142,143,146,147,148];
  actor uuid;
  unit_count integer;
  deleted_units integer;
  deleted_categories integer;
begin
  select id into actor
  from public.profiles
  where active and role='admin' and admin_scope='superadmin'
  order by created_at
  limit 1;

  if actor is null then
    raise exception 'No existe un superadministrador activo para registrar la auditoría';
  end if;

  select count(*) into unit_count
  from public.equipment_units
  where catalog_id=any(target_ids);

  if unit_count<>78 then
    raise exception 'La conciliación esperaba 78 unidades y encontró %; no se modificó el inventario',unit_count;
  end if;

  if exists (
    select 1
    from public.loan_request_unit_assignments a
    join public.equipment_units u on u.id=a.equipment_unit_id
    where u.catalog_id=any(target_ids)
  ) then
    raise exception 'Hay unidades con historial de préstamos; no se modificó el inventario';
  end if;

  if exists (
    select 1 from public.student_loan_request_items
    where equipment_catalog_id=any(target_ids)
  ) or exists (
    select 1 from public.equipment_direction_authorizations
    where catalog_id=any(target_ids)
  ) then
    raise exception 'Hay solicitudes o autorizaciones vinculadas; no se modificó el inventario';
  end if;

  insert into public.equipment_unit_deletion_audit(
    equipment_unit_id,unit_snapshot,reason,deleted_by
  )
  select id,to_jsonb(u),'Eliminación masiva de categorías fuera del inventario de préstamos',actor
  from public.equipment_units u
  where catalog_id=any(target_ids);

  delete from public.equipment_units where catalog_id=any(target_ids);
  get diagnostics deleted_units=row_count;
  if deleted_units<>78 then
    raise exception 'Se esperaban eliminar 78 unidades y se eliminaron %',deleted_units;
  end if;

  delete from public.equipment_catalog where id=any(target_ids);
  get diagnostics deleted_categories=row_count;
  if deleted_categories<>18 then
    raise exception 'Se esperaban eliminar 18 categorías y se eliminaron %',deleted_categories;
  end if;
end;
$$;
