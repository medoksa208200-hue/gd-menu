begin;
-- SECURITY DEFINER views are intentional: anon has NO access to source tables.
-- Every projection is an explicit allowlist; NEVER change this to SELECT *.
create view public.catalog_molds with(security_barrier=true) as
select m.id,m.code,m.name_ar,m.name_en,m.description_ar,m.description_en,
       m.main_category_id,m.shape,m.public_availability,m.is_new,m.is_featured,m.published_at,
       s.diameter_mm,s.length_mm,s.width_mm,s.height_mm,s.depth_mm,s.product_weight_g,s.capacity_ml
from public.molds m left join public.mold_specifications s on s.mold_id=m.id
where m.publication_status='published' and m.deleted_at is null;
create view public.catalog_categories with(security_barrier=true) as
select id,name_ar,name_en,slug,description_ar,description_en,parent_id,cover_storage_key,display_order,show_on_homepage
from public.categories where is_active;
create view public.catalog_mold_categories with(security_barrier=true) as
select mc.mold_id,mc.category_id from public.mold_categories mc
join public.catalog_molds m on m.id=mc.mold_id join public.catalog_categories c on c.id=mc.category_id
union
select m.id,m.main_category_id from public.catalog_molds m join public.catalog_categories c on c.id=m.main_category_id;
create view public.catalog_colors with(security_barrier=true) as
select c.id,c.name_ar,c.name_en,c.hex,mc.mold_id from public.colors c
join public.mold_colors mc on mc.color_id=c.id join public.catalog_molds m on m.id=mc.mold_id;
create view public.catalog_images with(security_barrier=true) as
select i.id,i.mold_id,i.bucket_id,i.storage_key,i.image_type,i.alt_ar,i.alt_en,i.display_order,i.is_main
from public.mold_images i join public.catalog_molds m on m.id=i.mold_id
where i.visibility='public' and i.is_approved and i.bucket_id='catalog-media';
create view public.catalog_documents with(security_barrier=true) as
select d.id,d.mold_id,d.title_ar,d.title_en,d.bucket_id,d.storage_key,d.mime_type
from public.mold_documents d join public.catalog_molds m on m.id=d.mold_id
where d.visibility='public' and d.is_approved and d.bucket_id='catalog-media';
create view public.catalog_homepage_sections with(security_barrier=true) as
select h.id,h.title_ar,h.title_en,h.subtitle_ar,h.subtitle_en,h.collection_type,h.category_id,h.display_order,h.item_limit
from public.homepage_sections h where h.is_active and h.is_published
and (h.collection_type<>'category' or exists(select 1 from public.catalog_categories c where c.id=h.category_id));
create view public.catalog_company with(security_barrier=true) as
select company_name_ar,company_name_en,about_ar,about_en,public_email,public_phone,whatsapp_number,address_ar,address_en,logo_path
from public.company_settings;
-- No counts/costs/operators/providers/search terms leak through these views.
grant select on public.catalog_molds,public.catalog_categories,public.catalog_mold_categories,public.catalog_colors,
public.catalog_images,public.catalog_documents,public.catalog_homepage_sections,public.catalog_company to anon,authenticated;

-- Safe, bounded, server-side filtering. ILIKE values are parameters, not SQL fragments.
create function public.search_catalog(
  search_text text default null, category_slug text default null, shape_filter text default null,
  color_filter uuid default null,
  diameter_min numeric default null, diameter_max numeric default null,
  length_min numeric default null, length_max numeric default null,
  width_min numeric default null, width_max numeric default null,
  height_min numeric default null, height_max numeric default null,
  sort_by text default 'latest', page_number integer default 1, page_size integer default 24
) returns setof public.catalog_molds
language plpgsql stable security definer set search_path='' as $$
begin
  if page_number<1 or page_number>10000 or page_size<1 or page_size>100
     or page_number is null or page_size is null then
    raise exception 'Invalid pagination' using errcode='22023';
  end if;
  if coalesce(length(search_text),0)>200 then raise exception 'Search query too long' using errcode='22023'; end if;
  if sort_by is null or sort_by not in ('latest','name','popular','sales') then raise exception 'Invalid sort' using errcode='22023'; end if;
  return query
  select m.id,m.code,m.name_ar,m.name_en,m.description_ar,m.description_en,m.main_category_id,
    m.shape,m.public_availability,m.is_new,m.is_featured,m.published_at,
    m.diameter_mm,m.length_mm,m.width_mm,m.height_mm,m.depth_mm,m.product_weight_g,m.capacity_ml
  from public.catalog_molds m
  where (nullif(btrim(search_text),'') is null or
         m.code ilike '%'||search_text||'%' or m.name_ar ilike '%'||search_text||'%' or m.name_en ilike '%'||search_text||'%')
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

-- Dynamic marketing collections: categories and homepage sections remain separate entities.
create function public.get_homepage_collection(section uuid) returns setof public.catalog_molds
language plpgsql stable security definer set search_path='' as $$
declare h public.catalog_homepage_sections%rowtype;
begin
  select * into h from public.catalog_homepage_sections where id=section;
  if not found then return; end if;
  return query
  select m.id,m.code,m.name_ar,m.name_en,m.description_ar,m.description_en,m.main_category_id,
    m.shape,m.public_availability,m.is_new,m.is_featured,m.published_at,
    m.diameter_mm,m.length_mm,m.width_mm,m.height_mm,m.depth_mm,m.product_weight_g,m.capacity_ml
  from public.catalog_molds m
  where
    (h.collection_type='manual' and exists(select 1 from public.homepage_section_items i where i.section_id=h.id and i.mold_id=m.id))
    or h.collection_type in ('latest','most_viewed','most_searched')
    or (h.collection_type='best_selling' and exists(select 1 from public.sales_statistics s where s.mold_id=m.id and s.units_sold>0))
    or (h.collection_type='category' and exists(select 1 from public.catalog_mold_categories mc where mc.mold_id=m.id and mc.category_id=h.category_id))
  order by
    case when h.collection_type='manual' then (select i.display_order from public.homepage_section_items i where i.section_id=h.id and i.mold_id=m.id) end asc nulls last,
    case when h.collection_type='most_viewed' then (select count(*) from public.mold_views v where v.mold_id=m.id) end desc nulls last,
    case when h.collection_type='most_searched' then (select count(*) from public.mold_search_events e where e.matched_mold_id=m.id) end desc nulls last,
    case when h.collection_type='best_selling' then (select sum(s.units_sold) from public.sales_statistics s where s.mold_id=m.id) end desc nulls last,
    m.published_at desc,m.id
  limit h.item_limit;
end $$;

-- Private, permission-gated report source. Sums preserve currency boundaries.
create view private.mold_lifecycle as
select m.id,m.code,m.name_ar,m.name_en,d.operational_status,m.deleted_at,
  d.opening_cycles+coalesce(p.cycles,0) as lifetime_cycles,
  coalesce(p.produced,0) as quantity_produced,coalesce(p.rejected,0) as rejected_quantity,
  case when p.produced>0 then round(100.0*p.rejected/p.produced,2) end as rejection_rate_percent,
  p.last_production_date,
  maint.maintenance_date as latest_maintenance_date,
  coalesce((select count(*) from public.maintenance_records x where x.mold_id=m.id and x.status='completed'),0) as maintenance_count,
  coalesce(maint.next_recommended_date,maint.maintenance_date+d.maintenance_interval_days,d.acquisition_date+d.maintenance_interval_days) as next_maintenance_date,
  case when d.maintenance_interval_cycles is not null then
    coalesce(maint.cycles_at_service,case when maint.maintenance_date is not null then
      d.opening_cycles+coalesce((select sum(pl.press_cycles) from public.production_logs pl where pl.mold_id=m.id and pl.production_date<=maint.maintenance_date),0)
      else d.opening_cycles end)+d.maintenance_interval_cycles end as next_maintenance_cycles,
  chr.chrome_date as latest_chrome_date,
  current_date-chr.chrome_date as days_since_chrome,
  coalesce(chr.next_expected_date,chr.chrome_date+d.chrome_interval_days,d.acquisition_date+d.chrome_interval_days) as next_chrome_date,
  coalesce((select jsonb_object_agg(t.currency,t.total) from (
    select currency,sum(cost) total from public.maintenance_records mr where mr.mold_id=m.id and mr.status='completed' group by currency
  ) t),'{}'::jsonb) as maintenance_cost_by_currency,
  coalesce((select jsonb_object_agg(t.currency,t.total) from (
    select currency,sum(cost) total from public.chrome_records cr where cr.mold_id=m.id and cr.status='completed' group by currency
  ) t),'{}'::jsonb) as chrome_cost_by_currency
from public.molds m join public.mold_internal_details d on d.mold_id=m.id
left join lateral (select sum(press_cycles) cycles,sum(quantity_produced) produced,sum(rejected_quantity) rejected,max(production_date) last_production_date
                   from public.production_logs where mold_id=m.id) p on true
left join lateral (select maintenance_date,next_recommended_date,cycles_at_service from public.maintenance_records
                   where mold_id=m.id and status='completed' order by maintenance_date desc,created_at desc,id desc limit 1) maint on true
left join lateral (select chrome_date,next_expected_date from public.chrome_records
                   where mold_id=m.id and status='completed' order by chrome_date desc,created_at desc,id desc limit 1) chr on true;

create function public.get_mold_lifecycle(target_mold_id uuid) returns setof private.mold_lifecycle
language plpgsql stable security definer set search_path='' as $$
begin
  if not private.has_permission('reports.view') then raise exception 'reports.view required' using errcode='42501'; end if;
  return query select * from private.mold_lifecycle where id=target_mold_id;
end $$;
create function public.get_factory_dashboard() returns jsonb
language plpgsql stable security definer set search_path='' as $$
begin
  if not private.has_permission('reports.view') then raise exception 'reports.view required' using errcode='42501'; end if;
  return jsonb_build_object(
    'total_molds',(select count(*) from public.molds where deleted_at is null),
    'active_molds',(select count(*) from private.mold_lifecycle where deleted_at is null and operational_status='active'),
    'inactive_molds',(select count(*) from private.mold_lifecycle where deleted_at is null and operational_status in ('inactive','retired')),
    'under_maintenance',(select count(*) from private.mold_lifecycle where deleted_at is null and operational_status='maintenance'),
    'new_this_month',(select count(*) from public.molds where deleted_at is null and created_at>=date_trunc('month',now())),
    'overdue_maintenance',(select count(*) from private.mold_lifecycle where deleted_at is null and (next_maintenance_date<current_date or next_maintenance_cycles<=lifetime_cycles)),
    'upcoming_chrome',(select count(*) from private.mold_lifecycle where deleted_at is null and next_chrome_date between current_date and current_date+30),
    'overdue_chrome',(select count(*) from private.mold_lifecycle where deleted_at is null and next_chrome_date<current_date),
    'maintenance_cost_by_currency',coalesce((select jsonb_object_agg(t.currency,t.total) from (select currency,sum(cost) total from public.maintenance_records where status='completed' group by currency) t),'{}'::jsonb),
    'most_viewed',coalesce((select jsonb_agg(t) from (select m.code,m.name_ar,m.name_en,count(v.id) as views from public.catalog_molds m join public.mold_views v on v.mold_id=m.id group by m.id,m.code,m.name_ar,m.name_en order by count(v.id) desc,m.code limit 10)t),'[]'::jsonb)
  );
end $$;
revoke all on function public.search_catalog(text,text,text,uuid,numeric,numeric,numeric,numeric,numeric,numeric,numeric,numeric,text,integer,integer),public.get_homepage_collection(uuid),public.get_mold_lifecycle(uuid),public.get_factory_dashboard() from public,anon,authenticated;
grant execute on function public.search_catalog(text,text,text,uuid,numeric,numeric,numeric,numeric,numeric,numeric,numeric,numeric,text,integer,integer),public.get_homepage_collection(uuid) to anon,authenticated;
grant execute on function public.get_mold_lifecycle(uuid),public.get_factory_dashboard() to authenticated;
revoke all on all tables in schema private from public,anon,authenticated;
commit;
