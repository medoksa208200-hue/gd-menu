-- Live Supabase-only smoke test. All temporary rows are rolled back.
begin;
do $test$
declare u uuid:=gen_random_uuid(); m uuid; result jsonb; n integer;
begin
  insert into auth.users(id) values(u);
  insert into public.profiles(id,display_name) values(u,'Transactional integration test');
  insert into public.user_roles(user_id,role_id) select u,id from public.roles where name='super_admin';
  perform set_config('request.jwt.claims',jsonb_build_object('sub',u,'role','authenticated')::text,true);
  execute 'set local role authenticated';
  if not private.has_permission('molds.create') then raise exception 'Live permission resolution failed'; end if;
  insert into public.molds(code,name_ar,name_en) values('INTEGRATION-'||u::text,'اختبار مؤقت','Temporary integration test') returning id into m;
  if not exists(select 1 from public.mold_internal_details where mold_id=m) then raise exception 'Automatic internal record missing'; end if;
  update public.mold_internal_details set internal_notes='CONFIDENTIAL-TEST',chrome_interval_days=90 where mold_id=m;
  update public.mold_specifications set diameter_mm=250 where mold_id=m;
  insert into public.production_logs(mold_id,production_date,press_cycles,quantity_produced,rejected_quantity) values(m,current_date,12,48,2);
  insert into public.maintenance_records(mold_id,maintenance_date,maintenance_type,status,cost) values(m,current_date,'Test repair','completed',100);
  insert into public.chrome_records(mold_id,chrome_date,chrome_type,cost) values(m,current_date,'Test chrome',200);
  select to_jsonb(x) into result from public.get_mold_lifecycle(m) x;
  if (result->>'lifetime_cycles')::bigint<>12 or (result->>'quantity_produced')::bigint<>48 or (result->>'maintenance_count')::bigint<>1 then raise exception 'Lifecycle aggregation failed'; end if;
  execute 'set local role anon';
  if exists(select 1 from public.catalog_molds where id=m) then raise exception 'Draft leaked'; end if;
  begin
    perform 1 from public.mold_internal_details limit 1;
    raise exception 'Anonymous private table read unexpectedly succeeded';
  exception when insufficient_privilege then null; end;
  execute 'set local role authenticated';
  update public.molds set publication_status='published' where id=m;
  execute 'set local role anon';
  if not exists(select 1 from public.catalog_molds where id=m) then raise exception 'Published listing missing'; end if;
  if exists(select 1 from public.catalog_molds where id=m and to_jsonb(catalog_molds)::text like '%CONFIDENTIAL-TEST%') then raise exception 'Internal note leaked'; end if;
  begin
    perform public.get_factory_dashboard();
    raise exception 'Anonymous report access unexpectedly succeeded';
  exception when insufficient_privilege then null; end;
  execute 'reset role';
end
$test$;
rollback;