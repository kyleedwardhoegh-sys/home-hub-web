-- Hoegh Training Hub: fast database (Supabase), 2026-10-14.
-- Paste this whole file into Supabase → SQL Editor → New query → Run.
-- Safe to run again (it never deletes data).
--
-- The Google Sheet stays the place to edit drills, plans and prizes. The Sheet's Apps
-- Script publishes a computer-friendly copy of that plan into site_data, and copies
-- check-offs from set_log back into the Sheet's "Set Log" tab every 5 minutes.

create table if not exists site_data (
  id text primary key,                 -- 'players', 'plan:Nellie', 'events:Nellie', ...
  data jsonb not null,
  updated_at timestamptz not null default now()
);

create table if not exists set_log (
  id text primary key,                 -- date|player|track|activity|set (same Key as the Sheet)
  day date not null,
  player text not null,
  track text not null,
  activity text not null,
  set_no int not null,                 -- 0 = the drill's result (e.g. makes out of 20)
  points numeric not null default 0,
  result numeric,
  done boolean not null default false,
  updated_at timestamptz not null default now()
);
create index if not exists set_log_player_day on set_log (player, day);
create index if not exists set_log_updated on set_log (updated_at);

create table if not exists feedback (
  id text primary key,                 -- player|activity
  player text not null,
  activity text not null,
  activity_name text,
  track text,
  minutes numeric,
  difficulty numeric,
  day date,
  updated_at timestamptz not null default now()
);
create index if not exists feedback_updated on feedback (updated_at);

create table if not exists player_settings (
  player text primary key,
  visual text,
  updated_at timestamptz not null default now()
);

-- The database stamps every change itself, so the Sheet copy never misses one.
create or replace function touch_updated_at() returns trigger language plpgsql as $$
begin new.updated_at := now(); return new; end $$;
drop trigger if exists set_log_touch on set_log;
create trigger set_log_touch before insert or update on set_log for each row execute function touch_updated_at();
drop trigger if exists feedback_touch on feedback;
create trigger feedback_touch before insert or update on feedback for each row execute function touch_updated_at();
drop trigger if exists player_settings_touch on player_settings;
create trigger player_settings_touch before insert or update on player_settings for each row execute function touch_updated_at();

-- Everything one kid's screen needs, in one fast call.
create or replace function hub(p_player text, p_day date) returns json
language sql stable set search_path = public as $$
  select json_build_object(
    'plan',    (select data from site_data where id = 'plan:' || p_player),
    'players', (select data from site_data where id = 'players'),
    'events',  (select data from site_data where id = 'events:' || p_player),
    'byDay',   coalesce((select json_object_agg(d, p) from (
                  select day::text as d, sum(points) as p from set_log
                  where player = p_player and set_no > 0 and done group by day) x), '{}'::json),
    'done',    coalesce((select json_agg(track || '|' || activity || '|' || set_no) from set_log
                  where player = p_player and day = p_day and set_no > 0 and done), '[]'::json),
    'results', coalesce((select json_agg(json_build_object('day', day::text, 'track', track, 'activity', activity, 'value', result) order by day, updated_at)
                  from set_log where player = p_player and set_no = 0 and result is not null), '[]'::json),
    'feedback', coalesce((select json_agg(activity) from feedback where player = p_player), '[]'::json),
    'visual',  (select visual from player_settings where player = p_player)
  )
$$;

-- Who can do what. The website uses the public "publishable" (anon) key: it can read
-- the plan and add or change check-offs, ratings and bomb/thermometer, but never
-- delete anything or change the plan. Only the Sheet's script (secret key) writes the plan.
alter table site_data enable row level security;
alter table set_log enable row level security;
alter table feedback enable row level security;
alter table player_settings enable row level security;

drop policy if exists "site reads plan" on site_data;
create policy "site reads plan" on site_data for select to anon, authenticated using (true);

drop policy if exists "site reads log" on set_log;
create policy "site reads log" on set_log for select to anon, authenticated using (true);
drop policy if exists "site adds log" on set_log;
create policy "site adds log" on set_log for insert to anon, authenticated with check (true);
drop policy if exists "site changes log" on set_log;
create policy "site changes log" on set_log for update to anon, authenticated using (true) with check (true);

drop policy if exists "site reads feedback" on feedback;
create policy "site reads feedback" on feedback for select to anon, authenticated using (true);
drop policy if exists "site adds feedback" on feedback;
create policy "site adds feedback" on feedback for insert to anon, authenticated with check (true);
drop policy if exists "site changes feedback" on feedback;
create policy "site changes feedback" on feedback for update to anon, authenticated using (true) with check (true);

drop policy if exists "site reads settings" on player_settings;
create policy "site reads settings" on player_settings for select to anon, authenticated using (true);
drop policy if exists "site adds settings" on player_settings;
create policy "site adds settings" on player_settings for insert to anon, authenticated with check (true);
drop policy if exists "site changes settings" on player_settings;
create policy "site changes settings" on player_settings for update to anon, authenticated using (true) with check (true);

grant usage on schema public to anon, authenticated, service_role;
grant select on site_data to anon, authenticated;
grant select, insert, update on set_log, feedback, player_settings to anon, authenticated;
grant all on site_data, set_log, feedback, player_settings to service_role;
grant execute on function hub(text, date) to anon, authenticated, service_role;

select 'Training Hub database is ready' as status;
