-- VYBE VAULT - Supabase schema
-- Run this in Supabase SQL Editor.

create extension if not exists pgcrypto;
create extension if not exists citext;

-- ---------- Enums ----------
do $$
begin
  if not exists (select 1 from pg_type where typname = 'membership_tier') then
    create type public.membership_tier as enum ('creator', 'creator_plus', 'creator_plus_plus');
  end if;
end$$;

do $$
begin
  if not exists (select 1 from pg_type where typname = 'membership_status') then
    create type public.membership_status as enum ('inactive', 'active', 'trialing', 'past_due', 'canceled');
  end if;
end$$;

-- ---------- Utility Functions ----------
create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create or replace function public.tier_rank(t public.membership_tier)
returns integer
language sql
immutable
as $$
  select case t
    when 'creator' then 1
    when 'creator_plus' then 2
    when 'creator_plus_plus' then 3
  end;
$$;

create or replace function public.user_has_tier(p_user_id uuid, p_required_tier public.membership_tier)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.entitlements e
    where e.user_id = p_user_id
      and e.status in ('active', 'trialing')
      and (e.current_period_end is null or e.current_period_end > now())
      and public.tier_rank(e.plan) >= public.tier_rank(p_required_tier)
  );
$$;

create or replace function public.can_access_asset(p_user_id uuid, p_asset_path text)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.assets a
    where a.is_published = true
      and a.storage_object_path = p_asset_path
      and public.user_has_tier(p_user_id, a.required_tier)
  );
$$;

-- ---------- Profile ----------
create table if not exists public.profiles (
  user_id uuid primary key references auth.users(id) on delete cascade,
  discord_user_id text unique,
  username text,
  display_name text,
  avatar_url text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

drop trigger if exists trg_profiles_updated_at on public.profiles;
create trigger trg_profiles_updated_at
before update on public.profiles
for each row execute function public.set_updated_at();

-- Bootstrap profile row when a new auth user is created.
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  md jsonb := coalesce(new.raw_user_meta_data, '{}'::jsonb);
begin
  insert into public.profiles (
    user_id,
    discord_user_id,
    username,
    display_name,
    avatar_url
  )
  values (
    new.id,
    md->>'provider_id',
    coalesce(md->>'user_name', md->>'preferred_username', md->>'name'),
    coalesce(md->>'full_name', md->>'name', md->>'user_name'),
    md->>'avatar_url'
  )
  on conflict (user_id) do update
    set discord_user_id = coalesce(excluded.discord_user_id, public.profiles.discord_user_id),
        username        = coalesce(excluded.username, public.profiles.username),
        display_name    = coalesce(excluded.display_name, public.profiles.display_name),
        avatar_url      = coalesce(excluded.avatar_url, public.profiles.avatar_url),
        updated_at      = now();
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
after insert on auth.users
for each row execute function public.handle_new_user();

-- ---------- Entitlements (source of truth for access tier) ----------
create table if not exists public.entitlements (
  user_id uuid primary key references auth.users(id) on delete cascade,
  plan public.membership_tier not null default 'creator',
  status public.membership_status not null default 'inactive',
  provider text not null default 'manual',
  provider_customer_id text,
  provider_subscription_id text,
  current_period_start timestamptz,
  current_period_end timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists entitlements_status_idx on public.entitlements(status);
create unique index if not exists entitlements_provider_sub_uidx
  on public.entitlements(provider, provider_subscription_id)
  where provider_subscription_id is not null;

drop trigger if exists trg_entitlements_updated_at on public.entitlements;
create trigger trg_entitlements_updated_at
before update on public.entitlements
for each row execute function public.set_updated_at();

-- ---------- Ko-fi account linking + webhook idempotency ----------
create table if not exists public.kofi_links (
  user_id uuid primary key references auth.users(id) on delete cascade,
  kofi_email citext unique,
  kofi_member_id text unique,
  kofi_username text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

drop trigger if exists trg_kofi_links_updated_at on public.kofi_links;
create trigger trg_kofi_links_updated_at
before update on public.kofi_links
for each row execute function public.set_updated_at();

create table if not exists public.kofi_webhook_events (
  id uuid primary key default gen_random_uuid(),
  event_uid text not null unique,
  payload jsonb not null,
  status text not null default 'received',
  error text,
  received_at timestamptz not null default now(),
  processed_at timestamptz
);

-- ---------- Assets ----------
create table if not exists public.assets (
  id uuid primary key default gen_random_uuid(),
  slug text not null unique,
  title text not null,
  description text,
  required_tier public.membership_tier not null default 'creator',
  tags text[] not null default '{}'::text[],
  storage_object_path text not null unique,
  is_published boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Backfill for existing projects where table was created before tags column existed.
alter table public.assets
  add column if not exists tags text[] not null default '{}'::text[];

create index if not exists assets_required_tier_idx on public.assets(required_tier);
create index if not exists assets_is_published_idx on public.assets(is_published);
create index if not exists assets_tags_gin_idx on public.assets using gin (tags);

drop trigger if exists trg_assets_updated_at on public.assets;
create trigger trg_assets_updated_at
before update on public.assets
for each row execute function public.set_updated_at();

-- Optional audit table.
create table if not exists public.asset_downloads (
  id bigint generated always as identity primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  asset_id uuid not null references public.assets(id) on delete cascade,
  downloaded_at timestamptz not null default now()
);

create index if not exists asset_downloads_user_idx on public.asset_downloads(user_id);
create index if not exists asset_downloads_asset_idx on public.asset_downloads(asset_id);

-- Site admins can upload/edit assets. Populate this table manually with your user_id.
create table if not exists public.site_admins (
  user_id uuid primary key references auth.users(id) on delete cascade,
  created_at timestamptz not null default now()
);

create or replace function public.is_site_admin(p_user_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.site_admins sa
    where sa.user_id = p_user_id
  );
$$;

-- ---------- RLS ----------
alter table public.profiles enable row level security;
alter table public.entitlements enable row level security;
alter table public.kofi_links enable row level security;
alter table public.kofi_webhook_events enable row level security;
alter table public.assets enable row level security;
alter table public.asset_downloads enable row level security;
alter table public.site_admins enable row level security;

-- profiles: user can read/write own.
drop policy if exists "profiles_select_own" on public.profiles;
create policy "profiles_select_own"
on public.profiles
for select
to authenticated
using (auth.uid() = user_id);

drop policy if exists "profiles_insert_own" on public.profiles;
create policy "profiles_insert_own"
on public.profiles
for insert
to authenticated
with check (auth.uid() = user_id);

drop policy if exists "profiles_update_own" on public.profiles;
create policy "profiles_update_own"
on public.profiles
for update
to authenticated
using (auth.uid() = user_id)
with check (auth.uid() = user_id);

-- entitlements: user can only read own; writes via service role/admin.
drop policy if exists "entitlements_select_own" on public.entitlements;
create policy "entitlements_select_own"
on public.entitlements
for select
to authenticated
using (auth.uid() = user_id);

-- kofi link rows: user can read/write own linking record.
drop policy if exists "kofi_links_select_own" on public.kofi_links;
create policy "kofi_links_select_own"
on public.kofi_links
for select
to authenticated
using (auth.uid() = user_id);

drop policy if exists "kofi_links_insert_own" on public.kofi_links;
create policy "kofi_links_insert_own"
on public.kofi_links
for insert
to authenticated
with check (auth.uid() = user_id);

drop policy if exists "kofi_links_update_own" on public.kofi_links;
create policy "kofi_links_update_own"
on public.kofi_links
for update
to authenticated
using (auth.uid() = user_id)
with check (auth.uid() = user_id);

-- webhook event table: no direct client access.
drop policy if exists "kofi_webhook_events_no_client_access" on public.kofi_webhook_events;
create policy "kofi_webhook_events_no_client_access"
on public.kofi_webhook_events
for all
to authenticated
using (false)
with check (false);

-- assets: authenticated users can see published assets (UI can show locked/unlocked).
drop policy if exists "assets_select_published" on public.assets;
create policy "assets_select_published"
on public.assets
for select
to public
using (is_published = true);

drop policy if exists "assets_select_admin_all" on public.assets;
create policy "assets_select_admin_all"
on public.assets
for select
to authenticated
using (public.is_site_admin(auth.uid()));

drop policy if exists "assets_insert_admin_only" on public.assets;
create policy "assets_insert_admin_only"
on public.assets
for insert
to authenticated
with check (public.is_site_admin(auth.uid()));

drop policy if exists "assets_update_admin_only" on public.assets;
create policy "assets_update_admin_only"
on public.assets
for update
to authenticated
using (public.is_site_admin(auth.uid()))
with check (public.is_site_admin(auth.uid()));

drop policy if exists "assets_delete_admin_only" on public.assets;
create policy "assets_delete_admin_only"
on public.assets
for delete
to authenticated
using (public.is_site_admin(auth.uid()));

-- downloads: user can insert/read own audit rows.
drop policy if exists "asset_downloads_select_own" on public.asset_downloads;
create policy "asset_downloads_select_own"
on public.asset_downloads
for select
to authenticated
using (auth.uid() = user_id);

drop policy if exists "asset_downloads_insert_own" on public.asset_downloads;
create policy "asset_downloads_insert_own"
on public.asset_downloads
for insert
to authenticated
with check (auth.uid() = user_id);

-- site_admins: users can only read their own admin row.
drop policy if exists "site_admins_select_own" on public.site_admins;
create policy "site_admins_select_own"
on public.site_admins
for select
to authenticated
using (auth.uid() = user_id);

-- ---------- Storage bucket + policies ----------
insert into storage.buckets (id, name, public)
values ('asset-files', 'asset-files', false)
on conflict (id) do nothing;

-- Read only if user's entitlement tier covers the asset's required tier.
drop policy if exists "asset_files_read_by_tier" on storage.objects;
create policy "asset_files_read_by_tier"
on storage.objects
for select
to authenticated
using (
  bucket_id = 'asset-files'
  and (
    public.can_access_asset(auth.uid(), name)
    or public.is_site_admin(auth.uid())
  )
);

drop policy if exists "asset_files_insert_none" on storage.objects;
drop policy if exists "asset_files_update_none" on storage.objects;
drop policy if exists "asset_files_delete_none" on storage.objects;

drop policy if exists "asset_files_insert_admin_only" on storage.objects;
create policy "asset_files_insert_admin_only"
on storage.objects
for insert
to authenticated
with check (
  bucket_id = 'asset-files'
  and public.is_site_admin(auth.uid())
);

drop policy if exists "asset_files_update_admin_only" on storage.objects;
create policy "asset_files_update_admin_only"
on storage.objects
for update
to authenticated
using (
  bucket_id = 'asset-files'
  and public.is_site_admin(auth.uid())
)
with check (
  bucket_id = 'asset-files'
  and public.is_site_admin(auth.uid())
);

drop policy if exists "asset_files_delete_admin_only" on storage.objects;
create policy "asset_files_delete_admin_only"
on storage.objects
for delete
to authenticated
using (
  bucket_id = 'asset-files'
  and public.is_site_admin(auth.uid())
);

-- ---------- Helpful default for new users ----------
-- Optional: create a default inactive entitlement row for every new user.
create or replace function public.ensure_default_entitlement()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.entitlements (user_id, plan, status, provider)
  values (new.id, 'creator', 'inactive', 'manual')
  on conflict (user_id) do nothing;
  return new;
end;
$$;

drop trigger if exists on_auth_user_create_default_entitlement on auth.users;
create trigger on_auth_user_create_default_entitlement
after insert on auth.users
for each row execute function public.ensure_default_entitlement();
