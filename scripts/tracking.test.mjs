import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import { PGlite } from '@electric-sql/pglite';
import { pg_trgm } from '@electric-sql/pglite/contrib/pg_trgm';

let db;
const owner='10000000-0000-0000-0000-000000000001';
const rep='10000000-0000-0000-0000-000000000011';
const rep2='10000000-0000-0000-0000-000000000012';
const viewer='10000000-0000-0000-0000-000000000013';
const sql=async(q,args=[])=>(await db.query(q,args)).rows;
async function as(role,id=null){
  await db.exec('reset role');
  await sql("select set_config('request.jwt.claim.sub',$1,false),set_config('request.jwt.claim.role',$2,false)",[id??'',role]);
  await sql("select set_config('request.jwt.claims',$1,false)",[JSON.stringify({sub:id??'',role})]);
  await db.exec(`set role ${role}`);
}
const denied=(q,p=[])=>assert.rejects(()=>sql(q,p));
let car;
before(async()=>{
  db=new PGlite({extensions:{pg_trgm}});
  await db.exec(await readFile(new URL('../supabase/tests/platform-fixture.sql',import.meta.url),'utf8'));
  for(const f of (await readdir(new URL('../supabase/migrations',import.meta.url))).sort())await db.exec(await readFile(new URL(`../supabase/migrations/${f}`,import.meta.url),'utf8'));
  await sql('insert into auth.users(id) values($1),($2),($3),($4)',[owner,rep,rep2,viewer]);
  await as('service_role');
  await sql('select public.bootstrap_super_admin($1,$2)',[owner,'Owner']);
  await sql("select public.provision_staff_account($1,'Rep One','rep.one','rep')",[rep]);
  await sql("select public.provision_staff_account($1,'Rep Two','rep.two','rep')",[rep2]);
  await sql("select public.provision_staff_account($1,'Viewer','viewer','viewer')",[viewer]);
  await as('authenticated',owner);
  const type=(await sql("select id from public.vehicle_types limit 1"))[0].id;
  car=(await sql("insert into public.vehicles(plate_number,type_id,initial_odometer) values('ABC 123',$1,1000) returning id",[type]))[0].id;
});
after(async()=>{if(db)await db.close()});

const point=(t,lat,lng,acc=8)=>({t,lat,lng,acc,spd:10});

test('a rep runs a shift: start, points, coverage, end',async()=>{
  await as('authenticated',rep);
  const access=(await sql('select public.get_my_access() a'))[0].a;
  assert.ok(access.active);assert.ok(access.permissions.includes('tracking.log'));assert.ok(!access.permissions.includes('tracking.view'));
  const ctx=(await sql('select public.rep_context() c'))[0].c;
  assert.equal(ctx.shift,null);assert.equal(ctx.vehicles.length,1);assert.equal(Number(ctx.vehicles[0].odometer),1000);
  await assert.rejects(()=>sql('select public.rep_start_shift($1,900)',[car]),/below/);
  const shift=(await sql('select public.rep_start_shift($1,1010) s',[car]))[0].s;
  // Starting again returns the same open shift.
  assert.equal((await sql('select public.rep_start_shift($1,1010) s',[car]))[0].s.id,shift.id);
  const t0=Date.now();
  const pts=[point(t0,30.0444,31.2357),point(t0+30000,30.0464,31.2357),point(t0+60000,30.0484,31.2357),point(t0+90000,30.0484,31.2357),point(t0+120000,31.5,31.2357)];
  const r=(await sql('select public.rep_push_locations($1,$2) r',[shift.id,JSON.stringify(pts)]))[0].r;
  assert.equal(r.accepted,5);
  // About 444 m of real movement; the 160 km jump in 30 s is ignored.
  assert.ok(r.distance_m>400&&r.distance_m<500,String(r.distance_m));
  assert.ok(r.new_cells>=3);
  // Resending the same batch is harmless.
  assert.equal((await sql('select public.rep_push_locations($1,$2) r',[shift.id,JSON.stringify(pts)]))[0].r.accepted,0);
  await assert.rejects(()=>sql('select public.rep_end_shift($1,1000)',[shift.id]),/below/);
  const ended=(await sql('select public.rep_end_shift($1,1030) s',[shift.id]))[0].s;
  assert.ok(ended.ended_at);assert.equal(Number(ended.odometer_end),1030);
  await denied('insert into public.rep_shifts(rep_id) values($1)',[rep]);
  assert.equal((await sql('select * from public.fuel_logs')).length,0);
  assert.equal((await sql('select * from public.rep_shifts')).length,1);

  // A second shift on the same streets discovers nothing new; a new street is new.
  const s2=(await sql('select public.rep_start_shift($1,1030) s',[car]))[0].s;
  const t1=Date.now()+1000;
  const again=(await sql('select public.rep_push_locations($1,$2) r',[s2.id,JSON.stringify([point(t1,30.0444,31.2357),point(t1+30000,30.0464,31.2357)])]))[0].r;
  assert.equal(again.new_cells,0);
  const fresh=(await sql('select public.rep_push_locations($1,$2) r',[s2.id,JSON.stringify([point(t1+60000,30.0464,31.2457)])]))[0].r;
  assert.equal(fresh.new_cells,1);
  const route=(await sql('select public.tracking_route($1) r',[s2.id]))[0].r;
  assert.deepEqual(route.points.map(p=>p[5]),[false,false,true]);

  // Fuel and expenses from the phone go into the fleet tables in the rep's name.
  await assert.rejects(()=>sql('select public.rep_log_fuel($1,900,40)',[car]),/greater/);
  await sql('select public.rep_log_fuel($1,1300,40,15)',[car]);
  await sql("select public.rep_log_expense($1,'washing',50)",[car]);
});

test('reps cannot touch other reps, managers see everything',async()=>{
  await as('authenticated',rep2);
  assert.equal((await sql('select * from public.rep_shifts')).length,0);
  const other=(await sql('select id from public.rep_shifts limit 1'));assert.equal(other.length,0);
  await as('authenticated',owner);
  const shift=(await sql('select id from public.rep_shifts where ended_at is null'))[0].id;
  await as('authenticated',rep2);
  await assert.rejects(()=>sql('select public.rep_push_locations($1,$2)',[shift,'[]']),/not found/);
  await assert.rejects(()=>sql('select public.rep_end_shift($1,2000)',[shift]),/not found/);
  await assert.rejects(()=>sql('select public.tracking_reps()'),/tracking.view/);
  await assert.rejects(()=>sql('select public.tracking_route($1)',[shift]),/not found/);
  await as('authenticated',viewer);
  await assert.rejects(()=>sql('select public.rep_context()'),/tracking.log/);
  await as('authenticated',owner);
  const reps=(await sql('select public.tracking_reps() r'))[0].r;
  assert.equal(reps.length,2);assert.ok(reps.find(r=>r.id===rep).shift);
  const today=new Date().toISOString().slice(0,10);
  const shifts=(await sql('select public.tracking_shifts($1::date-1,$1::date+1) s',[today]))[0].s;
  assert.equal(shifts.length,2);assert.equal(Number(shifts.find(s=>s.ended_at===null).fuel_liters),40);
  const cells=(await sql('select public.tracking_coverage($1::date-1,$1::date+1) c',[today]))[0].c;
  assert.ok(cells.length>=4);
  const fuel=(await sql('select odometer_start,odometer_end,driver_name,created_by from public.fuel_logs'))[0];
  assert.equal(Number(fuel.odometer_start),1000);assert.equal(fuel.driver_name,'Rep One');assert.equal(fuel.created_by,rep);
  await sql('select public.tracking_end_shift($1)',[shift]);
  assert.equal((await sql('select ended_by from public.rep_shifts where id=$1',[shift]))[0].ended_by,'admin');
});
