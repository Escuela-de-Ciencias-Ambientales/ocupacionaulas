# Decisiones de SIGEP

Actualizado: 5 de octubre de 2026, hora de Costa Rica.

## Decisiones confirmadas por el usuario o por el contrato del proyecto

| ID | Decisión | Consecuencia para la implementación |
| --- | --- | --- |
| D-01 | Trabajar sobre la aplicación en línea de `ocupacionaulas` | Los cambios locales Django no se consideran desplegados |
| D-02 | Mantener la estética existente y evitar romper módulos | Reutilizar estilos, encabezados, componentes y utilidades; comprobar vistas antes de publicar |
| D-03 | Un solo padrón institucional de académicos | Usar `teacher_registry`; no crear padrones paralelos para Dirección, vehículos o préstamos |
| D-04 | Mantener separadas las fuentes de personas | Estudiantes en `academic_students`; académicos en `teacher_registry`; cuentas y permisos en `profiles` |
| D-05 | GNSS Trimble requiere aprobación adicional para estudiantes y profesores | Aplicar el bloqueo en la base de datos y reflejarlo al seleccionar y entregar equipos |
| D-06 | Basta la autorización de uno de los dos cargos | La aprobación del director o subdirector satisface el requisito; no exigir ambas firmas |
| D-07 | Personas actuales indicadas: Vanessa Valerio Hernández y Manfred Murrel Blanco | Identificar sus registros por los datos proporcionados; no inferir identidad únicamente por el nombre |
| D-08 | El proceso debe seguir el de la autorización docente existente | Reutilizar su interacción de identificación, motivo y firma; revisar los controles reales antes de introducir otro mecanismo de acceso |
| D-09 | Control separado de autorizaciones especiales | Mostrar pendientes e historial de GNSS, con persona, fecha, responsable, alcance y estado |
| D-10 | Los cargos deben poder cambiarse desde la lista de académicos | Permitir asignación administrada y conservar las autorizaciones históricas al cambiar responsables |
| D-11 | Cargar la versión corregida del inventario | Preparar una importación a Supabase validada, repetible y sin borrar préstamos o equipos existentes |
| D-12 | Leer contexto y conservar documentación de continuidad | Consultar estos documentos y registros anteriores antes de nuevas implementaciones; actualizarlos al cerrar cambios |

Fuentes: instrucciones del usuario del 5 de octubre, chat «Actualiza ocupación de aulas» y [arquitectura de usuarios](docs/arquitectura-usuarios.md).

## Criterios técnicos derivados

- La autoridad debe comprobarse en el servidor contra la asignación vigente del cargo. Ocultar un botón en JavaScript no asegura el permiso.
- Guardar quién autorizó y qué cubrió la autorización. Un cambio de cargo no debe modificar retrospectivamente la identidad del aprobador.
- Detectar los Trimble TDC6 aunque su descripción sea «recolector de datos portátil».
- Mantener el visto bueno docente de estudiantes y añadir el de Dirección para equipos restringidos.
- Revisar las rutas de entrega, préstamos manuales y edición de préstamos activos para evitar vías que eludan el requisito.
- No guardar contraseñas, tokens, correos personales, cédulas ni el padrón completo en documentación pública. La clave pública de configuración no es una credencial administrativa.
- La importación debe usar los identificadores existentes y conservar datos de origen ante activos, series o cantidades ambiguas. No inventar números patrimoniales individuales.

## Supuestos pendientes de verificar

1. **Qué persona ocupa cada cargo.** En la copia local se asignó provisionalmente Vanessa a Dirección y Manfred a Subdirección. El usuario confirmó identidades, pero no respondió explícitamente cuál ocupa cada cargo. No tratar esa asignación provisional como confirmación institucional.
2. **Alcance y vigencia de la aprobación.** La copia local usa una aprobación por solicitud. La versión en línea debe definir si aplica por solicitud, por persona o por un periodo, respetando el proceso docente solicitado. La recomendación inicial es por solicitud y equipos/cantidades específicos, pero sigue siendo un criterio propuesto.
3. **Acceso de Dirección.** La copia local creó usuarios nuevos sin contraseña. Eso no es una decisión sobre las cuentas en producción. Primero verificar padrón, perfiles y flujo docente real.
4. **Préstamos de académicos.** Los RPC y pantallas revisados se centran en estudiantes. Es necesario revisar si producción ya tiene una ruta para académicos antes de crear otra.
5. **Causa de la captura.** Las etiquetas Django visibles no aparecen en el HTML estático revisado del repositorio. Falta comprobar el recurso publicado, la ruta y el navegador.

## Registro de cambios de criterio

- 2026-10-05: se corrigió la suposición de que la copia local era el sistema vigente. El destino es GitHub Pages + Supabase.
- 2026-10-05: se recuperó la decisión previa de padrón único; se descarta trasladar la lista local de personas como un padrón nuevo.
- 2026-10-05: las cifras de 625 unidades y 26 pruebas se clasifican como resultados locales, no como evidencia de carga o pruebas de producción.
