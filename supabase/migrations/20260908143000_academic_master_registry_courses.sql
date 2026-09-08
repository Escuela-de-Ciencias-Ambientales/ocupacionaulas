-- Registro maestro de académicos EDECA y máximo de tres cursos por ciclo.

alter table public.teacher_registry
  drop constraint if exists teacher_registry_email_check;

alter table public.teacher_registry
  add constraint teacher_registry_email_check
  check (email is null or lower(trim(email)) ~ '^[^[:space:]@]+@una\.cr$');

create or replace function public.enforce_teacher_course_limit()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if (
    select count(*)
    from public.equipment_teacher_courses c
    where c.teacher_registry_id = new.teacher_registry_id
      and c.cycle_id = new.cycle_id
      and c.id is distinct from new.id
  ) >= 3 then
    raise exception using errcode='23514', message='Cada profesor puede tener como máximo 3 cursos asignados por ciclo';
  end if;
  return new;
end;
$$;

drop trigger if exists equipment_teacher_courses_limit on public.equipment_teacher_courses;
create trigger equipment_teacher_courses_limit
before insert or update of teacher_registry_id, cycle_id
on public.equipment_teacher_courses
for each row execute function public.enforce_teacher_course_limit();

create or replace function public.warehouse_save_professor(p_id bigint,p_full_name text,p_national_id text,p_email text default null,p_active boolean default true)
returns bigint language plpgsql security definer set search_path='' as $$
declare saved_id bigint; clean_id text:=regexp_replace(coalesce(p_national_id,''),'[^0-9]','','g'); clean_email text:=nullif(lower(trim(coalesce(p_email,''))), '');
begin
  if not public.is_warehouse_staff() then raise exception using errcode='42501', message='Acceso exclusivo para personal autorizado'; end if;
  if char_length(trim(coalesce(p_full_name,'')))<3 then raise exception using errcode='22023',message='Ingrese el nombre completo'; end if;
  if char_length(clean_id) not between 7 and 20 then raise exception using errcode='22023',message='Revise la cédula'; end if;
  if clean_email is not null and clean_email !~ '^[^[:space:]@]+@una\.cr$' then
    raise exception using errcode='22023',message='Ingrese un correo institucional @una.cr válido';
  end if;
  if p_id is null then
    insert into public.teacher_registry(full_name,national_id,email,active,unit)
    values(trim(p_full_name),clean_id,clean_email,coalesce(p_active,true),'Docencia') returning id into saved_id;
  else
    update public.teacher_registry set full_name=trim(p_full_name),national_id=clean_id,email=clean_email,active=coalesce(p_active,true),unit=coalesce(unit,'Docencia')
    where id=p_id returning id into saved_id;
    if saved_id is null then raise exception using errcode='P0002',message='Profesor no encontrado'; end if;
  end if;
  update public.profiles p set full_name=trim(p_full_name),national_id=clean_id,email=coalesce(clean_email,p.email),active=coalesce(p_active,true),unit=coalesce(p.unit,'Docencia')
  where clean_email is not null and lower(p.email)=clean_email and p.role='teacher';
  return saved_id;
end $$;

revoke all on function public.enforce_teacher_course_limit() from public,anon,authenticated;
revoke all on function public.warehouse_save_professor(bigint,text,text,text,boolean) from public,anon;
grant execute on function public.warehouse_save_professor(bigint,text,text,text,boolean) to authenticated;

comment on table public.teacher_registry is 'Registro maestro institucional de académicos para aulas, vehículos y autorizaciones de equipos';
comment on table public.equipment_teacher_courses is 'Asignaciones editables por ciclo; máximo tres cursos por profesor';
