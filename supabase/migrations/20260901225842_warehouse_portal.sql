create table public.warehouse_staff (
  user_id uuid primary key references auth.users(id) on delete cascade,
  full_name text not null check (char_length(trim(full_name)) between 3 and 100),
  active boolean not null default true,
  created_at timestamptz not null default now()
);

alter table public.warehouse_staff enable row level security;
revoke all on public.warehouse_staff from anon, authenticated;

alter table public.student_loan_requests
  add column processed_by uuid references auth.users(id) on delete set null,
  add column delivered_at timestamptz,
  add column returned_at timestamptz;

create or replace function public.is_warehouse_staff()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.warehouse_staff
    where user_id = (select auth.uid()) and active
  );
$$;

revoke all on function public.is_warehouse_staff() from public, anon;
grant execute on function public.is_warehouse_staff() to authenticated;

create or replace function public.warehouse_dashboard_data()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare result jsonb;
begin
  if not public.is_warehouse_staff() then
    raise exception using errcode = '42501', message = 'Acceso exclusivo para personal de bodega';
  end if;

  select jsonb_build_object(
    'staff_name', (select full_name from public.warehouse_staff where user_id = (select auth.uid())),
    'metrics', jsonb_build_object(
      'pending', (select count(*) from public.student_loan_requests where status = 'pending'),
      'approved', (select count(*) from public.student_loan_requests where status = 'approved'),
      'delivered', (select count(*) from public.student_loan_requests where status = 'delivered'),
      'overdue', (select count(*) from public.student_loan_requests where status = 'delivered' and expected_return_at < now())
    ),
    'requests', (
      select coalesce(jsonb_agg(jsonb_build_object(
        'id', r.id,
        'request_number', r.request_number,
        'status', r.status,
        'created_at', r.created_at,
        'expected_return_at', r.expected_return_at,
        'student_name', s.full_name,
        'national_id', s.national_id,
        'career', s.career,
        'items', (
          select coalesce(jsonb_agg(jsonb_build_object(
            'name', c.name,
            'quantity', i.quantity
          ) order by c.name), '[]'::jsonb)
          from public.student_loan_request_items i
          join public.equipment_catalog c on c.id = i.equipment_catalog_id
          where i.request_id = r.id
        )
      ) order by
        case r.status when 'pending' then 1 when 'approved' then 2 when 'delivered' then 3 else 4 end,
        r.created_at desc), '[]'::jsonb)
      from public.student_loan_requests r
      join public.academic_students s on s.id = r.student_id
    ),
    'equipment', (
      select coalesce(jsonb_agg(jsonb_build_object(
        'id', id, 'name', name, 'available', available_quantity, 'active', active
      ) order by sort_order, name), '[]'::jsonb)
      from public.equipment_catalog
    ),
    'clients', (
      select coalesce(jsonb_agg(jsonb_build_object(
        'id', s.id,
        'national_id', s.national_id,
        'full_name', s.full_name,
        'career', s.career,
        'active_loans', (select count(*) from public.student_loan_requests r where r.student_id = s.id and r.status = 'delivered')
      ) order by s.full_name), '[]'::jsonb)
      from public.academic_students s
      where s.active
    )
  ) into result;
  return result;
end;
$$;

create or replace function public.warehouse_update_request(p_request_id bigint, p_status text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare current_status text;
begin
  if not public.is_warehouse_staff() then
    raise exception using errcode = '42501', message = 'Acceso exclusivo para personal de bodega';
  end if;
  if p_status not in ('approved', 'delivered', 'returned', 'rejected') then
    raise exception using errcode = '22023', message = 'Estado no permitido';
  end if;

  select status into current_status
  from public.student_loan_requests
  where id = p_request_id
  for update;
  if not found then
    raise exception using errcode = 'P0002', message = 'Solicitud no encontrada';
  end if;

  if not (
    (current_status = 'pending' and p_status in ('approved', 'rejected'))
    or (current_status = 'approved' and p_status in ('delivered', 'rejected'))
    or (current_status = 'delivered' and p_status = 'returned')
  ) then
    raise exception using errcode = '22023', message = 'Cambio de estado no permitido';
  end if;

  if p_status = 'delivered' then
    if exists (
      select 1
      from public.student_loan_request_items i
      join public.equipment_catalog c on c.id = i.equipment_catalog_id
      where i.request_id = p_request_id and c.available_quantity < i.quantity
    ) then
      raise exception using errcode = '22023', message = 'No hay cantidad suficiente para entregar todos los equipos';
    end if;
    update public.equipment_catalog c
    set available_quantity = c.available_quantity - i.quantity
    from public.student_loan_request_items i
    where i.request_id = p_request_id and i.equipment_catalog_id = c.id;
  elsif p_status = 'returned' then
    update public.equipment_catalog c
    set available_quantity = c.available_quantity + i.quantity
    from public.student_loan_request_items i
    where i.request_id = p_request_id and i.equipment_catalog_id = c.id;
  end if;

  update public.student_loan_requests
  set status = p_status,
      processed_by = (select auth.uid()),
      delivered_at = case when p_status = 'delivered' then now() else delivered_at end,
      returned_at = case when p_status = 'returned' then now() else returned_at end
  where id = p_request_id;

  return jsonb_build_object('ok', true, 'status', p_status);
end;
$$;

create or replace function public.warehouse_save_equipment(
  p_id bigint,
  p_name text,
  p_available integer,
  p_active boolean default true
)
returns bigint
language plpgsql
security definer
set search_path = ''
as $$
declare saved_id bigint;
begin
  if not public.is_warehouse_staff() then
    raise exception using errcode = '42501', message = 'Acceso exclusivo para personal de bodega';
  end if;
  if char_length(trim(coalesce(p_name, ''))) < 2 or p_available < 0 or p_available > 10000 then
    raise exception using errcode = '22023', message = 'Datos de equipo no válidos';
  end if;
  if p_id is null then
    insert into public.equipment_catalog(name, available_quantity, active, sort_order)
    values(trim(p_name), p_available, coalesce(p_active, true), 999)
    returning id into saved_id;
  else
    update public.equipment_catalog
    set name = trim(p_name), available_quantity = p_available, active = coalesce(p_active, true)
    where id = p_id
    returning id into saved_id;
    if saved_id is null then
      raise exception using errcode = 'P0002', message = 'Equipo no encontrado';
    end if;
  end if;
  return saved_id;
end;
$$;

revoke all on function public.warehouse_dashboard_data() from public, anon;
revoke all on function public.warehouse_update_request(bigint, text) from public, anon;
revoke all on function public.warehouse_save_equipment(bigint, text, integer, boolean) from public, anon;
grant execute on function public.warehouse_dashboard_data() to authenticated;
grant execute on function public.warehouse_update_request(bigint, text) to authenticated;
grant execute on function public.warehouse_save_equipment(bigint, text, integer, boolean) to authenticated;
