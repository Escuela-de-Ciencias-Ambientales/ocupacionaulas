-- Conserjería v4: rutinas por turno, escaneo verificable, duración de reportes
-- y administración integral para la jefatura.

create table public.limpieza_rutinas (
  id uuid primary key default gen_random_uuid(),
  codigo text not null unique check (codigo ~ '^[a-z0-9-]{4,100}$'),
  aposento_id uuid not null references public.limpieza_aposentos(id) on delete cascade,
  nombre text not null check (char_length(trim(nombre)) between 2 and 120),
  activo boolean not null default true,
  created_at timestamptz not null default now()
);

create table public.limpieza_rutina_labores (
  rutina_id uuid not null references public.limpieza_rutinas(id) on delete cascade,
  labor_id uuid not null references public.limpieza_labores(id) on delete restrict,
  obligatoria boolean not null default true,
  orden smallint not null default 1 check (orden between 1 and 100),
  activo boolean not null default true,
  created_at timestamptz not null default now(),
  primary key (rutina_id, labor_id)
);

alter table public.limpieza_programacion
  drop constraint if exists limpieza_programacion_asignacion_unica;

alter table public.limpieza_programacion
  add column if not exists rutina_id uuid references public.limpieza_rutinas(id) on delete restrict;

alter table public.limpieza_programacion
  add constraint limpieza_programacion_horario_valido_v4
  check (
    (hora_inicio is null and hora_fin is null)
    or (hora_inicio is not null and hora_fin is not null and hora_fin > hora_inicio)
  );

create unique index limpieza_programacion_turno_codigo_v4_idx
  on public.limpieza_programacion (turno_codigo)
  where turno_codigo is not null;

create unique index limpieza_programacion_asignacion_v4_idx
  on public.limpieza_programacion (
    conserje_id, aposento_id, dia_semana, coalesce(hora_inicio, '00:00'::time), vigente_desde
  );

create index limpieza_programacion_rutina_v4_idx
  on public.limpieza_programacion (rutina_id, dia_semana, hora_inicio);

-- Conserva funcionales los recintos históricos aun antes de cargar el Excel.
insert into public.limpieza_rutinas (codigo, aposento_id, nombre)
select a.slug || '-general', a.id, 'Rutina general'
from public.limpieza_aposentos a
where a.activo
on conflict (codigo) do nothing;

insert into public.limpieza_rutina_labores (rutina_id, labor_id, obligatoria, orden, activo)
select r.id, al.labor_id, al.obligatoria, al.orden, al.activo
from public.limpieza_rutinas r
join public.limpieza_aposento_labores al on al.aposento_id = r.aposento_id
where r.codigo = (select a.slug || '-general' from public.limpieza_aposentos a where a.id = r.aposento_id)
on conflict (rutina_id, labor_id) do update set
  obligatoria = excluded.obligatoria,
  orden = excluded.orden,
  activo = excluded.activo;

update public.limpieza_programacion p
set rutina_id = r.id
from public.limpieza_rutinas r
where p.rutina_id is null
  and r.aposento_id = p.aposento_id
  and r.codigo = (select a.slug || '-general' from public.limpieza_aposentos a where a.id = p.aposento_id);

create table public.limpieza_escaneos (
  id uuid primary key default gen_random_uuid(),
  conserje_id uuid not null references public.limpieza_conserjes(id) on delete restrict,
  aposento_id uuid not null references public.limpieza_aposentos(id) on delete restrict,
  programacion_id uuid not null references public.limpieza_programacion(id) on delete restrict,
  rutina_id uuid not null references public.limpieza_rutinas(id) on delete restrict,
  iniciado_at timestamptz not null default now(),
  expira_at timestamptz not null default (now() + interval '2 hours'),
  reporte_id uuid references public.limpieza_reportes(id) on delete set null,
  constraint limpieza_escaneos_expiracion_v4 check (expira_at > iniciado_at)
);

create index limpieza_escaneos_pendientes_v4_idx
  on public.limpieza_escaneos (conserje_id, iniciado_at desc)
  where reporte_id is null;

alter table public.limpieza_reportes
  add column if not exists rutina_id uuid references public.limpieza_rutinas(id) on delete set null,
  add column if not exists escaneo_id uuid references public.limpieza_escaneos(id) on delete set null,
  add column if not exists escaneado_at timestamptz,
  add column if not exists enviado_at timestamptz,
  add column if not exists duracion_segundos integer;

alter table public.limpieza_reportes
  add constraint limpieza_reportes_duracion_v4 check (
    (duracion_segundos is null and (escaneado_at is null or enviado_at is null))
    or (
      duracion_segundos between 0 and 7200
      and escaneado_at is not null
      and enviado_at is not null
      and enviado_at >= escaneado_at
    )
  );

create unique index limpieza_reportes_escaneo_v4_idx
  on public.limpieza_reportes (escaneo_id)
  where escaneo_id is not null;

create index limpieza_reportes_dashboard_v4_idx
  on public.limpieza_reportes (conserje_id, enviado_at desc, aposento_id);

alter table public.limpieza_rutinas enable row level security;
alter table public.limpieza_rutina_labores enable row level security;
alter table public.limpieza_escaneos enable row level security;
revoke all on public.limpieza_rutinas from anon, authenticated;
revoke all on public.limpieza_rutina_labores from anon, authenticated;
revoke all on public.limpieza_escaneos from anon, authenticated;

create or replace function public.limpieza_es_admin_conserjeria()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.profiles
    where id = (select auth.uid())
      and role = 'admin'
      and admin_scope in ('conserjeria', 'operations', 'superadmin')
      and active = true
  );
$$;

create or replace function public.limpieza_api_contexto_v4(p_token_hash text, p_slug text)
returns table(
  escaneo_id uuid,
  escaneado_at timestamptz,
  conserje_id uuid,
  conserje_nombre text,
  aposento_id uuid,
  aposento_nombre text,
  aposento_tipo text,
  programacion_id uuid,
  rutina_id uuid,
  rutina_nombre text,
  hora_inicio time,
  hora_fin time,
  foto_requerida boolean,
  labores jsonb
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_fecha date := (now() at time zone 'America/Costa_Rica')::date;
  v_hora time := (now() at time zone 'America/Costa_Rica')::time;
  v_conserje_id uuid := public.limpieza_sesion_conserje(p_token_hash);
  v_conserje_nombre text;
  v_aposento_id uuid;
  v_aposento_nombre text;
  v_aposento_tipo text;
  v_programacion public.limpieza_programacion%rowtype;
  v_rutina_nombre text;
  v_escaneo_id uuid;
  v_escaneado_at timestamptz;
  v_labores jsonb;
begin
  if v_conserje_id is null then raise exception 'Sesion invalida'; end if;
  select c.nombre into v_conserje_nombre
  from public.limpieza_conserjes c where c.id = v_conserje_id and c.activo;
  if v_conserje_nombre is null then raise exception 'Sesion invalida'; end if;

  select a.id, a.nombre, a.tipo into v_aposento_id, v_aposento_nombre, v_aposento_tipo
  from public.limpieza_aposentos a where a.activo and a.slug = trim(p_slug);
  if v_aposento_id is null then raise exception 'Aposento no reconocido'; end if;

  select p.* into v_programacion
  from public.limpieza_programacion p
  where p.aposento_id = v_aposento_id
    and p.conserje_id = v_conserje_id
    and p.dia_semana = extract(dow from v_fecha)::smallint
    and p.vigente_desde <= v_fecha
    and (p.vigente_hasta is null or p.vigente_hasta >= v_fecha)
    and p.rutina_id is not null
    and not exists (
      select 1 from public.limpieza_reportes rep
      where rep.programacion_id = p.id
        and (coalesce(rep.enviado_at, rep.fecha) at time zone 'America/Costa_Rica')::date = v_fecha
    )
  order by
    case when v_hora between coalesce(p.hora_inicio, v_hora) and coalesce(p.hora_fin, v_hora) then 0 else 1 end,
    abs(extract(epoch from (v_hora - coalesce(p.hora_inicio + (p.hora_fin - p.hora_inicio) / 2, v_hora))))
  limit 1;

  if v_programacion.id is null then
    if exists (
      select 1 from public.limpieza_programacion p
      where p.aposento_id = v_aposento_id
        and p.conserje_id = v_conserje_id
        and p.dia_semana = extract(dow from v_fecha)::smallint
        and p.vigente_desde <= v_fecha
        and (p.vigente_hasta is null or p.vigente_hasta >= v_fecha)
    ) then
      raise exception 'Ya completaste las tareas programadas para este recinto hoy';
    elsif exists (
      select 1 from public.limpieza_programacion p
      where p.aposento_id = v_aposento_id
        and p.dia_semana = extract(dow from v_fecha)::smallint
        and p.vigente_desde <= v_fecha
        and (p.vigente_hasta is null or p.vigente_hasta >= v_fecha)
    ) then
      raise exception 'Este aposento esta asignado a otro conserje para hoy';
    else
      raise exception 'Este aposento no esta programado para ti hoy';
    end if;
  end if;

  select r.nombre into v_rutina_nombre
  from public.limpieza_rutinas r where r.id = v_programacion.rutina_id and r.activo;
  if v_rutina_nombre is null then raise exception 'La rutina de este turno no esta activa'; end if;

  select coalesce(jsonb_agg(jsonb_build_object(
    'id', l.id, 'nombre', l.nombre, 'obligatoria', rl.obligatoria
  ) order by rl.orden, l.nombre), '[]'::jsonb) into v_labores
  from public.limpieza_rutina_labores rl
  join public.limpieza_labores l on l.id = rl.labor_id
  where rl.rutina_id = v_programacion.rutina_id and rl.activo and l.activo;
  if jsonb_array_length(v_labores) = 0 then
    raise exception 'Este turno aun no tiene labores configuradas';
  end if;

  insert into public.limpieza_escaneos (conserje_id, aposento_id, programacion_id, rutina_id)
  values (v_conserje_id, v_aposento_id, v_programacion.id, v_programacion.rutina_id)
  returning id, iniciado_at into v_escaneo_id, v_escaneado_at;

  return query select v_escaneo_id, v_escaneado_at, v_conserje_id,
    v_conserje_nombre, v_aposento_id, v_aposento_nombre, v_aposento_tipo,
    v_programacion.id, v_programacion.rutina_id, v_rutina_nombre,
    v_programacion.hora_inicio, v_programacion.hora_fin,
    v_programacion.foto_requerida, v_labores;
end;
$$;

create or replace function public.limpieza_api_crear_reporte_v4(
  p_report_id uuid,
  p_escaneo_id uuid,
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
  v_conserje_id uuid := public.limpieza_sesion_conserje(p_token_hash);
  v_scan public.limpieza_escaneos%rowtype;
  v_conserje_nombre text;
  v_aposento_nombre text;
  v_foto_requerida boolean;
  v_checklist jsonb;
  v_enviado_at timestamptz := now();
  v_duracion integer;
begin
  if p_report_id is null or p_escaneo_id is null then raise exception 'Identificador requerido'; end if;
  if v_conserje_id is null then raise exception 'Sesion invalida'; end if;
  select * into v_scan from public.limpieza_escaneos s
  where s.id = p_escaneo_id and s.conserje_id = v_conserje_id for update;
  if v_scan.id is null or v_scan.reporte_id is not null or v_scan.expira_at <= now() then
    raise exception 'El escaneo vencio. Escanea nuevamente el codigo QR';
  end if;

  select c.nombre, a.nombre, p.foto_requerida
  into v_conserje_nombre, v_aposento_nombre, v_foto_requerida
  from public.limpieza_conserjes c
  join public.limpieza_aposentos a on a.id = v_scan.aposento_id
  join public.limpieza_programacion p on p.id = v_scan.programacion_id
  where c.id = v_conserje_id and c.activo and a.activo;

  if jsonb_typeof(coalesce(p_checklist, 'null'::jsonb)) <> 'array' then raise exception 'Checklist invalido'; end if;
  if exists (
    select 1 from jsonb_array_elements(p_checklist) e
    where jsonb_typeof(e) <> 'object' or nullif(e->>'labor_id', '') is null
      or jsonb_typeof(e->'completada') <> 'boolean'
  ) then raise exception 'Checklist invalido'; end if;
  if exists (
    select 1 from jsonb_array_elements(p_checklist) e
    left join public.limpieza_rutina_labores rl
      on rl.rutina_id = v_scan.rutina_id and rl.labor_id::text = e->>'labor_id' and rl.activo
    where rl.labor_id is null
  ) then raise exception 'El checklist contiene labores no validas'; end if;
  if exists (
    select e->>'labor_id' from jsonb_array_elements(p_checklist) e
    group by e->>'labor_id' having count(*) > 1
  ) then raise exception 'El checklist contiene labores duplicadas'; end if;

  select coalesce(jsonb_agg(jsonb_build_object(
    'labor_id', l.id, 'nombre', l.nombre, 'obligatoria', rl.obligatoria,
    'completada', coalesce((
      select (e->>'completada')::boolean from jsonb_array_elements(p_checklist) e
      where e->>'labor_id' = l.id::text limit 1
    ), false)
  ) order by rl.orden, l.nombre), '[]'::jsonb) into v_checklist
  from public.limpieza_rutina_labores rl
  join public.limpieza_labores l on l.id = rl.labor_id
  where rl.rutina_id = v_scan.rutina_id and rl.activo and l.activo;

  if v_foto_requerida and p_foto_path is null then raise exception 'Este turno requiere una fotografia'; end if;
  if p_foto_path is not null then
    if p_foto_mime <> 'image/jpeg' or p_foto_bytes not between 1 and 1048576 then raise exception 'Fotografia invalida'; end if;
    if p_foto_path <> 'escaneos/' || p_escaneo_id::text || '/' || p_report_id::text || '.jpg' then raise exception 'Ruta de fotografia invalida'; end if;
    if not exists (select 1 from storage.objects o where o.bucket_id = 'limpieza-reportes' and o.name = p_foto_path) then
      raise exception 'No se encontro la fotografia';
    end if;
  end if;
  if char_length(coalesce(p_observaciones, '')) > 2000 then raise exception 'Las observaciones son demasiado extensas'; end if;

  v_duracion := least(7200, greatest(0, floor(extract(epoch from (v_enviado_at - v_scan.iniciado_at)))::integer));
  insert into public.limpieza_reportes (
    id, aposento_id, conserje_id, programacion_id, rutina_id, escaneo_id,
    checklist, observaciones, foto_path, foto_mime, foto_bytes, formulario_version,
    escaneado_at, enviado_at, duracion_segundos
  ) values (
    p_report_id, v_scan.aposento_id, v_conserje_id, v_scan.programacion_id,
    v_scan.rutina_id, v_scan.id, v_checklist, nullif(trim(p_observaciones), ''),
    p_foto_path, p_foto_mime, p_foto_bytes, 4,
    v_scan.iniciado_at, v_enviado_at, v_duracion
  );
  update public.limpieza_escaneos set reporte_id = p_report_id where id = v_scan.id;

  return query select true, v_conserje_nombre, v_aposento_nombre, 'Reporte enviado correctamente'::text;
end;
$$;

create or replace function public.limpieza_api_resumen_v4(p_token_hash text, p_fecha date)
returns table(
  programacion_id uuid, aposento_id uuid, aposento_slug text, aposento text,
  aposento_tipo text, rutina_id uuid, rutina text, hora_inicio time, hora_fin time,
  reportado boolean, reporte_id uuid, cantidad_reportes bigint, ultima_hora time,
  labores_pendientes jsonb, foto_adjunta boolean, foto_requerida boolean, labores jsonb
)
language plpgsql
security definer
set search_path = ''
as $$
declare v_conserje_id uuid := public.limpieza_sesion_conserje(p_token_hash);
begin
  if p_fecha is null then raise exception 'Fecha requerida'; end if;
  if v_conserje_id is null then raise exception 'Sesion invalida'; end if;
  return query
  select p.id, a.id, a.slug, a.nombre, a.tipo, ru.id, ru.nombre,
    p.hora_inicio, p.hora_fin, (rep.id is not null), rep.id,
    coalesce(rep.cantidad, 0)::bigint,
    (coalesce(rep.enviado_at, rep.fecha) at time zone 'America/Costa_Rica')::time,
    case when rep.id is null then coalesce(lab.labores, '[]'::jsonb) else coalesce((
      select jsonb_agg(x order by x->>'nombre') from jsonb_array_elements(rep.checklist) x
      where x->>'completada' <> 'true'
    ), '[]'::jsonb) end,
    (rep.foto_path is not null), p.foto_requerida and rep.id is null,
    coalesce(lab.labores, '[]'::jsonb)
  from public.limpieza_programacion p
  join public.limpieza_aposentos a on a.id = p.aposento_id and a.activo
  join public.limpieza_rutinas ru on ru.id = p.rutina_id and ru.activo
  left join lateral (
    select r.*, count(*) over () cantidad
    from public.limpieza_reportes r
    where r.programacion_id = p.id
      and (coalesce(r.enviado_at, r.fecha) at time zone 'America/Costa_Rica')::date = p_fecha
    order by coalesce(r.enviado_at, r.fecha) desc limit 1
  ) rep on true
  left join lateral (
    select jsonb_agg(jsonb_build_object('id',l.id,'nombre',l.nombre,'obligatoria',rl.obligatoria)
      order by rl.orden,l.nombre) labores
    from public.limpieza_rutina_labores rl join public.limpieza_labores l on l.id=rl.labor_id
    where rl.rutina_id=p.rutina_id and rl.activo and l.activo
  ) lab on true
  where p.conserje_id = v_conserje_id
    and p.dia_semana = extract(dow from p_fecha)::smallint
    and p.vigente_desde <= p_fecha and (p.vigente_hasta is null or p.vigente_hasta >= p_fecha)
  order by p.hora_inicio nulls last, a.nombre;
end;
$$;

create or replace function public.limpieza_api_reportes_v4(p_token_hash text, p_fecha date)
returns table(
  reporte_id uuid, aposento_id uuid, aposento text, aposento_tipo text,
  rutina text, fecha timestamptz, escaneado_at timestamptz, enviado_at timestamptz,
  duracion_segundos integer, checklist jsonb, observaciones text, foto_adjunta boolean
)
language plpgsql
security definer
set search_path = ''
as $$
declare v_conserje_id uuid := public.limpieza_sesion_conserje(p_token_hash);
begin
  if p_fecha is null then raise exception 'Fecha requerida'; end if;
  if v_conserje_id is null then raise exception 'Sesion invalida'; end if;
  return query select r.id, a.id, a.nombre, a.tipo, ru.nombre, r.fecha,
    r.escaneado_at, r.enviado_at, r.duracion_segundos, r.checklist,
    r.observaciones, (r.foto_path is not null)
  from public.limpieza_reportes r
  join public.limpieza_aposentos a on a.id=r.aposento_id
  left join public.limpieza_rutinas ru on ru.id=r.rutina_id
  where r.conserje_id=v_conserje_id
    and (coalesce(r.enviado_at,r.fecha) at time zone 'America/Costa_Rica')::date=p_fecha
  order by coalesce(r.enviado_at,r.fecha) desc;
end;
$$;

create or replace function public.limpieza_admin_catalogos_v4()
returns table(tipo text, id uuid, nombre text, extra jsonb)
language plpgsql security definer set search_path = '' as $$
begin
  if not public.limpieza_es_admin_conserjeria() then raise exception 'No autorizado'; end if;
  return query
    select 'conserje'::text,c.id,c.nombre,jsonb_build_object('activo',c.activo) from public.limpieza_conserjes c
    union all select 'aposento',a.id,a.nombre,jsonb_build_object('slug',a.slug,'tipo',a.tipo,'activo',a.activo) from public.limpieza_aposentos a
    union all select 'rutina',r.id,r.nombre,jsonb_build_object('codigo',r.codigo,'aposento_id',r.aposento_id,'activo',r.activo) from public.limpieza_rutinas r
    union all select 'labor',l.id,l.nombre,jsonb_build_object('activo',l.activo) from public.limpieza_labores l
    order by 1,3;
end; $$;

create or replace function public.limpieza_admin_programacion_v4()
returns table(
  id uuid, conserje_id uuid, conserje text, aposento_id uuid, aposento text,
  rutina_id uuid, rutina text, dia_semana smallint, hora_inicio time, hora_fin time,
  foto_requerida boolean, vigente_desde date, vigente_hasta date
)
language plpgsql security definer set search_path = '' as $$
begin
  if not public.limpieza_es_admin_conserjeria() then raise exception 'No autorizado'; end if;
  return query select p.id,c.id,c.nombre,a.id,a.nombre,r.id,r.nombre,p.dia_semana,
    p.hora_inicio,p.hora_fin,p.foto_requerida,p.vigente_desde,p.vigente_hasta
  from public.limpieza_programacion p
  join public.limpieza_conserjes c on c.id=p.conserje_id
  join public.limpieza_aposentos a on a.id=p.aposento_id
  left join public.limpieza_rutinas r on r.id=p.rutina_id
  order by p.dia_semana,p.hora_inicio,c.nombre,a.nombre;
end; $$;

create or replace function public.limpieza_admin_guardar_programacion_v4(
  p_id uuid, p_conserje_id uuid, p_aposento_id uuid, p_rutina_id uuid,
  p_dia_semana smallint, p_hora_inicio time, p_hora_fin time,
  p_foto_requerida boolean, p_vigente_desde date, p_vigente_hasta date default null
)
returns uuid language plpgsql security definer set search_path = '' as $$
declare v_id uuid; begin
  if not public.limpieza_es_admin_conserjeria() then raise exception 'No autorizado'; end if;
  if p_dia_semana not between 0 and 6 then raise exception 'Dia invalido'; end if;
  if p_hora_inicio is null or p_hora_fin is null or p_hora_fin <= p_hora_inicio then raise exception 'Horario invalido'; end if;
  if p_vigente_hasta is not null and p_vigente_hasta < p_vigente_desde then raise exception 'Vigencia invalida'; end if;
  if not exists (select 1 from public.limpieza_conserjes where id=p_conserje_id and activo) then raise exception 'Conserje no valido'; end if;
  if not exists (select 1 from public.limpieza_rutinas where id=p_rutina_id and aposento_id=p_aposento_id and activo) then raise exception 'Rutina no valida para el recinto'; end if;
  if exists (
    select 1 from public.limpieza_programacion p where p.aposento_id=p_aposento_id
      and p.dia_semana=p_dia_semana and p.id is distinct from p_id
      and p.hora_inicio < p_hora_fin and p.hora_fin > p_hora_inicio
      and daterange(p.vigente_desde,coalesce(p.vigente_hasta,'infinity'::date),'[]')
        && daterange(p_vigente_desde,coalesce(p_vigente_hasta,'infinity'::date),'[]')
  ) then raise exception 'El recinto ya tiene una asignacion que se superpone'; end if;
  if p_id is null then
    insert into public.limpieza_programacion(conserje_id,aposento_id,rutina_id,dia_semana,hora_inicio,hora_fin,foto_requerida,vigente_desde,vigente_hasta,created_by)
    values(p_conserje_id,p_aposento_id,p_rutina_id,p_dia_semana,p_hora_inicio,p_hora_fin,coalesce(p_foto_requerida,false),p_vigente_desde,p_vigente_hasta,(select auth.uid()))
    returning id into v_id;
  else
    update public.limpieza_programacion set conserje_id=p_conserje_id,aposento_id=p_aposento_id,rutina_id=p_rutina_id,
      dia_semana=p_dia_semana,hora_inicio=p_hora_inicio,hora_fin=p_hora_fin,foto_requerida=coalesce(p_foto_requerida,false),
      vigente_desde=p_vigente_desde,vigente_hasta=p_vigente_hasta where id=p_id returning id into v_id;
    if v_id is null then raise exception 'Asignacion no encontrada'; end if;
  end if;
  return v_id;
end; $$;

create or replace function public.limpieza_admin_cerrar_programacion_v4(p_id uuid)
returns boolean language plpgsql security definer set search_path = '' as $$
declare v_desde date; v_hoy date := (now() at time zone 'America/Costa_Rica')::date; begin
  if not public.limpieza_es_admin_conserjeria() then raise exception 'No autorizado'; end if;
  select vigente_desde into v_desde from public.limpieza_programacion where id=p_id;
  if v_desde is null then return false;
  elsif v_desde > v_hoy then delete from public.limpieza_programacion where id=p_id;
  else update public.limpieza_programacion set vigente_hasta=greatest(vigente_desde,v_hoy) where id=p_id;
  end if; return true;
end; $$;

create or replace function public.limpieza_admin_rutina_labores_v4()
returns table(rutina_id uuid, rutina text, aposento_id uuid, aposento text, labor_id uuid, labor text, asignada boolean, obligatoria boolean, orden smallint)
language plpgsql security definer set search_path = '' as $$
begin
  if not public.limpieza_es_admin_conserjeria() then raise exception 'No autorizado'; end if;
  return query select r.id,r.nombre,a.id,a.nombre,l.id,l.nombre,(rl.labor_id is not null),coalesce(rl.obligatoria,true),coalesce(rl.orden,50)::smallint
  from public.limpieza_rutinas r join public.limpieza_aposentos a on a.id=r.aposento_id
  cross join public.limpieza_labores l left join public.limpieza_rutina_labores rl on rl.rutina_id=r.id and rl.labor_id=l.id and rl.activo
  where r.activo and a.activo and l.activo order by a.nombre,r.nombre,coalesce(rl.orden,50),l.nombre;
end; $$;

create or replace function public.limpieza_admin_guardar_rutina_labor_v4(p_rutina_id uuid,p_labor_id uuid,p_asignada boolean,p_obligatoria boolean,p_orden smallint)
returns boolean language plpgsql security definer set search_path = '' as $$
begin
  if not public.limpieza_es_admin_conserjeria() then raise exception 'No autorizado'; end if;
  if p_orden not between 1 and 100 then raise exception 'Orden invalido'; end if;
  insert into public.limpieza_rutina_labores(rutina_id,labor_id,obligatoria,orden,activo)
  values(p_rutina_id,p_labor_id,coalesce(p_obligatoria,true),p_orden,coalesce(p_asignada,false))
  on conflict(rutina_id,labor_id) do update set obligatoria=excluded.obligatoria,orden=excluded.orden,activo=excluded.activo;
  return true;
end; $$;

create or replace function public.limpieza_admin_crear_labor_v4(p_nombre text)
returns uuid language plpgsql security definer set search_path = '' as $$
declare v_id uuid; begin
  if not public.limpieza_es_admin_conserjeria() then raise exception 'No autorizado'; end if;
  if char_length(trim(coalesce(p_nombre,''))) not between 2 and 120 then raise exception 'Nombre invalido'; end if;
  insert into public.limpieza_labores(nombre,activo) values(trim(p_nombre),true)
  on conflict(nombre) do update set activo=true returning id into v_id; return v_id;
end; $$;

create or replace function public.limpieza_admin_reportes_v4(p_desde date,p_hasta date,p_conserje_id uuid default null,p_aposento_id uuid default null)
returns table(
  id uuid, conserje_id uuid, conserje text, aposento_id uuid, aposento text, aposento_tipo text,
  rutina text, programacion_id uuid, fecha timestamptz, escaneado_at timestamptz, enviado_at timestamptz,
  duracion_segundos integer, checklist jsonb, observaciones text, foto_path text, foto_bytes integer
)
language plpgsql security definer set search_path = '' as $$
begin
  if not public.limpieza_es_admin_conserjeria() then raise exception 'No autorizado'; end if;
  if p_desde is null or p_hasta is null or p_hasta<p_desde or p_hasta-p_desde>3650 then raise exception 'Rango de fechas invalido'; end if;
  return query select rep.id,c.id,c.nombre,a.id,a.nombre,a.tipo,ru.nombre,rep.programacion_id,rep.fecha,
    rep.escaneado_at,rep.enviado_at,rep.duracion_segundos,rep.checklist,rep.observaciones,rep.foto_path,rep.foto_bytes
  from public.limpieza_reportes rep join public.limpieza_conserjes c on c.id=rep.conserje_id
  join public.limpieza_aposentos a on a.id=rep.aposento_id left join public.limpieza_rutinas ru on ru.id=rep.rutina_id
  where (coalesce(rep.enviado_at,rep.fecha) at time zone 'America/Costa_Rica')::date between p_desde and p_hasta
    and (p_conserje_id is null or rep.conserje_id=p_conserje_id)
    and (p_aposento_id is null or rep.aposento_id=p_aposento_id)
  order by coalesce(rep.enviado_at,rep.fecha) desc;
end; $$;

create or replace function public.limpieza_admin_control_diario_v4(p_fecha date,p_conserje_id uuid)
returns table(
  programacion_id uuid, conserje_id uuid, conserje text, aposento_id uuid, aposento text,
  rutina text, hora_inicio time, hora_fin time, foto_requerida boolean, reportado boolean,
  reporte_id uuid, enviado_at timestamptz, duracion_segundos integer, labores_faltantes jsonb
)
language plpgsql security definer set search_path = '' as $$
begin
  if not public.limpieza_es_admin_conserjeria() then raise exception 'No autorizado'; end if;
  if p_fecha is null or p_conserje_id is null then raise exception 'Fecha y conserje requeridos'; end if;
  return query select p.id,c.id,c.nombre,a.id,a.nombre,ru.nombre,p.hora_inicio,p.hora_fin,p.foto_requerida,
    (rep.id is not null),rep.id,coalesce(rep.enviado_at,rep.fecha),rep.duracion_segundos,
    case when rep.id is null then coalesce(lab.labores,'[]'::jsonb) else coalesce((
      select jsonb_agg(x order by x->>'nombre') from jsonb_array_elements(rep.checklist) x where x->>'completada'<>'true'
    ),'[]'::jsonb) end
  from public.limpieza_programacion p join public.limpieza_conserjes c on c.id=p.conserje_id
  join public.limpieza_aposentos a on a.id=p.aposento_id join public.limpieza_rutinas ru on ru.id=p.rutina_id
  left join lateral (
    select r.* from public.limpieza_reportes r where r.programacion_id=p.id
      and (coalesce(r.enviado_at,r.fecha) at time zone 'America/Costa_Rica')::date=p_fecha
    order by coalesce(r.enviado_at,r.fecha) desc limit 1
  ) rep on true
  left join lateral (
    select jsonb_agg(jsonb_build_object('nombre',l.nombre,'obligatoria',rl.obligatoria) order by rl.orden) labores
    from public.limpieza_rutina_labores rl join public.limpieza_labores l on l.id=rl.labor_id
    where rl.rutina_id=p.rutina_id and rl.activo and l.activo
  ) lab on true
  where p.conserje_id=p_conserje_id and p.dia_semana=extract(dow from p_fecha)::smallint
    and p.vigente_desde<=p_fecha and (p.vigente_hasta is null or p.vigente_hasta>=p_fecha)
  order by p.hora_inicio,a.nombre;
end; $$;

drop policy if exists "limpieza jefatura consulta evidencias" on storage.objects;
create policy "limpieza jefatura consulta evidencias" on storage.objects
for select to authenticated
using (
  bucket_id = 'limpieza-reportes'
  and exists (
    select 1 from public.profiles p where p.id=(select auth.uid()) and p.role='admin'
      and p.admin_scope in ('conserjeria','operations','superadmin') and p.active
  )
);

revoke all on function public.limpieza_es_admin_conserjeria() from public,anon;
revoke all on function public.limpieza_api_contexto_v4(text,text) from public,anon,authenticated;
revoke all on function public.limpieza_api_crear_reporte_v4(uuid,uuid,text,jsonb,text,text,text,integer) from public,anon,authenticated;
revoke all on function public.limpieza_api_resumen_v4(text,date) from public,anon,authenticated;
revoke all on function public.limpieza_api_reportes_v4(text,date) from public,anon,authenticated;
grant execute on function public.limpieza_es_admin_conserjeria() to authenticated;
grant execute on function public.limpieza_api_contexto_v4(text,text) to service_role;
grant execute on function public.limpieza_api_crear_reporte_v4(uuid,uuid,text,jsonb,text,text,text,integer) to service_role;
grant execute on function public.limpieza_api_resumen_v4(text,date) to service_role;
grant execute on function public.limpieza_api_reportes_v4(text,date) to service_role;

revoke all on function public.limpieza_admin_catalogos_v4() from public,anon;
revoke all on function public.limpieza_admin_programacion_v4() from public,anon;
revoke all on function public.limpieza_admin_guardar_programacion_v4(uuid,uuid,uuid,uuid,smallint,time,time,boolean,date,date) from public,anon;
revoke all on function public.limpieza_admin_cerrar_programacion_v4(uuid) from public,anon;
revoke all on function public.limpieza_admin_rutina_labores_v4() from public,anon;
revoke all on function public.limpieza_admin_guardar_rutina_labor_v4(uuid,uuid,boolean,boolean,smallint) from public,anon;
revoke all on function public.limpieza_admin_crear_labor_v4(text) from public,anon;
revoke all on function public.limpieza_admin_reportes_v4(date,date,uuid,uuid) from public,anon;
revoke all on function public.limpieza_admin_control_diario_v4(date,uuid) from public,anon;
grant execute on function public.limpieza_admin_catalogos_v4() to authenticated;
grant execute on function public.limpieza_admin_programacion_v4() to authenticated;
grant execute on function public.limpieza_admin_guardar_programacion_v4(uuid,uuid,uuid,uuid,smallint,time,time,boolean,date,date) to authenticated;
grant execute on function public.limpieza_admin_cerrar_programacion_v4(uuid) to authenticated;
grant execute on function public.limpieza_admin_rutina_labores_v4() to authenticated;
grant execute on function public.limpieza_admin_guardar_rutina_labor_v4(uuid,uuid,boolean,boolean,smallint) to authenticated;
grant execute on function public.limpieza_admin_crear_labor_v4(text) to authenticated;
grant execute on function public.limpieza_admin_reportes_v4(date,date,uuid,uuid) to authenticated;
grant execute on function public.limpieza_admin_control_diario_v4(date,uuid) to authenticated;
