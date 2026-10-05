CREATE OR REPLACE FUNCTION public.warehouse_deliver_request(p_request_id bigint, p_unit_ids jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare req public.student_loan_requests; item record; unit_id bigint;
begin
 if not public.is_warehouse_staff() then raise exception using errcode='42501',message='Acceso exclusivo para personal de bodega'; end if;
 select * into req from public.student_loan_requests where id=p_request_id for update;
 if not found or req.status<>'approved' then raise exception using errcode='22023',message='La solicitud no está aprobada'; end if;
 if jsonb_typeof(p_unit_ids)<>'array' then raise exception using errcode='22023',message='Seleccione los equipos por entregar'; end if;
 if exists(select 1 from jsonb_array_elements_text(p_unit_ids) x
   where not exists(select 1 from public.equipment_units u join public.student_loan_request_items i on i.equipment_catalog_id=u.catalog_id and i.request_id=p_request_id where u.id=x::bigint)) then
   raise exception using errcode='22023',message='No se permite entregar un equipo fuera de la solicitud autorizada';
 end if;
 if jsonb_array_length(p_unit_ids)<>(select count(distinct x::bigint) from jsonb_array_elements_text(p_unit_ids) x) then
   raise exception using errcode='22023',message='Seleccione cada unidad una sola vez';
 end if;
 for item in select i.id,i.equipment_catalog_id,i.quantity from public.student_loan_request_items i where i.request_id=p_request_id loop
   if (select count(*) from jsonb_array_elements_text(p_unit_ids) x join public.equipment_units u on u.id=x::bigint where u.catalog_id=item.equipment_catalog_id)<>item.quantity then raise exception using errcode='22023',message='Seleccione la cantidad exacta de cada tipo de equipo'; end if;
 end loop;
 for unit_id in select value::bigint from jsonb_array_elements_text(p_unit_ids) loop
   if not exists(select 1 from public.equipment_units where id=unit_id and active and status='available' for update) then raise exception using errcode='22023',message='Uno de los equipos ya no está disponible'; end if;
   insert into public.loan_request_unit_assignments(request_item_id,equipment_unit_id) select i.id,unit_id from public.student_loan_request_items i join public.equipment_units u on u.catalog_id=i.equipment_catalog_id where i.request_id=p_request_id and u.id=unit_id;
   update public.equipment_units set status='loaned' where id=unit_id;
 end loop;
 update public.student_loan_requests set status='delivered',processed_by=(select auth.uid()),delivered_at=now() where id=p_request_id;
 return jsonb_build_object('ok',true,'request_id',p_request_id,'receipt_token',req.receipt_token);
end $function$
;
