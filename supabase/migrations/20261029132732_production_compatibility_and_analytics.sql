begin;
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
 is_new=coalesce((payload->>'is_new')::boolean,false),is_featured=coalesce((payload->>'is_featured')::boolean,false) where id=result_id;
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

create table private.analytics_rate(visitor_hash text not null,window_start timestamptz not null,requests integer not null,primary key(visitor_hash,window_start));
alter table private.analytics_rate enable row level security;
revoke all on private.analytics_rate from public,anon,authenticated;
create function public.ingest_catalog_event(visitor_hash text,event_type text,target_mold uuid default null,query_text text default null) returns boolean language plpgsql security definer set search_path='' as $$
declare used integer; window_key timestamptz:=date_trunc('hour',now());
begin
 if length(visitor_hash)<>64 or event_type not in ('view','search') then return false; end if;
 insert into private.analytics_rate values(visitor_hash,window_key,1)
 on conflict(visitor_hash,window_start) do update set requests=private.analytics_rate.requests+1 returning requests into used;
 if used>120 then return false; end if;
 if target_mold is not null and not exists(select 1 from public.catalog_molds where id=target_mold) then return false; end if;
 if event_type='view' and target_mold is not null then
  if not exists(select 1 from public.mold_views where mold_id=target_mold and session_hash=visitor_hash and viewed_at>=current_date) then
   insert into public.mold_views(mold_id,session_hash) values(target_mold,visitor_hash);
  end if;
 elsif event_type='search' and length(btrim(query_text)) between 1 and 200 then
  insert into public.mold_search_events(query,matched_mold_id) values(query_text,target_mold);
 end if;
 delete from private.analytics_rate where window_start<now()-interval '2 days';
 return true;
end $$;
revoke all on function public.ingest_catalog_event(text,text,uuid,text) from public,anon,authenticated;
grant execute on function public.ingest_catalog_event(text,text,uuid,text) to service_role;
commit;
