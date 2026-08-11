-- Programacion y control diario de limpieza.
-- La tabla inicia vacia: la jefatura cargara las asignaciones cuando se defina
-- el horario. Las vigencias conservan el historial para calcular faltantes.

create table public.limpieza_programacion (
  id uuid primary key default gen_random_uuid(),
  conserje_id uuid not null references public.limpieza_conserjes(id) on delete restrict,
  aposento_id uuid not null references public.limpieza_aposentos(id) on delete restrict,
  dia_semana smallint not null check (dia_semana between 0 and 6),
  vigente_desde date not null default current_date,
  vigente_hasta date,
  created_at timestamptz not null default now(),
  created_by uuid references auth.users(id) on delete set null,
  constraint limpieza_programacion_vigencia_valida
    check (vigente_hasta is null or vigente_hasta >= vigente_desde),
  constraint limpieza_programacion_asignacion_unica
    unique (conserje_id, aposento_id, dia_semana, vigente_desde)
);

comment on table public.limpieza_programacion is
  'Asignaciones recurrentes por conserje, aposento, dia de semana y periodo de vigencia.';
comment on column public.limpieza_programacion.dia_semana is
  'Dia de semana compatible con extract(dow): 0=domingo, 1=lunes, ..., 6=sabado.';

create index limpieza_programacion_conserje_idx
  on public.limpieza_programacion (conserje_id);
create index limpieza_programacion_aposento_idx
  on public.limpieza_programacion (aposento_id);
create index limpieza_programacion_control_idx
  on public.limpieza_programacion (dia_semana, vigente_desde, vigente_hasta);
create index limpieza_reportes_control_diario_idx
  on public.limpieza_reportes (conserje_id, fecha, aposento_id);

alter table public.limpieza_programacion enable row level security;
revoke all on public.limpieza_programacion from anon, authenticated;

create or replace function public.limpieza_es_admin_conserjeria()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.profiles
    where id = (select auth.uid())
      and role = 'admin'
      and admin_scope in ('conserjeria', 'superadmin')
      and active = true
  );
$$;

create or replace function public.limpieza_admin_catalogos()
returns table(tipo text, id uuid, nombre text)
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not public.limpieza_es_admin_conserjeria() then
    raise exception 'No autorizado';
  end if;

  return query
    select 'conserje'::text, c.id, c.nombre
    from public.limpieza_conserjes c
    where c.activo = true
    union all
    select 'aposento'::text, a.id, a.nombre
    from public.limpieza_aposentos a
    where a.activo = true
    order by 1, 3;
end;
$$;

create or replace function public.limpieza_admin_programacion()
returns table(
  id uuid,
  conserje_id uuid,
  conserje text,
  aposento_id uuid,
  aposento text,
  dia_semana smallint,
  vigente_desde date,
  vigente_hasta date
)
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not public.limpieza_es_admin_conserjeria() then
    raise exception 'No autorizado';
  end if;

  return query
    select p.id, c.id, c.nombre, a.id, a.nombre,
           p.dia_semana, p.vigente_desde, p.vigente_hasta
    from public.limpieza_programacion p
    join public.limpieza_conserjes c on c.id = p.conserje_id
    join public.limpieza_aposentos a on a.id = p.aposento_id
    order by p.dia_semana, c.nombre, a.nombre, p.vigente_desde;
end;
$$;

create or replace function public.limpieza_admin_guardar_programacion(
  p_conserje_id uuid,
  p_aposento_id uuid,
  p_dia_semana smallint,
  p_vigente_desde date,
  p_vigente_hasta date default null
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_id uuid;
begin
  if not public.limpieza_es_admin_conserjeria() then
    raise exception 'No autorizado';
  end if;
  if p_dia_semana not between 0 and 6 then
    raise exception 'Dia de semana invalido';
  end if;
  if p_vigente_hasta is not null and p_vigente_hasta < p_vigente_desde then
    raise exception 'La fecha final no puede ser anterior a la fecha inicial';
  end if;
  if not exists (select 1 from public.limpieza_conserjes where id = p_conserje_id and activo = true) then
    raise exception 'Conserje no valido';
  end if;
  if not exists (select 1 from public.limpieza_aposentos where id = p_aposento_id and activo = true) then
    raise exception 'Aposento no valido';
  end if;
  if exists (
    select 1
    from public.limpieza_programacion p
    where p.aposento_id = p_aposento_id
      and p.dia_semana = p_dia_semana
      and not (p.conserje_id = p_conserje_id and p.vigente_desde = p_vigente_desde)
      and daterange(p.vigente_desde, coalesce(p.vigente_hasta, 'infinity'::date), '[]')
          && daterange(p_vigente_desde, coalesce(p_vigente_hasta, 'infinity'::date), '[]')
  ) then
    raise exception 'El aposento ya tiene una asignacion vigente que se superpone para ese dia';
  end if;

  insert into public.limpieza_programacion
    (conserje_id, aposento_id, dia_semana, vigente_desde, vigente_hasta, created_by)
  values
    (p_conserje_id, p_aposento_id, p_dia_semana, p_vigente_desde, p_vigente_hasta, (select auth.uid()))
  on conflict (conserje_id, aposento_id, dia_semana, vigente_desde)
  do update set vigente_hasta = excluded.vigente_hasta
  returning id into v_id;

  return v_id;
end;
$$;

create or replace function public.limpieza_admin_eliminar_programacion(p_id uuid)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_desde date;
  v_hoy date := (now() at time zone 'America/Costa_Rica')::date;
begin
  if not public.limpieza_es_admin_conserjeria() then
    raise exception 'No autorizado';
  end if;

  select vigente_desde into v_desde
  from public.limpieza_programacion
  where id = p_id;

  if v_desde is null then
    return false;
  elsif v_desde > v_hoy then
    delete from public.limpieza_programacion where id = p_id;
  else
    update public.limpieza_programacion
    set vigente_hasta = greatest(vigente_desde, v_hoy)
    where id = p_id;
  end if;

  return true;
end;
$$;

create or replace function public.limpieza_admin_control_diario(p_fecha date)
returns table(
  conserje_id uuid,
  conserje text,
  aposento_id uuid,
  aposento text,
  programado boolean,
  reportado boolean,
  cantidad_reportes bigint,
  primera_hora time,
  ultima_hora time
)
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not public.limpieza_es_admin_conserjeria() then
    raise exception 'No autorizado';
  end if;
  if p_fecha is null then
    raise exception 'Fecha requerida';
  end if;

  return query
    with programados as (
      select p.conserje_id, p.aposento_id
      from public.limpieza_programacion p
      where p.dia_semana = extract(dow from p_fecha)::smallint
        and p.vigente_desde <= p_fecha
        and (p.vigente_hasta is null or p.vigente_hasta >= p_fecha)
    ),
    reportados as (
      select r.conserje_id, r.aposento_id,
             count(*)::bigint as cantidad,
             min((r.fecha at time zone 'America/Costa_Rica')::time) as primera,
             max((r.fecha at time zone 'America/Costa_Rica')::time) as ultima
      from public.limpieza_reportes r
      where (r.fecha at time zone 'America/Costa_Rica')::date = p_fecha
      group by r.conserje_id, r.aposento_id
    ),
    control as (
      select coalesce(p.conserje_id, r.conserje_id) as conserje_id,
             coalesce(p.aposento_id, r.aposento_id) as aposento_id,
             (p.conserje_id is not null) as programado,
             (r.conserje_id is not null) as reportado,
             coalesce(r.cantidad, 0)::bigint as cantidad,
             r.primera,
             r.ultima
      from programados p
      full join reportados r
        on r.conserje_id = p.conserje_id and r.aposento_id = p.aposento_id
    )
    select c.conserje_id, lc.nombre, c.aposento_id, la.nombre,
           c.programado, c.reportado, c.cantidad, c.primera, c.ultima
    from control c
    join public.limpieza_conserjes lc on lc.id = c.conserje_id
    join public.limpieza_aposentos la on la.id = c.aposento_id
    order by lc.nombre, c.programado desc, la.nombre;
end;
$$;

revoke all on function public.limpieza_es_admin_conserjeria() from public, anon;
revoke all on function public.limpieza_admin_catalogos() from public, anon;
revoke all on function public.limpieza_admin_programacion() from public, anon;
revoke all on function public.limpieza_admin_guardar_programacion(uuid, uuid, smallint, date, date) from public, anon;
revoke all on function public.limpieza_admin_eliminar_programacion(uuid) from public, anon;
revoke all on function public.limpieza_admin_control_diario(date) from public, anon;

grant execute on function public.limpieza_es_admin_conserjeria() to authenticated;
grant execute on function public.limpieza_admin_catalogos() to authenticated;
grant execute on function public.limpieza_admin_programacion() to authenticated;
grant execute on function public.limpieza_admin_guardar_programacion(uuid, uuid, smallint, date, date) to authenticated;
grant execute on function public.limpieza_admin_eliminar_programacion(uuid) to authenticated;
grant execute on function public.limpieza_admin_control_diario(date) to authenticated;
