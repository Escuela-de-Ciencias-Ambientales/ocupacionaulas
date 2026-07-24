-- Unidades institucionales, reglas de uso justo y bitácora fotográfica vehicular.

alter table public.profiles
  add column if not exists unit text;
alter table public.teacher_registry
  add column if not exists unit text;

alter table public.profiles
  drop constraint if exists profiles_unit_check;
alter table public.profiles
  add constraint profiles_unit_check
  check (unit is null or unit in ('Docencia', 'Administrativo', 'LAA', 'PROCAME'));

alter table public.teacher_registry
  drop constraint if exists teacher_registry_unit_check;
alter table public.teacher_registry
  add constraint teacher_registry_unit_check
  check (unit is null or unit in ('Docencia', 'Administrativo', 'LAA', 'PROCAME'));

update public.profiles
set unit = 'Administrativo'
where role = 'admin' and unit is null;

alter table public.vehicle_reservations
  add column if not exists unit text,
  add column if not exists approval_reason text,
  add column if not exists approved_by uuid references public.profiles(id) on delete set null,
  add column if not exists approved_at timestamptz,
  add column if not exists policy_override boolean not null default false,
  add column if not exists override_reason text,
  add column if not exists photo_required boolean not null default true,
  add column if not exists trip_photo_path text,
  add column if not exists trip_photo_uploaded_at timestamptz,
  add column if not exists trip_photo_exempted_at timestamptz,
  add column if not exists trip_photo_exempted_by uuid references public.profiles(id) on delete set null,
  add column if not exists trip_photo_exemption_reason text;

-- Las giras creadas antes de esta migración no generan bloqueos retroactivos.
alter table public.vehicle_reservations disable trigger vehicle_reservations_protect;
update public.vehicle_reservations
set photo_required = false
where trip_photo_path is null
  and trip_photo_uploaded_at is null
  and trip_photo_exempted_at is null;
alter table public.vehicle_reservations enable trigger vehicle_reservations_protect;

alter table public.vehicle_reservations
  alter column photo_required set default true;

alter table public.vehicle_reservations
  drop constraint if exists vehicle_reservations_unit_check,
  drop constraint if exists vehicle_reservations_status_check,
  drop constraint if exists vehicle_reservations_approval_reason_check,
  drop constraint if exists vehicle_reservations_override_reason_check,
  drop constraint if exists vehicle_reservations_photo_path_check,
  drop constraint if exists vehicle_reservations_photo_exemption_reason_check;

alter table public.vehicle_reservations
  add constraint vehicle_reservations_unit_check
    check (unit is null or unit in ('Docencia', 'Administrativo', 'LAA', 'PROCAME')),
  add constraint vehicle_reservations_status_check
    check (status in ('pending_approval', 'confirmed', 'suspended_maintenance', 'cancelled', 'rejected')),
  add constraint vehicle_reservations_approval_reason_check
    check (approval_reason is null or char_length(trim(approval_reason)) between 3 and 500),
  add constraint vehicle_reservations_override_reason_check
    check (
      (policy_override = false and override_reason is null)
      or (policy_override = true and char_length(trim(override_reason)) between 5 and 500)
    ),
  add constraint vehicle_reservations_photo_path_check
    check (trip_photo_path is null or char_length(trip_photo_path) between 10 and 500),
  add constraint vehicle_reservations_photo_exemption_reason_check
    check (
      trip_photo_exempted_at is null
      or char_length(trim(trip_photo_exemption_reason)) between 5 and 500
    );

do $$
declare
  constraint_name text;
begin
  select con.conname into constraint_name
  from pg_constraint con
  join pg_class rel on rel.oid = con.conrelid
  join pg_namespace nsp on nsp.oid = rel.relnamespace
  where nsp.nspname = 'public'
    and rel.relname = 'vehicle_reservations'
    and con.contype = 'x'
  limit 1;
  if constraint_name is not null then
    execute format('alter table public.vehicle_reservations drop constraint %I', constraint_name);
  end if;
end;
$$;

alter table public.vehicle_reservations
  add constraint vehicle_reservations_no_overlap
  exclude using gist (
    vehicle_id with =,
    tstzrange(starts_at, ends_at, '[)') with &&
  ) where (status in ('pending_approval', 'confirmed', 'suspended_maintenance'));

create index if not exists vehicle_reservations_unit_period_idx
  on public.vehicle_reservations(unit, starts_at, ends_at);
create index if not exists vehicle_reservations_photo_pending_idx
  on public.vehicle_reservations(user_id, ends_at)
  where (photo_required and trip_photo_path is null and trip_photo_exempted_at is null);

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  requested_role public.user_role;
  requested_scope text;
  requested_unit text;
begin
  requested_role := case when new.raw_user_meta_data ->> 'role' = 'admin' then 'admin'::public.user_role else 'teacher'::public.user_role end;
  requested_scope := case
    when requested_role = 'admin' and new.raw_user_meta_data ->> 'admin_scope' = 'superadmin' then 'superadmin'
    when requested_role = 'admin' then 'reservations'
    else null
  end;
  requested_unit := nullif(trim(new.raw_user_meta_data ->> 'unit'), '');
  if requested_unit is null or requested_unit not in ('Docencia', 'Administrativo', 'LAA', 'PROCAME') then
    requested_unit := case when requested_role = 'admin' then 'Administrativo' else null end;
  end if;

  insert into public.profiles (id, email, full_name, role, admin_scope, unit)
  values (
    new.id,
    coalesce(new.email, ''),
    coalesce(nullif(trim(new.raw_user_meta_data ->> 'full_name'), ''), split_part(coalesce(new.email, 'Docente'), '@', 1)),
    requested_role,
    requested_scope,
    requested_unit
  )
  on conflict (id) do update set
    email = excluded.email,
    full_name = excluded.full_name,
    role = excluded.role,
    admin_scope = excluded.admin_scope,
    unit = coalesce(excluded.unit, public.profiles.unit),
    active = true,
    updated_at = now();
  return new;
end;
$$;

create or replace function public.set_my_unit(p_unit text)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if p_unit not in ('Docencia', 'Administrativo', 'LAA', 'PROCAME') then
    raise exception using errcode = '22023', message = 'Selecciona una unidad institucional válida';
  end if;
  update public.profiles
  set unit = p_unit
  where id = auth.uid() and active and (unit is null or public.is_admin());
  if not found then
    raise exception using errcode = '42501', message = 'La unidad ya fue registrada; solicita a la administración cualquier cambio';
  end if;
end;
$$;

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
  end if;
  if tg_op = 'UPDATE' and new.status = 'cancelled' and old.status is distinct from 'cancelled' then
    new.cancelled_at := now();
  end if;
  return new;
end;
$$;

create or replace function public.admin_resolve_vehicle_reservation(
  p_id uuid, p_action text, p_vehicle_id bigint default null, p_reason text default null
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  item public.vehicle_reservations;
  reason text := nullif(trim(p_reason), '');
begin
  if not public.is_admin() then
    raise exception using errcode = '42501', message = 'Se requiere acceso administrativo';
  end if;
  select * into item from public.vehicle_reservations where id = p_id for update;
  if not found then raise exception using errcode = '22023', message = 'Reserva no encontrada'; end if;

  if p_action = 'cancel' then
    update public.vehicle_reservations set status = 'cancelled' where id = p_id;
  elsif p_action = 'reject' then
    if item.status <> 'pending_approval' or reason is null then
      raise exception using errcode = '22023', message = 'Indica el motivo para rechazar una solicitud pendiente';
    end if;
    update public.vehicle_reservations
    set status = 'rejected', approval_reason = reason, approved_by = auth.uid(), approved_at = now()
    where id = p_id;
  elsif p_action in ('approve', 'reactivate', 'reassign') then
    if p_action = 'approve' and item.status <> 'pending_approval' then
      raise exception using errcode = '22023', message = 'La reserva no está pendiente de aprobación';
    end if;
    if exists (
      select 1 from public.vehicle_maintenance m
      where m.vehicle_id = case when p_action = 'reassign' then coalesce(p_vehicle_id, item.vehicle_id) else item.vehicle_id end
        and m.active
        and tstzrange(m.starts_at, coalesce(m.ends_at, 'infinity'::timestamptz), '[)')
          && tstzrange(item.starts_at, item.ends_at, '[)')
    ) then
      raise exception using errcode = '23P01', message = 'El vehículo continúa bloqueado por mantenimiento en ese periodo';
    end if;
    update public.vehicle_reservations
    set vehicle_id = case when p_action = 'reassign' then coalesce(p_vehicle_id, vehicle_id) else vehicle_id end,
        status = 'confirmed',
        maintenance_id = null,
        approval_reason = case when p_action = 'approve' then coalesce(reason, approval_reason) else approval_reason end,
        approved_by = case when p_action = 'approve' then auth.uid() else approved_by end,
        approved_at = case when p_action = 'approve' then now() else approved_at end
    where id = p_id;
  else
    raise exception using errcode = '22023', message = 'Acción no válida';
  end if;
end;
$$;

drop function if exists public.admin_resolve_vehicle_reservation(uuid, text, bigint);

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'vehicle-trip-photos',
  'vehicle-trip-photos',
  false,
  1048576,
  array['image/jpeg', 'image/webp']
)
on conflict (id) do update set
  public = false,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists "Responsables cargan bitacora vehicular" on storage.objects;
create policy "Responsables cargan bitacora vehicular"
on storage.objects for insert to authenticated
with check (
  bucket_id = 'vehicle-trip-photos'
  and (storage.foldername(name))[1] = auth.uid()::text
);

drop policy if exists "Responsables y administracion consultan bitacora vehicular" on storage.objects;
create policy "Responsables y administracion consultan bitacora vehicular"
on storage.objects for select to authenticated
using (
  bucket_id = 'vehicle-trip-photos'
  and (
    (storage.foldername(name))[1] = auth.uid()::text
    or public.is_admin()
  )
);

drop policy if exists "Administracion elimina bitacora vehicular" on storage.objects;
create policy "Administracion elimina bitacora vehicular"
on storage.objects for delete to authenticated
using (bucket_id = 'vehicle-trip-photos' and public.is_admin());

drop policy if exists "Responsables eliminan cargas no vinculadas" on storage.objects;
create policy "Responsables eliminan cargas no vinculadas"
on storage.objects for delete to authenticated
using (
  bucket_id = 'vehicle-trip-photos'
  and (storage.foldername(name))[1] = auth.uid()::text
  and not exists (
    select 1 from public.vehicle_reservations r where r.trip_photo_path = storage.objects.name
  )
);

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
  if item.status <> 'confirmed' or item.ends_at > now() then
    raise exception using errcode = '22023', message = 'La fotografía se habilita cuando la gira haya finalizado';
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

create or replace function public.admin_exempt_vehicle_trip_photo(p_reservation_id uuid, p_reason text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  reason text := nullif(trim(p_reason), '');
begin
  if not public.is_admin() then
    raise exception using errcode = '42501', message = 'Se requiere acceso administrativo';
  end if;
  if reason is null or char_length(reason) < 5 then
    raise exception using errcode = '22023', message = 'Indica el motivo de la exoneración';
  end if;
  perform set_config('app.vehicle_photo_exemption', '1', true);
  update public.vehicle_reservations
  set trip_photo_exempted_at = now(),
      trip_photo_exempted_by = auth.uid(),
      trip_photo_exemption_reason = reason
  where id = p_reservation_id
    and photo_required
    and trip_photo_path is null
    and status = 'confirmed'
    and ends_at <= now();
  if not found then
    raise exception using errcode = '22023', message = 'La gira no tiene una bitácora pendiente que pueda exonerarse';
  end if;
end;
$$;

drop policy if exists "Usuarios consultan reservas vehiculares" on public.vehicle_reservations;
create policy "Responsables consultan sus reservas vehiculares"
on public.vehicle_reservations for select to authenticated
using (user_id = auth.uid() or public.is_admin());

create or replace function public.get_public_vehicle_calendar(p_from date, p_to date)
returns table (
  id uuid, vehicle_id bigint, starts_at timestamptz, ends_at timestamptz,
  responsible_name text, status text, event_type text, category text
)
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if p_to < p_from or p_to - p_from > 370 then
    raise exception using errcode = '22023', message = 'El rango solicitado no es válido';
  end if;
  return query
  select r.id, r.vehicle_id, r.starts_at, r.ends_at, r.responsible_name,
    r.status, 'reservation'::text, null::text
  from public.vehicle_reservations r
  where r.status in ('pending_approval', 'confirmed', 'suspended_maintenance')
    and r.starts_at < (p_to + 1)::timestamptz and r.ends_at > p_from::timestamptz
  union all
  select m.id, m.vehicle_id, m.starts_at, coalesce(m.ends_at, (p_to + 1)::timestamptz),
    null::text, 'maintenance'::text, 'maintenance'::text, m.category
  from public.vehicle_maintenance m
  where m.active and m.starts_at < (p_to + 1)::timestamptz
    and coalesce(m.ends_at, 'infinity'::timestamptz) > p_from::timestamptz;
end;
$$;

grant execute on function public.set_my_unit(text) to authenticated;
grant execute on function public.admin_resolve_vehicle_reservation(uuid, text, bigint, text) to authenticated;
grant execute on function public.attach_vehicle_trip_photo(uuid, text) to authenticated;
grant execute on function public.admin_exempt_vehicle_trip_photo(uuid, text) to authenticated;

comment on column public.profiles.unit is 'Unidad institucional: Docencia, Administrativo, LAA o PROCAME';
comment on column public.vehicle_reservations.trip_photo_path is 'Ruta privada de la única fotografía de bitácora asociada a la gira';
