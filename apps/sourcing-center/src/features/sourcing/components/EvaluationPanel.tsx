'use client';

import {
  CheckCircleOutlined,
  FileDoneOutlined,
  InfoCircleOutlined,
  RobotOutlined,
  SafetyCertificateOutlined,
  TrophyOutlined,
} from '@ant-design/icons';
import { Alert, App as AntdApp, Button, Card, Descriptions, Result, Space, Table, Tag, Tooltip, Typography } from 'antd';
import type { TableColumnsType } from 'antd';
import { useEffect, useState } from 'react';
import type { EvaluationItem, RevealedQuote, SourcingRequestDetail } from '../types';
import { evaluationStrategyLabel, formatCurrency, formatDateTime, supplierTypeLabel } from '../utils';
import styles from '../pages/SourcingAgentPage.module.css';
import AgentProcessCard from './AgentProcessCard';

const { Paragraph, Text } = Typography;

type Props = {
  detail: SourcingRequestDetail;
  running: boolean;
  submitting: boolean;
  onEvaluate: () => Promise<void>;
  onCreatePr: (quoteNo: string) => Promise<void>;
};

export default function EvaluationPanel({ detail, running, submitting, onEvaluate, onCreatePr }: Props) {
  const { modal } = AntdApp.useApp();
  const [selectedQuoteNo, setSelectedQuoteNo] = useState<string>();
  const evaluationNo = detail.evaluation?.evaluationNo;
  const firstQuoteNo = detail.evaluation?.items[0]?.quoteNo;

  useEffect(() => {
    setSelectedQuoteNo(firstQuoteNo);
  }, [evaluationNo, firstQuoteNo]);

  const evaluationRun = detail.activeEvaluationAgentRun ?? detail.latestEvaluationAgentRun;
  const allEvaluationActions = evaluationRun
    ? detail.agentActions.filter((action) => action.runType === 'EVALUATION' && action.agentRunId === evaluationRun.id)
    : [];
  const hasDetailedEvaluationSteps = allEvaluationActions.some((action) =>
    ['LOAD_CURRENT_QUOTES', 'LOAD_REVEALED_QUOTES', 'CALCULATE_PRICE_SCORE'].includes(action.actionType),
  );
  const evaluationActions = hasDetailedEvaluationSteps
    ? allEvaluationActions.filter((action) => action.actionType !== 'CALCULATE_QUOTE_SCORE')
    : allEvaluationActions;
  const evaluationSummary = evaluationRun
    ? [...detail.agentMessages].reverse().find((message) => message.agentRunId === evaluationRun.id && message.role === 'ASSISTANT')
    : undefined;
  const evaluationProcess = evaluationRun ? (
    <AgentProcessCard
      title="报价评估 Agent 执行过程"
      actions={evaluationActions}
      run={evaluationRun}
      fullWidth
    />
  ) : running ? (
    <Alert type="info" showIcon message="正在建立报价评估任务并校验最新报价数据…" />
  ) : null;

  const confirmCreatePr = () => {
    const selectedQuote = detail.evaluation?.items.find((item) => item.quoteNo === selectedQuoteNo);
    if (!selectedQuote) return;

    modal.confirm({
      title: '确认创建采购申请 PR？',
      icon: <FileDoneOutlined />,
      width: 560,
      content: (
        <Space direction="vertical" size={14} style={{ width: '100%' }}>
          <Alert
            type="warning"
            showIcon
            message="确认后将以该报价作为唯一中选结果"
            description="采购申请创建后不能在当前流程中更换供应商或修改中选报价。"
          />
          <Descriptions bordered size="small" column={1}>
            <Descriptions.Item label="中选供应商">{selectedQuote.supplierName}</Descriptions.Item>
            <Descriptions.Item label="中选总价"><Text strong className="red">{formatCurrency(selectedQuote.totalAmount)}</Text></Descriptions.Item>
            <Descriptions.Item label="交期">{selectedQuote.deliveryDays} 天</Descriptions.Item>
            <Descriptions.Item label="报价编号">{selectedQuote.quoteNo}</Descriptions.Item>
          </Descriptions>
        </Space>
      ),
      okText: '确认创建 PR',
      cancelText: '返回检查',
      okButtonProps: { danger: true },
      onOk: () => onCreatePr(selectedQuote.quoteNo),
    });
  };

  if (detail.status === 'COMPLETED' && detail.purchaseRequisition) {
    const pr = detail.purchaseRequisition;
    return (
      <Space direction="vertical" size={16} className={styles.evaluationStack}>
        {evaluationProcess}
        {evaluationSummary && <Alert type="info" showIcon message="模型评估说明" description={evaluationSummary.content} />}
        <Result
          className={styles.prResult}
          status="success"
          title={`采购申请 ${pr.prNo} 已创建`}
          subTitle="该寻源需求已经完成，采购申请中的供应商、价格和交期来自唯一中选报价。"
          extra={
            <Card title="采购申请 PR" className={styles.prCard}>
              <Descriptions bordered column={{ xs: 1, sm: 2 }}>
                <Descriptions.Item label="PR 编号"><Text strong>{pr.prNo}</Text></Descriptions.Item>
                <Descriptions.Item label="创建时间">{formatDateTime(pr.createdAt)}</Descriptions.Item>
                <Descriptions.Item label="采购物品">{pr.itemName}</Descriptions.Item>
                <Descriptions.Item label="规格">{pr.specification}</Descriptions.Item>
                <Descriptions.Item label="采购数量">{pr.quantity.toLocaleString()} {pr.unit}</Descriptions.Item>
                <Descriptions.Item label="中选供应商"><Text strong>{pr.supplierName}</Text></Descriptions.Item>
                <Descriptions.Item label="中选总价"><Text strong className="red">{formatCurrency(pr.totalAmount)}</Text></Descriptions.Item>
                <Descriptions.Item label="交期">{pr.deliveryDays} 天</Descriptions.Item>
                <Descriptions.Item label="关联询价">{pr.rfqNo}</Descriptions.Item>
                <Descriptions.Item label="关联报价">{pr.quoteNo}</Descriptions.Item>
              </Descriptions>
            </Card>
          }
        />
      </Space>
    );
  }

  const quoteColumns: TableColumnsType<RevealedQuote> = [
    { title: '报价编号', dataIndex: 'quoteNo', width: 160 },
    {
      title: '供应商',
      dataIndex: 'supplierName',
      width: 220,
      render: (_, record) => <Space direction="vertical" size={0}><Text strong>{record.supplierName}</Text><Tag color={record.supplierType === 'INTERNAL' ? 'blue' : 'green'}>{supplierTypeLabel[record.supplierType]}</Tag></Space>,
    },
    { title: '报价总价', dataIndex: 'totalAmount', width: 170, render: (value: string) => <Text strong className={styles.nowrapText}>{formatCurrency(value)}</Text> },
    { title: '交期', dataIndex: 'deliveryDays', width: 90, render: (value: number) => `${value} 天` },
    { title: '版本', width: 90, render: (_, record) => <Tag color="red">V{record.version}</Tag> },
    { title: '商务备注', dataIndex: 'remark', width: 200, render: (value?: string) => value || '-' },
    { title: '提交时间', dataIndex: 'submittedAt', width: 170, render: (value: string) => <span className={styles.nowrapText}>{formatDateTime(value)}</span> },
  ];

  const evaluationColumns: TableColumnsType<EvaluationItem> = [
    {
      title: '排名',
      dataIndex: 'rank',
      width: 76,
      render: (value: number) => <span className={value <= 3 ? styles.rankBadge : styles.rankPlain}>{value}</span>,
    },
    {
      title: '供应商',
      dataIndex: 'supplierName',
      width: 200,
      render: (_, record) => (
        <Space direction="vertical" size={2}>
          <Text strong>{record.supplierName}</Text>
          <Tag color={record.supplierType === 'INTERNAL' ? 'blue' : 'green'}>{supplierTypeLabel[record.supplierType]}</Tag>
        </Space>
      ),
    },
    { title: '总价', dataIndex: 'totalAmount', width: 160, render: (value: string) => <span className={styles.nowrapText}>{formatCurrency(value)}</span> },
    { title: '交期', dataIndex: 'deliveryDays', width: 90, render: (value: number) => `${value} 天` },
    {
      title: '综合得分',
      dataIndex: 'totalScore',
      width: 130,
      render: (value: number, record) => (
        <Tooltip
          title={`价格 ${record.priceScore.toFixed(1)} · 交期 ${record.deliveryScore.toFixed(1)} · 匹配 ${record.matchScore.toFixed(1)} · 风险 ${record.riskScore.toFixed(1)}`}
        >
          <Button
            type="link"
            size="small"
            className={styles.scoreDetailButton}
            aria-label={`综合得分 ${value.toFixed(2)}，查看分项评分`}
          >
            {value.toFixed(2)} <InfoCircleOutlined />
          </Button>
        </Tooltip>
      ),
    },
    {
      title: 'Agent 结论',
      dataIndex: 'recommendation',
      width: 320,
      render: (value: string, record) => <Space direction="vertical" size={2}><Text>{value}</Text><Text type="secondary" className={styles.compactText}>{record.riskSummary}</Text></Space>,
    },
  ];

  if (!detail.evaluation) {
    return (
      <Space direction="vertical" size={16} className={styles.evaluationStack}>
        <Alert
          type="info"
          className={styles.evaluationReadyAlert}
          showIcon
          icon={<SafetyCertificateOutlined />}
          message="报价已经结束"
          description={`已锁定 ${detail.revealedQuotes?.length ?? 0} 份供应商最新有效报价，可以开始 Agent 综合评估。`}
          action={<Button type="primary" icon={<RobotOutlined />} loading={running} onClick={() => void onEvaluate()}>Agent 评估报价</Button>}
        />
        {evaluationProcess}
        <Card title="有效报价明细" extra={<Tag color="green">已锁定最新版本</Tag>}>
          <div className="mobile-table-scroll">
            <div className="mobile-table-hint" role="note">左右滑动查看完整报价信息</div>
            <Table<RevealedQuote> rowKey="quoteNo" columns={quoteColumns} dataSource={detail.revealedQuotes ?? []} pagination={false} scroll={{ x: 1_070 }} />
          </div>
        </Card>
      </Space>
    );
  }

  return (
    <Space direction="vertical" size={16} className={styles.evaluationStack}>
      {evaluationProcess}
      {evaluationSummary && <Alert type="info" showIcon message="模型评估说明" description={evaluationSummary.content} />}
      <Alert
        type="info"
        showIcon
        icon={<TrophyOutlined />}
        message={`Agent 已按“${evaluationStrategyLabel[detail.evaluation.strategy]}”生成报价排名`}
        description="评分数值由服务端确定性计算，模型只生成推荐说明和风险提示；请选择一家供应商创建采购申请。"
      />
      <Card
        title={`报价排名（${detail.evaluation.items.length}）`}
        extra={detail.status === 'AWARD_PENDING'
          ? null
          : <Tag color="green" icon={<CheckCircleOutlined />}>已完成</Tag>}
      >
        <div className="mobile-table-scroll">
          <div className="mobile-table-hint" role="note">左右滑动查看完整评估排名</div>
          <Table<EvaluationItem>
            rowKey="quoteNo"
            columns={evaluationColumns}
            dataSource={detail.evaluation.items}
            pagination={false}
            scroll={{ x: 1_050 }}
            rowSelection={detail.status === 'AWARD_PENDING' ? {
              type: 'radio',
              selectedRowKeys: selectedQuoteNo ? [selectedQuoteNo] : [],
              onChange: (keys) => setSelectedQuoteNo(String(keys[0])),
            } : undefined}
          />
        </div>
        <div className={styles.evaluationActionFooter} role="group" aria-label="采购申请操作">
          <Paragraph type="secondary" className={styles.tableFootnote}>
            中选后不可更换；最终 PR 数据由服务端从当前报价重新读取，页面不能篡改供应商、金额或交期。
          </Paragraph>
          {detail.status === 'AWARD_PENDING' && (
            <Button
              className={styles.createPrButton}
              type="primary"
              icon={<FileDoneOutlined />}
              loading={submitting}
              disabled={!selectedQuoteNo}
              onClick={confirmCreatePr}
            >
              选择一家并创建采购申请 PR
            </Button>
          )}
        </div>
      </Card>
    </Space>
  );
}
