-- Small WebP copies of public R2 catalog images for grids and lists; the full image stays in storage_key.
-- Idempotent so it can be applied through the SQL editor or `supabase db push`.
begin;
alter table public.mold_images add column if not exists thumb_key text;
alter table public.mold_images drop constraint if exists mold_images_thumb_key;
alter table public.mold_images add constraint mold_images_thumb_key check (thumb_key is null or
  (bucket_id='r2' and thumb_key like 'molds/'||mold_id::text||'/%' and thumb_key not like '%..%' and thumb_key<>storage_key));
create or replace view public.catalog_images with(security_barrier=true) as
select i.id,i.mold_id,i.bucket_id,i.storage_key,i.image_type,i.alt_ar,i.alt_en,i.display_order,i.is_main,i.thumb_key
from public.mold_images i join public.catalog_molds m on m.id=i.mold_id
where i.visibility='public' and i.is_approved and i.bucket_id in ('catalog-media','r2');
commit;
