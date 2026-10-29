import {staffIdentity} from '../_shared/staff-identity.mjs';
import {validPassword} from '../_shared/password-policy.mjs';
import {createClient} from 'npm:@supabase/supabase-js@2.104.0';
const headers={'Access-Control-Allow-Origin':'*','Access-Control-Allow-Headers':'authorization, x-client-info, apikey, content-type','Content-Type':'application/json'};
Deno.serve(async(req:Request)=>{
 if(req.method==='OPTIONS')return new Response(null,{headers});
 const reply=(body:unknown,status=200)=>new Response(JSON.stringify(body),{status,headers});
 if(req.method!=='POST')return reply({error:'Method not allowed'},405);
 try{
 const auth=req.headers.get('authorization');if(!auth?.startsWith('Bearer '))return reply({error:'Authentication required'},401);
 const url=Deno.env.get('SUPABASE_URL')!;
 const key=JSON.parse(Deno.env.get('SUPABASE_SECRET_KEYS')||'{}').default||Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
 const publicKey=JSON.parse(Deno.env.get('SUPABASE_PUBLISHABLE_KEYS')||'{}').default||Deno.env.get('SUPABASE_ANON_KEY')!;
 const server=createClient(url,key,{auth:{persistSession:false,autoRefreshToken:false}});
 const {data:{user},error}=await server.auth.getUser(auth.slice(7));if(error||!user)return reply({error:'Invalid session'},401);
 const scoped=createClient(url,publicKey,{global:{headers:{Authorization:auth}},auth:{persistSession:false}});
 const access=await scoped.rpc('get_my_access');if(access.error||!access.data?.active||!access.data?.is_super_admin)return reply({error:'Super Admin required'},403);
 const body=await req.json();
 if(body.action==='reset_password'){
  if(typeof body.user_id!=='string'||!validPassword(body.password))return reply({error:'Password must contain 8–128 characters, uppercase, lowercase, a number and a special character'},400);
  const profile=await server.from('profiles').select('id').eq('id',body.user_id).maybeSingle();if(!profile.data)return reply({error:'Staff account not found'},404);
  const r=await server.auth.admin.updateUserById(body.user_id,{password:body.password});if(r.error)return reply({error:r.error.message},400);
  return reply({success:true});
 }
 const {username,password,display_name,role}=body;
 if(typeof username!=='string'||!/^[a-z0-9][a-z0-9._-]{2,39}$/.test(username)||!validPassword(password)||typeof display_name!=='string'||!display_name.trim()||display_name.length>150||!['admin','supervisor','viewer'].includes(role))return reply({error:'Invalid account fields. Username: 3–40 lowercase letters, numbers, dot, underscore or dash. Password: 8–128 characters with uppercase, lowercase, a number and a special character.'},400);
 // A synthetic internal Auth identifier is never mailed or shown to staff.
 const created=await server.auth.admin.createUser({email:staffIdentity(username,Deno.env.get('SUPABASE_URL')!),password,email_confirm:true});
 if(created.error)return reply({error:created.error.message},400);
 const provision=await server.rpc('provision_staff_account',{target_user_id:created.data.user.id,staff_name:display_name.trim(),staff_username:username,role_name:role});
 if(provision.error){await server.auth.admin.deleteUser(created.data.user.id);return reply({error:'Account creation rolled back. '+provision.error.message},400)}
 return reply({success:true});
 }catch{return reply({error:'Unable to process staff account'},500)}
});
