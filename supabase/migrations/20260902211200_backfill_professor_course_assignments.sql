-- Conserva las asociaciones que antes se inferían por el nombre del horario.
insert into public.equipment_teacher_courses
  (teacher_registry_id,cycle_id,course_code,course_name,nrc,group_code)
select distinct tr.id,f.cycle_id,f.course_code,f.course_name,f.nrc,f.group_code
from public.teacher_registry tr
join public.fixed_occupancies f
  on regexp_replace(upper(coalesce(f.professor_name,'')),'[^A-Z0-9]','','g')
     like '%' || regexp_replace(upper(tr.full_name),'[^A-Z0-9]','','g') || '%'
where tr.active and f.nrc is not null
on conflict (teacher_registry_id,cycle_id,nrc) do nothing;
