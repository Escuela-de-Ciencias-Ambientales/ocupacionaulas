# Pendientes de SIGEP

Actualizado: 5 de octubre de 2026, hora de Costa Rica.

Estados: **pendiente**, **en revisión**, **terminado** y **bloqueado**. Marcar terminado solo con evidencia del entorno correspondiente.

## Prioridad actual: autorizaciones GNSS Trimble

| ID | Estado | Trabajo | Condición para cerrar |
| --- | --- | --- | --- |
| P-01 | Terminado | Recuperar contexto previo y crear registros de continuidad | Chats relevantes y documentos existentes revisados; cuatro archivos de seguimiento creados |
| P-02 | En revisión | Reproducir la pantalla con etiquetas Django | Identificar la ruta y recurso causante; verificar la vista real con el diseño original |
| P-03 | Pendiente | Consultar esquema y migraciones actuales de Supabase | Comparar producción con el repositorio sin sobrescribir migraciones más recientes |
| P-04 | Pendiente | Vincular Dirección y Subdirección al padrón maestro | Encontrar las dos personas por identificación; confirmar cargos y acceso sin duplicar registros |
| P-05 | Pendiente | Definir alcance y vigencia de la autorización especial | Documentar criterio adoptado y su relación con la autorización docente |
| P-06 | Pendiente | Añadir asignación administrable de cargos e historial | Elegir académicos existentes; solo administración autorizada cambia cargos; historial conservado |
| P-07 | Pendiente | Añadir aprobación de GNSS al flujo docente existente | Uno de los cargos puede aprobar, con firma y trazabilidad; otros usuarios no pueden hacerlo |
| P-08 | Pendiente | Mostrar autorización al seleccionar Trimble | Identificar TDC6 por marca/modelo; mostrar autorizado o faltante; mantener estética |
| P-09 | Pendiente | Bloquear préstamo y entrega sin aprobación | Comprobar servidor y pantalla, incluyendo caminos manuales y edición de préstamos |
| P-10 | Pendiente | Incorporar o adaptar solicitudes de académicos | Usar el padrón existente; los profesores solicitan y Dirección/Subdirección autoriza Trimble |
| P-11 | Pendiente | Separar control de GNSS de autorizaciones docentes comunes | Pendientes e historial propios con filtros y estados legibles |

## Inventario corregido

| ID | Estado | Trabajo | Condición para cerrar |
| --- | --- | --- | --- |
| I-01 | Terminado solo en local | Leer Excel corregido y expandir cantidades | Resultado local: 496 filas y 625 unidades, incluidos 15 Trimble TDC6 |
| I-02 | Pendiente | Comparar inventario real de Supabase con el Excel | Reportar coincidencias, códigos en conflicto, faltantes y equipos en préstamo |
| I-03 | Pendiente | Revisar cantidades agrupadas y activos/series repetidos | Conservar originales; determinar representación por unidad o kit sin inventar activos |
| I-04 | Pendiente | Crear importación compatible con catálogo y unidades actuales | Validación previa, operación transaccional y repetición sin duplicados |
| I-05 | Pendiente | Cargar a la base de producción | Respaldo/exportación previa, conciliación de unidades y verificación de disponibilidad |

El informe local contiene 153 incidencias de unidades; son anotaciones generadas al expandir grupos o conservar identificadores repetidos. No equivalen a 153 filas incorrectas ni confirman errores en Supabase.

## Verificación y publicación

- [ ] Probar estudiantes y académicos, con equipos comunes, Trimble y solicitudes mixtas.
- [ ] Probar aprobación por director y por subdirector; rechazar a cualquier otro usuario.
- [ ] Probar cambio de cargos y conservación del historial.
- [ ] Probar ausencia, revocación y vencimiento de autorización según el alcance adoptado.
- [ ] Probar selección, asignación física, entrega, devolución parcial y completa y edición administrativa.
- [ ] Revisar escritorio y móvil; conservar logos, tipografía, colores y separación visual.
- [ ] Verificar seguridad de tablas, RPC, firmas y datos personales.
- [ ] Confirmar que aulas y vehículos continúan funcionando.
- [ ] Publicar cambios del frontend y migraciones/servicios necesarios; esperar resultado de GitHub Pages.
- [ ] Verificar la URL pública y datos reales, sin afirmar despliegue por pruebas locales.
- [ ] Actualizar AVANCE, DECISIONES y este archivo con evidencia y fecha.

## Pendientes heredados documentados

- Revisar las 3 referencias de cursos académicos sin NRC equivalente, conservadas sin relación artificial en la importación de septiembre.
- Revisar los 80 códigos de materias generales/externas no asociables al horario EDECA y los 20 estudiantes sin matrícula EDECA vinculada.
- Mantener Conserjería en pausa mientras no exista una instrucción de reactivarla.
- Corregir notas antiguas de documentación que describan como pendiente un cambio ya incorporado; verificar por código e historial.
