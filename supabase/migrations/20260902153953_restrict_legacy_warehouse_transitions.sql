create or replace function public.warehouse_update_request(p_request_id bigint,p_status text)
returns jsonb language plpgsql security definer set search_path='' as $$
declare current_status text;
begin
 if not public.is_warehouse_staff() then raise exception using errcode='42501',message='Acceso exclusivo para personal de bodega'; end if;
 if p_status not in ('approved','rejected') then raise exception using errcode='22023',message='Use los módulos de entrega o devolución para este movimiento'; end if;
 select status into current_status from public.student_loan_requests where id=p_request_id for update;
 if not found then raise exception using errcode='P0002',message='Solicitud no encontrada'; end if;
 if current_status<>'pending' then raise exception using errcode='22023',message='La solicitud ya fue procesada'; end if;
 update public.student_loan_requests set status=p_status,processed_by=(select auth.uid()) where id=p_request_id;
 return jsonb_build_object('ok',true,'status',p_status);
end $$;
