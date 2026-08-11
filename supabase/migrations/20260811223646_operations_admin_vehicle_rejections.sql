alter table public.profiles
  drop constraint if exists profiles_admin_scope_check;

alter table public.profiles
  add constraint profiles_admin_scope_check check (
    (role = 'teacher' and admin_scope is null)
    or (role = 'admin' and admin_scope in ('superadmin', 'operations', 'reservations', 'conserjeria'))
  );

update public.profiles
set admin_scope = 'operations'
where lower(email) = 'dayanne.murillo.ugalde@una.cr';

create or replace function public.is_admin()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.profiles
    where id = auth.uid()
      and role = 'admin'
      and admin_scope in ('superadmin', 'operations', 'reservations')
      and active = true
  );
$$;

create or replace function public.is_vehicle_processor()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.profiles
    where id = auth.uid()
      and role = 'admin'
      and admin_scope in ('superadmin', 'operations', 'reservations', 'conserjeria')
      and active = true
  );
$$;

alter table public.vehicle_reservations
  drop constraint if exists vehicle_reservations_processing_status_check,
  drop constraint if exists vehicle_reservations_processed_status_check;

alter table public.vehicle_reservations
  add constraint vehicle_reservations_processing_status_check
    check (processing_status in ('pending', 'needs_info', 'processed', 'rejected')),
  add constraint vehicle_reservations_processed_status_check
    check (processing_status not in ('processed', 'rejected') or (processed_by is not null and processed_at is not null));

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
  if not public.is_vehicle_processor() then
    raise exception using errcode = '42501', message = 'Se requiere acceso administrativo de vehículos';
  end if;
  if p_processing_status not in ('pending', 'needs_info', 'processed', 'rejected') then
    raise exception using errcode = '22023', message = 'Estado de trámite no válido';
  end if;

  update public.vehicle_reservations
  set processing_status = p_processing_status,
      processing_notes = nullif(trim(coalesce(p_processing_notes, '')), ''),
      processing_updated_by = auth.uid(),
      processing_updated_at = now(),
      processed_by = case when p_processing_status in ('processed', 'rejected') then auth.uid() else null end,
      processed_at = case when p_processing_status in ('processed', 'rejected') then now() else null end
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
