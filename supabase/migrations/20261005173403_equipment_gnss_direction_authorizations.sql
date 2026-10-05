-- GNSS: padrón único, autorizaciones individuales y control en servidor.
alter table public.equipment_catalog add column requires_direction_approval boolean not null default false;
alter table public.student_loan_requests add column teacher_registry_id bigint references public.teacher_registry(id) on delete restrict;
alter table public.student_loan_requests alter column student_id drop not null;
alter table public.student_loan_requests alter column authorization_id drop not null;
alter table public.student_loan_requests add constraint equipment_loan_borrower_check check (
  (student_id is not null and teacher_registry_id is null and authorization_id is not null)
  or (student_id is null and teacher_registry_id is not null and authorization_id is null));
create index equipment_loans_teacher_idx on public.student_loan_requests(teacher_registry_id,status);

create table public.equipment_direction_roles (
  role text primary key check(role in ('director','deputy')),
  teacher_registry_id bigint unique references public.teacher_registry(id) on delete restrict,
  updated_by uuid references public.profiles(id), updated_at timestamptz not null default now()
);
insert into public.equipment_direction_roles(role) values ('director'),('deputy');
create table public.equipment_direction_role_history (
  id bigint generated always as identity primary key,
  role text not null, previous_teacher_id bigint references public.teacher_registry(id),
  teacher_registry_id bigint references public.teacher_registry(id),
  changed_by uuid references public.profiles(id), changed_at timestamptz not null default now()
);
create table public.equipment_direction_authorizations (
  id uuid primary key default gen_random_uuid(),
  student_id bigint references public.academic_students(id) on delete restrict,
  borrower_teacher_id bigint references public.teacher_registry(id) on delete restrict,
  catalog_id bigint not null references public.equipment_catalog(id) on delete restrict,
  quantity integer not null check(quantity between 1 and 20),
  authorized_by bigint not null references public.teacher_registry(id) on delete restrict,
  approver_name text not null, approver_role text not null check(approver_role in ('director','deputy')),
  reason text not null check(char_length(trim(reason)) between 3 and 500),
  signature_data text not null check(signature_data like 'data:image/png;base64,%' and char_length(signature_data) between 100 and 300000),
  authorized_at timestamptz not null default now(), valid_until timestamptz not null,
  active boolean not null default true, revoked_at timestamptz, revoked_by uuid references public.profiles(id),
  used_request_id bigint references public.student_loan_requests(id) on delete restrict,
  check((student_id is not null)::integer+(borrower_teacher_id is not null)::integer=1),
  check(valid_until>authorized_at)
);
create index direction_auth_student_idx on public.equipment_direction_authorizations(student_id,catalog_id,valid_until) where active and used_request_id is null;
create index direction_auth_teacher_idx on public.equipment_direction_authorizations(borrower_teacher_id,catalog_id,valid_until) where active and used_request_id is null;
create index direction_auth_approver_idx on public.equipment_direction_authorizations(authorized_by);
create index direction_auth_catalog_idx on public.equipment_direction_authorizations(catalog_id);
create index direction_auth_request_idx on public.equipment_direction_authorizations(used_request_id);
alter table public.student_loan_request_items add column direction_authorization_id uuid references public.equipment_direction_authorizations(id) on delete restrict;
create unique index loan_item_direction_auth_idx on public.student_loan_request_items(direction_authorization_id);
alter table public.equipment_direction_roles enable row level security;
alter table public.equipment_direction_role_history enable row level security;
alter table public.equipment_direction_authorizations enable row level security;
revoke all on public.equipment_direction_roles,public.equipment_direction_role_history,public.equipment_direction_authorizations from public,anon,authenticated;

create function public.equipment_requires_direction(p_catalog_id bigint) returns boolean
language sql stable security definer set search_path='' as $$
 select coalesce((select c.requires_direction_approval from public.equipment_catalog c where c.id=p_catalog_id),false)
 or exists(select 1 from public.equipment_units u where u.catalog_id=p_catalog_id and u.active
 and lower(coalesce(u.brand,'')||' '||coalesce(u.model,'')) like '%trimble%'
 and (lower(coalesce(u.model,'')) like '%tdc6%' or exists(select 1 from public.equipment_catalog c where c.id=u.catalog_id and lower(c.name) ~ '(gnss|gps)')));
$$;

create function public.equipment_direction_role(p_national_id text) returns text
language sql stable security definer set search_path='' as $$
 select d.role from public.equipment_direction_roles d join public.teacher_registry t on t.id=d.teacher_registry_id
 where t.active and regexp_replace(t.national_id,'[^0-9]','','g')=regexp_replace(p_national_id,'[^0-9]','','g');
$$;

create function public.public_equipment_direction_context(p_national_id text) returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare role_name text;
begin
 role_name:=public.equipment_direction_role(p_national_id);
 return jsonb_build_object('can_authorize',role_name is not null,'role',role_name,
 'equipment',case when role_name is not null then (select coalesce(jsonb_agg(jsonb_build_object('id',id,'name',name) order by name),'[]') from public.equipment_catalog where active and public.equipment_requires_direction(id)) else '[]'::jsonb end);
end $$;

create function public.public_direction_find_borrower(p_director_national_id text,p_national_id text,p_kind text) returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare result jsonb;
begin
 if public.equipment_direction_role(p_director_national_id) is null then raise exception using errcode='42501',message='Solo Dirección o Subdirección puede autorizar GNSS Trimble'; end if;
 if p_kind='student' then select jsonb_build_object('found',true,'id',id,'full_name',full_name) into result from public.academic_students where active and regexp_replace(national_id,'[^0-9]','','g')=regexp_replace(p_national_id,'[^0-9]','','g');
 elsif p_kind='academic' then select jsonb_build_object('found',true,'id',id,'full_name',full_name) into result from public.teacher_registry where active and regexp_replace(national_id,'[^0-9]','','g')=regexp_replace(p_national_id,'[^0-9]','','g');
 else raise exception 'Tipo de persona inválido'; end if;
 return coalesce(result,jsonb_build_object('found',false));
end $$;

create function public.public_authorize_direction_equipment(p_director_national_id text,p_borrower_id bigint,p_kind text,p_catalog_id bigint,p_quantity integer,p_valid_until timestamptz,p_reason text,p_signature_data text) returns uuid
language plpgsql security definer set search_path='' as $$
declare authority record; saved uuid;
begin
 select d.role,t.id,t.full_name into authority from public.equipment_direction_roles d join public.teacher_registry t on t.id=d.teacher_registry_id
 where t.active and regexp_replace(t.national_id,'[^0-9]','','g')=regexp_replace(p_director_national_id,'[^0-9]','','g') for update of d;
 if not found then raise exception using errcode='42501',message='Solo Dirección o Subdirección puede autorizar GNSS Trimble'; end if;
 if p_quantity is null or p_quantity not between 1 and 20 or p_valid_until is null or p_valid_until<=now() or p_valid_until>now()+interval '90 days' then raise exception 'Revise cantidad y fecha límite (máximo 90 días)'; end if;
 if p_reason is null or char_length(trim(p_reason)) not between 3 and 500 or p_signature_data is null or p_signature_data not like 'data:image/png;base64,%' or char_length(p_signature_data) not between 100 and 300000 then raise exception 'Indique el motivo y registre su firma'; end if;
 if not exists(select 1 from public.equipment_catalog where id=p_catalog_id and active and public.equipment_requires_direction(id)) then raise exception 'Seleccione un equipo GNSS Trimble'; end if;
 if p_kind='student' then
   if not exists(select 1 from public.academic_students where id=p_borrower_id and active) then raise exception 'Estudiante no encontrado'; end if;
 elsif p_kind='academic' then
   if not exists(select 1 from public.teacher_registry where id=p_borrower_id and active) then raise exception 'Académico no encontrado'; end if;
 else raise exception 'Tipo de persona inválido'; end if;
 insert into public.equipment_direction_authorizations(student_id,borrower_teacher_id,catalog_id,quantity,authorized_by,approver_name,approver_role,valid_until,reason,signature_data)
 values(case when p_kind='student' then p_borrower_id end,case when p_kind='academic' then p_borrower_id end,p_catalog_id,p_quantity,authority.id,authority.full_name,authority.role,p_valid_until,trim(p_reason),p_signature_data) returning id into saved;
 return saved;
end $$;

create function public.warehouse_direction_data() returns jsonb
language plpgsql stable security definer set search_path='' as $$
begin
 if not public.is_warehouse_staff() then raise exception using errcode='42501',message='Acceso exclusivo de bodega'; end if;
 return jsonb_build_object(
 'roles',(select jsonb_agg(jsonb_build_object('role',d.role,'teacher_id',t.id,'name',t.full_name,'active',t.active) order by d.role) from public.equipment_direction_roles d left join public.teacher_registry t on t.id=d.teacher_registry_id),
 'academics',(select coalesce(jsonb_agg(jsonb_build_object('id',id,'name',full_name) order by full_name),'[]') from public.teacher_registry where active),
 'authorizations',(select coalesce(jsonb_agg(jsonb_build_object('id',a.id,'borrower_name',coalesce(s.full_name,t.full_name),'kind',case when a.student_id is null then 'academic' else 'student' end,'equipment',c.name,'quantity',a.quantity,'approver',a.approver_name,'role',a.approver_role,'authorized_at',a.authorized_at,'valid_until',a.valid_until,'reason',a.reason,'active',a.active,'used_request',r.request_number,'status',case when not a.active then 'revoked' when a.used_request_id is not null then 'used' when a.valid_until<now() then 'expired' else 'available' end) order by a.authorized_at desc),'[]') from public.equipment_direction_authorizations a left join public.academic_students s on s.id=a.student_id left join public.teacher_registry t on t.id=a.borrower_teacher_id join public.equipment_catalog c on c.id=a.catalog_id left join public.student_loan_requests r on r.id=a.used_request_id),
 'history',(select coalesce(jsonb_agg(jsonb_build_object('role',h.role,'previous_name',old.full_name,'name',t.full_name,'changed_at',h.changed_at) order by h.changed_at desc),'[]') from public.equipment_direction_role_history h left join public.teacher_registry old on old.id=h.previous_teacher_id left join public.teacher_registry t on t.id=h.teacher_registry_id));
end $$;

create function public.warehouse_set_direction_role(p_role text,p_teacher_id bigint) returns void
language plpgsql security definer set search_path='' as $$
declare previous bigint;
begin
 if not public.is_superadmin() then raise exception using errcode='42501',message='Solo el superadministrador puede cambiar cargos'; end if;
 if p_role not in ('director','deputy') or p_role is null then raise exception 'Cargo inválido'; end if;
 if p_teacher_id is not null and not exists(select 1 from public.teacher_registry where id=p_teacher_id and active) then raise exception 'Elija un académico activo'; end if;
 select teacher_registry_id into previous from public.equipment_direction_roles where role=p_role for update;
 if exists(select 1 from public.equipment_direction_roles where role<>p_role and teacher_registry_id=p_teacher_id) then raise exception 'Esta persona ya ocupa el otro cargo'; end if;
 update public.equipment_direction_roles set teacher_registry_id=p_teacher_id,updated_by=auth.uid(),updated_at=now() where role=p_role;
 insert into public.equipment_direction_role_history(role,previous_teacher_id,teacher_registry_id,changed_by) values(p_role,previous,p_teacher_id,auth.uid());
end $$;

create function public.warehouse_revoke_direction_authorization(p_id uuid) returns void
language plpgsql security definer set search_path='' as $$
begin
 if not public.is_warehouse_staff() then raise exception using errcode='42501',message='Acceso exclusivo de bodega'; end if;
 update public.equipment_direction_authorizations set active=false,revoked_at=now(),revoked_by=auth.uid() where id=p_id and active;
end $$;

create function public.equipment_direction_valid_for_item(p_item_id bigint) returns boolean
language sql stable security definer set search_path='' as $$
 select not public.equipment_requires_direction(i.equipment_catalog_id) or exists(
 select 1 from public.equipment_direction_authorizations a where a.id=i.direction_authorization_id and a.active and a.used_request_id=i.request_id
 and a.catalog_id=i.equipment_catalog_id and a.quantity>=i.quantity and a.valid_until>=greatest(now(),r.expected_return_at)
 and a.student_id is not distinct from r.student_id and a.borrower_teacher_id is not distinct from r.teacher_registry_id)
 from public.student_loan_request_items i join public.student_loan_requests r on r.id=i.request_id where i.id=p_item_id;
$$;

create function public.guard_equipment_direction_item() returns trigger
language plpgsql security definer set search_path='' as $$
declare req public.student_loan_requests; approval public.equipment_direction_authorizations;
begin
 if not public.equipment_requires_direction(new.equipment_catalog_id) then new.direction_authorization_id:=null; return new; end if;
 select * into req from public.student_loan_requests where id=new.request_id for update;
 if new.direction_authorization_id is null then
  select * into approval from public.equipment_direction_authorizations a where a.active and a.used_request_id is null and a.catalog_id=new.equipment_catalog_id and a.quantity>=new.quantity
  and a.student_id is not distinct from req.student_id and a.borrower_teacher_id is not distinct from req.teacher_registry_id
  and a.valid_until>=greatest(now(),req.expected_return_at) order by a.authorized_at desc limit 1 for update;
 else select * into approval from public.equipment_direction_authorizations where id=new.direction_authorization_id for update;
 end if;
 if approval.id is null or not approval.active or approval.catalog_id<>new.equipment_catalog_id or approval.quantity<new.quantity
 or approval.student_id is distinct from req.student_id or approval.borrower_teacher_id is distinct from req.teacher_registry_id
 or approval.valid_until<greatest(now(),req.expected_return_at) or (approval.used_request_id is not null and approval.used_request_id<>req.id) then
 raise exception using errcode='42501',message='GNSS Trimble: falta autorización vigente de Dirección o Subdirección para la cantidad y fecha solicitadas. No se permite el préstamo'; end if;
 update public.equipment_direction_authorizations set used_request_id=req.id where id=approval.id;
 new.direction_authorization_id:=approval.id;
 return new;
end $$;
create trigger require_direction_for_loan_item before insert or update of quantity,equipment_catalog_id,request_id,direction_authorization_id on public.student_loan_request_items for each row execute function public.guard_equipment_direction_item();

create function public.guard_equipment_direction_assignment() returns trigger
language plpgsql security definer set search_path='' as $$
declare cat bigint;
begin
 select catalog_id into cat from public.equipment_units where id=new.equipment_unit_id;
 if not exists(select 1 from public.student_loan_request_items where id=new.request_item_id and equipment_catalog_id=cat) then raise exception 'El equipo no corresponde al tipo solicitado'; end if;
 if not coalesce(public.equipment_direction_valid_for_item(new.request_item_id),false) then raise exception using errcode='42501',message='GNSS Trimble: falta autorización vigente de Dirección o Subdirección. No se permite entregar'; end if;
 return new;
end $$;
create trigger require_direction_for_assignment before insert or update of equipment_unit_id,request_item_id on public.loan_request_unit_assignments for each row execute function public.guard_equipment_direction_assignment();

create function public.guard_equipment_direction_delivery() returns trigger
language plpgsql security definer set search_path='' as $$
begin
 if new.status='delivered' and (old.status<>'delivered' or new.expected_return_at is distinct from old.expected_return_at) then
  if exists(select 1 from public.student_loan_request_items i left join public.equipment_direction_authorizations a on a.id=i.direction_authorization_id where i.request_id=new.id and public.equipment_requires_direction(i.equipment_catalog_id) and (not coalesce(public.equipment_direction_valid_for_item(i.id),false) or a.valid_until<greatest(now(),new.expected_return_at))) then raise exception using errcode='42501',message='GNSS Trimble: falta autorización para entregar o ampliar este préstamo'; end if;
 end if;
 return new;
end $$;
create trigger require_direction_for_delivery before update of status,expected_return_at on public.student_loan_requests for each row execute function public.guard_equipment_direction_delivery();

create function public.public_equipment_loan_context(p_national_id text) returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare result jsonb; teacher public.teacher_registry; target_id bigint; target_kind text; blocked text;
begin
 result:=public.student_loan_context(p_national_id);
 if (result->>'found')::boolean then target_id:=(result->>'student_id')::bigint; target_kind:='student';
 else
  select * into teacher from public.teacher_registry where active and regexp_replace(national_id,'[^0-9]','','g')=regexp_replace(p_national_id,'[^0-9]','','g');
  if not found then return jsonb_build_object('found',false); end if;
  target_id:=teacher.id; target_kind:='academic';
  select request_number into blocked from public.student_loan_requests r where r.teacher_registry_id=teacher.id and r.status='delivered'
  and exists(select 1 from public.student_loan_request_items i join public.loan_request_unit_assignments a on a.request_item_id=i.id where i.request_id=r.id and a.returned_at is null) limit 1;
  result:=jsonb_build_object('found',true,'full_name',teacher.full_name,'authorized',true,'authorization_id',null,'authorization_label','Solicitud de académico','blocked_by_outstanding_loan',blocked is not null,'outstanding_request_number',blocked);
 end if;
 return result||jsonb_build_object('kind',target_kind,'equipment',(
 select coalesce(jsonb_agg(jsonb_build_object('id',c.id,'name',c.name,'available',c.available_quantity,'requires_direction',public.equipment_requires_direction(c.id),
 'direction_quantity',coalesce((select max(a.quantity) from public.equipment_direction_authorizations a where a.catalog_id=c.id and a.active and a.used_request_id is null and a.valid_until>now()
 and ((target_kind='student' and a.student_id=target_id) or (target_kind='academic' and a.borrower_teacher_id=target_id))),0),
 'direction_valid_until',(select max(a.valid_until) from public.equipment_direction_authorizations a where a.catalog_id=c.id and a.active and a.used_request_id is null and a.valid_until>now()
 and ((target_kind='student' and a.student_id=target_id) or (target_kind='academic' and a.borrower_teacher_id=target_id)))) order by c.sort_order,c.name),'[]') from public.equipment_catalog c where c.active and c.available_quantity>0));
end $$;

create function public.create_equipment_loan_request(p_national_id text,p_kind text,p_authorization_id uuid,p_expected_return_at timestamptz,p_items jsonb,p_signature_data text) returns jsonb
language plpgsql security definer set search_path='' as $$
declare teacher public.teacher_registry; request_id bigint; request_code text; token uuid; item jsonb; catalog public.equipment_catalog;
begin
 if p_kind='student' then return public.create_student_loan_request(p_national_id,p_authorization_id,p_expected_return_at,p_items,p_signature_data); end if;
 if p_kind is distinct from 'academic' then raise exception 'Tipo de persona inválido'; end if;
 if p_expected_return_at is null or p_expected_return_at<=now() or p_expected_return_at>now()+interval '90 days' then raise exception 'Fecha de devolución inválida'; end if;
 if p_items is null or jsonb_typeof(p_items)<>'array' or jsonb_array_length(p_items) not between 1 and 30 then raise exception 'Seleccione al menos un equipo'; end if;
 if p_signature_data is null or p_signature_data not like 'data:image/png;base64,%' or char_length(p_signature_data) not between 100 and 300000 then raise exception 'Registre su firma'; end if;
 select * into teacher from public.teacher_registry where active and regexp_replace(national_id,'[^0-9]','','g')=regexp_replace(p_national_id,'[^0-9]','','g') for update;
 if not found then raise exception 'Académico no registrado'; end if;
 if exists(select 1 from public.student_loan_requests r where r.teacher_registry_id=teacher.id and r.status='delivered' and exists(select 1 from public.student_loan_request_items i join public.loan_request_unit_assignments a on a.request_item_id=i.id where i.request_id=r.id and a.returned_at is null)) then raise exception 'Tiene equipos pendientes de devolución. Diríjase a bodega'; end if;
 insert into public.student_loan_requests(teacher_registry_id,expected_return_at,student_signature_data) values(teacher.id,p_expected_return_at,p_signature_data) returning id,request_number,receipt_token into request_id,request_code,token;
 for item in select * from jsonb_array_elements(p_items) loop
  select * into catalog from public.equipment_catalog where id=(item->>'id')::bigint and active for update;
  if not found or (item->>'quantity') is null or (item->>'quantity')::integer not between 1 and least(20,catalog.available_quantity) then raise exception 'Cantidad no disponible'; end if;
  insert into public.student_loan_request_items(request_id,equipment_catalog_id,quantity) values(request_id,catalog.id,(item->>'quantity')::integer);
 end loop;
 return jsonb_build_object('ok',true,'request_id',request_id,'request_number',request_code,'receipt_token',token);
end $$;

-- Helpers y triggers no son endpoints públicos. Solo se exponen RPC explícitos.
do $$ declare f record; begin
 for f in select p.oid::regprocedure as signature from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname in (
 'equipment_requires_direction','equipment_direction_role','equipment_direction_valid_for_item','guard_equipment_direction_item','guard_equipment_direction_assignment','guard_equipment_direction_delivery',
 'public_equipment_direction_context','public_direction_find_borrower','public_authorize_direction_equipment','warehouse_direction_data','warehouse_set_direction_role','warehouse_revoke_direction_authorization','public_equipment_loan_context','create_equipment_loan_request') loop
 execute format('revoke all on function %s from public, anon, authenticated',f.signature);
 end loop;
end $$;
grant execute on function public.public_equipment_direction_context(text),public.public_direction_find_borrower(text,text,text),public.public_authorize_direction_equipment(text,bigint,text,bigint,integer,timestamptz,text,text),public.public_equipment_loan_context(text),public.create_equipment_loan_request(text,text,uuid,timestamptz,jsonb,text) to anon,authenticated;
grant execute on function public.warehouse_direction_data(),public.warehouse_set_direction_role(text,bigint),public.warehouse_revoke_direction_authorization(uuid) to authenticated;

CREATE OR REPLACE FUNCTION public.warehouse_dashboard_data()
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
begin
  if not public.is_warehouse_staff() then raise exception using errcode='42501',message='Acceso exclusivo para personal de bodega'; end if;
  return jsonb_build_object(
    'staff_name',(select full_name from public.warehouse_staff where user_id=(select auth.uid())),
    'metrics',jsonb_build_object('pending',(select count(*) from public.student_loan_requests where status='pending'),'approved',(select count(*) from public.student_loan_requests where status='approved'),'delivered',(select count(*) from public.student_loan_requests where status='delivered'),'overdue',(select count(*) from public.student_loan_requests where status='delivered' and expected_return_at<now())),
    'requests',(select coalesce(jsonb_agg(jsonb_build_object('id',r.id,'request_number',r.request_number,'status',r.status,'created_at',r.created_at,'expected_return_at',r.expected_return_at,'student_name',coalesce(s.full_name,t.full_name),'national_id',coalesce(s.national_id,t.national_id),'email',coalesce(s.email,t.email),'career',coalesce(s.career,'Académico'),'borrower_kind',case when r.student_id is null then 'academic' else 'student' end,'direction_ready',not exists(select 1 from public.student_loan_request_items di where di.request_id=r.id and not public.equipment_direction_valid_for_item(di.id)),'has_signature',r.student_signature_data is not null,'items',(select coalesce(jsonb_agg(jsonb_build_object('id',i.id,'catalog_id',c.id,'name',c.name,'quantity',i.quantity) order by c.name),'[]'::jsonb) from public.student_loan_request_items i join public.equipment_catalog c on c.id=i.equipment_catalog_id where i.request_id=r.id)) order by case r.status when 'pending' then 1 when 'approved' then 2 when 'delivered' then 3 else 4 end,r.created_at desc),'[]'::jsonb) from public.student_loan_requests r left join public.academic_students s on s.id=r.student_id left join public.teacher_registry t on t.id=r.teacher_registry_id),
    'equipment',(select coalesce(jsonb_agg(jsonb_build_object('id',c.id,'name',c.name,'requires_direction',public.equipment_requires_direction(c.id),'available',(select count(*) from public.equipment_units u where u.catalog_id=c.id and u.active and u.status='available'),'total',(select count(*) from public.equipment_units u where u.catalog_id=c.id and u.active),'active',c.active,'units',(select coalesce(jsonb_agg(jsonb_build_object('id',u.id,'code',u.consecutive_code,'asset',u.asset_number,'brand',u.brand,'model',u.model,'serial',u.serial_number,'use',u.equipment_use,'observations',u.observations,'status',u.status,'active',u.active) order by u.consecutive_code),'[]'::jsonb) from public.equipment_units u where u.catalog_id=c.id)) order by c.sort_order,c.name),'[]'::jsonb) from public.equipment_catalog c),
    'clients',(select coalesce(jsonb_agg(jsonb_build_object('id',s.id,'national_id',s.national_id,'full_name',s.full_name,'email',s.email,'career',s.career,'active',s.active,'active_loans',(select count(*) from public.student_loan_requests r where r.student_id=s.id and r.status='delivered')) order by s.full_name),'[]'::jsonb) from public.academic_students s),
    'active_loans',(select coalesce(jsonb_agg(jsonb_build_object('assignment_id',a.id,'request_id',r.id,'request_number',r.request_number,'student_name',coalesce(s.full_name,t.full_name),'national_id',coalesce(s.national_id,t.national_id),'email',coalesce(s.email,t.email),'expected_return_at',r.expected_return_at,'item_name',c.name,'unit_id',u.id,'code',u.consecutive_code,'asset',u.asset_number,'brand',u.brand,'model',u.model,'serial',u.serial_number,'delivered_at',a.delivered_at) order by r.request_number,u.consecutive_code),'[]'::jsonb) from public.loan_request_unit_assignments a join public.student_loan_request_items i on i.id=a.request_item_id join public.student_loan_requests r on r.id=i.request_id left join public.academic_students s on s.id=r.student_id left join public.teacher_registry t on t.id=r.teacher_registry_id join public.equipment_catalog c on c.id=i.equipment_catalog_id join public.equipment_units u on u.id=a.equipment_unit_id where a.returned_at is null)
  );
end $function$
;
CREATE OR REPLACE FUNCTION public.warehouse_request_signatures(p_request_id bigint)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare result jsonb;
begin
 if not public.is_warehouse_staff() then raise exception using errcode='42501',message='Acceso exclusivo para personal de bodega'; end if;
 select jsonb_build_object('request_number',r.request_number,'student_signature',r.student_signature_data,'teacher_signature',a.signature_data,'direction_signatures',(select coalesce(jsonb_agg(jsonb_build_object('name',da.approver_name,'signature',da.signature_data)),'[]'::jsonb) from public.student_loan_request_items i join public.equipment_direction_authorizations da on da.id=i.direction_authorization_id where i.request_id=r.id))
 into result from public.student_loan_requests r left join public.equipment_authorizations a on a.id=r.authorization_id where r.id=p_request_id;
 if result is null then raise exception using errcode='P0002',message='Solicitud no encontrada'; end if;
 return result;
end $function$
;
