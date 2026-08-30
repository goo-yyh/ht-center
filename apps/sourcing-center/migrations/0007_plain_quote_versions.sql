CREATE TABLE IF NOT EXISTS quote_versions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES demo_workspaces(id) ON DELETE CASCADE,
  quote_id uuid NOT NULL REFERENCES quotes(id) ON DELETE CASCADE,
  version_no integer NOT NULL CHECK (version_no IN (1,2)),
  receipt_no text NOT NULL,
  total_amount numeric(18,2) NOT NULL CHECK (total_amount > 0),
  delivery_days integer NOT NULL CHECK (delivery_days > 0),
  remark text NOT NULL DEFAULT '',
  competitiveness text CHECK (competitiveness IN ('HIGH','MEDIUM','LOW')),
  submitted_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  payload_sha256 text NOT NULL,
  is_simulated boolean NOT NULL DEFAULT false,
  UNIQUE (quote_id, version_no),
  UNIQUE (id, quote_id)
);

ALTER TABLE quotes ADD COLUMN IF NOT EXISTS current_version integer NOT NULL DEFAULT 1;
ALTER TABLE quotes DROP CONSTRAINT IF EXISTS quotes_current_version_check;
ALTER TABLE quotes ADD CONSTRAINT quotes_current_version_check CHECK (current_version IN (1,2));

ALTER TABLE rfq_close_events ADD COLUMN IF NOT EXISTS quote_count integer;
UPDATE rfq_close_events
   SET quote_count=revealed_quote_count
 WHERE quote_count IS NULL;
ALTER TABLE rfq_close_events ALTER COLUMN quote_count SET NOT NULL;
ALTER TABLE rfq_close_events DROP CONSTRAINT IF EXISTS rfq_close_events_quote_count_check;
ALTER TABLE rfq_close_events ADD CONSTRAINT rfq_close_events_quote_count_check CHECK (quote_count >= 0);

-- Closed legacy RFQs have plaintext details available and can be migrated
-- losslessly in SQL. Active legacy RFQs are backfilled non-destructively by
-- initializeDemo with the application encryption key; the workspace is not
-- reset and the seed version is intentionally unchanged.
INSERT INTO quote_versions(
  workspace_id,quote_id,version_no,receipt_no,total_amount,delivery_days,remark,
  competitiveness,submitted_at,payload_sha256,is_simulated
)
SELECT q.workspace_id,q.id,1,q.receipt_no,d.total_amount,d.delivery_days,d.remark,
       NULL,q.submitted_at,q.payload_sha256,false
  FROM quotes q
  JOIN revealed_quote_details d ON d.quote_id=q.id
ON CONFLICT (quote_id,version_no) DO NOTHING;

CREATE INDEX IF NOT EXISTS quote_versions_quote_idx
  ON quote_versions(quote_id,version_no DESC);

INSERT INTO schema_migrations(version)
VALUES ('0007_plain_quote_versions')
ON CONFLICT DO NOTHING;
