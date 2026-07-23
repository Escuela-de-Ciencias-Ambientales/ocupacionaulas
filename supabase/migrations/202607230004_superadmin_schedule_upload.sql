create or replace function public.admin_replace_fixed_occupancies(p_entries jsonb)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare active_cycle_id uuid;
declare inserted_count integer;
begin
  if not public.is_superadmin() then
    raise exception using errcode = '42501', message = 'La carga masiva de horarios requiere acceso de superadministrador';
  end if;
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

grant execute on function public.admin_replace_fixed_occupancies(jsonb) to authenticated;
