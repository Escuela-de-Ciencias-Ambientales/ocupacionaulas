# Registro maestro de académicos EDECA

Fuente institucional procesada: `Academicos edeca.xlsx`.

## Resultado

- 38 académicos únicos incorporados al registro institucional por cédula y correo.
- 42 cursos del II Ciclo 2026 relacionados con 28 académicos mediante coincidencias confiables con el padrón estudiantil y los NRC existentes.
- 10 académicos conservados sin curso asignado en este ciclo.
- 3 referencias de curso del padrón estudiantil no se asociaron porque no tenían un NRC equivalente en el horario cargado.
- 0 cédulas o correos duplicados.

El archivo original contiene datos personales y no se incorpora al repositorio. `teacher_registry` es la referencia maestra que autoriza el registro de cuentas docentes para aulas, vehículos y equipos. La existencia en el registro no crea automáticamente una contraseña ni una cuenta de acceso.

## Administración futura

El superadministrador puede abrir **Administrar usuarios → Académicos EDECA → Editar cursos** y agregar o quitar asignaciones por ciclo. El sistema conserva las asignaciones de ciclos anteriores y aplica un máximo de tres cursos por profesor y ciclo desde la base de datos.

Quitar una asignación no elimina reservas ni autorizaciones históricas. Los cursos del II ciclo pueden reutilizarse como referencia el año siguiente, pero deben asociarse al nuevo ciclo y NRC para mantener la trazabilidad.
