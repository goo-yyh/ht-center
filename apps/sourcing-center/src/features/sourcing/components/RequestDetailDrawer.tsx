'use client';

import { DownloadOutlined, PaperClipOutlined, ReloadOutlined } from '@ant-design/icons';
import { Button, Descriptions, Drawer, Empty, Spin, Steps, Tag, Typography } from 'antd';
import type { SourcingRequestDetail } from '../types';
import { evaluationStrategyLabel, formatDateTime, statusMeta } from '../utils';
import EvaluationPanel from './EvaluationPanel';
import QuoteProgress from './QuoteProgress';
import SourcingConversation from './SourcingConversation';
import styles from '../pages/SourcingAgentPage.module.css';

const { Text } = Typography;

const closeReasonLabel = {
  EARLY_STOP: '采购提前停止',
  DEADLINE_REACHED: '到期自动停止',
} as const;

type Props = {
  open: boolean;
  detail: SourcingRequestDetail | null;
  serverTime: string;
  loading: boolean;
  actionRunning: boolean;
  agentRunning: boolean;
  evaluationRunning: boolean;
  quoteSimulationRunning: boolean;
  onClose: () => void;
  onReload: () => void;
  onSendAgentMessage: (message: string) => Promise<void>;
  onPublish: () => Promise<void>;
  onCloseRfq: () => void;
  onSimulateRemainingQuotes: () => Promise<void>;
  onEvaluate: () => Promise<void>;
  onCreatePr: (quoteNo: string) => Promise<void>;
};

export default function RequestDetailDrawer({
  open,
  detail,
  serverTime,
  loading,
  actionRunning,
  agentRunning,
  evaluationRunning,
  quoteSimulationRunning,
  onClose,
  onReload,
  onSendAgentMessage,
  onPublish,
  onCloseRfq,
  onSimulateRemainingQuotes,
  onEvaluate,
  onCreatePr,
}: Props) {
  const isSourcingStage = Boolean(
    detail && (detail.status === 'SOURCING_RUNNING' || detail.status === 'SOURCING_READY'),
  );
  const closedRfq = detail?.rfq?.status === 'CLOSED' ? detail.rfq : null;

  const renderStage = () => {
    if (!detail) return <Empty description="请选择寻源需求" />;

    if (detail.status === 'SOURCING_RUNNING' || detail.status === 'SOURCING_READY') {
      return (
        <SourcingConversation
          detail={detail}
          running={agentRunning}
          publishing={actionRunning && !agentRunning}
          onSend={onSendAgentMessage}
          onPublish={onPublish}
        />
      );
    }

    if (detail.status === 'BIDDING_OPEN' && detail.rfq) {
      return (
        <QuoteProgress
          progress={detail.rfq}
          notifications={detail.notifications ?? []}
          serverTime={serverTime}
          closing={actionRunning && !quoteSimulationRunning}
          simulating={quoteSimulationRunning}
          onClose={onCloseRfq}
          onSimulateRemainingQuotes={onSimulateRemainingQuotes}
        />
      );
    }

    if (['EVALUATION_PENDING', 'AWARD_PENDING', 'COMPLETED'].includes(detail.status)) {
      return (
        <EvaluationPanel
          detail={detail}
          running={evaluationRunning}
          submitting={actionRunning}
          onEvaluate={onEvaluate}
          onCreatePr={onCreatePr}
        />
      );
    }

    return <Empty description="当前阶段暂无可展示内容" />;
  };

  return (
    <Drawer
      title={detail ? `${detail.requestNo} · ${detail.itemName}` : '寻源需求详情'}
      width="min(1200px, 96vw)"
      open={open}
      onClose={onClose}
      extra={<Button icon={<ReloadOutlined />} loading={loading} onClick={onReload}>刷新</Button>}
      className={styles.detailDrawer}
    >
      <Spin spinning={loading && !detail}>
        {detail && (
          <div className={styles.detailStack}>
            <div className={styles.stepPanel}>
              <Steps
                size="small"
                responsive={false}
                current={statusMeta[detail.status].step}
                status={detail.status === 'COMPLETED' ? 'finish' : 'process'}
                items={[
                  { title: 'Agent 寻源' },
                  { title: '等待报价' },
                  { title: 'Agent 评估报价' },
                  { title: '创建采购申请 PR' },
                ]}
              />
            </div>

            <div className={styles.requestSummary}>
              <Descriptions bordered size="small" column={{ xs: 1, sm: 2, lg: 4 }}>
                <Descriptions.Item label="当前状态"><Tag color={statusMeta[detail.status].color}>{statusMeta[detail.status].label}</Tag></Descriptions.Item>
                <Descriptions.Item label="规格与标准">{detail.specification}</Descriptions.Item>
                <Descriptions.Item label="采购数量">{detail.quantity.toLocaleString()} {detail.unit}</Descriptions.Item>
                <Descriptions.Item label="资质要求">{detail.qualificationLabels?.join('、') || detail.qualificationCodes.join('、') || '无特殊要求'}</Descriptions.Item>
                <Descriptions.Item label="交付要求">{detail.requiredDeliveryDays} 天内</Descriptions.Item>
                <Descriptions.Item label={closedRfq ? '停止报价时间' : detail.rfq ? '报价截止' : '计划报价时长'}>
                  {closedRfq ? (
                    <span className={styles.summaryValue}>
                      <span>{closedRfq.closedAt ? formatDateTime(closedRfq.closedAt) : '—'}</span>
                      {closedRfq.closeReason && (
                        <Tag color={closedRfq.closeReason === 'EARLY_STOP' ? 'orange' : 'default'}>
                          {closeReasonLabel[closedRfq.closeReason]}
                        </Tag>
                      )}
                    </span>
                  ) : detail.rfq ? formatDateTime(detail.rfq.deadlineAt) : `${detail.quoteDurationMinutes} 分钟`}
                </Descriptions.Item>
                {closedRfq && (
                  <Descriptions.Item label="原报价截止">{formatDateTime(closedRfq.deadlineAt)}</Descriptions.Item>
                )}
                <Descriptions.Item label="评估策略">{evaluationStrategyLabel[detail.evaluationStrategy]}</Descriptions.Item>
                <Descriptions.Item label="采购附件">
                  {detail.attachment ? (
                    <Button
                      type="link"
                      size="small"
                      icon={<PaperClipOutlined />}
                      className={styles.attachmentLink}
                      href={`/api/demo/v1/attachments/${encodeURIComponent(detail.attachment.id)}/download`}
                    >
                      {detail.attachment.fileName} <DownloadOutlined />
                    </Button>
                  ) : <Text type="secondary">无附件</Text>}
                </Descriptions.Item>
              </Descriptions>
            </div>

            <div className={`${styles.stageArea} ${isSourcingStage ? styles.sourcingStageArea : ''}`}>
              {renderStage()}
            </div>
          </div>
        )}
      </Spin>
    </Drawer>
  );
}
