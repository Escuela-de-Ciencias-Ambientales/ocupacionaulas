create or replace function public.student_loan_context(p_national_id text)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
  s public.academic_students;
  auth_record public.equipment_authorizations;
  result jsonb;
  outstanding_request_number text;
begin
  if char_length(regexp_replace(coalesce(p_national_id,''),'[^0-9]','','g')) not between 7 and 20 then
    raise exception using errcode='22023', message='Cédula inválida';
  end if;
  select * into s from public.academic_students
  where active and regexp_replace(national_id,'[^0-9]','','g')=regexp_replace(p_national_id,'[^0-9]','','g') limit 1;
  if not found then return jsonb_build_object('found',false); end if;

  select r.request_number into outstanding_request_number
  from public.student_loan_requests r
  where r.student_id=s.id and r.status='delivered'
    and exists (
      select 1 from public.loan_request_unit_assignments a
      join public.student_loan_request_items i on i.id=a.request_item_id
      where i.request_id=r.id and a.returned_at is null
    )
  order by r.delivered_at nulls last, r.id
  limit 1;

  select a.* into auth_record from public.equipment_authorizations a
  where a.active and a.scope='individual' and a.student_id=s.id
  order by a.authorized_at desc limit 1;
  if not found then
    select a.* into auth_record from public.equipment_authorizations a
    join public.course_enrollments e on e.student_id=s.id and e.cycle_id=a.cycle_id and e.nrc=a.nrc
    where a.active and a.scope='course'
    order by a.authorized_at desc limit 1;
  end if;

  result := jsonb_build_object(
    'found',true,'student_id',s.id,'full_name',s.full_name,'career',s.career,
    'has_outstanding_loan',outstanding_request_number is not null,
    'outstanding_request_number',outstanding_request_number,
    'authorized',auth_record.id is not null,
    'authorization_id',auth_record.id,
    'authorization_label',case when auth_record.scope='course' then coalesce(auth_record.course_code,'Curso')||' · NRC '||auth_record.nrc else 'Autorización individual' end,
    'equipment',(select coalesce(jsonb_agg(jsonb_build_object('id',c.id,'name',c.name,'available',c.available_quantity) order by c.sort_order,c.name),'[]'::jsonb) from public.equipment_catalog c where c.active and c.available_quantity>0)
  );
  return result;
end; $$;

revoke all on function public.student_loan_context(text) from public, authenticated;
grant execute on function public.student_loan_context(text) to anon;

create or replace function public.create_student_loan_request(
  p_national_id text, p_authorization_id uuid, p_expected_return_at timestamptz, p_items jsonb, p_signature_data text
) returns jsonb language plpgsql security definer set search_path='' as $$
declare s public.academic_students; auth_record public.equipment_authorizations; request_id bigint; request_code text; request_token uuid; item jsonb; catalog public.equipment_catalog;
begin
  if p_expected_return_at<=now() or p_expected_return_at>now()+interval '90 days' then raise exception using errcode='22023',message='Fecha de devolución inválida'; end if;
  if jsonb_typeof(p_items)<>'array' or jsonb_array_length(p_items) not between 1 and 30 then raise exception using errcode='22023',message='Seleccione al menos un equipo'; end if;
  if p_signature_data is null or p_signature_data not like 'data:image/png;base64,%' or char_length(p_signature_data) not between 100 and 300000 then raise exception using errcode='22023',message='La firma del estudiante es obligatoria'; end if;
  select * into s from public.academic_students where active and regexp_replace(national_id,'[^0-9]','','g')=regexp_replace(coalesce(p_national_id,''),'[^0-9]','','g') limit 1 for update;
  if not found then raise exception using errcode='22023',message='Estudiante no encontrado'; end if;
  if exists (
    select 1 from public.student_loan_requests r
    where r.student_id=s.id and r.status='delivered'
      and exists (
        select 1 from public.loan_request_unit_assignments a
        join public.student_loan_request_items i on i.id=a.request_item_id
        where i.request_id=r.id and a.returned_at is null
      )
  ) then
    raise exception using errcode='P0001', message='Tiene un préstamo de equipo pendiente. Por favor, diríjase a la bodega para solventar la situación.';
  end if;
  select * into auth_record from public.equipment_authorizations where id=p_authorization_id and active;
  if not found or not ((auth_record.scope='individual' and auth_record.student_id=s.id) or (auth_record.scope='course' and exists(select 1 from public.course_enrollments e where e.student_id=s.id and e.cycle_id=auth_record.cycle_id and e.nrc=auth_record.nrc))) then raise exception using errcode='42501',message='No existe autorización docente vigente'; end if;
  insert into public.student_loan_requests(student_id,authorization_id,expected_return_at,student_signature_data)
  values(s.id,auth_record.id,p_expected_return_at,p_signature_data) returning id,request_number,receipt_token into request_id,request_code,request_token;
  for item in select * from jsonb_array_elements(p_items) loop
    select * into catalog from public.equipment_catalog where id=(item->>'id')::bigint and active for update;
    if not found or (item->>'quantity')::integer not between 1 and least(20,catalog.available_quantity) then raise exception 'Cantidad no disponible para %',coalesce(catalog.name,'equipo') using errcode='22023'; end if;
    insert into public.student_loan_request_items(request_id,equipment_catalog_id,quantity) values(request_id,catalog.id,(item->>'quantity')::integer);
  end loop;
  return jsonb_build_object('ok',true,'request_number',request_code,'request_id',request_id,'receipt_token',request_token);
end $$;

revoke all on function public.create_student_loan_request(text,uuid,timestamptz,jsonb,text) from public,authenticated;
grant execute on function public.create_student_loan_request(text,uuid,timestamptz,jsonb,text) to anon;
