begin;
-- Both buckets are private, even catalog-media. Draft/unapproved images never
-- become world-readable through a raw Storage URL. The future server media
-- endpoint must resolve a catalog_images/catalog_documents allowlist row first.
insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types) values
('catalog-media','catalog-media',false,20971520,array['image/jpeg','image/png','image/webp','application/pdf']),
('factory-files','factory-files',false,20971520,array['image/jpeg','image/png','image/webp','application/pdf','application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'])
on conflict(id) do nothing;

create function private.safe_uuid(value text) returns uuid language plpgsql immutable set search_path='' as $$
begin return value::uuid; exception when invalid_text_representation then return null; end $$;
create function private.can_access_object(bucket text, object_name text, writing boolean) returns boolean
language plpgsql stable security definer set search_path='' as $$
declare kind text:=split_part(object_name,'/',1); entity_id uuid:=private.safe_uuid(split_part(object_name,'/',2));
begin
  if not private.is_staff() or entity_id is null or split_part(object_name,'/',3)='' or
     object_name like '%..%' or object_name like '%//%' then return false; end if;
  if kind='molds' and exists(select 1 from public.molds where id=entity_id and deleted_at is null) then
    if bucket='catalog-media' then
      return private.has_permission(case when writing then 'media.manage' else 'molds.view' end);
    elsif bucket='factory-files' then
      return private.has_permission(case when writing then 'media.manage' else 'molds.view' end);
    end if;
  elsif kind='categories' and bucket='catalog-media' then
    return private.has_permission('categories.manage') and exists(select 1 from public.categories where id=entity_id);
  elsif kind='maintenance' and bucket='factory-files' then
    return private.has_permission(case when writing then 'maintenance.create' else 'maintenance.view' end)
      and exists(select 1 from public.maintenance_records where id=entity_id);
  elsif kind='chrome' and bucket='factory-files' then
    return private.has_permission(case when writing then 'chrome.create' else 'chrome.view' end)
      and exists(select 1 from public.chrome_records where id=entity_id);
  end if;
  return false;
end $$;
create policy gd_storage_read on storage.objects for select to authenticated
using(private.can_access_object(bucket_id,name,false));
create policy gd_storage_upload on storage.objects for insert to authenticated
with check(private.can_access_object(bucket_id,name,true));
-- Deliberately no UPDATE/DELETE policy. Unique object keys + upsert:false avoid
-- replacing approved images or destroying historical event attachments.

create function private.guard_event_attachment() returns trigger language plpgsql set search_path='' as $$
begin
  if new.maintenance_id is not null and new.storage_key not like 'maintenance/'||new.maintenance_id::text||'/%' then
    raise exception 'Attachment path must match maintenance event' using errcode='23514';
  end if;
  if new.chrome_id is not null and new.storage_key not like 'chrome/'||new.chrome_id::text||'/%' then
    raise exception 'Attachment path must match chrome event' using errcode='23514';
  end if;
  return new;
end $$;
create trigger event_attachment_path before insert on public.event_attachments for each row execute function private.guard_event_attachment();
revoke all on function private.safe_uuid(text),private.can_access_object(text,text,boolean),private.guard_event_attachment() from public,anon,authenticated;
grant execute on function private.can_access_object(text,text,boolean) to authenticated;
commit;
