-- Homepage sections can be deleted (their picked designs go with them), and a "best sellers" section also shows
-- designs tagged best_seller, so it is not empty before sales figures are imported.
-- Non-destructive: only grants, one new policy and a replaced function body.
begin;
grant delete on public.homepage_sections to authenticated;
do $$ begin
  if not exists(select 1 from pg_policies where schemaname='public' and tablename='homepage_sections' and policyname='sections_delete') then
    create policy sections_delete on public.homepage_sections for delete to authenticated
      using((select private.has_permission('content.manage')) and (not is_published or (select private.has_permission('content.publish'))));
  end if;
end $$;

create or replace function public.get_homepage_collection(section uuid) returns setof public.catalog_molds
language plpgsql stable security definer set search_path='' as $$
declare h public.catalog_homepage_sections%rowtype;
begin
  select * into h from public.catalog_homepage_sections where id=section;
  if not found then return; end if;
  return query
  select m.id,m.code,m.name_ar,m.name_en,m.description_ar,m.description_en,m.main_category_id,
    m.shape,m.public_availability,m.is_new,m.is_featured,m.published_at,
    m.diameter_mm,m.length_mm,m.width_mm,m.height_mm,m.depth_mm,m.product_weight_g,m.capacity_ml,m.all_colors,m.tags
  from public.catalog_molds m
  where
    (h.collection_type='manual' and exists(select 1 from public.homepage_section_items i where i.section_id=h.id and i.mold_id=m.id))
    or h.collection_type in ('latest','most_viewed','most_searched')
    or (h.collection_type='best_selling' and ('best_seller'=any(m.tags) or exists(select 1 from public.sales_statistics s where s.mold_id=m.id and s.units_sold>0)))
    or (h.collection_type='category' and exists(select 1 from public.catalog_mold_categories mc where mc.mold_id=m.id and mc.category_id=h.category_id))
  order by
    case when h.collection_type='manual' then (select i.display_order from public.homepage_section_items i where i.section_id=h.id and i.mold_id=m.id) end asc nulls last,
    case when h.collection_type='most_viewed' then (select count(*) from public.mold_views v where v.mold_id=m.id) end desc nulls last,
    case when h.collection_type='most_searched' then (select count(*) from public.mold_search_events e where e.matched_mold_id=m.id) end desc nulls last,
    case when h.collection_type='best_selling' then (select sum(s.units_sold) from public.sales_statistics s where s.mold_id=m.id) end desc nulls last,
    case when h.collection_type='best_selling' then 'best_seller'=any(m.tags) end desc nulls last,
    m.published_at desc,m.id
  limit h.item_limit;
end $$;
commit;
