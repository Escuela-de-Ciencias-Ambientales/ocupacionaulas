alter table public.vehicle_reservations
  add column if not exists party_size integer not null default 1,
  add column if not exists itinerary text not null default 'No indicado',
  add column if not exists observations text;

alter table public.vehicle_reservations
  drop constraint if exists vehicle_reservations_party_size_check,
  drop constraint if exists vehicle_reservations_itinerary_check,
  drop constraint if exists vehicle_reservations_observations_check;

alter table public.vehicle_reservations
  add constraint vehicle_reservations_party_size_check check (party_size between 1 and 60),
  add constraint vehicle_reservations_itinerary_check check (char_length(trim(itinerary)) between 3 and 600),
  add constraint vehicle_reservations_observations_check
    check (observations is null or char_length(trim(observations)) <= 600);

create or replace function public.protect_vehicle_reservation()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  profile_name text;
  active_cycle public.reservation_cycles;
begin
  if tg_op = 'INSERT' then
    select * into active_cycle from public.reservation_cycles where is_current = true;
    if not found or not active_cycle.reservations_enabled
      or now() < active_cycle.booking_opens_at or now() > active_cycle.booking_closes_at then
      raise exception using errcode = '22023', message = 'Las reservas están cerradas por la administración';
    end if;
    if new.starts_at::date < active_cycle.reservation_start_date
      or new.ends_at::date > active_cycle.reservation_end_date then
      raise exception using errcode = '22023', message = 'La fecha está fuera del periodo de reservación';
    end if;
    if new.starts_at < now() then
      raise exception using errcode = '22023', message = 'No se permiten reservas en fechas pasadas';
    end if;
    if not public.is_admin() and new.user_id <> auth.uid() then
      raise exception using errcode = '42501', message = 'No puedes reservar a nombre de otra persona';
    end if;
    select full_name into profile_name
    from public.profiles where id = new.user_id and active = true;
    if profile_name is null then
      raise exception using errcode = '22023', message = 'El responsable no tiene un perfil activo';
    end if;
    new.responsible_name := profile_name;
    new.status := 'confirmed';
    new.maintenance_id := null;
    new.observations := nullif(trim(new.observations), '');
    if exists (
      select 1 from public.vehicle_maintenance m
      where m.vehicle_id = new.vehicle_id and m.active
        and tstzrange(m.starts_at, coalesce(m.ends_at, 'infinity'::timestamptz), '[)')
          && tstzrange(new.starts_at, new.ends_at, '[)')
    ) then
      raise exception using errcode = '23P01', message = 'El vehículo está en mantenimiento durante ese periodo';
    end if;
  elsif not public.is_admin() then
    if old.user_id <> auth.uid() or new.status <> 'cancelled'
      or new.vehicle_id <> old.vehicle_id or new.starts_at <> old.starts_at
      or new.ends_at <> old.ends_at or new.party_size <> old.party_size
      or new.destination <> old.destination or new.objective <> old.objective
      or new.itinerary <> old.itinerary or new.observations is distinct from old.observations
      or new.additional_drivers <> old.additional_drivers then
      raise exception using errcode = '42501', message = 'Solo puedes cancelar tus propias reservas';
    end if;
  end if;
  if tg_op = 'UPDATE' then
    select full_name into profile_name
    from public.profiles where id = new.user_id and active = true;
    if profile_name is null then
      raise exception using errcode = '22023', message = 'El responsable no tiene un perfil activo';
    end if;
    new.responsible_name := profile_name;
    new.observations := nullif(trim(new.observations), '');
  end if;
  if tg_op = 'UPDATE' and new.status = 'cancelled' and old.status is distinct from 'cancelled' then
    new.cancelled_at := now();
  end if;
  return new;
end;
$$;
