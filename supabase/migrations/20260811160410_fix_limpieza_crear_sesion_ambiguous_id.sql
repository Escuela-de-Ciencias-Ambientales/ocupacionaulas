-- Evita que la columna de salida `id` de la función compita con los nombres
-- de columna usados al limitar las sesiones activas de cada conserje.

create or replace function public.limpieza_api_crear_sesion(
  p_password text,
  p_token_hash text
)
returns table(id uuid, nombre text)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_conserje_id uuid;
  v_nombre text;
begin
  if p_token_hash !~ '^[0-9a-f]{64}$' then raise exception 'Token invalido'; end if;

  select c.id, c.nombre into v_conserje_id, v_nombre
  from public.limpieza_conserjes c
  where c.activo and c.password_hash = extensions.crypt(p_password, c.password_hash)
  limit 1;
  if v_conserje_id is null then raise exception 'Credenciales invalidas'; end if;

  delete from public.limpieza_sesiones s
  where s.expires_at <= now() or s.revoked_at is not null;

  insert into public.limpieza_sesiones (conserje_id, token_hash)
  values (v_conserje_id, p_token_hash);

  -- Conserva como máximo cinco dispositivos/sesiones activos por conserje.
  delete from public.limpieza_sesiones s
  using (
    select x.session_id
    from (
      select ls.id as session_id,
        row_number() over (order by ls.last_used_at desc) as posicion
      from public.limpieza_sesiones ls
      where ls.conserje_id = v_conserje_id
        and ls.revoked_at is null
        and ls.expires_at > now()
    ) x
    where x.posicion > 5
  ) antiguas
  where s.id = antiguas.session_id;

  return query select v_conserje_id, v_nombre;
end;
$$;

revoke all on function public.limpieza_api_crear_sesion(text, text) from public, anon, authenticated;
grant execute on function public.limpieza_api_crear_sesion(text, text) to service_role;
