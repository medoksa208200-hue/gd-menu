import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import { PGlite } from '@electric-sql/pglite';
import { pg_trgm } from '@electric-sql/pglite/contrib/pg_trgm';

let db,car,car2,typeId;
const owner='10000000-0000-0000-0000-000000000001',rep='10000000-0000-0000-0000-000000000011',viewer='10000000-0000-0000-0000-000000000013',outsider='10000000-0000-0000-0000-000000000099';
const sql=async(q,a=[])=>(await db.query(q,a)).rows;
async function as(role,id=null){await db.exec('reset role');await sql("select set_config('request.jwt.claim.sub',$1,false),set_config('request.jwt.claim.role',$2,false)",[id??'',role]);await sql("select set_config('request.jwt.claims',$1,false)",[JSON.stringify({sub:id??'',role})]);await db.exec(`set role ${role}`)}
const day=n=>new Date(Date.now()+n*86400000).toISOString().slice(0,10);

before(async()=>{
  db=new PGlite({extensions:{pg_trgm}});
  await db.exec(await readFile(new URL('../supabase/tests/platform-fixture.sql',import.meta.url),'utf8'));
  for(const f of (await readdir(new URL('../supabase/migrations',import.meta.url))).sort())await db.exec(await readFile(new URL(`../supabase/migrations/${f}`,import.meta.url),'utf8'));
  await sql('insert into auth.users(id) values($1),($2),($3),($4)',[owner,rep,viewer,outsider]);
  await as('service_role');
  await sql('select public.bootstrap_super_admin($1,$2)',[owner,'Owner']);
  await sql("select public.provision_staff_account($1,'Rep One','rep.one','rep')",[rep]);
  await sql("select public.provision_staff_account($1,'Viewer','viewer','viewer')",[viewer]);
  await as('authenticated',owner);
  typeId=(await sql("select id from public.vehicle_types order by name_en limit 1"))[0].id;
  car=(await sql("insert into public.vehicles(plate_number,type_id,initial_odometer) values('AAA 1',$1,10000) returning id",[typeId]))[0].id;
  car2=(await sql("insert into public.vehicles(plate_number,type_id,initial_odometer) values('BBB 2',$1,0) returning id",[typeId]))[0].id;
});
after(async()=>{if(db)await db.close()});

test('documents and driver licences raise alerts before they expire',async()=>{
  await as('authenticated',owner);
  await sql("insert into public.vehicle_documents(vehicle_id,kind,expires_on) values($1,'license',$2),($1,'insurance',$3),($4,'license',$5)",[car,day(10),day(200),car2,day(-3)]);
  await sql("insert into public.driver_profiles(profile_id,license_expires_on) values($1,$2)",[rep,day(5)]);
  const alerts=(await sql('select public.fleet_alerts() a'))[0].a;
  const docs=alerts.filter(a=>a.kind==='document');
  assert.equal(docs.length,2);
  assert.equal(docs.find(a=>a.vehicle_id===car2).severity,'high');
  assert.equal(docs.find(a=>a.vehicle_id===car).doc_kind,'license');
  assert.ok(alerts.some(a=>a.kind==='license'&&a.driver_name==='Rep One'));
  // A renewed document replaces the old one.
  await sql("insert into public.vehicle_documents(vehicle_id,kind,expires_on) values($1,'license',$2)",[car2,day(365)]);
  assert.equal((await sql('select public.fleet_alerts() a'))[0].a.filter(a=>a.kind==='document').length,1);
});

test('maintenance plans follow the last matching expense by km and by time',async()=>{
  await as('authenticated',owner);
  await sql("insert into public.vehicle_expenses(vehicle_id,expense_date,category,amount,odometer) values($1,$2,'oil_change',500,10000)",[car,day(-20)]);
  await sql("insert into public.fuel_logs(vehicle_id,odometer_start,odometer_end,liters) values($1,10000,14600,400)",[car]);
  const rows=await sql("select * from public.fleet_maintenance_status() where vehicle_id=$1 and item='تغيير زيت'",[car]);
  assert.equal(rows.length,1);
  assert.equal(Number(rows[0].km_since),4600);assert.equal(rows[0].status,'soon');assert.equal(Number(rows[0].due_km),15000);
  const battery=(await sql("select status from public.fleet_maintenance_status() where vehicle_id=$1 and item='بطارية'",[car]))[0];
  assert.equal(battery.status,'unknown');
  await sql("insert into public.fuel_logs(vehicle_id,odometer_start,odometer_end,liters) values($1,14600,15100,40)",[car]);
  assert.ok((await sql('select public.fleet_alerts() a'))[0].a.some(a=>a.kind==='maintenance'&&a.item==='تغيير زيت'&&a.severity==='high'));
  // A plan for one vehicle only applies to it.
  await sql("insert into public.maintenance_plans(item,category,vehicle_id,every_days) values('Gearbox oil','maintenance',$1,365)",[car2]);
  assert.equal((await sql("select count(*)::int n from public.fleet_maintenance_status() where item='Gearbox oil'"))[0].n,1);
});

test('parts stock follows movements and a closed work order becomes one expense',async()=>{
  await as('authenticated',owner);
  const part=(await sql("insert into public.parts(name,min_qty) values('فلتر زيت',2) returning id"))[0].id;
  await sql("insert into public.part_movements(part_id,kind,qty,unit_cost) values($1,'in',5,120)",[part]);
  assert.equal(Number((await sql('select qty,unit_cost from public.parts where id=$1',[part]))[0].qty),5);
  const wo=(await sql("insert into public.work_orders(vehicle_id,title,labor_cost,odometer,due_on) values($1,'Service',200,15100,$2) returning id,number",[car,day(-1)]))[0];
  assert.ok((await sql('select public.fleet_alerts() a'))[0].a.some(a=>a.kind==='work_order'));
  await sql("insert into public.part_movements(part_id,kind,qty,unit_cost,work_order_id,vehicle_id) values($1,'out',4,120,$2,$3)",[part,wo.id,car]);
  assert.equal(Number((await sql('select qty from public.parts where id=$1',[part]))[0].qty),1);
  assert.ok((await sql('select public.fleet_alerts() a'))[0].a.some(a=>a.kind==='stock'));
  const expense=(await sql('select public.close_work_order($1) e',[wo.id]))[0].e;
  const e=(await sql('select amount,category,description from public.vehicle_expenses where id=$1',[expense]))[0];
  assert.equal(Number(e.amount),680);assert.equal(e.category,'maintenance');assert.match(e.description,/Service/);
  assert.equal((await sql('select status from public.work_orders where id=$1',[wo.id]))[0].status,'done');
  // Closing twice does not create a second expense.
  assert.equal((await sql('select public.close_work_order($1) e',[wo.id]))[0].e,expense);
  // Deleting a movement puts the stock back.
  await sql("delete from public.part_movements where work_order_id=$1",[wo.id]);
  assert.equal(Number((await sql('select qty from public.parts where id=$1',[part]))[0].qty),5);
});

test('visits are stays of 3 minutes or more inside a place',async()=>{
  await as('authenticated',owner);
  await sql("insert into public.places(name,kind,lat,lng,radius_m) values('Factory','factory',30.0,31.0,150),('Client A','customer',30.02,31.0,100)");
  await as('authenticated',rep);
  const shift=(await sql('select public.rep_start_shift(null) s'))[0].s.id;
  await as('service_role');await sql("update public.rep_shifts set started_at=now()-interval '2 hours' where id=$1",[shift]);await as('authenticated',rep);
  const t0=Date.now()-3600000;const pts=[];
  for(let i=0;i<6;i++)pts.push({t:t0+i*60000,lat:30.0+i*0.00001,lng:31.0,acc:8});         // 5 minutes at the factory
  for(let i=0;i<4;i++)pts.push({t:t0+600000+i*60000,lat:30.01,lng:31.0+i*0.001,acc:8});   // driving
  for(let i=0;i<2;i++)pts.push({t:t0+900000+i*60000,lat:30.02,lng:31.0,acc:8});           // 1 minute at the client: too short
  await sql('select public.rep_push_locations($1,$2)',[shift,JSON.stringify(pts)]);
  await as('authenticated',owner);
  const visits=(await sql('select public.tracking_visits($1::date,$2::date) v',[day(-1),day(1)]))[0].v;
  assert.equal(visits.length,1);assert.equal(visits[0].place_name,'Factory');assert.equal(Number(visits[0].minutes),5);
});

test('only fleet managers write; viewers read; others see nothing',async()=>{
  await as('authenticated',viewer);
  assert.ok((await sql('select * from public.vehicle_documents')).length>0);
  await assert.rejects(()=>sql("insert into public.parts(name) values('x')"));
  await assert.rejects(()=>sql("select public.close_work_order(gen_random_uuid())"),/fleet.manage/);
  await as('authenticated',rep);
  assert.equal((await sql('select * from public.vehicle_documents')).length,0);
  assert.equal((await sql('select public.fleet_alerts() a'))[0].a.length,0);
  await assert.rejects(()=>sql("insert into public.places(name,lat,lng) values('x',1,1)"));
  await as('authenticated',outsider);
  assert.equal((await sql('select * from public.places')).length,0);
});
