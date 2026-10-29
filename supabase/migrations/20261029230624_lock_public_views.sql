-- The catalog projections were created after the blanket revoke in the security migration, so Supabase's
-- default privileges granted anon/authenticated ALL on them. Simple projections (catalog_company,
-- catalog_categories, catalog_homepage_sections) are auto-updatable and run as their owner, which let any
-- visitor UPDATE/INSERT/DELETE company settings, categories and homepage sections through the REST API.
begin;
revoke all on public.catalog_molds,public.catalog_categories,public.catalog_mold_categories,public.catalog_colors,
  public.catalog_images,public.catalog_documents,public.catalog_homepage_sections,public.catalog_company from public,anon,authenticated;
grant select on public.catalog_molds,public.catalog_categories,public.catalog_mold_categories,public.catalog_colors,
  public.catalog_images,public.catalog_documents,public.catalog_homepage_sections,public.catalog_company to anon,authenticated;

-- Future objects get no implicit client privileges; every migration grants exactly what it needs.
alter default privileges in schema public revoke all on tables from anon,authenticated;
alter default privileges in schema public revoke all on sequences from anon,authenticated;
alter default privileges in schema public revoke execute on functions from public,anon,authenticated;
commit;
