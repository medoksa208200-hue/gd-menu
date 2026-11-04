-- Field reps: a "rep" role that signs in from the phone app, work shifts with odometer readings,
-- GPS points recorded during a shift, and a coverage grid that tells which streets are new for each rep.
-- Reps never read the fleet tables directly: every rep action goes through the rep_* functions below,
-- which check the caller's permission and act only on the caller's own shifts.
-- Idempotent and non-destructive so it can be applied through the SQL editor.
begin;

-- The roles table only accepted the four original names.
do $$ declare c record; begin
  for c in select conname from pg_constraint where conrelid='public.roles'::regclass and contype='c' loop
    execute format('alter table public.roles drop constraint %I',c.conname);
  end loop;
end $$;
alter table public.roles add constraint roles_name_check check (name in ('super_admin','admin','supervisor','viewer','rep'));
insert into public.roles(name,name_ar,name_en) values('rep','مندوب','Sales rep') on conflict(name) do nothing;

insert into public.permissions(key,description) values
 ('tracking.log','Use the rep app: shifts, GPS tracking, own fuel fills and expenses'),
 ('tracking.view','See reps on the map, their routes, coverage and shift reports')
on conflict(key) do nothing;
insert into public.role_permissions(role_id,permission_key)
select r.id,p.key from public.roles r join public.permissions p on
  (r.name in ('super_admin','admin','supervisor') and p.key='tracking.view')
  or (r.name='super_admin' and p.key='tracking.log')
  or (r.name='rep' and p.key in ('tracking.log','fleet.log'))
on conflict do nothing;

-- Rep accounts are created by the trusted staff function like every other account.
create or replace function public.provision_staff_account(target_user_id uuid,staff_name text,staff_username text,role_name text) returns void language plpgsql security definer set search_path='' as $$
declare r uuid;
begin
 if role_name not in ('admin','supervisor','viewer','rep') then raise exception 'Invalid staff role'; end if;
 select id into r from public.roles where name=role_name;
 insert into public.profiles(id,display_name,username) values(target_user_id,staff_name,staff_username);
 insert into public.user_roles(user_id,role_id) values(target_user_id,r);
end $$;
revoke all on function public.provision_staff_account(uuid,text,text,text) from public,anon,authenticated;
grant execute on function public.provision_staff_account(uuid,text,text,text) to service_role;

-- One working day of one rep. A rep has at most one open shift.
create table if not exists public.rep_shifts (
  id uuid primary key default gen_random_uuid(),
  rep_id uuid not null references public.profiles(id) on delete restrict,
  vehicle_id uuid references public.vehicles(id) on delete restrict,
  started_at timestamptz not null default now(),
  ended_at timestamptz,
  odometer_start numeric(10,1) check (odometer_start >= 0),
  odometer_end numeric(10,1) check (odometer_end >= 0),
  photo_start_key text, photo_end_key text,
  start_lat double precision, start_lng double precision,
  last_seen_at timestamptz, last_lat double precision, last_lng double precision,
  last_speed real, last_accuracy real,
  points_count integer not null default 0,
  distance_m numeric(12,1) not null default 0,
  new_cells integer not null default 0,
  cells integer not null default 0,
  notes text check (length(notes) <= 1000),
  ended_by text check (ended_by in ('rep','admin')),
  check (ended_at is null or ended_at >= started_at),
  check (odometer_end is null or odometer_start is null or (odometer_end >= odometer_start and odometer_end - odometer_start <= 5000)),
  check (photo_start_key is null or photo_start_key like 'fleet/'||vehicle_id::text||'/%'),
  check (photo_end_key is null or photo_end_key like 'fleet/'||vehicle_id::text||'/%')
);
create unique index if not exists rep_shifts_one_open on public.rep_shifts(rep_id) where ended_at is null;
create index if not exists rep_shifts_rep_started on public.rep_shifts(rep_id,started_at desc);
create index if not exists rep_shifts_started on public.rep_shifts(started_at desc);
create index if not exists rep_shifts_vehicle on public.rep_shifts(vehicle_id);

-- Grid cells (generated columns below) are roughly 150 m × 150 m cells: latitude step 0.00135°, longitude step 0.00155° (at Egyptian latitudes).
create or replace function private.meters(lat1 double precision,lng1 double precision,lat2 double precision,lng2 double precision) returns double precision
language sql immutable parallel safe set search_path='' as $$
  select 2*6371000*asin(least(1,sqrt(power(sin(radians(lat2-lat1)/2),2)+cos(radians(lat1))*cos(radians(lat2))*power(sin(radians(lng2-lng1)/2),2))))
$$;

create table if not exists public.rep_locations (
  id bigint generated always as identity primary key,
  shift_id uuid not null references public.rep_shifts(id) on delete cascade,
  rep_id uuid not null references public.profiles(id) on delete restrict,
  recorded_at timestamptz not null,
  lat double precision not null check (lat between -90 and 90),
  lng double precision not null check (lng between -180 and 180),
  accuracy real check (accuracy >= 0),
  speed real check (speed >= 0),
  heading real,
  cell_x integer generated always as (floor(lng/0.00155)::integer) stored,
  cell_y integer generated always as (floor(lat/0.00135)::integer) stored,
  unique (shift_id,recorded_at)
);
create index if not exists rep_locations_rep_time on public.rep_locations(rep_id,recorded_at);
create index if not exists rep_locations_time on public.rep_locations(recorded_at);

-- Every cell each rep has ever passed through; first_shift_id marks the shift that discovered it.
create table if not exists public.rep_cells (
  rep_id uuid not null references public.profiles(id) on delete restrict,
  cell_x integer not null, cell_y integer not null,
  first_seen_at timestamptz not null,
  last_seen_at timestamptz not null,
  first_shift_id uuid references public.rep_shifts(id) on delete set null,
  hits integer not null default 1,
  primary key (rep_id,cell_x,cell_y)
);
create index if not exists rep_cells_first_shift on public.rep_cells(first_shift_id);
create index if not exists rep_cells_first_seen on public.rep_cells(first_seen_at);

alter table public.rep_shifts enable row level security;
alter table public.rep_locations enable row level security;
alter table public.rep_cells enable row level security;
revoke all on public.rep_shifts,public.rep_locations,public.rep_cells from public,anon,authenticated;
grant all on public.rep_shifts,public.rep_locations,public.rep_cells to service_role;
grant select on public.rep_shifts,public.rep_locations,public.rep_cells to authenticated;
-- Writes happen only through the functions below. Managers read everything; a rep reads only their own rows.
drop policy if exists tracking_read on public.rep_shifts;
create policy tracking_read on public.rep_shifts for select to authenticated using((select private.has_permission('tracking.view')) or rep_id=(select auth.uid()));
drop policy if exists tracking_read on public.rep_locations;
create policy tracking_read on public.rep_locations for select to authenticated using((select private.has_permission('tracking.view')) or rep_id=(select auth.uid()));
drop policy if exists tracking_read on public.rep_cells;
create policy tracking_read on public.rep_cells for select to authenticated using((select private.has_permission('tracking.view')) or rep_id=(select auth.uid()));
-- No audit trigger: shift totals are refreshed with every batch of points.

create or replace function private.require(permission text) returns void language plpgsql stable security definer set search_path='' as $$
begin if not private.has_permission(permission) then raise exception '% required',permission using errcode='42501'; end if; end $$;

-- The last odometer reading known for a vehicle from fills, expenses and shifts.
create or replace function private.vehicle_odometer(target uuid) returns numeric language sql stable security definer set search_path='' as $$
  select greatest(
    (select initial_odometer from public.vehicles where id=target),
    (select max(odometer_end) from public.fuel_logs where vehicle_id=target),
    (select max(odometer) from public.vehicle_expenses where vehicle_id=target),
    (select max(greatest(odometer_start,odometer_end)) from public.rep_shifts where vehicle_id=target))
$$;

-- Distance and cell counts of a shift, recomputed from its points. GPS jitter (moves shorter than half the
-- reported accuracy or 8 m) and impossible jumps (over 60 m/s) are ignored.
create or replace function private.refresh_shift(target uuid) returns void language plpgsql security definer set search_path='' as $$
declare total numeric; n integer; lp record;
begin
  with p as (select recorded_at,lat,lng,accuracy,lag(lat) over w plat,lag(lng) over w plng,lag(recorded_at) over w pt
             from public.rep_locations where shift_id=target and coalesce(accuracy,0)<=100 window w as (order by recorded_at)),
       d as (select private.meters(plat,plng,lat,lng) m,greatest(extract(epoch from recorded_at-pt),1) sec,accuracy from p where plat is not null)
  select coalesce(sum(m) filter(where m>=greatest(coalesce(accuracy,10)*0.5,8) and m/sec<60),0) into total from d;
  select count(*) into n from public.rep_locations where shift_id=target;
  select recorded_at,lat,lng,speed,accuracy into lp from public.rep_locations where shift_id=target order by recorded_at desc limit 1;
  update public.rep_shifts set distance_m=round(total,1),points_count=n,
    last_seen_at=lp.recorded_at,last_lat=lp.lat,last_lng=lp.lng,last_speed=lp.speed,last_accuracy=lp.accuracy,
    new_cells=(select count(*) from public.rep_cells c where c.first_shift_id=target),
    cells=(select count(*) from (select distinct cell_x,cell_y from public.rep_locations where shift_id=target) x)
  where id=target;
end $$;

-- Everything the rep app needs on launch: who I am, my open shift, vehicles to choose from, my recent days.
create or replace function public.rep_context() returns jsonb language plpgsql stable security definer set search_path='' as $$
declare me uuid:=auth.uid();
begin
  perform private.require('tracking.log');
  return jsonb_build_object(
    'display_name',(select display_name from public.profiles where id=me),
    'shift',(select to_jsonb(s) from public.rep_shifts s where rep_id=me and ended_at is null),
    'last_vehicle_id',(select vehicle_id from public.rep_shifts where rep_id=me and vehicle_id is not null order by started_at desc limit 1),
    'vehicles',coalesce((select jsonb_agg(jsonb_build_object('id',v.id,'plate_number',v.plate_number,'model',v.model,
        'type_ar',t.name_ar,'type_en',t.name_en,'odometer',private.vehicle_odometer(v.id),
        'last_fuel_odometer',(select max(odometer_end) from public.fuel_logs f where f.vehicle_id=v.id),
        'in_use_by',(select p.display_name from public.rep_shifts s join public.profiles p on p.id=s.rep_id where s.vehicle_id=v.id and s.ended_at is null and s.rep_id<>me limit 1))
        order by v.plate_number)
      from public.vehicles v join public.vehicle_types t on t.id=v.type_id where v.status<>'inactive'),'[]'),
    'recent',coalesce((select jsonb_agg(x order by x.started_at desc) from (select s.id,s.started_at,s.ended_at,s.distance_m,s.new_cells,s.cells,s.points_count,s.odometer_start,s.odometer_end,v.plate_number
        from public.rep_shifts s left join public.vehicles v on v.id=s.vehicle_id where s.rep_id=me order by s.started_at desc limit 14) x),'[]'));
end $$;

create or replace function public.rep_start_shift(vehicle uuid,odometer numeric default null,photo text default null,lat double precision default null,lng double precision default null)
returns jsonb language plpgsql security definer set search_path='' as $$
declare me uuid:=auth.uid(); s public.rep_shifts; known numeric;
begin
  perform private.require('tracking.log');
  perform pg_advisory_xact_lock(hashtext('rep_shift'||me::text));
  select * into s from public.rep_shifts where rep_id=me and ended_at is null;
  if found then return to_jsonb(s); end if;
  if vehicle is not null then
    if not exists(select 1 from public.vehicles where id=vehicle and status<>'inactive') then raise exception 'Vehicle not found' using errcode='23514'; end if;
    if odometer is null then raise exception 'Odometer reading required' using errcode='23514'; end if;
    known:=private.vehicle_odometer(vehicle);
    if known is not null and odometer < known - 1 then raise exception 'Odometer is below the last reading (%)',known using errcode='23514'; end if;
  end if;
  insert into public.rep_shifts(rep_id,vehicle_id,odometer_start,photo_start_key,start_lat,start_lng)
  values(me,vehicle,case when vehicle is null then null else odometer end,photo,lat,lng) returning * into s;
  return to_jsonb(s);
end $$;

-- Accepts a batch of up to 500 points of the caller's own shift. Points already received are ignored, so a
-- phone may safely resend after a lost connection.
create or replace function public.rep_push_locations(shift uuid,points jsonb) returns jsonb language plpgsql security definer set search_path='' as $$
declare me uuid:=auth.uid(); s public.rep_shifts; accepted integer;
begin
  perform private.require('tracking.log');
  select * into s from public.rep_shifts where id=shift and rep_id=me;
  if not found then raise exception 'Shift not found' using errcode='42501'; end if;
  if jsonb_typeof(points)<>'array' or jsonb_array_length(points)>500 then raise exception 'Send 1 to 500 points' using errcode='23514'; end if;
  with incoming as (
    select (to_timestamp((p->>'t')::double precision/1000)) t,(p->>'lat')::double precision lat,(p->>'lng')::double precision lng,
      nullif(p->>'acc','')::real acc,nullif(p->>'spd','')::real spd,nullif(p->>'hdg','')::real hdg
    from jsonb_array_elements(points) p),
  valid as (
    select * from incoming where lat between -90 and 90 and lng between -180 and 180 and not (lat=0 and lng=0)
      and coalesce(acc,0)<=150 and t>=s.started_at-interval '2 minutes'
      and t<=coalesce(s.ended_at,now())+interval '2 minutes'),
  ins as (
    insert into public.rep_locations(shift_id,rep_id,recorded_at,lat,lng,accuracy,speed,heading)
    select shift,me,t,lat,lng,acc,case when spd>=0 then spd end,hdg from valid
    on conflict(shift_id,recorded_at) do nothing returning cell_x,cell_y,recorded_at,accuracy),
  cells as (
    insert into public.rep_cells(rep_id,cell_x,cell_y,first_seen_at,last_seen_at,first_shift_id,hits)
    select me,cell_x,cell_y,min(recorded_at),max(recorded_at),shift,count(*) from ins where coalesce(accuracy,0)<=60 group by cell_x,cell_y
    on conflict(rep_id,cell_x,cell_y) do update set last_seen_at=greatest(public.rep_cells.last_seen_at,excluded.last_seen_at),
      first_seen_at=least(public.rep_cells.first_seen_at,excluded.first_seen_at),hits=public.rep_cells.hits+excluded.hits
    returning 1)
  select count(*) into accepted from ins;
  if accepted>0 then perform private.refresh_shift(shift); end if;
  select * into s from public.rep_shifts where id=shift;
  return jsonb_build_object('accepted',accepted,'distance_m',s.distance_m,'new_cells',s.new_cells,'points',s.points_count);
end $$;

create or replace function public.rep_end_shift(shift uuid,odometer numeric default null,photo text default null,note text default null)
returns jsonb language plpgsql security definer set search_path='' as $$
declare me uuid:=auth.uid(); s public.rep_shifts;
begin
  perform private.require('tracking.log');
  select * into s from public.rep_shifts where id=shift and rep_id=me for update;
  if not found then raise exception 'Shift not found' using errcode='42501'; end if;
  if s.ended_at is not null then return to_jsonb(s); end if;
  if s.vehicle_id is not null then
    if odometer is null then raise exception 'Odometer reading required' using errcode='23514'; end if;
    if odometer < s.odometer_start then raise exception 'Odometer is below the start reading (%)',s.odometer_start using errcode='23514'; end if;
  end if;
  perform private.refresh_shift(shift);
  update public.rep_shifts set ended_at=greatest(now(),started_at),ended_by='rep',
    odometer_end=case when vehicle_id is null then null else odometer end,photo_end_key=photo,notes=nullif(btrim(note),'')
  where id=shift returning * into s;
  return to_jsonb(s);
end $$;

-- A manager can close a shift a rep forgot to end.
create or replace function public.tracking_end_shift(shift uuid) returns void language plpgsql security definer set search_path='' as $$
begin
  if not private.has_permission('fleet.manage') then raise exception 'fleet.manage required' using errcode='42501'; end if;
  perform private.refresh_shift(shift);
  update public.rep_shifts set ended_at=greatest(coalesce(last_seen_at,now()),started_at),ended_by='admin' where id=shift and ended_at is null;
end $$;

-- Fuel fill from the phone. odometer_start defaults to the vehicle's previous fill.
create or replace function public.rep_log_fuel(vehicle uuid,odometer numeric,liters numeric,price numeric default null,odometer_before numeric default null,
  station text default null,photo text default null,note text default null) returns uuid language plpgsql security definer set search_path='' as $$
declare me uuid:=auth.uid(); start numeric; result uuid;
begin
  perform private.require('tracking.log');
  if not exists(select 1 from public.vehicles where id=vehicle) then raise exception 'Vehicle not found' using errcode='23514'; end if;
  start:=coalesce(odometer_before,(select max(odometer_end) from public.fuel_logs where vehicle_id=vehicle),(select initial_odometer from public.vehicles where id=vehicle));
  if odometer<=start then raise exception 'Odometer must be greater than the previous fill (%)',start using errcode='23514'; end if;
  insert into public.fuel_logs(vehicle_id,odometer_start,odometer_end,liters,price_per_liter,station,driver_name,notes,photo_end_key,created_by)
  values(vehicle,start,odometer,liters,price,nullif(btrim(station),''),(select display_name from public.profiles where id=me),nullif(btrim(note),''),photo,me)
  returning id into result;
  return result;
end $$;

create or replace function public.rep_log_expense(vehicle uuid,category text,amount numeric,part_name text default null,odometer numeric default null,
  workshop text default null,description text default null,photo text default null) returns uuid language plpgsql security definer set search_path='' as $$
declare me uuid:=auth.uid(); result uuid;
begin
  perform private.require('tracking.log');
  if not exists(select 1 from public.vehicles where id=vehicle) then raise exception 'Vehicle not found' using errcode='23514'; end if;
  insert into public.vehicle_expenses(vehicle_id,category,amount,part_name,odometer,workshop,description,photo_key,created_by)
  values(vehicle,category,amount,nullif(btrim(part_name),''),odometer,nullif(btrim(workshop),''),nullif(btrim(description),''),photo,me)
  returning id into result;
  return result;
end $$;

-- Managers: reps with their open shift and last position, plus every rep account.
create or replace function public.tracking_reps() returns jsonb language plpgsql stable security definer set search_path='' as $$
begin
  perform private.require('tracking.view');
  return coalesce((select jsonb_agg(jsonb_build_object('id',p.id,'display_name',p.display_name,'username',p.username,'is_active',p.is_active,
      'shift',(select to_jsonb(s)||jsonb_build_object('plate_number',v.plate_number) from public.rep_shifts s left join public.vehicles v on v.id=s.vehicle_id where s.rep_id=p.id and s.ended_at is null),
      'last_seen_at',(select max(last_seen_at) from public.rep_shifts s where s.rep_id=p.id)) order by p.display_name)
    from public.profiles p where exists(select 1 from public.rep_shifts s where s.rep_id=p.id)
      or exists(select 1 from public.user_roles ur join public.roles r on r.id=ur.role_id where ur.user_id=p.id and r.name='rep')),'[]');
end $$;

create or replace function public.tracking_shifts(from_date date,to_date date,rep uuid default null) returns jsonb language plpgsql stable security definer set search_path='' as $$
begin
  perform private.require('tracking.view');
  return coalesce((select jsonb_agg(to_jsonb(s)||jsonb_build_object('rep_name',p.display_name,'plate_number',v.plate_number,
      'fuel_liters',(select sum(liters) from public.fuel_logs f where f.vehicle_id=s.vehicle_id and f.created_by=s.rep_id and f.created_at between s.started_at and coalesce(s.ended_at,now())),
      'expenses',(select sum(amount) from public.vehicle_expenses e where e.vehicle_id=s.vehicle_id and e.created_by=s.rep_id and e.created_at between s.started_at and coalesce(s.ended_at,now())))
      order by s.started_at desc)
    from public.rep_shifts s join public.profiles p on p.id=s.rep_id left join public.vehicles v on v.id=s.vehicle_id
    where s.started_at>=(from_date::timestamp at time zone 'Africa/Cairo') and s.started_at<((to_date+1)::timestamp at time zone 'Africa/Cairo') and (rep is null or s.rep_id=rep)),'[]');
end $$;

-- A shift's points with a flag for cells the rep entered for the first time on that shift.
create or replace function public.tracking_route(shift uuid) returns jsonb language plpgsql stable security definer set search_path='' as $$
declare s public.rep_shifts;
begin
  select * into s from public.rep_shifts where id=shift;
  if not found or not (private.has_permission('tracking.view') or s.rep_id=auth.uid()) then raise exception 'Shift not found' using errcode='42501'; end if;
  return jsonb_build_object('shift',to_jsonb(s)||jsonb_build_object('rep_name',(select display_name from public.profiles where id=s.rep_id),'plate_number',(select plate_number from public.vehicles where id=s.vehicle_id)),
    'points',coalesce((select jsonb_agg(jsonb_build_array(round(l.lat::numeric,6),round(l.lng::numeric,6),(extract(epoch from l.recorded_at)*1000)::bigint,l.speed,l.accuracy,c.first_shift_id is not distinct from shift) order by l.recorded_at)
      from public.rep_locations l left join public.rep_cells c on c.rep_id=l.rep_id and c.cell_x=l.cell_x and c.cell_y=l.cell_y
      where l.shift_id=shift and coalesce(l.accuracy,0)<=100),'[]'));
end $$;

-- Coverage grid for a period: every cell visited, how often, by how many reps, and whether it was new in the period.
create or replace function public.tracking_coverage(from_date date,to_date date,rep uuid default null) returns jsonb language plpgsql stable security definer set search_path='' as $$
begin
  perform private.require('tracking.view');
  return coalesce((select jsonb_agg(jsonb_build_array(x.cell_x,x.cell_y,x.points,x.days,x.reps,x.is_new,x.rep_ids))
    from (select l.cell_x,l.cell_y,count(*) points,count(distinct (l.recorded_at at time zone 'Africa/Cairo')::date) days,count(distinct l.rep_id) reps,
            bool_or(c.first_seen_at>=(from_date::timestamp at time zone 'Africa/Cairo')) is_new,jsonb_agg(distinct l.rep_id) rep_ids
          from public.rep_locations l join public.rep_cells c on c.rep_id=l.rep_id and c.cell_x=l.cell_x and c.cell_y=l.cell_y
          where l.recorded_at>=(from_date::timestamp at time zone 'Africa/Cairo') and l.recorded_at<((to_date+1)::timestamp at time zone 'Africa/Cairo') and (rep is null or l.rep_id=rep) and coalesce(l.accuracy,0)<=60
          group by l.cell_x,l.cell_y) x),'[]');
end $$;

do $$ declare f text; begin
  foreach f in array array['public.rep_context()','public.rep_start_shift(uuid,numeric,text,double precision,double precision)',
    'public.rep_push_locations(uuid,jsonb)','public.rep_end_shift(uuid,numeric,text,text)','public.tracking_end_shift(uuid)',
    'public.rep_log_fuel(uuid,numeric,numeric,numeric,numeric,text,text,text)','public.rep_log_expense(uuid,text,numeric,text,numeric,text,text,text)',
    'public.tracking_reps()','public.tracking_shifts(date,date,uuid)','public.tracking_route(uuid)','public.tracking_coverage(date,date,uuid)'] loop
    execute format('revoke all on function %s from public,anon',f);
    execute format('grant execute on function %s to authenticated',f);
  end loop;
  foreach f in array array['private.require(text)','private.vehicle_odometer(uuid)','private.refresh_shift(uuid)'] loop
    execute format('revoke all on function %s from public,anon,authenticated',f);
  end loop;
end $$;

commit;
