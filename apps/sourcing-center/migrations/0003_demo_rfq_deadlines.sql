DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM schema_migrations WHERE version = '0003_demo_rfq_deadlines') THEN
    UPDATE rfqs r
       SET deadline_at = TIMESTAMPTZ '2026-09-15 23:59:00+08',
           close_reason = CASE WHEN r.status = 'CLOSED' THEN 'EARLY_STOP' ELSE r.close_reason END
      FROM sourcing_requests sr, demo_workspaces w
     WHERE r.request_id = sr.id
       AND r.workspace_id = w.id
       AND sr.workspace_id = w.id
       AND w.code = 'DEMO-DEFAULT'
       AND sr.request_no IN ('SR-DEMO-0001', 'SR-DEMO-0002', 'SR-DEMO-0003', 'SR-DEMO-0004');

    UPDATE rfq_close_events event
       SET close_reason = 'EARLY_STOP'
      FROM rfqs r, sourcing_requests sr, demo_workspaces w
     WHERE event.rfq_id = r.id
       AND r.request_id = sr.id
       AND event.workspace_id = w.id
       AND r.workspace_id = w.id
       AND sr.workspace_id = w.id
       AND w.code = 'DEMO-DEFAULT'
       AND sr.request_no IN ('SR-DEMO-0001', 'SR-DEMO-0002', 'SR-DEMO-0003', 'SR-DEMO-0004');

    UPDATE demo_workspaces w
       SET revision = revision + 1,
           updated_at = clock_timestamp()
     WHERE w.code = 'DEMO-DEFAULT'
       AND EXISTS (
         SELECT 1
           FROM rfqs r
           JOIN sourcing_requests sr ON sr.id = r.request_id
          WHERE r.workspace_id = w.id
            AND sr.request_no IN ('SR-DEMO-0001', 'SR-DEMO-0002', 'SR-DEMO-0003', 'SR-DEMO-0004')
       );

    INSERT INTO schema_migrations(version) VALUES ('0003_demo_rfq_deadlines');
  END IF;
END $$;
