-- Sesiones persistentes y API v3 de conserjería.
-- El navegador conserva únicamente un token opaco; la contraseña nunca se
-- guarda. La vigencia se renueva mientras el dispositivo siga en uso.

create table public.limpieza_sesiones (
  id uuid primary key default gen_random_uuid(),
  conserje_id uuid not null references public.limpieza_conserjes(id) on delete cascade,
  token_hash text not null unique check (token_hash ~ '^[0-9a-f]{64}$'),
  created_at timestamptz not null default now(),
  last_used_at timestamptz not null default now(),
  expires_at timestamptz not null default (now() + interval '180 days'),
  revoked_at timestamptz,
  constraint limpieza_sesiones_expiracion_valida check (expires_at > created_at)
);

create index limpieza_sesiones_conserje_activas_idx
  on public.limpieza_sesiones (conserje_id, expires_at desc)
  where revoked_at is null;

alter table public.limpieza_sesiones enable row level security;
revoke all on public.limpieza_sesiones from anon, authenticated;

create or replace function public.limpieza_api_crear_sesion(
  p_password text,
  p_token_hash text
)
returns table(id uuid, nombre text)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_conserje_id uuid;
  v_nombre text;
begin
  if p_token_hash !~ '^[0-9a-f]{64}$' then raise exception 'Token invalido'; end if;

  select c.id, c.nombre into v_conserje_id, v_nombre
  from public.limpieza_conserjes c
  where c.activo and c.password_hash = extensions.crypt(p_password, c.password_hash)
  limit 1;
  if v_conserje_id is null then raise exception 'Credenciales invalidas'; end if;

  delete from public.limpieza_sesiones
  where expires_at <= now() or revoked_at is not null;

  insert into public.limpieza_sesiones (conserje_id, token_hash)
  values (v_conserje_id, p_token_hash);

  -- Conserva como máximo cinco dispositivos/sesiones activos por conserje.
  delete from public.limpieza_sesiones s
  using (
    select id from (
      select id, row_number() over (order by last_used_at desc) as posicion
      from public.limpieza_sesiones
      where conserje_id = v_conserje_id and revoked_at is null and expires_at > now()
    ) x where posicion > 5
  ) antiguas
  where s.id = antiguas.id;

  return query select v_conserje_id, v_nombre;
end;
$$;

create or replace function public.limpieza_sesion_conserje(p_token_hash text)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_conserje_id uuid;
begin
  if p_token_hash !~ '^[0-9a-f]{64}$' then return null; end if;
  update public.limpieza_sesiones s
  set last_used_at = now(), expires_at = now() + interval '180 days'
  where s.token_hash = p_token_hash
    and s.revoked_at is null
    and s.expires_at > now()
  returning s.conserje_id into v_conserje_id;
  return v_conserje_id;
end;
$$;

create or replace function public.limpieza_api_cerrar_sesion(p_token_hash text)
returns boolean
language sql
security definer
set search_path = ''
as $$
  with actualizada as (
    update public.limpieza_sesiones
    set revoked_at = now()
    where token_hash = p_token_hash and revoked_at is null
    returning 1
  )
  select exists(select 1 from actualizada);
$$;

create or replace function public.limpieza_api_contexto_v3(p_token_hash text, p_slug text)
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
  v_conserje_id uuid := public.limpieza_sesion_conserje(p_token_hash);
  v_conserje_nombre text;
  v_aposento_id uuid;
  v_aposento_nombre text;
  v_aposento_tipo text;
  v_programacion_id uuid;
  v_foto_requerida boolean := false;
  v_labores jsonb;
begin
  if v_conserje_id is null then raise exception 'Sesion invalida'; end if;
  select c.nombre into v_conserje_nombre from public.limpieza_conserjes c
  where c.id = v_conserje_id and c.activo;
  if v_conserje_nombre is null then raise exception 'Sesion invalida'; end if;

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
  ) then raise exception 'Este aposento esta asignado a otro conserje para hoy'; end if;

  select p.id into v_programacion_id
  from public.limpieza_programacion p
  where p.aposento_id = v_aposento_id and p.conserje_id = v_conserje_id
    and p.dia_semana = extract(dow from v_fecha)::smallint
    and p.vigente_desde <= v_fecha
    and (p.vigente_hasta is null or p.vigente_hasta >= v_fecha)
  order by p.vigente_desde desc limit 1;
  if v_programacion_id is not null then
    v_foto_requerida := public.limpieza_turno_foto_pendiente(v_programacion_id, v_conserje_id, v_fecha);
  end if;

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

create or replace function public.limpieza_api_resumen_v3(p_token_hash text, p_fecha date)
returns table(
  aposento_id uuid,
  aposento_slug text,
  aposento text,
  aposento_tipo text,
  programado boolean,
  reportado boolean,
  cantidad_reportes bigint,
  ultima_hora time,
  labores_pendientes jsonb,
  foto_adjunta boolean,
  foto_requerida boolean,
  labores jsonb
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_conserje_id uuid := public.limpieza_sesion_conserje(p_token_hash);
begin
  if p_fecha is null then raise exception 'Fecha requerida'; end if;
  if v_conserje_id is null then raise exception 'Sesion invalida'; end if;

  return query
  with programados as (
    select distinct on (p.aposento_id) p.aposento_id, p.id
    from public.limpieza_programacion p
    where p.conserje_id = v_conserje_id
      and p.dia_semana = extract(dow from p_fecha)::smallint
      and p.vigente_desde <= p_fecha
      and (p.vigente_hasta is null or p.vigente_hasta >= p_fecha)
    order by p.aposento_id, p.vigente_desde desc
  ), reportes_dia as (
    select r.*, count(*) over (partition by r.aposento_id) as cantidad,
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
  select a.id, a.slug, a.nombre, a.tipo,
    (p.aposento_id is not null), (r.id is not null), coalesce(r.cantidad, 0)::bigint,
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
    case when p.id is null then false
      else public.limpieza_turno_foto_pendiente(p.id, v_conserje_id, p_fecha)
    end,
    coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', l.id, 'nombre', l.nombre, 'obligatoria', al.obligatoria
      ) order by al.orden, l.nombre)
      from public.limpieza_aposento_labores al
      join public.limpieza_labores l on l.id = al.labor_id
      where al.aposento_id = a.id and al.activo and l.activo
    ), '[]'::jsonb)
  from recintos x
  join public.limpieza_aposentos a on a.id = x.aposento_id
  left join programados p on p.aposento_id = a.id
  left join ultimos r on r.aposento_id = a.id
  order by (r.id is null) desc, a.nombre;
end;
$$;

create or replace function public.limpieza_api_reportes_v3(p_token_hash text, p_fecha date)
returns table(
  reporte_id uuid,
  aposento_id uuid,
  aposento text,
  aposento_tipo text,
  fecha timestamptz,
  checklist jsonb,
  observaciones text,
  foto_adjunta boolean
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_conserje_id uuid := public.limpieza_sesion_conserje(p_token_hash);
begin
  if p_fecha is null then raise exception 'Fecha requerida'; end if;
  if v_conserje_id is null then raise exception 'Sesion invalida'; end if;
  return query
  select r.id, a.id, a.nombre, a.tipo, r.fecha, r.checklist,
    r.observaciones, (r.foto_path is not null)
  from public.limpieza_reportes r
  join public.limpieza_aposentos a on a.id = r.aposento_id
  where r.conserje_id = v_conserje_id
    and (r.fecha at time zone 'America/Costa_Rica')::date = p_fecha
  order by r.fecha desc;
end;
$$;

create or replace function public.limpieza_api_crear_reporte_v3(
  p_report_id uuid,
  p_aposento_slug text,
  p_token_hash text,
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
  v_conserje_id uuid := public.limpieza_sesion_conserje(p_token_hash);
  v_conserje_nombre text;
  v_aposento_id uuid;
  v_aposento_nombre text;
  v_programacion_id uuid;
  v_foto_requerida boolean := false;
  v_checklist jsonb;
begin
  if p_report_id is null then raise exception 'Identificador requerido'; end if;
  if v_conserje_id is null then raise exception 'Sesion invalida'; end if;
  select c.nombre into v_conserje_nombre from public.limpieza_conserjes c
  where c.id = v_conserje_id and c.activo;
  if v_conserje_nombre is null then raise exception 'Sesion invalida'; end if;

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

  select p.id into v_programacion_id
  from public.limpieza_programacion p
  where p.aposento_id = v_aposento_id and p.conserje_id = v_conserje_id
    and p.dia_semana = extract(dow from v_fecha)::smallint
    and p.vigente_desde <= v_fecha
    and (p.vigente_hasta is null or p.vigente_hasta >= v_fecha)
  order by p.vigente_desde desc limit 1;
  if v_programacion_id is not null then
    v_foto_requerida := public.limpieza_turno_foto_pendiente(v_programacion_id, v_conserje_id, v_fecha);
  end if;

  if jsonb_typeof(coalesce(p_checklist, 'null'::jsonb)) <> 'array' then raise exception 'Checklist invalido'; end if;
  if exists (
    select 1 from jsonb_array_elements(p_checklist) e
    where jsonb_typeof(e) <> 'object' or nullif(e->>'labor_id', '') is null
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
    'labor_id', l.id, 'nombre', l.nombre, 'obligatoria', al.obligatoria,
    'completada', coalesce((
      select (e->>'completada')::boolean from jsonb_array_elements(p_checklist) e
      where e->>'labor_id' = l.id::text limit 1
    ), false)
  ) order by al.orden, l.nombre), '[]'::jsonb) into v_checklist
  from public.limpieza_aposento_labores al
  join public.limpieza_labores l on l.id = al.labor_id
  where al.aposento_id = v_aposento_id and al.activo and l.activo;

  if v_foto_requerida and p_foto_path is null then raise exception 'Este turno requiere una fotografia'; end if;
  if p_foto_path is not null then
    if p_foto_mime <> 'image/jpeg' or p_foto_bytes not between 1 and 1048576 then raise exception 'Fotografia invalida'; end if;
    if p_foto_path <> v_conserje_id::text || '/' || v_fecha::text || '/' || p_report_id::text || '.jpg' then raise exception 'Ruta de fotografia invalida'; end if;
    if not exists (
      select 1 from storage.objects o where o.bucket_id = 'limpieza-reportes' and o.name = p_foto_path
    ) then raise exception 'No se encontro la fotografia'; end if;
  end if;
  if char_length(coalesce(p_observaciones, '')) > 2000 then raise exception 'Las observaciones son demasiado extensas'; end if;

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

revoke all on function public.limpieza_api_crear_sesion(text, text) from public, anon, authenticated;
revoke all on function public.limpieza_sesion_conserje(text) from public, anon, authenticated;
revoke all on function public.limpieza_api_cerrar_sesion(text) from public, anon, authenticated;
revoke all on function public.limpieza_api_contexto_v3(text, text) from public, anon, authenticated;
revoke all on function public.limpieza_api_resumen_v3(text, date) from public, anon, authenticated;
revoke all on function public.limpieza_api_reportes_v3(text, date) from public, anon, authenticated;
revoke all on function public.limpieza_api_crear_reporte_v3(uuid, text, text, jsonb, text, text, text, integer) from public, anon, authenticated;

grant execute on function public.limpieza_api_crear_sesion(text, text) to service_role;
grant execute on function public.limpieza_sesion_conserje(text) to service_role;
grant execute on function public.limpieza_api_cerrar_sesion(text) to service_role;
grant execute on function public.limpieza_api_contexto_v3(text, text) to service_role;
grant execute on function public.limpieza_api_resumen_v3(text, date) to service_role;
grant execute on function public.limpieza_api_reportes_v3(text, date) to service_role;
grant execute on function public.limpieza_api_crear_reporte_v3(uuid, text, text, jsonb, text, text, text, integer) to service_role;
