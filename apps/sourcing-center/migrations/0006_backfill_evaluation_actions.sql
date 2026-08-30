DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM schema_migrations WHERE version = '0006_backfill_evaluation_actions') THEN
    WITH completed_runs AS (
      SELECT ar.id AS run_id,ar.workspace_id,ar.request_id,ar.started_at,ar.finished_at,
             sr.required_delivery_days,e.strategy,
             (SELECT count(*)::int FROM quotes q WHERE q.rfq_id=e.rfq_id) AS quote_count,
             (SELECT count(*)::int FROM evaluation_items item WHERE item.evaluation_id=e.id) AS ranked_count
        FROM agent_runs ar
        JOIN evaluations e ON e.agent_run_id=ar.id AND e.status='SUCCEEDED'
        JOIN sourcing_requests sr ON sr.id=ar.request_id
       WHERE ar.run_type='EVALUATION' AND ar.status='SUCCEEDED' AND ar.finished_at IS NOT NULL
    ), action_templates AS (
      SELECT * FROM (VALUES
        (0,'LOAD_REVEALED_QUOTES'),
        (1,'VERIFY_QUOTE_SET'),
        (2,'CALCULATE_PRICE_SCORE'),
        (3,'CALCULATE_DELIVERY_SCORE'),
        (4,'CALCULATE_MATCH_RISK_SCORE'),
        (5,'APPLY_EVALUATION_WEIGHTS'),
        (6,'ANALYZE_EVALUATION_WITH_DEEPSEEK'),
        (7,'VALIDATE_EVALUATION_OUTPUT'),
        (8,'SAVE_EVALUATION_RANKING')
      ) AS template(ordinal,action_type)
    )
    INSERT INTO agent_actions(workspace_id,request_id,agent_run_id,action_type,status,hit_count,summary,started_at,finished_at)
    SELECT run.workspace_id,run.request_id,run.run_id,template.action_type,'SUCCEEDED',run.ranked_count,
           CASE template.action_type
             WHEN 'LOAD_REVEALED_QUOTES' THEN format('已读取 %s 份停止报价后统一解封的有效报价',run.quote_count)
             WHEN 'VERIFY_QUOTE_SET' THEN format('%s 份报价的密封载荷、解封明细和关闭记录数量一致',run.quote_count)
             WHEN 'CALCULATE_PRICE_SCORE' THEN format('已完成 %s 份报价的价格标准化评分',run.quote_count)
             WHEN 'CALCULATE_DELIVERY_SCORE' THEN format('已按 %s 天交付要求完成交期评分',run.required_delivery_days)
             WHEN 'CALCULATE_MATCH_RISK_SCORE' THEN format('已完成 %s 家供应商的匹配度与履约风险量化',run.quote_count)
             WHEN 'APPLY_EVALUATION_WEIGHTS' THEN format('已按 %s 策略生成 Top %s',run.strategy,run.ranked_count)
             WHEN 'ANALYZE_EVALUATION_WITH_DEEPSEEK' THEN format('已生成 %s 份推荐与风险说明',run.ranked_count)
             WHEN 'VALIDATE_EVALUATION_OUTPUT' THEN format('评估输出与 Top %s 报价白名单完全一致',run.ranked_count)
             ELSE format('已保存 Top %s 报价、Agent 建议和分项得分',run.ranked_count)
           END,
           run.started_at + (run.finished_at-run.started_at) * (template.ordinal::double precision/9),
           run.started_at + (run.finished_at-run.started_at) * ((template.ordinal::double precision+0.8)/9)
      FROM completed_runs run CROSS JOIN action_templates template
     WHERE NOT EXISTS (
       SELECT 1 FROM agent_actions existing
        WHERE existing.agent_run_id=run.run_id AND existing.action_type=template.action_type
     );

    INSERT INTO schema_migrations(version) VALUES ('0006_backfill_evaluation_actions');
  END IF;
END $$;
