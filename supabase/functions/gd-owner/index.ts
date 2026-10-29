import {staffIdentity} from '../_shared/staff-identity.mjs';
import {validPassword} from '../_shared/password-policy.mjs';
import {createClient} from 'npm:@supabase/supabase-js@2.104.0';
const headers={'Access-Control-Allow-Origin':'*','Access-Control-Allow-Headers':'authorization, x-client-info, apikey, content-type','Content-Type':'application/json'};
Deno.serve(async(req:Request)=>{
 if(req.method==='OPTIONS')return new Response(null,{headers});
 const reply=(body:unknown,status=200)=>new Response(JSON.stringify(body),{status,headers});
 if(req.method!=='POST')return reply({error:'Method not allowed'},405);
 try{
 const {token,username,password,display_name,action}=await req.json();
 if(typeof token!=='string'||token.trim().length<40||token.trim().length>100)return reply({error:'كود التهيئة غير صحيح. انسخه كاملًا بدون مسافات.',code:'invalid_setup_code'},400);
 const hash=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(token.trim()))),x=>x.toString(16).padStart(2,'0')).join('');
 const key=JSON.parse(Deno.env.get('SUPABASE_SECRET_KEYS')||'{}').default||Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
 const server=createClient(Deno.env.get('SUPABASE_URL')!,key,{auth:{persistSession:false,autoRefreshToken:false}});
 const valid=await server.rpc('valid_owner_setup',{provided_hash:hash});
 if(valid.error){console.error('owner_setup_validation_failed',valid.error.code,valid.error.message);return reply({error:'تعذّر التحقق من التهيئة على الخادم. حاول مرة أخرى.',code:'setup_backend_unavailable',detail:valid.error.message},503)}
 if(!valid.data)return reply({error:'كود التهيئة غير صحيح أو انتهت صلاحيته أو تم استخدامه بالفعل.',code:'setup_unavailable'},403);
 if(action==='check_setup')return reply({valid:true});
 if(typeof username!=='string'||!/^[a-z0-9][a-z0-9._-]{2,39}$/.test(username))return reply({error:'اسم المستخدم من 3 إلى 40 حرفًا إنجليزيًا صغيرًا أو رقمًا، ويمكن استخدام . أو - أو _',code:'invalid_username'},400);
 if(!validPassword(password))return reply({error:'كلمة المرور: 8 أحرف على الأقل، مع حرف كبير وحرف صغير ورقم ورمز خاص.',code:'weak_password'},400);
 if(typeof display_name!=='string'||!display_name.trim()||display_name.length>150)return reply({error:'أدخل الاسم بشكل صحيح.',code:'invalid_name'},400);
 const created=await server.auth.admin.createUser({email:staffIdentity(username,Deno.env.get('SUPABASE_URL')!),password,email_confirm:true});
 if(created.error){console.error('owner_auth_creation_failed',created.error.code,created.error.message);return reply({error:created.error.message,code:created.error.code||'account_creation_failed'},400)}
 const init=await server.rpc('initialize_owner',{provided_hash:hash,target_user_id:created.data.user.id,staff_name:display_name.trim(),staff_username:username});
 if(init.error){await server.auth.admin.deleteUser(created.data.user.id);console.error('owner_profile_creation_failed',init.error.code,init.error.message);return reply({error:'تعذّر حفظ حساب المدير. '+init.error.message,code:'owner_profile_failed'},400)}
 return reply({success:true});
 }catch(e){console.error('owner_setup_exception',e instanceof Error?e.message:'unknown');return reply({error:'تعذّر إتمام تهيئة الحساب. حاول مرة أخرى.',code:'setup_failed'},500)}
});
