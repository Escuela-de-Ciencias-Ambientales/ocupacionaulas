# Arquitectura de usuarios del sistema

Este contrato debe respetarse en todos los módulos actuales y futuros.

## Fuentes maestras

- `academic_students`: estudiantes. Se utiliza exclusivamente para clientes, solicitudes, préstamos y devoluciones de Bodega. Un estudiante no se convierte en usuario de reservas por aparecer en esta tabla.
- `teacher_registry`: padrón institucional de académicos autorizados. Permite el registro de una cuenta y contiene las asignaciones de cursos para autorizaciones de equipos.
- `profiles`: cuentas autenticadas del personal UNA. Es la fuente compartida para aulas, vehículos, equipos y servicios futuros.

## Roles

- `teacher`: académico. Puede utilizar los servicios habilitados para personal docente, incluyendo aulas, vehículos y autorizaciones de equipos.
- `admin / reservations`: administración intermedia de reservas. Actualmente corresponde a Jenny y Marilyn.
- `admin / operations`: administración intermedia operativa. Actualmente corresponde a Dayanne.
- `admin / superadmin`: administración integral de todos los módulos actuales y futuros. Actualmente corresponde a Adrián.

Los módulos nuevos deben consultar `profiles.role`, `profiles.admin_scope`, `profiles.active` y la función administrativa correspondiente. No deben copiar personas en tablas independientes ni usar nombres o correos codificados como mecanismo de autorización.

Las relaciones históricas deben realizarse mediante identificadores persistentes. Desactivar una cuenta o cambiar sus datos no debe eliminar reservas, préstamos, devoluciones, firmas ni autorizaciones existentes.

## Regla explícita: estudiantes solo en bodega

Un estudiante (`academic_students`) nunca es una cuenta de acceso al sistema y nunca debe poder reservar aulas, reservar vehículos o escribir bitácoras. Su presencia en el sistema se limita estrictamente a ser cliente, solicitante o receptor dentro del módulo de bodega de equipos. Ningún módulo nuevo debe otorgar permisos ni políticas RLS que conecten `academic_students` con `reservations`, `vehicle_reservations` o `vehicle_trip_logs`. Verificado en la auditoría del 2026-09-08: ninguna migración existente rompe esta regla.

## Parámetros del sistema

Los valores configurables por el superadministrador (horarios límite, límites de uso, textos públicos, activación de módulos) viven en `public.system_settings`, editable desde `configuracion.html`. Un módulo nuevo que necesite un valor configurable debe agregarlo ahí en vez de codificarlo de forma fija.
