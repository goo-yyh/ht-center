DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM schema_migrations WHERE version = '0005_single_running_evaluation') THEN
    CREATE UNIQUE INDEX IF NOT EXISTS evaluations_one_running_per_rfq
      ON evaluations(rfq_id)
      WHERE status = 'RUNNING';

    INSERT INTO schema_migrations(version) VALUES ('0005_single_running_evaluation');
  END IF;
END $$;
