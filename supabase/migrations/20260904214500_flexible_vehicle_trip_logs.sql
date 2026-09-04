-- La bitácora se identifica por cédula y puede guardarse incompleta, sin reserva previa.

alter table public.vehicle_trip_logs
  alter column reservation_id drop not null,
  alter column vehicle_plate drop not null,
  alter column trip_sheet_number drop not null,
  alter column departure_mileage drop not null,
  alter column arrival_mileage drop not null,
  alter column departure_fuel_level drop not null,
  alter column arrival_fuel_level drop not null,
  alter column vehicle_clean_out drop not null,
  alter column oils_checked drop not null,
  alter column coolant_checked drop not null,
  alter column oil_change_checked drop not null,
  alter column tools_checked drop not null,
  alter column safety_kit_checked drop not null,
  alter column documents_checked drop not null,
  alter column outbound_damage drop not null,
  alter column vehicle_clean_return drop not null,
  alter column new_damage drop not null,
  alter column departure_notes drop not null,
  alter column return_notes drop not null,
  alter column departure_photo_path drop not null,
  alter column return_photo_path drop not null,
  alter column signature_data drop not null;

alter table public.vehicle_trip_logs
  add column if not exists driver_profile_id uuid references public.profiles(id) on delete restrict,
  add column if not exists driver_id_number text,
  add column if not exists vehicle_id bigint references public.vehicles(id) on delete restrict,
  add column if not exists departure_at timestamptz,
  add column if not exists arrival_at timestamptz,
  add column if not exists destination text,
  add column if not exists is_complete boolean not null default false;

alter table public.vehicle_trip_logs
  alter column driver_profile_id set not null,
  alter column driver_id_number set not null;

create index if not exists vehicle_trip_logs_driver_profile_idx on public.vehicle_trip_logs(driver_profile_id, submitted_at desc);
create index if not exists vehicle_trip_logs_vehicle_idx on public.vehicle_trip_logs(vehicle_id) where vehicle_id is not null;
create index if not exists vehicle_trip_logs_completion_idx on public.vehicle_trip_logs(is_complete, submitted_at desc);

create or replace function public.lookup_vehicle_log_driver(p_national_id text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  clean_id text := regexp_replace(coalesce(p_national_id,''),'[^0-9]','','g');
  person public.profiles;
begin
  if auth.uid() is null then
    raise exception using errcode='42501',message='Debes iniciar sesión';
  end if;
  if char_length(clean_id) not between 7 and 20 then
    raise exception using errcode='22023',message='Ingrese un número de cédula válido';
  end if;
  select * into person from public.profiles
  where active and regexp_replace(coalesce(national_id,''),'[^0-9]','','g')=clean_id
  limit 1;
  if not found then
    return jsonb_build_object('found',false);
  end if;
  return jsonb_build_object('found',true,'profile_id',person.id,'national_id',person.national_id,'full_name',person.full_name);
end;
$$;

revoke all on function public.lookup_vehicle_log_driver(text) from public, anon;
grant execute on function public.lookup_vehicle_log_driver(text) to authenticated;

drop function if exists public.submit_vehicle_trip_log(uuid,text,integer,integer,text,text,boolean,boolean,boolean,boolean,boolean,boolean,boolean,boolean,boolean,boolean,text,text,text,text,text);

create or replace function public.submit_vehicle_trip_log(
  p_driver_id_number text,
  p_vehicle_id bigint,
  p_trip_sheet_number text,
  p_departure_at timestamptz,
  p_arrival_at timestamptz,
  p_destination text,
  p_departure_mileage integer,
  p_arrival_mileage integer,
  p_departure_fuel_level text,
  p_arrival_fuel_level text,
  p_vehicle_clean_out boolean,
  p_oils_checked boolean,
  p_coolant_checked boolean,
  p_oil_change_checked boolean,
  p_tools_checked boolean,
  p_safety_kit_checked boolean,
  p_documents_checked boolean,
  p_outbound_damage boolean,
  p_vehicle_clean_return boolean,
  p_new_damage boolean,
  p_departure_notes text,
  p_return_notes text,
  p_departure_photo_path text,
  p_return_photo_path text,
  p_signature_data text
)
returns public.vehicle_trip_logs
language plpgsql
security definer
set search_path = public, storage
as $$
declare
  clean_id text := regexp_replace(coalesce(p_driver_id_number,''),'[^0-9]','','g');
  person public.profiles;
  selected_vehicle public.vehicles;
  result public.vehicle_trip_logs;
  complete boolean;
  allowed_fuels constant text[] := array['reserve','quarter','half','three_quarters','full'];
begin
  if auth.uid() is null then raise exception using errcode='42501',message='Debes iniciar sesión'; end if;
  select * into person from public.profiles
  where active and regexp_replace(coalesce(national_id,''),'[^0-9]','','g')=clean_id limit 1;
  if not found then raise exception using errcode='22023',message='No se encontró una persona activa con esa cédula'; end if;

  if p_vehicle_id is not null then
    select * into selected_vehicle from public.vehicles where id=p_vehicle_id and active;
    if not found then raise exception using errcode='22023',message='Seleccione un vehículo activo'; end if;
  end if;
  if p_departure_at is not null and p_arrival_at is not null and p_arrival_at < p_departure_at then
    raise exception using errcode='22023',message='El regreso no puede ser anterior a la salida';
  end if;
  if p_departure_mileage is not null and p_arrival_mileage is not null and p_arrival_mileage < p_departure_mileage then
    raise exception using errcode='22023',message='El kilometraje final no puede ser menor al inicial';
  end if;
  if p_departure_fuel_level is not null and not (p_departure_fuel_level=any(allowed_fuels)) then
    raise exception using errcode='22023',message='El combustible inicial no es válido';
  end if;
  if p_arrival_fuel_level is not null and not (p_arrival_fuel_level=any(allowed_fuels)) then
    raise exception using errcode='22023',message='El combustible final no es válido';
  end if;
  if p_signature_data is not null and (p_signature_data not like 'data:image/png;base64,%' or char_length(p_signature_data) not between 100 and 300000) then
    raise exception using errcode='22023',message='La firma no es válida';
  end if;

  if p_departure_photo_path is not null then
    if split_part(p_departure_photo_path,'/',1)<>auth.uid()::text or split_part(p_departure_photo_path,'/',2)<>'bitacoras'
      or not exists(select 1 from storage.objects where bucket_id='vehicle-trip-photos' and name=p_departure_photo_path and owner_id=auth.uid()::text) then
      raise exception using errcode='22023',message='La fotografía de salida no es válida';
    end if;
  end if;
  if p_return_photo_path is not null then
    if split_part(p_return_photo_path,'/',1)<>auth.uid()::text or split_part(p_return_photo_path,'/',2)<>'bitacoras'
      or not exists(select 1 from storage.objects where bucket_id='vehicle-trip-photos' and name=p_return_photo_path and owner_id=auth.uid()::text) then
      raise exception using errcode='22023',message='La fotografía de regreso no es válida';
    end if;
  end if;

  complete := p_vehicle_id is not null
    and nullif(trim(coalesce(p_trip_sheet_number,'')),'') is not null
    and p_departure_at is not null and p_arrival_at is not null
    and nullif(trim(coalesce(p_destination,'')),'') is not null
    and p_departure_mileage is not null and p_arrival_mileage is not null
    and p_departure_fuel_level is not null and p_arrival_fuel_level is not null
    and p_vehicle_clean_out is not null and p_oils_checked is not null and p_coolant_checked is not null
    and p_oil_change_checked is not null and p_tools_checked is not null and p_safety_kit_checked is not null
    and p_documents_checked is not null and p_outbound_damage is not null
    and p_vehicle_clean_return is not null and p_new_damage is not null
    and char_length(trim(coalesce(p_departure_notes,'')))>=2
    and char_length(trim(coalesce(p_return_notes,'')))>=2
    and p_departure_photo_path is not null and p_return_photo_path is not null
    and p_signature_data is not null;

  insert into public.vehicle_trip_logs(
    reservation_id,filled_by,driver_profile_id,driver_id_number,driver_name,
    vehicle_id,vehicle_plate,trip_sheet_number,departure_at,arrival_at,destination,
    departure_mileage,arrival_mileage,departure_fuel_level,arrival_fuel_level,
    vehicle_clean_out,oils_checked,coolant_checked,oil_change_checked,tools_checked,
    safety_kit_checked,documents_checked,outbound_damage,vehicle_clean_return,new_damage,
    departure_notes,return_notes,departure_photo_path,return_photo_path,signature_data,
    is_complete,review_status
  ) values (
    null,auth.uid(),person.id,person.national_id,person.full_name,
    p_vehicle_id,case when p_vehicle_id is null then null else selected_vehicle.plate end,
    nullif(trim(coalesce(p_trip_sheet_number,'')),''),p_departure_at,p_arrival_at,nullif(trim(coalesce(p_destination,'')),''),
    p_departure_mileage,p_arrival_mileage,p_departure_fuel_level,p_arrival_fuel_level,
    p_vehicle_clean_out,p_oils_checked,p_coolant_checked,p_oil_change_checked,p_tools_checked,
    p_safety_kit_checked,p_documents_checked,p_outbound_damage,p_vehicle_clean_return,p_new_damage,
    nullif(trim(coalesce(p_departure_notes,'')),''),nullif(trim(coalesce(p_return_notes,'')),''),
    p_departure_photo_path,p_return_photo_path,p_signature_data,complete,
    case when p_new_damage is true then 'needs_attention' else 'pending' end
  ) returning * into result;
  return result;
end;
$$;

revoke all on function public.submit_vehicle_trip_log(text,bigint,text,timestamptz,timestamptz,text,integer,integer,text,text,boolean,boolean,boolean,boolean,boolean,boolean,boolean,boolean,boolean,boolean,text,text,text,text,text) from public, anon;
grant execute on function public.submit_vehicle_trip_log(text,bigint,text,timestamptz,timestamptz,text,integer,integer,text,text,boolean,boolean,boolean,boolean,boolean,boolean,boolean,boolean,boolean,boolean,text,text,text,text,text) to authenticated;

comment on column public.vehicle_trip_logs.is_complete is 'Indica si todos los campos de la bitácora fueron aportados al guardar';
