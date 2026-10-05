# Continuidad de trabajo en SIGEP

Antes de modificar código o datos, leer `AVANCE.md`, `PENDIENTES.md`, `DECISIONES.md`, `IDEAS.md` y `docs/arquitectura-usuarios.md`. Consultar el historial relevante cuando se necesite comprobar una decisión previa.

La aplicación vigente es este repositorio, publicado en GitHub Pages y conectado con Supabase. Un prototipo o una copia local Django no constituye evidencia de despliegue ni de datos cargados en producción.

Requisitos del usuario:

- Conservar la estética existente.
- No romper los módulos que ya funcionan; probar los flujos afectados antes de publicar.
- Usar un único padrón institucional de académicos, `teacher_registry`, sin duplicarlo por módulo.
- Conservar historial, firmas, préstamos y relaciones al cambiar personas, cargos o inventario.
- Actualizar los registros de avance, pendientes, decisiones e ideas al realizar cambios. Separar requisitos confirmados de propuestas y supuestos.

No incluir datos personales del padrón, contraseñas ni tokens en estos archivos públicos. Documentar las cifras de importación y la ubicación lógica de las fuentes, no sus registros individuales.
