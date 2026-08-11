create or replace function public.admin_update_vehicle_reservation_processing(
  p_id uuid,
  p_processing_status text,
  p_processing_notes text default null
)
returns public.vehicle_reservations
language plpgsql
security definer
set search_path = public
as $$
declare item public.vehicle_reservations;
begin
  if not public.is_vehicle_processor() then
    raise exception using errcode = '42501', message = 'Se requiere acceso administrativo de vehículos';
  end if;
  if p_processing_status not in ('pending', 'needs_info', 'processed', 'rejected') then
    raise exception using errcode = '22023', message = 'Estado de trámite no válido';
  end if;

  update public.vehicle_reservations
  set status = case when p_processing_status = 'rejected' then 'rejected' else status end,
      processing_status = p_processing_status,
      processing_notes = nullif(trim(coalesce(p_processing_notes, '')), ''),
      processing_updated_by = auth.uid(),
      processing_updated_at = now(),
      processed_by = case when p_processing_status in ('processed', 'rejected') then auth.uid() else null end,
      processed_at = case when p_processing_status in ('processed', 'rejected') then now() else null end
  where id = p_id
  returning * into item;

  if not found then
    raise exception using errcode = '22023', message = 'Reserva no encontrada';
  end if;

  return item;
end;
$$;

revoke all on function public.admin_update_vehicle_reservation_processing(uuid, text, text) from public;
grant execute on function public.admin_update_vehicle_reservation_processing(uuid, text, text) to authenticated;
