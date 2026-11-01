-- Fleet: vehicles, fuel logs with odometer readings and photos, and every vehicle expense (maintenance,
-- oil changes, spare parts, licences...). Staff only; nothing here is visible to the public catalog.
-- Idempotent and non-destructive so it can be applied through the SQL editor.
begin;

insert into public.permissions(key,description) values
 ('fleet.view','Read vehicles, fuel logs, expenses and fleet analytics'),
 ('fleet.log','Record fuel fills and vehicle expenses'),
 ('fleet.manage','Manage vehicles and vehicle types, correct or delete fleet records')
on conflict(key) do nothing;
insert into public.role_permissions(role_id,permission_key)
select r.id,p.key from public.roles r join public.permissions p on p.key in ('fleet.view','fleet.log','fleet.manage')
where r.name in ('super_admin','admin')
   or (r.name='supervisor' and p.key in ('fleet.view','fleet.log'))
   or (r.name='viewer' and p.key='fleet.view')
on conflict do nothing;

-- Each type carries what a normal vehicle of that kind does, so every fill is judged against its own type.
create table if not exists public.vehicle_types (
  id uuid primary key default gen_random_uuid(),
  name_ar text not null check (length(btrim(name_ar)) between 1 and 80),
  name_en text not null check (length(btrim(name_en)) between 1 and 80),
  fuel text not null default 'diesel' check (fuel in ('diesel','petrol')),
  expected_km_per_liter numeric(6,2) not null check (expected_km_per_liter > 0 and expected_km_per_liter < 200),
  tolerance_percent integer not null default 15 check (tolerance_percent between 1 and 80),
  oil_change_km integer not null default 5000 check (oil_change_km between 500 and 100000),
  oil_change_days integer not null default 120 check (oil_change_days between 7 and 730),
  created_at timestamptz not null default now()
);
create unique index if not exists vehicle_types_name_ar on public.vehicle_types(lower(btrim(name_ar)));

create table if not exists public.vehicles (
  id uuid primary key default gen_random_uuid(),
  plate_number text not null check (length(btrim(plate_number)) between 2 and 30 and plate_number=btrim(plate_number)),
  type_id uuid not null references public.vehicle_types(id) on delete restrict,
  model text check (length(model) <= 120),
  model_year integer check (model_year between 1970 and 2100),
  driver_name text check (length(driver_name) <= 120),
  status text not null default 'active' check (status in ('active','maintenance','inactive')),
  initial_odometer numeric(10,1) not null default 0 check (initial_odometer >= 0),
  notes text check (length(notes) <= 2000),
  created_at timestamptz not null default now(),
  created_by uuid references public.profiles(id) on delete restrict default auth.uid()
);
create unique index if not exists vehicles_plate on public.vehicles(lower(regexp_replace(plate_number,'\s+','','g')));
create index if not exists vehicles_type on public.vehicles(type_id);

-- One fill: the odometer before and after the trip, the litres put in, and a photo of each reading.
create table if not exists public.fuel_logs (
  id uuid primary key default gen_random_uuid(),
  vehicle_id uuid not null references public.vehicles(id) on delete restrict,
  log_date date not null default current_date check (log_date <= current_date + 1),
  odometer_start numeric(10,1) not null check (odometer_start >= 0),
  odometer_end numeric(10,1) not null,
  liters numeric(8,2) not null check (liters > 0 and liters <= 2000),
  price_per_liter numeric(8,2) check (price_per_liter > 0 and price_per_liter < 1000),
  distance_km numeric(10,1) generated always as (odometer_end - odometer_start) stored,
  km_per_liter numeric(8,2) generated always as (round((odometer_end - odometer_start) / liters, 2)) stored,
  total_cost numeric(12,2) generated always as (round(liters * price_per_liter, 2)) stored,
  station text check (length(station) <= 120),
  driver_name text check (length(driver_name) <= 120),
  notes text check (length(notes) <= 1000),
  photo_start_key text, photo_end_key text,
  created_at timestamptz not null default now(),
  created_by uuid references public.profiles(id) on delete restrict default auth.uid(),
  check (odometer_end > odometer_start and odometer_end - odometer_start <= 20000),
  check (photo_start_key is null or photo_start_key like 'fleet/'||vehicle_id::text||'/%'),
  check (photo_end_key is null or photo_end_key like 'fleet/'||vehicle_id::text||'/%')
);
create index if not exists fuel_logs_vehicle_date on public.fuel_logs(vehicle_id,log_date desc,odometer_end desc);
create index if not exists fuel_logs_created_by on public.fuel_logs(created_by);

-- Every other cost. Service categories (oil change, maintenance, spare part, tyres) form the vehicle's service history.
create table if not exists public.vehicle_expenses (
  id uuid primary key default gen_random_uuid(),
  vehicle_id uuid not null references public.vehicles(id) on delete restrict,
  expense_date date not null default current_date check (expense_date <= current_date + 1),
  category text not null check (category in ('oil_change','maintenance','spare_part','tires','battery','license','insurance','fines','washing','tolls','other')),
  part_name text check (length(btrim(part_name)) between 1 and 120),
  amount numeric(12,2) not null check (amount >= 0 and amount < 10000000),
  odometer numeric(10,1) check (odometer >= 0),
  workshop text check (length(workshop) <= 120),
  description text check (length(description) <= 1000),
  photo_key text check (photo_key is null or photo_key like 'fleet/'||vehicle_id::text||'/%'),
  created_at timestamptz not null default now(),
  created_by uuid references public.profiles(id) on delete restrict default auth.uid(),
  check (category <> 'spare_part' or part_name is not null),
  check (category <> 'oil_change' or odometer is not null)
);
create index if not exists vehicle_expenses_vehicle_date on public.vehicle_expenses(vehicle_id,expense_date desc);
create index if not exists vehicle_expenses_created_by on public.vehicle_expenses(created_by);

alter table public.vehicle_types enable row level security;
alter table public.vehicles enable row level security;
alter table public.fuel_logs enable row level security;
alter table public.vehicle_expenses enable row level security;
revoke all on public.vehicle_types,public.vehicles,public.fuel_logs,public.vehicle_expenses from public,anon;
grant select,insert,update,delete on public.vehicle_types,public.vehicles,public.fuel_logs,public.vehicle_expenses to authenticated;
grant all on public.vehicle_types,public.vehicles,public.fuel_logs,public.vehicle_expenses to service_role;

do $$ declare t text; begin
  foreach t in array array['vehicle_types','vehicles','fuel_logs','vehicle_expenses'] loop
    execute format('drop policy if exists fleet_read on public.%I',t);
    execute format('create policy fleet_read on public.%I for select to authenticated using((select private.has_permission(''fleet.view'')))',t);
    execute format('drop policy if exists fleet_update on public.%I',t);
    execute format('create policy fleet_update on public.%I for update to authenticated using((select private.has_permission(''fleet.manage''))) with check((select private.has_permission(''fleet.manage'')))',t);
    execute format('drop policy if exists fleet_delete on public.%I',t);
    execute format('create policy fleet_delete on public.%I for delete to authenticated using((select private.has_permission(''fleet.manage'')))',t);
    execute format('drop trigger if exists audit on public.%I',t);
    execute format('create trigger audit after insert or update or delete on public.%I for each row execute function private.audit_change()',t);
  end loop;
end $$;
drop policy if exists fleet_insert on public.vehicle_types;
create policy fleet_insert on public.vehicle_types for insert to authenticated with check((select private.has_permission('fleet.manage')));
drop policy if exists fleet_insert on public.vehicles;
create policy fleet_insert on public.vehicles for insert to authenticated with check((select private.has_permission('fleet.manage')));
-- Records are logged in the logger's own name.
drop policy if exists fleet_insert on public.fuel_logs;
create policy fleet_insert on public.fuel_logs for insert to authenticated with check((select private.has_permission('fleet.log')) and created_by=(select auth.uid()));
drop policy if exists fleet_insert on public.vehicle_expenses;
create policy fleet_insert on public.vehicle_expenses for insert to authenticated with check((select private.has_permission('fleet.log')) and created_by=(select auth.uid()));

-- Odometer photos and receipts live in the private factory bucket under fleet/<vehicle id>/.
create or replace function private.can_access_object(bucket text, object_name text, writing boolean) returns boolean
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
  elsif kind='fleet' and bucket='factory-files' then
    return private.has_permission(case when writing then 'fleet.log' else 'fleet.view' end)
      and exists(select 1 from public.vehicles where id=entity_id);
  end if;
  return false;
end $$;

-- Starting values for the two kinds of vehicle in use; managers adjust them from the workspace.
insert into public.vehicle_types(name_ar,name_en,fuel,expected_km_per_liter,tolerance_percent,oil_change_km,oil_change_days)
select * from (values ('دوبل كابينة','Double cab','diesel',9.0,15,5000,120),('دبابة','Dababa','diesel',25.0,20,3000,90)) v(a,e,f,k,t,o,d)
where not exists(select 1 from public.vehicle_types)
on conflict do nothing;
commit;
