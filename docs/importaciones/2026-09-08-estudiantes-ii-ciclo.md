# Importación de estudiantes — II Ciclo 2026

Fuente institucional procesada: `Anexo 1. UNA-DR-OFIC-2555-2026, EDECA Estudiantes matriculados II ciclo 2026.xlsx`.

## Resultado

- 1.066 filas de matrícula revisadas.
- 263 estudiantes únicos actualizados o incorporados.
- 701 matrículas vinculadas con cursos y NRC existentes del II Ciclo 2026.
- 0 cédulas duplicadas después de la normalización.
- 80 códigos de materias generales o externas no se asociaron porque no existen en el horario EDECA cargado y el archivo fuente no incluye NRC.
- 20 estudiantes quedaron correctamente registrados como clientes, pero sin una matrícula EDECA asociable al horario actual.

## Normalizaciones aplicadas

- Bachillerato y licenciatura en Gestión Ambiental se unificaron como `Ingeniería en Gestión Ambiental`.
- Bachillerato y licenciatura en Ciencias Forestales se unificaron como `Ingeniería en Ciencias Forestales`.
- Las cédulas se almacenaron con el mismo criterio numérico que utiliza el formulario de SIGEP, incluyendo tres identificaciones extranjeras con prefijo `A` en la fuente.
- Los correos se normalizaron a minúsculas.
- Los nombres se almacenaron con capitalización legible.

La importación no desactivó registros anteriores ni alteró préstamos, devoluciones, excepciones o autorizaciones existentes. El archivo con datos personales no se incorporó al repositorio.

## Procedimiento para próximos ciclos

En Bodega, abra **Clientes** y seleccione **Importar Excel semestral**. Elija el ciclo, cargue un archivo `.xlsx` con las mismas nueve columnas institucionales y revise el resumen antes de confirmar.

La importación es idempotente: identifica a cada estudiante por su cédula, actualiza sus datos personales y reemplaza solamente sus matrículas del ciclo elegido. No elimina el registro permanente del estudiante, por lo que conserva préstamos activos, devoluciones, firmas, comprobantes, restricciones y trazabilidad histórica. Las materias sin NRC en el horario del ciclo se reportan y no se relacionan de manera artificial.
