-- Aplica a PROCAME el mismo límite semanal que ya rige para LAA.
-- El nombre del trigger garantiza que se ejecute después de vehicle_reservations_protect,
-- cuando la unidad institucional y la excepción administrativa ya fueron validadas.

create or replace function public.enforce_procame_weekly_vehicle_limit()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  new_week_start date;
  new_week_end date;
begin
  if new.unit <> 'PROCAME' or coalesce(new.policy_override, false) then
    return new;
  end if;

  new_week_start := date_trunc(
    'week',
    (new.starts_at at time zone 'America/Costa_Rica')::timestamp
  )::date;
  new_week_end := date_trunc(
    'week',
    ((new.ends_at - interval '1 second') at time zone 'America/Costa_Rica')::timestamp
  )::date + 7;

  if exists (
    select 1
    from public.vehicle_reservations r
    where r.unit = 'PROCAME'
      and r.status in ('pending_approval', 'confirmed')
      and date_trunc(
        'week',
        (r.starts_at at time zone 'America/Costa_Rica')
      )::date < new_week_end
      and date_trunc(
        'week',
        ((r.ends_at - interval '1 second') at time zone 'America/Costa_Rica')
      )::date + 7 > new_week_start
  ) then
    raise exception using
      errcode = '22023',
      message = 'La unidad PROCAME solo puede mantener una reserva de vehículo por semana';
  end if;

  return new;
end;
$$;

drop trigger if exists zz_vehicle_reservations_procame_weekly_limit
  on public.vehicle_reservations;

create trigger zz_vehicle_reservations_procame_weekly_limit
before insert on public.vehicle_reservations
for each row
execute function public.enforce_procame_weekly_vehicle_limit();
