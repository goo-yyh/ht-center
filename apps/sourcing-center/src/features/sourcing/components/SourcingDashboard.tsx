'use client';

import {
  CheckCircleOutlined,
  ClockCircleOutlined,
  FileAddOutlined,
  LoadingOutlined,
  RedoOutlined,
  RobotOutlined,
  SafetyCertificateOutlined,
  TrophyOutlined,
} from '@ant-design/icons';
import { Button, Card, Col, Progress, Row, Space, Statistic, Table, Tag, Typography } from 'antd';
import type { TableColumnsType } from 'antd';
import type { DashboardResponse, DeepSeekHealth, SourcingRequestSummary } from '../types';
import { formatDateTime, statusMeta } from '../utils';
import styles from '../pages/SourcingAgentPage.module.css';

const { Paragraph, Text, Title } = Typography;

type Props = {
  dashboard: DashboardResponse;
  deepSeekHealth: DeepSeekHealth | null;
  loading: boolean;
  onCreate: () => void;
  onOpen: (requestNo: string) => void;
  onReset: () => void;
};

export default function SourcingDashboard({ dashboard, deepSeekHealth, loading, onCreate, onOpen, onReset }: Props) {
  const columns: TableColumnsType<SourcingRequestSummary> = [
    {
      title: '需求编号',
      dataIndex: 'requestNo',
      width: 160,
      render: (value: string) => <Text strong>{value}</Text>,
    },
    {
      title: '采购物品',
      dataIndex: 'itemName',
      width: 300,
      render: (_, record) => (
        <Space direction="vertical" size={0}>
          <Text>{record.itemName}</Text>
          <Text type="secondary" className={styles.compactText}>{record.specification}</Text>
        </Space>
      ),
    },
    {
      title: '当前阶段',
      dataIndex: 'status',
      width: 170,
      render: (value: SourcingRequestSummary['status']) => (
        <Tag color={statusMeta[value].color}>{statusMeta[value].label}</Tag>
      ),
    },
    {
      title: '报价进度',
      width: 190,
      render: (_, record) => {
        if (!record.quoteProgress) {
          return <Text type="secondary">尚未发布询价</Text>;
        }
        const { invited, submitted } = record.quoteProgress;
        return (
          <Space direction="vertical" size={2} className={styles.progressCell}>
            <Text>{submitted} / {invited} 家已提交</Text>
            <Progress
              percent={invited ? Math.round((submitted / invited) * 100) : 0}
              size="small"
              showInfo={false}
              strokeColor="#e60012"
            />
          </Space>
        );
      },
    },
    {
      title: '报价截止',
      dataIndex: 'deadlineAt',
      width: 180,
      render: (value: string | null) => <span className={styles.nowrapText}>{formatDateTime(value)}</span>,
    },
    {
      title: '操作',
      width: 150,
      fixed: 'right',
      render: (_, record) => <Button type="link" onClick={() => onOpen(record.requestNo)}>查看详情</Button>,
    },
  ];

  const cards = [
    { title: '寻源需求总数', value: dashboard.stats.total, icon: <FileAddOutlined />, color: '#e60012' },
    { title: 'Agent 寻源中', value: dashboard.stats.sourcing, icon: <RobotOutlined />, color: '#1677ff' },
    { title: '等待报价中', value: dashboard.stats.bidding, icon: <ClockCircleOutlined />, color: '#d9822b' },
    { title: 'Agent 评估中', value: dashboard.stats.evaluating, icon: <SafetyCertificateOutlined />, color: '#722ed1' },
    { title: '待创建采购申请', value: dashboard.stats.awardPending, icon: <TrophyOutlined />, color: '#cf6f16' },
    { title: '已完成', value: dashboard.stats.completed, icon: <CheckCircleOutlined />, color: '#2f8f46' },
  ];
  const deepSeekState = deepSeekHealth?.state;
  const deepSeekTag = deepSeekState === 'VERIFIED'
    ? { color: 'success', text: `DeepSeek 实时调用已验证 · ${deepSeekHealth?.model ?? ''}` }
    : deepSeekState === 'DEGRADED'
      ? { color: 'error', text: 'DeepSeek 最近一次连接失败' }
      : deepSeekState === 'NOT_VERIFIED'
        ? { color: 'warning', text: 'DeepSeek 已配置，尚未完成实时调用' }
        : deepSeekState === 'UNCONFIGURED'
          ? { color: 'error', text: 'DeepSeek 未配置' }
          : { color: 'default', text: '正在读取 DeepSeek 状态' };

  return (
    <Space direction="vertical" size={18} className={styles.pageStack}>
      <Card className={styles.heroCard} variant="borderless">
        <div className={styles.heroContent}>
          <div>
            <Text className={styles.eyebrow}>SOURCING AGENT</Text>
            <Title level={2}>从寻源需求到采购申请，一页完成智能闭环</Title>
            <Tag color={deepSeekTag.color} icon={<SafetyCertificateOutlined />}>{deepSeekTag.text}</Tag>
            <Paragraph>
              DeepSeek Agent 基于共享数据库中的内部资源湖与外部来源标识筛选候选供应商，并持续汇总报价版本与竞争力供采购人员决策。
            </Paragraph>
          </div>
          <Space wrap>
            <Button icon={<RedoOutlined />} onClick={onReset}>重置 Demo 数据</Button>
            <Button type="primary" size="large" icon={<FileAddOutlined />} onClick={onCreate}>创建寻源需求</Button>
          </Space>
        </div>
      </Card>

      <Row gutter={[14, 14]}>
        {cards.map((card) => (
          <Col xs={12} md={8} xl={4} key={card.title}>
            <Card className={styles.statCard} loading={loading}>
              <Space align="center">
                <span className={styles.statIcon} style={{ color: card.color, background: `${card.color}14` }}>
                  {card.icon}
                </span>
                <Statistic title={card.title} value={card.value} />
              </Space>
            </Card>
          </Col>
        ))}
      </Row>

      <Card
        title="寻源需求列表"
        extra={loading ? <Space><LoadingOutlined /> 正在同步</Space> : <Tag color="green">共享数据库实时数据</Tag>}
        className={styles.listCard}
      >
        <div className="mobile-table-scroll">
          <div className="mobile-table-hint" role="note">左右滑动查看完整需求进度</div>
          <Table<SourcingRequestSummary>
            rowKey="requestNo"
            loading={loading}
            columns={columns}
            dataSource={dashboard.requests}
            pagination={false}
            scroll={{ x: 1_150 }}
            onRow={(record) => ({ onDoubleClick: () => onOpen(record.requestNo) })}
          />
        </div>
      </Card>
    </Space>
  );
}
