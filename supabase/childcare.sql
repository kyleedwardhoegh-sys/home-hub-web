-- Recovery Childcare sign-ups (2026-11-02): replaces SignUpGenius. Page: /childcare/
-- Paste into Supabase → SQL Editor → New query → Run. Safe to run again.
-- Needs setup.sql first (it defines touch_updated_at).

create table if not exists childcare_signups (
  id text primary key,                 -- day|slot|lowercase name
  day date not null check (extract(dow from day) = 0),  -- Sundays only
  slot text not null check (slot in ('Nursery', 'Big Kids')),
  name text not null check (char_length(name) between 1 and 60),
  note text check (note is null or char_length(note) <= 80),
  removed boolean not null default false,  -- "can't make it" (also how a regular skips a week)
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists childcare_signups_day on childcare_signups (day);

drop trigger if exists childcare_signups_touch on childcare_signups;
create trigger childcare_signups_touch before insert or update on childcare_signups for each row execute function touch_updated_at();

-- Volunteers have no accounts: the site's public key can read, add and change sign-ups,
-- never delete them.
alter table childcare_signups enable row level security;
drop policy if exists "site reads childcare" on childcare_signups;
create policy "site reads childcare" on childcare_signups for select to anon, authenticated using (true);
drop policy if exists "site adds childcare" on childcare_signups;
create policy "site adds childcare" on childcare_signups for insert to anon, authenticated with check (true);
drop policy if exists "site changes childcare" on childcare_signups;
create policy "site changes childcare" on childcare_signups for update to anon, authenticated using (true) with check (true);
grant select, insert, update on childcare_signups to anon, authenticated;
grant all on childcare_signups to service_role;

-- Future sign-ups carried over from SignUpGenius's emails to Kyle (as of 2026-11-02).
-- Kyle is out 11/8 (Nash's basketball game).
insert into childcare_signups (id, day, slot, name, note)
select d::text || '|Big Kids|kyle hoegh', d::date, 'Big Kids', 'Kyle Hoegh', 'Leaving at 6:45'
from unnest(array['2026-11-15','2026-11-22','2026-11-29','2026-12-06','2026-12-13','2026-12-20','2026-12-27','2027-01-03']) as d
on conflict (id) do nothing;
insert into childcare_signups (id, day, slot, name)
values
  ('2026-11-15|Nursery|brenna thompson', '2026-11-15', 'Nursery', 'Brenna Thompson'),
  ('2026-12-13|Nursery|brenna thompson', '2026-12-13', 'Nursery', 'Brenna Thompson'),
  ('2026-11-15|Nursery|emily reesnes', '2026-11-15', 'Nursery', 'Emily Reesnes')
on conflict (id) do nothing;

select 'Childcare sign-ups are ready' as status;
