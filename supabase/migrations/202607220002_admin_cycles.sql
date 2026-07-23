create table public.reservation_cycles (
  id uuid primary key default gen_random_uuid(),
  name text not null unique check (char_length(trim(name)) between 3 and 80),
  reservation_start_date date not null,
  reservation_end_date date not null,
  academic_schedule_end_date date not null,
  booking_opens_at timestamptz not null,
  booking_closes_at timestamptz not null,
  academic_schedule_loaded boolean not null default false,
  reservations_enabled boolean not null default false,
  is_current boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (reservation_start_date <= academic_schedule_end_date),
  check (academic_schedule_end_date <= reservation_end_date),
  check (booking_opens_at < booking_closes_at)
);

create unique index reservation_cycles_one_current_idx
on public.reservation_cycles (is_current)
where is_current = true;

insert into public.reservation_cycles (
  name, reservation_start_date, reservation_end_date, academic_schedule_end_date,
  booking_opens_at, booking_closes_at, is_current
) values (
  'II Ciclo 2026', date '2026-07-20', date '2026-12-20', date '2026-11-14',
  timestamptz '2026-07-20 00:00:00-06', timestamptz '2026-12-20 23:59:59-06', true
) on conflict (name) do update set is_current = true;

alter table public.fixed_occupancies add column cycle_id uuid references public.reservation_cycles(id) on delete cascade;
alter table public.reservations add column cycle_id uuid references public.reservation_cycles(id) on delete restrict;

update public.fixed_occupancies
set cycle_id = (select id from public.reservation_cycles where is_current = true limit 1)
where cycle_id is null;

update public.reservations
set cycle_id = (select id from public.reservation_cycles where is_current = true limit 1)
where cycle_id is null;

alter table public.fixed_occupancies alter column cycle_id set not null;
alter table public.reservations alter column cycle_id set not null;
alter table public.reservations drop constraint if exists reservations_reservation_date_check;
alter table public.reservations drop constraint if exists reservations_classroom_id_tsrange_excl;

alter table public.reservations add constraint reservations_no_overlap
exclude using gist (
  cycle_id with =,
  classroom_id with =,
  tsrange(reservation_date + start_time, reservation_date + end_time, '[)') with &&
) where (status = 'active');

drop index if exists public.fixed_occupancies_room_day_idx;
create index fixed_occupancies_cycle_room_day_idx on public.fixed_occupancies(cycle_id, classroom_id, day_of_week);
create index reservations_cycle_date_idx on public.reservations(cycle_id, reservation_date);

alter table public.profiles drop constraint if exists profiles_email_check;
alter table public.profiles add constraint profiles_email_by_role_check check (
  (role = 'teacher' and email ~ '^[a-z0-9-]+\.[a-z0-9-]+\.[a-z0-9-]+@una\.cr$')
  or (role = 'admin' and email ~ '^[a-z0-9._-]+@una\.cr$')
);

create trigger reservation_cycles_set_updated_at
before update on public.reservation_cycles
for each row execute function public.set_updated_at();

create or replace function public.protect_reservation_fields()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  active_cycle public.reservation_cycles%rowtype;
  fixed_label text;
begin
  select * into active_cycle
  from public.reservation_cycles
  where id = new.cycle_id and is_current = true;

  if not found then
    raise exception using errcode = '22023', message = 'El ciclo seleccionado no está vigente';
  end if;

  if tg_op = 'INSERT' then
    if not active_cycle.reservations_enabled
      or not active_cycle.academic_schedule_loaded
      or now() < active_cycle.booking_opens_at
      or now() > active_cycle.booking_closes_at then
      raise exception using errcode = '42501', message = 'El sistema de reservas está cerrado';
    end if;

    if new.reservation_date < active_cycle.reservation_start_date
      or new.reservation_date > active_cycle.reservation_end_date then
      raise exception using errcode = '22023', message = 'La fecha está fuera del periodo de reservación';
    end if;

    if new.reservation_date < current_date then
      raise exception using errcode = '22023', message = 'No se permiten reservas en fechas pasadas';
    end if;

    if extract(dow from new.reservation_date)::integer = 0 then
      raise exception using errcode = '22023', message = 'No se permiten reservas los domingos';
    end if;

    select fixed.label into fixed_label
    from public.fixed_occupancies fixed
    where fixed.cycle_id = new.cycle_id
      and fixed.classroom_id = new.classroom_id
      and new.reservation_date <= active_cycle.academic_schedule_end_date
      and fixed.day_of_week = extract(dow from new.reservation_date)::integer
      and new.start_time < fixed.end_time
      and new.end_time > fixed.start_time
    limit 1;

    if fixed_label is not null then
      raise exception using errcode = '23P01', message = 'El horario coincide con una ocupación académica prioritaria';
    end if;

    new.professor_name = (select full_name from public.profiles where id = new.user_id);
  else
    if not public.is_admin() and (
      new.user_id <> old.user_id
      or new.cycle_id <> old.cycle_id
      or new.classroom_id <> old.classroom_id
      or new.reservation_date <> old.reservation_date
      or new.start_time <> old.start_time
      or new.end_time <> old.end_time
      or new.activity <> old.activity
      or new.professor_name <> old.professor_name
    ) then
      raise exception using errcode = '42501', message = 'Solo la administración puede modificar los datos de una reserva';
    end if;
    if old.status = 'active' and new.status = 'cancelled' then new.cancelled_at = now(); end if;
  end if;

  return new;
end;
$$;

alter table public.reservation_cycles enable row level security;

drop policy if exists "Reservas activas visibles para todos" on public.reservations;
create policy "Reservas visibles para usuarios autenticados"
on public.reservations for select
to authenticated
using (status = 'active' or user_id = auth.uid() or public.is_admin());

create policy "Ciclo vigente visible para usuarios autenticados"
on public.reservation_cycles for select
to authenticated
using (is_current = true or public.is_admin());

create or replace function public.admin_configure_cycle(
  p_name text,
  p_reservation_start date,
  p_reservation_end date,
  p_academic_end date,
  p_opens_at timestamptz,
  p_closes_at timestamptz
)
returns public.reservation_cycles
language plpgsql
security definer
set search_path = public
as $$
declare configured public.reservation_cycles;
begin
  if not public.is_admin() then raise exception using errcode = '42501', message = 'Se requiere acceso de administrador'; end if;
  if p_reservation_start > p_academic_end or p_academic_end > p_reservation_end or p_opens_at >= p_closes_at then
    raise exception using errcode = '22023', message = 'Las fechas del ciclo no son válidas';
  end if;

  update public.reservation_cycles set is_current = false where is_current = true;
  insert into public.reservation_cycles (
    name, reservation_start_date, reservation_end_date, academic_schedule_end_date,
    booking_opens_at, booking_closes_at, academic_schedule_loaded, reservations_enabled, is_current
  ) values (
    trim(p_name), p_reservation_start, p_reservation_end, p_academic_end,
    p_opens_at, p_closes_at, false, false, true
  )
  on conflict (name) do update set
    reservation_start_date = excluded.reservation_start_date,
    reservation_end_date = excluded.reservation_end_date,
    academic_schedule_end_date = excluded.academic_schedule_end_date,
    booking_opens_at = excluded.booking_opens_at,
    booking_closes_at = excluded.booking_closes_at,
    academic_schedule_loaded = false,
    reservations_enabled = false,
    is_current = true
  returning * into configured;
  return configured;
end;
$$;

create or replace function public.admin_replace_fixed_occupancies(p_entries jsonb)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare active_cycle_id uuid;
declare inserted_count integer;
begin
  if not public.is_admin() then raise exception using errcode = '42501', message = 'Se requiere acceso de administrador'; end if;
  if jsonb_typeof(p_entries) <> 'array' or jsonb_array_length(p_entries) = 0 then
    raise exception using errcode = '22023', message = 'El archivo de ocupación está vacío';
  end if;
  select id into active_cycle_id from public.reservation_cycles where is_current = true;
  if active_cycle_id is null then raise exception using errcode = '22023', message = 'Primero configura el ciclo'; end if;

  if exists (
    select 1 from jsonb_to_recordset(p_entries) as item(aula text, dia integer, hora_inicio time, hora_fin time, detalle text)
    left join public.classrooms room on room.code = item.aula and room.active = true
    where room.id is null or item.dia not between 1 and 6 or item.hora_inicio >= item.hora_fin or nullif(trim(item.detalle), '') is null
  ) then raise exception using errcode = '22023', message = 'El archivo contiene aulas, días u horarios inválidos'; end if;

  delete from public.fixed_occupancies where cycle_id = active_cycle_id;
  insert into public.fixed_occupancies (cycle_id, classroom_id, day_of_week, start_time, end_time, label)
  select active_cycle_id, room.id, item.dia, item.hora_inicio, item.hora_fin, trim(item.detalle)
  from jsonb_to_recordset(p_entries) as item(aula text, dia integer, hora_inicio time, hora_fin time, detalle text)
  join public.classrooms room on room.code = item.aula and room.active = true;
  get diagnostics inserted_count = row_count;

  update public.reservation_cycles
  set academic_schedule_loaded = true, reservations_enabled = false
  where id = active_cycle_id;
  return inserted_count;
end;
$$;

create or replace function public.admin_set_reservations_enabled(p_enabled boolean)
returns public.reservation_cycles
language plpgsql
security definer
set search_path = public
as $$
declare active_cycle public.reservation_cycles;
begin
  if not public.is_admin() then raise exception using errcode = '42501', message = 'Se requiere acceso de administrador'; end if;
  select * into active_cycle from public.reservation_cycles where is_current = true for update;
  if not found then raise exception using errcode = '22023', message = 'Primero configura el ciclo'; end if;
  if p_enabled and not active_cycle.academic_schedule_loaded then
    raise exception using errcode = '22023', message = 'Primero carga la ocupación académica del ciclo';
  end if;
  if p_enabled and now() > active_cycle.booking_closes_at then
    raise exception using errcode = '22023', message = 'La fecha de cierre del sistema ya pasó';
  end if;
  update public.reservation_cycles set reservations_enabled = p_enabled where id = active_cycle.id returning * into active_cycle;
  return active_cycle;
end;
$$;

grant select on public.reservation_cycles to authenticated;
grant execute on function public.admin_configure_cycle(text,date,date,date,timestamptz,timestamptz) to authenticated;
grant execute on function public.admin_replace_fixed_occupancies(jsonb) to authenticated;
grant execute on function public.admin_set_reservations_enabled(boolean) to authenticated;

comment on table public.reservation_cycles is 'Ciclos de reservación controlados por la administración';
