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
      and admin_scope in ('superadmin', 'operations', 'reservations', 'conserjeria')
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
