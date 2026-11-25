-- Nellie's Knee Cup (/knee/), 2026-11-25. Run once in the Supabase SQL editor.
-- key = 'YYYY-MM-DD|exercise|slot'. Unchecking upserts done=false, so no deletes (same rule as the other tables).
create table if not exists knee_log (
  key text primary key,
  day date not null,
  done boolean not null default true,
  updated_at timestamptz default now()
);
alter table knee_log enable row level security;
create policy knee_sel on knee_log for select using (true);
create policy knee_ins on knee_log for insert with check (true);
create policy knee_upd on knee_log for update using (true);
