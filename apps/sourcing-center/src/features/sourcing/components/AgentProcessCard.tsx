'use client';

import {
  CheckCircleOutlined,
  CloseCircleOutlined,
  LoadingOutlined,
  RobotOutlined,
} from '@ant-design/icons';
import { Alert, Avatar, ConfigProvider, Tag, theme, Timeline, Typography } from 'antd';
import type { AgentAction, SourcingAgentRun } from '../types';
import styles from '../pages/SourcingAgentPage.module.css';

const { Text } = Typography;
const ANT_DEFAULT_SUCCESS_COLOR = theme.defaultSeed.colorSuccess;
const agentProcessTheme = { inherit: true, token: { colorSuccess: ANT_DEFAULT_SUCCESS_COLOR } };

function formatActionTime(value?: string | null) {
  if (!value) return '-';
  return new Intl.DateTimeFormat('zh-CN', {
    timeZone: 'Asia/Shanghai',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    fractionalSecondDigits: 3,
    hour12: false,
  }).format(new Date(value));
}

function actionDuration(action: Pick<AgentAction, 'startedAt' | 'finishedAt'>) {
  if (!action.finishedAt) return '执行中';
  const duration = Math.max(0, new Date(action.finishedAt).getTime() - new Date(action.startedAt).getTime());
  if (duration < 1000) return `${duration} 毫秒`;
  return `${(duration / 1000).toFixed(duration < 10_000 ? 2 : 1)} 秒`;
}

type Props = {
  title: string;
  actions: AgentAction[];
  run: SourcingAgentRun | null;
  fullWidth?: boolean;
  seeded?: boolean;
};

export default function AgentProcessCard({ title, actions, run, fullWidth = false, seeded = false }: Props) {
  const failed = actions.some((action) => action.status === 'FAILED') || run?.status === 'FAILED';
  const processing = actions.some((action) => action.status === 'RUNNING') || run?.status === 'RUNNING';
  const status = failed
    ? { color: 'error' as const, text: '执行失败' }
    : processing
      ? { color: 'processing' as const, text: '执行中' }
      : { color: 'success' as const, text: '已完成' };
  const items = actions.map((action) => ({
    key: action.id,
    color: action.status === 'FAILED' ? 'red' : action.status === 'RUNNING' ? 'blue' : ANT_DEFAULT_SUCCESS_COLOR,
    dot: action.status === 'RUNNING'
      ? <LoadingOutlined />
      : action.status === 'FAILED'
        ? <CloseCircleOutlined />
        : <CheckCircleOutlined style={{ color: ANT_DEFAULT_SUCCESS_COLOR }} />,
    children: (
      <div className={styles.actionStep}>
        <div className={styles.actionStepHead}>
          <Text strong className={styles.actionStepTitle}>{action.label || action.actionType}</Text>
          <Tag
            bordered={false}
            className={styles.actionStatus}
            color={action.status === 'FAILED' ? 'error' : action.status === 'RUNNING' ? 'processing' : 'success'}
          >
            {action.status === 'FAILED' ? '失败' : action.status === 'RUNNING' ? '执行中' : '完成'}
          </Tag>
        </div>
        <Text className={styles.actionSummary}>{action.summary}</Text>
        <div className={styles.actionMeta}>
          {action.hitCount != null && <span className={styles.actionMetric}>命中 {action.hitCount} 条</span>}
          <span className={styles.actionMetric}>{action.finishedAt ? `耗时 ${actionDuration(action)}` : '正在计时'}</span>
          <Text type="secondary" className={styles.actionStartedAt}>开始 {formatActionTime(action.startedAt)}</Text>
        </div>
      </div>
    ),
  }));

  return (
    <ConfigProvider theme={agentProcessTheme}>
      <div className={`${styles.agentProcess} ${fullWidth ? styles.agentProcessFull : ''}`}>
        <div className={styles.agentProcessHead}>
          <div className={styles.agentProcessIdentity}>
            <Avatar size="small" icon={<RobotOutlined />} />
            <div className={styles.agentProcessTitleBlock}>
              <Text strong className={styles.agentProcessTitle}>{title}</Text>
              <div className={styles.agentProcessBadges}>
                <Tag bordered={false} color={status.color}>{status.text}</Tag>
                {(seeded || run?.isSeeded) && <Tag>初始化记录</Tag>}
                {run?.model && <Tag color="blue">{run.model}</Tag>}
              </div>
            </div>
          </div>
          {run?.finishedAt && (
            <Text type="secondary" className={styles.processDuration}>
              总耗时 {actionDuration({ startedAt: run.startedAt, finishedAt: run.finishedAt })}
            </Text>
          )}
        </div>
        {items.length > 0 && <Timeline items={items} className={styles.agentTimeline} />}
        {run?.errorMessage && <Alert type="error" showIcon message={run.errorMessage} className={styles.agentProcessError} />}
      </div>
    </ConfigProvider>
  );
}
