-- Kyle's first pass on the hub quizzes (2026-11-27). Kyle answers every card from his phone
-- (/hub/review/), including his guess for the kids' cards, then flags who else should answer.
-- Paste into Supabase → SQL Editor → New query → Run. Safe to run again.
-- Needs setup.sql first (it defines touch_updated_at).
-- Until this is run, /hub/review/ keeps answers on the phone and uploads them once this table answers.

create table if not exists quiz_answers (
  id text primary key,                 -- deck|card|person, e.g. 'checkin|ci-wheel|Kyle'
  deck text not null,                  -- checkin | training | kitchen | chores | stars
  card text not null,
  person text not null,                -- who answered ('Kyle' for the first pass)
  rating int,                          -- 1-10; null = skipped
  skipped boolean not null default false,
  ask text[] not null default '{}',    -- who else should answer: Logan / Nellie / Nash
  note text,
  updated_at timestamptz not null default now()
);
create index if not exists quiz_answers_deck on quiz_answers (deck);

drop trigger if exists quiz_answers_touch on quiz_answers;
create trigger quiz_answers_touch before insert or update on quiz_answers for each row execute function touch_updated_at();

alter table quiz_answers enable row level security;
drop policy if exists "site reads quiz" on quiz_answers;
create policy "site reads quiz" on quiz_answers for select to anon, authenticated using (true);
drop policy if exists "site adds quiz" on quiz_answers;
create policy "site adds quiz" on quiz_answers for insert to anon, authenticated with check (true);
drop policy if exists "site changes quiz" on quiz_answers;
create policy "site changes quiz" on quiz_answers for update to anon, authenticated using (true) with check (true);

grant select, insert, update on quiz_answers to anon, authenticated;
grant all on quiz_answers to service_role;

select 'Quiz answers are ready' as status;
