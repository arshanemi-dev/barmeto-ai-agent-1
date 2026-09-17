begin;
-- Enforce MFA in RLS as well as the hosted API; direct REST calls cannot bypass it.
create or replace function public.is_master_admin() returns boolean
language sql stable security definer set search_path = '' as $$
  select coalesce(auth.jwt()->>'aal','') = 'aal2' and exists(
    select 1 from public.platform_roles where user_id = auth.uid() and role = 'master_admin'
  );
$$;
create or replace function public.reserve_release_draft(app_id uuid,bump text,release_notes text)
returns public.releases language plpgsql security definer set search_path = '' as $$
declare prior text; parts integer[]; next_version text; result public.releases;
begin
  if not public.is_master_admin() then raise exception 'Master admin with MFA required'; end if;
  if bump not in ('major','minor','patch') or length(trim(release_notes)) < 5 or length(release_notes) > 5000 then raise exception 'Invalid release parameters'; end if;
  perform 1 from public.applications where id = app_id for update;
  if not found then raise exception 'Application not found'; end if;
  select version into prior from public.releases where application_id = app_id
    order by string_to_array(version,'.')::integer[] desc limit 1;
  if prior is null then next_version := '1.0.0';
  else
    parts := string_to_array(prior,'.')::integer[];
    if bump = 'major' then parts := array[parts[1]+1,0,0];
    elsif bump = 'minor' then parts := array[parts[1],parts[2]+1,0];
    else parts[3] := parts[3]+1; end if;
    next_version := array_to_string(parts,'.');
  end if;
  insert into public.releases(application_id,version,change_type,notes)
    values(app_id,next_version,case when prior is null then 'first' else bump end,release_notes)
    returning * into result;
  return result;
end;
$$;
revoke all on function public.reserve_release_draft(uuid,text,text) from public;
grant execute on function public.reserve_release_draft(uuid,text,text) to authenticated;
commit;
