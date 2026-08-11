-- Flujo de conserjeria v2: QR obligatorio en la interfaz, checklist por
-- aposento, evidencia fotografica privada y resumen diario por conserje.

alter table public.limpieza_programacion
  add column if not exists turno_codigo text,
  add column if not exists hora_inicio time,
  add column if not exists hora_fin time,
  add column if not exists foto_requerida boolean not null default false;

alter table public.limpieza_reportes
  add column if not exists programacion_id uuid references public.limpieza_programacion(id) on delete set null,
  add column if not exists foto_path text,
  add column if not exists foto_mime text,
  add column if not exists foto_bytes integer,
  add column if not exists formulario_version smallint not null default 1;

alter table public.limpieza_reportes
  add constraint limpieza_reportes_foto_consistente check (
    (foto_path is null and foto_mime is null and foto_bytes is null)
    or (
      foto_path is not null
      and foto_mime = 'image/jpeg'
      and foto_bytes between 1 and 1048576
    )
  ),
  add constraint limpieza_reportes_formulario_version check (formulario_version between 1 and 10);

create index limpieza_reportes_programacion_idx
  on public.limpieza_reportes (programacion_id)
  where programacion_id is not null;
create index limpieza_reportes_foto_idx
  on public.limpieza_reportes (foto_path)
  where foto_path is not null;

create table public.limpieza_labores (
  id uuid primary key default gen_random_uuid(),
  nombre text not null unique check (char_length(trim(nombre)) between 2 and 120),
  descripcion text,
  activo boolean not null default true,
  created_at timestamptz not null default now()
);

create table public.limpieza_aposento_labores (
  aposento_id uuid not null references public.limpieza_aposentos(id) on delete cascade,
  labor_id uuid not null references public.limpieza_labores(id) on delete restrict,
  obligatoria boolean not null default true,
  orden smallint not null default 1 check (orden between 1 and 100),
  activo boolean not null default true,
  created_at timestamptz not null default now(),
  primary key (aposento_id, labor_id)
);

create index limpieza_aposento_labores_labor_idx
  on public.limpieza_aposento_labores (labor_id);
create index limpieza_aposento_labores_activas_idx
  on public.limpieza_aposento_labores (aposento_id, orden)
  where activo;

alter table public.limpieza_labores enable row level security;
alter table public.limpieza_aposento_labores enable row level security;
revoke all on public.limpieza_labores from anon, authenticated;
revoke all on public.limpieza_aposento_labores from anon, authenticated;

insert into public.limpieza_labores (nombre)
values ('Barrer'), ('Sacudir'), ('Desinfectar'), ('Sacar basura'),
       ('Limpiar pizarras'), ('Limpiar pantalla')
on conflict (nombre) do update set activo = true;

-- Configuracion inicial derivada del boceto entregado. Se podra reemplazar
-- cuando la jefatura complete la plantilla normalizada.
insert into public.limpieza_aposento_labores (aposento_id, labor_id, obligatoria, orden)
select a.id, l.id, true,
  case l.nombre
    when 'Barrer' then 1 when 'Sacudir' then 2 when 'Desinfectar' then 3
    when 'Sacar basura' then 4 when 'Limpiar pizarras' then 5 else 6
  end
from public.limpieza_aposentos a
join public.limpieza_labores l on l.nombre in ('Barrer', 'Sacudir', 'Desinfectar', 'Sacar basura')
where a.activo
on conflict (aposento_id, labor_id) do nothing;

insert into public.limpieza_aposento_labores (aposento_id, labor_id, obligatoria, orden)
select a.id, l.id, true,
  case l.nombre when 'Limpiar pizarras' then 5 else 6 end
from public.limpieza_aposentos a
join public.limpieza_labores l on l.nombre in ('Limpiar pizarras', 'Limpiar pantalla')
where a.activo and a.tipo = 'aula'
on conflict (aposento_id, labor_id) do nothing;

insert into public.limpieza_aposento_labores (aposento_id, labor_id, obligatoria, orden)
select a.id, l.id, true, 5
from public.limpieza_aposentos a
join public.limpieza_labores l on l.nombre = 'Limpiar pantalla'
where a.activo and a.tipo = 'oficina'
on conflict (aposento_id, labor_id) do nothing;

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('limpieza-reportes', 'limpieza-reportes', false, 1048576, array['image/jpeg'])
on conflict (id) do update set
  public = false,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

create or replace function public.limpieza_api_login(p_password text)
returns table(id uuid, nombre text)
language sql
security definer
set search_path = ''
as $$
  select c.id, c.nombre
  from public.limpieza_conserjes c
  where c.activo
    and c.password_hash = extensions.crypt(p_password, c.password_hash)
  limit 1;
$$;

create or replace function public.limpieza_api_contexto(p_password text, p_slug text)
returns table(
  conserje_id uuid,
  conserje_nombre text,
  aposento_id uuid,
  aposento_nombre text,
  aposento_tipo text,
  foto_requerida boolean,
  labores jsonb
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_fecha date := (now() at time zone 'America/Costa_Rica')::date;
  v_conserje_id uuid;
  v_conserje_nombre text;
  v_aposento_id uuid;
  v_aposento_nombre text;
  v_aposento_tipo text;
  v_foto_requerida boolean := false;
  v_labores jsonb;
begin
  select c.id, c.nombre into v_conserje_id, v_conserje_nombre
  from public.limpieza_conserjes c
  where c.activo and c.password_hash = extensions.crypt(p_password, c.password_hash)
  limit 1;
  if v_conserje_id is null then raise exception 'Credenciales invalidas'; end if;

  select a.id, a.nombre, a.tipo into v_aposento_id, v_aposento_nombre, v_aposento_tipo
  from public.limpieza_aposentos a where a.activo and a.slug = trim(p_slug);
  if v_aposento_id is null then raise exception 'Aposento no reconocido'; end if;

  if exists (
    select 1 from public.limpieza_programacion p
    where p.aposento_id = v_aposento_id
      and p.dia_semana = extract(dow from v_fecha)::smallint
      and p.vigente_desde <= v_fecha
      and (p.vigente_hasta is null or p.vigente_hasta >= v_fecha)
      and p.conserje_id <> v_conserje_id
  ) then
    raise exception 'Este aposento esta asignado a otro conserje para hoy';
  end if;

  select coalesce(bool_or(p.foto_requerida), false) into v_foto_requerida
  from public.limpieza_programacion p
  where p.aposento_id = v_aposento_id and p.conserje_id = v_conserje_id
    and p.dia_semana = extract(dow from v_fecha)::smallint
    and p.vigente_desde <= v_fecha
    and (p.vigente_hasta is null or p.vigente_hasta >= v_fecha);

  select coalesce(jsonb_agg(jsonb_build_object(
    'id', l.id, 'nombre', l.nombre, 'obligatoria', al.obligatoria
  ) order by al.orden, l.nombre), '[]'::jsonb) into v_labores
  from public.limpieza_aposento_labores al
  join public.limpieza_labores l on l.id = al.labor_id
  where al.aposento_id = v_aposento_id and al.activo and l.activo;

  return query select v_conserje_id, v_conserje_nombre, v_aposento_id,
    v_aposento_nombre, v_aposento_tipo, v_foto_requerida, v_labores;
end;
$$;

create or replace function public.limpieza_api_resumen(p_password text, p_fecha date)
returns table(
  aposento_id uuid,
  aposento text,
  aposento_tipo text,
  programado boolean,
  reportado boolean,
  cantidad_reportes bigint,
  ultima_hora time,
  labores_pendientes jsonb,
  foto_adjunta boolean,
  foto_requerida boolean
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_conserje_id uuid;
begin
  if p_fecha is null then raise exception 'Fecha requerida'; end if;
  select c.id into v_conserje_id from public.limpieza_conserjes c
  where c.activo and c.password_hash = extensions.crypt(p_password, c.password_hash)
  limit 1;
  if v_conserje_id is null then raise exception 'Credenciales invalidas'; end if;

  return query
  with programados as (
    select p.aposento_id, bool_or(p.foto_requerida) as foto_requerida
    from public.limpieza_programacion p
    where p.conserje_id = v_conserje_id
      and p.dia_semana = extract(dow from p_fecha)::smallint
      and p.vigente_desde <= p_fecha
      and (p.vigente_hasta is null or p.vigente_hasta >= p_fecha)
    group by p.aposento_id
  ), reportes_dia as (
    select r.*,
      count(*) over (partition by r.aposento_id) as cantidad,
      row_number() over (partition by r.aposento_id order by r.fecha desc) as orden
    from public.limpieza_reportes r
    where r.conserje_id = v_conserje_id
      and (r.fecha at time zone 'America/Costa_Rica')::date = p_fecha
  ), ultimos as (
    select * from reportes_dia where orden = 1
  ), recintos as (
    select p.aposento_id from programados p
    union
    select r.aposento_id from ultimos r
  )
  select a.id, a.nombre, a.tipo,
    (p.aposento_id is not null),
    (r.id is not null),
    coalesce(r.cantidad, 0)::bigint,
    (r.fecha at time zone 'America/Costa_Rica')::time,
    case when r.id is null or r.formulario_version < 2 then '[]'::jsonb else coalesce((
      select jsonb_agg(jsonb_build_object('nombre', l.nombre, 'obligatoria', al.obligatoria) order by al.orden)
      from public.limpieza_aposento_labores al
      join public.limpieza_labores l on l.id = al.labor_id
      where al.aposento_id = a.id and al.activo and l.activo
        and not exists (
          select 1 from jsonb_array_elements(r.checklist) e
          where e->>'labor_id' = l.id::text and e->>'completada' = 'true'
        )
    ), '[]'::jsonb) end,
    (r.foto_path is not null),
    coalesce(p.foto_requerida, false)
  from recintos x
  join public.limpieza_aposentos a on a.id = x.aposento_id
  left join programados p on p.aposento_id = a.id
  left join ultimos r on r.aposento_id = a.id
  order by (r.id is null) desc, a.nombre;
end;
$$;

create or replace function public.limpieza_api_crear_reporte(
  p_report_id uuid,
  p_aposento_slug text,
  p_conserje_password text,
  p_checklist jsonb,
  p_observaciones text,
  p_foto_path text,
  p_foto_mime text,
  p_foto_bytes integer
)
returns table(ok boolean, conserje_nombre text, aposento_nombre text, mensaje text)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_fecha date := (now() at time zone 'America/Costa_Rica')::date;
  v_conserje_id uuid;
  v_conserje_nombre text;
  v_aposento_id uuid;
  v_aposento_nombre text;
  v_programacion_id uuid;
  v_foto_requerida boolean := false;
  v_checklist jsonb;
begin
  if p_report_id is null then raise exception 'Identificador requerido'; end if;
  select c.id, c.nombre into v_conserje_id, v_conserje_nombre
  from public.limpieza_conserjes c
  where c.activo and c.password_hash = extensions.crypt(p_conserje_password, c.password_hash)
  limit 1;
  if v_conserje_id is null then raise exception 'Credenciales invalidas'; end if;

  select a.id, a.nombre into v_aposento_id, v_aposento_nombre
  from public.limpieza_aposentos a where a.activo and a.slug = trim(p_aposento_slug);
  if v_aposento_id is null then raise exception 'Aposento no reconocido'; end if;

  if exists (
    select 1 from public.limpieza_programacion p
    where p.aposento_id = v_aposento_id
      and p.dia_semana = extract(dow from v_fecha)::smallint
      and p.vigente_desde <= v_fecha
      and (p.vigente_hasta is null or p.vigente_hasta >= v_fecha)
      and p.conserje_id <> v_conserje_id
  ) then raise exception 'Este aposento esta asignado a otro conserje para hoy'; end if;

  select p.id, p.foto_requerida into v_programacion_id, v_foto_requerida
  from public.limpieza_programacion p
  where p.aposento_id = v_aposento_id and p.conserje_id = v_conserje_id
    and p.dia_semana = extract(dow from v_fecha)::smallint
    and p.vigente_desde <= v_fecha
    and (p.vigente_hasta is null or p.vigente_hasta >= v_fecha)
  order by p.vigente_desde desc limit 1;

  if jsonb_typeof(coalesce(p_checklist, 'null'::jsonb)) <> 'array' then
    raise exception 'Checklist invalido';
  end if;
  if exists (
    select 1 from jsonb_array_elements(p_checklist) e
    where jsonb_typeof(e) <> 'object'
      or nullif(e->>'labor_id', '') is null
      or jsonb_typeof(e->'completada') <> 'boolean'
  ) then raise exception 'Checklist invalido'; end if;
  if exists (
    select 1 from jsonb_array_elements(p_checklist) e
    left join public.limpieza_aposento_labores al
      on al.aposento_id = v_aposento_id and al.labor_id::text = e->>'labor_id' and al.activo
    where al.labor_id is null
  ) then raise exception 'El checklist contiene labores no validas'; end if;
  if exists (
    select e->>'labor_id' from jsonb_array_elements(p_checklist) e
    group by e->>'labor_id' having count(*) > 1
  ) then raise exception 'El checklist contiene labores duplicadas'; end if;

  select coalesce(jsonb_agg(jsonb_build_object(
    'labor_id', l.id,
    'nombre', l.nombre,
    'obligatoria', al.obligatoria,
    'completada', coalesce((
      select (e->>'completada')::boolean from jsonb_array_elements(p_checklist) e
      where e->>'labor_id' = l.id::text limit 1
    ), false)
  ) order by al.orden, l.nombre), '[]'::jsonb) into v_checklist
  from public.limpieza_aposento_labores al
  join public.limpieza_labores l on l.id = al.labor_id
  where al.aposento_id = v_aposento_id and al.activo and l.activo;

  if v_foto_requerida and p_foto_path is null then
    raise exception 'Este turno requiere una fotografia';
  end if;
  if p_foto_path is not null then
    if p_foto_mime <> 'image/jpeg' or p_foto_bytes not between 1 and 1048576 then
      raise exception 'Fotografia invalida';
    end if;
    if p_foto_path <> v_conserje_id::text || '/' || v_fecha::text || '/' || p_report_id::text || '.jpg' then
      raise exception 'Ruta de fotografia invalida';
    end if;
    if not exists (
      select 1 from storage.objects o
      where o.bucket_id = 'limpieza-reportes' and o.name = p_foto_path
    ) then raise exception 'No se encontro la fotografia'; end if;
  end if;
  if char_length(coalesce(p_observaciones, '')) > 2000 then
    raise exception 'Las observaciones son demasiado extensas';
  end if;

  insert into public.limpieza_reportes (
    id, aposento_id, conserje_id, programacion_id, checklist, observaciones,
    foto_path, foto_mime, foto_bytes, formulario_version
  ) values (
    p_report_id, v_aposento_id, v_conserje_id, v_programacion_id, v_checklist,
    nullif(trim(p_observaciones), ''), p_foto_path, p_foto_mime, p_foto_bytes, 2
  );

  return query select true, v_conserje_nombre, v_aposento_nombre, 'Reporte enviado correctamente'::text;
end;
$$;

-- Las fotografias se cargan exclusivamente con la clave de servicio desde la
-- funcion de borde. El bucket permanece privado y sin politicas de cliente.
revoke all on function public.limpieza_api_login(text) from public, anon, authenticated;
revoke all on function public.limpieza_api_contexto(text, text) from public, anon, authenticated;
revoke all on function public.limpieza_api_resumen(text, date) from public, anon, authenticated;
revoke all on function public.limpieza_api_crear_reporte(uuid, text, text, jsonb, text, text, text, integer) from public, anon, authenticated;
grant execute on function public.limpieza_api_login(text) to service_role;
grant execute on function public.limpieza_api_contexto(text, text) to service_role;
grant execute on function public.limpieza_api_resumen(text, date) to service_role;
grant execute on function public.limpieza_api_crear_reporte(uuid, text, text, jsonb, text, text, text, integer) to service_role;

-- Deshabilita los RPC antiguos que permitian omitir el flujo nuevo.
revoke all on function public.limpieza_login_conserje(text) from public, anon, authenticated;
revoke all on function public.limpieza_get_aposento(text) from public, anon, authenticated;
revoke all on function public.limpieza_crear_reporte(text, text, text, jsonb, text) from public, anon, authenticated;
