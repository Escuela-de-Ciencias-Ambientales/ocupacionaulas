create or replace function public.warehouse_authorization_data()
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare result jsonb;
begin
  if not public.is_warehouse_staff() then raise exception using errcode='42501',message='Acceso exclusivo para personal de bodega'; end if;
  select jsonb_build_object(
    'courses',(select coalesce(jsonb_agg(to_jsonb(q) order by q.course_name,q.nrc),'[]'::jsonb) from (
      select distinct f.cycle_id,f.course_code,f.course_name,f.nrc,f.group_code
      from public.fixed_occupancies f join public.reservation_cycles c on c.id=f.cycle_id and c.is_current where f.nrc is not null) q),
    'authorizations',(select coalesce(jsonb_agg(jsonb_build_object(
      'id',a.id,'scope',a.scope,'course_code',a.course_code,'course_name',a.course_name,'nrc',a.nrc,'group_code',a.group_code,
      'student_name',s.full_name,'student_national_id',s.national_id,'reason',a.reason,'reason_detail',a.reason_detail,
      'authorized_at',a.authorized_at,'authorized_by',coalesce(tr.full_name,p.full_name)
    ) order by a.authorized_at desc),'[]'::jsonb)
    from public.equipment_authorizations a
    left join public.profiles p on p.id=a.teacher_id
    left join public.teacher_registry tr on tr.id=a.teacher_registry_id
    left join public.academic_students s on s.id=a.student_id where a.active)
  ) into result;
  return result;
end $$;
