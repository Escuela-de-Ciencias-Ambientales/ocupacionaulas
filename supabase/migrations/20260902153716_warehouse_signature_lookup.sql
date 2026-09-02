create or replace function public.warehouse_request_signatures(p_request_id bigint)
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare result jsonb;
begin
 if not public.is_warehouse_staff() then raise exception using errcode='42501',message='Acceso exclusivo para personal de bodega'; end if;
 select jsonb_build_object('request_number',r.request_number,'student_signature',r.student_signature_data,'teacher_signature',a.signature_data)
 into result from public.student_loan_requests r join public.equipment_authorizations a on a.id=r.authorization_id where r.id=p_request_id;
 if result is null then raise exception using errcode='P0002',message='Solicitud no encontrada'; end if;
 return result;
end $$;
revoke all on function public.warehouse_request_signatures(bigint) from public,anon;
grant execute on function public.warehouse_request_signatures(bigint) to authenticated;
