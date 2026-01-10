-- Optimize lead email pagination and extracted lead lookups
create index if not exists dialpad_emails_created_at_idx on public.dialpad_emails (created_at desc);
create index if not exists dialpad_emails_subject_idx on public.dialpad_emails (subject);
create index if not exists extracted_leads_email_id_idx on public.extracted_leads (email_id);
create index if not exists extracted_leads_created_at_idx on public.extracted_leads (created_at desc);


