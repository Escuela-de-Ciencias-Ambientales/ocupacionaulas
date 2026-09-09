# SIGEP · Sistema Integrado de Gestión de Equipos y Préstamos — EDECA

Sistema web de la Escuela de Ciencias Ambientales (EDECA), Universidad Nacional de Costa Rica, para reservar aulas y vehículos, llevar la bitácora vehicular digital, autorizar y controlar préstamos de equipo desde bodega, y (en pausa, ver más abajo) el registro de labores de conserjería.

Este README reemplaza la versión anterior, que solo describía el alcance original del sistema (aulas, bitácora y equipos) y no mencionaba los módulos de vehículos ni conserjería que ya forman parte del código en producción.

## Módulos activos

- **Aulas** (`index.html`, `reservas.html`): horario público de ocupación académica y área privada de reservas docentes.
- **Vehículos** (`reservas.html`, `tramites-vehiculos.html`, `bitacora-vehicular.html`): reserva de vehículos institucionales, trámite de giras y bitácora digital con fotos y firma táctil.
- **Bodega de equipos** (`bodega-equipos.html`, `autorizaciones-equipos.html`, `solicitar-equipo.html`): autorización docente de préstamos, solicitud y control de devoluciones para estudiantes.
- **Administración de usuarios** (`usuarios.html`) y **configuración del sistema** (`configuracion.html`, nuevo): gestión de cuentas y parámetros editables por el superadministrador sin tocar código.

## Pendiente rastreado para la siguiente entrega

`.private-header` (el encabezado privado) está definido dos veces, en `reservas.css` y en `visual-system.css`, y cinco páginas (`index.html`, `ingreso.html`, `autorizaciones-equipos.html`, `bodega-equipos.html`, `solicitar-equipo.html`) ni siquiera cargan `reservas.css`, así que resuelven su encabezado con reglas propias en su CSS individual. Fusionar esto en un solo archivo de layout compartido es el trabajo que sigue; no se tocó en esta entrega porque requiere revisar visualmente cada página antes de quitar una regla, para no romper ningún diseño ya en producción.

## Módulo en pausa

- **Conserjería** (`conserjeria-admin.js`, `conserjeria-publico.js`, `conserjeria.css`, `conserjeria-admin.css`): se desactivó intencionalmente y su botón de acceso permanece oculto en la interfaz (atributo `data-feature-disabled`). El código se conserva completo en el repositorio para no perder el trabajo hecho; reactivarlo es un cambio de configuración (ver `system_settings` más abajo), no una reconstrucción.

## Separación de personas en el sistema

Este es un contrato que todo módulo nuevo debe respetar (ver también `docs/arquitectura-usuarios.md`):

- **Estudiantes** (`academic_students`): existen únicamente dentro del módulo de bodega de equipos, como quienes reciben o autorizan préstamos. Un estudiante nunca es cuenta de acceso al sistema: no reserva aulas, no reserva vehículos y no escribe bitácoras. Esta separación está a nivel de esquema de base de datos, no solo de interfaz.
- **Docentes** (`teacher_registry`): personal académico autorizado a reservar aulas, vehículos y autorizar préstamos de equipo para sus cursos o estudiantes.
- **Administrativos** (`profiles`, con `role`/`admin_scope`): cuentas de personal UNA con acceso administrativo. Hay dos niveles — administración intermedia (por alcance: reservas u operaciones) y superadministración, con control total sobre todos los módulos, incluidos los parámetros del sistema.

## Estructura del repositorio

- `index.html` / `reservas.html`: horario público y área privada de aulas y vehículos.
- `ingreso.html`: autenticación del personal.
- `usuarios.html`: administración de cuentas.
- `configuracion.html`: panel de parámetros del superadmin (nuevo — ver abajo).
- `autorizaciones-equipos.html`, `solicitar-equipo.html`, `bodega-equipos.html`: módulo de préstamo de equipos.
- `bitacora-vehicular.html`, `tramites-vehiculos.html`, `mis-giras.html`: módulo de vehículos y giras.
- `design-tokens.css` (nuevo): variables de color, tipografía y espaciado centralizadas. Documenta la paleta que ya estaba en uso en `sigep-brand.css` y `visual-system.css`, como primer paso hacia un sistema de diseño único; no cambia ningún estilo visual por sí solo.
- `config.js`: conexión pública con Supabase (URL y clave `anon`).
- `supabase/migrations/`: esquema, restricciones y políticas de seguridad, en orden cronológico.
- `supabase/functions/`: funciones de borde para operaciones que requieren la clave `service_role` (creación de cuentas, retención de datos, recibos de equipo).
- `plantillas/`: plantillas Excel para carga masiva de docentes y horarios.
- `qr_codes_v2/`: códigos QR impresos de los aposentos de conserjería (módulo en pausa).

## Panel de configuración del superadministrador

La tabla `public.system_settings` (migración `20260908230000_system_settings_panel.sql`) guarda parámetros editables desde `configuracion.html`, visible solo para el superadministrador. Valores iniciales cargados: hora máxima de reserva de aulas, límite semanal de reservas de vehículo, si conserjería está activa, días máximos de préstamo de equipo antes de vencerse, y el nombre público del sistema. Los módulos nuevos deben preferir leer de esta tabla en vez de codificar valores fijos.

## Configuración de Supabase

1. Crear un proyecto de Supabase.
2. Ejecutar, en orden, las migraciones de `supabase/migrations/`.
3. Ejecutar `supabase/seed.sql`.
4. Desplegar las funciones en `supabase/functions/`.
5. En Authentication → URL Configuration, la URL de redirección permitida debe ser `https://escuela-de-ciencias-ambientales.github.io/ocupacionaulas/` (el repositorio anterior, `reservas_aulas`, quedó retirado y ya no debe usarse).
6. En Authentication, desactivar el registro público de usuarios.
7. Crear manualmente la primera cuenta administrativa y ejecutar `supabase/bootstrap-admin.sql.example` con su correo real.
8. Copiar la URL del proyecto y la clave pública `anon` en `config.js`.

La clave `anon` está diseñada para usarse en el navegador. La clave `service_role` nunca debe guardarse en este repositorio ni en `config.js`; las funciones de borde la reciben automáticamente en el entorno seguro de Supabase.

## Seguridad

La base de datos aplica políticas RLS por tabla, con una función `is_admin()` / `is_superadmin()` central para evitar duplicar lógica de permisos. Las funciones de borde verifican el rol de quien llama contra `profiles` usando la clave `service_role`, no confían en lo que envía el navegador. Un docente solo puede crear y cancelar sus propias reservas; solo el superadministrador puede cambiar roles, gestionar cargas masivas o editar los parámetros del sistema.

## Desarrollo local

Sirve la carpeta mediante cualquier servidor estático, por ejemplo:

```text
python -m http.server 8781
```

Después abre `http://127.0.0.1:8781/`. Sin credenciales en `config.js`, la interfaz carga en modo de configuración y mantiene visible el horario base, pero desactiva el acceso y la creación de reservas.

## Publicación

`.github/workflows/pages.yml` publica automáticamente en GitHub Pages con cada push a `main`. Desde este cambio, el flujo también reemplaza automáticamente el número de versión (`?v=N`) de cada `.css`/`.js` local por el hash corto del commit publicado, así que ya no depende de que alguien recuerde subir el número a mano para que los navegadores dejen de usar una copia vieja en caché.

## Utilidades compartidas (`shared-utils.js`)

Nuevo archivo con el cliente único de Supabase, verificación de sesión/rol y helpers repetidos (`escapeHtml`, formato de fecha, lectura de `system_settings`). Ya está enlazado en las 10 páginas; por ahora solo `configuracion.js` lo usa en reemplazo de su boilerplate propio, como referencia para ir migrando el resto de los módulos sin tener que reescribirlos todos de una vez.
