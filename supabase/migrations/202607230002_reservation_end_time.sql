do $$
declare
  constraint_name text;
begin
  select con.conname into constraint_name
  from pg_constraint con
  join pg_class rel on rel.oid = con.conrelid
  join pg_namespace nsp on nsp.oid = rel.relnamespace
  where nsp.nspname = 'public'
    and rel.relname = 'reservations'
    and con.contype = 'c'
    and pg_get_constraintdef(con.oid) like '%21:30%';

  if constraint_name is not null then
    execute format('alter table public.reservations drop constraint %I', constraint_name);
  end if;
end;
$$;

alter table public.reservations
drop constraint if exists reservations_hours_check;

alter table public.reservations
add constraint reservations_hours_check
check (start_time >= time '07:00' and end_time <= time '21:00');
