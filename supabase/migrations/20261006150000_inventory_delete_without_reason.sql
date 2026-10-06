-- Eliminar una unidad sin solicitar justificación al operador.
-- La bitácora conserva automáticamente la acción y la instantánea completa.
create or replace function public.warehouse_delete_equipment_unit(
  p_id bigint,
  p_reason text default null
)
returns jsonb
language plpgsql
security definer
set search_path=''
as $$
declare
  target public.equipment_units;
  snapshot jsonb;
  audit_reason text := coalesce(nullif(btrim(p_reason),''),'Eliminación manual desde inventario');
begin
  if not public.is_superadmin() then
    raise exception using errcode='42501', message='Solo el superadministrador puede eliminar equipos permanentemente';
  end if;
  select * into target from public.equipment_units where id=p_id for update;
  if not found then raise exception using errcode='P0002', message='El equipo no existe'; end if;
  if exists(select 1 from public.loan_request_unit_assignments where equipment_unit_id=p_id) then
    raise exception using errcode='23503', message='El equipo tiene historial de préstamos y no puede eliminarse. Márquelo como retirado e inactivo.';
  end if;
  snapshot=to_jsonb(target);
  insert into public.equipment_unit_deletion_audit(equipment_unit_id,unit_snapshot,reason,deleted_by)
  values(p_id,snapshot,audit_reason,auth.uid());
  delete from public.equipment_units where id=p_id;
  return snapshot;
end;
$$;

revoke all on function public.warehouse_delete_equipment_unit(bigint,text) from public, anon, authenticated;
grant execute on function public.warehouse_delete_equipment_unit(bigint,text) to authenticated;
