ALTER TABLE evaluation_items
  ADD COLUMN IF NOT EXISTS quote_version_id uuid;

UPDATE evaluation_items item
   SET quote_version_id=version.id
  FROM quotes quote
  JOIN quote_versions version
    ON version.quote_id=quote.id
   AND version.version_no=quote.current_version
 WHERE item.quote_id=quote.id
   AND item.quote_version_id IS NULL;

ALTER TABLE evaluation_items
  ALTER COLUMN quote_version_id SET NOT NULL;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
      FROM pg_constraint
     WHERE conname='evaluation_items_quote_version_fk'
  ) THEN
    ALTER TABLE evaluation_items
      ADD CONSTRAINT evaluation_items_quote_version_fk
      FOREIGN KEY (quote_version_id,quote_id)
      REFERENCES quote_versions(id,quote_id);
  END IF;
END $$;

INSERT INTO schema_migrations(version)
VALUES ('0009_evaluation_quote_version')
ON CONFLICT DO NOTHING;
