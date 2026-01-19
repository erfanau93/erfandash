-- Standardize extracted_leads contact timestamps to timestamptz
-- Converts existing numeric (ms or s) and text values to ISO-friendly timestamptz

-- first_contact
ALTER TABLE extracted_leads
  ALTER COLUMN first_contact TYPE timestamptz
  USING (
    CASE
      WHEN first_contact IS NULL THEN NULL
      WHEN (first_contact::text ~ '^[0-9]+$') THEN
        to_timestamp(
          CASE
            -- Heuristic: large integers are milliseconds; divide by 1000
            WHEN first_contact::numeric > 32503680000 THEN first_contact::numeric / 1000.0
            ELSE first_contact::numeric
          END
        )
      ELSE first_contact::timestamptz
    END
  );

-- last_text_date
ALTER TABLE extracted_leads
  ALTER COLUMN last_text_date TYPE timestamptz
  USING (
    CASE
      WHEN last_text_date IS NULL THEN NULL
      WHEN (last_text_date::text ~ '^[0-9]+$') THEN
        to_timestamp(
          CASE
            WHEN last_text_date::numeric > 32503680000 THEN last_text_date::numeric / 1000.0
            ELSE last_text_date::numeric
          END
        )
      ELSE last_text_date::timestamptz
    END
  );







