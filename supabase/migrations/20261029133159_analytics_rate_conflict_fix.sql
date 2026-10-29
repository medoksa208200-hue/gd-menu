create or replace function public.ingest_catalog_event(visitor_hash text,event_type text,target_mold uuid default null,query_text text default null) returns boolean language plpgsql security definer set search_path='' as $$
declare used integer; window_key timestamptz:=date_trunc('hour',now());
begin
 if length(visitor_hash)<>64 or event_type not in ('view','search') then return false; end if;
 insert into private.analytics_rate values(visitor_hash,window_key,1)
 on conflict on constraint analytics_rate_pkey do update set requests=private.analytics_rate.requests+1 returning requests into used;
 if used>120 then return false; end if;
 if target_mold is not null and not exists(select 1 from public.catalog_molds where id=target_mold) then return false; end if;
 if event_type='view' and target_mold is not null then
  if not exists(select 1 from public.mold_views where mold_id=target_mold and session_hash=visitor_hash and viewed_at>=current_date) then
   insert into public.mold_views(mold_id,session_hash) values(target_mold,visitor_hash);
  end if;
 elsif event_type='search' and length(btrim(query_text)) between 1 and 200 then
  insert into public.mold_search_events(query,matched_mold_id) values(query_text,target_mold);
 end if;
 delete from private.analytics_rate where window_start<now()-interval '2 days';
 return true;
end $$;

