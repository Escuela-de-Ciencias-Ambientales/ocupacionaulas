begin;
do $$
declare
  actor uuid;
  non_admin uuid;
  catalog bigint;
  candidate bigint;
  protected_unit bigint;
  snapshot jsonb;
begin
  select id into actor from public.profiles where active and role='admin' and admin_scope='superadmin' limit 1;
  select id into non_admin from public.profiles where active and role<>'admin' limit 1;
  select id into catalog from public.equipment_catalog order by id limit 1;
  if actor is null or non_admin is null or catalog is null then raise exception 'Faltan datos de prueba existentes'; end if;

  insert into public.equipment_units(catalog_id,consecutive_code,status,active)
  values(catalog,'TEST-DELETE-INVENTORY', 'available', true) returning id into candidate;

  perform set_config('request.jwt.claim.sub',non_admin::text,true);
  begin
    perform public.warehouse_delete_equipment_unit(candidate);
    raise exception 'Usuario no autorizado pudo eliminar';
  exception when insufficient_privilege then null;
  end;

  perform set_config('request.jwt.claim.sub',actor::text,true);
  snapshot:=public.warehouse_delete_equipment_unit(candidate);
  if exists(select 1 from public.equipment_units where id=candidate) then raise exception 'La unidad no fue eliminada'; end if;
  if not exists(select 1 from public.equipment_unit_deletion_audit where equipment_unit_id=candidate and deleted_by=actor and reason='Eliminación manual desde inventario') then raise exception 'No se registró auditoría automática'; end if;
  if snapshot->>'consecutive_code'<>'TEST-DELETE-INVENTORY' then raise exception 'Instantánea incorrecta'; end if;

  select equipment_unit_id into protected_unit from public.loan_request_unit_assignments limit 1;
  if protected_unit is not null then
    begin
      perform public.warehouse_delete_equipment_unit(protected_unit);
      raise exception 'Se eliminó una unidad con historial';
    exception when foreign_key_violation then null;
    end;
  end if;

  begin
    insert into public.equipment_units(catalog_id,consecutive_code,status,active)
    select catalog_id,consecutive_code,'available',true from public.equipment_units where consecutive_code is not null limit 1;
    raise exception 'Se permitió código duplicado';
  exception when unique_violation then null;
  end;

  if has_function_privilege('anon','public.warehouse_delete_equipment_unit(bigint,text)','execute') then raise exception 'Acceso anónimo'; end if;
end $$;
rollback;
select 'Eliminación auditada, permisos, historial y duplicados: OK; cambios revertidos' as resultado;
