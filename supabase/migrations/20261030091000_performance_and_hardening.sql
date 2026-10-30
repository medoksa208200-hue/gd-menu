begin;
-- Covering indexes for foreign keys (joins, ON DELETE checks and per-user filters).
create index if not exists categories_parent on public.categories(parent_id);
create index if not exists chrome_records_created_by on public.chrome_records(created_by);
create index if not exists homepage_section_items_mold on public.homepage_section_items(mold_id);
create index if not exists homepage_sections_category on public.homepage_sections(category_id);
create index if not exists maintenance_records_created_by on public.maintenance_records(created_by);
create index if not exists maintenance_records_technician on public.maintenance_records(technician_id);
create index if not exists mold_machine_compatibility_machine on public.mold_machine_compatibility(machine_id);
create index if not exists molds_created_by on public.molds(created_by);
create index if not exists molds_updated_by on public.molds(updated_by);
create index if not exists production_logs_created_by on public.production_logs(created_by);
create index if not exists production_logs_machine on public.production_logs(machine_id);
create index if not exists production_logs_operator on public.production_logs(operator_id);
create index if not exists role_permissions_permission on public.role_permissions(permission_key);
create index if not exists user_permissions_permission on public.user_permissions(permission_key);
create index if not exists user_roles_role on public.user_roles(role_id);
create index if not exists mold_search_events_date on public.mold_search_events(searched_at);
create index if not exists mold_views_date on public.mold_views(viewed_at);

-- RLS: evaluate auth.uid() and the row-independent permission helpers once per statement (an InitPlan)
-- instead of once per row. Expressions are otherwise unchanged.
do $$
declare p record; q text; c text;
  pattern constant text:='(auth\.uid\(\)|private\.has_permission\(''[a-z_.]+''::text\)|private\.is_staff\(\)|private\.is_super_admin\(\)|private\.is_service\(\))';
begin
  for p in select tablename,policyname,qual,with_check from pg_policies where schemaname='public' loop
    q:=regexp_replace(p.qual,pattern,'(select \1)','g');
    c:=regexp_replace(p.with_check,pattern,'(select \1)','g');
    if p.qual ~* '\(\s*select\s+(auth\.uid|private\.)' then q:=p.qual; end if;
    if p.with_check ~* '\(\s*select\s+(auth\.uid|private\.)' then c:=p.with_check; end if;
    if q is distinct from p.qual then execute format('alter policy %I on public.%I using (%s)',p.policyname,p.tablename,q); end if;
    if c is distinct from p.with_check then execute format('alter policy %I on public.%I with check (%s)',p.policyname,p.tablename,c); end if;
  end loop;
end $$;

-- Catalog search: user text is matched literally. %, _ and \ are escaped so a query cannot act as a
-- LIKE wildcard pattern (e.g. "%%%%" forcing expensive full scans or enumerating every code).
create or replace function public.search_catalog(
  search_text text default null, category_slug text default null, shape_filter text default null,
  color_filter uuid default null,
  diameter_min numeric default null, diameter_max numeric default null,
  length_min numeric default null, length_max numeric default null,
  width_min numeric default null, width_max numeric default null,
  height_min numeric default null, height_max numeric default null,
  sort_by text default 'latest', page_number integer default 1, page_size integer default 24
) returns setof public.catalog_molds
language plpgsql stable security definer set search_path='' as $$
declare needle text:=nullif(btrim(search_text),'');
begin
  if page_number<1 or page_number>10000 or page_size<1 or page_size>100
     or page_number is null or page_size is null then
    raise exception 'Invalid pagination' using errcode='22023';
  end if;
  if coalesce(length(search_text),0)>200 or coalesce(length(shape_filter),0)>100 or coalesce(length(category_slug),0)>120 then
    raise exception 'Search query too long' using errcode='22023';
  end if;
  if sort_by is null or sort_by not in ('latest','name','popular','sales') then raise exception 'Invalid sort' using errcode='22023'; end if;
  if needle is not null then needle:='%'||replace(replace(replace(needle,'\','\\'),'%','\%'),'_','\_')||'%'; end if;
  return query
  select m.id,m.code,m.name_ar,m.name_en,m.description_ar,m.description_en,m.main_category_id,
    m.shape,m.public_availability,m.is_new,m.is_featured,m.published_at,
    m.diameter_mm,m.length_mm,m.width_mm,m.height_mm,m.depth_mm,m.product_weight_g,m.capacity_ml
  from public.catalog_molds m
  where (needle is null or m.code ilike needle or m.name_ar ilike needle or m.name_en ilike needle)
    and (category_slug is null or exists(select 1 from public.catalog_mold_categories mc join public.catalog_categories c on c.id=mc.category_id where mc.mold_id=m.id and c.slug=category_slug))
    and (shape_filter is null or m.shape=shape_filter)
    and (color_filter is null or exists(select 1 from public.catalog_colors c where c.mold_id=m.id and c.id=color_filter))
    and (diameter_min is null or m.diameter_mm>=diameter_min) and (diameter_max is null or m.diameter_mm<=diameter_max)
    and (length_min is null or m.length_mm>=length_min) and (length_max is null or m.length_mm<=length_max)
    and (width_min is null or m.width_mm>=width_min) and (width_max is null or m.width_mm<=width_max)
    and (height_min is null or m.height_mm>=height_min) and (height_max is null or m.height_mm<=height_max)
  order by
    case when sort_by='popular' then (select count(*) from public.mold_views v where v.mold_id=m.id) end desc nulls last,
    case when sort_by='sales' then (select sum(s.units_sold) from public.sales_statistics s where s.mold_id=m.id) end desc nulls last,
    case when sort_by='name' then m.name_en end asc nulls last,
    m.published_at desc,m.id
  limit page_size offset (page_number-1)*page_size;
end $$;
revoke all on function public.search_catalog(text,text,text,uuid,numeric,numeric,numeric,numeric,numeric,numeric,numeric,numeric,text,integer,integer) from public;
grant execute on function public.search_catalog(text,text,text,uuid,numeric,numeric,numeric,numeric,numeric,numeric,numeric,numeric,text,integer,integer) to anon,authenticated;

-- Operational report in one round trip instead of one get_mold_lifecycle call per mold.
create or replace function public.get_lifecycle_report() returns setof private.mold_lifecycle
language plpgsql stable security definer set search_path='' as $$
begin
  if not private.has_permission('reports.view') then raise exception 'reports.view required' using errcode='42501'; end if;
  return query select * from private.mold_lifecycle where deleted_at is null order by code;
end $$;
revoke all on function public.get_lifecycle_report() from public,anon,authenticated;
grant execute on function public.get_lifecycle_report() to authenticated;

-- Analytics ingestion: periodic instead of per-request cleanup, and a retention limit for raw search text.
create or replace function public.ingest_catalog_event(visitor_hash text,event_type text,target_mold uuid default null,query_text text default null) returns boolean language plpgsql security definer set search_path='' as $$
declare used integer; window_key timestamptz:=date_trunc('hour',now());
begin
 if visitor_hash is null or length(visitor_hash)<>64 or event_type is null or event_type not in ('view','search') then return false; end if;
 insert into private.analytics_rate values(visitor_hash,window_key,1)
 on conflict on constraint analytics_rate_pkey do update set requests=private.analytics_rate.requests+1 returning requests into used;
 if used>120 then return false; end if;
 if target_mold is not null and not exists(select 1 from public.catalog_molds where id=target_mold) then return false; end if;
 if event_type='view' and target_mold is not null then
  if not exists(select 1 from public.mold_views where mold_id=target_mold and session_hash=visitor_hash and viewed_at>=current_date) then
   insert into public.mold_views(mold_id,session_hash) values(target_mold,visitor_hash);
  end if;
 elsif event_type='search' and length(btrim(query_text)) between 1 and 200 then
  insert into public.mold_search_events(query,matched_mold_id) values(btrim(query_text),target_mold);
 end if;
 if random()<0.02 then
  delete from private.analytics_rate where window_start<now()-interval '2 days';
  delete from public.mold_search_events where searched_at<now()-interval '180 days';
 end if;
 return true;
end $$;
revoke all on function public.ingest_catalog_event(text,text,uuid,text) from public,anon,authenticated;
grant execute on function public.ingest_catalog_event(text,text,uuid,text) to service_role;
commit;
