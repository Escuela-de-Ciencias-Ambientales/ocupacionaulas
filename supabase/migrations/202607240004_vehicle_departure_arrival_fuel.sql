-- Registra por separado el nivel de combustible al salir y al regresar.

alter table public.vehicle_reservations
  add column if not exists departure_fuel_level text,
  add column if not exists arrival_fuel_level text;

update public.vehicle_reservations
set departure_fuel_level = fuel_level
where departure_fuel_level is null
  and fuel_level is not null;

alter table public.vehicle_reservations
  drop constraint if exists vehicle_reservations_departure_fuel_level_check,
  drop constraint if exists vehicle_reservations_arrival_fuel_level_check;

alter table public.vehicle_reservations
  add constraint vehicle_reservations_departure_fuel_level_check
    check (
      departure_fuel_level is null
      or departure_fuel_level in ('quarter', 'half', 'three_quarters', 'full')
    ),
  add constraint vehicle_reservations_arrival_fuel_level_check
    check (
      arrival_fuel_level is null
      or arrival_fuel_level in ('quarter', 'half', 'three_quarters', 'full')
    );

drop function if exists public.update_my_vehicle_trip_details(
  uuid, integer, text, text, text, text, text[], text, integer, integer,
  text, text, text, text
);

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
  p_departure_fuel_level text,
  p_arrival_fuel_level text,
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
  if p_departure_fuel_level is not null
    and p_departure_fuel_level not in ('quarter', 'half', 'three_quarters', 'full') then
    raise exception using errcode = '22023', message = 'El combustible de salida no es válido';
  end if;
  if p_arrival_fuel_level is not null
    and p_arrival_fuel_level not in ('quarter', 'half', 'three_quarters', 'full') then
    raise exception using errcode = '22023', message = 'El combustible de llegada no es válido';
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
      departure_fuel_level = p_departure_fuel_level,
      arrival_fuel_level = p_arrival_fuel_level,
      fuel_level = coalesce(p_arrival_fuel_level, p_departure_fuel_level),
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
  text, text, text, text, text
) to authenticated;

comment on column public.vehicle_reservations.departure_fuel_level is
  'Nivel de combustible registrado al salir';
comment on column public.vehicle_reservations.arrival_fuel_level is
  'Nivel de combustible registrado al regresar';
