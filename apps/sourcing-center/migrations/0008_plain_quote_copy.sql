DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM schema_migrations WHERE version='0008_plain_quote_copy') THEN
    UPDATE agent_actions
       SET action_type='LOAD_CURRENT_QUOTES',
           summary='已读取 ' || coalesce(hit_count,0) || ' 份停止报价后的最终有效报价'
     WHERE action_type='LOAD_REVEALED_QUOTES';

    UPDATE agent_actions
       SET summary=coalesce(hit_count,0) || ' 份报价的最新版本与关闭记录数量一致'
     WHERE action_type='VERIFY_QUOTE_SET'
       AND (summary LIKE '%密封%' OR summary LIKE '%解封%');

    UPDATE workflow_events
       SET event_type='RFQ_CLOSED',
           summary='报价已停止，最终报价集合已冻结',
           event_data=(coalesce(event_data,'{}'::jsonb) - 'revealedQuoteCount')
             || jsonb_build_object('quoteCount',CASE
                  WHEN coalesce(event_data->>'revealedQuoteCount','') ~ '^\d+$'
                    THEN (event_data->>'revealedQuoteCount')::integer
                  ELSE 0
                END)
     WHERE event_type='RFQ_CLOSED_AND_REVEALED';

    UPDATE workflow_events
       SET summary='供应商提交首次报价',
           event_data=coalesce(event_data,'{}'::jsonb) || jsonb_build_object('version',1)
     WHERE event_type='QUOTE_SUBMITTED'
       AND summary LIKE '%密封报价%';

    UPDATE workflow_events
       SET summary='一键补齐剩余供应商首次报价'
     WHERE event_type='REMAINING_QUOTES_SIMULATED'
       AND summary LIKE '%密封报价%';

    INSERT INTO schema_migrations(version) VALUES ('0008_plain_quote_copy');
  END IF;
END $$;
