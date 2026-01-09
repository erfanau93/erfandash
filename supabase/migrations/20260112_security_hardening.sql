-- =====================================================
-- SECURITY HARDENING: Auth + Role-based RLS (no more allow-all)
-- =====================================================
-- Goals:
-- - Require Supabase Auth for internal app access
-- - Enforce role-based access via RLS
-- - Keep public quote links working via Edge Functions (service role), not public table access

-- 1) Profiles table to store app roles (admin/staff/viewer)
create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  role text not null default 'viewer' check (role in ('admin','staff','viewer')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.profiles enable row level security;

-- Users can read their own profile (useful for UI gating)
drop policy if exists "Profiles: read own" on public.profiles;
create policy "Profiles: read own"
on public.profiles
for select
using (auth.uid() = id);

-- Only admins can change roles
drop policy if exists "Profiles: admin update" on public.profiles;
create policy "Profiles: admin update"
on public.profiles
for update
using (
  exists (
    select 1 from public.profiles p
    where p.id = auth.uid() and p.role = 'admin'
  )
)
with check (
  exists (
    select 1 from public.profiles p
    where p.id = auth.uid() and p.role = 'admin'
  )
);

-- 2) Helper functions for RLS
create or replace function public.is_admin()
returns boolean
language sql
stable
as $$
  select exists (
    select 1 from public.profiles p
    where p.id = auth.uid() and p.role = 'admin'
  );
$$;

create or replace function public.is_staff()
returns boolean
language sql
stable
as $$
  select exists (
    select 1 from public.profiles p
    where p.id = auth.uid() and p.role in ('admin','staff')
  );
$$;

-- 3) Auto-create profile row for new auth users
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles (id, role)
  values (new.id, 'viewer')
  on conflict (id) do nothing;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
after insert on auth.users
for each row execute function public.handle_new_user();

-- 4) Apply RLS policies to app tables (only if they exist)
do $$
declare
  t text;
begin
  foreach t in array array[
    'public.extracted_leads',
    'public.quotes',
    'public.sms_templates',
    'public.dialpad_calls',
    'public.dialpad_sms',
    'public.dialpad_emails',
    'public.booking_series',
    'public.booking_occurrences',
    'public.cleaners',
    'public.cleaner_job_reviews',
    'public.payment_sms_templates',
    'public.payment_sms_logs',
    'public.review_sms_templates',
    'public.review_sms_logs'
  ]
  loop
    if to_regclass(t) is not null then
      execute format('alter table %s enable row level security', t);

      -- drop common "allow all" policies from earlier migrations (name varies per table)
      execute format('drop policy if exists %L on %s', 'Allow all for ' || split_part(t, '.', 2), t);
      execute format('drop policy if exists %L on %s', 'Allow all for ' || split_part(t, '.', 2) || ' ', t);

      -- also drop policies that were created in sms migrations
      execute format('drop policy if exists %L on %s', 'Allow all for payment_sms_templates', t);
      execute format('drop policy if exists %L on %s', 'Allow all for payment_sms_logs', t);
      execute format('drop policy if exists %L on %s', 'Allow all for review_sms_templates', t);
      execute format('drop policy if exists %L on %s', 'Allow all for review_sms_logs', t);

      -- create a staff-only policy for ALL operations
      execute format('drop policy if exists %L on %s', 'Staff: all', t);
      execute format(
        'create policy %L on %s for all using (public.is_staff()) with check (public.is_staff())',
        'Staff: all',
        t
      );
    end if;
  end loop;
end $$;

-- NOTE:
-- - Public quote access is handled via Edge Functions (service role) using share_token.
-- - You must manually promote at least one user to admin:
--     update public.profiles set role = ''admin'' where id = ''<auth_user_uuid>'';


