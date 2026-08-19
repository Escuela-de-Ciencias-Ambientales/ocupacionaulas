-- La vigencia inicial fue una fecha técnica añadida durante la importación.
-- El rol semanal ya correspondía al miércoles 19 de agosto, por lo que todas
-- las asignaciones importadas deben estar disponibles desde ese día.

update public.limpieza_programacion
set vigente_desde = date '2026-08-19'
where turno_codigo like 'excel-%'
  and vigente_desde = date '2026-08-20';
