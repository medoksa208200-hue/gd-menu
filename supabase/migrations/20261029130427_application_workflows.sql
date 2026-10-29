begin;
create function public.get_my_access() returns jsonb language sql stable security definer set search_path='' as $$
select coalesce((select jsonb_build_object('user_id',p.id,'display_name',p.display_name,'active',p.is_active and private.is_staff(),'is_super_admin',private.is_super_admin(),
'roles',coalesce((select jsonb_agg(r.name) from public.user_roles ur join public.roles r on r.id=ur.role_id where ur.user_id=p.id),'[]'),
'permissions',coalesce((select jsonb_agg(key) from public.permissions where private.has_permission(key)),'[]'))
from public.profiles p where p.id=auth.uid()),'{}'::jsonb);
$$;
revoke all on function public.get_my_access() from public,anon;
grant execute on function public.get_my_access() to authenticated;
create function public.save_mold_bundle(target_id uuid,payload jsonb) returns uuid language plpgsql security invoker set search_path='' as $$
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
 return result_id;
end $$;
revoke all on function public.save_mold_bundle(uuid,jsonb) from public,anon;
grant execute on function public.save_mold_bundle(uuid,jsonb) to authenticated;
create function public.save_homepage_section(target_id uuid,payload jsonb,mold_ids uuid[] default '{}') returns uuid
language plpgsql security invoker set search_path='' as $$
declare r public.homepage_sections; result_id uuid;
begin
 if not private.has_permission('content.manage') then raise exception 'content.manage required' using errcode='42501'; end if;
 r:=jsonb_populate_record(null::public.homepage_sections,payload);
 if target_id is null then
 insert into public.homepage_sections(title_ar,title_en) values(r.title_ar,r.title_en) returning id into result_id;
 else result_id:=target_id; end if;
 update public.homepage_sections set title_ar=r.title_ar,title_en=r.title_en,subtitle_ar=r.subtitle_ar,subtitle_en=r.subtitle_en,collection_type=coalesce(r.collection_type,'manual'),
 category_id=r.category_id,display_order=coalesce(r.display_order,0),item_limit=coalesce(r.item_limit,8),is_active=coalesce(r.is_active,true),is_published=coalesce(r.is_published,false) where id=result_id;
 if not found then raise exception 'Section unavailable' using errcode='42501'; end if;
 delete from public.homepage_section_items where section_id=result_id;
 insert into public.homepage_section_items(section_id,mold_id,display_order) select result_id,x.id,x.ord::integer from unnest(mold_ids) with ordinality x(id,ord);
 return result_id;
end $$;
revoke all on function public.save_homepage_section(uuid,jsonb,uuid[]) from public,anon;
grant execute on function public.save_homepage_section(uuid,jsonb,uuid[]) to authenticated;
create function private.approved_catalog_object(object_name text) returns boolean language sql stable security definer set search_path='' as $$
 select exists(select 1 from public.catalog_images where storage_key=object_name)
 or exists(select 1 from public.catalog_documents where storage_key=object_name)
 or exists(select 1 from public.catalog_categories where cover_storage_key=object_name);
$$;
revoke all on function private.approved_catalog_object(text) from public,anon,authenticated;
grant usage on schema private to anon;
grant execute on function private.approved_catalog_object(text) to anon,authenticated;
create policy gd_published_media on storage.objects for select to anon,authenticated using(bucket_id='catalog-media' and private.approved_catalog_object(name));
-- No public table or private file gains a read grant.
create function public.provision_invited_staff(target_user_id uuid,staff_name text,role_name text) returns void language plpgsql security definer set search_path='' as $$
declare r uuid;
begin
 if role_name not in ('admin','supervisor','viewer') then raise exception 'Invalid staff role'; end if;
 select id into r from public.roles where name=role_name;
 insert into public.profiles(id,display_name) values(target_user_id,staff_name);
 insert into public.user_roles(user_id,role_id) values(target_user_id,r);
end $$;
revoke all on function public.provision_invited_staff(uuid,text,text) from public,anon,authenticated;
grant execute on function public.provision_invited_staff(uuid,text,text) to service_role;
commit;
