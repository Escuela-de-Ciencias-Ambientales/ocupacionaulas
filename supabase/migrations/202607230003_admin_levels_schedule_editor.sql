alter table public.profiles
add column if not exists admin_scope text;

alter table public.profiles
drop constraint if exists profiles_admin_scope_check;

update public.profiles
set admin_scope = 'superadmin'
where role = 'admin' and admin_scope is null;

alter table public.profiles
add constraint profiles_admin_scope_check check (
  (role = 'teacher' and admin_scope is null)
  or (role = 'admin' and admin_scope in ('superadmin', 'reservations'))
);

create or replace function public.is_superadmin()
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
      and admin_scope = 'superadmin'
      and active = true
  );
$$;

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
      and admin_scope in ('superadmin', 'reservations')
      and active = true
  );
$$;

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  requested_role public.user_role;
  requested_scope text;
begin
  requested_role := case
    when new.raw_user_meta_data ->> 'role' = 'admin' then 'admin'::public.user_role
    else 'teacher'::public.user_role
  end;
  requested_scope := case
    when requested_role = 'admin'::public.user_role
      then coalesce(nullif(new.raw_user_meta_data ->> 'admin_scope', ''), 'reservations')
    else null
  end;

  insert into public.profiles (id, email, full_name, role, admin_scope)
  values (
    new.id,
    lower(coalesce(new.email, '')),
    coalesce(nullif(trim(new.raw_user_meta_data ->> 'full_name'), ''), split_part(coalesce(new.email, 'Docente'), '@', 1)),
    requested_role,
    requested_scope
  );
  return new;
end;
$$;

drop policy if exists "Administración consulta docentes autorizados" on public.teacher_registry;
drop policy if exists "Superadministración consulta docentes autorizados" on public.teacher_registry;
create policy "Superadministración consulta docentes autorizados"
on public.teacher_registry for select
to authenticated
using (public.is_superadmin());

drop policy if exists "Administración gestiona docentes autorizados" on public.teacher_registry;
drop policy if exists "Superadministración gestiona docentes autorizados" on public.teacher_registry;
create policy "Superadministración gestiona docentes autorizados"
on public.teacher_registry for all
to authenticated
using (public.is_superadmin())
with check (public.is_superadmin());

drop policy if exists "Administración actualiza perfiles" on public.profiles;
drop policy if exists "Superadministración actualiza perfiles" on public.profiles;
create policy "Superadministración actualiza perfiles"
on public.profiles for update
to authenticated
using (public.is_superadmin())
with check (public.is_superadmin());

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
  if not public.is_superadmin() then raise exception using errcode = '42501', message = 'Se requiere acceso de superadministrador'; end if;
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

create or replace function public.admin_set_reservations_enabled(p_enabled boolean)
returns public.reservation_cycles
language plpgsql
security definer
set search_path = public
as $$
declare active_cycle public.reservation_cycles;
begin
  if not public.is_superadmin() then raise exception using errcode = '42501', message = 'Se requiere acceso de superadministrador'; end if;
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

create or replace function public.admin_upsert_fixed_occupancy(
  p_id bigint,
  p_classroom_code text,
  p_day integer,
  p_start time,
  p_end time,
  p_label text
)
returns bigint
language plpgsql
security definer
set search_path = public
as $$
declare
  active_cycle public.reservation_cycles;
  room_id bigint;
  saved_id bigint;
begin
  if not public.is_admin() then raise exception using errcode = '42501', message = 'Se requiere acceso administrativo'; end if;
  if p_day not between 1 and 6 or p_start < time '07:00' or p_end > time '21:00' or p_start >= p_end or nullif(trim(p_label), '') is null then
    raise exception using errcode = '22023', message = 'El día, horario o detalle no es válido';
  end if;

  select * into active_cycle from public.reservation_cycles where is_current = true;
  if not found then raise exception using errcode = '22023', message = 'Primero configura el ciclo'; end if;
  select id into room_id from public.classrooms where code = p_classroom_code and active = true;
  if room_id is null then raise exception using errcode = '22023', message = 'El aula no es válida'; end if;

  if exists (
    select 1 from public.fixed_occupancies
    where cycle_id = active_cycle.id
      and classroom_id = room_id
      and day_of_week = p_day
      and id <> coalesce(p_id, -1)
      and p_start < end_time
      and p_end > start_time
  ) then raise exception using errcode = '23P01', message = 'El horario se cruza con otra ocupación académica'; end if;

  if exists (
    select 1 from public.reservations
    where cycle_id = active_cycle.id
      and classroom_id = room_id
      and status = 'active'
      and reservation_date <= active_cycle.academic_schedule_end_date
      and extract(dow from reservation_date)::integer = p_day
      and p_start < end_time
      and p_end > start_time
  ) then raise exception using errcode = '23P01', message = 'Existen reservas activas que coinciden con este horario'; end if;

  if p_id is null then
    insert into public.fixed_occupancies (cycle_id, classroom_id, day_of_week, start_time, end_time, label)
    values (active_cycle.id, room_id, p_day, p_start, p_end, trim(p_label))
    returning id into saved_id;
  else
    update public.fixed_occupancies
    set classroom_id = room_id, day_of_week = p_day, start_time = p_start, end_time = p_end, label = trim(p_label)
    where id = p_id and cycle_id = active_cycle.id
    returning id into saved_id;
    if saved_id is null then raise exception using errcode = '22023', message = 'No se encontró la ocupación'; end if;
  end if;

  update public.reservation_cycles set academic_schedule_loaded = true where id = active_cycle.id;
  return saved_id;
end;
$$;

create or replace function public.admin_delete_fixed_occupancy(p_id bigint)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.is_admin() then raise exception using errcode = '42501', message = 'Se requiere acceso administrativo'; end if;
  delete from public.fixed_occupancies
  where id = p_id
    and cycle_id = (select id from public.reservation_cycles where is_current = true);
  return found;
end;
$$;

create or replace function public.admin_create_reservation(
  p_user_id uuid,
  p_classroom_id bigint,
  p_date date,
  p_start time,
  p_end time,
  p_activity text
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  active_cycle_id uuid;
  created_id uuid;
begin
  if not public.is_admin() then raise exception using errcode = '42501', message = 'Se requiere acceso administrativo'; end if;
  if not exists (select 1 from public.profiles where id = p_user_id and role = 'teacher' and active = true) then
    raise exception using errcode = '22023', message = 'Selecciona un docente activo';
  end if;
  select id into active_cycle_id from public.reservation_cycles where is_current = true;
  insert into public.reservations (cycle_id, user_id, classroom_id, reservation_date, start_time, end_time, activity, professor_name)
  values (active_cycle_id, p_user_id, p_classroom_id, p_date, p_start, p_end, trim(p_activity), 'Pendiente')
  returning id into created_id;
  return created_id;
end;
$$;

grant execute on function public.is_superadmin() to authenticated;
grant execute on function public.admin_upsert_fixed_occupancy(bigint,text,integer,time,time,text) to authenticated;
grant execute on function public.admin_delete_fixed_occupancy(bigint) to authenticated;
grant execute on function public.admin_create_reservation(uuid,bigint,date,time,time,text) to authenticated;
