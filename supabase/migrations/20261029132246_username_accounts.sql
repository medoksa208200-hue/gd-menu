begin;
alter table public.profiles add column username text unique check(username is null or username ~ '^[a-z0-9][a-z0-9._-]{2,39}$');
revoke update(username) on public.profiles from authenticated;
create function public.provision_staff_account(target_user_id uuid,staff_name text,staff_username text,role_name text) returns void language plpgsql security definer set search_path='' as $$
declare r uuid;
begin
 if role_name not in ('admin','supervisor','viewer') then raise exception 'Invalid staff role'; end if;
 select id into r from public.roles where name=role_name;
 insert into public.profiles(id,display_name,username) values(target_user_id,staff_name,staff_username);
 insert into public.user_roles(user_id,role_id) values(target_user_id,r);
end $$;
revoke all on function public.provision_staff_account(uuid,text,text,text) from public,anon,authenticated;
grant execute on function public.provision_staff_account(uuid,text,text,text) to service_role;
revoke execute on function public.provision_invited_staff(uuid,text,text) from service_role;
create function public.valid_owner_setup(provided_hash text) returns boolean language sql stable security definer set search_path='' as $$
 select exists(select 1 from private.system_settings where key='owner_setup' and value->>'hash'=provided_hash and (value->>'expires_at')::timestamptz>now())
 and not exists(select 1 from public.user_roles ur join public.roles r on r.id=ur.role_id where r.name='super_admin');
$$;
create function public.initialize_owner(provided_hash text,target_user_id uuid,staff_name text,staff_username text) returns void language plpgsql security definer set search_path='' as $$
begin
 perform pg_advisory_xact_lock(71490002);
 if not public.valid_owner_setup(provided_hash) then raise exception 'Setup link expired or already used' using errcode='42501'; end if;
 insert into public.profiles(id,display_name,username) values(target_user_id,staff_name,staff_username);
 insert into public.user_roles(user_id,role_id) select target_user_id,id from public.roles where name='super_admin';
 delete from private.system_settings where key='owner_setup';
end $$;
revoke all on function public.valid_owner_setup(text),public.initialize_owner(text,uuid,text,text) from public,anon,authenticated;
grant execute on function public.valid_owner_setup(text),public.initialize_owner(text,uuid,text,text) to service_role;
commit;
