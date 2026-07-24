create or replace function public.attach_vehicle_trip_photo(p_reservation_id uuid, p_object_path text)
returns void
language plpgsql
security definer
set search_path = public, storage
as $$
declare
  item public.vehicle_reservations;
  object_owner text;
begin
  select * into item from public.vehicle_reservations where id = p_reservation_id for update;
  if not found then raise exception using errcode = '22023', message = 'La gira no existe'; end if;
  if item.user_id <> auth.uid() and not public.is_admin() then
    raise exception using errcode = '42501', message = 'No puedes cargar la bitácora de otra persona';
  end if;
  if item.status <> 'confirmed' then
    raise exception using errcode = '22023', message = 'La fotografía solo se habilita para reservas confirmadas';
  end if;
  if not item.photo_required or item.trip_photo_exempted_at is not null then
    raise exception using errcode = '22023', message = 'Esta gira no requiere fotografía';
  end if;
  if item.trip_photo_path is not null then
    raise exception using errcode = '22023', message = 'La gira ya tiene una fotografía de bitácora';
  end if;
  if split_part(p_object_path, '/', 1) <> item.user_id::text
    or split_part(p_object_path, '/', 2) <> item.id::text then
    raise exception using errcode = '22023', message = 'La ubicación de la fotografía no es válida';
  end if;
  select owner_id into object_owner
  from storage.objects
  where bucket_id = 'vehicle-trip-photos' and name = p_object_path;
  if object_owner is null or (object_owner <> auth.uid()::text and not public.is_admin()) then
    raise exception using errcode = '22023', message = 'No se encontró una fotografía válida';
  end if;

  perform set_config('app.vehicle_photo_attach', '1', true);
  update public.vehicle_reservations
  set trip_photo_path = p_object_path, trip_photo_uploaded_at = now()
  where id = p_reservation_id;
end;
$$;

grant execute on function public.attach_vehicle_trip_photo(uuid, text) to authenticated;

comment on function public.attach_vehicle_trip_photo(uuid, text) is
  'Vincula una única fotografía privada a una reserva vehicular confirmada desde el momento de su creación.';
