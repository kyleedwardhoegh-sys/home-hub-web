-- Home Hub v2, Phase 2 (2026-11-25): the kids' engine (stars, chores, rewards, trip mode).
-- Paste into Supabase → SQL Editor → New query → Run. Safe to run again.
-- Needs setup.sql first (it defines touch_updated_at).
-- Until this is run, /hub/ keeps stars on the device it was tapped on and uploads them the
-- first time these tables answer.

-- Every star in or out is one row (a ledger). Unchecking a chore sets status 'undone';
-- a refunded reward is 'cancelled'. Nothing is ever deleted.
create table if not exists stars (
  id text primary key,                 -- day|kid|chore|<chore id>, day|kid|training, day|kid|alldone, spend|kid|<ms>, bonus|kid|<ms>
  kid text not null,                   -- 'Nellie' or 'Nash'
  day date not null,
  kind text not null,                  -- chore | training | alldone | bonus | spend
  item text,                           -- chore / reward id
  title text,
  stars int not null default 0,        -- negative for spending
  status text not null default 'ok',   -- ok | undone | owed (bought, not handed out yet) | given | cancelled
  note text,
  updated_at timestamptz not null default now()
);
create index if not exists stars_kid_day on stars (kid, day);

-- What the kids see: chores, rewards (a kid's wish has stars = null until a parent prices it),
-- and trips (data = {from, to}; to null = still away).
create table if not exists kid_setup (
  id text primary key,
  kind text not null,                  -- chore | reward | trip
  kid text not null default 'Both',    -- 'Nellie', 'Nash' or 'Both'
  title text not null,
  emoji text,
  stars int,
  data jsonb,                          -- chore: {days:[0-6]} (0 = Sunday; missing = every day); reward: {minutes, by}
  removed boolean not null default false,
  sort int not null default 0,
  updated_at timestamptz not null default now()
);

drop trigger if exists stars_touch on stars;
create trigger stars_touch before insert or update on stars for each row execute function touch_updated_at();
drop trigger if exists kid_setup_touch on kid_setup;
create trigger kid_setup_touch before insert or update on kid_setup for each row execute function touch_updated_at();

-- Balances in one small read (the ledger grows every day).
create or replace view star_totals with (security_invoker = true) as
  select kid,
         sum(case when status in ('ok', 'owed', 'given') then stars else 0 end)::int as balance,
         sum(case when status = 'ok' and stars > 0 then stars else 0 end)::int as earned
  from stars group by kid;

alter table stars enable row level security;
alter table kid_setup enable row level security;

drop policy if exists "site reads stars" on stars;
create policy "site reads stars" on stars for select to anon, authenticated using (true);
drop policy if exists "site adds stars" on stars;
create policy "site adds stars" on stars for insert to anon, authenticated with check (true);
drop policy if exists "site changes stars" on stars;
create policy "site changes stars" on stars for update to anon, authenticated using (true) with check (true);

drop policy if exists "site reads kid_setup" on kid_setup;
create policy "site reads kid_setup" on kid_setup for select to anon, authenticated using (true);
drop policy if exists "site adds kid_setup" on kid_setup;
create policy "site adds kid_setup" on kid_setup for insert to anon, authenticated with check (true);
drop policy if exists "site changes kid_setup" on kid_setup;
create policy "site changes kid_setup" on kid_setup for update to anon, authenticated using (true) with check (true);

grant select, insert, update on stars, kid_setup to anon, authenticated;
grant select on star_totals to anon, authenticated;
grant all on stars, kid_setup to service_role;

select 'Stars and chores are ready' as status;
