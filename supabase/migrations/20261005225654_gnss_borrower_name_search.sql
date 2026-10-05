create function public.public_direction_search_borrowers(p_director_national_id text,p_query text,p_kind text) returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare q text; result jsonb;
begin
 if public.equipment_direction_role(p_director_national_id) is null then raise exception using errcode='42501',message='Solo Dirección o Subdirección puede buscar solicitantes GNSS'; end if;
 if p_kind not in ('student','academic') or p_kind is null then raise exception 'Tipo de persona inválido'; end if;
 q:=translate(lower(trim(coalesce(p_query,''))),'áéíóúüñ','aeiouun');
 if char_length(q)<2 then return '[]'::jsonb; end if;
 if char_length(q)>100 then raise exception 'Búsqueda demasiado larga'; end if;
 select coalesce(jsonb_agg(to_jsonb(r) order by r.full_name,r.id),'[]'::jsonb) into result from (
 select b.id,b.full_name,b.national_id from (
 select id,full_name,national_id from public.academic_students where active and p_kind='student'
 union all select id,full_name,national_id from public.teacher_registry where active and p_kind='academic'
 ) b where not exists (
 select 1 from regexp_split_to_table(q,'\s+') word where strpos(translate(lower(b.full_name),'áéíóúüñ','aeiouun'),word)=0
 ) order by b.full_name,b.id limit 30
 ) r;
 return result;
end $$;
revoke all on function public.public_direction_search_borrowers(text,text,text) from public,anon,authenticated;
grant execute on function public.public_direction_search_borrowers(text,text,text) to anon,authenticated;
