create index if not exists vehicle_trip_logs_reviewed_by_idx
on public.vehicle_trip_logs(reviewed_by)
where reviewed_by is not null;
