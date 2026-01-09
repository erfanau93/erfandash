-- =====================================================
-- BANK DETAILS: move plaintext -> encrypted-at-rest columns
-- =====================================================
-- This migration adds encrypted columns. Data migration is done via an admin-only Edge Function
-- so the encryption key never enters SQL/migrations.

do $$
begin
  if to_regclass('public.cleaners') is not null then
    alter table public.cleaners
      add column if not exists bank_account_name_enc text,
      add column if not exists bank_bsb_enc text,
      add column if not exists bank_account_number_enc text;
  end if;
end $$;

-- After deploying the Edge Functions, run:
--   migrate-cleaner-bank-details
-- to encrypt existing rows and clear plaintext columns.


