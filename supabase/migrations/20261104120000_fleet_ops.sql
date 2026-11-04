-- Fleet operations: vehicle documents with expiry, vehicle handovers, maintenance plans by km and time,
-- work orders, a spare-parts store, driver files and violations, places on the map (factory, warehouses,
-- customers) with visits, and one alerts feed for the workspace bell.
-- Additive and idempotent: it creates objects only, so it can be applied through the SQL editor.
begin;

create table if not exists public.vehicle_documents (
  id uuid primary key default gen_random_uuid(),
  vehicle_id uuid not null references public.vehicles(id) on delete cascade,
  kind text not null check (kind in ('license','insurance','inspection','permit','other')),
  title text check (length(title) <= 120),
  number text check (length(number) <= 80),
  issued_on date,
  expires_on date,
  cost numeric(12,2) check (cost >= 0),
  file_key text check (file_key is null or file_key like 'fleet/'||vehicle_id::text||'/%'),
  notes text check (length(notes) <= 1000),
  created_at timestamptz not null default now(),
  created_by uuid references public.profiles(id) default auth.uid(),
  check (expires_on is null or issued_on is null or expires_on >= issued_on)
);
create index if not exists vehicle_documents_vehicle on public.vehicle_documents(vehicle_id,kind,expires_on desc);

-- Who had the vehicle and when; the open row (ended_on null) is the current driver.
create table if not exists public.vehicle_assignments (
  id uuid primary key default gen_random_uuid(),
  vehicle_id uuid not null references public.vehicles(id) on delete cascade,
  driver_id uuid references public.profiles(id),
  driver_name text check (length(driver_name) <= 120),
  started_on date not null default current_date,
  ended_on date,
  odometer_start numeric(10,1) check (odometer_start >= 0),
  odometer_end numeric(10,1) check (odometer_end >= 0),
  notes text check (length(notes) <= 1000),
  created_at timestamptz not null default now(),
  check (driver_id is not null or driver_name is not null),
  check (ended_on is null or ended_on >= started_on)
);
create unique index if not exists vehicle_assignments_one_open on public.vehicle_assignments(vehicle_id) where ended_on is null;
create index if not exists vehicle_assignments_driver on public.vehicle_assignments(driver_id);

-- A recurring service. It applies to one vehicle, to every vehicle of a type, or (both empty) to every vehicle.
-- The last service is the latest expense in `category` (and, when set, whose part name contains part_keyword).
create table if not exists public.maintenance_plans (
  id uuid primary key default gen_random_uuid(),
  item text not null check (length(btrim(item)) between 1 and 80),
  category text not null check (category in ('oil_change','maintenance','spare_part','tires','battery','other')),
  part_keyword text check (length(part_keyword) <= 60),
  vehicle_id uuid references public.vehicles(id) on delete cascade,
  type_id uuid references public.vehicle_types(id) on delete cascade,
  every_km integer check (every_km between 100 and 500000),
  every_days integer check (every_days between 7 and 3650),
  notes text check (length(notes) <= 500),
  created_at timestamptz not null default now(),
  check (every_km is not null or every_days is not null)
);

create table if not exists public.work_orders (
  id uuid primary key default gen_random_uuid(),
  number integer generated always as identity,
  vehicle_id uuid not null references public.vehicles(id) on delete cascade,
  title text not null check (length(btrim(title)) between 1 and 160),
  description text check (length(description) <= 2000),
  category text not null default 'maintenance' check (category in ('oil_change','maintenance','spare_part','tires','battery','other')),
  status text not null default 'open' check (status in ('open','in_progress','done','cancelled')),
  priority text not null default 'normal' check (priority in ('low','normal','high')),
  opened_on date not null default current_date,
  due_on date,
  closed_on date,
  workshop text check (length(workshop) <= 120),
  odometer numeric(10,1) check (odometer >= 0),
  labor_cost numeric(12,2) not null default 0 check (labor_cost >= 0),
  expense_id uuid references public.vehicle_expenses(id) on delete set null,
  created_at timestamptz not null default now(),
  created_by uuid references public.profiles(id) default auth.uid()
);
create index if not exists work_orders_vehicle on public.work_orders(vehicle_id,status);

create table if not exists public.parts (
  id uuid primary key default gen_random_uuid(),
  name text not null check (length(btrim(name)) between 1 and 120),
  sku text check (length(sku) <= 60),
  unit text not null default 'قطعة' check (length(unit) <= 20),
  qty numeric(12,2) not null default 0,
  min_qty numeric(12,2) not null default 0 check (min_qty >= 0),
  unit_cost numeric(12,2) check (unit_cost >= 0),
  location text check (length(location) <= 80),
  notes text check (length(notes) <= 500),
  created_at timestamptz not null default now()
);
create unique index if not exists parts_sku on public.parts(lower(sku)) where sku is not null;

-- Stock in, stock out (to a vehicle or a work order) and corrections. Quantities are always positive;
-- `kind` gives the direction. The part's stock follows automatically.
create table if not exists public.part_movements (
  id uuid primary key default gen_random_uuid(),
  part_id uuid not null references public.parts(id) on delete cascade,
  kind text not null check (kind in ('in','out','adjust')),
  qty numeric(12,2) not null check (qty <> 0),
  unit_cost numeric(12,2) check (unit_cost >= 0),
  vehicle_id uuid references public.vehicles(id) on delete set null,
  work_order_id uuid references public.work_orders(id) on delete set null,
  moved_on date not null default current_date,
  supplier text check (length(supplier) <= 120),
  notes text check (length(notes) <= 500),
  created_at timestamptz not null default now(),
  created_by uuid references public.profiles(id) default auth.uid(),
  check (kind = 'adjust' or qty > 0)
);
create index if not exists part_movements_part on public.part_movements(part_id,moved_on desc);
create index if not exists part_movements_work_order on public.part_movements(work_order_id);

create or replace function private.apply_part_movement() returns trigger language plpgsql security definer set search_path='' as $$
begin
  if tg_op in ('UPDATE','DELETE') then
    update public.parts set qty=qty-(case old.kind when 'in' then old.qty when 'out' then -old.qty else old.qty end) where id=old.part_id;
  end if;
  if tg_op in ('INSERT','UPDATE') then
    update public.parts set qty=qty+(case new.kind when 'in' then new.qty when 'out' then -new.qty else new.qty end),
      unit_cost=case when new.kind='in' and new.unit_cost is not null then new.unit_cost else unit_cost end where id=new.part_id;
    return new;
  end if;
  return old;
end $$;
do $$ begin
  if not exists(select 1 from pg_trigger where tgname='part_stock' and tgrelid='public.part_movements'::regclass) then
    create trigger part_stock after insert or update or delete on public.part_movements for each row execute function private.apply_part_movement();
  end if;
end $$;

create table if not exists public.driver_profiles (
  profile_id uuid primary key references public.profiles(id) on delete cascade,
  phone text check (length(phone) <= 30),
  license_number text check (length(license_number) <= 40),
  license_class text check (length(license_class) <= 40),
  license_expires_on date,
  national_id text check (length(national_id) <= 20),
  hired_on date,
  notes text check (length(notes) <= 1000),
  updated_at timestamptz not null default now()
);

create table if not exists public.driver_violations (
  id uuid primary key default gen_random_uuid(),
  profile_id uuid references public.profiles(id) on delete set null,
  driver_name text check (length(driver_name) <= 120),
  vehicle_id uuid references public.vehicles(id) on delete set null,
  happened_on date not null default current_date,
  kind text not null check (kind in ('speeding','traffic_fine','accident','damage','late','other')),
  amount numeric(12,2) check (amount >= 0),
  notes text check (length(notes) <= 1000),
  file_key text check (file_key is null or (vehicle_id is not null and file_key like 'fleet/'||vehicle_id::text||'/%')),
  created_at timestamptz not null default now(),
  created_by uuid references public.profiles(id) default auth.uid(),
  check (profile_id is not null or driver_name is not null)
);
create index if not exists driver_violations_profile on public.driver_violations(profile_id,happened_on desc);

-- Places on the map. A rep "visits" a place when they stay inside its radius for at least 3 minutes.
create table if not exists public.places (
  id uuid primary key default gen_random_uuid(),
  name text not null check (length(btrim(name)) between 1 and 120),
  kind text not null default 'customer' check (kind in ('factory','warehouse','customer','supplier','other')),
  lat double precision not null check (lat between -90 and 90),
  lng double precision not null check (lng between -180 and 180),
  radius_m integer not null default 150 check (radius_m between 20 and 5000),
  address text check (length(address) <= 300),
  phone text check (length(phone) <= 30),
  notes text check (length(notes) <= 1000),
  is_active boolean not null default true,
  created_at timestamptz not null default now()
);
create index if not exists places_lat on public.places(lat);

-- Access: fleet.view reads, fleet.manage writes. Places are also readable by tracking.view.
do $$ declare t text; begin
  foreach t in array array['vehicle_documents','vehicle_assignments','maintenance_plans','work_orders','parts','part_movements','driver_profiles','driver_violations','places'] loop
    execute format('alter table public.%I enable row level security',t);
    execute format('revoke all on public.%I from public,anon',t);
    execute format('grant select,insert,update,delete on public.%I to authenticated',t);
    execute format('grant all on public.%I to service_role',t);
    if not exists(select 1 from pg_policies where schemaname='public' and tablename=t and policyname='fleet_ops_read') then
      execute format('create policy fleet_ops_read on public.%I for select to authenticated using((select private.has_permission(''fleet.view''))%s)',t,
        case when t='places' then ' or (select private.has_permission(''tracking.view''))' else '' end);
    end if;
    if not exists(select 1 from pg_policies where schemaname='public' and tablename=t and policyname='fleet_ops_write') then
      execute format('create policy fleet_ops_write on public.%I for all to authenticated using((select private.has_permission(''fleet.manage''))) with check((select private.has_permission(''fleet.manage'')))',t);
    end if;
    if t not in ('part_movements','places','driver_profiles') and not exists(select 1 from pg_trigger where tgname='audit' and tgrelid=format('public.%I',t)::regclass) then
      execute format('create trigger audit after insert or update or delete on public.%I for each row execute function private.audit_change()',t);
    end if;
  end loop;
end $$;

-- Starting plans for the usual services; managers change them from the workspace.
insert into public.maintenance_plans(item,category,part_keyword,every_km,every_days)
select * from (values ('تغيير زيت','oil_change',null,5000,120),('فلتر هواء','spare_part','هواء',15000,365),
  ('كاوتش','tires',null,40000,null),('بطارية','battery',null,null,730),('فرامل','spare_part','فرامل',30000,null)) v(i,c,k,km,d)
where not exists(select 1 from public.maintenance_plans);

-- Status of every plan on every vehicle it applies to: last service, next due and how close it is.
create or replace function public.fleet_maintenance_status() returns table(
  vehicle_id uuid, plate_number text, plan_id uuid, item text, category text, every_km integer, every_days integer,
  last_date date, last_odometer numeric, odometer numeric, km_since numeric, days_since integer,
  due_km numeric, due_date date, ratio numeric, status text)
language sql stable security definer set search_path='' as $$
  with l as (
    select v.id vid,v.plate_number,p.id pid,p.item,p.category,p.every_km,p.every_days,private.vehicle_odometer(v.id) odo,last.expense_date ld,last.odometer lo
    from public.vehicles v join public.maintenance_plans p
      on (p.vehicle_id=v.id) or (p.vehicle_id is null and (p.type_id is null or p.type_id=v.type_id))
    left join lateral (select e.expense_date,e.odometer from public.vehicle_expenses e
        where e.vehicle_id=v.id and (p.category='other' or e.category=p.category)
          and (p.part_keyword is null or e.part_name ilike '%'||p.part_keyword||'%' or e.description ilike '%'||p.part_keyword||'%')
        order by e.expense_date desc,e.odometer desc nulls last limit 1) last on true
    where v.status<>'inactive' and private.has_permission('fleet.view'))
  select vid,plate_number,pid,item,category,every_km,every_days,ld,lo,odo,
    case when lo is not null then odo-lo end,
    case when ld is not null then current_date-ld end,
    case when lo is not null and every_km is not null then lo+every_km end,
    case when ld is not null and every_days is not null then ld+every_days end,
    round(greatest(case when lo is not null and every_km is not null then (odo-lo)/every_km end,
                   case when ld is not null and every_days is not null then (current_date-ld)::numeric/every_days end),2),
    case when ld is null and lo is null then 'unknown'
         when greatest(case when lo is not null and every_km is not null then (odo-lo)/every_km end,
                       case when ld is not null and every_days is not null then (current_date-ld)::numeric/every_days end)>=1 then 'due'
         when greatest(case when lo is not null and every_km is not null then (odo-lo)/every_km end,
                       case when ld is not null and every_days is not null then (current_date-ld)::numeric/every_days end)>=0.85 then 'soon'
         else 'ok' end
  from l
$$;

-- Everything that needs attention, newest problems first, for the workspace bell and the overview.
create or replace function public.fleet_alerts() returns jsonb language plpgsql stable security definer set search_path='' as $$
begin
  if not private.has_permission('fleet.view') then return '[]'::jsonb; end if;
  return coalesce((select jsonb_agg(a order by (a->>'severity')='high' desc,a->>'due') from (
    -- latest document of each kind per vehicle
    select jsonb_build_object('kind','document','severity',case when d.expires_on<current_date then 'high' else 'medium' end,
      'doc_kind',d.kind,'title',d.title,'vehicle_id',d.vehicle_id,'plate_number',v.plate_number,'due',d.expires_on,'days',d.expires_on-current_date) a
    from (select distinct on (vehicle_id,kind) * from public.vehicle_documents where expires_on is not null order by vehicle_id,kind,expires_on desc) d
    join public.vehicles v on v.id=d.vehicle_id where v.status<>'inactive' and d.expires_on<=current_date+30
    union all
    select jsonb_build_object('kind','maintenance','severity',case when m.status='due' then 'high' else 'medium' end,'item',m.item,
      'vehicle_id',m.vehicle_id,'plate_number',m.plate_number,'due',coalesce(m.due_date,current_date),'km_left',m.due_km-m.odometer,'days',m.due_date-current_date)
    from public.fleet_maintenance_status() m where m.status in ('due','soon')
    union all
    select jsonb_build_object('kind','license','severity',case when dp.license_expires_on<current_date then 'high' else 'medium' end,
      'driver_id',dp.profile_id,'driver_name',p.display_name,'due',dp.license_expires_on,'days',dp.license_expires_on-current_date)
    from public.driver_profiles dp join public.profiles p on p.id=dp.profile_id where p.is_active and dp.license_expires_on<=current_date+30
    union all
    select jsonb_build_object('kind','stock','severity',case when qty<=0 then 'high' else 'medium' end,'part_id',id,'name',name,'qty',qty,'min_qty',min_qty,'due',current_date)
    from public.parts where qty<=min_qty and min_qty>0
    union all
    select jsonb_build_object('kind','work_order','severity','medium','work_order_id',w.id,'number',w.number,'title',w.title,'vehicle_id',w.vehicle_id,'plate_number',v.plate_number,'due',w.due_on,'days',w.due_on-current_date)
    from public.work_orders w join public.vehicles v on v.id=w.vehicle_id where w.status in ('open','in_progress') and w.due_on<current_date
  ) x),'[]'::jsonb);
end $$;

-- Closing a work order records its cost (labour + parts used) as one vehicle expense.
create or replace function public.close_work_order(target uuid,odometer_now numeric default null) returns uuid language plpgsql security definer set search_path='' as $$
declare w public.work_orders; parts_total numeric; expense uuid;
begin
  if not private.has_permission('fleet.manage') then raise exception 'fleet.manage required' using errcode='42501'; end if;
  select * into w from public.work_orders where id=target for update;
  if not found then raise exception 'Work order not found'; end if;
  if w.status='done' then return w.expense_id; end if;
  select coalesce(sum(qty*coalesce(unit_cost,0)),0) into parts_total from public.part_movements where work_order_id=target and kind='out';
  if w.labor_cost+parts_total>0 then
    insert into public.vehicle_expenses(vehicle_id,expense_date,category,part_name,amount,odometer,workshop,description,created_by)
    values(w.vehicle_id,current_date,case when w.category='other' then 'maintenance' else w.category end,
      case when w.category='spare_part' then left(w.title,120) end,w.labor_cost+parts_total,coalesce(odometer_now,w.odometer),w.workshop,
      left('أمر شغل #'||w.number||' — '||w.title||coalesce(E'\n'||w.description,''),1000),auth.uid())
    returning id into expense;
  end if;
  update public.work_orders set status='done',closed_on=current_date,odometer=coalesce(odometer_now,odometer),expense_id=expense where id=target;
  return expense;
end $$;

-- Visits: runs of consecutive points of one rep inside a place's radius lasting at least 3 minutes.
create or replace function public.tracking_visits(from_date date,to_date date,rep uuid default null) returns jsonb language plpgsql stable security definer set search_path='' as $$
begin
  if not (private.has_permission('tracking.view') or private.has_permission('fleet.view')) then raise exception 'tracking.view required' using errcode='42501'; end if;
  return coalesce((select jsonb_agg(v order by v->>'arrived_at') from (
    with pts as (
      select l.rep_id,l.shift_id,l.recorded_at,pl.id place_id
      from public.rep_locations l
      left join lateral (select p.id from public.places p
        where p.is_active and p.lat between l.lat-p.radius_m/111000.0 and l.lat+p.radius_m/111000.0
          and private.meters(l.lat,l.lng,p.lat,p.lng)<=p.radius_m
        order by private.meters(l.lat,l.lng,p.lat,p.lng) limit 1) pl on true
      where l.recorded_at>=(from_date::timestamp at time zone 'Africa/Cairo') and l.recorded_at<((to_date+1)::timestamp at time zone 'Africa/Cairo')
        and (rep is null or l.rep_id=rep) and coalesce(l.accuracy,0)<=100),
    runs as (select *,row_number() over (partition by shift_id order by recorded_at)-row_number() over (partition by shift_id,place_id order by recorded_at) grp from pts),
    visits as (select rep_id,shift_id,place_id,min(recorded_at) a,max(recorded_at) b from runs where place_id is not null group by rep_id,shift_id,place_id,grp)
    select jsonb_build_object('rep_id',vi.rep_id,'rep_name',pr.display_name,'shift_id',vi.shift_id,'place_id',vi.place_id,'place_name',p.name,'place_kind',p.kind,
      'arrived_at',vi.a,'left_at',vi.b,'minutes',round(extract(epoch from vi.b-vi.a)/60)) v
    from visits vi join public.places p on p.id=vi.place_id join public.profiles pr on pr.id=vi.rep_id
    where vi.b-vi.a>=interval '3 minutes') x),'[]'::jsonb);
end $$;

do $$ declare f text; begin
  foreach f in array array['public.fleet_maintenance_status()','public.fleet_alerts()','public.close_work_order(uuid,numeric)','public.tracking_visits(date,date,uuid)'] loop
    execute format('revoke all on function %s from public,anon',f);
    execute format('grant execute on function %s to authenticated',f);
  end loop;
  execute 'revoke all on function private.apply_part_movement() from public,anon,authenticated';
end $$;

commit;
