-- Al escanear fuera de horario, asigna primero el turno pendiente que terminó
-- más recientemente. Solo si no hay uno vencido toma el próximo turno del día.
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
    case
      when v_hora between p.hora_inicio and p.hora_fin then 0
      when p.hora_fin < v_hora then 1
      else 2
    end,
    case
      when p.hora_fin < v_hora then v_hora - p.hora_fin
      else p.hora_inicio - v_hora
    end
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

revoke all on function public.limpieza_api_contexto_v4(text, text) from public, anon, authenticated;
grant execute on function public.limpieza_api_contexto_v4(text, text) to service_role;

-- La programación importada corresponde a toda la semana del 17 al 21 de agosto.
update public.limpieza_programacion
set vigente_desde = date '2026-08-17'
where turno_codigo like 'excel-%'
  and vigente_desde = date '2026-08-19';

-- Corrige la prueba de Aula 708: fue realizada después del turno de las 06:00,
-- antes de que comenzara el siguiente turno de las 11:40.
update public.limpieza_reportes
set programacion_id = 'e8ee0765-1181-4b5a-bdb1-bd50d08deaf1'
where id = '6855d7bd-c383-4ff3-99bb-95214109eaa2'
  and programacion_id = '2a2f8549-4b59-4b14-bf41-46fde60df7cc';

update public.limpieza_escaneos
set programacion_id = 'e8ee0765-1181-4b5a-bdb1-bd50d08deaf1'
where id = '759aca7c-069e-4071-bb50-285bb4b3d44f'
  and programacion_id = '2a2f8549-4b59-4b14-bf41-46fde60df7cc';
