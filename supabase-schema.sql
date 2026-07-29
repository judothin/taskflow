-- ============================================================
-- TaskFlow — Supabase Schema
-- Run this in: Supabase Dashboard > SQL Editor > New Query
-- ============================================================

-- 1. PROFILES TABLE
-- Extends Supabase auth.users with display info and chart color
create table if not exists public.profiles (
  id uuid references auth.users(id) on delete cascade primary key,
  email text,
  first_name text not null,
  last_name text not null,
  color text not null default '#6366f1',
  avatar_url text,
  created_at timestamptz default now()
);

-- Migration: add avatar_url if the table already exists
alter table public.profiles add column if not exists avatar_url text;

-- Drop the auto-profile trigger — app code handles full profile creation
drop trigger if exists on_auth_user_created on auth.users;
drop function if exists public.handle_new_user();


-- 2. TASKS TABLE
create table if not exists public.tasks (
  id uuid default gen_random_uuid() primary key,
  status text not null default 'open'
    check (status in ('open', 'in_progress', 'on_hold', 'completed')),
  page text not null,
  feedback text not null,
  noticed_by text not null,
  roi text not null default 'medium'
    check (roi in ('critical', 'high', 'medium', 'low')),
  complexity text not null default 'medium'
    check (complexity in ('high', 'medium', 'low')),
  png_url text,
  attachments jsonb default '[]'::jsonb,
  date_received timestamptz default now(),
  date_completed timestamptz,
  completed_by text,
  created_by uuid references public.profiles(id) on delete set null,
  assignee_id uuid references public.profiles(id) on delete set null,
  due_date date,
  is_guest boolean default false,
  updated_at timestamptz default now(),
  created_at timestamptz default now()
);

-- Migration: multi-file task attachments ([{ url, name, kind }])
alter table public.tasks add column if not exists attachments jsonb default '[]'::jsonb;

-- Migration: subtasks / checklist ([{ id, text, done }])
alter table public.tasks add column if not exists subtasks jsonb default '[]'::jsonb;

-- Migration: optional assignee (team member responsible for the task)
alter table public.tasks add column if not exists assignee_id uuid references public.profiles(id) on delete set null;

-- Migration: optional due date. Plain `date` (not timestamptz) — a due date
-- is a calendar day, not a point in time, so there's no time-of-day/timezone
-- to reconcile.
alter table public.tasks add column if not exists due_date date;


-- 2b. USER PREFERENCES
-- Per-user dashboard layout + notification settings so the dashboard is
-- identical across every device the user signs in on.
create table if not exists public.user_preferences (
  id uuid references auth.users(id) on delete cascade primary key,
  dashboard_layout jsonb,
  notif_settings jsonb,
  notif_reads jsonb,
  theme_colors jsonb,
  updated_at timestamptz default now()
);

-- Migration: add columns if the table already exists
alter table public.user_preferences add column if not exists notif_reads jsonb;
alter table public.user_preferences add column if not exists theme_colors jsonb;

alter table public.user_preferences enable row level security;

-- Each user can only see and modify their own preferences row.
create policy "user_prefs_select_own" on public.user_preferences
  for select using (auth.uid() = id);

create policy "user_prefs_insert_own" on public.user_preferences
  for insert with check (auth.uid() = id);

create policy "user_prefs_update_own" on public.user_preferences
  for update using (auth.uid() = id);


-- 2c. BACKGROUND IMAGES  (up to 10 per user, enforced in the app)
create table if not exists public.user_backgrounds (
  id uuid default gen_random_uuid() primary key,
  user_id uuid references auth.users(id) on delete cascade not null,
  url text not null,
  created_at timestamptz default now()
);
alter table public.user_backgrounds enable row level security;
create policy "user_bg_select_own" on public.user_backgrounds for select using (auth.uid() = user_id);
create policy "user_bg_insert_own" on public.user_backgrounds for insert with check (auth.uid() = user_id);
create policy "user_bg_delete_own" on public.user_backgrounds for delete using (auth.uid() = user_id);


-- 2d. SAVED THEMES  (a named snapshot of a user's color/appearance choices)
create table if not exists public.user_themes (
  id uuid default gen_random_uuid() primary key,
  user_id uuid references auth.users(id) on delete cascade not null,
  name text not null,
  colors jsonb not null,
  created_at timestamptz default now()
);
alter table public.user_themes enable row level security;
create policy "user_themes_select_own" on public.user_themes for select using (auth.uid() = user_id);
create policy "user_themes_insert_own" on public.user_themes for insert with check (auth.uid() = user_id);
create policy "user_themes_update_own" on public.user_themes for update using (auth.uid() = user_id);
create policy "user_themes_delete_own" on public.user_themes for delete using (auth.uid() = user_id);


-- 3. ROW LEVEL SECURITY (RLS)

-- Profiles: anyone authenticated can read, only owner can update
alter table public.profiles enable row level security;

create policy "profiles_select" on public.profiles
  for select using (true);

create policy "profiles_insert" on public.profiles
  for insert with check (true);

create policy "profiles_update" on public.profiles
  for update using (auth.uid() = id);


-- Tasks: authenticated users can do everything; anon can only insert
alter table public.tasks enable row level security;

create policy "tasks_select_authenticated" on public.tasks
  for select using (auth.role() = 'authenticated');

create policy "tasks_insert_all" on public.tasks
  for insert with check (true);

create policy "tasks_update_authenticated" on public.tasks
  for update using (auth.role() = 'authenticated');

create policy "tasks_delete_authenticated" on public.tasks
  for delete using (auth.role() = 'authenticated');


-- 4. STORAGE BUCKET for task images
insert into storage.buckets (id, name, public)
values ('task-images', 'task-images', true)
on conflict (id) do nothing;

-- Make sure the bucket is public and accepts ALL file types (PDF, DOCX, XLSX,
-- etc.) — if it was created image-only, non-image attachment uploads silently
-- fail. Run this if attachments won't upload:
update storage.buckets set public = true, allowed_mime_types = null where id = 'task-images';

-- Allow anyone to upload (needed for guest portal)
create policy "storage_insert_all" on storage.objects
  for insert with check (bucket_id = 'task-images');

-- Anyone can read public images
create policy "storage_select_all" on storage.objects
  for select using (bucket_id = 'task-images');

-- Authenticated users can update (needed for upsert / avatar replacement)
create policy "storage_update_auth" on storage.objects
  for update using (bucket_id = 'task-images' and auth.role() = 'authenticated');

-- Authenticated users can delete
create policy "storage_delete_auth" on storage.objects
  for delete using (bucket_id = 'task-images' and auth.role() = 'authenticated');

-- ── Migration: run this if the bucket + policies already exist ──
-- Adds the missing UPDATE policy without touching existing ones:
--
--   create policy "storage_update_auth" on storage.objects
--     for update using (bucket_id = 'task-images' and auth.role() = 'authenticated');
--
-- If you get "policy already exists", it's already fixed.


-- 5. REALTIME
-- The Notification Center and live views subscribe to these tables. They must
-- be members of the supabase_realtime publication to stream changes. Each add
-- is wrapped so re-running the script is safe if a table is already a member.
do $$ begin alter publication supabase_realtime add table public.tasks;            exception when duplicate_object then null; end $$;
do $$ begin alter publication supabase_realtime add table public.project_comments; exception when duplicate_object then null; end $$;
do $$ begin alter publication supabase_realtime add table public.submissions;      exception when duplicate_object then null; end $$;
do $$ begin alter publication supabase_realtime add table public.file_entries;     exception when duplicate_object then null; end $$;
do $$ begin alter publication supabase_realtime add table public.queue;            exception when duplicate_object then null; end $$;


-- Done! ✅
-- Next steps:
--   1. Copy your Project URL and anon key from Settings > API
--   2. Paste them into your .env file (or Vercel env vars)
