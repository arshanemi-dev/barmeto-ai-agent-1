-- Apply through the Supabase CLI or SQL editor after reviewing your project.
-- The desktop never needs a service-role key.
begin;
create table if not exists public.workflows (
  id uuid primary key,
  owner_id uuid not null references auth.users(id) on delete cascade,
  name text not null check (char_length(name) between 2 and 80),
  revision integer not null check (revision > 0),
  definition jsonb not null,
  updated_at timestamptz not null default now()
);
create table if not exists public.workflow_revisions (
  workflow_id uuid not null references public.workflows(id) on delete cascade,
  revision integer not null,
  definition jsonb not null,
  created_at timestamptz not null default now(),
  primary key (workflow_id, revision)
);
create table if not exists public.runs (
  id uuid primary key,
  owner_id uuid not null references auth.users(id) on delete cascade,
  workflow_id uuid,
  summary jsonb not null,
  created_at timestamptz not null default now()
);
create table if not exists public.applications (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users(id),
  slug text not null unique check (slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$'),
  name text not null,
  description text not null default '',
  status text not null default 'draft' check (status in ('draft','live','paused','retired')),
  created_at timestamptz not null default now()
);
create table if not exists public.application_members (
  application_id uuid not null references public.applications(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  role text not null check (role in ('viewer','publisher')),
  primary key (application_id,user_id)
);
create table if not exists public.platform_roles (
  user_id uuid primary key references auth.users(id) on delete cascade,
  role text not null check (role = 'master_admin')
);
-- Bootstrap master admin from a trusted SQL session. No client write policy.
create or replace function public.is_master_admin() returns boolean
language sql stable security definer set search_path = '' as $$
  select exists(select 1 from public.platform_roles where user_id = auth.uid() and role = 'master_admin');
$$;
revoke all on function public.is_master_admin() from public;
grant execute on function public.is_master_admin() to authenticated;
create or replace function public.can_access_app(app_id uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select public.is_master_admin() or exists(select 1 from public.applications a where a.id = app_id and a.owner_id = auth.uid())
  or exists(select 1 from public.application_members m where m.application_id = app_id and m.user_id = auth.uid());
$$;
revoke all on function public.can_access_app(uuid) from public;
grant execute on function public.can_access_app(uuid) to authenticated;
create table if not exists public.releases (
  id uuid primary key default gen_random_uuid(),
  application_id uuid not null references public.applications(id),
  version text not null check (version ~ '^[0-9]+\.[0-9]+\.[0-9]+$'),
  change_type text not null check (change_type in ('first','major','minor','patch')),
  notes text not null,
  status text not null default 'draft' check (status in ('draft','published','withdrawn')),
  platform text not null default 'win32',
  architecture text not null default 'x64',
  artifact_path text,
  sha512 text,
  bytes bigint,
  created_at timestamptz not null default now(),
  unique(application_id,version,platform,architecture),
  check (status <> 'published' or (artifact_path is not null and sha512 is not null and bytes > 0))
);
create table if not exists public.task_rules (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  definition jsonb not null,
  revision integer not null default 1,
  enabled boolean not null default true,
  archived boolean not null default false,
  updated_at timestamptz not null default now()
);
create table if not exists public.admin_audit_events (
  id uuid primary key default gen_random_uuid(),
  actor_id uuid,
  action text not null,
  target_id uuid,
  occurred_at timestamptz not null default now()
);
create or replace function public.audit_admin_change() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  insert into public.admin_audit_events(actor_id,action,target_id)
  values (auth.uid(),tg_table_name || ':' || tg_op,case when tg_op = 'DELETE' then old.id else new.id end);
  if tg_op = 'DELETE' then return old; end if;
  return new;
end;
$$;
create trigger applications_audit after insert or update or delete on public.applications for each row execute function public.audit_admin_change();
create trigger releases_audit after insert or update or delete on public.releases for each row execute function public.audit_admin_change();
create trigger task_rules_audit after insert or update or delete on public.task_rules for each row execute function public.audit_admin_change();

alter table public.workflows enable row level security;
alter table public.workflow_revisions enable row level security;
alter table public.runs enable row level security;
alter table public.applications enable row level security;
alter table public.application_members enable row level security;
alter table public.platform_roles enable row level security;
alter table public.releases enable row level security;
alter table public.task_rules enable row level security;
alter table public.admin_audit_events enable row level security;

create policy own_workflows on public.workflows for all to authenticated using (owner_id = auth.uid()) with check (owner_id = auth.uid());
create policy own_revisions_read on public.workflow_revisions for select to authenticated using (exists(select 1 from public.workflows w where w.id = workflow_id and w.owner_id = auth.uid()));
create policy own_revisions_insert on public.workflow_revisions for insert to authenticated with check (exists(select 1 from public.workflows w where w.id = workflow_id and w.owner_id = auth.uid()));
create policy own_runs on public.runs for all to authenticated using (owner_id = auth.uid()) with check (owner_id = auth.uid());
create policy app_read on public.applications for select to authenticated using (public.can_access_app(id));
create policy app_admin on public.applications for all to authenticated using (public.is_master_admin()) with check (public.is_master_admin());
create policy member_read on public.application_members for select to authenticated using (user_id = auth.uid() or public.is_master_admin());
create policy member_admin on public.application_members for all to authenticated using (public.is_master_admin()) with check (public.is_master_admin());
create policy role_read on public.platform_roles for select to authenticated using (user_id = auth.uid());
create policy release_read on public.releases for select to authenticated using ((status = 'published' and public.can_access_app(application_id)) or public.is_master_admin());
-- No desktop write policy for releases: trusted build/publication procedure is required.
create policy rule_read on public.task_rules for select to authenticated using (true);
create policy rule_admin on public.task_rules for all to authenticated using (public.is_master_admin()) with check (public.is_master_admin());
create policy audit_read on public.admin_audit_events for select to authenticated using (public.is_master_admin());
create index workflows_owner_idx on public.workflows(owner_id,updated_at desc);
create index runs_owner_idx on public.runs(owner_id,created_at desc);
create index releases_app_idx on public.releases(application_id,created_at desc);

insert into storage.buckets(id,name,public) values ('applications','applications',false) on conflict (id) do nothing;
create policy release_download on storage.objects for select to authenticated using (
  bucket_id = 'applications' and exists (
    select 1 from public.releases r join public.applications a on a.id = r.application_id
    where r.artifact_path = storage.objects.name and r.status = 'published' and a.status = 'live' and public.can_access_app(a.id)
  )
);
commit;
