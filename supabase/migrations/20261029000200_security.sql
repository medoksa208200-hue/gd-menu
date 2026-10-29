begin;
-- No authorization is sourced from editable auth.user_metadata.
create function private.has_permission(requested text) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.profiles p where p.id=auth.uid() and p.is_active
    and (exists(select 1 from public.user_roles ur join public.role_permissions rp on rp.role_id=ur.role_id
                where ur.user_id=p.id and rp.permission_key=requested)
         or exists(select 1 from public.user_permissions up where up.user_id=p.id and up.permission_key=requested))
  );
$$;
create function private.is_staff() returns boolean
language sql stable security definer set search_path = '' as $$
  select exists(select 1 from public.profiles p where p.id=auth.uid() and p.is_active
    and (exists(select 1 from public.user_roles ur where ur.user_id=p.id)
         or exists(select 1 from public.user_permissions up where up.user_id=p.id)));
$$;
create function private.is_super_admin() returns boolean
language sql stable security definer set search_path = '' as $$
  select exists(select 1 from public.profiles p join public.user_roles ur on ur.user_id=p.id
    join public.roles r on r.id=ur.role_id where p.id=auth.uid() and p.is_active and r.name='super_admin');
$$;
create function private.is_service() returns boolean
language sql stable set search_path = '' as $$
  select coalesce(nullif(current_setting('request.jwt.claims',true),'')::jsonb->>'role'='service_role', false);
$$;

insert into public.permissions(key,description) values
('molds.view','Read internal mold master records'),('molds.create','Create draft molds'),
('molds.edit','Edit mold records and physical specifications'),('molds.archive','Soft delete and restore molds'),
('categories.manage','Manage categories and colors'),('maintenance.view','Read maintenance records'),
('maintenance.create','Append maintenance records'),('maintenance.edit','Update unfinished maintenance'),
('chrome.view','Read chrome records'),('chrome.create','Append chrome records'),
('chrome.edit','Update unfinished chrome records'),('production.view','Read production logs and machines'),
('production.manage','Append production logs and manage machine compatibility'),
('content.manage','Prepare homepage sections'),('content.publish','Publish molds, approved media and homepage sections'),
('reports.view','Read internal operational reports and analytics'),('users.manage','Inspect staff; access changes additionally require super admin'),
('settings.manage','Manage company settings'),('activity.view','Read immutable audit log'),
('sales.manage','Import actual sales statistics'),('media.manage','Upload and manage mold media');
insert into public.roles(name,name_ar,name_en) values
('super_admin','مدير النظام','Super Admin'),('admin','مدير','Admin'),
('supervisor','مشرف','Supervisor'),('viewer','قارئ','Viewer');
insert into public.role_permissions(role_id,permission_key)
select r.id,p.key from public.roles r cross join public.permissions p where r.name='super_admin';
insert into public.role_permissions(role_id,permission_key)
select r.id,p.key from public.roles r cross join public.permissions p where r.name='admin'
and p.key not in ('users.manage','settings.manage','activity.view');
insert into public.role_permissions(role_id,permission_key)
select r.id,p.key from public.roles r cross join public.permissions p where r.name='supervisor'
and p.key in ('molds.view','maintenance.view','maintenance.create','chrome.view','chrome.create','production.view','production.manage','media.manage');
insert into public.role_permissions(role_id,permission_key)
select r.id,p.key from public.roles r cross join public.permissions p where r.name='viewer'
and p.key in ('molds.view','maintenance.view','chrome.view','production.view');

-- Revoke default grants, including privileges Supabase default ACLs may have supplied.
revoke all on all tables in schema public from anon,authenticated;
revoke all on all sequences in schema public from anon,authenticated;
grant all on all tables in schema public to service_role;
grant usage,select on all sequences in schema public to service_role;
-- Default deny for EVERY base table, including future tables in this migration.
do $$ declare t record; begin
  for t in select tablename from pg_tables where schemaname='public' loop
    execute format('alter table public.%I enable row level security',t.tablename);
  end loop;
end $$;
alter table private.system_settings enable row level security;

-- Narrow staff reads. No signed-in user becomes staff merely by signing in.
grant select,update(display_name,preferred_language) on public.profiles to authenticated;
create policy profiles_read on public.profiles for select to authenticated using(id=auth.uid() or private.has_permission('users.manage'));
create policy profiles_self_edit on public.profiles for update to authenticated using(id=auth.uid() and private.is_staff()) with check(id=auth.uid() and private.is_staff());
grant select on public.roles,public.permissions,public.role_permissions,public.user_roles,public.user_permissions to authenticated;
create policy roles_read on public.roles for select to authenticated using(private.is_staff());
create policy permissions_read on public.permissions for select to authenticated using(private.is_staff());
create policy role_permissions_read on public.role_permissions for select to authenticated using(private.is_staff());
create policy user_roles_read on public.user_roles for select to authenticated using(user_id=auth.uid() or private.has_permission('users.manage'));
create policy user_permissions_read on public.user_permissions for select to authenticated using(user_id=auth.uid() or private.has_permission('users.manage'));
-- No client writes to authorization tables, including super admins. Use set_staff_access RPC.

-- Ordinary master and lookup tables use explicit per-operation permissions.
do $$ declare x record; begin
  for x in select * from (values
    ('molds','molds.view','molds.create','molds.edit'),
    ('mold_specifications','molds.view','molds.edit','molds.edit'),
    ('mold_internal_details','molds.view','molds.edit','molds.edit'),
    ('mold_categories','molds.view','molds.edit','molds.edit'),
    ('mold_colors','molds.view','molds.edit','molds.edit'),
    ('categories','molds.view','categories.manage','categories.manage'),
    ('colors','molds.view','categories.manage','categories.manage'),
    ('mold_images','molds.view','media.manage','media.manage'),
    ('mold_documents','molds.view','media.manage','media.manage'),
    ('maintenance_records','maintenance.view','maintenance.create','maintenance.edit'),
    ('chrome_records','chrome.view','chrome.create','chrome.edit'),
    ('machines','production.view','production.manage','production.manage'),
    ('mold_machine_compatibility','production.view','production.manage','production.manage'),
    ('homepage_sections','content.manage','content.manage','content.manage'),
    ('homepage_section_items','content.manage','content.manage','content.manage')
  ) v(tbl,read_permission,insert_permission,update_permission) loop
    execute format('grant select,insert,update on public.%I to authenticated',x.tbl);
    execute format('create policy staff_read on public.%I for select to authenticated using(private.has_permission(%L))',x.tbl,x.read_permission);
    execute format('create policy staff_insert on public.%I for insert to authenticated with check(private.has_permission(%L))',x.tbl,x.insert_permission);
    execute format('create policy staff_update on public.%I for update to authenticated using(private.has_permission(%L)) with check(private.has_permission(%L))',x.tbl,x.update_permission,x.update_permission);
  end loop;
end $$;
-- Removing links/media is safe; mold and event history have NO DELETE grant/policy.
do $$ declare x record; begin
  for x in select * from (values ('mold_categories','molds.edit'),('mold_colors','molds.edit'),
    ('mold_machine_compatibility','production.manage'),('mold_images','media.manage'),
    ('mold_documents','media.manage'),('homepage_section_items','content.manage')) v(tbl,perm) loop
    execute format('grant delete on public.%I to authenticated',x.tbl);
    execute format('create policy staff_delete on public.%I for delete to authenticated using(private.has_permission(%L))',x.tbl,x.perm);
  end loop;
end $$;
grant select,insert on public.production_logs to authenticated;
create policy production_read on public.production_logs for select to authenticated using(private.has_permission('production.view'));
create policy production_insert on public.production_logs for insert to authenticated with check(private.has_permission('production.manage'));
grant select,insert on public.event_attachments to authenticated;
create policy attachment_read on public.event_attachments for select to authenticated using(
  (maintenance_id is not null and private.has_permission('maintenance.view')) or
  (chrome_id is not null and private.has_permission('chrome.view')));
create policy attachment_insert on public.event_attachments for insert to authenticated with check(
  (maintenance_id is not null and private.has_permission('maintenance.create')) or
  (chrome_id is not null and private.has_permission('chrome.create')));
grant select on public.audit_logs to authenticated;
create policy audit_read on public.audit_logs for select to authenticated using(private.has_permission('activity.view'));
grant select on public.mold_views,public.mold_search_events,public.sales_statistics to authenticated;
create policy views_read on public.mold_views for select to authenticated using(private.has_permission('reports.view'));
create policy searches_read on public.mold_search_events for select to authenticated using(private.has_permission('reports.view'));
create policy sales_read on public.sales_statistics for select to authenticated using(private.has_permission('reports.view') or private.has_permission('sales.manage'));
grant insert on public.sales_statistics to authenticated;
create policy sales_insert on public.sales_statistics for insert to authenticated with check(private.has_permission('sales.manage'));
grant select,update(read_at) on public.notifications to authenticated;
create policy notification_read on public.notifications for select to authenticated using(user_id=auth.uid() and private.is_staff());
create policy notification_mark_read on public.notifications for update to authenticated using(user_id=auth.uid() and private.is_staff()) with check(user_id=auth.uid() and private.is_staff());
grant select,insert,update on public.company_settings to authenticated;
create policy company_read on public.company_settings for select to authenticated using(private.has_permission('settings.manage'));
create policy company_insert on public.company_settings for insert to authenticated with check(private.has_permission('settings.manage'));
create policy company_update on public.company_settings for update to authenticated using(private.has_permission('settings.manage')) with check(private.has_permission('settings.manage'));

-- Trigger-level checks protect column-level invariants in addition to RLS.
create function private.guard_mold() returns trigger
language plpgsql set search_path='' as $$
begin
  if tg_op='UPDATE' then
    if new.id<>old.id or new.created_at<>old.created_at or new.created_by is distinct from old.created_by then
      raise exception 'Mold identity and creation metadata are immutable' using errcode='23514';
    end if;
    if old.deleted_at is not null and new.deleted_at is null and new.publication_status='published' and not(private.is_service() or private.has_permission('content.publish')) then
      raise exception 'content.publish required to restore a published listing' using errcode='42501';
    end if;
    if new.deleted_at is distinct from old.deleted_at and not(private.is_service() or private.has_permission('molds.archive')) then
      raise exception 'molds.archive required' using errcode='42501';
    end if;
    if new.publication_status is distinct from old.publication_status and not(private.is_service() or private.has_permission('content.publish')) then
      raise exception 'content.publish required' using errcode='42501';
    end if;
    if new.published_at is distinct from old.published_at and not(private.is_service() or private.has_permission('content.publish')) then
      raise exception 'Publication timestamp protected' using errcode='42501';
    end if;
  else
    if new.publication_status<>'draft' and not(private.is_service() or private.has_permission('content.publish')) then
      raise exception 'New molds must be drafts' using errcode='42501';
    end if;
    if new.deleted_at is not null and not private.is_service() then raise exception 'Create as draft, then archive'; end if;
    new.created_by:=auth.uid(); new.created_at:=now();
  end if;
  if new.publication_status='published' and new.published_at is null then new.published_at:=now(); end if;
  new.updated_by:=auth.uid(); new.updated_at:=now();
  return new;
end $$;
create trigger guard_mold before insert or update on public.molds for each row execute function private.guard_mold();
create function private.guard_public_media() returns trigger language plpgsql set search_path='' as $$
begin
  if tg_op='DELETE' then
    if old.is_approved and not(private.is_service() or private.has_permission('content.publish')) then
      raise exception 'content.publish required to remove approved media' using errcode='42501';
    end if;
    return old;
  end if;
  if (tg_op='INSERT' and new.is_approved) or
     (tg_op='UPDATE' and (new.is_approved is distinct from old.is_approved or
       (old.is_approved and to_jsonb(new) is distinct from to_jsonb(old)))) then
    if not(private.is_service() or private.has_permission('content.publish')) then
      raise exception 'content.publish required to approve or change approved media' using errcode='42501';
    end if;
  end if;
  return new;
end $$;
create trigger guard_public_image before insert or update or delete on public.mold_images for each row execute function private.guard_public_media();
create trigger guard_public_document before insert or update or delete on public.mold_documents for each row execute function private.guard_public_media();
create function private.guard_homepage() returns trigger language plpgsql set search_path='' as $$
begin
  if (tg_op='INSERT' and new.is_published) or
     (tg_op='UPDATE' and (new.is_published or old.is_published)) then
    if not(private.is_service() or private.has_permission('content.publish')) then
      raise exception 'content.publish required for published homepage content' using errcode='42501';
    end if;
  end if;
  new.updated_at:=now(); return new;
end $$;
create trigger guard_homepage before insert or update on public.homepage_sections for each row execute function private.guard_homepage();
create function private.guard_homepage_item() returns trigger language plpgsql security definer set search_path='' as $$
declare section uuid;
begin
  section:=case when tg_op='DELETE' then old.section_id else new.section_id end;
  if exists(select 1 from public.homepage_sections where id=section and is_published)
     or (tg_op='UPDATE' and exists(select 1 from public.homepage_sections where id=old.section_id and is_published)) then
    if not(private.is_service() or private.has_permission('content.publish')) then raise exception 'content.publish required' using errcode='42501'; end if;
  end if;
  if tg_op='DELETE' then return old; end if; return new;
end $$;
create trigger guard_homepage_item before insert or update or delete on public.homepage_section_items for each row execute function private.guard_homepage_item();

create function private.guard_event() returns trigger language plpgsql set search_path='' as $$
begin
  if tg_op='DELETE' then raise exception 'Historical records cannot be deleted' using errcode='42501'; end if;
  if tg_op='UPDATE' then
    if old.status='completed' then raise exception 'Completed events are immutable; append a new event' using errcode='23514'; end if;
    if new.id<>old.id or new.mold_id<>old.mold_id or new.created_at<>old.created_at or new.created_by is distinct from old.created_by then
      raise exception 'Event identity and creation metadata are immutable' using errcode='23514';
    end if;
  else new.created_by:=auth.uid(); new.created_at:=now(); end if;
  if tg_table_name='maintenance_records' and new.status='completed' then
    -- Chrome records have no completed_at; use JSON to avoid accessing a nonexistent field.
    new:=jsonb_populate_record(new,jsonb_build_object('completed_at',coalesce(to_jsonb(new)->>'completed_at',now()::text)));
  end if;
  new.updated_at:=now(); return new;
end $$;
create trigger maintenance_history before insert or update or delete on public.maintenance_records for each row execute function private.guard_event();
create trigger chrome_history before insert or update or delete on public.chrome_records for each row execute function private.guard_event();
create function private.guard_production() returns trigger language plpgsql security definer set search_path='' as $$
declare baseline date;
begin
  if tg_op<>'INSERT' then raise exception 'Production history is append-only' using errcode='42501'; end if;
  select opening_cycles_as_of into baseline from public.mold_internal_details where mold_id=new.mold_id;
  if baseline is not null and new.production_date<=baseline then
    raise exception 'Production date must follow opening-cycle baseline' using errcode='23514';
  end if;
  new.created_by:=auth.uid(); new.created_at:=now(); return new;
end $$;
create trigger production_history before insert or update or delete on public.production_logs for each row execute function private.guard_production();
create function private.guard_cycle_baseline() returns trigger language plpgsql security definer set search_path='' as $$
begin
  if new.mold_id<>old.mold_id then raise exception 'Mold reference immutable' using errcode='23514'; end if;
  if (new.opening_cycles is distinct from old.opening_cycles or new.opening_cycles_as_of is distinct from old.opening_cycles_as_of)
    and exists(select 1 from public.production_logs where mold_id=old.mold_id) then
    raise exception 'Opening-cycle baseline is locked once production exists' using errcode='23514';
  end if;
  return new;
end $$;
create trigger cycle_baseline before update on public.mold_internal_details for each row execute function private.guard_cycle_baseline();
-- Serialize category hierarchy edits to prevent concurrent cyclic parent assignments.
create function private.guard_category_tree() returns trigger language plpgsql security definer set search_path='' as $$
begin
  perform pg_advisory_xact_lock(71490001);
  if new.parent_id is not null and exists(
    with recursive ancestors as (
      select id,parent_id from public.categories where id=new.parent_id
      union select c.id,c.parent_id from public.categories c join ancestors a on c.id=a.parent_id
    ) select 1 from ancestors where id=new.id
  ) then raise exception 'Category hierarchy cannot contain cycles' using errcode='23514'; end if;
  new.updated_at:=now(); return new;
end $$;
create trigger category_tree before insert or update on public.categories for each row execute function private.guard_category_tree();

-- Metadata-only auditing avoids copying confidential documents or secrets into logs.
create function private.audit_change() returns trigger language plpgsql security definer set search_path='' as $$
declare before_row jsonb; after_row jsonb; row_data jsonb; changed text[];
begin
  before_row:=case when tg_op<>'INSERT' then to_jsonb(old) else '{}'::jsonb end;
  after_row:=case when tg_op<>'DELETE' then to_jsonb(new) else '{}'::jsonb end;
  row_data:=case when tg_op='DELETE' then before_row else after_row end;
  select coalesce(array_agg(k order by k),'{}'::text[]) into changed
  from (select key k from jsonb_object_keys(before_row||after_row) key
        where before_row->key is distinct from after_row->key) changes;
  insert into public.audit_logs(actor_id,action,table_name,record_id,changed_columns)
  values(auth.uid(),tg_op,tg_table_name,coalesce(row_data->>'id',row_data->>'mold_id',row_data->>'user_id',row_data->>'section_id'),changed);
  if tg_op='DELETE' then return old; end if; return new;
end $$;
do $$ declare t text; begin
  foreach t in array array['profiles','user_roles','user_permissions','molds','mold_specifications','mold_internal_details',
    'categories','colors','mold_categories','mold_colors','mold_images','mold_documents','maintenance_records','chrome_records',
    'production_logs','machines','mold_machine_compatibility','event_attachments','homepage_sections','homepage_section_items',
    'sales_statistics','company_settings'] loop
    execute format('create trigger audit after insert or update or delete on public.%I for each row execute function private.audit_change()',t);
  end loop;
end $$;

-- Transactional access-management RPC. This cannot be used by ordinary admins.
create function public.set_staff_access(target_user_id uuid, role_name text, active boolean, extra_permissions text[] default '{}')
returns void language plpgsql security definer set search_path='' as $$
declare selected_role uuid;
begin
  if not private.is_super_admin() then raise exception 'Super admin required' using errcode='42501'; end if;
  perform pg_advisory_xact_lock(71490002);
  if target_user_id=auth.uid() then raise exception 'Self-demotion or self-disable is not allowed' using errcode='23514'; end if;
  select id into selected_role from public.roles where name=role_name;
  if selected_role is null then raise exception 'Unknown role' using errcode='23514'; end if;
  if not exists(select 1 from public.profiles where id=target_user_id) then raise exception 'Invite and provision staff profile first' using errcode='23514'; end if;
  update public.profiles set is_active=active,updated_at=now() where id=target_user_id;
  delete from public.user_roles where user_id=target_user_id;
  insert into public.user_roles(user_id,role_id) values(target_user_id,selected_role);
  delete from public.user_permissions where user_id=target_user_id;
  insert into public.user_permissions(user_id,permission_key) select target_user_id,unnest(extra_permissions);
end $$;
-- One-time setup; execute through a trusted service client, never expose its key.
create function public.bootstrap_super_admin(target_user_id uuid, staff_name text)
returns void language plpgsql security definer set search_path='' as $$
begin
  perform pg_advisory_xact_lock(71490002);
  if exists(select 1 from public.user_roles ur join public.roles r on r.id=ur.role_id where r.name='super_admin') then
    raise exception 'Super admin already bootstrapped' using errcode='23514';
  end if;
  insert into public.profiles(id,display_name) values(target_user_id,staff_name);
  insert into public.user_roles(user_id,role_id) select target_user_id,id from public.roles where name='super_admin';
end $$;
create function public.set_mold_archived(target_mold_id uuid, archived boolean) returns void
language plpgsql security definer set search_path='' as $$
declare state public.publication_status;
begin
  if not private.has_permission('molds.archive') then raise exception 'molds.archive required' using errcode='42501'; end if;
  select publication_status into state from public.molds where id=target_mold_id for update;
  if not found then raise exception 'Mold not found' using errcode='P0002'; end if;
  if not archived and state='published' and not private.has_permission('content.publish') then
    raise exception 'content.publish required to restore a published listing' using errcode='42501';
  end if;
  update public.molds set deleted_at=case when archived then now() else null end where id=target_mold_id;
end $$;

create function private.initialize_mold_children() returns trigger language plpgsql security definer set search_path='' as $$
begin
  insert into public.mold_specifications(mold_id) values(new.id);
  insert into public.mold_internal_details(mold_id) values(new.id);
  return new;
end $$;
create trigger initialize_mold_children after insert on public.molds for each row execute function private.initialize_mold_children();

revoke all on all functions in schema private from public,anon,authenticated;
grant usage on schema private to authenticated,service_role;
grant execute on all functions in schema private to service_role;
grant execute on function private.has_permission(text),private.is_staff(),private.is_super_admin(),private.is_service() to authenticated;
revoke all on function public.set_staff_access(uuid,text,boolean,text[]),public.bootstrap_super_admin(uuid,text),public.set_mold_archived(uuid,boolean) from public,anon,authenticated;
grant execute on function public.set_staff_access(uuid,text,boolean,text[]),public.set_mold_archived(uuid,boolean) to authenticated;
grant execute on function public.bootstrap_super_admin(uuid,text) to service_role;
commit;
