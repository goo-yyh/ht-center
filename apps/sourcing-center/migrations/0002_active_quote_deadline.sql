DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM schema_migrations WHERE version = '0002_active_quote_deadline') THEN
    UPDATE rfqs r
       SET deadline_at = TIMESTAMPTZ '2026-09-15 23:59:00+08'
      FROM sourcing_requests sr, demo_workspaces w
     WHERE r.request_id = sr.id
       AND r.workspace_id = w.id
       AND sr.workspace_id = w.id
       AND w.code = 'DEMO-DEFAULT'
       AND sr.is_seeded = true
       AND r.status = 'OPEN';

    UPDATE demo_workspaces w
       SET revision = revision + 1,
           updated_at = clock_timestamp()
     WHERE w.code = 'DEMO-DEFAULT'
       AND EXISTS (
         SELECT 1
           FROM rfqs r
           JOIN sourcing_requests sr ON sr.id = r.request_id
          WHERE r.workspace_id = w.id
            AND sr.is_seeded = true
            AND r.status = 'OPEN'
       );

    INSERT INTO schema_migrations(version) VALUES ('0002_active_quote_deadline');
  END IF;
END $$;
