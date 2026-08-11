alter table public.vehicle_reservations
  add column if not exists responsible_id_number text,
  add column if not exists departure_place text,
  add column if not exists destination_province text,
  add column if not exists destination_canton text,
  add column if not exists destination_district text,
  add column if not exists driver_name text,
  add column if not exists driver_id_number text,
  add column if not exists course text,
  add column if not exists processing_status text not null default 'pending',
  add column if not exists processing_notes text,
  add column if not exists processed_by uuid references public.profiles(id) on delete set null,
  add column if not exists processed_at timestamptz,
  add column if not exists processing_updated_by uuid references public.profiles(id) on delete set null,
  add column if not exists processing_updated_at timestamptz;

alter table public.vehicle_reservations
  drop constraint if exists vehicle_reservations_responsible_id_number_check,
  drop constraint if exists vehicle_reservations_departure_place_check,
  drop constraint if exists vehicle_reservations_destination_province_check,
  drop constraint if exists vehicle_reservations_destination_canton_check,
  drop constraint if exists vehicle_reservations_destination_district_check,
  drop constraint if exists vehicle_reservations_driver_name_check,
  drop constraint if exists vehicle_reservations_driver_id_number_check,
  drop constraint if exists vehicle_reservations_course_check,
  drop constraint if exists vehicle_reservations_processing_status_check,
  drop constraint if exists vehicle_reservations_processing_notes_check,
  drop constraint if exists vehicle_reservations_processed_status_check;

alter table public.vehicle_reservations
  add constraint vehicle_reservations_responsible_id_number_check
    check (responsible_id_number is null or char_length(trim(responsible_id_number)) between 3 and 40),
  add constraint vehicle_reservations_departure_place_check
    check (departure_place is null or char_length(trim(departure_place)) between 3 and 160),
  add constraint vehicle_reservations_destination_province_check
    check (destination_province is null or char_length(trim(destination_province)) between 3 and 80),
  add constraint vehicle_reservations_destination_canton_check
    check (destination_canton is null or char_length(trim(destination_canton)) between 2 and 80),
  add constraint vehicle_reservations_destination_district_check
    check (destination_district is null or char_length(trim(destination_district)) between 2 and 80),
  add constraint vehicle_reservations_driver_name_check
    check (driver_name is null or char_length(trim(driver_name)) between 3 and 100),
  add constraint vehicle_reservations_driver_id_number_check
    check (driver_id_number is null or char_length(trim(driver_id_number)) between 3 and 40),
  add constraint vehicle_reservations_course_check
    check (course is null or char_length(trim(course)) <= 160),
  add constraint vehicle_reservations_processing_status_check
    check (processing_status in ('pending', 'needs_info', 'processed')),
  add constraint vehicle_reservations_processing_notes_check
    check (processing_notes is null or char_length(trim(processing_notes)) <= 800),
  add constraint vehicle_reservations_processed_status_check
    check (processing_status <> 'processed' or (processed_by is not null and processed_at is not null));

create index if not exists vehicle_reservations_processing_status_idx
  on public.vehicle_reservations(processing_status, starts_at);
create index if not exists vehicle_reservations_processed_by_idx
  on public.vehicle_reservations(processed_by, processed_at);

create or replace function public.admin_update_vehicle_reservation_processing(
  p_id uuid,
  p_processing_status text,
  p_processing_notes text default null
)
returns public.vehicle_reservations
language plpgsql
security definer
set search_path = public
as $$
declare item public.vehicle_reservations;
begin
  if not public.is_admin() then
    raise exception using errcode = '42501', message = 'Se requiere acceso administrativo';
  end if;
  if p_processing_status not in ('pending', 'needs_info', 'processed') then
    raise exception using errcode = '22023', message = 'Estado de trámite no válido';
  end if;

  update public.vehicle_reservations
  set processing_status = p_processing_status,
      processing_notes = nullif(trim(coalesce(p_processing_notes, '')), ''),
      processing_updated_by = auth.uid(),
      processing_updated_at = now(),
      processed_by = case when p_processing_status = 'processed' then auth.uid() else null end,
      processed_at = case when p_processing_status = 'processed' then now() else null end
  where id = p_id
  returning * into item;

  if not found then
    raise exception using errcode = '22023', message = 'Reserva no encontrada';
  end if;

  return item;
end;
$$;

revoke all on function public.admin_update_vehicle_reservation_processing(uuid, text, text) from public;
grant execute on function public.admin_update_vehicle_reservation_processing(uuid, text, text) to authenticated;

create table if not exists public.vehicle_reservation_notifications (
  id uuid primary key default gen_random_uuid(),
  reservation_id uuid not null references public.vehicle_reservations(id) on delete cascade,
  channel text not null default 'email' check (channel in ('email', 'internal')),
  recipient_user_id uuid references public.profiles(id) on delete cascade,
  recipient_email text,
  subject text not null,
  body text not null,
  status text not null default 'pending' check (status in ('pending', 'sent', 'failed', 'dismissed')),
  error_message text,
  created_at timestamptz not null default now(),
  sent_at timestamptz,
  dismissed_at timestamptz
);

alter table public.vehicle_reservation_notifications enable row level security;

drop policy if exists "Administracion consulta notificaciones vehiculares" on public.vehicle_reservation_notifications;
create policy "Administracion consulta notificaciones vehiculares"
on public.vehicle_reservation_notifications for select to authenticated
using (public.is_admin());

drop policy if exists "Administracion actualiza notificaciones vehiculares" on public.vehicle_reservation_notifications;
create policy "Administracion actualiza notificaciones vehiculares"
on public.vehicle_reservation_notifications for update to authenticated
using (public.is_admin())
with check (public.is_admin());

grant select, update on public.vehicle_reservation_notifications to authenticated;

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
      and admin_scope in ('superadmin', 'reservations')
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

drop trigger if exists vehicle_reservations_notify_processors on public.vehicle_reservations;
create trigger vehicle_reservations_notify_processors
after insert on public.vehicle_reservations
for each row execute function public.enqueue_vehicle_reservation_notifications();

comment on column public.vehicle_reservations.processing_status is
  'Estado administrativo para cargar la reserva en el sistema institucional de boletas de gira.';
comment on table public.vehicle_reservation_notifications is
  'Bandeja de salida para avisos de nuevas reservas vehiculares. Un servicio externo puede enviar los correos pendientes.';
