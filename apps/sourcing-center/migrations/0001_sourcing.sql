CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE IF NOT EXISTS schema_migrations (
  version text PRIMARY KEY,
  applied_at timestamptz NOT NULL DEFAULT clock_timestamp()
);

CREATE TABLE IF NOT EXISTS demo_workspaces (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  code text NOT NULL UNIQUE,
  seed_version text NOT NULL,
  revision bigint NOT NULL DEFAULT 0 CHECK (revision >= 0),
  initialized_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  reset_at timestamptz,
  updated_at timestamptz NOT NULL DEFAULT clock_timestamp()
);

CREATE TABLE IF NOT EXISTS catalog_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES demo_workspaces(id) ON DELETE CASCADE,
  code text NOT NULL,
  name text NOT NULL,
  unit text NOT NULL,
  specifications jsonb NOT NULL CHECK (jsonb_typeof(specifications) = 'array'),
  quantities jsonb NOT NULL CHECK (jsonb_typeof(quantities) = 'array'),
  qualifications jsonb NOT NULL CHECK (jsonb_typeof(qualifications) = 'array'),
  delivery_options jsonb NOT NULL CHECK (jsonb_typeof(delivery_options) = 'array'),
  quote_durations jsonb NOT NULL CHECK (jsonb_typeof(quote_durations) = 'array'),
  evaluation_strategies jsonb NOT NULL CHECK (jsonb_typeof(evaluation_strategies) = 'array'),
  enabled boolean NOT NULL DEFAULT true,
  UNIQUE (workspace_id, code)
);

CREATE TABLE IF NOT EXISTS suppliers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES demo_workspaces(id) ON DELETE CASCADE,
  supplier_no text NOT NULL,
  supplier_type text NOT NULL CHECK (supplier_type IN ('INTERNAL', 'EXTERNAL')),
  name text NOT NULL,
  region text NOT NULL,
  source_platform text NOT NULL,
  qualifications text[] NOT NULL DEFAULT '{}',
  risk_level text NOT NULL CHECK (risk_level IN ('LOW', 'MEDIUM', 'HIGH')),
  history_score numeric(5,2),
  platform_score numeric(5,2),
  contact_name text,
  email text,
  phone text,
  registration_enabled boolean NOT NULL DEFAULT false,
  UNIQUE (workspace_id, supplier_no)
);

CREATE TABLE IF NOT EXISTS supplier_capabilities (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES demo_workspaces(id) ON DELETE CASCADE,
  supplier_id uuid NOT NULL REFERENCES suppliers(id) ON DELETE CASCADE,
  item_code text NOT NULL,
  supported_qualifications text[] NOT NULL DEFAULT '{}',
  minimum_delivery_days integer NOT NULL CHECK (minimum_delivery_days > 0),
  capacity_level text NOT NULL CHECK (capacity_level IN ('SMALL', 'MEDIUM', 'LARGE')),
  description text NOT NULL,
  UNIQUE (supplier_id, item_code)
);

CREATE TABLE IF NOT EXISTS sourcing_requests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES demo_workspaces(id) ON DELETE CASCADE,
  request_no text NOT NULL,
  item_id uuid NOT NULL REFERENCES catalog_items(id),
  item_code text NOT NULL,
  item_name text NOT NULL,
  specification_code text NOT NULL,
  specification_snapshot text NOT NULL,
  quantity numeric(18,3) NOT NULL CHECK (quantity > 0),
  unit text NOT NULL,
  qualification_codes text[] NOT NULL DEFAULT '{}',
  required_delivery_days integer NOT NULL CHECK (required_delivery_days > 0),
  quote_duration_minutes integer NOT NULL CHECK (quote_duration_minutes IN (15,30,60)),
  evaluation_strategy text NOT NULL CHECK (evaluation_strategy IN ('BALANCED','PRICE_FIRST','DELIVERY_FIRST')),
  status text NOT NULL CHECK (status IN ('SOURCING_RUNNING','SOURCING_READY','BIDDING_OPEN','EVALUATION_PENDING','AWARD_PENDING','COMPLETED')),
  version integer NOT NULL DEFAULT 1 CHECK (version > 0),
  is_seeded boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  UNIQUE (workspace_id, request_no)
);

CREATE TABLE IF NOT EXISTS request_attachments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES demo_workspaces(id) ON DELETE CASCADE,
  request_id uuid NOT NULL REFERENCES sourcing_requests(id) ON DELETE CASCADE,
  file_name text NOT NULL,
  mime_type text NOT NULL,
  size_bytes integer NOT NULL CHECK (size_bytes BETWEEN 0 AND 5242880),
  checksum_sha256 text NOT NULL,
  content bytea NOT NULL,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp()
);

CREATE TABLE IF NOT EXISTS agent_runs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES demo_workspaces(id) ON DELETE CASCADE,
  request_id uuid NOT NULL REFERENCES sourcing_requests(id) ON DELETE CASCADE,
  run_type text NOT NULL CHECK (run_type IN ('SOURCING','EVALUATION')),
  status text NOT NULL CHECK (status IN ('RUNNING','SUCCEEDED','FAILED')),
  model text NOT NULL,
  prompt_version text NOT NULL,
  provider_request_id text,
  input_snapshot jsonb NOT NULL DEFAULT '{}',
  output_hash text,
  started_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  finished_at timestamptz,
  error_code text,
  error_message text
);

CREATE TABLE IF NOT EXISTS agent_messages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES demo_workspaces(id) ON DELETE CASCADE,
  request_id uuid NOT NULL REFERENCES sourcing_requests(id) ON DELETE CASCADE,
  agent_run_id uuid REFERENCES agent_runs(id) ON DELETE CASCADE,
  role text NOT NULL CHECK (role IN ('USER','ASSISTANT','SYSTEM_RESULT')),
  content text NOT NULL,
  is_seeded boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp()
);

CREATE TABLE IF NOT EXISTS agent_actions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES demo_workspaces(id) ON DELETE CASCADE,
  request_id uuid NOT NULL REFERENCES sourcing_requests(id) ON DELETE CASCADE,
  agent_run_id uuid NOT NULL REFERENCES agent_runs(id) ON DELETE CASCADE,
  action_type text NOT NULL,
  status text NOT NULL CHECK (status IN ('RUNNING','SUCCEEDED','FAILED')),
  hit_count integer,
  summary text NOT NULL,
  started_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  finished_at timestamptz
);

CREATE TABLE IF NOT EXISTS sourcing_candidates (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES demo_workspaces(id) ON DELETE CASCADE,
  request_id uuid NOT NULL REFERENCES sourcing_requests(id) ON DELETE CASCADE,
  agent_run_id uuid NOT NULL REFERENCES agent_runs(id) ON DELETE CASCADE,
  supplier_id uuid NOT NULL REFERENCES suppliers(id),
  supplier_type text NOT NULL CHECK (supplier_type IN ('INTERNAL','EXTERNAL')),
  match_score numeric(5,2) NOT NULL CHECK (match_score BETWEEN 0 AND 100),
  qualification_summary text NOT NULL,
  expected_delivery_days integer NOT NULL CHECK (expected_delivery_days > 0),
  recommendation text NOT NULL,
  risk_summary text NOT NULL,
  eligible_for_rfq boolean NOT NULL DEFAULT true,
  UNIQUE (agent_run_id, supplier_id)
);

CREATE TABLE IF NOT EXISTS rfqs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES demo_workspaces(id) ON DELETE CASCADE,
  rfq_no text NOT NULL,
  request_id uuid NOT NULL UNIQUE REFERENCES sourcing_requests(id) ON DELETE CASCADE,
  status text NOT NULL CHECK (status IN ('OPEN','CLOSED')),
  deadline_at timestamptz NOT NULL,
  closed_at timestamptz,
  close_reason text,
  revealed_at timestamptz,
  version integer NOT NULL DEFAULT 1,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  UNIQUE (workspace_id, rfq_no),
  CHECK ((status='OPEN' AND closed_at IS NULL AND close_reason IS NULL AND revealed_at IS NULL) OR
         (status='CLOSED' AND closed_at IS NOT NULL AND close_reason IS NOT NULL AND revealed_at IS NOT NULL)),
  UNIQUE (id, workspace_id)
);

CREATE TABLE IF NOT EXISTS rfq_invitations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES demo_workspaces(id) ON DELETE CASCADE,
  rfq_id uuid NOT NULL REFERENCES rfqs(id) ON DELETE CASCADE,
  supplier_id uuid NOT NULL REFERENCES suppliers(id),
  invitation_type text NOT NULL CHECK (invitation_type IN ('INTERNAL','EXTERNAL')),
  invited_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  viewed_at timestamptz,
  submitted_at timestamptz,
  UNIQUE (rfq_id, supplier_id),
  UNIQUE (id, rfq_id, supplier_id)
);

CREATE TABLE IF NOT EXISTS notification_records (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES demo_workspaces(id) ON DELETE CASCADE,
  invitation_id uuid NOT NULL REFERENCES rfq_invitations(id) ON DELETE CASCADE,
  notification_type text NOT NULL DEFAULT 'RFQ_NOTICE' CHECK (notification_type='RFQ_NOTICE'),
  recipient_address text NOT NULL,
  delivery_mode text NOT NULL DEFAULT 'SIMULATED' CHECK (delivery_mode='SIMULATED'),
  status text NOT NULL DEFAULT 'SIMULATED_SENT' CHECK (status='SIMULATED_SENT'),
  generated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  UNIQUE (invitation_id)
);

CREATE TABLE IF NOT EXISTS external_supplier_accounts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES demo_workspaces(id) ON DELETE CASCADE,
  supplier_id uuid NOT NULL UNIQUE REFERENCES suppliers(id) ON DELETE CASCADE,
  contact_name text NOT NULL,
  email text NOT NULL,
  password_hash text NOT NULL,
  registered_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  UNIQUE (workspace_id, email)
);

CREATE TABLE IF NOT EXISTS quotes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES demo_workspaces(id) ON DELETE CASCADE,
  quote_no text NOT NULL,
  rfq_id uuid NOT NULL REFERENCES rfqs(id) ON DELETE CASCADE,
  invitation_id uuid NOT NULL,
  supplier_id uuid NOT NULL REFERENCES suppliers(id),
  submitted_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  receipt_no text NOT NULL,
  payload_sha256 text NOT NULL,
  is_seeded boolean NOT NULL DEFAULT false,
  UNIQUE (workspace_id, quote_no),
  UNIQUE (rfq_id, supplier_id),
  UNIQUE (invitation_id),
  UNIQUE (id, rfq_id),
  FOREIGN KEY (invitation_id, rfq_id, supplier_id) REFERENCES rfq_invitations(id, rfq_id, supplier_id)
);

CREATE TABLE IF NOT EXISTS quote_sealed_payloads (
  quote_id uuid PRIMARY KEY REFERENCES quotes(id) ON DELETE CASCADE,
  workspace_id uuid NOT NULL REFERENCES demo_workspaces(id) ON DELETE CASCADE,
  ciphertext bytea NOT NULL,
  nonce bytea NOT NULL CHECK (octet_length(nonce)=12),
  auth_tag bytea NOT NULL CHECK (octet_length(auth_tag)=16),
  key_version text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp()
);

CREATE TABLE IF NOT EXISTS revealed_quote_details (
  quote_id uuid PRIMARY KEY REFERENCES quotes(id) ON DELETE CASCADE,
  workspace_id uuid NOT NULL REFERENCES demo_workspaces(id) ON DELETE CASCADE,
  total_amount numeric(18,2) NOT NULL CHECK (total_amount > 0),
  delivery_days integer NOT NULL CHECK (delivery_days > 0),
  remark text NOT NULL DEFAULT '',
  revealed_at timestamptz NOT NULL
);

CREATE TABLE IF NOT EXISTS rfq_close_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES demo_workspaces(id) ON DELETE CASCADE,
  rfq_id uuid NOT NULL UNIQUE REFERENCES rfqs(id) ON DELETE CASCADE,
  close_reason text NOT NULL,
  closed_at timestamptz NOT NULL,
  revealed_quote_count integer NOT NULL CHECK (revealed_quote_count >= 0)
);

CREATE TABLE IF NOT EXISTS evaluations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES demo_workspaces(id) ON DELETE CASCADE,
  evaluation_no text NOT NULL,
  request_id uuid NOT NULL REFERENCES sourcing_requests(id) ON DELETE CASCADE,
  rfq_id uuid NOT NULL REFERENCES rfqs(id) ON DELETE CASCADE,
  agent_run_id uuid REFERENCES agent_runs(id),
  strategy text NOT NULL CHECK (strategy IN ('BALANCED','PRICE_FIRST','DELIVERY_FIRST')),
  status text NOT NULL CHECK (status IN ('RUNNING','SUCCEEDED','FAILED')),
  quote_set_hash text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  completed_at timestamptz,
  UNIQUE (workspace_id, evaluation_no),
  UNIQUE (id, rfq_id)
);

CREATE TABLE IF NOT EXISTS evaluation_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES demo_workspaces(id) ON DELETE CASCADE,
  evaluation_id uuid NOT NULL,
  rfq_id uuid NOT NULL,
  quote_id uuid NOT NULL,
  rank integer NOT NULL CHECK (rank BETWEEN 1 AND 10),
  price_score numeric(5,2) NOT NULL CHECK (price_score BETWEEN 0 AND 100),
  delivery_score numeric(5,2) NOT NULL CHECK (delivery_score BETWEEN 0 AND 100),
  match_score numeric(5,2) NOT NULL CHECK (match_score BETWEEN 0 AND 100),
  risk_score numeric(5,2) NOT NULL CHECK (risk_score BETWEEN 0 AND 100),
  total_score numeric(5,2) NOT NULL CHECK (total_score BETWEEN 0 AND 100),
  recommendation text NOT NULL,
  risk_summary text NOT NULL,
  UNIQUE (evaluation_id, quote_id),
  UNIQUE (evaluation_id, rank),
  FOREIGN KEY (evaluation_id, rfq_id) REFERENCES evaluations(id, rfq_id) ON DELETE CASCADE,
  FOREIGN KEY (quote_id, rfq_id) REFERENCES quotes(id, rfq_id)
);

CREATE TABLE IF NOT EXISTS awards (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES demo_workspaces(id) ON DELETE CASCADE,
  request_id uuid NOT NULL UNIQUE REFERENCES sourcing_requests(id) ON DELETE CASCADE,
  evaluation_id uuid NOT NULL REFERENCES evaluations(id),
  quote_id uuid NOT NULL REFERENCES quotes(id),
  supplier_id uuid NOT NULL REFERENCES suppliers(id),
  selected_at timestamptz NOT NULL DEFAULT clock_timestamp()
);

CREATE TABLE IF NOT EXISTS purchase_requisitions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES demo_workspaces(id) ON DELETE CASCADE,
  pr_no text NOT NULL,
  request_id uuid NOT NULL UNIQUE REFERENCES sourcing_requests(id) ON DELETE CASCADE,
  rfq_id uuid NOT NULL REFERENCES rfqs(id),
  evaluation_id uuid NOT NULL REFERENCES evaluations(id),
  award_id uuid NOT NULL UNIQUE REFERENCES awards(id),
  quote_id uuid NOT NULL REFERENCES quotes(id),
  supplier_id uuid NOT NULL REFERENCES suppliers(id),
  item_name text NOT NULL,
  specification text NOT NULL,
  quantity numeric(18,3) NOT NULL CHECK (quantity > 0),
  unit text NOT NULL,
  total_amount numeric(18,2) NOT NULL CHECK (total_amount > 0),
  delivery_days integer NOT NULL CHECK (delivery_days > 0),
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  UNIQUE (workspace_id, pr_no)
);

CREATE TABLE IF NOT EXISTS workflow_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES demo_workspaces(id) ON DELETE CASCADE,
  request_id uuid REFERENCES sourcing_requests(id) ON DELETE CASCADE,
  event_type text NOT NULL,
  actor text NOT NULL,
  summary text NOT NULL,
  event_data jsonb NOT NULL DEFAULT '{}',
  created_at timestamptz NOT NULL DEFAULT clock_timestamp()
);

CREATE TABLE IF NOT EXISTS idempotency_records (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES demo_workspaces(id) ON DELETE CASCADE,
  scope text NOT NULL,
  actor text NOT NULL,
  idempotency_key text NOT NULL,
  request_hash text NOT NULL,
  response_snapshot jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  UNIQUE (workspace_id, scope, actor, idempotency_key)
);

CREATE INDEX IF NOT EXISTS sourcing_requests_status_idx ON sourcing_requests(workspace_id, status);
CREATE INDEX IF NOT EXISTS agent_runs_request_idx ON agent_runs(request_id, started_at);
CREATE INDEX IF NOT EXISTS candidates_request_idx ON sourcing_candidates(request_id, agent_run_id);
CREATE INDEX IF NOT EXISTS invitations_supplier_idx ON rfq_invitations(supplier_id, rfq_id);
CREATE INDEX IF NOT EXISTS quotes_rfq_idx ON quotes(rfq_id, submitted_at);
ALTER TABLE evaluations DROP CONSTRAINT IF EXISTS evaluations_rfq_id_status_key;
CREATE UNIQUE INDEX IF NOT EXISTS evaluations_success_idx ON evaluations(rfq_id) WHERE status='SUCCEEDED';
CREATE INDEX IF NOT EXISTS workflow_events_request_idx ON workflow_events(request_id, created_at);

INSERT INTO schema_migrations(version) VALUES ('0001_sourcing') ON CONFLICT DO NOTHING;
