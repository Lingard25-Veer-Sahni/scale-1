-- SCALE India backend — Supabase schema
--
-- Run this once in the Supabase SQL Editor (https://supabase.com/dashboard
-- -> your project -> SQL Editor -> New query -> paste this whole file ->
-- Run). It creates one jsonb-document table per collection the backend
-- used to keep in MongoDB. Row Level Security is enabled with zero
-- policies on every table: that blocks all access via the anon/publishable
-- key, while the backend (which uses the service_role/secret key) always
-- bypasses RLS, so this is safe by default.
--
-- Safe to re-run: every statement is idempotent (IF NOT EXISTS / OR
-- REPLACE), so running it again after adding a new table name here won't
-- touch existing data.

create table if not exists public.users              (id text primary key, doc jsonb not null default '{}'::jsonb);
create table if not exists public.content             (id text primary key, doc jsonb not null default '{}'::jsonb);
create table if not exists public.theme                (id text primary key, doc jsonb not null default '{}'::jsonb);
create table if not exists public.events               (id text primary key, doc jsonb not null default '{}'::jsonb);
create table if not exists public.sessions_list        (id text primary key, doc jsonb not null default '{}'::jsonb);
create table if not exists public.team_members          (id text primary key, doc jsonb not null default '{}'::jsonb);
create table if not exists public.pages                 (id text primary key, doc jsonb not null default '{}'::jsonb);
create table if not exists public.community             (id text primary key, doc jsonb not null default '{}'::jsonb);
create table if not exists public.submissions           (id text primary key, doc jsonb not null default '{}'::jsonb);
create table if not exists public.registrations         (id text primary key, doc jsonb not null default '{}'::jsonb);
create table if not exists public.file_refs             (id text primary key, doc jsonb not null default '{}'::jsonb);
create table if not exists public.event_submissions     (id text primary key, doc jsonb not null default '{}'::jsonb);
create table if not exists public.payment_transactions  (id text primary key, doc jsonb not null default '{}'::jsonb);

do $$
declare
  t text;
begin
  for t in select unnest(array[
    'users','content','theme','events','sessions_list','team_members',
    'pages','community','submissions','registrations','file_refs',
    'event_submissions','payment_transactions'
  ])
  loop
    execute format('alter table public.%I enable row level security;', t);
    execute format(
      'create index if not exists %I on public.%I using gin (doc);',
      t || '_doc_gin_idx', t
    );
  end loop;
end $$;
