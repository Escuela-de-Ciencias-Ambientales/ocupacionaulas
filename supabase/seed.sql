delete from public.fixed_occupancies
where cycle_id = (select id from public.reservation_cycles where is_current = true limit 1);

with current_cycle as (
  select id from public.reservation_cycles where is_current = true limit 1
), schedule(code, day_of_week, start_time, end_time, label) as (
  values
    ('L601', 1, time '08:00', time '12:10', 'AME408 · PABLO RAMIREZ GRANADOS'),
    ('L601', 1, time '13:00', time '16:00', 'AMQ414 · JOSE CASTRO SOLIS'),
    ('L601', 1, time '16:31', time '19:00', 'AMQ423 · PABLO RAMIREZ GRANADOS'),
    ('L602', 2, time '10:31', time '12:00', 'AME424 · GREYTY QUESADA THOMPSON'),
    ('L602', 4, time '08:00', time '12:00', 'AME418 · MARIA GAMBOA JIMENEZ'),
    ('L602', 2, time '13:00', time '15:55', 'AME410L · MARGARET PINNOCK BRANFORD'),
    ('L602', 3, time '13:00', time '17:00', 'AME419L · JOSE ROJAS MARIN'),
    ('L603', 1, time '08:00', time '11:00', 'AMQ421 · MARIA AVELLAN ZUMBADO'),
    ('L603', 2, time '08:00', time '12:00', 'AMQ410 · MARCO OTAROLA ROJAS'),
    ('L603', 3, time '08:00', time '12:00', 'AMQ411 · ROSALIA RODRIGUEZ PORRAS'),
    ('L603', 1, time '13:00', time '17:00', 'AMQ431 · PRISCILLA RIGG AGUILAR'),
    ('L603', 2, time '13:00', time '17:00', 'AMQ433 · IGOR ZUÑIGA GARITA'),
    ('L603', 3, time '13:00', time '16:58', 'AMQ403 · MAYNOR CARRANZA VARELA'),
    ('708', 1, time '08:00', time '11:00', 'AMQ412 · ALBERT MORERA BEITA'),
    ('708', 2, time '08:00', time '12:00', 'AME401 · GUSTAVO VARGAS ROJAS'),
    ('708', 3, time '08:00', time '12:00', 'USAC'),
    ('708', 4, time '08:00', time '10:00', 'AMQ432 · SERGIO MOLINA MURILLO'),
    ('708', 5, time '08:00', time '12:00', 'AME505 · VANESSA VALERIO HERNANDEZ'),
    ('708', 6, time '08:00', time '12:00', 'AME505 · MARIA GAMBOA JIMENEZ'),
    ('708', 1, time '13:00', time '15:00', 'AMQ422 · RAFAEL MURILLO CRUZ'),
    ('708', 2, time '13:00', time '17:00', 'AME425 · MANFRED MURRELL BLANCO / ALINA AGUILAR ARGUEDAS'),
    ('708', 3, time '13:00', time '15:00', 'AMQ431 · PRISCILLA RIGG AGUILAR'),
    ('708', 4, time '13:00', time '16:55', 'AME420 · ERNESTO MONTERO SANCHEZ'),
    ('708', 5, time '13:00', time '16:30', 'AME509 · KARLA VETRANI CHAVARRIA'),
    ('708', 1, time '17:00', time '18:40', 'MAT002 · KRISTEL CASTILLO VEGA'),
    ('708', 3, time '17:00', time '19:30', 'MAT002 · KRISTEL CASTILLO VEGA'),
    ('708', 5, time '17:00', time '20:00', 'AME508 · KARLA VETRANI CHAVARRIA'),
    ('709', 1, time '08:00', time '10:00', 'AMQ103O · GUSTAVO VARGAS ROJAS'),
    ('709', 2, time '09:00', time '12:00', 'AME410 · JESUS UGALDE GOMEZ'),
    ('709', 3, time '08:00', time '12:00', 'AMQ430 · RONNY VILLALOBOS CHACON'),
    ('709', 4, time '08:00', time '12:00', 'AME409 · SHERRYL CAMPOS MORALES'),
    ('709', 5, time '09:00', time '12:00', 'AMQ507 · SERGIO MOLINA MURILLO'),
    ('709', 6, time '08:00', time '12:10', 'AME507 · MANUEL MENDEZ FLORES'),
    ('709', 2, time '13:00', time '16:00', 'USAC'),
    ('709', 3, time '13:00', time '16:00', 'AMQ413 · RONNY VILLALOBOS CHACON'),
    ('709', 4, time '14:00', time '16:30', 'FIY512 · VICTOR GRANADOS FERNANDEZ'),
    ('710', 1, time '09:00', time '12:00', 'AME442O · FEDERICO ALICE GUIER'),
    ('710', 2, time '08:00', time '11:00', 'AMQ420 · ALBERT MORERA BEITA'),
    ('710', 3, time '08:00', time '11:00', 'AMQ112O · MARCO OTAROLA ROJAS'),
    ('710', 3, time '08:00', time '12:00', 'USAC'),
    ('710', 4, time '08:00', time '12:00', 'AMQ113O · MARIA CHAVES VILLALOBOS'),
    ('710', 5, time '08:00', time '12:00', 'NO INDICADO · VANESSA VALERIO HERNANDEZ'),
    ('710', 1, time '16:00', time '19:00', 'AMQ105O · MARILYN ROJAS VARGAS'),
    ('710', 2, time '13:00', time '16:00', 'AMQ424 · SERGIO MOLINA MURILLO'),
    ('710', 2, time '16:01', time '18:30', 'AMQ109O · MARIA AVELLAN ZUMBADO'),
    ('710', 4, time '13:00', time '15:59', 'AMQ506 · WILLIAM HERNANDEZ CASTRO'),
    ('710', 5, time '13:00', time '15:59', 'AMQ505 · FEDERICO ALICE GUIER'),
    ('710', 3, time '16:30', time '19:30', 'AMQ111O · LUIS ALFARO ALVARADO'),
    ('710', 4, time '16:30', time '19:30', 'AMQ508 · IGOR ZUÑIGA GARITA'),
    ('710', 5, time '16:31', time '18:31', 'AMQ509 · MARIA ALVAREZ JIMENEZ'),
    ('711', 1, time '08:00', time '12:00', 'AME417 · SHERRYL CAMPOS MORALES'),
    ('711', 2, time '09:00', time '10:30', 'AME424 · GREYTY QUESADA THOMPSON'),
    ('711', 3, time '08:00', time '12:00', 'AME419 · JOSE ROJAS MARIN'),
    ('711', 1, time '13:30', time '16:30', 'AMQ102O · VICTOR MEZA PICADO'),
    ('711', 2, time '13:00', time '16:00', 'AMQ110O · MARIA ALVAREZ JIMENEZ'),
    ('711', 3, time '17:01', time '18:40', 'AMQ433 · IGOR ZUÑIGA GARITA')
)
insert into public.fixed_occupancies (cycle_id, classroom_id, day_of_week, start_time, end_time, label)
select current_cycle.id, classrooms.id, schedule.day_of_week, schedule.start_time, schedule.end_time, schedule.label
from schedule
join public.classrooms on classrooms.code = schedule.code
cross join current_cycle;

update public.reservation_cycles
set academic_schedule_loaded = true, reservations_enabled = false
where is_current = true;
