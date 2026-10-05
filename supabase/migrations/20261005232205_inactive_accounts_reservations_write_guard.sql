create policy "Cuenta activa para crear" on public.reservations as restrictive for insert to authenticated with check (exists(select 1 from public.profiles where id=auth.uid() and active));
create policy "Cuenta activa para modificar" on public.reservations as restrictive for update to authenticated using (exists(select 1 from public.profiles where id=auth.uid() and active)) with check (exists(select 1 from public.profiles where id=auth.uid() and active));
create policy "Cuenta activa para crear" on public.vehicle_reservations as restrictive for insert to authenticated with check (exists(select 1 from public.profiles where id=auth.uid() and active));
create policy "Cuenta activa para modificar" on public.vehicle_reservations as restrictive for update to authenticated using (exists(select 1 from public.profiles where id=auth.uid() and active)) with check (exists(select 1 from public.profiles where id=auth.uid() and active));
CREATE OR REPLACE FUNCTION public.submit_vehicle_trip_log(p_driver_id_number text, p_vehicle_id bigint, p_trip_sheet_number text, p_departure_at timestamp with time zone, p_arrival_at timestamp with time zone, p_destination text, p_departure_mileage integer, p_arrival_mileage integer, p_departure_fuel_level text, p_arrival_fuel_level text, p_vehicle_clean_out boolean, p_oils_checked boolean, p_coolant_checked boolean, p_oil_change_checked boolean, p_tools_checked boolean, p_safety_kit_checked boolean, p_documents_checked boolean, p_outbound_damage boolean, p_vehicle_clean_return boolean, p_new_damage boolean, p_departure_notes text, p_return_notes text, p_departure_photo_path text, p_return_photo_path text, p_signature_data text)
 RETURNS vehicle_trip_logs
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'storage'
AS $function$
declare
  clean_id text := regexp_replace(coalesce(p_driver_id_number,''),'[^0-9]','','g');
  person public.profiles;
  selected_vehicle public.vehicles;
  result public.vehicle_trip_logs;
  complete boolean;
  allowed_fuels constant text[] := array['reserve','quarter','half','three_quarters','full'];
begin
 if not exists(select 1 from public.profiles where id=auth.uid() and active) then raise exception using errcode='42501',message='Se requiere una cuenta activa';end if;

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
$function$
;

