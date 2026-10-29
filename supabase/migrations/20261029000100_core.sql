-- GD TABLEWARE INDUSTRY / gd-menu
-- Apply with the Supabase CLI, in timestamp order, to a NEW project.
begin;
create schema if not exists private;
revoke all on schema private from public;
create extension if not exists pg_trgm with schema extensions;

create type public.publication_status as enum ('draft','published','unpublished','archived');
create type public.operational_status as enum ('active','inactive','maintenance','retired');
create type public.event_status as enum ('planned','in_progress','completed','cancelled');
create type public.media_visibility as enum ('public','private');
create type public.collection_type as enum ('manual','latest','most_viewed','most_searched','best_selling','category');

create table public.profiles (
  id uuid primary key references auth.users(id) on delete restrict,
  display_name text not null check (length(btrim(display_name)) between 1 and 150),
  preferred_language text not null default 'ar' check (preferred_language in ('ar','en')),
  is_active boolean not null default true,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);
create table public.roles (
  id uuid primary key default gen_random_uuid(),
  name text not null unique check (name in ('super_admin','admin','supervisor','viewer')),
  name_ar text not null, name_en text not null
);
create table public.permissions (
  key text primary key, description text not null
);
create table public.role_permissions (
  role_id uuid not null references public.roles(id) on delete cascade,
  permission_key text not null references public.permissions(key) on delete cascade,
  primary key (role_id,permission_key)
);
create table public.user_roles (
  user_id uuid not null references public.profiles(id) on delete restrict,
  role_id uuid not null references public.roles(id) on delete restrict,
  primary key(user_id,role_id)
);
-- Additive staff-specific grants; only a super admin may change these.
create table public.user_permissions (
  user_id uuid not null references public.profiles(id) on delete restrict,
  permission_key text not null references public.permissions(key) on delete restrict,
  primary key(user_id,permission_key)
);
create table public.categories (
  id uuid primary key default gen_random_uuid(),
  name_ar text not null check(length(btrim(name_ar)) between 1 and 150),
  name_en text not null check(length(btrim(name_en)) between 1 and 150),
  slug text not null unique check(slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$'),
  description_ar text, description_en text,
  parent_id uuid references public.categories(id) on delete restrict,
  cover_storage_key text,
  display_order integer not null default 0,
  show_on_homepage boolean not null default false, is_active boolean not null default true,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
  check(parent_id is null or parent_id <> id)
);
create table public.colors (
  id uuid primary key default gen_random_uuid(), name_ar text not null, name_en text not null,
  hex text not null check(hex ~ '^#[0-9A-Fa-f]{6}$'), unique(name_en)
);
-- ONLY public-safe attributes live on this record. Still not granted to anon.
create table public.molds (
  id uuid primary key default gen_random_uuid(),
  code text not null check (length(btrim(code)) between 1 and 80),
  name_ar text not null check (length(btrim(name_ar)) between 1 and 200),
  name_en text not null check (length(btrim(name_en)) between 1 and 200),
  description_ar text, description_en text,
  main_category_id uuid references public.categories(id) on delete restrict,
  publication_status public.publication_status not null default 'draft',
  public_availability text, shape text,
  is_new boolean not null default false, is_featured boolean not null default false,
  published_at timestamptz, deleted_at timestamptz,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
  created_by uuid references public.profiles(id) on delete restrict default auth.uid(),
  updated_by uuid references public.profiles(id) on delete restrict default auth.uid(),
  check(publication_status <> 'published' or published_at is not null),
  check (code = btrim(code))
);
create unique index molds_code_unique on public.molds(lower(code));
create index molds_catalog_order on public.molds(published_at desc,id) where publication_status='published' and deleted_at is null;
create index molds_main_category on public.molds(main_category_id);
create index molds_name_ar_search on public.molds using gin(name_ar extensions.gin_trgm_ops);
create index molds_name_en_search on public.molds using gin(name_en extensions.gin_trgm_ops);
create index molds_code_search on public.molds using gin(code extensions.gin_trgm_ops);
create table public.mold_specifications (
  mold_id uuid primary key references public.molds(id) on delete restrict,
  diameter_mm numeric(10,2) check(diameter_mm>0), length_mm numeric(10,2) check(length_mm>0),
  width_mm numeric(10,2) check(width_mm>0), height_mm numeric(10,2) check(height_mm>0),
  depth_mm numeric(10,2) check(depth_mm>0), product_weight_g numeric(10,2) check(product_weight_g>0),
  capacity_ml numeric(12,2) check(capacity_ml>0)
);
create table public.mold_internal_details (
  mold_id uuid primary key references public.molds(id) on delete restrict,
  internal_description text, material text, cavities integer check(cavities>0), mold_type text,
  technical_specifications jsonb not null default '{}' check(jsonb_typeof(technical_specifications)='object'),
  acquisition_date date, first_production_date date,
  operational_status public.operational_status not null default 'active',
  storage_location text, estimated_output_per_hour numeric(14,2) check(estimated_output_per_hour>=0),
  opening_cycles bigint not null default 0 check(opening_cycles>=0),
  chrome_interval_days integer check(chrome_interval_days>0),
  maintenance_interval_days integer check(maintenance_interval_days>0),
  maintenance_interval_cycles bigint check(maintenance_interval_cycles>0),
  opening_cycles_as_of date, internal_notes text,
  check(opening_cycles=0 or opening_cycles_as_of is not null)
);
create table public.mold_categories (
  mold_id uuid not null references public.molds(id) on delete restrict,
  category_id uuid not null references public.categories(id) on delete restrict,
  primary key(mold_id,category_id)
);
create index mold_categories_reverse on public.mold_categories(category_id,mold_id);
create table public.mold_colors (
  mold_id uuid not null references public.molds(id) on delete restrict,
  color_id uuid not null references public.colors(id) on delete restrict,
  primary key(mold_id,color_id)
);
create index mold_colors_reverse on public.mold_colors(color_id,mold_id);
create table public.mold_images (
  id uuid primary key default gen_random_uuid(),
  mold_id uuid not null references public.molds(id) on delete restrict,
  bucket_id text not null, storage_key text not null,
  visibility public.media_visibility not null default 'private',
  is_approved boolean not null default false,
  image_type text not null default 'product' check(image_type in ('product','mold')),
  alt_ar text, alt_en text, display_order integer not null default 0,
  is_main boolean not null default false,
  created_at timestamptz not null default now(),
  unique(bucket_id,storage_key),
  check ((visibility='public' and bucket_id='catalog-media') or (visibility='private' and bucket_id='factory-files')),
  check (storage_key like 'molds/' || mold_id::text || '/%'),
  check(not is_main or (visibility='public' and image_type='product'))
);
create unique index mold_one_main_image on public.mold_images(mold_id) where is_main;
create index mold_images_order on public.mold_images(mold_id,display_order);
create table public.mold_documents (
  id uuid primary key default gen_random_uuid(),
  mold_id uuid not null references public.molds(id) on delete restrict,
  title_ar text not null, title_en text not null,
  bucket_id text not null, storage_key text not null, mime_type text not null,
  visibility public.media_visibility not null default 'private', is_approved boolean not null default false,
  created_at timestamptz not null default now(), unique(bucket_id,storage_key),
  check ((visibility='public' and bucket_id='catalog-media') or (visibility='private' and bucket_id='factory-files')),
  check(storage_key like 'molds/' || mold_id::text || '/%')
);
create index mold_documents_mold on public.mold_documents(mold_id);
create table public.machines (
  id uuid primary key default gen_random_uuid(), code text not null unique, name text not null,
  is_active boolean not null default true, internal_notes text
);
create table public.mold_machine_compatibility (
  mold_id uuid not null references public.molds(id) on delete restrict,
  machine_id uuid not null references public.machines(id) on delete restrict,
  primary key(mold_id,machine_id)
);
create table public.maintenance_records (
  id uuid primary key default gen_random_uuid(),
  mold_id uuid not null references public.molds(id) on delete restrict,
  maintenance_date date not null, maintenance_type text not null,
  reported_problem text, repair_work text, technician_id uuid references public.profiles(id) on delete restrict,
  external_provider text, cost numeric(14,2) not null default 0 check(cost>=0),
  currency text not null default 'EGP' check(currency ~ '^[A-Z]{3}$'),
  downtime_hours numeric(12,2) not null default 0 check(downtime_hours>=0),
  status public.event_status not null default 'planned',
  completed_at timestamptz,
  next_recommended_date date,
  cycles_at_service bigint check(cycles_at_service>=0), notes text,
  created_by uuid references public.profiles(id) on delete restrict default auth.uid(),
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
  check(status <> 'completed' or completed_at is not null),
  check(next_recommended_date is null or next_recommended_date>=maintenance_date)
);
create index maintenance_mold_date on public.maintenance_records(mold_id,maintenance_date desc);
create index maintenance_due on public.maintenance_records(next_recommended_date) where status='completed';
create table public.chrome_records (
  id uuid primary key default gen_random_uuid(),
  mold_id uuid not null references public.molds(id) on delete restrict,
  chrome_date date not null, chrome_type text not null, provider text,
  cost numeric(14,2) not null default 0 check(cost>=0),
  currency text not null default 'EGP' check(currency ~ '^[A-Z]{3}$'),
  status public.event_status not null default 'completed',
  next_expected_date date, notes text,
  created_by uuid references public.profiles(id) on delete restrict default auth.uid(),
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
  check(next_expected_date is null or next_expected_date>=chrome_date)
);
create index chrome_mold_date on public.chrome_records(mold_id,chrome_date desc);
create table public.production_logs (
  id uuid primary key default gen_random_uuid(),
  mold_id uuid not null references public.molds(id) on delete restrict,
  production_date date not null, machine_id uuid references public.machines(id) on delete restrict,
  press_cycles bigint not null check(press_cycles>=0),
  quantity_produced bigint not null check(quantity_produced>=0),
  rejected_quantity bigint not null default 0 check(rejected_quantity>=0 and rejected_quantity<=quantity_produced),
  operator_id uuid references public.profiles(id) on delete restrict, notes text,
  created_by uuid references public.profiles(id) on delete restrict default auth.uid(),
  created_at timestamptz not null default now()
);
create index production_mold_date on public.production_logs(mold_id,production_date desc);
create table public.event_attachments (
  id uuid primary key default gen_random_uuid(),
  maintenance_id uuid references public.maintenance_records(id) on delete restrict,
  chrome_id uuid references public.chrome_records(id) on delete restrict,
  bucket_id text not null default 'factory-files' check(bucket_id='factory-files'),
  storage_key text not null unique,
  kind text not null check(kind in ('before','after','document')), title text,
  created_at timestamptz not null default now(),
  check(num_nonnulls(maintenance_id,chrome_id)=1)
);
create index event_attachments_maintenance on public.event_attachments(maintenance_id);
create index event_attachments_chrome on public.event_attachments(chrome_id);
create table public.homepage_sections (
  id uuid primary key default gen_random_uuid(),
  title_ar text not null, title_en text not null,
  subtitle_ar text, subtitle_en text,
  collection_type public.collection_type not null default 'manual',
  category_id uuid references public.categories(id) on delete restrict,
  display_order integer not null default 0,
  item_limit integer not null default 8 check(item_limit between 1 and 48),
  is_active boolean not null default true, is_published boolean not null default false,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
  check(collection_type<>'category' or category_id is not null)
);
create table public.homepage_section_items (
  section_id uuid not null references public.homepage_sections(id) on delete cascade,
  mold_id uuid not null references public.molds(id) on delete restrict,
  display_order integer not null default 0,
  primary key(section_id,mold_id)
);
-- Analytics ingestion must be implemented by a rate-limited backend; no anonymous table writes.
create table public.mold_views (
  id bigint generated always as identity primary key,
  mold_id uuid not null references public.molds(id) on delete restrict,
  viewed_at timestamptz not null default now(), session_hash text
);
create index mold_views_mold_date on public.mold_views(mold_id,viewed_at desc);
create table public.mold_search_events (
  id bigint generated always as identity primary key,
  query text not null check(length(query)<=200),
  matched_mold_id uuid references public.molds(id) on delete restrict,
  searched_at timestamptz not null default now()
);
create index mold_search_matched on public.mold_search_events(matched_mold_id,searched_at desc);
-- No example sales are inserted. A source reference is required to avoid invented rankings.
create table public.sales_statistics (
  id uuid primary key default gen_random_uuid(),
  mold_id uuid not null references public.molds(id) on delete restrict,
  period_start date not null, period_end date not null check(period_end>=period_start),
  units_sold bigint not null check(units_sold>=0), source_reference text not null check(length(btrim(source_reference))>0),
  created_at timestamptz not null default now(), unique(mold_id,period_start,period_end,source_reference)
);
create index sales_statistics_mold on public.sales_statistics(mold_id);
create table public.notifications (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete restrict,
  title text not null, body text, target_path text check(target_path is null or target_path like '/admin%'),
  read_at timestamptz, created_at timestamptz not null default now()
);
create index notifications_user_unread on public.notifications(user_id,created_at desc) where read_at is null;
create table public.audit_logs (
  id bigint generated always as identity primary key,
  actor_id uuid, action text not null, table_name text not null, record_id text,
  changed_columns text[] not null default '{}', occurred_at timestamptz not null default now()
);
create index audit_logs_date on public.audit_logs(occurred_at desc);
create index audit_logs_record on public.audit_logs(table_name,record_id);
create table public.company_settings (
  id boolean primary key default true check(id),
  company_name_ar text not null default 'جي دي لصناعة أدوات المائدة',
  company_name_en text not null default 'GD TABLEWARE INDUSTRY',
  about_ar text, about_en text, public_email text, public_phone text,
  whatsapp_number text check(whatsapp_number is null or whatsapp_number ~ '^[1-9][0-9]{6,14}$'),
  address_ar text, address_en text,
  logo_path text not null default '/brand/gd-original.jpg',
  updated_at timestamptz not null default now()
);
-- Server-only settings NEVER enter the public company view.
create table private.system_settings (
  key text primary key, value jsonb not null, updated_at timestamptz not null default now()
);
commit;
