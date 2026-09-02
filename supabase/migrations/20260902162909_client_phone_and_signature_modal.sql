alter table public.academic_students add column if not exists phone text;

create or replace function public.warehouse_clients_data()
returns jsonb language plpgsql stable security definer set search_path='' as $$
begin
  if not public.is_warehouse_staff() then raise exception using errcode='42501',message='Acceso exclusivo para personal de bodega'; end if;
  return (select coalesce(jsonb_agg(jsonb_build_object(
    'id',s.id,'national_id',s.national_id,'full_name',s.full_name,'email',s.email,'phone',s.phone,
    'career',s.career,'active',s.active,'active_loans',(select count(*) from public.student_loan_requests r where r.student_id=s.id and r.status='delivered')
  ) order by s.full_name),'[]'::jsonb) from public.academic_students s);
end $$;

create or replace function public.warehouse_save_client(p_id bigint,p_national_id text,p_full_name text,p_email text,p_phone text,p_career text,p_active boolean)
returns bigint language plpgsql security definer set search_path='' as $$
declare saved bigint; clean_phone text;
begin
  if not public.is_warehouse_staff() then raise exception using errcode='42501',message='Acceso exclusivo para personal de bodega'; end if;
  clean_phone:=nullif(regexp_replace(coalesce(p_phone,''),'[^0-9+]','','g'),'');
  if char_length(regexp_replace(coalesce(p_national_id,''),'[^0-9]','','g')) not between 7 and 20 or char_length(trim(coalesce(p_full_name,'')))<3 then raise exception using errcode='22023',message='Datos del estudiante no válidos'; end if;
  if clean_phone is not null and char_length(clean_phone) not between 8 and 16 then raise exception using errcode='22023',message='Número de teléfono no válido'; end if;
  if p_id is null then
    insert into public.academic_students(national_id,full_name,email,phone,career,active) values(regexp_replace(p_national_id,'[^0-9]','','g'),trim(p_full_name),nullif(lower(trim(coalesce(p_email,''))),''),clean_phone,nullif(trim(coalesce(p_career,'')),''),coalesce(p_active,true)) returning id into saved;
  else
    update public.academic_students set national_id=regexp_replace(p_national_id,'[^0-9]','','g'),full_name=trim(p_full_name),email=nullif(lower(trim(coalesce(p_email,''))),''),phone=clean_phone,career=nullif(trim(coalesce(p_career,'')),''),active=coalesce(p_active,true) where id=p_id returning id into saved;
  end if;
  return saved;
end $$;

revoke all on function public.warehouse_clients_data() from public,anon;
revoke all on function public.warehouse_save_client(bigint,text,text,text,text,text,boolean) from public,anon;
revoke all on function public.warehouse_save_client(bigint,text,text,text,text,boolean) from authenticated;
grant execute on function public.warehouse_clients_data() to authenticated;
grant execute on function public.warehouse_save_client(bigint,text,text,text,text,text,boolean) to authenticated;
