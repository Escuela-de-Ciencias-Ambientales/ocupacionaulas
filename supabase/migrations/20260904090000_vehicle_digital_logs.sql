-- Bitácora digital vinculada uno a uno con la reserva vehicular.

alter table public.vehicle_reservations
  drop constraint if exists vehicle_reservations_fuel_level_check,
  drop constraint if exists vehicle_reservations_departure_fuel_level_check,
  drop constraint if exists vehicle_reservations_arrival_fuel_level_check;

alter table public.vehicle_reservations
  add constraint vehicle_reservations_fuel_level_check
    check (fuel_level is null or fuel_level in ('reserve','quarter','half','three_quarters','full')),
  add constraint vehicle_reservations_departure_fuel_level_check
    check (departure_fuel_level is null or departure_fuel_level in ('reserve','quarter','half','three_quarters','full')),
  add constraint vehicle_reservations_arrival_fuel_level_check
    check (arrival_fuel_level is null or arrival_fuel_level in ('reserve','quarter','half','three_quarters','full'));

create table if not exists public.vehicle_trip_logs (
  id uuid primary key default gen_random_uuid(),
  reservation_id uuid not null unique references public.vehicle_reservations(id) on delete restrict,
  filled_by uuid not null references public.profiles(id) on delete restrict,
  driver_name text not null check (char_length(trim(driver_name)) between 3 and 100),
  vehicle_plate text not null check (char_length(trim(vehicle_plate)) between 3 and 30),
  trip_sheet_number text not null check (char_length(trim(trip_sheet_number)) between 1 and 60),
  departure_mileage integer not null check (departure_mileage >= 0),
  arrival_mileage integer not null check (arrival_mileage >= departure_mileage),
  departure_fuel_level text not null check (departure_fuel_level in ('reserve','quarter','half','three_quarters','full')),
  arrival_fuel_level text not null check (arrival_fuel_level in ('reserve','quarter','half','three_quarters','full')),
  vehicle_clean_out boolean not null,
  oils_checked boolean not null,
  coolant_checked boolean not null,
  oil_change_checked boolean not null,
  tools_checked boolean not null,
  safety_kit_checked boolean not null,
  documents_checked boolean not null,
  outbound_damage boolean not null,
  vehicle_clean_return boolean not null,
  new_damage boolean not null,
  departure_notes text not null check (char_length(trim(departure_notes)) between 2 and 1000),
  return_notes text not null check (char_length(trim(return_notes)) between 2 and 1000),
  departure_photo_path text not null check (char_length(trim(departure_photo_path)) between 10 and 500),
  return_photo_path text not null check (char_length(trim(return_photo_path)) between 10 and 500),
  signature_data text not null check (
    signature_data like 'data:image/png;base64,%'
    and char_length(signature_data) between 100 and 300000
  ),
  review_status text not null default 'pending' check (review_status in ('pending','reviewed','needs_attention')),
  review_notes text check (review_notes is null or char_length(trim(review_notes)) <= 1000),
  reviewed_by uuid references public.profiles(id) on delete set null,
  reviewed_at timestamptz,
  submitted_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (review_status in ('pending','needs_attention') or (reviewed_by is not null and reviewed_at is not null))
);

create index if not exists vehicle_trip_logs_submitted_at_idx on public.vehicle_trip_logs(submitted_at desc);
create index if not exists vehicle_trip_logs_filled_by_idx on public.vehicle_trip_logs(filled_by, submitted_at desc);
create index if not exists vehicle_trip_logs_review_status_idx on public.vehicle_trip_logs(review_status, submitted_at desc);

alter table public.vehicle_trip_logs enable row level security;

revoke all on table public.vehicle_trip_logs from anon, authenticated;
grant select on table public.vehicle_trip_logs to authenticated;

drop policy if exists "Responsable consulta su bitacora vehicular" on public.vehicle_trip_logs;
create policy "Responsable consulta su bitacora vehicular"
on public.vehicle_trip_logs for select to authenticated
using (filled_by = (select auth.uid()) or public.is_admin());

create or replace function public.submit_vehicle_trip_log(
  p_reservation_id uuid,
  p_trip_sheet_number text,
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
  reservation_record public.vehicle_reservations;
  vehicle_record public.vehicles;
  profile_record public.profiles;
  result public.vehicle_trip_logs;
  allowed_fuels constant text[] := array['reserve','quarter','half','three_quarters','full'];
begin
  if auth.uid() is null then
    raise exception using errcode = '42501', message = 'Debes iniciar sesión';
  end if;

  select * into reservation_record
  from public.vehicle_reservations
  where id = p_reservation_id
  for update;
  if not found then raise exception using errcode = '22023', message = 'La reserva vehicular no existe'; end if;
  if reservation_record.user_id <> auth.uid() then
    raise exception using errcode = '42501', message = 'Solo el responsable de la reserva puede completar esta bitácora';
  end if;
  if reservation_record.status <> 'confirmed' then
    raise exception using errcode = '22023', message = 'Solo las reservas confirmadas admiten bitácora';
  end if;
  if reservation_record.starts_at > now() then
    raise exception using errcode = '22023', message = 'La bitácora se habilita al iniciar la gira';
  end if;

  select * into vehicle_record from public.vehicles where id = reservation_record.vehicle_id and active;
  select * into profile_record from public.profiles where id = auth.uid() and active;
  if vehicle_record.id is null or profile_record.id is null then
    raise exception using errcode = '22023', message = 'La persona o el vehículo no están activos';
  end if;

  if nullif(trim(coalesce(p_trip_sheet_number,'')), '') is null
    or p_departure_mileage is null or p_arrival_mileage is null
    or p_departure_fuel_level is null or p_arrival_fuel_level is null
    or p_vehicle_clean_out is null or p_oils_checked is null or p_coolant_checked is null
    or p_oil_change_checked is null or p_tools_checked is null or p_safety_kit_checked is null
    or p_documents_checked is null or p_outbound_damage is null
    or p_vehicle_clean_return is null or p_new_damage is null
    or char_length(trim(coalesce(p_departure_notes,''))) < 2
    or char_length(trim(coalesce(p_return_notes,''))) < 2 then
    raise exception using errcode = '22023', message = 'Complete todos los campos obligatorios de la bitácora';
  end if;
  if p_arrival_mileage < p_departure_mileage then
    raise exception using errcode = '22023', message = 'El kilometraje final no puede ser menor al inicial';
  end if;
  if not (p_departure_fuel_level = any(allowed_fuels)) or not (p_arrival_fuel_level = any(allowed_fuels)) then
    raise exception using errcode = '22023', message = 'Seleccione niveles de combustible válidos';
  end if;
  if p_signature_data not like 'data:image/png;base64,%' or char_length(p_signature_data) not between 100 and 300000 then
    raise exception using errcode = '22023', message = 'Registre la firma del conductor';
  end if;
  if split_part(p_departure_photo_path,'/',1) <> auth.uid()::text
    or split_part(p_departure_photo_path,'/',2) <> reservation_record.id::text
    or split_part(p_return_photo_path,'/',1) <> auth.uid()::text
    or split_part(p_return_photo_path,'/',2) <> reservation_record.id::text
    or p_departure_photo_path = p_return_photo_path then
    raise exception using errcode = '22023', message = 'Las fotografías no corresponden a esta reserva';
  end if;
  if not exists (select 1 from storage.objects where bucket_id='vehicle-trip-photos' and name=p_departure_photo_path and owner_id=auth.uid()::text)
    or not exists (select 1 from storage.objects where bucket_id='vehicle-trip-photos' and name=p_return_photo_path and owner_id=auth.uid()::text) then
    raise exception using errcode = '22023', message = 'No se encontraron las dos fotografías requeridas';
  end if;

  insert into public.vehicle_trip_logs (
    reservation_id, filled_by, driver_name, vehicle_plate, trip_sheet_number,
    departure_mileage, arrival_mileage, departure_fuel_level, arrival_fuel_level,
    vehicle_clean_out, oils_checked, coolant_checked, oil_change_checked,
    tools_checked, safety_kit_checked, documents_checked, outbound_damage,
    vehicle_clean_return, new_damage, departure_notes, return_notes,
    departure_photo_path, return_photo_path, signature_data, review_status
  ) values (
    reservation_record.id, auth.uid(), coalesce(nullif(trim(reservation_record.driver_name),''), profile_record.full_name), vehicle_record.plate, trim(p_trip_sheet_number),
    p_departure_mileage, p_arrival_mileage, p_departure_fuel_level, p_arrival_fuel_level,
    p_vehicle_clean_out, p_oils_checked, p_coolant_checked, p_oil_change_checked,
    p_tools_checked, p_safety_kit_checked, p_documents_checked, p_outbound_damage,
    p_vehicle_clean_return, p_new_damage, trim(p_departure_notes), trim(p_return_notes),
    p_departure_photo_path, p_return_photo_path, p_signature_data,
    case when p_new_damage then 'needs_attention' else 'pending' end
  )
  on conflict (reservation_id) do update set
    filled_by=excluded.filled_by, driver_name=excluded.driver_name, vehicle_plate=excluded.vehicle_plate,
    trip_sheet_number=excluded.trip_sheet_number, departure_mileage=excluded.departure_mileage,
    arrival_mileage=excluded.arrival_mileage, departure_fuel_level=excluded.departure_fuel_level,
    arrival_fuel_level=excluded.arrival_fuel_level, vehicle_clean_out=excluded.vehicle_clean_out,
    oils_checked=excluded.oils_checked, coolant_checked=excluded.coolant_checked,
    oil_change_checked=excluded.oil_change_checked, tools_checked=excluded.tools_checked,
    safety_kit_checked=excluded.safety_kit_checked, documents_checked=excluded.documents_checked,
    outbound_damage=excluded.outbound_damage, vehicle_clean_return=excluded.vehicle_clean_return,
    new_damage=excluded.new_damage, departure_notes=excluded.departure_notes,
    return_notes=excluded.return_notes, departure_photo_path=excluded.departure_photo_path,
    return_photo_path=excluded.return_photo_path, signature_data=excluded.signature_data,
    review_status=case when excluded.new_damage then 'needs_attention' else 'pending' end,
    review_notes=null, reviewed_by=null, reviewed_at=null, submitted_at=now(), updated_at=now()
  returning * into result;

  perform set_config('app.vehicle_trip_update','1',true);
  perform set_config('app.vehicle_photo_attach','1',true);
  update public.vehicle_reservations set
    trip_sheet_number=result.trip_sheet_number,
    departure_mileage=result.departure_mileage,
    arrival_mileage=result.arrival_mileage,
    departure_fuel_level=result.departure_fuel_level,
    arrival_fuel_level=result.arrival_fuel_level,
    fuel_level=result.arrival_fuel_level,
    vehicle_condition=case when result.vehicle_clean_return then 'clean' else 'dirty' end,
    irregularity_notes=result.return_notes,
    trip_photo_path=result.return_photo_path,
    trip_photo_uploaded_at=now(),
    trip_control_updated_at=now(),
    trip_control_updated_by=auth.uid()
  where id=reservation_record.id;

  return result;
end;
$$;

revoke all on function public.submit_vehicle_trip_log(uuid,text,integer,integer,text,text,boolean,boolean,boolean,boolean,boolean,boolean,boolean,boolean,boolean,boolean,text,text,text,text,text) from public, anon;
grant execute on function public.submit_vehicle_trip_log(uuid,text,integer,integer,text,text,boolean,boolean,boolean,boolean,boolean,boolean,boolean,boolean,boolean,boolean,text,text,text,text,text) to authenticated;

create or replace function public.admin_review_vehicle_trip_log(p_log_id uuid,p_review_status text,p_review_notes text default null)
returns public.vehicle_trip_logs
language plpgsql
security definer
set search_path = public
as $$
declare result public.vehicle_trip_logs;
begin
  if not public.is_admin() then
    raise exception using errcode='42501',message='Se requiere acceso de asistente administrativa o superadministración';
  end if;
  if p_review_status not in ('pending','reviewed','needs_attention') then
    raise exception using errcode='22023',message='Estado de revisión no válido';
  end if;
  update public.vehicle_trip_logs set
    review_status=p_review_status,
    review_notes=nullif(trim(coalesce(p_review_notes,'')),''),
    reviewed_by=case when p_review_status='pending' then null else auth.uid() end,
    reviewed_at=case when p_review_status='pending' then null else now() end,
    updated_at=now()
  where id=p_log_id returning * into result;
  if not found then raise exception using errcode='22023',message='Bitácora no encontrada'; end if;
  return result;
end;
$$;

revoke all on function public.admin_review_vehicle_trip_log(uuid,text,text) from public, anon;
grant execute on function public.admin_review_vehicle_trip_log(uuid,text,text) to authenticated;

drop policy if exists "Responsables eliminan cargas no vinculadas" on storage.objects;
create policy "Responsables eliminan cargas no vinculadas"
on storage.objects for delete to authenticated
using (
  bucket_id='vehicle-trip-photos'
  and (storage.foldername(name))[1]=(select auth.uid())::text
  and not exists (select 1 from public.vehicle_reservations r where r.trip_photo_path=storage.objects.name)
  and not exists (select 1 from public.vehicle_trip_logs l where l.departure_photo_path=storage.objects.name or l.return_photo_path=storage.objects.name)
);

comment on table public.vehicle_trip_logs is 'Bitácoras digitales completas, vinculadas uno a uno con las reservas vehiculares';
