-- Hoegh household tools (2026-10-19): who's driving, shared lists, countdowns.
-- Used by Kyle's and Logan's boards on the kitchen dashboard (and phones).
-- Paste into Supabase → SQL Editor → New query → Run. Safe to run again.
-- Needs setup.sql first (it defines touch_updated_at).

create table if not exists drives (
  id text primary key,                 -- day|event title|time
  day date not null,
  title text,
  driver text,                         -- 'Kyle', 'Logan' or null
  updated_at timestamptz not null default now()
);

create table if not exists household_items (
  id text primary key,
  list text not null,                  -- 'groceries' or 'todo'
  text text not null,
  done boolean not null default false,
  removed boolean not null default false,
  added_by text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists household_items_live on household_items (removed, created_at);

create table if not exists countdowns (
  id text primary key,
  title text not null,
  day date not null,
  emoji text,
  removed boolean not null default false,
  added_by text,
  updated_at timestamptz not null default now()
);

drop trigger if exists drives_touch on drives;
create trigger drives_touch before insert or update on drives for each row execute function touch_updated_at();
drop trigger if exists household_items_touch on household_items;
create trigger household_items_touch before insert or update on household_items for each row execute function touch_updated_at();
drop trigger if exists countdowns_touch on countdowns;
create trigger countdowns_touch before insert or update on countdowns for each row execute function touch_updated_at();

-- The site's public key can read, add and change these (never delete: removing an item
-- just marks it removed).
alter table drives enable row level security;
alter table household_items enable row level security;
alter table countdowns enable row level security;

drop policy if exists "site reads drives" on drives;
create policy "site reads drives" on drives for select to anon, authenticated using (true);
drop policy if exists "site adds drives" on drives;
create policy "site adds drives" on drives for insert to anon, authenticated with check (true);
drop policy if exists "site changes drives" on drives;
create policy "site changes drives" on drives for update to anon, authenticated using (true) with check (true);

drop policy if exists "site reads items" on household_items;
create policy "site reads items" on household_items for select to anon, authenticated using (true);
drop policy if exists "site adds items" on household_items;
create policy "site adds items" on household_items for insert to anon, authenticated with check (true);
drop policy if exists "site changes items" on household_items;
create policy "site changes items" on household_items for update to anon, authenticated using (true) with check (true);

drop policy if exists "site reads countdowns" on countdowns;
create policy "site reads countdowns" on countdowns for select to anon, authenticated using (true);
drop policy if exists "site adds countdowns" on countdowns;
create policy "site adds countdowns" on countdowns for insert to anon, authenticated with check (true);
drop policy if exists "site changes countdowns" on countdowns;
create policy "site changes countdowns" on countdowns for update to anon, authenticated using (true) with check (true);

grant select, insert, update on drives, household_items, countdowns to anon, authenticated;
grant all on drives, household_items, countdowns to service_role;

select 'Household tools are ready' as status;
