-- Límite de intentos para la validación pública por QR y cédula.
-- Solo la función Edge escribe en esta tabla; no expone datos personales.

create table if not exists public.vehicle_public_logbook_attempts (
  id bigint generated always as identity primary key,
  vehicle_plate text not null check (vehicle_plate ~ '^[A-Z0-9-]{3,20}$'),
  fingerprint_hash text not null check (fingerprint_hash ~ '^[a-f0-9]{64}$'),
  attempted_at timestamptz not null default now()
);

create index if not exists vehicle_public_logbook_attempts_limit_idx
  on public.vehicle_public_logbook_attempts (fingerprint_hash, vehicle_plate, attempted_at desc);

create index if not exists vehicle_public_logbook_sessions_vehicle_idx
  on public.vehicle_public_logbook_sessions (vehicle_id);
create index if not exists vehicle_public_logbook_sessions_teacher_idx
  on public.vehicle_public_logbook_sessions (teacher_registry_id);

alter table public.vehicle_public_logbook_attempts enable row level security;
revoke all on public.vehicle_public_logbook_attempts from anon, authenticated;

comment on table public.vehicle_public_logbook_attempts is
  'Registro técnico con hash para limitar intentos del acceso público a bitácoras.';
