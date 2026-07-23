alter table public.fixed_occupancies
  add column if not exists professor_name text,
  add column if not exists course_code text,
  add column if not exists course_name text,
  add column if not exists nrc text,
  add column if not exists group_code text;

comment on column public.fixed_occupancies.professor_name is 'Nombre del profesor o responsable de la ocupación';
comment on column public.fixed_occupancies.course_code is 'Código institucional del curso';
comment on column public.fixed_occupancies.course_name is 'Nombre completo del curso o actividad';
comment on column public.fixed_occupancies.nrc is 'Número de referencia del curso';
comment on column public.fixed_occupancies.group_code is 'Grupo del curso';

with course_data (
  room_code, day_number, start_value, end_value,
  professor_value, code_value, course_value, nrc_value, group_value
) as (
  values
    ('L601', 1, '08:00', '12:10', 'PABLO RAMIREZ GRANADOS', 'AME408', 'GEOLOGIA AMBIENTAL Y SUELOS', '51769', '01'),
    ('L601', 1, '13:00', '16:00', 'JOSE CASTRO SOLIS', 'AMQ414', 'SISTEMAS INFORM GEOGRAF I', '53097', '01'),
    ('L601', 1, '16:31', '19:00', 'PABLO RAMIREZ GRANADOS', 'AMQ423', 'HIDROLOGÍA FORESTAL', '53173', '01'),
    ('L602', 2, '10:31', '12:00', 'GREYTY QUESADA THOMPSON', 'AME424', 'PLANIFIC AMBIENTAL DEL TERRITO', '51810', '01'),
    ('L602', 4, '08:00', '12:00', 'MARIA GAMBOA JIMENEZ', 'AME418', 'INGEN Y SANEAMIENTO AMBIENTAL', '51797', '01'),
    ('L602', 2, '13:00', '15:55', 'MARGARET PINNOCK BRANFORD', 'AME410L', 'LABORAT TOXICOLOGIA AMBIENTAL', '51789', '01'),
    ('L602', 3, '13:00', '17:00', 'JOSE ROJAS MARIN', 'AME419L', 'LAB. TRATAMIEN RESIDUOS SOLIDO', '51806', '01'),
    ('L603', 1, '08:00', '11:00', 'MARIA AVELLAN ZUMBADO', 'AMQ421', 'ARBORICULTURA', '53168', '01'),
    ('L603', 2, '08:00', '12:00', 'MARCO OTAROLA ROJAS', 'AMQ410', 'DENDROLOGÍA I', '53093', '01'),
    ('L603', 3, '08:00', '12:00', 'ROSALIA RODRIGUEZ PORRAS', 'AMQ411', 'PLAGAS Y ENFERMEDADES FORESTAL', '53094', '01'),
    ('L603', 1, '13:00', '17:00', 'PRISCILLA RIGG AGUILAR', 'AMQ431', 'INDUSTRIA FORESTAL', '53198', '01'),
    ('L603', 2, '13:00', '17:00', 'IGOR ZUÑIGA GARITA', 'AMQ433', 'EVALUACIÓN DE IMPAC AMBIENTAL', '53241', '01'),
    ('L603', 3, '13:00', '16:58', 'MAYNOR CARRANZA VARELA', 'AMQ403', 'ANATOMÍA Y FISIOLOGÍA VEGETAL', '53092', '01'),
    ('708', 1, '08:00', '11:00', 'ALBERT MORERA BEITA', 'AMQ412', 'ECOLOGÍA FORESTAL II', '53095', '01'),
    ('708', 2, '08:00', '12:00', 'GUSTAVO VARGAS ROJAS', 'AME401', 'ECOLOGIA APLICADA', '51768', '01'),
    ('708', 4, '08:00', '10:00', 'SERGIO MOLINA MURILLO', 'AMQ432', 'COMERCIO Y MERCADEO FORESTAL', '53236', '01'),
    ('708', 5, '08:00', '12:00', 'VANESSA VALERIO HERNANDEZ', 'AME505', 'MANEJO CONFLICTOS SOCIOAMBIENT', '51826', '01'),
    ('708', 1, '13:00', '15:00', 'RAFAEL MURILLO CRUZ', 'AMQ422', 'SILVICULT PLANTACIONES FORESTA', '53172', '01'),
    ('708', 2, '13:00', '17:00', 'MANFRED MURRELL BLANCO / ALINA AGUILAR ARGUEDAS', 'AME425', 'PRACTICA PROFESIONAL SUPERVISA', '51815', '01'),
    ('708', 3, '13:00', '15:00', 'PRISCILLA RIGG AGUILAR', 'AMQ431', 'INDUSTRIA FORESTAL', '53198', '01'),
    ('708', 4, '13:00', '16:55', 'ERNESTO MONTERO SANCHEZ', 'AME420', 'METOD Y MEDIC CONDIC TRABAJO', '51808', '01'),
    ('708', 5, '13:00', '16:30', 'KARLA VETRANI CHAVARRIA', 'AME509', 'TALLER TECNOLOGIAS AMBIENTA II', '51832', '01'),
    ('708', 5, '17:00', '20:00', 'KARLA VETRANI CHAVARRIA', 'AME508', 'ADMINI SISTEMAS GEST AMBIENTAL', '51829', '01'),
    ('709', 1, '08:00', '10:00', 'GUSTAVO VARGAS ROJAS', 'AMQ103O', 'ÁRBOLES Y SOCIEDAD', '52332', '01'),
    ('709', 2, '09:00', '12:00', 'JESUS UGALDE GOMEZ', 'AME410', 'TOXICOLOGIA AMBIENTAL', '51785', '01'),
    ('709', 3, '08:00', '12:00', 'RONNY VILLALOBOS CHACON', 'AMQ430', 'ORDENACIÓN DE LA PROD FORESTAL', '53189', '01'),
    ('709', 4, '08:00', '12:00', 'SHERRYL CAMPOS MORALES', 'AME409', 'SISTEM GESTION CALIDAD Y AMBIE', '51770', '01'),
    ('709', 5, '09:00', '12:00', 'SERGIO MOLINA MURILLO', 'AMQ507', 'COMERCIO INTER PROD FORESTALES', '53271', '01'),
    ('709', 6, '08:00', '12:10', 'MANUEL MENDEZ FLORES', 'AME507', 'TECN SOSTEN CONSTR E INDUSTRIA', '51827', '01'),
    ('710', 3, '08:00', '11:00', 'MARCO OTAROLA ROJAS', 'AMQ112O', 'MONIT ECOL EN ECOSISTE FORESTA', '52361', '01'),
    ('709', 3, '13:00', '16:00', 'RONNY VILLALOBOS CHACON', 'AMQ413', 'EPIDOMETRÍA', '53096', '01'),
    ('710', 1, '09:00', '12:00', 'FEDERICO ALICE GUIER', 'AME442O', 'CAM CLIM III: NUEV SOL POL FIN', '53743', '01'),
    ('710', 2, '08:00', '11:00', 'ALBERT MORERA BEITA', 'AMQ420', 'RESTAURACIÓN DE ECOSISTEMAS', '53100', '01'),
    ('710', 4, '08:00', '12:00', 'MARIA CHAVES VILLALOBOS', 'AMQ113O', 'TEC, PROPIEDADES Y USOS MADERA', '53091', '01'),
    ('710', 1, '16:00', '19:00', 'MARILYN ROJAS VARGAS', 'AMQ105O', 'BAMBÚ: INNOV, DESARROLLO Y MER', '52334', '01'),
    ('710', 2, '16:01', '18:30', 'MARIA AVELLAN ZUMBADO', 'AMQ109O', 'FORESTERÍA COMUNITARIA', '52337', '01'),
    ('710', 3, '16:30', '19:30', 'LUIS ALFARO ALVARADO', 'AMQ111O', 'MANEJO FAUNA SILV ECOSIS FORES', '52381', '01'),
    ('710', 4, '13:00', '15:59', 'WILLIAM HERNANDEZ CASTRO', 'AMQ506', 'CONSERV Y MEJORAMI GEN FORESTA', '53244', '01'),
    ('710', 5, '13:00', '15:59', 'FEDERICO ALICE GUIER', 'AMQ505', 'BOSQUES Y ESTR CAMBIO CLIMÁTIC', '53243', '01'),
    ('710', 4, '16:30', '19:30', 'IGOR ZUÑIGA GARITA', 'AMQ508', 'GERENCIA ESTRATÉGICA', '53280', '01'),
    ('710', 5, '16:31', '18:31', 'MARIA ALVAREZ JIMENEZ', 'AMQ509', 'TRABAJO FINAL DE GRADUACIÓN II', '53285', '01'),
    ('711', 1, '08:00', '12:00', 'SHERRYL CAMPOS MORALES', 'AME417', 'ANALIS PROCESOS ECOEFICIENTES', '51792', '01'),
    ('711', 2, '09:00', '10:30', 'GREYTY QUESADA THOMPSON', 'AME424', 'PLANIFIC AMBIENTAL DEL TERRITO', '51810', '01'),
    ('711', 3, '08:00', '12:00', 'JOSE ROJAS MARIN', 'AME419', 'TRATAMIENTO RESIDUOS SOLIDOS', '51804', '01'),
    ('711', 1, '13:30', '16:30', 'VICTOR MEZA PICADO', 'AMQ102O', 'ACTUALIDAD FORESTAL', '52330', '01'),
    ('711', 2, '13:00', '16:00', 'MARIA ALVAREZ JIMENEZ', 'AMQ110O', 'INTROD MANEJO SOSTENIBLE AGUA', '52341', '01'),
    ('710', 2, '13:00', '16:00', 'SERGIO MOLINA MURILLO', 'AMQ424', 'ECONOMÍA FORESTAL', '53182', '01'),
    ('711', 3, '17:01', '18:40', 'IGOR ZUÑIGA GARITA', 'AMQ433', 'EVALUACIÓN DE IMPAC AMBIENTAL', '53241', '01'),
    ('708', 6, '08:00', '12:00', 'MARIA GAMBOA JIMENEZ', 'AME505', 'MANEJO CONFLICTOS SOCIOAMBIENT', '51826', '01'),
    ('708', 1, '17:00', '18:40', 'KRISTEL CASTILLO VEGA', 'MAT002', 'CURSO NO INDICADO EN EL PDF', '53688', '24'),
    ('708', 3, '17:00', '19:30', 'KRISTEL CASTILLO VEGA', 'MAT002', 'CURSO NO INDICADO EN EL PDF', '53688', '24'),
    ('709', 4, '14:00', '16:30', 'VICTOR GRANADOS FERNANDEZ', 'FIY512', 'CURSO NO INDICADO EN EL PDF', '53299', '01'),
    ('710', 5, '08:00', '12:00', 'VANESSA VALERIO HERNANDEZ', 'NO INDICADO', 'OCUPACIÓN SIN CÓDIGO VISIBLE EN EL PDF', 'No indicado', 'No indicado'),
    ('708', 3, '08:00', '12:00', 'USAC', '', '', '', ''),
    ('710', 3, '08:00', '12:00', 'USAC', '', '', '', ''),
    ('709', 2, '13:00', '16:00', 'USAC', '', '', '', '')
)
update public.fixed_occupancies occupancy
set professor_name = nullif(course_data.professor_value, ''),
    course_code = nullif(course_data.code_value, ''),
    course_name = nullif(course_data.course_value, ''),
    nrc = nullif(course_data.nrc_value, ''),
    group_code = nullif(course_data.group_value, '')
from course_data
join public.classrooms room on room.code = course_data.room_code
where occupancy.classroom_id = room.id
  and occupancy.day_of_week = course_data.day_number
  and occupancy.start_time = course_data.start_value::time
  and occupancy.end_time = course_data.end_value::time;

create or replace function public.admin_upsert_fixed_occupancy(
  p_id bigint,
  p_classroom_code text,
  p_day integer,
  p_start time,
  p_end time,
  p_professor_name text,
  p_course_code text,
  p_course_name text,
  p_nrc text,
  p_group_code text
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
  display_label text;
begin
  if not public.is_admin() then
    raise exception using errcode = '42501', message = 'Se requiere acceso administrativo';
  end if;
  if p_day not between 1 and 6
    or p_start < time '07:00'
    or p_end > time '21:00'
    or p_start >= p_end
    or (
      nullif(trim(p_professor_name), '') is null
      and nullif(trim(p_course_code), '') is null
      and nullif(trim(p_course_name), '') is null
    )
  then
    raise exception using errcode = '22023', message = 'El día, horario o detalle académico no es válido';
  end if;

  display_label := coalesce(
    nullif(concat_ws(' · ', nullif(trim(p_course_code), ''), nullif(trim(p_professor_name), '')), ''),
    nullif(trim(p_course_name), ''),
    nullif(trim(p_professor_name), '')
  );

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
    insert into public.fixed_occupancies (
      cycle_id, classroom_id, day_of_week, start_time, end_time, label,
      professor_name, course_code, course_name, nrc, group_code
    )
    values (
      active_cycle.id, room_id, p_day, p_start, p_end, display_label,
      nullif(trim(p_professor_name), ''), nullif(trim(p_course_code), ''),
      nullif(trim(p_course_name), ''), nullif(trim(p_nrc), ''),
      nullif(trim(p_group_code), '')
    )
    returning id into saved_id;
  else
    update public.fixed_occupancies
    set classroom_id = room_id,
        day_of_week = p_day,
        start_time = p_start,
        end_time = p_end,
        label = display_label,
        professor_name = nullif(trim(p_professor_name), ''),
        course_code = nullif(trim(p_course_code), ''),
        course_name = nullif(trim(p_course_name), ''),
        nrc = nullif(trim(p_nrc), ''),
        group_code = nullif(trim(p_group_code), '')
    where id = p_id and cycle_id = active_cycle.id
    returning id into saved_id;
    if saved_id is null then raise exception using errcode = '22023', message = 'No se encontró la ocupación'; end if;
  end if;

  update public.reservation_cycles set academic_schedule_loaded = true where id = active_cycle.id;
  return saved_id;
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
  if not public.is_superadmin() then
    raise exception using errcode = '42501', message = 'La carga masiva de horarios requiere acceso de superadministrador';
  end if;
  if jsonb_typeof(p_entries) <> 'array' or jsonb_array_length(p_entries) = 0 then
    raise exception using errcode = '22023', message = 'El archivo de ocupación está vacío';
  end if;
  select id into active_cycle_id from public.reservation_cycles where is_current = true;
  if active_cycle_id is null then raise exception using errcode = '22023', message = 'Primero configura el ciclo'; end if;

  if exists (
    select 1
    from jsonb_to_recordset(p_entries) as item(
      aula text, dia integer, hora_inicio time, hora_fin time, detalle text,
      profesor text, codigo text, curso text, nrc text, grupo text
    )
    left join public.classrooms room on room.code = item.aula and room.active = true
    where room.id is null
      or item.dia not between 1 and 6
      or item.hora_inicio >= item.hora_fin
      or (
        nullif(trim(item.detalle), '') is null
        and nullif(trim(item.profesor), '') is null
        and nullif(trim(item.codigo), '') is null
        and nullif(trim(item.curso), '') is null
      )
  ) then raise exception using errcode = '22023', message = 'El archivo contiene aulas, días, horarios o detalles inválidos'; end if;

  delete from public.fixed_occupancies where cycle_id = active_cycle_id;
  insert into public.fixed_occupancies (
    cycle_id, classroom_id, day_of_week, start_time, end_time, label,
    professor_name, course_code, course_name, nrc, group_code
  )
  select
    active_cycle_id,
    room.id,
    item.dia,
    item.hora_inicio,
    item.hora_fin,
    coalesce(
      nullif(trim(item.detalle), ''),
      nullif(concat_ws(' · ', nullif(trim(item.codigo), ''), nullif(trim(item.profesor), '')), ''),
      nullif(trim(item.curso), ''),
      nullif(trim(item.profesor), '')
    ),
    nullif(trim(item.profesor), ''),
    nullif(trim(item.codigo), ''),
    nullif(trim(item.curso), ''),
    nullif(trim(item.nrc), ''),
    nullif(trim(item.grupo), '')
  from jsonb_to_recordset(p_entries) as item(
    aula text, dia integer, hora_inicio time, hora_fin time, detalle text,
    profesor text, codigo text, curso text, nrc text, grupo text
  )
  join public.classrooms room on room.code = item.aula and room.active = true;
  get diagnostics inserted_count = row_count;

  update public.reservation_cycles
  set academic_schedule_loaded = true, reservations_enabled = false
  where id = active_cycle_id;
  return inserted_count;
end;
$$;

grant execute on function public.admin_upsert_fixed_occupancy(bigint,text,integer,time,time,text,text,text,text,text) to authenticated;
grant execute on function public.admin_replace_fixed_occupancies(jsonb) to authenticated;
