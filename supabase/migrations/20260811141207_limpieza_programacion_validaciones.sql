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
