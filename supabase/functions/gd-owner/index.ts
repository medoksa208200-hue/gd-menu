import {createClient} from 'npm:@supabase/supabase-js@2.104.0';
const headers={'Access-Control-Allow-Origin':'*','Access-Control-Allow-Headers':'authorization, x-client-info, apikey, content-type','Content-Type':'application/json'};
Deno.serve(async(req:Request)=>{
 if(req.method==='OPTIONS')return new Response(null,{headers});
 const reply=(body:unknown,status=200)=>new Response(JSON.stringify(body),{status,headers});
 if(req.method!=='POST')return reply({error:'Method not allowed'},405);
 try{
 const {token,username,password,display_name}=await req.json();
 if(typeof token!=='string'||token.length<40||token.length>100||typeof username!=='string'||!/^[a-z0-9][a-z0-9._-]{2,39}$/.test(username)||typeof password!=='string'||password.length<12||password.length>128||typeof display_name!=='string'||!display_name.trim()||display_name.length>150)return reply({error:'Check account fields. Password must have 12–128 characters.'},400);
 const hash=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(token))),x=>x.toString(16).padStart(2,'0')).join('');
 const key=JSON.parse(Deno.env.get('SUPABASE_SECRET_KEYS')||'{}').default||Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
 const server=createClient(Deno.env.get('SUPABASE_URL')!,key,{auth:{persistSession:false,autoRefreshToken:false}});
 const valid=await server.rpc('valid_owner_setup',{provided_hash:hash});if(valid.error||!valid.data)return reply({error:'This setup link is expired or has already been used.'},403);
 const created=await server.auth.admin.createUser({email:username+'@staff.gd.invalid',password,email_confirm:true});
 if(created.error)return reply({error:created.error.message},400);
 const init=await server.rpc('initialize_owner',{provided_hash:hash,target_user_id:created.data.user.id,staff_name:display_name.trim(),staff_username:username});
 if(init.error){await server.auth.admin.deleteUser(created.data.user.id);return reply({error:'Setup not completed: '+init.error.message},400)}
 return reply({success:true});
 }catch{return reply({error:'Unable to initialize account'},500)}
});
