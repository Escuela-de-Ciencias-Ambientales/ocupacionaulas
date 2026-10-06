-- Inventory integrity, auditable permanent deletion and category normalization.

create unique index if not exists equipment_units_code_normalized_uidx
on public.equipment_units (lower(btrim(consecutive_code)))
where nullif(btrim(consecutive_code),'') is not null;

create unique index if not exists equipment_units_asset_normalized_uidx
on public.equipment_units (lower(btrim(asset_number)))
where nullif(btrim(asset_number),'') is not null;

create unique index if not exists equipment_units_serial_normalized_uidx
on public.equipment_units (lower(btrim(serial_number)))
where nullif(btrim(serial_number),'') is not null;

create table public.equipment_unit_deletion_audit (
  id bigint generated always as identity primary key,
  equipment_unit_id bigint not null,
  unit_snapshot jsonb not null,
  reason text not null,
  deleted_by uuid not null references public.profiles(id),
  deleted_at timestamptz not null default now()
);

alter table public.equipment_unit_deletion_audit enable row level security;
revoke all on public.equipment_unit_deletion_audit from public, anon, authenticated;

create or replace function public.warehouse_delete_equipment_unit(p_id bigint, p_reason text)
returns jsonb
language plpgsql
security definer
set search_path=''
as $$
declare
  target public.equipment_units;
  snapshot jsonb;
begin
  if not public.is_superadmin() then
    raise exception using errcode='42501', message='Solo el superadministrador puede eliminar equipos permanentemente';
  end if;
  if length(btrim(coalesce(p_reason,''))) < 5 then
    raise exception using errcode='22023', message='Indique un motivo de al menos 5 caracteres';
  end if;
  select * into target from public.equipment_units where id=p_id for update;
  if not found then raise exception using errcode='P0002', message='El equipo no existe'; end if;
  if exists(select 1 from public.loan_request_unit_assignments where equipment_unit_id=p_id) then
    raise exception using errcode='23503', message='El equipo tiene historial de préstamos y no puede eliminarse. Márquelo como retirado e inactivo.';
  end if;
  snapshot=to_jsonb(target);
  insert into public.equipment_unit_deletion_audit(equipment_unit_id,unit_snapshot,reason,deleted_by)
  values(p_id,snapshot,btrim(p_reason),auth.uid());
  delete from public.equipment_units where id=p_id;
  return snapshot;
end;
$$;

revoke all on function public.warehouse_delete_equipment_unit(bigint,text) from public, anon, authenticated;
grant execute on function public.warehouse_delete_equipment_unit(bigint,text) to authenticated;

-- The AMSCOPE and OPTO-EDU records are microscope cameras. Other camera
-- categories (video, photographic and webcam) remain separate.
update public.equipment_catalog set name='Cámaras microscópicas' where id=96;
update public.equipment_units set catalog_id=96 where catalog_id=103;
update public.student_loan_request_items set equipment_catalog_id=96 where equipment_catalog_id=103;
delete from public.equipment_catalog where id=103;
