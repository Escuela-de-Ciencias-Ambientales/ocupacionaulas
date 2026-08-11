create or replace function public.is_vehicle_processor()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.profiles
    where id = auth.uid()
      and role = 'admin'
      and admin_scope in ('superadmin', 'reservations', 'conserjeria')
      and active = true
  );
$$;

revoke all on function public.is_vehicle_processor() from public;
grant execute on function public.is_vehicle_processor() to authenticated;

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
  if p_processing_status not in ('pending', 'needs_info', 'processed') then
    raise exception using errcode = '22023', message = 'Estado de trámite no válido';
  end if;

  update public.vehicle_reservations
  set processing_status = p_processing_status,
      processing_notes = nullif(trim(coalesce(p_processing_notes, '')), ''),
      processing_updated_by = auth.uid(),
      processing_updated_at = now(),
      processed_by = case when p_processing_status = 'processed' then auth.uid() else null end,
      processed_at = case when p_processing_status = 'processed' then now() else null end
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

create or replace function public.enqueue_vehicle_reservation_notifications()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare processor public.profiles;
begin
  for processor in
    select id, email
    from public.profiles
    where role = 'admin'
      and admin_scope in ('superadmin', 'reservations', 'conserjeria')
      and active = true
      and email is not null
  loop
    insert into public.vehicle_reservation_notifications
      (reservation_id, channel, recipient_user_id, recipient_email, subject, body)
    values
      (
        new.id,
        'email',
        processor.id,
        processor.email,
        'Nueva reserva vehicular por tramitar',
        'Ingresó una reserva de vehículo para ' || coalesce(new.responsible_name, 'responsable no indicado') ||
        ', salida ' || to_char(new.starts_at at time zone 'America/Costa_Rica', 'YYYY-MM-DD HH24:MI') ||
        ', destino ' || coalesce(new.destination, 'no indicado') || '.'
      );
  end loop;
  return new;
end;
$$;

revoke all on function public.enqueue_vehicle_reservation_notifications() from public;

comment on function public.is_vehicle_processor() is
  'Permite tramitar boletas vehiculares a superadmin, administración de reservas y administración de conserjería autorizada.';
