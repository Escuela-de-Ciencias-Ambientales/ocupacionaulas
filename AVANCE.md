# Avance de SIGEP

Actualizado: 5 de octubre de 2026, hora de Costa Rica.

## Punto de partida

La aplicación vigente es el sitio de `Escuela-de-Ciencias-Ambientales/ocupacionaulas`, publicado en GitHub Pages. Su interfaz utiliza HTML, CSS y JavaScript; el almacenamiento, permisos y operaciones se ejecutan en Supabase. La aplicación local de préstamos en Django es un desarrollo separado y no es la versión publicada.

Este registro reúne evidencia del historial de chats y del repositorio. No sustituye la verificación del estado actual de la base de producción.

## Trabajo existente que debe conservarse

| Área | Estado documentado | Evidencia |
| --- | --- | --- |
| Aulas y vehículos | Módulos existentes; conservar funcionamiento y diseño | README y chat «Actualiza ocupación de aulas» |
| Bodega | Solicitudes de estudiantes, autorizaciones docentes, entrega de unidades, préstamos activos, devoluciones y gestión de clientes | `bodega-equipos.html`, `bodega-equipos.js` y migraciones de septiembre |
| Autorización docente | Identificación mediante cédula del padrón maestro, cursos o estudiante individual, motivo y firma | `autorizaciones-equipos.js` y migración `20260902211000_warehouse_professor_management.sql` |
| Académicos | 38 académicos incorporados; 42 cursos relacionados con 28 académicos; 10 sin curso asignado | [Registro de importación](docs/importaciones/2026-09-08-academicos-edeca.md) |
| Estudiantes | 263 estudiantes; 701 matrículas relacionadas; normalizaciones documentadas | [Registro de importación](docs/importaciones/2026-09-08-estudiantes-ii-ciclo.md) |
| Diseño | Utilidades compartidas, encabezado común, estilos institucionales y versiones de recursos en cada despliegue | `shared-utils.js`, `shared-header.css`, `design-tokens.css` y flujo de Pages |
| Bitácora pública | QR del vehículo, validación con padrón único, controles de salida y regreso, fotografías y firma; sin facturación | Chat «Actualiza ocupación de aulas» y commits de septiembre |
| Conserjería | Historial de desarrollo conservado; actualmente en pausa según README | README y chat «Actualiza ocupación de aulas» |

El encabezado compartido se integró posteriormente al apartado antiguo del README que todavía lo indicaba como pendiente. El commit `8736479` registra esa integración.

## Solicitud actual: GNSS Trimble

Se requiere una aprobación adicional del director o subdirector, indistintamente, para estudiantes y profesores. La selección debe mostrar el estado de autorización y el préstamo debe bloquearse si falta. Debe existir un control separado y una forma de cambiar ambos cargos usando la lista maestra de académicos.

Las personas indicadas son Vanessa Valerio Hernández y Manfred Murrel Blanco. Sus identificaciones fueron proporcionadas por el usuario en el chat; no se reproducen en estos documentos del repositorio público.

## Trabajo realizado en octubre y su alcance real

| Acción | Dónde se realizó | Estado |
| --- | --- | --- |
| Modelos, bloqueo, módulo de autorizaciones y cambio de cargos | Copia local Django | Implementado localmente; no trasladado a producción |
| Registro de las dos personas y cuentas con contraseña inutilizable | SQLite local | No equivale a actualizar `teacher_registry` ni las cuentas de Supabase |
| Carga del Excel corregido | SQLite local | 496 filas expandidas a 625 unidades; incluye 15 Trimble TDC6 |
| Tratamiento de cantidades y duplicados | Importador local | 153 incidencias de unidades documentadas; conservar datos originales para revisión |
| Pruebas locales | Django | 26 pruebas aprobadas; no validan el sistema publicado |
| Respaldo de la base | SQLite local | Respaldo previo a las migraciones e importación |
| Revisión del repositorio en línea | Repositorio GitHub y copia de trabajo histórica | Arquitectura y módulos existentes identificados |
| Recuperación de contexto | Chats «Actualiza ocupación de aulas» y «Crear sitio de préstamos de equipos», más documentación existente | Revisados antes de nuevos cambios funcionales |

La versión inicial del Excel tenía 481 filas y no contenía los Trimble. La versión corregida agregó 15 filas con marca Trimble y modelo TDC6, descritas como recolectores de datos portátiles. La detección no puede depender solo de que el nombre diga GNSS.

## Incidencia visual reportada

El usuario mostró una pantalla con etiquetas Django literales (`{% ... %}` y `{{ ... }}`) e indicó la ruta `bodega-equipos.html?view=authorizations`. La captura confirma una vista incorrecta. El archivo HTML del repositorio revisado sí tiene estructura estática y estilos institucionales; todavía falta reproducir la ruta en el navegador y establecer qué recurso produjo la pantalla de la captura. No se ha confirmado la causa del despliegue.

## Próximo trabajo

Consultar [PENDIENTES.md](PENDIENTES.md) para el orden de implementación y [DECISIONES.md](DECISIONES.md) antes de modificar datos o pantallas.

## Implementación online — 5 de octubre de 2026

- Migración `20261005173403_equipment_gnss_direction_authorizations` aplicada a Supabase; no se sustituyó el esquema previo.
- Dirección y Subdirección vinculadas a las dos personas existentes en `teacher_registry`, sin duplicar padrón ni crear cuentas nuevas. Asignación provisional: Vanessa en Dirección y Manfred en Subdirección, editable por superadministración.
- Aprobación individual con cédula, motivo y firma, usando el proceso docente existente. Cada aprobación cubre una solicitud, un tipo de Trimble, una cantidad máxima y una fecha límite; cualquiera de los dos cargos puede emitirla.
- Bloqueo en servidor al solicitar, asignar, entregar y editar cantidad o devolución. Los estudiantes conservan el requisito de visto bueno docente; académicos usan el mismo formulario de solicitud y su padrón maestro.
- Panel separado «Autorizaciones GNSS» con cargos, selección de académicos, aprobaciones, revocación e historial de cargos y firmas. Se conserva el diseño institucional.
- Excel corregido conciliado: 496 filas, 625 unidades importadas, 15 Trimble TDC6. Se conservaron las 35 unidades y las cuatro solicitudes previas, incluido el préstamo activo: total 660 unidades, 659 disponibles. Activos/series compartidos se conservaron en observaciones, sin inventar identificadores por unidad.
- Respaldo privado previo fuera del repositorio público. Importación transaccional probada y repetida sin duplicación.
- Servicio `send-equipment-receipt` versión 6 desplegado para resolver solicitantes académicos. No se enviaron correos de prueba a personas reales.
- Pruebas SQL transaccionales aprobadas y revertidas: estudiantes y académicos, permisos, ambos cargos, cambio de autoridad, consumo único, cantidades, revocación, entrega, extensión de fecha y consultas de firmas/dashboard. Validación JavaScript y vistas con datos sintéticos aprobadas.
- Las pruebas con ROLLBACK quedaron registradas por la herramienta de migración remota como entradas sin cambios efectivos; sus archivos locales documentan ese alcance.
- La ruta pública reportada cargó el acceso institucional correctamente; no se reprodujeron las etiquetas Django. No se afirma una causa de aquella captura.
- Frontend publicado mediante PR #30, commit `ffdb3f1a`, con GitHub Pages finalizado correctamente (ejecución `37350146714`). El navegador online cargó los nuevos recursos y el formulario GNSS de Dirección desde Supabase.

### Verificación final

- Pruebas integrales de los RPC existentes aprobadas con ROLLBACK: solicitud común de académico, solicitud mixta, solicitud estudiantil con ambas aprobaciones, aprobación por Subdirección, entrega y devolución parcial/completa. No quedaron autorizaciones ni préstamos de prueba en producción.
- Se corrigió una vía preexistente en `warehouse_deliver_request` que aceptaba unidades adicionales fuera de los tipos solicitados. Ahora rechaza unidades ajenas o repetidas antes de modificar inventario; migración `20261005174106_gnss_delivery_reject_unrequested_units` aplicada.
- Recuento después de todas las pruebas: 660 unidades, 659 disponibles, cuatro solicitudes anteriores y cero autorizaciones de prueba. La restricción alcanza exactamente las 15 unidades Trimble TDC6 del Excel.
- Revisión visual de escritorio y móvil (390 px) aprobada; los Trimble pueden buscarse por «GNSS» o «Trimble», aunque su categoría original diga «recolector de datos portátil».
