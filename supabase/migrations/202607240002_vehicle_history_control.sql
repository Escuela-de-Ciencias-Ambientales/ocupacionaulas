-- Historial operativo de giras y edición controlada por el profesor responsable.

alter table public.vehicle_reservations
  add column if not exists trip_sheet_number text,
  add column if not exists departure_mileage integer,
  add column if not exists arrival_mileage integer,
  add column if not exists fuel_level text,
  add column if not exists vehicle_condition text,
  add column if not exists vehicle_condition_detail text,
  add column if not exists irregularity_notes text,
  add column if not exists trip_control_updated_at timestamptz,
  add column if not exists trip_control_updated_by uuid references public.profiles(id) on delete set null;

alter table public.vehicle_reservations
  drop constraint if exists vehicle_reservations_trip_sheet_number_check,
  drop constraint if exists vehicle_reservations_departure_mileage_check,
  drop constraint if exists vehicle_reservations_arrival_mileage_check,
  drop constraint if exists vehicle_reservations_mileage_order_check,
  drop constraint if exists vehicle_reservations_fuel_level_check,
  drop constraint if exists vehicle_reservations_condition_check,
  drop constraint if exists vehicle_reservations_condition_detail_check,
  drop constraint if exists vehicle_reservations_irregularity_notes_check;

alter table public.vehicle_reservations
  add constraint vehicle_reservations_trip_sheet_number_check
    check (trip_sheet_number is null or char_length(trim(trip_sheet_number)) between 1 and 60),
  add constraint vehicle_reservations_departure_mileage_check
    check (departure_mileage is null or departure_mileage >= 0),
  add constraint vehicle_reservations_arrival_mileage_check
    check (arrival_mileage is null or arrival_mileage >= 0),
  add constraint vehicle_reservations_mileage_order_check
    check (departure_mileage is null or arrival_mileage is null or arrival_mileage >= departure_mileage),
  add constraint vehicle_reservations_fuel_level_check
    check (fuel_level is null or fuel_level in ('quarter', 'half', 'three_quarters', 'full')),
  add constraint vehicle_reservations_condition_check
    check (vehicle_condition is null or vehicle_condition in ('clean', 'dirty', 'other')),
  add constraint vehicle_reservations_condition_detail_check
    check (
      (vehicle_condition <> 'other' or vehicle_condition is null)
      or char_length(trim(vehicle_condition_detail)) between 3 and 500
    ),
  add constraint vehicle_reservations_irregularity_notes_check
    check (irregularity_notes is null or char_length(trim(irregularity_notes)) <= 1000);

create or replace function public.protect_vehicle_reservation()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  profile_name text;
  profile_unit text;
  active_cycle public.reservation_cycles;
  start_local date;
  end_local date;
  new_week_start date;
  new_week_end date;
  is_photo_attach boolean := coalesce(current_setting('app.vehicle_photo_attach', true), '') = '1';
  is_photo_exemption boolean := coalesce(current_setting('app.vehicle_photo_exemption', true), '') = '1';
  is_trip_update boolean := coalesce(current_setting('app.vehicle_trip_update', true), '') = '1';
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

    select full_name, unit into profile_name, profile_unit
    from public.profiles where id = new.user_id and active = true;
    if profile_name is null then
      raise exception using errcode = '22023', message = 'El responsable no tiene un perfil activo';
    end if;
    if profile_unit is null then
      raise exception using errcode = '22023', message = 'El responsable debe registrar su unidad institucional antes de reservar';
    end if;
    new.responsible_name := profile_name;
    new.unit := profile_unit;
    new.maintenance_id := null;
    new.photo_required := true;
    new.trip_photo_path := null;
    new.trip_photo_uploaded_at := null;
    new.trip_photo_exempted_at := null;
    new.trip_photo_exempted_by := null;
    new.trip_photo_exemption_reason := null;

    if not public.is_admin() then
      new.policy_override := false;
      new.override_reason := null;
    elsif new.policy_override then
      new.override_reason := nullif(trim(new.override_reason), '');
      if new.override_reason is null or char_length(new.override_reason) < 5 then
        raise exception using errcode = '22023', message = 'Indica la justificación de la excepción administrativa';
      end if;
    else
      new.override_reason := null;
    end if;

    if exists (
      select 1 from public.vehicle_reservations r
      where r.user_id = new.user_id
        and r.status = 'confirmed'
        and r.photo_required
        and r.ends_at <= now()
        and r.trip_photo_path is null
        and r.trip_photo_exempted_at is null
    ) then
      raise exception using errcode = '22023', message = 'Debes cargar la fotografía de bitácora de tu última gira antes de realizar otra reserva';
    end if;

    start_local := (new.starts_at at time zone 'America/Costa_Rica')::date;
    end_local := ((new.ends_at - interval '1 second') at time zone 'America/Costa_Rica')::date;
    new_week_start := date_trunc('week', start_local::timestamp)::date;
    new_week_end := date_trunc('week', end_local::timestamp)::date + 7;

    if not new.policy_override then
      if (
        select count(*) from public.vehicle_reservations r
        where r.user_id = new.user_id
          and r.status in ('pending_approval', 'confirmed')
          and date_trunc('month', r.starts_at at time zone 'America/Costa_Rica')
            = date_trunc('month', new.starts_at at time zone 'America/Costa_Rica')
      ) >= 4 then
        raise exception using errcode = '22023', message = 'Has alcanzado el máximo de 4 giras para este mes';
      end if;

      if (
        select count(*) from public.vehicle_reservations r
        where r.user_id = new.user_id
          and r.status in ('pending_approval', 'confirmed')
          and r.ends_at > now()
      ) >= 2 then
        raise exception using errcode = '22023', message = 'Solo puedes mantener 2 reservas futuras simultáneas';
      end if;

      if exists (
        select 1 from public.vehicle_reservations r
        where r.user_id = new.user_id
          and r.vehicle_id <> new.vehicle_id
          and r.status in ('pending_approval', 'confirmed')
          and date_trunc('week', (r.starts_at at time zone 'America/Costa_Rica'))::date < new_week_end
          and date_trunc('week', ((r.ends_at - interval '1 second') at time zone 'America/Costa_Rica'))::date + 7 > new_week_start
      ) then
        raise exception using errcode = '22023', message = 'Un mismo responsable no puede reservar ambos vehículos en una misma semana';
      end if;

      if new.unit = 'LAA' and exists (
        select 1 from public.vehicle_reservations r
        where r.unit = 'LAA'
          and r.status in ('pending_approval', 'confirmed')
          and date_trunc('week', (r.starts_at at time zone 'America/Costa_Rica'))::date < new_week_end
          and date_trunc('week', ((r.ends_at - interval '1 second') at time zone 'America/Costa_Rica'))::date + 7 > new_week_start
      ) then
        raise exception using errcode = '22023', message = 'La unidad LAA solo puede mantener una reserva de vehículo por semana';
      end if;
    end if;

    if end_local - start_local + 1 > 3 and not new.policy_override then
      new.status := 'pending_approval';
      new.approval_reason := 'Gira de más de 3 días';
    else
      new.status := 'confirmed';
      new.approval_reason := null;
      if new.policy_override then
        new.approved_by := auth.uid();
        new.approved_at := now();
      end if;
    end if;

    if exists (
      select 1 from public.vehicle_maintenance m
      where m.vehicle_id = new.vehicle_id and m.active
        and tstzrange(m.starts_at, coalesce(m.ends_at, 'infinity'::timestamptz), '[)')
          && tstzrange(new.starts_at, new.ends_at, '[)')
    ) then
      raise exception using errcode = '23P01', message = 'El vehículo está en mantenimiento durante ese periodo';
    end if;
  elsif is_photo_attach then
    if old.id <> new.id
      or old.user_id <> new.user_id
      or old.vehicle_id <> new.vehicle_id
      or old.status <> new.status
      or old.starts_at <> new.starts_at
      or old.ends_at <> new.ends_at
      or old.trip_photo_path is not null
      or new.trip_photo_path is null
      or new.trip_photo_uploaded_at is null then
      raise exception using errcode = '42501', message = 'La actualización de la bitácora no es válida';
    end if;
  elsif is_photo_exemption then
    if not public.is_admin() or new.trip_photo_exempted_at is null
      or new.trip_photo_exempted_by <> auth.uid()
      or nullif(trim(new.trip_photo_exemption_reason), '') is null then
      raise exception using errcode = '42501', message = 'La exoneración de bitácora no es válida';
    end if;
  elsif is_trip_update then
    if old.id <> new.id
      or old.user_id <> new.user_id
      or old.vehicle_id <> new.vehicle_id
      or old.starts_at <> new.starts_at
      or old.ends_at <> new.ends_at
      or old.status <> new.status
      or old.maintenance_id is distinct from new.maintenance_id
      or old.policy_override <> new.policy_override
      or old.override_reason is distinct from new.override_reason
      or old.trip_photo_path is distinct from new.trip_photo_path
      or old.trip_photo_uploaded_at is distinct from new.trip_photo_uploaded_at
      or old.trip_photo_exempted_at is distinct from new.trip_photo_exempted_at then
      raise exception using errcode = '42501', message = 'La actualización del historial contiene cambios no permitidos';
    end if;
  elsif not public.is_admin() then
    if old.user_id <> auth.uid() or new.status <> 'cancelled'
      or old.status not in ('pending_approval', 'confirmed')
      or new.vehicle_id <> old.vehicle_id or new.starts_at <> old.starts_at
      or new.ends_at <> old.ends_at or new.party_size <> old.party_size
      or new.destination <> old.destination or new.objective <> old.objective
      or new.itinerary <> old.itinerary or new.observations is distinct from old.observations
      or new.additional_drivers <> old.additional_drivers
      or new.unit <> old.unit
      or new.trip_photo_path is distinct from old.trip_photo_path then
      raise exception using errcode = '42501', message = 'Solo puedes cancelar tus propias reservas';
    end if;
  end if;

  if tg_op = 'UPDATE' and not is_photo_attach and not is_photo_exemption then
    select full_name, unit into profile_name, profile_unit
    from public.profiles where id = new.user_id and active = true;
    if profile_name is null or profile_unit is null then
      raise exception using errcode = '22023', message = 'El responsable no tiene un perfil y unidad activos';
    end if;
    new.responsible_name := profile_name;
    new.unit := profile_unit;
    new.observations := nullif(trim(new.observations), '');
    new.trip_sheet_number := nullif(trim(new.trip_sheet_number), '');
    new.vehicle_condition_detail := nullif(trim(new.vehicle_condition_detail), '');
    new.irregularity_notes := nullif(trim(new.irregularity_notes), '');
  end if;
  if tg_op = 'UPDATE' and new.status = 'cancelled' and old.status is distinct from 'cancelled' then
    new.cancelled_at := now();
  end if;
  return new;
end;
$$;

create or replace function public.update_my_vehicle_trip_details(
  p_id uuid,
  p_party_size integer,
  p_destination text,
  p_objective text,
  p_itinerary text,
  p_observations text,
  p_additional_drivers text[],
  p_trip_sheet_number text,
  p_departure_mileage integer,
  p_arrival_mileage integer,
  p_fuel_level text,
  p_vehicle_condition text,
  p_vehicle_condition_detail text,
  p_irregularity_notes text
)
returns public.vehicle_reservations
language plpgsql
security definer
set search_path = public
as $$
declare
  item public.vehicle_reservations;
begin
  select * into item from public.vehicle_reservations where id = p_id for update;
  if not found then raise exception using errcode = '22023', message = 'La gira no existe'; end if;
  if item.user_id <> auth.uid() and not public.is_admin() then
    raise exception using errcode = '42501', message = 'No puedes editar la gira de otra persona';
  end if;
  if item.status not in ('pending_approval', 'confirmed', 'suspended_maintenance') then
    raise exception using errcode = '22023', message = 'Esta gira ya no admite modificaciones';
  end if;
  if p_party_size is null or p_party_size < 1 or p_party_size > 60 then
    raise exception using errcode = '22023', message = 'La cantidad de personas debe estar entre 1 y 60';
  end if;
  if char_length(trim(coalesce(p_destination, ''))) < 2
    or char_length(trim(coalesce(p_objective, ''))) < 3
    or char_length(trim(coalesce(p_itinerary, ''))) < 3 then
    raise exception using errcode = '22023', message = 'Completa destino, objetivo e itinerario';
  end if;
  if cardinality(coalesce(p_additional_drivers, '{}')) > 2 then
    raise exception using errcode = '22023', message = 'Solo se permiten dos choferes adicionales';
  end if;
  if p_arrival_mileage is not null and p_departure_mileage is not null
    and p_arrival_mileage < p_departure_mileage then
    raise exception using errcode = '22023', message = 'El kilometraje de llegada no puede ser menor que el de salida';
  end if;
  if p_vehicle_condition = 'other'
    and char_length(trim(coalesce(p_vehicle_condition_detail, ''))) < 3 then
    raise exception using errcode = '22023', message = 'Detalla el estado del vehículo';
  end if;

  perform set_config('app.vehicle_trip_update', '1', true);
  update public.vehicle_reservations
  set party_size = p_party_size,
      destination = trim(p_destination),
      objective = trim(p_objective),
      itinerary = trim(p_itinerary),
      observations = nullif(trim(p_observations), ''),
      additional_drivers = coalesce(p_additional_drivers, '{}'),
      trip_sheet_number = nullif(trim(p_trip_sheet_number), ''),
      departure_mileage = p_departure_mileage,
      arrival_mileage = p_arrival_mileage,
      fuel_level = p_fuel_level,
      vehicle_condition = p_vehicle_condition,
      vehicle_condition_detail = nullif(trim(p_vehicle_condition_detail), ''),
      irregularity_notes = nullif(trim(p_irregularity_notes), ''),
      trip_control_updated_at = now(),
      trip_control_updated_by = auth.uid()
  where id = p_id
  returning * into item;
  return item;
end;
$$;

grant execute on function public.update_my_vehicle_trip_details(
  uuid, integer, text, text, text, text, text[], text, integer, integer,
  text, text, text, text
) to authenticated;

comment on column public.vehicle_reservations.irregularity_notes is
  'Observaciones libres sobre anomalías o irregularidades detectadas durante la gira';
