-- Limpieza de reservas de aulas con antigüedad superior a dos meses.
create extension if not exists pg_cron with schema pg_catalog;

create or replace function public.cleanup_old_classroom_reservations()
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  deleted_count integer;
begin
  delete from public.reservations
  where reservation_date < current_date - interval '2 months';
  get diagnostics deleted_count = row_count;
  return deleted_count;
end;
$$;

revoke all on function public.cleanup_old_classroom_reservations() from public, anon, authenticated;

do $$
begin
  if exists (select 1 from cron.job where jobname = 'cleanup-classroom-reservations-two-months') then
    perform cron.unschedule('cleanup-classroom-reservations-two-months');
  end if;
  perform cron.schedule(
    'cleanup-classroom-reservations-two-months',
    '20 9 1 * *',
    'select public.cleanup_old_classroom_reservations();'
  );
end;
$$;

comment on function public.cleanup_old_classroom_reservations() is
  'Elimina mensualmente las reservas de aulas con más de dos meses de antigüedad.';
