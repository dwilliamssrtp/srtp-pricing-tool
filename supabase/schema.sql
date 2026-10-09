-- =====================================================================
-- SRTP Pricing Tool — current database schema
-- Project: mkgbaprutwznmvegpqak (SRTP Pricing Tool, us-east-1)
--
-- This is the CURRENT STATE, suitable for rebuilding from scratch. The live
-- project also holds the incremental migration history under
-- supabase_migrations.schema_migrations.
--
-- Design notes:
--   * No prices live in the client source. They live here, behind RLS. That is
--     what allows the GitHub repo to be public.
--   * Signing up does NOT grant access: profiles.is_active defaults to false
--     and an admin must switch it on.
--   * Access helpers live in schema `private`, which PostgREST does not expose,
--     so they cannot be called via /rest/v1/rpc.
-- =====================================================================

-- ---------------------------------------------------------------- profiles
create table if not exists public.profiles (
  id          uuid primary key references auth.users(id) on delete cascade,
  email       text not null,
  full_name   text,
  role        text not null default 'viewer'
                check (role in ('viewer','estimator','admin')),
  is_active   boolean not null default false,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

comment on table public.profiles is
  'One row per auth user. is_active must be set true by an admin before the user can read anything.';

create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  insert into public.profiles (id, email, full_name)
  values (new.id, new.email, new.raw_user_meta_data ->> 'full_name')
  on conflict (id) do nothing;
  return new;
end;
$$;

create or replace function public.touch_updated_at()
returns trigger language plpgsql set search_path = '' as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

-- Postgres grants EXECUTE to PUBLIC on new functions by default. Trigger
-- functions are invoked by the trigger mechanism, which does not check the
-- caller's privilege, so revoking is safe and keeps them off the REST API.
revoke execute on function public.handle_new_user()  from public, anon, authenticated;
revoke execute on function public.touch_updated_at() from public, anon, authenticated;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

drop trigger if exists profiles_touch on public.profiles;
create trigger profiles_touch
  before update on public.profiles
  for each row execute function public.touch_updated_at();

-- -------------------------------------------------------- access helpers
create schema if not exists private;
revoke all on schema private from anon, authenticated;
grant usage on schema private to authenticated;

create or replace function private.is_active_member()
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.profiles p
                 where p.id = (select auth.uid()) and p.is_active);
$$;

create or replace function private.can_edit()
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.profiles p
                 where p.id = (select auth.uid()) and p.is_active
                   and p.role in ('estimator','admin'));
$$;

create or replace function private.is_admin()
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.profiles p
                 where p.id = (select auth.uid()) and p.is_active and p.role = 'admin');
$$;

grant execute on function private.is_active_member(), private.can_edit(), private.is_admin()
  to authenticated;

-- ------------------------------------------------------------- price book
-- The workbook carried three competing price sets with no way to say which was
-- in force. This replaces that with dated, named versions; exactly one active.
create table if not exists public.price_books (
  id             uuid primary key default gen_random_uuid(),
  name           text not null,
  effective_from date not null default current_date,
  status         text not null default 'draft'
                   check (status in ('draft','active','archived')),
  notes          text,
  created_by     uuid references public.profiles(id),
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);

create unique index if not exists price_books_one_active
  on public.price_books ((status)) where status = 'active';

create table if not exists public.price_book_items (
  id            uuid primary key default gen_random_uuid(),
  price_book_id uuid not null references public.price_books(id) on delete cascade,
  kind          text not null check (kind in ('polymer','braid','coupling')),
  item_key      text not null,
  price         numeric(12,4) not null check (price >= 0),
  unit          text not null default '$/lb',
  source_note   text,
  unique (price_book_id, kind, item_key)
);

comment on column public.price_book_items.item_key is
  'Matches the key used by srtp-data.js: a MATERIALS key, or a BRAID key.';

create index if not exists price_book_items_book
  on public.price_book_items (price_book_id, kind);

drop trigger if exists price_books_touch on public.price_books;
create trigger price_books_touch
  before update on public.price_books
  for each row execute function public.touch_updated_at();

-- ---------------------------------------------------------------- designs
-- `inputs` is the engine's input object verbatim, so a design always replays
-- exactly. `summary` is only a cache so the list view need not run the engine.
create table if not exists public.designs (
  id            uuid primary key default gen_random_uuid(),
  name          text not null,
  client        text,
  notes         text,
  inputs        jsonb not null,
  summary       jsonb,
  price_book_id uuid references public.price_books(id),
  created_by    uuid not null references public.profiles(id) default auth.uid(),
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

comment on column public.designs.inputs is
  'Verbatim engine input object. Source of truth; summary is a cache.';
comment on column public.designs.price_book_id is
  'The price book in force when this design was last costed.';

create index if not exists designs_client     on public.designs (client);
create index if not exists designs_created    on public.designs (created_at desc);
create index if not exists designs_name_lower on public.designs (lower(name));

drop trigger if exists designs_touch on public.designs;
create trigger designs_touch
  before update on public.designs
  for each row execute function public.touch_updated_at();

-- -------------------------------------------------------------------- RLS
alter table public.profiles         enable row level security;
alter table public.price_books      enable row level security;
alter table public.price_book_items enable row level security;
alter table public.designs          enable row level security;

-- You can always see your own row, so the app can say "pending approval".
create policy profiles_select_self on public.profiles
  for select to authenticated using (id = (select auth.uid()));

create policy profiles_select_team on public.profiles
  for select to authenticated using (private.is_active_member());

-- You may edit your own name only; the WITH CHECK blocks self-promotion.
create policy profiles_update_self on public.profiles
  for update to authenticated
  using (id = (select auth.uid()))
  with check (
    id = (select auth.uid())
    and role      = (select p.role      from public.profiles p where p.id = (select auth.uid()))
    and is_active = (select p.is_active from public.profiles p where p.id = (select auth.uid()))
  );

create policy profiles_admin_all on public.profiles
  for all to authenticated
  using (private.is_admin()) with check (private.is_admin());

-- Reading prices requires an active membership. This is the boundary that lets
-- the repo be public.
create policy price_books_select on public.price_books
  for select to authenticated using (private.is_active_member());
create policy price_books_admin on public.price_books
  for all to authenticated
  using (private.is_admin()) with check (private.is_admin());

create policy price_book_items_select on public.price_book_items
  for select to authenticated using (private.is_active_member());
create policy price_book_items_admin on public.price_book_items
  for all to authenticated
  using (private.is_admin()) with check (private.is_admin());

-- Designs are shared across the team.
create policy designs_select on public.designs
  for select to authenticated using (private.is_active_member());
create policy designs_insert on public.designs
  for insert to authenticated
  with check (private.can_edit() and created_by = (select auth.uid()));
create policy designs_update on public.designs
  for update to authenticated
  using (private.can_edit() and (created_by = (select auth.uid()) or private.is_admin()))
  with check (private.can_edit());
create policy designs_delete on public.designs
  for delete to authenticated
  using (created_by = (select auth.uid()) or private.is_admin());
