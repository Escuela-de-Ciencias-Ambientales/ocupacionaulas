-- Retira los recintos temporales usados durante las pruebas iniciales.
-- Las rutinas y labores asociadas se eliminan por cascada al borrar el recinto.
delete from public.limpieza_reportes
where aposento_id in (
  select id from public.limpieza_aposentos where slug in ('aula-1', 'aula-2')
);

delete from public.limpieza_escaneos
where aposento_id in (
  select id from public.limpieza_aposentos where slug in ('aula-1', 'aula-2')
);

delete from public.limpieza_programacion
where aposento_id in (
  select id from public.limpieza_aposentos where slug in ('aula-1', 'aula-2')
);

delete from public.limpieza_aposentos
where slug in ('aula-1', 'aula-2');
