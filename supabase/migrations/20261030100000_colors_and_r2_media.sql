begin;
-- "Available in all colors" is a property of the design, shown instead of (or alongside) specific colors.
alter table public.molds add column if not exists all_colors boolean not null default false;

create or replace view public.catalog_molds with(security_barrier=true) as
select m.id,m.code,m.name_ar,m.name_en,m.description_ar,m.description_en,
       m.main_category_id,m.shape,m.public_availability,m.is_new,m.is_featured,m.published_at,
       s.diameter_mm,s.length_mm,s.width_mm,s.height_mm,s.depth_mm,s.product_weight_g,s.capacity_ml,
       m.all_colors
from public.molds m left join public.mold_specifications s on s.mold_id=m.id
where m.publication_status='published' and m.deleted_at is null;

-- Staff who edit molds may add new colors from the palette while editing; managing names stays with categories.manage.
create policy colors_insert_by_editors on public.colors for insert to authenticated with check((select private.has_permission('molds.edit')));

-- Public catalog images may be stored in Cloudflare R2 (served from a public, immutable, edge-cached URL).
-- Private factory images and all documents stay in private Supabase Storage.
do $$ declare c record; begin
  for c in select conname from pg_constraint where conrelid='public.mold_images'::regclass and contype='c' and pg_get_constraintdef(oid) like '%factory-files%' loop
    execute format('alter table public.mold_images drop constraint %I',c.conname);
  end loop;
end $$;
alter table public.mold_images add constraint mold_images_bucket_visibility check ((visibility='public' and bucket_id in ('catalog-media','r2')) or (visibility='private' and bucket_id='factory-files'));
create or replace view public.catalog_images with(security_barrier=true) as
select i.id,i.mold_id,i.bucket_id,i.storage_key,i.image_type,i.alt_ar,i.alt_en,i.display_order,i.is_main
from public.mold_images i join public.catalog_molds m on m.id=i.mold_id
where i.visibility='public' and i.is_approved and i.bucket_id in ('catalog-media','r2');

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
    m.diameter_mm,m.length_mm,m.width_mm,m.height_mm,m.depth_mm,m.product_weight_g,m.capacity_ml,m.all_colors
  from public.catalog_molds m
  where (needle is null or m.code ilike needle or m.name_ar ilike needle or m.name_en ilike needle)
    and (category_slug is null or exists(select 1 from public.catalog_mold_categories mc join public.catalog_categories c on c.id=mc.category_id where mc.mold_id=m.id and c.slug=category_slug))
    and (shape_filter is null or m.shape=shape_filter)
    and (color_filter is null or m.all_colors or exists(select 1 from public.catalog_colors c where c.mold_id=m.id and c.id=color_filter))
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

create or replace function public.get_homepage_collection(section uuid) returns setof public.catalog_molds
language plpgsql stable security definer set search_path='' as $$
declare h public.catalog_homepage_sections%rowtype;
begin
  select * into h from public.catalog_homepage_sections where id=section;
  if not found then return; end if;
  return query
  select m.id,m.code,m.name_ar,m.name_en,m.description_ar,m.description_en,m.main_category_id,
    m.shape,m.public_availability,m.is_new,m.is_featured,m.published_at,
    m.diameter_mm,m.length_mm,m.width_mm,m.height_mm,m.depth_mm,m.product_weight_g,m.capacity_ml,m.all_colors
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

create or replace function public.save_mold_bundle(target_id uuid,payload jsonb) returns uuid language plpgsql security invoker set search_path='' as $$
declare result_id uuid; p public.mold_specifications; d public.mold_internal_details;
begin
 if not private.has_permission('molds.edit') then raise exception 'molds.edit required' using errcode='42501'; end if;
 if target_id is null then
  insert into public.molds(code,name_ar,name_en) values(payload->>'code',payload->>'name_ar',payload->>'name_en') returning id into result_id;
 else
  result_id:=target_id;
 end if;
 update public.molds set code=payload->>'code',name_ar=payload->>'name_ar',name_en=payload->>'name_en',description_ar=payload->>'description_ar',description_en=payload->>'description_en',
 main_category_id=nullif(payload->>'main_category_id','')::uuid,shape=payload->>'shape',public_availability=payload->>'public_availability',
 publication_status=coalesce(payload->>'publication_status','draft')::public.publication_status,
 is_new=coalesce((payload->>'is_new')::boolean,false),is_featured=coalesce((payload->>'is_featured')::boolean,false),
 all_colors=coalesce((payload->>'all_colors')::boolean,false) where id=result_id;
 if not found then raise exception 'Mold unavailable' using errcode='42501'; end if;
 p:=jsonb_populate_record(null::public.mold_specifications,payload);
 update public.mold_specifications set diameter_mm=p.diameter_mm,length_mm=p.length_mm,width_mm=p.width_mm,height_mm=p.height_mm,depth_mm=p.depth_mm,product_weight_g=p.product_weight_g,capacity_ml=p.capacity_ml where mold_id=result_id;
 d:=jsonb_populate_record(null::public.mold_internal_details,payload);
 update public.mold_internal_details set internal_description=d.internal_description,material=d.material,cavities=d.cavities,mold_type=d.mold_type,technical_specifications=coalesce(d.technical_specifications,'{}'),
 acquisition_date=d.acquisition_date,first_production_date=d.first_production_date,operational_status=coalesce(d.operational_status,'active'),storage_location=d.storage_location,estimated_output_per_hour=d.estimated_output_per_hour,
 chrome_interval_days=d.chrome_interval_days,maintenance_interval_days=d.maintenance_interval_days,maintenance_interval_cycles=d.maintenance_interval_cycles,internal_notes=d.internal_notes where mold_id=result_id;
 if payload ? 'category_ids' then
  delete from public.mold_categories where mold_id=result_id;
  insert into public.mold_categories(mold_id,category_id) select result_id,value::uuid from jsonb_array_elements_text(payload->'category_ids') value;
 end if;
 if payload ? 'color_ids' then
  delete from public.mold_colors where mold_id=result_id;
  insert into public.mold_colors(mold_id,color_id) select result_id,value::uuid from jsonb_array_elements_text(payload->'color_ids') value;
 end if;
 if payload ? 'machine_ids' then
  delete from public.mold_machine_compatibility where mold_id=result_id;
  insert into public.mold_machine_compatibility(mold_id,machine_id) select result_id,value::uuid from jsonb_array_elements_text(payload->'machine_ids') value;
 end if;
 return result_id;
end $$;
commit;
