-- Night Shooters (2026-11-10): Nash, Titus and Tatum check off no-hoop shooting drills each
-- night and see each other's progress. Page: /shooting/
-- Paste into Supabase → SQL Editor → New query → Run. Safe to run again.
-- Needs setup.sql first (it defines touch_updated_at).

create table if not exists shooting_sets (
  id text primary key,                  -- night|player|drill|set
  day date not null,                    -- the night it counts for (before 3 AM = the night before)
  player text not null check (player in ('Nash', 'Titus', 'Tatum')),
  drill text not null check (char_length(drill) between 1 and 20),
  set_no int not null check (set_no between 1 and 20),
  done boolean not null default true,   -- unticking sets this false; nothing is deleted
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists shooting_sets_day on shooting_sets (day);

drop trigger if exists shooting_sets_touch on shooting_sets;
create trigger shooting_sets_touch before insert or update on shooting_sets for each row execute function touch_updated_at();

-- No accounts: the site's public key can read, add and change check-offs, never delete them.
alter table shooting_sets enable row level security;
drop policy if exists "site reads shooting" on shooting_sets;
create policy "site reads shooting" on shooting_sets for select to anon, authenticated using (true);
drop policy if exists "site adds shooting" on shooting_sets;
create policy "site adds shooting" on shooting_sets for insert to anon, authenticated with check (true);
drop policy if exists "site changes shooting" on shooting_sets;
create policy "site changes shooting" on shooting_sets for update to anon, authenticated using (true) with check (true);
grant select, insert, update on shooting_sets to anon, authenticated;
grant all on shooting_sets to service_role;

select 'Night Shooters is ready' as status;
