-- Administración segura de usuarios registrados y bloqueo específico de reservas.

alter table public.profiles
  add column if not exists reservations_blocked boolean not null default false,
  add column if not exists reservations_block_reason text,
  add column if not exists reservations_blocked_at timestamptz,
  add column if not exists reservations_blocked_by uuid references public.profiles(id) on delete set null;

alter table public.profiles
  drop constraint if exists profiles_reservations_block_reason_check;

alter table public.profiles
  add constraint profiles_reservations_block_reason_check
  check (
    (reservations_blocked = false)
    or char_length(trim(reservations_block_reason)) between 5 and 500
  );

create or replace function public.enforce_user_reservation_access()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  target_profile public.profiles;
begin
  select * into target_profile
  from public.profiles
  where id = new.user_id;

  if not found or not target_profile.active then
    raise exception using
      errcode = '42501',
      message = 'La cuenta responsable está desactivada';
  end if;

  if target_profile.reservations_blocked then
    raise exception using
      errcode = '42501',
      message = coalesce(
        nullif(trim(target_profile.reservations_block_reason), ''),
        'La cuenta no tiene habilitada la creación de reservas'
      );
  end if;

  return new;
end;
$$;

drop trigger if exists reservations_enforce_user_access on public.reservations;
create trigger reservations_enforce_user_access
before insert on public.reservations
for each row execute function public.enforce_user_reservation_access();

drop trigger if exists vehicle_reservations_enforce_user_access on public.vehicle_reservations;
create trigger vehicle_reservations_enforce_user_access
before insert on public.vehicle_reservations
for each row execute function public.enforce_user_reservation_access();

comment on column public.profiles.reservations_blocked is
  'Impide crear reservas de aulas o vehículos sin desactivar el acceso de consulta';
