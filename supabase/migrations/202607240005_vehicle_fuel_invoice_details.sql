-- Datos opcionales de abastecimiento y factura para el control posterior de la gira.

alter table public.vehicle_reservations
  add column if not exists fueling_mileage integer,
  add column if not exists service_station_location text,
  add column if not exists fuel_liters numeric(8,2),
  add column if not exists fuel_type text,
  add column if not exists invoice_amount numeric(12,2),
  add column if not exists invoice_date date,
  add column if not exists invoice_number text,
  add column if not exists voucher_authorization_number text;

alter table public.vehicle_reservations
  drop constraint if exists vehicle_reservations_condition_detail_check;

update public.vehicle_reservations
set irregularity_notes = left(
      concat_ws(
        E'\n',
        nullif(trim(irregularity_notes), ''),
        'Detalle anterior del estado: ' || trim(vehicle_condition_detail)
      ),
      1000
    ),
    vehicle_condition_detail = null
where nullif(trim(vehicle_condition_detail), '') is not null;

alter table public.vehicle_reservations
  drop constraint if exists vehicle_reservations_fueling_mileage_check,
  drop constraint if exists vehicle_reservations_service_station_check,
  drop constraint if exists vehicle_reservations_fuel_liters_check,
  drop constraint if exists vehicle_reservations_fuel_type_check,
  drop constraint if exists vehicle_reservations_invoice_amount_check,
  drop constraint if exists vehicle_reservations_invoice_number_check,
  drop constraint if exists vehicle_reservations_voucher_authorization_check;

alter table public.vehicle_reservations
  add constraint vehicle_reservations_fueling_mileage_check
    check (fueling_mileage is null or fueling_mileage >= 0),
  add constraint vehicle_reservations_service_station_check
    check (service_station_location is null or char_length(trim(service_station_location)) between 1 and 200),
  add constraint vehicle_reservations_fuel_liters_check
    check (fuel_liters is null or fuel_liters >= 0),
  add constraint vehicle_reservations_fuel_type_check
    check (fuel_type is null or fuel_type in ('diesel', 'regular', 'super', 'other')),
  add constraint vehicle_reservations_invoice_amount_check
    check (invoice_amount is null or invoice_amount >= 0),
  add constraint vehicle_reservations_invoice_number_check
    check (invoice_number is null or char_length(trim(invoice_number)) between 1 and 80),
  add constraint vehicle_reservations_voucher_authorization_check
    check (voucher_authorization_number is null or char_length(trim(voucher_authorization_number)) between 1 and 80);

drop function if exists public.update_my_vehicle_trip_details(
  uuid, integer, text, text, text, text, text[], text, integer, integer,
  text, text, text, text, text
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
  p_fueling_mileage integer,
  p_service_station_location text,
  p_fuel_liters numeric,
  p_fuel_type text,
  p_invoice_amount numeric,
  p_invoice_date date,
  p_invoice_number text,
  p_voucher_authorization_number text,
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
  if p_fueling_mileage is not null and p_fueling_mileage < 0 then
    raise exception using errcode = '22023', message = 'El kilometraje de abastecimiento no es válido';
  end if;
  if p_fuel_liters is not null and p_fuel_liters < 0 then
    raise exception using errcode = '22023', message = 'La cantidad de litros no es válida';
  end if;
  if p_fuel_type is not null and p_fuel_type not in ('diesel', 'regular', 'super', 'other') then
    raise exception using errcode = '22023', message = 'El tipo de combustible no es válido';
  end if;
  if p_invoice_amount is not null and p_invoice_amount < 0 then
    raise exception using errcode = '22023', message = 'El monto de factura no es válido';
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
      vehicle_condition_detail = null,
      fueling_mileage = p_fueling_mileage,
      service_station_location = nullif(trim(p_service_station_location), ''),
      fuel_liters = p_fuel_liters,
      fuel_type = p_fuel_type,
      invoice_amount = p_invoice_amount,
      invoice_date = p_invoice_date,
      invoice_number = nullif(trim(p_invoice_number), ''),
      voucher_authorization_number = nullif(trim(p_voucher_authorization_number), ''),
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
  text, text, text, integer, text, numeric, text, numeric, date, text, text, text
) to authenticated;

comment on column public.vehicle_reservations.fueling_mileage is 'Kilometraje al momento de abastecer combustible';
comment on column public.vehicle_reservations.service_station_location is 'Ubicación de la estación de servicio o gasolinera';
comment on column public.vehicle_reservations.fuel_liters is 'Cantidad de litros abastecidos';
comment on column public.vehicle_reservations.fuel_type is 'Tipo de combustible abastecido';
comment on column public.vehicle_reservations.invoice_amount is 'Monto de la factura de combustible';
comment on column public.vehicle_reservations.invoice_date is 'Fecha de la factura de combustible';
comment on column public.vehicle_reservations.invoice_number is 'Número de factura de combustible';
comment on column public.vehicle_reservations.voucher_authorization_number is 'Número de autorización del voucher';
