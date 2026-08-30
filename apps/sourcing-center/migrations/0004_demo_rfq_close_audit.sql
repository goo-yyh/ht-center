DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM schema_migrations WHERE version = '0004_demo_rfq_close_audit') THEN
    UPDATE workflow_events event
       SET event_data = jsonb_set(event.event_data, '{reason}', '"EARLY_STOP"'::jsonb, true)
      FROM sourcing_requests sr, demo_workspaces w
     WHERE event.request_id = sr.id
       AND event.workspace_id = w.id
       AND sr.workspace_id = w.id
       AND w.code = 'DEMO-DEFAULT'
       AND event.event_type = 'RFQ_CLOSED_AND_REVEALED'
       AND event.event_data->>'reason' = 'DEADLINE_REACHED'
       AND sr.request_no IN ('SR-DEMO-0001', 'SR-DEMO-0002', 'SR-DEMO-0003', 'SR-DEMO-0004');

    INSERT INTO schema_migrations(version) VALUES ('0004_demo_rfq_close_audit');
  END IF;
END $$;
