'use client';

import {
  CheckCircleOutlined,
  DatabaseOutlined,
  GlobalOutlined,
  LoadingOutlined,
  RobotOutlined,
  SendOutlined,
  ShopOutlined,
  UserOutlined,
} from '@ant-design/icons';
import { Alert, Avatar, Button, Card, Input, Space, Table, Tag, Typography } from 'antd';
import type { TableColumnsType } from 'antd';
import { Fragment, useEffect, useMemo, useRef, useState } from 'react';
import type { AgentAction, SourcingCandidate, SourcingRequestDetail } from '../types';
import { supplierTypeLabel } from '../utils';
import styles from '../pages/SourcingAgentPage.module.css';
import AgentProcessCard from './AgentProcessCard';

const { Paragraph, Text, Title } = Typography;

function formatMessageTime(value?: string | null) {
  if (!value) return '-';
  return new Intl.DateTimeFormat('zh-CN', {
    timeZone: 'Asia/Shanghai',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  }).format(new Date(value));
}

type Props = {
  detail: SourcingRequestDetail;
  running: boolean;
  publishing: boolean;
  onSend: (message: string) => Promise<void>;
  onPublish: () => Promise<void>;
};

export default function SourcingConversation({ detail, running, publishing, onSend, onPublish }: Props) {
  const [draft, setDraft] = useState('请根据当前寻源需求，查询内部和外部供应商并给出推荐清单。');
  const messageListRef = useRef<HTMLDivElement>(null);
  const candidateResultRef = useRef<HTMLDivElement>(null);

  const actionGroups = useMemo(() => {
    const groups = new Map<string, AgentAction[]>();
    detail.agentActions
      .filter((action) => !action.runType || action.runType === 'SOURCING')
      .forEach((action) => {
        const key = action.agentRunId || 'legacy';
        const current = groups.get(key) || [];
        current.push(action);
        groups.set(key, current);
      });
    return groups;
  }, [detail.agentActions]);

  const renderAgentProcess = (runId: string, actions: AgentAction[], seeded = false) => {
    const activeRun = detail.activeSourcingAgentRun?.id === runId
      ? detail.activeSourcingAgentRun
      : detail.latestSourcingAgentRun?.id === runId
        ? detail.latestSourcingAgentRun
        : null;
    return <AgentProcessCard title="寻源 Agent 执行过程" actions={actions} run={activeRun} seeded={seeded} />;
  };

  const attachedRunIds = new Set(detail.agentMessages.map((message) => message.agentRunId).filter(Boolean));
  const unattachedProcesses = [...actionGroups.entries()].filter(([runId]) => runId === 'legacy' || !attachedRunIds.has(runId));
  const activeRunHasActions = Boolean(detail.activeSourcingAgentRun?.id && actionGroups.get(detail.activeSourcingAgentRun.id)?.length);
  const actionFingerprint = [
    ...detail.agentActions.map((action) => `${action.id}:${action.status}:${action.summary}:${action.hitCount ?? ''}:${action.finishedAt || ''}`),
    `${detail.activeSourcingAgentRun?.id || ''}:${detail.activeSourcingAgentRun?.status || ''}`,
    `${detail.latestSourcingAgentRun?.id || ''}:${detail.latestSourcingAgentRun?.status || ''}:${detail.latestSourcingAgentRun?.errorMessage || ''}`,
  ].join('|');
  const candidateResultRunId = detail.candidateSourcingAgentRunId;
  const candidateResultMessageId = useMemo(() => {
    if (!candidateResultRunId) return null;
    for (let index = detail.agentMessages.length - 1; index >= 0; index -= 1) {
      const message = detail.agentMessages[index];
      if (message.role !== 'USER' && message.agentRunId === candidateResultRunId) return message.id;
    }
    return null;
  }, [candidateResultRunId, detail.agentMessages]);

  useEffect(() => {
    const list = messageListRef.current;
    if (!list) return;
    const frame = window.requestAnimationFrame(() => {
      list.scrollTo({ top: list.scrollHeight, behavior: running ? 'smooth' : 'auto' });
    });
    return () => window.cancelAnimationFrame(frame);
  }, [actionFingerprint, detail.agentMessages.length, running]);

  useEffect(() => {
    const list = messageListRef.current;
    const result = candidateResultRef.current;
    if (!list || !result || !candidateResultRunId) return;
    const frame = window.requestAnimationFrame(() => {
      list.scrollTo({ top: Math.max(0, result.offsetTop - list.offsetTop - 12), behavior: 'smooth' });
    });
    return () => window.cancelAnimationFrame(frame);
  }, [candidateResultRunId]);

  const candidateColumns: TableColumnsType<SourcingCandidate> = [
    {
      title: '候选供应商',
      dataIndex: 'supplierName',
      width: 230,
      render: (_, record) => (
        <Space>
          <Avatar icon={record.supplierType === 'INTERNAL' ? <DatabaseOutlined /> : <GlobalOutlined />} />
          <Space direction="vertical" size={0}>
            <Text strong>{record.supplierName}</Text>
            <Text type="secondary" className={styles.compactText}>{record.supplierNo}</Text>
          </Space>
        </Space>
      ),
    },
    {
      title: '来源',
      width: 150,
      render: (_, record) => (
        <Space direction="vertical" size={0}>
          <Tag color={record.supplierType === 'INTERNAL' ? 'blue' : 'green'}>{supplierTypeLabel[record.supplierType]}</Tag>
          <Text type="secondary" className={styles.compactText}>{record.sourcePlatform}</Text>
        </Space>
      ),
    },
    {
      title: '匹配度',
      dataIndex: 'matchScore',
      width: 100,
      render: (value: number) => <Text strong>{value.toFixed(0)}%</Text>,
    },
    {
      title: '资质 / 交期',
      width: 210,
      render: (_, record) => (
        <Space direction="vertical" size={2}>
          <Text>{record.qualifications.join('、') || '无特殊要求'}</Text>
          <Text type="secondary">预计 {record.expectedDeliveryDays} 天</Text>
        </Space>
      ),
    },
    {
      title: 'Agent 建议',
      dataIndex: 'recommendation',
      width: 300,
      render: (value: string, record) => (
        <Space direction="vertical" size={2}>
          <Text>{value}</Text>
          <Text type="secondary" className={styles.compactText}>{record.riskSummary}</Text>
        </Space>
      ),
    },
  ];

  const renderCandidateResult = () => {
    if (!detail.candidates.length) return null;
    const internalCount = detail.candidates.filter((candidate) => candidate.supplierType === 'INTERNAL').length;
    const externalCount = detail.candidates.length - internalCount;
    return (
      <div ref={candidateResultRef} className={styles.candidateResultWrap}>
        <Card
          className={styles.candidateResultCard}
          title={(
            <Space size={8} wrap>
              <CheckCircleOutlined className={styles.resultIcon} />
              <Text strong>寻源结果</Text>
              <Tag color="red">{detail.candidates.length} 家候选供应商</Tag>
              <Tag color="blue">内部 {internalCount} 家</Tag>
              <Tag color="green">外部 {externalCount} 家</Tag>
            </Space>
          )}
          extra={detail.status === 'SOURCING_READY' ? (
            <Button
              type="primary"
              icon={<ShopOutlined />}
              disabled={!detail.candidates.length || running || publishing}
              loading={publishing}
              onClick={() => void onPublish()}
            >
              邀请全部 {detail.candidates.length} 家并发布询价
            </Button>
          ) : null}
        >
          <div className="mobile-table-scroll">
            <div className="mobile-table-hint" role="note">左右滑动查看完整候选信息</div>
            <Table<SourcingCandidate>
              rowKey="supplierNo"
              columns={candidateColumns}
              dataSource={detail.candidates}
              pagination={false}
              size="small"
              scroll={{ x: 990 }}
            />
          </div>
        </Card>
      </div>
    );
  };

  const candidateResultAttached = Boolean(candidateResultMessageId);

  const submitMessage = async () => {
    const message = draft.trim();
    if (!message) return;
    try {
      await onSend(message);
      setDraft('');
    } catch {
      return;
    }
  };

  return (
    <div className={styles.stageGrid}>
      <Card title="寻源 Agent 对话与执行过程" className={styles.conversationCard}>
        <div ref={messageListRef} className={styles.messageList} aria-label="寻源 Agent 对话消息">
          {detail.agentMessages.length === 0 ? (
            <div className={styles.agentEmpty}>
              <RobotOutlined />
              <Title level={5}>发送需求，开始 Agent 寻源</Title>
              <Paragraph type="secondary">Agent 会读取共享数据库中的内部供应商，以及已同步并标记来源的 1688、行业平台、企业信息库供应商数据。</Paragraph>
            </div>
          ) : detail.agentMessages.map((message) => {
            const actions = message.role === 'USER' && message.agentRunId ? actionGroups.get(message.agentRunId) : undefined;
            return (
              <Fragment key={message.id}>
                <div className={`${styles.chatMessage} ${message.role === 'USER' ? styles.userMessage : styles.agentMessage}`}>
                  <div className={styles.messageHead}>
                    <Space>
                      <Avatar size="small" icon={message.role === 'USER' ? <UserOutlined /> : <RobotOutlined />} />
                      <Text strong>{message.role === 'USER' ? '采购人员' : '寻源 Agent'}</Text>
                      {message.isSeeded && <Tag>初始化记录</Tag>}
                    </Space>
                    <Text type="secondary" className={styles.compactText}>{formatMessageTime(message.createdAt)}</Text>
                  </div>
                  <Paragraph>{message.content}</Paragraph>
                </div>
                {actions?.length ? renderAgentProcess(message.agentRunId!, actions, Boolean(message.isSeeded)) : null}
                {message.id === candidateResultMessageId ? renderCandidateResult() : null}
              </Fragment>
            );
          })}
          {unattachedProcesses.map(([runId, actions]) => (
            <Fragment key={runId}>{renderAgentProcess(runId, actions)}</Fragment>
          ))}
          {!candidateResultAttached ? renderCandidateResult() : null}
          {running && !activeRunHasActions && (
            <div className={styles.agentProcess}>
              <Alert type="info" showIcon icon={<LoadingOutlined />} message="正在建立本轮寻源任务并校验采购条件…" />
            </div>
          )}
        </div>
        <Space.Compact block className={styles.chatInput}>
          <Input
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
            onPressEnter={(event) => { event.preventDefault(); void submitMessage(); }}
            placeholder="可以要求 Agent 在固定条件范围内调整并重新寻源"
            disabled={running || detail.status === 'BIDDING_OPEN'}
          />
          <Button type="primary" icon={<SendOutlined />} loading={running} disabled={!draft.trim()} onClick={() => void submitMessage()}>
            发送
          </Button>
        </Space.Compact>
      </Card>
    </div>
  );
}
