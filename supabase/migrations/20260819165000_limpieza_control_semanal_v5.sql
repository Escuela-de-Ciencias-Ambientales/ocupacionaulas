-- Control semanal de cumplimiento para la jefatura.
-- Expone únicamente mediante RPC autorizada el horario previsto, el momento
-- del escaneo, el envío y las labores faltantes de cada turno.

create or replace function public.limpieza_admin_control_semanal_v5(
  p_fecha_semana date,
  p_conserje_id uuid
)
returns table(
  fecha date,
  dia_semana smallint,
  programacion_id uuid,
  conserje_id uuid,
  conserje text,
  aposento_id uuid,
  aposento text,
  rutina text,
  hora_inicio time,
  hora_fin time,
  reportado boolean,
  reporte_id uuid,
  escaneado_at timestamptz,
  enviado_at timestamptz,
  duracion_segundos integer,
  dentro_horario boolean,
  labores_programadas jsonb,
  labores_faltantes jsonb
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_inicio date;
begin
  if not public.limpieza_es_admin_conserjeria() then
    raise exception 'No autorizado';
  end if;
  if p_fecha_semana is null or p_conserje_id is null then
    raise exception 'Fecha y conserje requeridos';
  end if;

  v_inicio := p_fecha_semana - (extract(isodow from p_fecha_semana)::integer - 1);

  return query
  with dias as (
    select generate_series(v_inicio, v_inicio + 6, interval '1 day')::date as fecha
  )
  select
    d.fecha,
    extract(dow from d.fecha)::smallint,
    p.id,
    c.id,
    c.nombre,
    a.id,
    a.nombre,
    ru.nombre,
    p.hora_inicio,
    p.hora_fin,
    rep.id is not null,
    rep.id,
    rep.escaneado_at,
    coalesce(rep.enviado_at, rep.fecha),
    rep.duracion_segundos,
    case
      when rep.id is null then null
      else
        (rep.escaneado_at at time zone 'America/Costa_Rica')::date = d.fecha
        and (rep.escaneado_at at time zone 'America/Costa_Rica')::time
          between p.hora_inicio and p.hora_fin
        and (coalesce(rep.enviado_at, rep.fecha) at time zone 'America/Costa_Rica')::date = d.fecha
        and (coalesce(rep.enviado_at, rep.fecha) at time zone 'America/Costa_Rica')::time
          between p.hora_inicio and p.hora_fin
    end,
    coalesce(lab.labores, '[]'::jsonb),
    case
      when rep.id is null then coalesce(lab.labores, '[]'::jsonb)
      else coalesce((
        select jsonb_agg(x order by x->>'nombre')
        from jsonb_array_elements(rep.checklist) x
        where coalesce((x->>'completada')::boolean, false) = false
      ), '[]'::jsonb)
    end
  from dias d
  join public.limpieza_programacion p
    on p.dia_semana = extract(dow from d.fecha)::smallint
    and p.vigente_desde <= d.fecha
    and (p.vigente_hasta is null or p.vigente_hasta >= d.fecha)
    and p.conserje_id = p_conserje_id
  join public.limpieza_conserjes c on c.id = p.conserje_id
  join public.limpieza_aposentos a on a.id = p.aposento_id
  join public.limpieza_rutinas ru on ru.id = p.rutina_id
  left join lateral (
    select r.*
    from public.limpieza_reportes r
    where r.programacion_id = p.id
      and (coalesce(r.enviado_at, r.fecha) at time zone 'America/Costa_Rica')::date = d.fecha
    order by coalesce(r.enviado_at, r.fecha) desc
    limit 1
  ) rep on true
  left join lateral (
    select jsonb_agg(
      jsonb_build_object('nombre', l.nombre, 'obligatoria', rl.obligatoria)
      order by rl.orden, l.nombre
    ) as labores
    from public.limpieza_rutina_labores rl
    join public.limpieza_labores l on l.id = rl.labor_id
    where rl.rutina_id = p.rutina_id and rl.activo and l.activo
  ) lab on true
  order by d.fecha, p.hora_inicio, a.nombre;
end;
$$;

revoke all on function public.limpieza_admin_control_semanal_v5(date, uuid)
  from public, anon;
grant execute on function public.limpieza_admin_control_semanal_v5(date, uuid)
  to authenticated;
