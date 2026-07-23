update public.classrooms
set name = case code
  when 'L601' then 'Laboratorio L601'
  when 'L602' then 'Laboratorio L602'
  when 'L603' then 'Laboratorio L603'
  else name
end
where code in ('L601', 'L602', 'L603');
