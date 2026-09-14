-- Amplía el reporte público por QR con la misma revisión operativa de la bitácora.
-- Los datos se mantienen privados: las tablas ya tienen RLS y no conceden acceso a anon.

alter table public.vehicle_public_logbooks
  add column if not exists departure_at timestamptz,
  add column if not exists arrival_at timestamptz,
  add column if not exists destination text check (destination is null or char_length(trim(destination)) <= 240),
  add column if not exists vehicle_clean_out boolean,
  add column if not exists oils_checked boolean,
  add column if not exists coolant_checked boolean,
  add column if not exists oil_change_checked boolean,
  add column if not exists tools_checked boolean,
  add column if not exists safety_kit_checked boolean,
  add column if not exists documents_checked boolean,
  add column if not exists outbound_damage boolean,
  add column if not exists vehicle_clean_return boolean,
  add column if not exists new_damage boolean,
  add column if not exists departure_notes text check (departure_notes is null or char_length(trim(departure_notes)) <= 1000),
  add column if not exists return_notes text check (return_notes is null or char_length(trim(return_notes)) <= 1000),
  add column if not exists departure_photo_path text,
  add column if not exists return_photo_path text,
  add column if not exists signature_data text check (signature_data is null or char_length(signature_data) <= 450000);

alter table public.vehicle_public_logbooks
  add constraint vehicle_public_logbooks_arrival_after_departure_chk
  check (arrival_at is null or departure_at is null or arrival_at >= departure_at);

-- La escala de la bitácora operativa también contempla "Reserva".
alter table public.vehicle_public_logbooks
  drop constraint if exists vehicle_public_logbooks_departure_fuel_level_check,
  drop constraint if exists vehicle_public_logbooks_arrival_fuel_level_check;

alter table public.vehicle_public_logbooks
  add constraint vehicle_public_logbooks_departure_fuel_level_check
    check (departure_fuel_level is null or departure_fuel_level in ('reserve', 'quarter', 'half', 'three_quarters', 'full')),
  add constraint vehicle_public_logbooks_arrival_fuel_level_check
    check (arrival_fuel_level is null or arrival_fuel_level in ('reserve', 'quarter', 'half', 'three_quarters', 'full'));
