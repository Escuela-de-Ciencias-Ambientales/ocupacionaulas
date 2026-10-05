# Pendientes de SIGEP

Actualizado: 5 de octubre de 2026, hora de Costa Rica.

Estados: **pendiente**, **en revisión**, **terminado** y **bloqueado**. Marcar terminado solo con evidencia del entorno correspondiente.

## Prioridad actual: autorizaciones GNSS Trimble

| ID | Estado | Trabajo | Condición para cerrar |
| --- | --- | --- | --- |
| P-01 | Terminado | Recuperar contexto previo y crear registros de continuidad | Chats relevantes y documentos existentes revisados; cuatro archivos de seguimiento creados |
| P-02 | En revisión | Reproducir la pantalla con etiquetas Django | Identificar la ruta y recurso causante; verificar la vista real con el diseño original |
| P-03 | Terminado | Consultar esquema y migraciones actuales de Supabase | Comparar producción con el repositorio sin sobrescribir migraciones más recientes |
| P-04 | Implementado; cargos provisionales | Vincular Dirección y Subdirección al padrón maestro | Encontrar las dos personas por identificación; confirmar cargos y acceso sin duplicar registros |
| P-05 | Terminado | Definir alcance y vigencia de la autorización especial | Documentar criterio adoptado y su relación con la autorización docente |
| P-06 | Terminado | Añadir asignación administrable de cargos e historial | Elegir académicos existentes; solo administración autorizada cambia cargos; historial conservado |
| P-07 | Terminado | Añadir aprobación de GNSS al flujo docente existente | Uno de los cargos puede aprobar, con firma y trazabilidad; otros usuarios no pueden hacerlo |
| P-08 | Terminado | Mostrar autorización al seleccionar Trimble | Identificar TDC6 por marca/modelo; mostrar autorizado o faltante; mantener estética |
| P-09 | Terminado | Bloquear préstamo y entrega sin aprobación | Comprobar servidor y pantalla, incluyendo caminos manuales y edición de préstamos |
| P-10 | Terminado | Incorporar o adaptar solicitudes de académicos | Usar el padrón existente; los profesores solicitan y Dirección/Subdirección autoriza Trimble |
| P-11 | Terminado | Separar control de GNSS de autorizaciones docentes comunes | Pendientes e historial propios con filtros y estados legibles |

## Inventario corregido

| ID | Estado | Trabajo | Condición para cerrar |
| --- | --- | --- | --- |
| I-01 | Terminado en producción | Leer Excel corregido y expandir cantidades | Resultado local: 496 filas y 625 unidades, incluidos 15 Trimble TDC6 |
| I-02 | Terminado | Comparar inventario real de Supabase con el Excel | Reportar coincidencias, códigos en conflicto, faltantes y equipos en préstamo |
| I-03 | Terminado | Revisar cantidades agrupadas y activos/series repetidos | Conservar originales; determinar representación por unidad o kit sin inventar activos |
| I-04 | Terminado | Crear importación compatible con catálogo y unidades actuales | Validación previa, operación transaccional y repetición sin duplicados |
| I-05 | Terminado | Cargar a la base de producción | Respaldo/exportación previa, conciliación de unidades y verificación de disponibilidad |

El informe local contiene 153 incidencias de unidades; son anotaciones generadas al expandir grupos o conservar identificadores repetidos. No equivalen a 153 filas incorrectas ni confirman errores en Supabase.

## Verificación y publicación

- [x] Probar estudiantes y académicos, con equipos comunes, Trimble y solicitudes mixtas.
- [x] Probar aprobación por director y por subdirector; rechazar a cualquier otro usuario.
- [x] Probar cambio de cargos y conservación del historial.
- [x] Probar ausencia, revocación y vencimiento de autorización según el alcance adoptado.
- [x] Probar selección, asignación física, entrega, devolución parcial/completa y controles de cantidad y extensión de fecha.
- [x] Revisar escritorio y móvil; conservar logos, tipografía, colores y separación visual.
- [x] Verificar seguridad de tablas, RPC, firmas y datos personales; revisar asesores y el alcance del proceso público actual.
- [x] Verificar carga pública de aulas y vehículos (HTTP 200); sus archivos no se modificaron. No se realizaron reservas reales de prueba.
- [x] Publicar cambios del frontend y migraciones/servicios necesarios; GitHub Pages completado correctamente.
- [ ] Verificar la URL pública y datos reales, sin afirmar despliegue por pruebas locales.
- [ ] Actualizar AVANCE, DECISIONES y este archivo con evidencia y fecha.

## Pendientes heredados documentados

- Revisar las 3 referencias de cursos académicos sin NRC equivalente, conservadas sin relación artificial en la importación de septiembre.
- Revisar los 80 códigos de materias generales/externas no asociables al horario EDECA y los 20 estudiantes sin matrícula EDECA vinculada.
- Mantener Conserjería en pausa mientras no exista una instrucción de reactivarla.
- Corregir notas antiguas de documentación que describan como pendiente un cambio ya incorporado; verificar por código e historial.

## Estado después de implementar

La funcionalidad y la carga están implementadas en Supabase y el frontend fue publicado y verificado en GitHub Pages. Los criterios anteriores son requisitos de cierre; la evidencia actual y los límites de pruebas están en AVANCE.md.

Pendientes que requieren uso institucional: confirmar quién ocupa cada cargo (ambas personas ya pueden aprobar); revisar con bodega los lotes sin identificación individual y los 35 equipos preexistentes conservados. Verificar el primer comprobante real de académico durante una entrega autorizada; no se enviaron correos de prueba.

La captura antigua con etiquetas Django no pudo reproducirse en la ruta publicada. Si vuelve a ocurrir, registrar la URL completa y la versión de recursos servidos.

## Inventario en tabla editable

- Implementado: edición directa de atributos por fila, filtros, paginación, guardado y descarte sin ventana de edición.
- Verificado con datos sintéticos: persistencia del guardado mediante el RPC simulado, errores y conservación de borradores; formato compacto en escritorio y móvil.
- Publicación y recursos servidos: verificar al completar la integración en GitHub Pages. No se realizaron cambios de prueba en el inventario real.
