create table if not exists public.page_visit_totals (
  page_key text not null,
  visit_date date not null,
  visit_count bigint not null default 0 check (visit_count >= 0),
  updated_at timestamptz not null default now(),
  primary key (page_key, visit_date)
);

alter table public.page_visit_totals enable row level security;

revoke all on table public.page_visit_totals from anon, authenticated;

create or replace function public.record_page_visit(p_page_key text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_visit_date date := (now() at time zone 'America/Costa_Rica')::date;
begin
  if p_page_key <> 'ocupacionaulas' then
    raise exception using errcode = '22023', message = 'Página no válida';
  end if;

  insert into public.page_visit_totals (page_key, visit_date, visit_count)
  values (p_page_key, v_visit_date, 1)
  on conflict (page_key, visit_date) do update
  set visit_count = public.page_visit_totals.visit_count + 1,
      updated_at = now();
end;
$$;

create or replace function public.get_page_visit_stats(p_page_key text)
returns table (today_count bigint, total_count bigint)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_visit_date date := (now() at time zone 'America/Costa_Rica')::date;
begin
  if not public.is_superadmin() then
    raise exception using errcode = '42501', message = 'Se requiere acceso de superadministrador';
  end if;

  return query
  select
    coalesce(sum(visit_count) filter (where visit_date = v_visit_date), 0)::bigint,
    coalesce(sum(visit_count), 0)::bigint
  from public.page_visit_totals
  where page_key = p_page_key;
end;
$$;

revoke all on function public.record_page_visit(text) from public;
revoke all on function public.get_page_visit_stats(text) from public;
grant execute on function public.record_page_visit(text) to anon, authenticated;
grant execute on function public.get_page_visit_stats(text) to authenticated;
