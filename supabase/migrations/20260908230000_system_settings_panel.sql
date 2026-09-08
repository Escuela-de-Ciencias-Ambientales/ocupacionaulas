-- Panel de parametros del superadmin (system_settings) y limpieza de un permiso
-- redundante detectado en auditoria: la tabla public.reservations tenia otorgado
-- select a "anon" desde la migracion original, pero la politica RLS vigente
-- ("Reservas visibles para usuarios autenticados", ver 202607220002) ya exige
-- "to authenticated". El grant a anon no habilita ninguna fila hoy porque RLS
-- deniega por defecto sin una politica que aplique a ese rol, pero se revoca
-- para que el permiso otorgado coincida con la intencion real del sistema.

revoke select on public.reservations from anon;

-- Tabla de parametros editables por el superadmin. Cada modulo nuevo debe
-- preferir leer su configuracion de aqui en vez de codificar valores fijos
-- en el frontend.
create table if not exists public.system_settings (
  key text primary key,
  value jsonb not null,
  description text,
  updated_at timestamptz not null default now(),
  updated_by uuid references public.profiles(id)
);

alter table public.system_settings enable row level security;

create policy "Superadmin lee y escribe parametros"
on public.system_settings for all
to authenticated
using (public.is_superadmin())
with check (public.is_superadmin());

create policy "Personal autenticado lee parametros"
on public.system_settings for select
to authenticated
using (true);

grant select on public.system_settings to authenticated;
grant insert, update, delete on public.system_settings to authenticated;

create or replace function public.touch_system_settings()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  new.updated_by = auth.uid();
  return new;
end;
$$;

drop trigger if exists trg_touch_system_settings on public.system_settings;
create trigger trg_touch_system_settings
before insert or update on public.system_settings
for each row execute function public.touch_system_settings();

-- Valores iniciales, tomados de lo que hoy esta fijo en el codigo del frontend.
-- Cargarlos aqui no cambia el comportamiento actual; lo hace editable a futuro
-- una vez que cada modulo los consulte en vez de usar el valor fijo.
insert into public.system_settings (key, value, description) values
  ('reservas_hora_maxima', '"21:00"', 'Hora limite para reservar un aula.'),
  ('vehiculos_limite_semanal', '3', 'Limite de reservas de vehiculo por docente por semana.'),
  ('conserjeria_activo', 'false', 'Si el modulo de conserjeria esta visible en la navegacion. Se desactivo intencionalmente; el codigo permanece en el repositorio para reactivarlo sin reconstruirlo.'),
  ('bodega_limite_prestamo_dias', '8', 'Dias maximos de prestamo de un equipo antes de marcarse vencido.'),
  ('sistema_nombre_publico', '"SIGEP — Sistema Integrado de Gestion de Equipos y Prestamos"', 'Nombre visible del sistema en encabezados.')
on conflict (key) do nothing;
