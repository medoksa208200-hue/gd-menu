import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import { PGlite } from '@electric-sql/pglite';
import { pg_trgm } from '@electric-sql/pglite/contrib/pg_trgm';

let db;
const staff='10000000-0000-0000-0000-000000000001';
const supervisor='10000000-0000-0000-0000-000000000002';
const outsider='10000000-0000-0000-0000-000000000003';
const viewer='10000000-0000-0000-0000-000000000004';
const editor='10000000-0000-0000-0000-000000000005';
const mold='20000000-0000-0000-0000-000000000001';
const draft='20000000-0000-0000-0000-000000000002';
const cat='30000000-0000-0000-0000-000000000001';
const maintenance='40000000-0000-0000-0000-000000000001';
const chrome='40000000-0000-0000-0000-000000000002';
const section='50000000-0000-0000-0000-000000000001';
async function sql(q,args=[]) {return (await db.query(q,args)).rows;}
async function as(role,id=null) {
  await db.exec('reset role');
  await sql("select set_config('request.jwt.claim.sub',$1,false),set_config('request.jwt.claim.role',$2,false)",[id??'',role]);
  await sql("select set_config('request.jwt.claims',$1,false)",[JSON.stringify({sub:id??'',role})]);
  await db.exec(`set role ${role}`);
}
async function denied(q,params=[]) {await assert.rejects(()=>sql(q,params));}
before(async()=>{
  db=new PGlite({extensions:{pg_trgm}});
  await db.exec(await readFile(new URL('../supabase/tests/platform-fixture.sql',import.meta.url),'utf8'));
  for (const f of (await readdir(new URL('../supabase/migrations',import.meta.url))).sort()) {
    await db.exec(await readFile(new URL(`../supabase/migrations/${f}`,import.meta.url),'utf8'));
  }
  await db.exec(await readFile(new URL('../supabase/seed.sql',import.meta.url),'utf8'));
  await sql('insert into auth.users(id) values($1),($2),($3),($4),($5)',[staff,supervisor,outsider,viewer,editor]);
  await as('service_role');
  await sql('select public.bootstrap_super_admin($1,$2)',[staff,'Test administrator']);
  await sql('insert into public.profiles(id,display_name) values($1,$2),($3,$4),($5,$6)',[supervisor,'Test supervisor',viewer,'Test viewer',editor,'Test editor']);
  await as('authenticated',staff);
  await sql("select public.set_staff_access($1,'supervisor',true)",[supervisor]);
  await sql("select public.set_staff_access($1,'viewer',true)",[viewer]);
  await sql("select public.set_staff_access($1,'viewer',true,array['molds.edit','media.manage','content.manage','molds.archive'])",[editor]);
  await sql("insert into public.categories(id,name_ar,name_en,slug) values($1,'أطباق','Plates','plates')",[cat]);
  await sql("insert into public.molds(id,code,name_ar,name_en,main_category_id,publication_status) values($1,'GD-001','طبق دائري','Round plate',$3,'published'),($2,'GD-002','طبق تجريبي','Draft plate',$3,'draft')",[mold,draft,cat]);
  await sql('insert into public.mold_specifications(mold_id,diameter_mm,product_weight_g) values($1,250,180) on conflict(mold_id) do update set diameter_mm=excluded.diameter_mm,product_weight_g=excluded.product_weight_g',[mold]);
  await sql("insert into public.mold_internal_details(mold_id,storage_location,internal_notes,chrome_interval_days,maintenance_interval_days,maintenance_interval_cycles) values($1,'SECRET ROOM','SECRET NOTE',90,30,1000),($2,'PRIVATE','PRIVATE',null,null,null) on conflict(mold_id) do update set storage_location=excluded.storage_location,internal_notes=excluded.internal_notes,chrome_interval_days=excluded.chrome_interval_days,maintenance_interval_days=excluded.maintenance_interval_days,maintenance_interval_cycles=excluded.maintenance_interval_cycles",[mold,draft]);
  await sql("insert into public.mold_images(mold_id,bucket_id,storage_key,visibility,is_approved) values($1,'catalog-media','molds/'||$1::uuid::text||'/approved.jpg','public',true),($1,'factory-files','molds/'||$1::uuid::text||'/secret.jpg','private',false),($1,'catalog-media','molds/'||$1::uuid::text||'/unapproved.jpg','public',false),($2,'catalog-media','molds/'||$2::uuid::text||'/draft.jpg','public',true)",[mold,draft]);
  await sql("insert into public.homepage_sections(id,title_ar,title_en,collection_type,is_published) values($1,'مختارات','Featured','manual',true)",[section]);
  await sql('insert into public.homepage_section_items(section_id,mold_id) values($1,$2),($1,$3)',[section,mold,draft]);
});
after(async()=>{if(db)await db.close();});

test('anonymous projection exposes only published public allowlist',async()=>{
  await as('anon');
  const rows=await sql('select * from public.catalog_molds');
  assert.equal(rows.length,1); assert.equal(rows[0].code,'GD-001');
  for(const secret of ['internal_notes','storage_location','operational_status','cost','created_by','deleted_at','technical_specifications'])assert.ok(!(secret in rows[0]));
  assert.equal((await sql('select * from public.catalog_images')).length,1);
  await denied('select * from public.molds');
  await denied('select * from public.mold_internal_details');
  await denied('select * from public.maintenance_records');
  await denied('select * from public.chrome_records');
  await denied('select * from public.audit_logs');
  await denied('select * from private.system_settings');
  await denied('select public.get_factory_dashboard()');
});
test('anonymous storage denies even guessed private/draft paths',async()=>{
  await as('authenticated',staff);
  await sql("insert into storage.objects(bucket_id,name) values('factory-files','molds/'||$1::uuid::text||'/secret.pdf'),('catalog-media','molds/'||$2::uuid::text||'/draft.jpg')",[mold,draft]);
  await as('anon');
  assert.equal((await sql('select * from storage.objects')).length,0);
  await denied("insert into storage.objects(bucket_id,name) values('catalog-media','molds/'||$1::uuid::text||'/attack.jpg')",[mold]);
});
test('signed-in non-staff remains unauthorized',async()=>{
  await as('authenticated',outsider);
  assert.equal((await sql('select * from public.molds')).length,0);
  assert.equal((await sql('select * from storage.objects')).length,0);
  await denied("insert into public.profiles(id,display_name) values($1,'Escalation')",[outsider]);
  await denied('insert into public.user_roles(user_id,role_id) select $1,id from public.roles limit 1',[outsider]);
  await denied("select public.set_staff_access($1,'super_admin',true)",[outsider]);
  await denied('select public.get_factory_dashboard()');
});
test('read-only viewer cannot mutate business data or access financial reports',async()=>{
  await as('authenticated',viewer);
  assert.equal((await sql('select * from public.molds')).length,2);
  assert.equal((await sql("update public.molds set name_en='Attack' where id=$1 returning id",[mold])).length,0);
  await denied("insert into public.molds(code,name_ar,name_en) values('ILLEGAL','خطأ','Illegal')");
  await denied('select public.get_factory_dashboard()');
  await denied('update public.profiles set is_active=false where id=$1',[viewer]);
});
test('draft creation, specs, publication, bilingual search, and homepage filtering',async()=>{
  await as('authenticated',staff);
  await sql("insert into public.molds(code,name_ar,name_en) values('GD-NEW','طبق جديد','New plate')");
  await as('anon');
  assert.equal((await sql("select * from public.search_catalog(search_text=>'GD-NEW')")).length,0);
  assert.equal((await sql("select * from public.search_catalog(search_text=>'دائري')")).length,1);
  assert.equal((await sql("select * from public.search_catalog(search_text=>'Round',diameter_min=>240,diameter_max=>260)")).length,1);
  assert.equal((await sql("select * from public.search_catalog(search_text=>'001',category_slug=>'plates')")).length,1);
  assert.equal((await sql('select * from public.get_homepage_collection($1)',[section])).length,1);
  await denied('select * from public.search_catalog(page_size=>101)');
  await as('authenticated',staff);
  await sql("update public.molds set publication_status='published' where code='GD-NEW'");
  await as('anon');
  assert.equal((await sql("select * from public.search_catalog(search_text=>'GD-NEW')")).length,1);
});
test('granular editing permission cannot publish, approve media, or change live homepage',async()=>{
  await as('authenticated',editor);
  await denied("update public.molds set publication_status='published' where id=$1",[draft]);
  await denied("update public.mold_images set is_approved=true where storage_key like '%unapproved.jpg'");
  await denied("update public.homepage_sections set title_en='Attack' where id=$1",[section]);
  await denied("delete from public.mold_images where storage_key like '%approved.jpg' and is_approved");
  await denied('delete from public.homepage_section_items where section_id=$1',[section]);
});
test('supervisor appends maintenance, chrome and production; summaries preserve cycles and currencies',async()=>{
  await as('authenticated',supervisor);
  await sql("insert into public.production_logs(mold_id,production_date,press_cycles,quantity_produced,rejected_quantity) values($1,current_date,120,480,24)",[mold]);
  await sql("insert into public.maintenance_records(id,mold_id,maintenance_date,maintenance_type,cost,currency,status,cycles_at_service) values($1,$2,current_date-10,'Repair',100,'EGP','completed',100)",[maintenance,mold]);
  await sql("insert into public.maintenance_records(mold_id,maintenance_date,maintenance_type,cost,currency,status) values($1,current_date-12,'Polish',20,'SAR','completed')",[mold]);
  await sql("insert into public.chrome_records(id,mold_id,chrome_date,chrome_type,cost) values($1,$2,current_date-5,'Hard chrome',300)",[chrome,mold]);
  await denied('select public.get_factory_dashboard()');
  await as('authenticated',staff);
  const r=(await sql('select * from public.get_mold_lifecycle($1)',[mold]))[0];
  assert.equal(Number(r.lifetime_cycles),120); assert.equal(Number(r.quantity_produced),480);
  assert.equal(Number(r.rejection_rate_percent),5); assert.equal(Number(r.maintenance_count),2);
  assert.equal(Number(r.next_maintenance_cycles),1100);
  assert.deepEqual(r.maintenance_cost_by_currency,{EGP:100,SAR:20});
  assert.equal(Number(r.days_since_chrome),5);
  const dash=(await sql('select public.get_factory_dashboard() d'))[0].d;
  assert.equal(Number(dash.total_molds),3); assert.equal(Number(dash.upcoming_chrome),0);
});
test('history deletion, edits to completed records, and production updates are rejected',async()=>{
  await as('authenticated',staff);
  await denied('delete from public.maintenance_records where id=$1',[maintenance]);
  await denied('update public.maintenance_records set cost=0 where id=$1',[maintenance]);
  await denied('update public.chrome_records set cost=0 where id=$1',[chrome]);
  await denied('update public.production_logs set press_cycles=0 where mold_id=$1',[mold]);
  await denied('update public.molds set id=$1 where id=$2',[crypto.randomUUID(),mold]);
});
test('invalid dimensions, duplicate codes, inconsistent rejects, and category loops are rejected',async()=>{
  await as('authenticated',staff);
  await denied("insert into public.molds(code,name_ar,name_en) values('gd-001','مكرر','Duplicate')");
  await denied('update public.mold_specifications set diameter_mm=-1 where mold_id=$1',[mold]);
  await denied('insert into public.production_logs(mold_id,production_date,press_cycles,quantity_produced,rejected_quantity) values($1,current_date,1,4,5)',[mold]);
  const child=(await sql("insert into public.categories(name_ar,name_en,slug,parent_id) values('فرعي','Child','child',$1) returning id",[cat]))[0].id;
  await denied('update public.categories set parent_id=$1 where id=$2',[child,cat]);
});
test('soft archive hides published molds and restore requires publication permission',async()=>{
  await as('authenticated',editor);
  await sql('select public.set_mold_archived($1,true)',[mold]);
  await as('anon');
  assert.equal((await sql("select * from public.catalog_molds where code='GD-001'")).length,0);
  await as('authenticated',editor);
  await denied('select public.set_mold_archived($1,false)',[mold]);
  await denied('update public.molds set deleted_at=null where id=$1',[mold]);
  await as('authenticated',staff);
  await sql('select public.set_mold_archived($1,false)',[mold]);
  await as('anon');
  assert.equal((await sql("select * from public.catalog_molds where code='GD-001'")).length,1);
});
test('audit is automatic, immutable to staff, and contains changed field names only',async()=>{
  await as('authenticated',staff);
  const rows=await sql("select * from public.audit_logs where table_name='maintenance_records'");
  assert.ok(rows.length>=2); assert.ok(rows.some(x=>x.actor_id===supervisor));
  assert.ok(!JSON.stringify(rows).includes('SECRET'));
  await denied("insert into public.audit_logs(action,table_name) values('FAKE','molds')");
  await denied('delete from public.audit_logs');
});
test('disabled staff lose existing-session privileges immediately',async()=>{
  await as('authenticated',staff);
  await sql("select public.set_staff_access($1,'supervisor',false)",[supervisor]);
  await as('authenticated',supervisor);
  assert.equal((await sql('select * from public.maintenance_records')).length,0);
  await denied("insert into public.chrome_records(mold_id,chrome_date,chrome_type) values($1,current_date,'Attack')",[mold]);
});
test('best-selling collection has no invented sales records',async()=>{
  await as('authenticated',staff);
  const id=(await sql("insert into public.homepage_sections(title_ar,title_en,collection_type,is_published) values('الأكثر مبيعا','Best sellers','best_selling',true) returning id"))[0].id;
  await as('anon');
  assert.equal((await sql('select * from public.get_homepage_collection($1)',[id])).length,0);
});

test('trusted service inserts and automatic child records work without exposing client credentials',async()=>{
  await as('service_role');
  const id=(await sql("insert into public.molds(code,name_ar,name_en) values('SERVICE-MOLD','خدمة','Service mold') returning id"))[0].id;
  assert.equal((await sql('select * from public.mold_internal_details where mold_id=$1',[id])).length,1);
  assert.equal((await sql('select * from public.mold_specifications where mold_id=$1',[id])).length,1);
});
test('storage paths enforce module permissions and attachment ownership',async()=>{
  await as('authenticated',viewer);
  await denied("insert into storage.objects(bucket_id,name) values('factory-files','molds/'||$1::uuid::text||'/view-attack.pdf')",[mold]);
  await as('authenticated',staff);
  await denied("insert into public.event_attachments(maintenance_id,storage_key,kind) values($1,'chrome/'||$2::uuid::text||'/wrong.pdf','document')",[maintenance,chrome]);
  await sql("insert into public.event_attachments(maintenance_id,storage_key,kind) values($1,'maintenance/'||$1::uuid::text||'/after.pdf','after')",[maintenance]);
  await sql("insert into storage.objects(bucket_id,name) values('factory-files','maintenance/'||$1::uuid::text||'/after.pdf')",[maintenance]);
  await denied("insert into storage.objects(bucket_id,name) values('factory-files','molds/not-a-uuid/invalid.pdf')");
  assert.equal((await sql("update storage.objects set name='tampered.pdf' returning id")).length,0);
});

test('transactional mold bundle saves specifications and rolls back invalid related rows',async()=>{
 await as('authenticated',staff);
 const payload={code:'BUNDLE-TEST',name_ar:'اختبار معاملة',name_en:'Bundle test',publication_status:'draft',diameter_mm:260,operational_status:'maintenance',category_ids:[cat],color_ids:[]};
 const id=(await sql('select public.save_mold_bundle(null,$1::jsonb) id',[JSON.stringify(payload)]))[0].id;
 assert.equal(Number((await sql('select diameter_mm from public.mold_specifications where mold_id=$1',[id]))[0].diameter_mm),260);
 assert.equal((await sql('select operational_status from public.mold_internal_details where mold_id=$1',[id]))[0].operational_status,'maintenance');
 await denied('select public.save_mold_bundle(null,$1::jsonb)',[JSON.stringify({...payload,code:'ROLLBACK-TEST',category_ids:[crypto.randomUUID()]})]);
 assert.equal((await sql("select id from public.molds where code='ROLLBACK-TEST'")).length,0);
});
test('username management and owner setup remain server-only',async()=>{
 await as('authenticated',outsider);
 assert.deepEqual((await sql('select public.get_my_access() a'))[0].a,{});
 await denied("select public.provision_staff_account($1,'Attack','attacker','admin')",[outsider]);
 await denied("select public.valid_owner_setup('fake')");
 await denied("select public.initialize_owner('fake',$1,'Attack','attacker')",[outsider]);
 await as('service_role');
 assert.equal((await sql("select public.valid_owner_setup('fake') valid"))[0].valid,false);
});
test('anonymous Storage reads include only approved published public objects',async()=>{
 await as('authenticated',staff);
 await sql("insert into storage.objects(bucket_id,name) values('catalog-media','molds/'||$1::uuid::text||'/approved.jpg')",[mold]);
 await as('anon');
 const rows=await sql('select name from storage.objects');
 assert.equal(rows.length,1);assert.ok(rows[0].name.endsWith('/approved.jpg'));
 await denied('select * from private.analytics_rate');
 await denied("select public.ingest_catalog_event(repeat('a',64),'view',$1,null)",[mold]);
});
test('real analytics ingestion is service-only, validates publication and deduplicates daily views',async()=>{
 await as('service_role');
 const visitor='a'.repeat(64);
 await sql("select public.ingest_catalog_event($1,'view',$2,null)",[visitor,mold]);
 await sql("select public.ingest_catalog_event($1,'view',$2,null)",[visitor,mold]);
 assert.equal(Number((await sql('select count(*) n from public.mold_views where mold_id=$1 and session_hash=$2',[mold,visitor]))[0].n),1);
 assert.equal((await sql("select public.ingest_catalog_event($1,'view',$2,null) accepted",[visitor,draft]))[0].accepted,false);
});

test('anonymous and staff clients cannot write through public catalog projections',async()=>{
 for(const role of ['anon','authenticated']){
  await as(role,role==='anon'?null:staff);
  await denied("update public.catalog_company set public_phone='+200000000000'");
  await denied("insert into public.catalog_categories(id,name_ar,name_en,slug) values(gen_random_uuid(),'x','x','injected')");
  await denied('delete from public.catalog_homepage_sections');
  await denied('truncate public.catalog_company');
 }
 await as('anon');
 assert.ok((await sql('select * from public.catalog_company')).length<=1);
});

test('catalog search treats LIKE wildcards literally',async()=>{
 await as('anon');
 assert.equal((await sql("select * from public.search_catalog(search_text=>'%')")).length,0);
 assert.equal((await sql("select * from public.search_catalog(search_text=>'GD_001')")).length,0);
 assert.deepEqual((await sql("select code from public.search_catalog(search_text=>'gd-0')")).map(r=>r.code),['GD-001']);
 await denied("select * from public.search_catalog(shape_filter=>repeat('x',101))");
});

test('lifecycle report is one permission-gated call',async()=>{
 await as('anon');await denied('select * from public.get_lifecycle_report()');
 await as('authenticated',outsider);await denied('select * from public.get_lifecycle_report()');
 await as('authenticated',staff);
 const rows=await sql('select code from public.get_lifecycle_report()');
 assert.ok(rows.some(r=>r.code==='GD-001'));
});

test('RLS policies evaluate auth helpers once per statement',async()=>{
 await db.exec('reset role');
 const rows=await sql("select policyname,qual,with_check from pg_policies where schemaname='public'");
 for(const r of rows)for(const e of [r.qual,r.with_check])if(e)assert.doesNotMatch(e.replace(/\(\s*SELECT (auth\.uid\(\)|private\.\w+\([^)]*\))( AS \w+)?\)/gi,''),/auth\.uid\(\)|private\.(has_permission\('|is_staff|is_super_admin|is_service)/,r.policyname);
});
