alter table public.academic_students
  add column if not exists loan_exception boolean not null default false,
  add column if not exists loan_exception_reason text,
  add column if not exists loan_exception_by uuid references auth.users(id) on delete set null,
  add column if not exists loan_exception_at timestamptz;

create table if not exists public.loan_request_edit_log (
  id bigint generated always as identity primary key,
  request_id bigint not null references public.student_loan_requests(id) on delete cascade,
  changed_by uuid not null references auth.users(id) on delete restrict,
  changed_at timestamptz not null default now(),
  changes jsonb not null check (jsonb_typeof(changes)='object')
);
create index if not exists loan_request_edit_log_request_idx on public.loan_request_edit_log(request_id,changed_at desc);
alter table public.loan_request_edit_log enable row level security;
revoke all on public.loan_request_edit_log from anon,authenticated;

create or replace function public.student_has_outstanding_equipment(p_student_id bigint)
returns boolean language sql stable security definer set search_path='' as $$
  select exists (
    select 1 from public.student_loan_requests r
    where r.student_id=p_student_id and r.status='delivered'
      and exists (
        select 1 from public.loan_request_unit_assignments a
        join public.student_loan_request_items i on i.id=a.request_item_id
        where i.request_id=r.id and a.returned_at is null
      )
  )
$$;
revoke all on function public.student_has_outstanding_equipment(bigint) from public,anon,authenticated;

create or replace function public.student_loan_context(p_national_id text)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare s public.academic_students; auth_record public.equipment_authorizations; result jsonb; outstanding_request_number text;
begin
  if char_length(regexp_replace(coalesce(p_national_id,''),'[^0-9]','','g')) not between 7 and 20 then raise exception using errcode='22023',message='Cédula inválida'; end if;
  select * into s from public.academic_students where active and regexp_replace(national_id,'[^0-9]','','g')=regexp_replace(p_national_id,'[^0-9]','','g') limit 1;
  if not found then return jsonb_build_object('found',false); end if;
  select r.request_number into outstanding_request_number from public.student_loan_requests r
  where r.student_id=s.id and r.status='delivered' and exists(select 1 from public.loan_request_unit_assignments a join public.student_loan_request_items i on i.id=a.request_item_id where i.request_id=r.id and a.returned_at is null)
  order by r.delivered_at nulls last,r.id limit 1;
  select a.* into auth_record from public.equipment_authorizations a where a.active and a.scope='individual' and a.student_id=s.id order by a.authorized_at desc limit 1;
  if not found then select a.* into auth_record from public.equipment_authorizations a join public.course_enrollments e on e.student_id=s.id and e.cycle_id=a.cycle_id and e.nrc=a.nrc where a.active and a.scope='course' order by a.authorized_at desc limit 1; end if;
  result:=jsonb_build_object(
    'found',true,'student_id',s.id,'full_name',s.full_name,'career',s.career,
    'has_outstanding_loan',outstanding_request_number is not null,
    'blocked_by_outstanding_loan',outstanding_request_number is not null and not s.loan_exception,
    'outstanding_request_number',outstanding_request_number,'loan_exception',s.loan_exception,
    'authorized',auth_record.id is not null,'authorization_id',auth_record.id,
    'authorization_label',case when auth_record.scope='course' then coalesce(auth_record.course_code,'Curso')||' · NRC '||auth_record.nrc else 'Autorización individual' end,
    'equipment',(select coalesce(jsonb_agg(jsonb_build_object('id',c.id,'name',c.name,'available',c.available_quantity) order by c.sort_order,c.name),'[]'::jsonb) from public.equipment_catalog c where c.active and c.available_quantity>0)
  );
  return result;
end $$;
revoke all on function public.student_loan_context(text) from public,authenticated;
grant execute on function public.student_loan_context(text) to anon;

create or replace function public.create_student_loan_request(p_national_id text,p_authorization_id uuid,p_expected_return_at timestamptz,p_items jsonb,p_signature_data text)
returns jsonb language plpgsql security definer set search_path='' as $$
declare s public.academic_students; auth_record public.equipment_authorizations; request_id bigint; request_code text; request_token uuid; item jsonb; catalog public.equipment_catalog;
begin
  if p_expected_return_at<=now() or p_expected_return_at>now()+interval '90 days' then raise exception using errcode='22023',message='Fecha de devolución inválida'; end if;
  if jsonb_typeof(p_items)<>'array' or jsonb_array_length(p_items) not between 1 and 30 then raise exception using errcode='22023',message='Seleccione al menos un equipo'; end if;
  if p_signature_data is null or p_signature_data not like 'data:image/png;base64,%' or char_length(p_signature_data) not between 100 and 300000 then raise exception using errcode='22023',message='La firma del estudiante es obligatoria'; end if;
  select * into s from public.academic_students where active and regexp_replace(national_id,'[^0-9]','','g')=regexp_replace(coalesce(p_national_id,''),'[^0-9]','','g') limit 1 for update;
  if not found then raise exception using errcode='22023',message='Estudiante no encontrado'; end if;
  if public.student_has_outstanding_equipment(s.id) and not s.loan_exception then raise exception using errcode='P0001',message='Tiene un préstamo de equipo pendiente. Por favor, diríjase a la bodega para solventar la situación.'; end if;
  select * into auth_record from public.equipment_authorizations where id=p_authorization_id and active;
  if not found or not ((auth_record.scope='individual' and auth_record.student_id=s.id) or (auth_record.scope='course' and exists(select 1 from public.course_enrollments e where e.student_id=s.id and e.cycle_id=auth_record.cycle_id and e.nrc=auth_record.nrc))) then raise exception using errcode='42501',message='No existe autorización docente vigente'; end if;
  insert into public.student_loan_requests(student_id,authorization_id,expected_return_at,student_signature_data) values(s.id,auth_record.id,p_expected_return_at,p_signature_data) returning id,request_number,receipt_token into request_id,request_code,request_token;
  for item in select * from jsonb_array_elements(p_items) loop
    select * into catalog from public.equipment_catalog where id=(item->>'id')::bigint and active for update;
    if not found or (item->>'quantity')::integer not between 1 and least(20,catalog.available_quantity) then raise exception 'Cantidad no disponible para %',coalesce(catalog.name,'equipo') using errcode='22023'; end if;
    insert into public.student_loan_request_items(request_id,equipment_catalog_id,quantity) values(request_id,catalog.id,(item->>'quantity')::integer);
  end loop;
  return jsonb_build_object('ok',true,'request_number',request_code,'request_id',request_id,'receipt_token',request_token);
end $$;
revoke all on function public.create_student_loan_request(text,uuid,timestamptz,jsonb,text) from public,authenticated;
grant execute on function public.create_student_loan_request(text,uuid,timestamptz,jsonb,text) to anon;

create or replace function public.warehouse_superadmin_status()
returns boolean language plpgsql stable security definer set search_path='' as $$
begin
  if not public.is_warehouse_staff() then raise exception using errcode='42501',message='Acceso exclusivo para personal de bodega'; end if;
  return public.is_superadmin();
end $$;
revoke all on function public.warehouse_superadmin_status() from public,anon;
grant execute on function public.warehouse_superadmin_status() to authenticated;

create or replace function public.warehouse_clients_data()
returns jsonb language plpgsql stable security definer set search_path='' as $$
begin
  if not public.is_warehouse_staff() then raise exception using errcode='42501',message='Acceso exclusivo para personal de bodega'; end if;
  return (select coalesce(jsonb_agg(jsonb_build_object(
    'id',s.id,'national_id',s.national_id,'full_name',s.full_name,'email',s.email,'phone',s.phone,'career',s.career,'active',s.active,
    'active_loans',(select count(*) from public.student_loan_requests r where r.student_id=s.id and r.status='delivered'),
    'has_outstanding_loan',public.student_has_outstanding_equipment(s.id),'loan_exception',s.loan_exception,'loan_exception_reason',s.loan_exception_reason
  ) order by s.full_name),'[]'::jsonb) from public.academic_students s);
end $$;

create or replace function public.warehouse_set_loan_exception(p_student_id bigint,p_allow boolean,p_reason text)
returns boolean language plpgsql security definer set search_path='' as $$
begin
  if not public.is_superadmin() then raise exception using errcode='42501',message='Solo el superadministrador puede modificar esta excepción'; end if;
  if p_allow and char_length(trim(coalesce(p_reason,'')))<5 then raise exception using errcode='22023',message='Indique el motivo de la excepción'; end if;
  update public.academic_students set loan_exception=coalesce(p_allow,false),loan_exception_reason=case when p_allow then trim(p_reason) else null end,loan_exception_by=case when p_allow then (select auth.uid()) else null end,loan_exception_at=case when p_allow then now() else null end where id=p_student_id;
  if not found then raise exception using errcode='22023',message='Estudiante no encontrado'; end if;
  return true;
end $$;
revoke all on function public.warehouse_set_loan_exception(bigint,boolean,text) from public,anon;
grant execute on function public.warehouse_set_loan_exception(bigint,boolean,text) to authenticated;

create or replace function public.warehouse_active_loan_edit_data(p_request_id bigint)
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare req public.student_loan_requests;
begin
  if not public.is_superadmin() then raise exception using errcode='42501',message='Solo el superadministrador puede editar préstamos activos'; end if;
  select * into req from public.student_loan_requests where id=p_request_id and status='delivered';
  if not found then raise exception using errcode='22023',message='Préstamo activo no encontrado'; end if;
  return jsonb_build_object('request_id',req.id,'request_number',req.request_number,'delivered_at',req.delivered_at,'expected_return_at',req.expected_return_at);
end $$;
revoke all on function public.warehouse_active_loan_edit_data(bigint) from public,anon;
grant execute on function public.warehouse_active_loan_edit_data(bigint) to authenticated;

create or replace function public.warehouse_edit_active_loan(p_request_id bigint,p_delivered_at timestamptz,p_expected_return_at timestamptz,p_replacements jsonb,p_add_unit_ids jsonb)
returns jsonb language plpgsql security definer set search_path='' as $$
declare req public.student_loan_requests; replacement jsonb; assignment_record record; new_unit public.equipment_units; add_unit public.equipment_units; request_item_id bigint; previous_dates jsonb; added_ids jsonb:='[]'::jsonb; replaced_items jsonb:='[]'::jsonb;
begin
  if not public.is_superadmin() then raise exception using errcode='42501',message='Solo el superadministrador puede editar préstamos activos'; end if;
  if jsonb_typeof(coalesce(p_replacements,'[]'::jsonb))<>'array' or jsonb_typeof(coalesce(p_add_unit_ids,'[]'::jsonb))<>'array' then raise exception using errcode='22023',message='Datos de edición inválidos'; end if;
  select * into req from public.student_loan_requests where id=p_request_id and status='delivered' for update;
  if not found then raise exception using errcode='22023',message='Préstamo activo no encontrado'; end if;
  if p_delivered_at is null or p_delivered_at<req.created_at or p_delivered_at>now()+interval '5 minutes' then raise exception using errcode='22023',message='Fecha de entrega inválida'; end if;
  if p_expected_return_at is null or p_expected_return_at<p_delivered_at or p_expected_return_at>p_delivered_at+interval '365 days' then raise exception using errcode='22023',message='Fecha prevista de devolución inválida'; end if;
  previous_dates:=jsonb_build_object('delivered_at',req.delivered_at,'expected_return_at',req.expected_return_at);
  for replacement in select * from jsonb_array_elements(coalesce(p_replacements,'[]'::jsonb)) loop
    select a.id,a.equipment_unit_id,i.equipment_catalog_id into assignment_record from public.loan_request_unit_assignments a join public.student_loan_request_items i on i.id=a.request_item_id where a.id=(replacement->>'assignment_id')::bigint and i.request_id=p_request_id and a.returned_at is null for update;
    if not found then raise exception using errcode='22023',message='Asignación no válida'; end if;
    if assignment_record.equipment_unit_id=(replacement->>'new_unit_id')::bigint then continue; end if;
    select * into new_unit from public.equipment_units where id=(replacement->>'new_unit_id')::bigint and active and status='available' and catalog_id=assignment_record.equipment_catalog_id for update;
    if not found then raise exception using errcode='22023',message='El equipo sustituto no está disponible o no corresponde al mismo tipo'; end if;
    update public.equipment_units set status='available' where id=assignment_record.equipment_unit_id;
    update public.equipment_units set status='loaned' where id=new_unit.id;
    update public.loan_request_unit_assignments set equipment_unit_id=new_unit.id where id=assignment_record.id;
    replaced_items:=replaced_items||jsonb_build_array(jsonb_build_object('assignment_id',assignment_record.id,'old_unit_id',assignment_record.equipment_unit_id,'new_unit_id',new_unit.id));
  end loop;
  for add_unit in select u.* from jsonb_array_elements_text(coalesce(p_add_unit_ids,'[]'::jsonb)) x join public.equipment_units u on u.id=x::bigint loop
    perform 1 from public.equipment_units where id=add_unit.id and active and status='available' for update;
    if not found then raise exception using errcode='22023',message='Uno de los equipos adicionales ya no está disponible'; end if;
    select id into request_item_id from public.student_loan_request_items where request_id=p_request_id and equipment_catalog_id=add_unit.catalog_id for update;
    if found then update public.student_loan_request_items set quantity=quantity+1 where id=request_item_id;
    else insert into public.student_loan_request_items(request_id,equipment_catalog_id,quantity) values(p_request_id,add_unit.catalog_id,1) returning id into request_item_id; end if;
    insert into public.loan_request_unit_assignments(request_item_id,equipment_unit_id,delivered_at) values(request_item_id,add_unit.id,now());
    update public.equipment_units set status='loaned' where id=add_unit.id;
    added_ids:=added_ids||jsonb_build_array(add_unit.id);
  end loop;
  update public.student_loan_requests set delivered_at=p_delivered_at,expected_return_at=p_expected_return_at where id=p_request_id;
  insert into public.loan_request_edit_log(request_id,changed_by,changes) values(p_request_id,(select auth.uid()),jsonb_build_object('previous',previous_dates,'new',jsonb_build_object('delivered_at',p_delivered_at,'expected_return_at',p_expected_return_at),'replacements',replaced_items,'added_unit_ids',added_ids));
  return jsonb_build_object('ok',true,'replacements',jsonb_array_length(replaced_items),'added',jsonb_array_length(added_ids));
end $$;
revoke all on function public.warehouse_edit_active_loan(bigint,timestamptz,timestamptz,jsonb,jsonb) from public,anon;
grant execute on function public.warehouse_edit_active_loan(bigint,timestamptz,timestamptz,jsonb,jsonb) to authenticated;
