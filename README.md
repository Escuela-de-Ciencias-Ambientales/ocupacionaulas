# Reservas de aulas · EDECA

Sistema pequeño de consulta y reserva de aulas para la Escuela de Ciencias Ambientales de la Universidad Nacional. Admite hasta 50 cuentas docentes y conserva como referencia el horario académico del II Ciclo 2026.

## Funciones incluidas

- Consulta pública del horario académico fijo.
- Página pública limpia, dedicada únicamente a la ocupación académica.
- Página independiente para el ingreso del personal docente.
- Área privada de reservas disponible únicamente después de iniciar sesión.
- Vista diaria de tramos disponibles y ocupados para cada aula dentro del área privada.
- Inicio de sesión individual con correo y contraseña.
- Registro inicial únicamente para docentes autorizados previamente por la administración.
- Campos de contraseña con control para mostrar u ocultar el texto.
- Cambio de contraseña personal con validación de seguridad.
- Creación de reservas por fecha, aula, hora de inicio, hora de finalización y actividad.
- Reserva directa desde cualquier tramo disponible, con horario máximo hasta las 21:00.
- Bloqueo de cruces con clases fijas y con otras reservas.
- Lista personal de próximas reservas y cancelación por parte del propietario.
- Acceso maestro para consultar y cancelar cualquier reserva.
- Dos niveles administrativos: superadministrador y administrador de reservas.
- El superadministrador controla ciclos, roles administrativos y cargas masivas de docentes.
- El administrador de reservas puede crear docentes, gestionar reservas y editar la ocupación académica únicamente desde el calendario semanal.
- Editor semanal visual para crear, modificar o eliminar cursos directamente en cada bloque del aula, incluyendo profesor, código, nombre del curso, grupo y NRC.
- Creación individual de cuentas y carga masiva de docentes autorizados mediante Excel.
- Diseño adaptable para computadora, tableta y teléfono.
- Registro de cancelaciones y reglas de seguridad en la base de datos.
- Ciclos configurables por la administración, incluidas las fechas reservables y la ventana de apertura del sistema.
- Reservas cerradas por defecto: solo pueden abrirse después de cargar la ocupación académica prioritaria.
- Carga y reemplazo del horario de clases mediante una plantilla Excel desde el panel maestro.

## Estructura

- `index.html`: página pública del horario académico, con acceso hacia el ingreso docente.
- `ingreso.html`: página exclusiva para usuario y contraseña.
- `reservas.html`: área privada de consulta y reservación.
- `ingreso.css` y `ingreso.js`: presentación y autenticación de la página de acceso.
- `reservas.css`: estilos del sistema de acceso y reservas.
- `reservas.js`: autenticación, disponibilidad, reservas y administración.
- `config.js`: conexión pública con Supabase.
- `supabase/migrations/`: esquema, restricciones y políticas de seguridad.
- `supabase/seed.sql`: ocupaciones académicas iniciales que bloquean reservas.
- `plantillas/plantilla_ocupacion_aulas.xlsx`: plantilla para cargar las clases de cada nuevo ciclo.
- `plantillas/plantilla_cuentas_docentes.xlsx`: plantilla para autorizar o crear docentes en lote.
- `supabase/functions/admin-create-user/`: función segura para autorizar o crear cuentas.
- `supabase/functions/register-teacher/`: registro inicial restringido a la lista administrativa.
- `.github/workflows/pages.yml`: publicación automática en GitHub Pages.

## Configuración de Supabase

1. Crear un proyecto de Supabase.
2. Ejecutar, en orden, las migraciones de `supabase/migrations/`.
3. Ejecutar `supabase/seed.sql`.
4. Desplegar las funciones `admin-create-user` y `register-teacher`.
5. En Authentication, desactivar el registro público de usuarios.
6. Crear manualmente la primera cuenta administrativa.
7. Ejecutar `supabase/bootstrap-admin.sql.example` con el correo real de esa cuenta.
8. Copiar la URL del proyecto y la clave pública `anon` en `config.js`.
9. Agregar como URL permitida de autenticación:
   `https://escuela-de-ciencias-ambientales.github.io/reservas_aulas/`

La clave `anon` de Supabase está diseñada para utilizarse en el navegador. La clave `service_role` nunca debe guardarse en este repositorio ni en `config.js`; la función administrativa la recibe automáticamente en el entorno seguro de Supabase.

## Flujo de cuentas

La primera cuenta maestra queda configurada como superadministrador. Solo ese perfil puede crear otros superadministradores, administradores de reservas o realizar cargas masivas de docentes y horarios. El administrador de reservas puede crear cuentas docentes individuales, gestionar reservas y modificar el horario directamente en el calendario semanal, pero no puede consultar ni modificar listas masivas. Si una fila del Excel no contiene contraseña, el correo queda autorizado para que el profesor complete su registro inicial; si contiene una contraseña válida, la cuenta se crea inmediatamente.

## Apertura de cada ciclo

El administrador configura el nombre y las fechas del ciclo, así como la apertura y el cierre del sistema. Guardar la configuración deja las reservas cerradas. Después se carga la ocupación académica con `plantilla_ocupacion_aulas.xlsx`; esta operación reemplaza el horario fijo del ciclo y también mantiene el sistema cerrado. Solo entonces se habilita el botón **Abrir reservas**. Las clases cargadas siempre tienen prioridad sobre las solicitudes docentes.

## Seguridad

La base de datos aplica políticas RLS. Un docente solo puede crear reservas a su nombre y cancelar las propias. Los administradores pueden gestionar reservas y ocupaciones académicas; únicamente el superadministrador puede cambiar roles o gestionar la autorización masiva. La restricción de exclusión de PostgreSQL impide reservas simultáneas incluso si dos personas intentan guardar al mismo tiempo. Las reglas también rechazan cruces entre el horario académico editado y reservas activas.

## Desarrollo local

Sirve la carpeta mediante cualquier servidor estático. Por ejemplo:

```text
python -m http.server 8781
```

Después abre `http://127.0.0.1:8781/`.

Sin credenciales en `config.js`, la interfaz carga en modo de configuración y mantiene visible el horario base, pero desactiva el acceso y la creación de reservas.
