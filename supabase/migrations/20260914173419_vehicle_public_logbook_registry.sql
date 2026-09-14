-- Padrón único de personas autorizadas y bitácora pública por QR de vehículo.
-- La cédula se conserva exclusivamente en teacher_registry; los formularios
-- públicos reciben una sesión temporal, nunca acceso directo a las tablas.

create unique index if not exists teacher_registry_national_id_unique_idx
  on public.teacher_registry (nullif(national_id, ''))
  where nullif(national_id, '') is not null;

create table if not exists public.vehicle_public_logbook_sessions (
  id uuid primary key default gen_random_uuid(),
  token_hash text not null unique check (token_hash ~ '^[a-f0-9]{64}$'),
  vehicle_id bigint not null references public.vehicles(id) on delete restrict,
  teacher_registry_id bigint not null references public.teacher_registry(id) on delete restrict,
  expires_at timestamptz not null,
  used_at timestamptz,
  created_at timestamptz not null default now(),
  check (expires_at > created_at)
);

create index if not exists vehicle_public_logbook_sessions_active_idx
  on public.vehicle_public_logbook_sessions (token_hash, expires_at)
  where used_at is null;
create index if not exists vehicle_public_logbook_sessions_vehicle_idx
  on public.vehicle_public_logbook_sessions (vehicle_id);
create index if not exists vehicle_public_logbook_sessions_teacher_idx
  on public.vehicle_public_logbook_sessions (teacher_registry_id);

create table if not exists public.vehicle_public_logbooks (
  id uuid primary key default gen_random_uuid(),
  session_id uuid not null unique references public.vehicle_public_logbook_sessions(id) on delete restrict,
  vehicle_id bigint not null references public.vehicles(id) on delete restrict,
  teacher_registry_id bigint not null references public.teacher_registry(id) on delete restrict,
  trip_sheet_number text not null check (char_length(trim(trip_sheet_number)) between 1 and 60),
  departure_mileage integer check (departure_mileage is null or departure_mileage >= 0),
  arrival_mileage integer check (arrival_mileage is null or arrival_mileage >= 0),
  departure_fuel_level text check (departure_fuel_level is null or departure_fuel_level in ('quarter', 'half', 'three_quarters', 'full')),
  arrival_fuel_level text check (arrival_fuel_level is null or arrival_fuel_level in ('quarter', 'half', 'three_quarters', 'full')),
  vehicle_condition text check (vehicle_condition is null or vehicle_condition in ('clean', 'dirty', 'other')),
  fueling_mileage integer check (fueling_mileage is null or fueling_mileage >= 0),
  service_station_location text check (service_station_location is null or char_length(trim(service_station_location)) <= 160),
  fuel_liters numeric(10,2) check (fuel_liters is null or fuel_liters >= 0),
  fuel_type text check (fuel_type is null or fuel_type in ('diesel', 'regular', 'super', 'other')),
  invoice_amount numeric(12,2) check (invoice_amount is null or invoice_amount >= 0),
  invoice_date date,
  invoice_number text check (invoice_number is null or char_length(trim(invoice_number)) <= 80),
  voucher_authorization_number text check (voucher_authorization_number is null or char_length(trim(voucher_authorization_number)) <= 80),
  observations text check (observations is null or char_length(trim(observations)) <= 2000),
  photo_path text,
  photo_bytes integer check (photo_bytes is null or photo_bytes between 1 and 1048576),
  submitted_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  check (arrival_mileage is null or departure_mileage is null or arrival_mileage >= departure_mileage)
);

create index if not exists vehicle_public_logbooks_vehicle_submitted_idx
  on public.vehicle_public_logbooks (vehicle_id, submitted_at desc);
create index if not exists vehicle_public_logbooks_teacher_submitted_idx
  on public.vehicle_public_logbooks (teacher_registry_id, submitted_at desc);

alter table public.vehicle_public_logbook_sessions enable row level security;
alter table public.vehicle_public_logbooks enable row level security;

drop policy if exists "Administración consulta bitácoras públicas" on public.vehicle_public_logbooks;
create policy "Administración consulta bitácoras públicas"
on public.vehicle_public_logbooks for select to authenticated
using (public.is_admin());

revoke all on public.vehicle_public_logbook_sessions from anon, authenticated;
revoke all on public.vehicle_public_logbooks from anon, authenticated;

comment on column public.teacher_registry.national_id is 'Cédula normalizada del padrón institucional, reutilizada por los módulos autorizados.';
comment on table public.vehicle_public_logbooks is 'Bitácoras registradas por QR y cédula, sin vinculación obligatoria a una reserva.';
