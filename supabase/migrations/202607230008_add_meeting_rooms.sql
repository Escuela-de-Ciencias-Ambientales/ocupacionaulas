insert into public.classrooms (code, name, sort_order, active)
values
  ('SS-3P', 'Sala de sesiones tercer piso', 8, true),
  ('SR-1P', 'Sala reuniones primer piso', 9, true)
on conflict (code) do update
set name = excluded.name,
    sort_order = excluded.sort_order,
    active = true;
