create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  requested_unit text;
begin
  requested_unit := nullif(trim(new.raw_user_meta_data ->> 'unit'), '');
  if requested_unit is not null
     and requested_unit not in ('Docencia', 'Administrativo', 'LAA', 'PROCAME') then
    requested_unit := null;
  end if;

  insert into public.profiles (id, email, full_name, role, admin_scope, unit)
  values (
    new.id,
    coalesce(new.email, ''),
    coalesce(
      nullif(trim(new.raw_user_meta_data ->> 'full_name'), ''),
      split_part(coalesce(new.email, 'Docente'), '@', 1)
    ),
    'teacher'::public.user_role,
    null,
    requested_unit
  )
  on conflict (id) do update set
    email = excluded.email,
    full_name = excluded.full_name,
    unit = coalesce(excluded.unit, public.profiles.unit),
    active = true,
    updated_at = now();
  return new;
end;
$$;

revoke all on function public.handle_new_user() from public, anon, authenticated;
