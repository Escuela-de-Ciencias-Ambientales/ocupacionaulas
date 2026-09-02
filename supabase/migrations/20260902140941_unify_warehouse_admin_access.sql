insert into public.warehouse_staff (user_id, full_name, active)
select id, full_name, true
from public.profiles
where lower(email) = 'adrian.delgado.torres@una.cr'
  and role = 'admin'
  and active
on conflict (user_id) do update
set full_name = excluded.full_name,
    active = true;
