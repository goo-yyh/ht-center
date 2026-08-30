'use client';

import {
  ClockCircleOutlined,
  EyeOutlined,
  StopOutlined,
  ThunderboltOutlined,
} from '@ant-design/icons';
import { Alert, Button, Card, Col, Descriptions, Row, Space, Statistic, Table, Tag, Tooltip, Typography } from 'antd';
import type { TableColumnsType } from 'antd';
import { useEffect, useState } from 'react';
import type { NotificationRecord, RfqProgress, SupplierProgress } from '../types';
import { formatCurrency, formatDateTime, getCountdown, supplierTypeLabel } from '../utils';
import styles from '../pages/SourcingAgentPage.module.css';

const { Text } = Typography;

type Props = {
  progress: RfqProgress;
  notifications: NotificationRecord[];
  serverTime: string;
  closing: boolean;
  simulating: boolean;
  onClose: () => void;
  onSimulateRemainingQuotes: () => Promise<void>;
};

export default function QuoteProgress({ progress, notifications, serverTime, closing, simulating, onClose, onSimulateRemainingQuotes }: Props) {
  const [currentServerTime, setCurrentServerTime] = useState(() => new Date(serverTime).getTime());

  useEffect(() => {
    const serverTimeAtStart = new Date(serverTime).getTime();
    const clientTimeAtStart = Date.now();
    setCurrentServerTime(serverTimeAtStart);
    const timer = window.setInterval(() => {
      setCurrentServerTime(serverTimeAtStart + Date.now() - clientTimeAtStart);
    }, 1000);
    return () => window.clearInterval(timer);
  }, [serverTime]);

  const adjustedServerTime = new Date(currentServerTime).toISOString();
  const remainingQuoteCount = Math.max(0, progress.counts.invited - progress.counts.submitted);
  const quoteExpired = currentServerTime >= new Date(progress.deadlineAt).getTime();
  const columns: TableColumnsType<SupplierProgress> = [
    {
      title: '供应商',
      dataIndex: 'supplierName',
      width: 170,
      render: (_, record) => (
        <Space direction="vertical" size={0}>
          <Text strong>{record.supplierName}</Text>
          <Text type="secondary" className={styles.compactText}>{record.supplierNo}</Text>
        </Space>
      ),
    },
    {
      title: '类型',
      dataIndex: 'supplierType',
      width: 72,
      render: (value: SupplierProgress['supplierType']) => <Tag color={value === 'INTERNAL' ? 'blue' : 'green'}>{supplierTypeLabel[value]}</Tag>,
    },
    {
      title: '参与状态',
      width: 125,
      render: (_, record) => (
        <Space wrap size={[4, 4]}>
          {record.supplierType === 'EXTERNAL' && <Tag color={record.registeredAt ? 'green' : 'default'}>{record.registeredAt ? '已注册' : '待注册'}</Tag>}
          <Tag color={record.viewedAt ? 'cyan' : 'default'}>{record.viewedAt ? '已查看' : '未查看'}</Tag>
        </Space>
      ),
    },
    {
      title: '最新报价',
      width: 150,
      render: (_, record) => record.latestQuote
        ? <Space direction="vertical" size={0}><Text strong>{formatCurrency(record.latestQuote.totalAmount)}</Text><Text type="secondary" className={styles.compactText}>{record.latestQuote.quoteNo}</Text></Space>
        : <Tag color="gold">等待提交</Tag>,
    },
    {
      title: '交期',
      width: 72,
      render: (_, record) => record.latestQuote ? `${record.latestQuote.deliveryDays} 天` : '-',
    },
    {
      title: '版本',
      width: 82,
      render: (_, record) => record.latestQuote
        ? <Tag color="red">V{record.latestQuote.version}</Tag>
        : '-',
    },
    {
      title: '报价备注',
      width: 150,
      render: (_, record) => record.latestQuote
        ? <Text ellipsis={{ tooltip: record.latestQuote.remark || '无' }}>{record.latestQuote.remark || '无'}</Text>
        : <Text type="secondary">-</Text>,
    },
    {
      title: '提交时间',
      width: 138,
      render: (_, record) => record.latestQuote
        ? <Text type="secondary" className={styles.compactText}>{formatDateTime(record.latestQuote.submittedAt)}</Text>
        : <Text type="secondary">-</Text>,
    },
  ];

  const notificationColumns: TableColumnsType<NotificationRecord> = [
    { title: '供应商', dataIndex: 'supplierName', width: 190 },
    { title: '接收地址', dataIndex: 'recipientAddress', width: 260, render: (value: string) => <span className={styles.wrapAnywhere}>{value}</span> },
    { title: '通知类型', dataIndex: 'notificationType', width: 130, render: () => <Tag>询价通知</Tag> },
    { title: '状态', dataIndex: 'status', width: 180, render: () => <Tag color="green">发送记录已生成</Tag> },
    { title: '生成时间', dataIndex: 'generatedAt', width: 170, render: (value: string) => <span className={styles.nowrapText}>{formatDateTime(value)}</span> },
  ];

  return (
    <Space direction="vertical" size={16} className={styles.quoteProgressStack}>
      <Alert
        className={styles.quoteStageAlert}
        type="info"
        showIcon
        icon={<EyeOutlined />}
        message="当前为实时报价阶段"
        description="采购人员和 Agent 可以查看供应商的最新报价。内外部供应商首次报价后均可根据竞争力分析再报价一次，表格始终展示最新版本；一键模拟只补齐未提交供应商。"
        action={(
          <Space wrap size={8}>
            <Tooltip title="为剩余供应商生成各不相同的有效报价，并按正式流程提交">
              <Button
                type="primary"
                icon={<ThunderboltOutlined />}
                loading={simulating}
                disabled={closing || quoteExpired || remainingQuoteCount === 0 || progress.status !== 'OPEN'}
                onClick={() => void onSimulateRemainingQuotes().catch(() => undefined)}
              >
                {remainingQuoteCount > 0 ? `一键模拟剩余 ${remainingQuoteCount} 家报价` : '报价已全部提交'}
              </Button>
            </Tooltip>
            <Button danger icon={<StopOutlined />} loading={closing} disabled={simulating} onClick={onClose}>
              {remainingQuoteCount === 0 ? '停止报价并进入评估' : '提前停止报价'}
            </Button>
          </Space>
        )}
      />

      <Row gutter={[12, 12]} className={styles.quoteStatsRow}>
        {[
          ['已邀请', progress.counts.invited],
          ['外部已注册', progress.counts.registeredExternal],
          ['已查看', progress.counts.viewed],
          ['已提交报价', progress.counts.submitted],
        ].map(([label, value]) => (
          <Col xs={12} md={6} key={String(label)}><Card size="small"><Statistic title={label} value={value} suffix="家" /></Card></Col>
        ))}
      </Row>

      <Card size="small">
        <Descriptions column={{ xs: 1, sm: 2, md: 3 }}>
          <Descriptions.Item label="询价编号"><Text strong>{progress.rfqNo}</Text></Descriptions.Item>
          <Descriptions.Item label="截止时间">{formatDateTime(progress.deadlineAt)}</Descriptions.Item>
          <Descriptions.Item label="剩余时间">
            <Space><ClockCircleOutlined className="red" /><Text strong>{getCountdown(progress.deadlineAt, adjustedServerTime)}</Text></Space>
          </Descriptions.Item>
        </Descriptions>
      </Card>

      <Card title="供应商报价进度" extra={<Tag icon={<EyeOutlined />} color="green">最新报价实时可见</Tag>}>
        <div className="mobile-table-scroll">
          <div className="mobile-table-hint" role="note">左右滑动查看全部供应商报价信息</div>
          <Table<SupplierProgress> rowKey="supplierNo" columns={columns} dataSource={progress.suppliers} pagination={false} scroll={{ x: 1_040 }} />
        </div>
      </Card>

      <Card title="通知发送记录" extra={<Text type="secondary">当前环境仅记录发送结果，不实际发送邮件或消息</Text>}>
        <div className="mobile-table-scroll">
          <div className="mobile-table-hint" role="note">左右滑动查看完整通知记录</div>
          <Table<NotificationRecord> rowKey="id" columns={notificationColumns} dataSource={notifications} pagination={false} scroll={{ x: 930 }} />
        </div>
      </Card>
    </Space>
  );
}
