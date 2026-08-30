'use client';

import '@ant-design/v5-patch-for-react-19';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import {
  AimOutlined,
  ApartmentOutlined,
  AuditOutlined,
  BarChartOutlined,
  BellOutlined,
  BranchesOutlined,
  CheckCircleOutlined,
  CloudServerOutlined,
  ControlOutlined,
  DashboardOutlined,
  DatabaseOutlined,
  DeploymentUnitOutlined,
  FieldTimeOutlined,
  FileDoneOutlined,
  FileSearchOutlined,
  FilterOutlined,
  FundProjectionScreenOutlined,
  CustomerServiceOutlined,
  LineChartOutlined,
  LogoutOutlined,
  MenuOutlined,
  PlusOutlined,
  RobotOutlined,
  SafetyCertificateOutlined,
  SearchOutlined,
  SendOutlined,
  SettingOutlined,
  ShopOutlined,
  SyncOutlined,
  TeamOutlined,
  ThunderboltOutlined,
  UpOutlined,
  UserOutlined,
  WarningOutlined,
} from '@ant-design/icons';
import {
  Alert,
  App as AntdApp,
  Avatar,
  Badge,
  Button,
  Card,
  Col,
  Descriptions,
  Divider,
  Drawer,
  Dropdown,
  Form,
  Input,
  Layout,
  List,
  Menu,
  Modal,
  Progress,
  Row,
  Select,
  Space,
  Statistic,
  Table,
  Tabs,
  Tag,
  Timeline,
  Tooltip,
  Typography,
} from 'antd';
import type { MenuProps, TableColumnsType, TabsProps } from 'antd';
import SourcingAgentPage from './features/sourcing/pages/SourcingAgentPage';

const { Header, Sider, Content } = Layout;
const { Title, Text, Paragraph } = Typography;

type PageKey =
  | 'dashboard'
  | 'lake'
  | 'resourcePool'
  | 'flexPool'
  | 'resourceDev'
  | 'dataGovernance'
  | 'decision'
  | 'agents'
  | 'risk'
  | 'roadmap';

type PlatformPageKey = Extract<PageKey, 'resourceDev' | 'dataGovernance' | 'decision'>;

type Supplier = {
  key: string;
  name: string;
  category: string;
  region: string;
  tier: string;
  score: number;
  risk: '低' | '中' | '高';
  status: string;
  utilization: number;
  owner: string;
};

type Agent = {
  key: string;
  name: string;
  icon: ReactNode;
  goal: string;
  input: string[];
  output: string[];
  status: string;
  health: number;
  accent: string;
};

const pageTitle: Record<PageKey, string> = {
  dashboard: '经营驾驶舱',
  lake: '供应链资源湖',
  resourcePool: '统筹资源池',
  flexPool: '柔性供应池',
  resourceDev: '资源开发平台',
  dataGovernance: '数据治理平台',
  decision: '智能决策平台',
  agents: 'AI Agent 编排',
  risk: '风险与审计',
  roadmap: '阶段路线与 KPI',
};

const pagePath: Record<PageKey, string> = {
  dashboard: '/dashboard',
  lake: '/lake',
  resourcePool: '/resource-pool',
  flexPool: '/flex-pool',
  resourceDev: '/platform/resource-dev',
  dataGovernance: '/platform/data-governance',
  decision: '/platform/decision',
  agents: '/agents',
  risk: '/risk',
  roadmap: '/roadmap',
};

const pathPageEntries = Object.entries(pagePath).map(([key, path]) => [path, key as PageKey] as const);

function getPageFromPath(pathname: string): PageKey {
  const normalized = pathname === '/' ? '/dashboard' : pathname.replace(/\/+$/, '');
  if (normalized.startsWith(`${pagePath.agents}/`)) {
    return 'agents';
  }
  return pathPageEntries.find(([path]) => path === normalized)?.[1] ?? 'dashboard';
}

const suppliers: Supplier[] = [
  {
    key: 'S-1001',
    name: '宁波精密液压科技',
    category: '液压系统',
    region: '华东',
    tier: '战略',
    score: 94,
    risk: '低',
    status: '合作中',
    utilization: 78,
    owner: '注塑机事业部',
  },
  {
    key: 'S-1002',
    name: '苏州伺服驱动股份',
    category: '伺服与电控',
    region: '华东',
    tier: '核心',
    score: 88,
    risk: '中',
    status: '复评中',
    utilization: 63,
    owner: '精密装备基地',
  },
  {
    key: 'S-1003',
    name: '德国罗曼控制技术',
    category: '进口控制器',
    region: '欧洲',
    tier: '潜在',
    score: 81,
    risk: '中',
    status: '准入评估',
    utilization: 42,
    owner: '国际采购',
  },
  {
    key: 'S-1004',
    name: '安徽重工铸造集团',
    category: '大型铸件',
    region: '华中',
    tier: '核心',
    score: 91,
    risk: '低',
    status: '合作中',
    utilization: 85,
    owner: '装备制造事业部',
  },
  {
    key: 'S-1005',
    name: '华北机加工协同体',
    category: '精密机加工',
    region: '华北',
    tier: '备选',
    score: 73,
    risk: '高',
    status: '整改中',
    utilization: 28,
    owner: '供应链计划',
  },
];

const databaseAssets = [
  { name: '供应商基础信息库', value: 92, desc: '统一 ID、资质、联系人、组织架构、产业链环节' },
  { name: '价格与询价数据库', value: 86, desc: '历史采购价格、合同价格、报价记录、原材料联动' },
  { name: '质量数据库', value: 78, desc: '来料检验、过程质量、售后反馈、整改记录' },
  { name: '交付数据库', value: 81, desc: '准时交付率、交付周期、订单履约、响应速度' },
  { name: '产能数据库', value: 69, desc: '设备、利用率、扩产能力、可切换产线、瓶颈' },
  { name: '风险数据库', value: 75, desc: '财务信用、涉诉、合规、舆情、地区与政策风险' },
  { name: '工艺技术数据库', value: 64, desc: '工艺路线、关键参数、技术规范、物料特征' },
  { name: '行业市场与海外资源库', value: 58, desc: '宏观、政策、产业集群、市场供需、海外资源' },
];

const architectureCards = [
  {
    title: '一湖',
    subtitle: '供应链资源湖',
    icon: <DatabaseOutlined />,
    body: '沉淀供应商、价格、质量、交付、产能、风险、工艺、行业等全域数据资产。',
  },
  {
    title: '两池',
    subtitle: '统筹资源池 / 柔性供应池',
    icon: <ApartmentOutlined />,
    body: '集团供应商超市与关键物料备用梯队，支持共享复用、风险触发和快速切换。',
  },
  {
    title: '三平台',
    subtitle: '开发 / 治理 / 决策',
    icon: <CloudServerOutlined />,
    body: '连接寻源准入、主数据治理、评分核价份额模型与 Agent 编排。',
  },
  {
    title: '六 Agent',
    subtitle: '寻源、核价、画像、份额、风险、调度',
    icon: <RobotOutlined />,
    body: '把采购经验、模型规则和风险策略沉淀成可解释、可审计的智能助手。',
  },
];

const agents: Agent[] = [
  {
    key: 'sourcing',
    name: '寻源 Agent',
    icon: <FileSearchOutlined />,
    goal: '让优质资源主动浮现，将数周级寻源调研压缩至小时级。',
    input: ['产品结构', '规格书', 'BOM', '工艺要求'],
    output: ['推荐供应商', '匹配理由', '成本区间', '地缘风险'],
    status: '运行中',
    health: 94,
    accent: '#1677ff',
  },
  {
    key: 'pricing',
    name: '核价 Agent',
    icon: <LineChartOutlined />,
    goal: '识别价格虚高、异常报价和原材料联动波动。',
    input: ['BOM', '历史价格', '原材料行情', '工艺路线'],
    output: ['合理成本区间', '异常提示', '谈判策略', '降本建议'],
    status: '运行中',
    health: 89,
    accent: '#e60012',
  },
  {
    key: 'profile',
    name: '画像 Agent',
    icon: <TeamOutlined />,
    goal: '自动生成和更新供应商 360 度画像。',
    input: ['基础信息', '价格', '质量', '交付', '合作历史'],
    output: ['综合画像', '分项评分', '风险标签', '改进建议'],
    status: '训练中',
    health: 76,
    accent: '#13a8a8',
  },
  {
    key: 'allocation',
    name: '份额 Agent',
    icon: <FundProjectionScreenOutlined />,
    goal: '基于综合评分、业务约束和风险因素推荐份额分配。',
    input: ['需求计划', '画像数据', '份额规则', '风险产能数据'],
    output: ['份额推荐', '采购计划', '成本节约', '调整建议'],
    status: '运行中',
    health: 84,
    accent: '#722ed1',
  },
  {
    key: 'risk',
    name: '风险 Agent',
    icon: <SafetyCertificateOutlined />,
    goal: '实时监控、智能预警和应急方案推荐。',
    input: ['财务数据', '涉诉合规', '舆情', '地缘政策'],
    output: ['预警通知', '替代供应商', '处置方案', '跟踪清单'],
    status: '运行中',
    health: 91,
    accent: '#fa8c16',
  },
  {
    key: 'dispatch',
    name: '调度 Agent',
    icon: <DeploymentUnitOutlined />,
    goal: '支持产能、订单、供应商资源和柔性供应池动态调度。',
    input: ['订单需求', '采购计划', '供应商产能', '库存信息'],
    output: ['调度建议', '产能预警', '资源缺口', '效果复盘'],
    status: '待发布',
    health: 68,
    accent: '#52c41a',
  },
];

const agentMenuKeyPrefix = 'agent:';
const defaultAgentPath = `${pagePath.agents}/${agents[0].key}`;

type AgentRunMessage = {
  id: string;
  role: 'user' | 'thinking' | 'answer' | 'artifact';
  title: string;
  content: string;
  items?: string[];
  timestamp: string;
};

function getDefaultAgentPrompt(agent: Agent) {
  return `请启动${agent.name}，基于${agent.input.join('、')}完成一次任务，输出${agent.output.join('、')}，并说明关键判断依据与需要人工确认的事项。`;
}

function getAgentAnswer(agent: Agent) {
  return `${agent.name} 已完成本轮模拟编排：已读取 ${agent.input.length} 类输入，完成规则校验、数据匹配、风险复核和结果汇总。建议先进入人工确认，再同步到采购执行与审计追溯。`;
}

function getAgentThinkingItems(agent: Agent) {
  return [
    `任务理解：识别当前目标属于「${agent.name}」职责范围，先界定业务场景、输出边界和需要人工确认的节点。`,
    `输入校验：逐项检查 ${agent.input.join('、')} 是否完整，标记缺失字段、异常值和需要补充的业务口径。`,
    '数据检索：从资源湖读取供应商主数据、价格记录、质量交付表现、风险标签和历史审批意见。',
    '规则推理：调用品类策略、阈值规则、授权规则和审计策略，形成可解释的判断链路。',
    `结果组织：按照 ${agent.output.join('、')} 的格式生成结构化结论，并保留每一项结论的依据。`,
    '人工确认：将高风险建议、跨部门影响和需要主管拍板的事项放入确认清单，避免模型直接越权执行。',
  ];
}

function getAgentArtifactName(agent: Agent) {
  return `${agent.key}-agent-output.md`;
}

function getMessageTime() {
  return new Intl.DateTimeFormat('zh-CN', {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  }).format(new Date());
}

function getMessageTypeSpeed(role: AgentRunMessage['role']) {
  if (role === 'artifact') {
    return 34;
  }
  if (role === 'answer') {
    return 40;
  }
  return 42;
}

function getItemTypeSpeed(role: AgentRunMessage['role']) {
  if (role === 'artifact') {
    return 30;
  }
  if (role === 'answer') {
    return 36;
  }
  return 38;
}

function getLineGap(role: AgentRunMessage['role']) {
  return role === 'thinking' ? 1200 : 1000;
}

function getListStartDelay(message: Pick<AgentRunMessage, 'content' | 'role'>) {
  if (message.role === 'user') {
    return 0;
  }
  return message.content.length * getMessageTypeSpeed(message.role) + 1000;
}

function getSequentialListDuration(message: Pick<AgentRunMessage, 'content' | 'items' | 'role'>) {
  if (!message.items?.length) {
    return 0;
  }

  return message.items.reduce(
    (total, entry) => total + entry.length * getItemTypeSpeed(message.role) + getLineGap(message.role),
    getListStartDelay(message),
  );
}

function getMessageOutputDuration(message: Pick<AgentRunMessage, 'content' | 'items' | 'role'>) {
  if (message.role === 'user') {
    return 0;
  }

  return Math.max(message.content.length * getMessageTypeSpeed(message.role), getSequentialListDuration(message));
}

function TypewriterText({
  text,
  speed = 22,
  startDelay = 0,
  onTick,
}: {
  text: string;
  speed?: number;
  startDelay?: number;
  onTick?: () => void;
}) {
  const [visibleText, setVisibleText] = useState('');

  useEffect(() => {
    setVisibleText('');
    let index = 0;
    let interval: number | undefined;
    const delay = window.setTimeout(() => {
      interval = window.setInterval(() => {
        index += 1;
        setVisibleText(text.slice(0, index));
        onTick?.();
        if (index >= text.length && interval) {
          window.clearInterval(interval);
        }
      }, speed);
    }, startDelay);

    return () => {
      window.clearTimeout(delay);
      if (interval) {
        window.clearInterval(interval);
      }
    };
  }, [onTick, speed, startDelay, text]);

  return (
    <span className="typewriter-text">
      {visibleText}
      {visibleText.length < text.length && <span className="typewriter-cursor" />}
    </span>
  );
}

function SequentialTypewriterList({
  items,
  renderItem,
  speed = 34,
  startDelay = 0,
  lineGap = 900,
  onTick,
}: {
  items: string[];
  renderItem: (entry: string, index: number, node: ReactNode) => ReactNode;
  speed?: number;
  startDelay?: number;
  lineGap?: number;
  onTick?: () => void;
}) {
  const [visibleCount, setVisibleCount] = useState(0);

  useEffect(() => {
    setVisibleCount(0);
    const timers: number[] = [];
    let elapsed = startDelay;

    items.forEach((entry, index) => {
      timers.push(window.setTimeout(() => {
        setVisibleCount(index + 1);
        onTick?.();
      }, elapsed));
      elapsed += entry.length * speed + lineGap;
    });

    return () => {
      timers.forEach((timer) => window.clearTimeout(timer));
    };
  }, [items, lineGap, onTick, speed, startDelay]);

  return (
    <>
      {items.slice(0, visibleCount).map((entry, index) =>
        renderItem(entry, index, <TypewriterText text={entry} speed={speed} onTick={onTick} />),
      )}
    </>
  );
}

const flowSteps = [
  {
    key: 'collect',
    title: '数据采集',
    desc: '汇入 SRM、ERP、质量、财务、外部征信与舆情数据。',
    owner: 'IT 集成组',
    output: '原始数据包 / 接口日志',
    metric: '今日同步 8.6 万条',
    status: '运行中',
    icon: <DatabaseOutlined />,
  },
  {
    key: 'governance',
    title: '数据治理',
    desc: '统一编码、字段口径、重复识别、缺失补全和异常修正。',
    owner: '数据治理组',
    output: '标准主数据 / 质量问题单',
    metric: '完整率 91.7%',
    status: '校验中',
    icon: <ControlOutlined />,
  },
  {
    key: 'model',
    title: '模型分析',
    desc: '调用画像、核价、份额、风险和调度模型形成可解释分析。',
    owner: 'AI 算法组',
    output: '评分结果 / 风险标签',
    metric: '模型命中 1,286 次',
    status: '运行中',
    icon: <RobotOutlined />,
  },
  {
    key: 'strategy',
    title: '策略输出',
    desc: '生成寻源推荐、核价区间、份额建议和柔性供应激活方案。',
    owner: '资源开发组',
    output: '策略建议书 / Agent 报告',
    metric: '输出 42 份建议',
    status: '待确认',
    icon: <FundProjectionScreenOutlined />,
  },
  {
    key: 'confirm',
    title: '人工确认',
    desc: '业务负责人复核模型建议，记录调整原因、审批意见和授权阈值。',
    owner: '品类负责人',
    output: '审批意见 / 调整记录',
    metric: '待办 17 项',
    status: '待处理',
    icon: <UserOutlined />,
  },
  {
    key: 'execute',
    title: '业务执行',
    desc: '同步到采购、供应商准入、份额调整、风险处置和调度执行流程。',
    owner: '采购运营中心',
    output: '执行单 / 协同任务',
    metric: '闭环率 84%',
    status: '执行中',
    icon: <DeploymentUnitOutlined />,
  },
  {
    key: 'writeback',
    title: '结果回写',
    desc: '回写采购结果、供应商表现、成本节约和风险处置结果。',
    owner: '运营调度组',
    output: '绩效记录 / 处置复盘',
    metric: '回写 328 条',
    status: '回写中',
    icon: <SyncOutlined />,
  },
  {
    key: 'optimize',
    title: '模型优化',
    desc: '沉淀人工反馈、命中偏差和业务结果，持续优化权重和规则。',
    owner: '模型治理组',
    output: '训练样本 / 规则版本',
    metric: '版本 v2.3.1',
    status: '优化中',
    icon: <LineChartOutlined />,
  },
];

const menuItems: MenuProps['items'] = [
  { key: 'dashboard', icon: <DashboardOutlined />, label: '经营驾驶舱' },
  { key: 'lake', icon: <DatabaseOutlined />, label: '供应链资源湖' },
  {
    key: 'poolGroup',
    icon: <ApartmentOutlined />,
    label: '两池管理',
    children: [
      { key: 'resourcePool', icon: <ShopOutlined />, label: '统筹资源池' },
      { key: 'flexPool', icon: <BranchesOutlined />, label: '柔性供应池' },
    ],
  },
  {
    key: 'platformGroup',
    icon: <CloudServerOutlined />,
    label: '三平台',
    children: [
      { key: 'resourceDev', icon: <AimOutlined />, label: '资源开发平台' },
      { key: 'dataGovernance', icon: <ControlOutlined />, label: '数据治理平台' },
      { key: 'decision', icon: <BarChartOutlined />, label: '智能决策平台' },
    ],
  },
  {
    key: 'agentsGroup',
    icon: <RobotOutlined />,
    label: 'AI Agent 编排',
    children: agents.map((agent) => ({
      key: `${agentMenuKeyPrefix}${agent.key}`,
      icon: agent.icon,
      label: agent.name,
    })),
  },
  { key: 'risk', icon: <SafetyCertificateOutlined />, label: '风险与审计' },
  { key: 'roadmap', icon: <FieldTimeOutlined />, label: '路线与 KPI' },
];

function scoreColor(score: number) {
  if (score >= 90) return '#52c41a';
  if (score >= 80) return '#e60012';
  if (score >= 70) return '#faad14';
  return '#e60012';
}

function riskColor(risk: Supplier['risk']) {
  return risk === '低' ? 'green' : risk === '中' ? 'gold' : 'red';
}

function StatCard({
  title,
  value,
  suffix,
  icon,
  trend,
}: {
  title: string;
  value: string | number;
  suffix?: string;
  icon: ReactNode;
  trend: string;
}) {
  return (
    <Card className="stat-card">
      <Space align="start" className="stat-card-head">
        <span className="stat-icon">{icon}</span>
        <Text className="stat-title">{title}</Text>
      </Space>
      <Statistic value={value} suffix={suffix} valueStyle={{ fontSize: 28, fontWeight: 700 }} />
      <Text className="trend-text">
        <ThunderboltOutlined /> {trend}
      </Text>
    </Card>
  );
}

function ArchitectureCard({ item }: { item: (typeof architectureCards)[number] }) {
  return (
    <Card className="architecture-card">
      <div className="architecture-icon">{item.icon}</div>
      <Text className="architecture-label">{item.title}</Text>
      <Title level={4}>{item.subtitle}</Title>
      <Paragraph type="secondary">{item.body}</Paragraph>
    </Card>
  );
}

function SupplierTable({ onSelect }: { onSelect: (supplier: Supplier) => void }) {
  const [keyword, setKeyword] = useState('');
  const [risk, setRisk] = useState<string>('all');

  const data = useMemo(() => {
    return suppliers.filter((supplier) => {
      const matchesKeyword =
        supplier.name.includes(keyword) ||
        supplier.category.includes(keyword) ||
        supplier.region.includes(keyword);
      const matchesRisk = risk === 'all' || supplier.risk === risk;
      return matchesKeyword && matchesRisk;
    });
  }, [keyword, risk]);

  const columns: TableColumnsType<Supplier> = [
    {
      title: '供应商',
      dataIndex: 'name',
      width: 190,
      render: (value, record) => (
        <Space direction="vertical" size={0}>
          <Text strong>{value}</Text>
          <Text type="secondary">{record.key}</Text>
        </Space>
      ),
    },
    { title: '品类', dataIndex: 'category', width: 140 },
    { title: '区域', dataIndex: 'region', width: 100 },
    {
      title: '等级',
      dataIndex: 'tier',
      width: 100,
      render: (value) => <Tag color={value === '战略' ? 'red' : value === '核心' ? 'blue' : 'default'}>{value}</Tag>,
    },
    {
      title: '综合评分',
      dataIndex: 'score',
      width: 170,
      sorter: (a, b) => a.score - b.score,
      render: (value) => <Progress percent={value} size="small" strokeColor={scoreColor(value)} />,
    },
    {
      title: '风险',
      dataIndex: 'risk',
      width: 100,
      render: (value) => <Tag color={riskColor(value)}>{value}风险</Tag>,
    },
    { title: '状态', dataIndex: 'status', width: 110 },
    {
      title: '调用率',
      dataIndex: 'utilization',
      width: 100,
      render: (value) => `${value}%`,
    },
    {
      title: '操作',
      key: 'action',
      width: 140,
      render: (_, record) => (
        <Button
          type="link"
          onClick={(event) => {
            event.stopPropagation();
            onSelect(record);
          }}
        >
          查看画像
        </Button>
      ),
    },
  ];

  return (
    <Card
      className="table-card"
      title="供应商资源超市"
      extra={
        <Space wrap>
          <Input
            allowClear
            prefix={<SearchOutlined />}
            placeholder="搜索供应商、品类、区域"
            value={keyword}
            onChange={(event) => setKeyword(event.target.value)}
          />
          <Select
            value={risk}
            style={{ width: 132 }}
            onChange={setRisk}
            options={[
              { value: 'all', label: '全部风险' },
              { value: '低', label: '低风险' },
              { value: '中', label: '中风险' },
              { value: '高', label: '高风险' },
            ]}
          />
          <Button icon={<FilterOutlined />}>高级筛选</Button>
        </Space>
      }
    >
      <div className="mobile-table-scroll">
        <div className="mobile-table-hint" role="note">左右滑动查看完整供应商信息</div>
        <Table
          columns={columns}
          dataSource={data}
          pagination={{ pageSize: 5 }}
          scroll={{ x: 1150 }}
          onRow={(record) => ({
            onClick: () => onSelect(record),
          })}
          rowClassName="clickable-row"
        />
      </div>
    </Card>
  );
}

function Dashboard({ onSupplierSelect, onCreateRequest }: { onSupplierSelect: (supplier: Supplier) => void; onCreateRequest: () => void }) {
  const { message: messageApi } = AntdApp.useApp();
  const [activeFlowKey, setActiveFlowKey] = useState(flowSteps[0].key);
  const activeFlow = flowSteps.find((step) => step.key === activeFlowKey) ?? flowSteps[0];

  return (
    <Space direction="vertical" size={18} className="page-stack">
      <section className="hero-panel">
        <div>
          <Text className="hero-eyebrow">有制造处有海天 · 有供应处有资源湖</Text>
          <Title level={1}>海天塑机供应链资源湖后台</Title>
          <Paragraph>
            围绕“一湖、两池、三平台、六大 AI Agent”，把供应商资源、价格、质量、交付和风险
            汇成集团级资源视图，让注塑机采购决策更透明、更稳定、更有韧性。
          </Paragraph>
          <Space wrap>
            <Button type="primary" size="large" icon={<PlusOutlined />} onClick={onCreateRequest}>
              发起资源调用
            </Button>
            <Button size="large" className="hero-secondary-button" icon={<RobotOutlined />} onClick={() => messageApi.success('AI 寻源任务已进入队列')}>
              运行寻源 Agent
            </Button>
          </Space>
          <div className="hero-pager">
            <span />
            <span className="active" />
            <span />
          </div>
        </div>
        <Card className="hero-status">
          <Text className="hero-status-label">今日运行状态</Text>
          <Statistic value={17} suffix="条预警" valueStyle={{ color: '#e60012', fontWeight: 800 }} />
          <Divider />
          <Space direction="vertical" size={10}>
            <Text>
              <Badge status="processing" /> 价格异常报价识别 6 条
            </Text>
            <Text>
              <Badge status="warning" /> 关键物料替代梯队缺口 3 项
            </Text>
            <Text>
              <Badge status="success" /> 供应商画像更新 128 家
            </Text>
          </Space>
        </Card>
      </section>

      <Row gutter={[16, 16]}>
        <Col xs={24} sm={12} xl={6}>
          <StatCard title="供应商主数据入库" value={38642} icon={<DatabaseOutlined />} trend="较上月新增 1,248 家" />
        </Col>
        <Col xs={24} sm={12} xl={6}>
          <StatCard title="主数据完整率" value={91.7} suffix="%" icon={<CheckCircleOutlined />} trend="已达到 2026 KPI 目标" />
        </Col>
        <Col xs={24} sm={12} xl={6}>
          <StatCard title="试点共享率" value={56} suffix="%" icon={<SyncOutlined />} trend="C 类零件共享率提升 8%" />
        </Col>
        <Col xs={24} sm={12} xl={6}>
          <StatCard title="风险闭环率" value={84} suffix="%" icon={<SafetyCertificateOutlined />} trend="平均处置周期 3.2 天" />
        </Col>
      </Row>

      <Row gutter={[16, 16]}>
        {architectureCards.map((item) => (
          <Col xs={24} md={12} xl={6} key={item.title}>
            <ArchitectureCard item={item} />
          </Col>
        ))}
      </Row>

      <Card
        title="业务闭环"
        className="flow-card"
        extra={<Tag color="red">数据采集 → 决策执行 → 结果回写</Tag>}
      >
        <div className="flow-board">
          <div className="flow-map">
          {flowSteps.map((step, index) => (
            <button
              type="button"
              className={`flow-node ${activeFlow.key === step.key ? 'flow-node-active' : ''}`}
              key={step.key}
              onClick={() => setActiveFlowKey(step.key)}
            >
              <span className="flow-index">{index + 1}</span>
              <span className="flow-node-icon">{step.icon}</span>
              <span className="flow-node-copy">
                <Text strong>{step.title}</Text>
                <Text type="secondary">{step.status}</Text>
              </span>
            </button>
          ))}
          </div>
          <div className="flow-detail">
            <Space align="start" className="flow-detail-head">
              <span className="flow-detail-icon">{activeFlow.icon}</span>
              <Space direction="vertical" size={2}>
                <Text type="secondary">当前环节</Text>
                <Title level={4}>{activeFlow.title}</Title>
              </Space>
              <Tag color={activeFlow.status.includes('待') ? 'gold' : 'green'}>{activeFlow.status}</Tag>
            </Space>
            <Paragraph>{activeFlow.desc}</Paragraph>
            <Row gutter={[12, 12]}>
              <Col xs={24} sm={8}>
                <div className="flow-detail-metric">
                  <Text type="secondary">责任部门</Text>
                  <Text strong>{activeFlow.owner}</Text>
                </div>
              </Col>
              <Col xs={24} sm={8}>
                <div className="flow-detail-metric">
                  <Text type="secondary">关键输出</Text>
                  <Text strong>{activeFlow.output}</Text>
                </div>
              </Col>
              <Col xs={24} sm={8}>
                <div className="flow-detail-metric">
                  <Text type="secondary">经营指标</Text>
                  <Text strong>{activeFlow.metric}</Text>
                </div>
              </Col>
            </Row>
          </div>
        </div>
      </Card>

      <SupplierTable onSelect={onSupplierSelect} />
    </Space>
  );
}

function ResourceLake() {
  return (
    <Space direction="vertical" size={18} className="page-stack">
      <Alert
        type="info"
        showIcon
        message="资源湖定位"
        description="集团统一数据底座，形成唯一供应商 ID，沉淀价格、质量、交付、产能、风险、工艺、行业、海外资源等数据资产。"
      />
      <Row gutter={[16, 16]}>
        {databaseAssets.map((asset) => (
          <Col xs={24} md={12} xl={6} key={asset.name}>
            <Card className="asset-card">
              <Space direction="vertical" size={8}>
                <DatabaseOutlined className="asset-icon" />
                <Title level={5}>{asset.name}</Title>
                <Paragraph type="secondary">{asset.desc}</Paragraph>
                <Progress percent={asset.value} strokeColor={scoreColor(asset.value)} />
              </Space>
            </Card>
          </Col>
        ))}
      </Row>
      <Row gutter={[16, 16]}>
        <Col xs={24} lg={15}>
          <Card title="主数据治理进度">
            <List
              dataSource={[
                ['统一供应商 ID', 96, '别名合并、重复识别、社会信用代码校验'],
                ['供应商画像资产', 82, '综合评分、分项评分、优势短板、风险标签'],
                ['动态价格曲线', 78, '历史采购价、合同价、原材料价格联动'],
                ['工艺路线资产', 61, '关键工艺参数、技术规范、物料特征'],
              ]}
              renderItem={([name, value, desc]) => (
                <List.Item>
                  <List.Item.Meta title={name} description={desc} />
                  <Progress percent={Number(value)} style={{ width: 180 }} />
                </List.Item>
              )}
            />
          </Card>
        </Col>
        <Col xs={24} lg={9}>
          <Card title="数据资产沉淀">
            <Space wrap>
              {['动态价格曲线', '供应商画像', '质量档案', '交付绩效', '风险标签', '产能能力', '工艺路线'].map((item) => (
                <Tag className="large-tag" color="blue" key={item}>
                  {item}
                </Tag>
              ))}
            </Space>
            <Divider />
            <Statistic title="重复供应商识别" value={1286} suffix="条" />
            <Statistic title="口径不一致待处理" value={342} suffix="项" />
          </Card>
        </Col>
      </Row>
    </Space>
  );
}

function PoolPanel({ mode, onSupplierSelect }: { mode: 'resource' | 'flex'; onSupplierSelect: (supplier: Supplier) => void }) {
  if (mode === 'resource') {
    return (
      <Space direction="vertical" size={18} className="page-stack">
        <Row gutter={[16, 16]}>
          <Col xs={24} lg={8}>
            <Card title="分类分层规则" className="rule-card">
              <Space wrap>
                {['物料类别', '工艺能力', '区域', '认证状态', '战略等级', '风险等级', '合作状态'].map((item) => (
                  <Tag color="processing" key={item}>
                    {item}
                  </Tag>
                ))}
              </Space>
              <Divider />
              <Descriptions column={1} size="small">
                <Descriptions.Item label="资源复用次数">8,214 次</Descriptions.Item>
                <Descriptions.Item label="跨基地共享率">56%</Descriptions.Item>
                <Descriptions.Item label="重复寻源减少">1,036 项</Descriptions.Item>
              </Descriptions>
            </Card>
          </Col>
          <Col xs={24} lg={16}>
            <Card title="资源调用机制">
              <Timeline
                items={[
                  { color: 'blue', children: '提交调用申请，选择基地、品类、场景和权限范围' },
                  { color: 'blue', children: '系统校验可见权限，并补充历史绩效和风险标签' },
                  { color: 'red', children: '品类负责人确认推荐供应商和调用策略' },
                  { color: 'green', children: '记录后续合作结果，沉淀效果反馈和周期缩短数据' },
                ]}
              />
            </Card>
          </Col>
        </Row>
        <SupplierTable onSelect={onSupplierSelect} />
      </Space>
    );
  }

  return (
    <Space direction="vertical" size={18} className="page-stack">
      <Row gutter={[16, 16]}>
        {[
          ['关键物料识别', '采购金额、生产影响、供应集中度、替代难度、交期敏感度'],
          ['替代供应商梯队', '主供、备选、潜在、应急供应商四级结构'],
          ['能力匹配模型', '工艺、产能、质量、交付、区域、成本、认证'],
          ['动态激活规则', '断供、价格、质量、地缘、延期、需求突增'],
        ].map(([title, desc]) => (
          <Col xs={24} md={12} xl={6} key={title}>
            <Card className="asset-card">
              <Title level={5}>{title}</Title>
              <Paragraph type="secondary">{desc}</Paragraph>
            </Card>
          </Col>
        ))}
      </Row>
      <Row gutter={[16, 16]}>
        <Col xs={24} xl={15}>
          <Card title="关键物料柔性梯队">
            <div className="mobile-table-scroll">
              <div className="mobile-table-hint" role="note">左右滑动查看完整柔性梯队</div>
              <Table
                pagination={false}
                dataSource={[
                  { key: 'M01', material: '合模机构铸件', primary: '安徽重工', backup: '湖北精铸联合', risk: '单一来源下降至 42%', cycle: '7 天' },
                  { key: 'M02', material: '伺服电机', primary: '苏州伺服', backup: '杭州电驱', risk: '价格波动高', cycle: '9 天' },
                  { key: 'M03', material: '高压液压泵', primary: '宁波精密液压', backup: '温州液压联合', risk: '复评中', cycle: '5 天' },
                  { key: 'M04', material: '进口控制器', primary: '德国罗曼', backup: '日本东洋控制', risk: '关务与交期中', cycle: '14 天' },
                ]}
                columns={[
                  { title: '关键物料', dataIndex: 'material', width: 180 },
                  { title: '主供应商', dataIndex: 'primary', width: 160 },
                  { title: '备选梯队', dataIndex: 'backup', width: 170 },
                  { title: '风险状态', dataIndex: 'risk', width: 180 },
                  { title: '切换周期', dataIndex: 'cycle', width: 110 },
                ]}
                scroll={{ x: 800 }}
              />
            </div>
          </Card>
        </Col>
        <Col xs={24} xl={9}>
          <Card title="演练与复盘">
            <Timeline
              items={[
                { color: 'green', children: '替代供应演练完成 12 次' },
                { color: 'blue', children: '切换周期验证平均 7.5 天' },
                { color: 'gold', children: '质量稳定性验证 3 项待补样' },
                { color: 'red', children: '成本影响超过阈值 2 项' },
              ]}
            />
          </Card>
        </Col>
      </Row>
    </Space>
  );
}

function PlatformMetricCard({
  label,
  value,
  desc,
  icon,
}: {
  label: string;
  value: string;
  desc: string;
  icon: ReactNode;
}) {
  return (
    <Card className="platform-metric-card">
      <Space align="start">
        <span className="platform-metric-icon">{icon}</span>
        <Space direction="vertical" size={2}>
          <Text type="secondary">{label}</Text>
          <Title level={3}>{value}</Title>
          <Text className="platform-metric-desc">{desc}</Text>
        </Space>
      </Space>
    </Card>
  );
}

function PlatformHero({
  eyebrow,
  title,
  desc,
  icon,
  actions,
}: {
  eyebrow: string;
  title: string;
  desc: string;
  icon: ReactNode;
  actions: ReactNode;
}) {
  return (
    <Card className="platform-hero">
      <div>
        <Text className="platform-eyebrow">{eyebrow}</Text>
        <Title level={2}>{title}</Title>
        <Paragraph>{desc}</Paragraph>
      </div>
      <Space className="platform-hero-actions" wrap>
        {actions}
      </Space>
      <span className="platform-hero-icon">{icon}</span>
    </Card>
  );
}

function ResourceDevelopmentPage() {
  const { message: messageApi } = AntdApp.useApp();

  return (
    <Space direction="vertical" size={18} className="page-stack platform-page">
      <PlatformHero
        eyebrow="RESOURCE DEVELOPMENT"
        title="资源开发平台工作台"
        desc="从规格书、BOM、材质和工艺参数出发，自动解析能力要求，联动产业集群地图和供应商画像，形成可复用的智能寻源报告。"
        icon={<AimOutlined />}
        actions={
          <>
            <Button type="primary" icon={<RobotOutlined />} onClick={() => messageApi.success('寻源 Agent 已开始解析需求')}>
              运行寻源 Agent
            </Button>
            <Button icon={<FileSearchOutlined />}>查看寻源报告</Button>
          </>
        }
      />

      <Row gutter={[16, 16]}>
        <Col xs={24} md={12} xl={6}>
          <PlatformMetricCard label="待解析需求" value="36 项" desc="其中 8 项为新品类" icon={<FileSearchOutlined />} />
        </Col>
        <Col xs={24} md={12} xl={6}>
          <PlatformMetricCard label="推荐供应商" value="128 家" desc="高匹配资源占比 42%" icon={<ShopOutlined />} />
        </Col>
        <Col xs={24} md={12} xl={6}>
          <PlatformMetricCard label="平均寻源周期" value="6.5 小时" desc="较人工调研缩短 74%" icon={<FieldTimeOutlined />} />
        </Col>
        <Col xs={24} md={12} xl={6}>
          <PlatformMetricCard label="试点降本空间" value="4.2%" desc="来自报价和复用测算" icon={<LineChartOutlined />} />
        </Col>
      </Row>

      <Row gutter={[16, 16]}>
        <Col xs={24} xl={9}>
          <Card title="智能寻源输入" className="platform-work-card">
            <Form layout="vertical">
              <Form.Item label="物料名称">
                <Input defaultValue="高压伺服液压系统总成" />
              </Form.Item>
              <Form.Item label="应用基地">
                <Select
                  defaultValue="宁波总装基地"
                  options={[
                    { value: '宁波总装基地', label: '宁波总装基地' },
                    { value: '苏州精密装备基地', label: '苏州精密装备基地' },
                    { value: '华北机加工中心', label: '华北机加工中心' },
                  ]}
                />
              </Form.Item>
              <Form.Item label="规格与工艺要求">
                <Input.TextArea rows={5} defaultValue="规格书、BOM、材质、性能指标、质量标准、关键工序和可替代工艺路线..." />
              </Form.Item>
              <Space wrap>
                {['规格书', 'BOM', '材质', '质量标准', '工艺参数'].map((item) => (
                  <Tag color="red" key={item}>
                    {item}
                  </Tag>
                ))}
              </Space>
            </Form>
          </Card>
        </Col>
        <Col xs={24} xl={9}>
          <Card title="推荐供应商雷达" className="platform-work-card">
            <List
              dataSource={[
                ['宁波精密液压科技', '液压系统', 94, '工艺匹配高，跨基地复用成熟'],
                ['安徽重工铸造集团', '大型铸件', 91, '产能稳定，风险标签低'],
                ['苏州伺服驱动股份', '伺服与电控', 88, '成本优势明显，复评中'],
              ]}
              renderItem={([name, category, score, desc]) => (
                <List.Item>
                  <List.Item.Meta
                    avatar={<Avatar icon={<ShopOutlined />} />}
                    title={
                      <Space>
                        <Text strong>{name}</Text>
                        <Tag>{category}</Tag>
                      </Space>
                    }
                    description={desc}
                  />
                  <Progress type="circle" percent={Number(score)} size={56} strokeColor={scoreColor(Number(score))} />
                </List.Item>
              )}
            />
          </Card>
        </Col>
        <Col xs={24} xl={6}>
          <Card title="产业集群地图" className="platform-work-card cluster-card">
            {[
              ['长三角液压件带', '34 家', '成本优势'],
              ['华东电控伺服带', '28 家', '技术优势'],
              ['华中铸造机加工带', '19 家', '区域稳定'],
              ['欧洲高端控制器带', '12 家', '需合规复核'],
            ].map(([name, count, tag]) => (
              <div className="cluster-row" key={name}>
                <span />
                <div>
                  <Text strong>{name}</Text>
                  <Text type="secondary">{count} / {tag}</Text>
                </div>
              </div>
            ))}
          </Card>
        </Col>
      </Row>

      <Card title="寻源任务看板" className="platform-table-card">
        <div className="mobile-table-scroll">
          <div className="mobile-table-hint" role="note">左右滑动查看完整任务信息</div>
          <Table
            pagination={false}
            dataSource={[
              { key: 'R01', demand: '高压液压泵二供开发', owner: '液压品类组', progress: 78, status: '报告生成中', risk: '中' },
              { key: 'R02', demand: '进口控制器资源补充', owner: '国际采购', progress: 62, status: '合规复核', risk: '中' },
              { key: 'R03', demand: '合模机构铸件柔性梯队', owner: '装备制造事业部', progress: 91, status: '待业务确认', risk: '低' },
            ]}
            columns={[
              { title: '需求场景', dataIndex: 'demand', width: 240 },
              { title: '责任组', dataIndex: 'owner', width: 150 },
              { title: '当前状态', dataIndex: 'status', width: 160 },
              {
                title: '风险',
                dataIndex: 'risk',
                width: 100,
                render: (risk) => <Tag color={riskColor(risk)}>{risk}风险</Tag>,
              },
              {
                title: '进度',
                dataIndex: 'progress',
                width: 200,
                render: (progress) => <Progress percent={progress} strokeColor={scoreColor(progress)} />,
              },
            ]}
            scroll={{ x: 850 }}
          />
        </div>
      </Card>
    </Space>
  );
}

function DataGovernancePage() {
  const { message: messageApi } = AntdApp.useApp();

  return (
    <Space direction="vertical" size={18} className="page-stack platform-page">
      <PlatformHero
        eyebrow="DATA GOVERNANCE"
        title="数据治理平台运营台"
        desc="围绕编码、字段、口径、质量、接口和安全标准，持续治理供应商、物料、品类、组织、工艺和合同主数据。"
        icon={<ControlOutlined />}
        actions={
          <>
            <Button type="primary" icon={<CheckCircleOutlined />} onClick={() => messageApi.success('已触发主数据质量巡检')}>
              触发质量巡检
            </Button>
            <Button icon={<AuditOutlined />}>查看治理规则</Button>
          </>
        }
      />

      <Row gutter={[16, 16]}>
        <Col xs={24} md={12} xl={6}>
          <PlatformMetricCard label="主数据完整率" value="91.7%" desc="较上周提升 2.4%" icon={<CheckCircleOutlined />} />
        </Col>
        <Col xs={24} md={12} xl={6}>
          <PlatformMetricCard label="重复数据识别" value="1,286 条" desc="待合并 342 条" icon={<SyncOutlined />} />
        </Col>
        <Col xs={24} md={12} xl={6}>
          <PlatformMetricCard label="质量问题处理" value="73%" desc="本周关闭 218 项" icon={<ControlOutlined />} />
        </Col>
        <Col xs={24} md={12} xl={6}>
          <PlatformMetricCard label="标准覆盖域" value="6 个" desc="供应商、物料、品类等" icon={<DatabaseOutlined />} />
        </Col>
      </Row>

      <Row gutter={[16, 16]}>
        <Col xs={24} xl={14}>
          <Card title="数据质量总览" className="platform-work-card">
            {[
              ['完整性', 91, '供应商主数据必填字段覆盖'],
              ['准确性', 88, '社会信用代码、地址、资质一致性校验'],
              ['及时性', 82, '资质、绩效、风险数据更新周期'],
              ['一致性', 79, '跨 SRM、ERP、质量系统口径一致'],
              ['问题处理进度', 73, '异常值、缺失值、重复项闭环处理'],
            ].map(([name, value, desc]) => (
              <div className="governance-quality-row" key={name}>
                <div>
                  <Text strong>{name}</Text>
                  <Text type="secondary">{desc}</Text>
                </div>
                <Progress percent={Number(value)} strokeColor={scoreColor(Number(value))} />
              </div>
            ))}
          </Card>
        </Col>
        <Col xs={24} xl={10}>
          <Card title="治理任务队列" className="platform-work-card">
            <Timeline
              items={[
                { color: 'red', children: '供应商别名合并：342 条待确认' },
                { color: 'gold', children: '海外供应商资质字段缺失：86 家' },
                { color: 'blue', children: '物料编码标准更新：影响 12 个品类' },
                { color: 'green', children: '合同主数据口径校验：本日已完成' },
              ]}
            />
            <Divider />
            <Descriptions column={1} size="small">
              <Descriptions.Item label="数据管理员">集团 IT 数据架构组</Descriptions.Item>
              <Descriptions.Item label="业务审批人">品类负责人 / 基地负责人</Descriptions.Item>
              <Descriptions.Item label="更新周期">核心主数据日更，绩效数据周更</Descriptions.Item>
            </Descriptions>
          </Card>
        </Col>
      </Row>

      <Card title="主数据域治理明细" className="platform-table-card">
        <div className="mobile-table-scroll">
          <div className="mobile-table-hint" role="note">左右滑动查看完整治理明细</div>
          <Table
            pagination={false}
            dataSource={[
              { key: 'D01', domain: '供应商主数据', standard: '统一供应商 ID', owner: '数据治理组', score: 96, issue: '别名合并' },
              { key: 'D02', domain: '物料主数据', standard: '物料编码标准', owner: '品类采购组', score: 84, issue: '口径不一致' },
              { key: 'D03', domain: '工艺主数据', standard: '工艺路线字段', owner: '质量技术组', score: 76, issue: '关键参数缺失' },
              { key: 'D04', domain: '合同主数据', standard: '合同价格字段', owner: '采购运营中心', score: 88, issue: '更新滞后' },
            ]}
            columns={[
              { title: '数据域', dataIndex: 'domain', width: 170 },
              { title: '标准体系', dataIndex: 'standard', width: 180 },
              { title: '责任方', dataIndex: 'owner', width: 170 },
              { title: '主要问题', dataIndex: 'issue', width: 180 },
              {
                title: '治理评分',
                dataIndex: 'score',
                width: 200,
                render: (score) => <Progress percent={score} strokeColor={scoreColor(score)} />,
              },
            ]}
            scroll={{ x: 900 }}
          />
        </div>
      </Card>
    </Space>
  );
}

function DecisionPlatformPage() {
  const { message: messageApi } = AntdApp.useApp();

  return (
    <Space direction="vertical" size={18} className="page-stack platform-page">
      <PlatformHero
        eyebrow="INTELLIGENT DECISION"
        title="智能决策平台控制台"
        desc="统一承载评分、核价、份额、风险和调度模型，让模型建议具备数据来源、权重依据、风险提示和人工干预记录。"
        icon={<BarChartOutlined />}
        actions={
          <>
            <Button type="primary" icon={<ThunderboltOutlined />} onClick={() => messageApi.success('已生成本轮份额推荐方案')}>
              生成决策建议
            </Button>
            <Button icon={<AuditOutlined />}>查看解释链路</Button>
          </>
        }
      />

      <Row gutter={[16, 16]}>
        <Col xs={24} md={12} xl={6}>
          <PlatformMetricCard label="模型建议" value="248 条" desc="待人工确认 17 条" icon={<RobotOutlined />} />
        </Col>
        <Col xs={24} md={12} xl={6}>
          <PlatformMetricCard label="异常报价识别" value="32 项" desc="高于合理区间 8 项" icon={<WarningOutlined />} />
        </Col>
        <Col xs={24} md={12} xl={6}>
          <PlatformMetricCard label="预估节约" value="426 万" desc="来自核价和份额优化" icon={<LineChartOutlined />} />
        </Col>
        <Col xs={24} md={12} xl={6}>
          <PlatformMetricCard label="解释完整率" value="89%" desc="依据、权重、来源可追溯" icon={<AuditOutlined />} />
        </Col>
      </Row>

      <Row gutter={[16, 16]}>
        <Col xs={24} xl={8}>
          <Card title="统一评分模型权重" className="platform-work-card">
            {[
              ['价格', 18],
              ['质量', 20],
              ['交付', 16],
              ['风险', 14],
              ['产能', 12],
              ['技术能力', 10],
              ['战略协同', 10],
            ].map(([item, value]) => (
              <div className="weight-row" key={item}>
                <Text>{item}</Text>
                <Progress percent={Number(value)} showInfo={false} strokeColor="#e60012" />
              </div>
            ))}
          </Card>
        </Col>
        <Col xs={24} xl={8}>
          <Card title="核价模型工作区" className="platform-work-card pricing-card">
            <Space wrap>
              {['历史采购价格', '原材料行情', '工艺路线', 'BOM', '人工成本', '制造费用', '市场报价'].map((item) => (
                <Tag color="red" key={item}>
                  {item}
                </Tag>
              ))}
            </Space>
            <Divider />
            <Descriptions column={1} size="small">
              <Descriptions.Item label="合理成本区间">12.8 - 14.1 元 / 件</Descriptions.Item>
              <Descriptions.Item label="异常报价">3 家供应商超出阈值</Descriptions.Item>
              <Descriptions.Item label="谈判建议">优先锁定原材料价差，触发二轮询价</Descriptions.Item>
            </Descriptions>
          </Card>
        </Col>
        <Col xs={24} xl={8}>
          <Card title="决策解释卡" className="platform-work-card">
            <List
              size="small"
              dataSource={[
                ['关键依据', '历史价格、质量绩效、风险等级'],
                ['数据来源', 'SRM / ERP / 质量系统 / 外部征信'],
                ['人工干预', '份额上限调整 10%，原因已记录'],
                ['结果回写', '执行结果将进入模型优化样本'],
              ]}
              renderItem={([title, desc]) => (
                <List.Item>
                  <List.Item.Meta avatar={<Avatar icon={<CheckCircleOutlined />} />} title={title} description={desc} />
                </List.Item>
              )}
            />
          </Card>
        </Col>
      </Row>

      <Card title="决策建议队列" className="platform-table-card">
        <div className="mobile-table-scroll">
          <div className="mobile-table-hint" role="note">左右滑动查看完整决策建议</div>
          <Table
            pagination={false}
            dataSource={[
              { key: 'M01', scene: '高压液压泵份额重算', model: '份额 Agent', advice: '推荐 6:3:1', saving: '128 万', risk: '低', status: '待确认' },
              { key: 'M02', scene: '进口控制器报价复核', model: '核价 Agent', advice: '触发二轮询价', saving: '46 万', risk: '中', status: '审批中' },
              { key: 'M03', scene: '大型铸件单一来源下降', model: '风险 Agent', advice: '激活备选梯队', saving: '风险降低 18%', risk: '中', status: '执行中' },
            ]}
            columns={[
              { title: '决策场景', dataIndex: 'scene', width: 220 },
              { title: '调用模型', dataIndex: 'model', width: 140 },
              { title: '建议', dataIndex: 'advice', width: 160 },
              { title: '价值测算', dataIndex: 'saving', width: 160 },
              {
                title: '风险',
                dataIndex: 'risk',
                width: 100,
                render: (risk) => <Tag color={riskColor(risk)}>{risk}风险</Tag>,
              },
              { title: '状态', dataIndex: 'status', width: 110 },
            ]}
            scroll={{ x: 890 }}
          />
        </div>
      </Card>
    </Space>
  );
}

function Platforms({ active, onChange }: { active: PlatformPageKey; onChange: (key: PlatformPageKey) => void }) {
  const items: TabsProps['items'] = [
    {
      key: 'resourceDev',
      label: (
        <Space>
          <AimOutlined />
          资源开发平台
        </Space>
      ),
      children: <ResourceDevelopmentPage />,
    },
    {
      key: 'dataGovernance',
      label: (
        <Space>
          <ControlOutlined />
          数据治理平台
        </Space>
      ),
      children: <DataGovernancePage />,
    },
    {
      key: 'decision',
      label: (
        <Space>
          <BarChartOutlined />
          智能决策平台
        </Space>
      ),
      children: <DecisionPlatformPage />,
    },
  ];

  return (
    <Tabs
      className="platform-tabs"
      activeKey={active}
      items={items}
      onChange={(key) => onChange(key as PlatformPageKey)}
    />
  );
}

function AgentExecutionPage({ agentKey }: { agentKey: string }) {
  const { message: messageApi } = AntdApp.useApp();
  const selectedAgent = agents.find((agent) => agent.key === agentKey);
  const agent = selectedAgent ?? agents[0];
  const defaultPrompt = useMemo(() => getDefaultAgentPrompt(agent), [agent]);
  const timeoutRef = useRef<number[]>([]);
  const conversationRef = useRef<HTMLDivElement>(null);
  const [draft, setDraft] = useState(defaultPrompt);
  const [running, setRunning] = useState(false);
  const [messages, setMessages] = useState<AgentRunMessage[]>([]);
  const scrollConversationToBottom = useCallback(() => {
    window.requestAnimationFrame(() => {
      conversationRef.current?.scrollTo({
        top: conversationRef.current.scrollHeight,
        behavior: 'smooth',
      });
    });
  }, []);

  useEffect(() => {
    timeoutRef.current.forEach((timer) => window.clearTimeout(timer));
    timeoutRef.current = [];
    setMessages([]);
    setDraft(defaultPrompt);
    setRunning(false);

    return () => {
      timeoutRef.current.forEach((timer) => window.clearTimeout(timer));
      timeoutRef.current = [];
    };
  }, [agent.key, defaultPrompt]);

  useEffect(() => {
    scrollConversationToBottom();
  }, [messages, scrollConversationToBottom]);

  useEffect(() => {
    if (!running) {
      return undefined;
    }

    const scrollTimer = window.setInterval(scrollConversationToBottom, 260);
    return () => window.clearInterval(scrollTimer);
  }, [running, scrollConversationToBottom]);

  const appendMessage = (nextMessage: Omit<AgentRunMessage, 'id' | 'timestamp'>) => {
    setMessages((current) => [
      ...current,
      {
        ...nextMessage,
        id: `${nextMessage.role}-${Date.now()}-${current.length}`,
        timestamp: getMessageTime(),
      },
    ]);
  };

  const handleSend = () => {
    const prompt = draft.trim();
    if (!prompt || running) {
      return;
    }

    appendMessage({
      role: 'user',
      title: '采购运营输入',
      content: prompt,
    });
    setDraft('');
    setRunning(true);

    const thinkingMessage: Omit<AgentRunMessage, 'id' | 'timestamp'> = {
      role: 'thinking',
      title: `${agent.name} 思考中`,
      content: `我会先拆解任务意图，再逐项核对 ${agent.input.join('、')}。本次任务不会直接改写真实业务数据，会把可执行建议、风险提示和人工确认项分开输出。`,
      items: getAgentThinkingItems(agent),
    };
    const answerMessage: Omit<AgentRunMessage, 'id' | 'timestamp'> = {
      role: 'answer',
      title: `${agent.name} 回答`,
      content: `${getAgentAnswer(agent)} 我已经把结论拆成可复核字段：每一项都会带上输入依据、命中规则、风险级别和建议动作，便于采购主管快速判断是否采纳。`,
      items: agent.output.map((item) => `${item}：已生成可复核结果，并保留来源依据与人工确认点`),
    };
    const artifactMessage: Omit<AgentRunMessage, 'id' | 'timestamp'> = {
      role: 'artifact',
      title: `已生成 ${getAgentArtifactName(agent)}`,
      content: `文件格式：Markdown 任务报告。内容包含任务摘要、输入依据、${agent.output.join('、')}、风险提示、人工确认清单和审计追溯编号。`,
      items: [
        `# ${agent.name} 执行报告`,
        `目标：${agent.goal}`,
        `输出：${agent.output.join(' / ')}`,
        '状态：待采购主管确认后写回业务闭环',
      ],
    };

    const messageGap = 1800;
    const thinkingStart = 1200;
    const answerStart = thinkingStart + getMessageOutputDuration(thinkingMessage) + messageGap;
    const artifactStart = answerStart + getMessageOutputDuration(answerMessage) + messageGap;
    const doneAt = artifactStart + getMessageOutputDuration(artifactMessage) + 800;

    const thinkingTimer = window.setTimeout(() => appendMessage(thinkingMessage), thinkingStart);
    const answerTimer = window.setTimeout(() => appendMessage(answerMessage), answerStart);
    const artifactTimer = window.setTimeout(() => appendMessage(artifactMessage), artifactStart);
    const doneTimer = window.setTimeout(() => {
      setRunning(false);
      messageApi.success(`${agent.name} 任务已完成`);
    }, doneAt);

    timeoutRef.current = [thinkingTimer, answerTimer, artifactTimer, doneTimer];
  };

  return (
    <div className="agent-workbench">
      <Card className="agent-console-card">
        <div className="agent-console-shell">
          <div className="agent-console-head">
            <Space align="center" className="agent-console-title">
              <span className="agent-icon" style={{ color: agent.accent, background: `${agent.accent}18` }}>
                {agent.icon}
              </span>
              <Space direction="vertical" size={2}>
                <Title level={4}>{agent.name} 模拟执行台</Title>
                <Text type="secondary">{agent.goal}</Text>
              </Space>
            </Space>
            <Space wrap className="agent-console-actions">
              <Tag color={agent.status === '运行中' ? 'green' : agent.status === '训练中' ? 'blue' : 'default'}>
                {agent.status}
              </Tag>
              <Tag color="red">审计追溯开启</Tag>
            </Space>
          </div>

          <div className="agent-conversation" ref={conversationRef} aria-label={`${agent.name} 会话内容`}>
            {messages.length === 0 ? (
              <div className="agent-empty-state">
                <RobotOutlined />
                <Title level={5}>等待发送任务</Title>
                <Paragraph type="secondary">
                  底部已填入默认 Prompt，发送后会依次展示采购输入、Agent 思考、Agent 回答和最终产出文件。
                </Paragraph>
              </div>
            ) : (
              messages.map((item) => (
                <div className={`agent-message agent-message-${item.role}`} key={item.id}>
                  <div className="agent-message-head">
                    <Space>
                      {item.role === 'artifact' ? <FileDoneOutlined /> : <RobotOutlined />}
                      <Text strong>{item.title}</Text>
                    </Space>
                    <Text type="secondary">{item.timestamp}</Text>
                  </div>
                  {item.role === 'artifact' && (
                    <div className="agent-file-card">
                      <div className="agent-file-icon-large">
                        <FileDoneOutlined />
                        <span>MD</span>
                      </div>
                      <div className="agent-file-meta">
                        <Text strong>{getAgentArtifactName(agent)}</Text>
                        <Text type="secondary">Markdown 任务报告 / 结构化输出 / 待采购主管确认</Text>
                      </div>
                    </div>
                  )}
                  <Paragraph>
                    {item.role === 'user' ? (
                      item.content
                    ) : (
                      <TypewriterText
                        text={item.content}
                        speed={getMessageTypeSpeed(item.role)}
                        onTick={scrollConversationToBottom}
                      />
                    )}
                  </Paragraph>
                  {item.items && (
                    <div className={item.role === 'artifact' ? 'agent-artifact-body' : 'agent-message-list'}>
                      <SequentialTypewriterList
                        items={item.items}
                        speed={getItemTypeSpeed(item.role)}
                        startDelay={getListStartDelay(item)}
                        lineGap={getLineGap(item.role)}
                        onTick={scrollConversationToBottom}
                        renderItem={(entry, index, node) => (
                          <div key={`${entry}-${index}`}>
                            {item.role === 'artifact' ? <code>{node}</code> : <Text>{node}</Text>}
                          </div>
                        )}
                      />
                    </div>
                  )}
                </div>
              ))
            )}
          </div>

          <div className="agent-prompt-panel">
            <Input
              value={draft}
              onChange={(event) => setDraft(event.target.value)}
              onPressEnter={(event) => {
                event.preventDefault();
                handleSend();
              }}
              placeholder="请输入要交给 Agent 执行的任务"
            />
            <Button type="primary" icon={<SendOutlined />} loading={running} disabled={!draft.trim()} onClick={handleSend}>
              发送
            </Button>
          </div>
        </div>
      </Card>
    </div>
  );
}

function RiskAudit() {
  return (
    <Space direction="vertical" size={18} className="page-stack">
      <Row gutter={[16, 16]}>
        <Col xs={24} lg={8}>
          <Card title="重点风险">
            <List
              dataSource={[
                ['单一来源风险', '关键零部件 5 项超过集中度阈值', 'red'],
                ['供应商财务风险', '12 家供应商信用等级下调', 'gold'],
                ['地缘政治风险', '欧洲进口控制器资源进入观察名单', 'gold'],
                ['关键原材料风险', '铸铁与合金钢价格 7 日波动超过阈值', 'red'],
              ]}
              renderItem={([title, desc, color]) => (
                <List.Item>
                  <List.Item.Meta avatar={<Avatar icon={<WarningOutlined />} style={{ background: color === 'red' ? '#e60012' : '#faad14' }} />} title={title} description={desc} />
                </List.Item>
              )}
            />
          </Card>
        </Col>
        <Col xs={24} lg={8}>
          <Card title="风险管理闭环">
            <Timeline
              items={[
                { color: 'blue', children: '风险识别：多渠道信息自动收集和甄别' },
                { color: 'gold', children: '风险评估：概率、影响、范围、紧急程度评分' },
                { color: 'red', children: '风险应对：整改、份额调整、启动备选、锁价' },
                { color: 'green', children: '监控审查：处置结果回写并优化规则' },
              ]}
            />
          </Card>
        </Col>
        <Col xs={24} lg={8}>
          <Card title="审计追溯">
            <List
              size="small"
              dataSource={['模型建议记录', '人工调整记录', '审批意见记录', '份额变更记录', '风险处置记录']}
              renderItem={(item) => (
                <List.Item>
                  <AuditOutlined className="red" /> {item}
                </List.Item>
              )}
            />
            <Divider />
            <Statistic title="本月审计事件" value={2486} />
          </Card>
        </Col>
      </Row>
      <Card title="模型治理">
        <div className="mobile-table-scroll">
          <div className="mobile-table-hint" role="note">左右滑动查看完整模型信息</div>
          <Table
            pagination={false}
            dataSource={[
              { key: 'V1', model: '统一评分模型', version: 'v2.3.1', effect: '稳定', owner: 'AI 算法组', review: '2026-07-01' },
              { key: 'V2', model: '动态核价模型', version: 'v2.0.4', effect: '需复核', owner: '采购成本组', review: '2026-07-03' },
              { key: 'V3', model: '风险预警模型', version: 'v1.9.8', effect: '稳定', owner: '风险管理组', review: '2026-07-02' },
            ]}
            columns={[
              { title: '模型', dataIndex: 'model', width: 170 },
              { title: '版本', dataIndex: 'version', width: 110 },
              {
                title: '效果评估',
                dataIndex: 'effect',
                width: 130,
                render: (value) => <Tag color={value === '稳定' ? 'green' : 'gold'}>{value}</Tag>,
              },
              { title: '责任组', dataIndex: 'owner', width: 160 },
              { title: '最近复核', dataIndex: 'review', width: 150 },
            ]}
            scroll={{ x: 720 }}
          />
        </div>
      </Card>
    </Space>
  );
}

function Roadmap() {
  const stages = [
    {
      year: '2026',
      version: '资源湖 1.0',
      theme: '标准化与资源共享',
      status: '建设中',
      progress: 62,
      icon: <DatabaseOutlined />,
      bullets: ['资源湖搭建', '资源开发平台 V1.0', '标准化数据底座', 'C 类零件和通用品类试点'],
      kpis: [
        ['主数据入库率', 90],
        ['试点共享率', 50],
        ['采购效率提升', 20],
      ],
    },
    {
      year: '2027',
      version: '资源湖 2.0 / SCROS 3.0',
      theme: '数据驱动与 AI 赋能',
      status: '规划中',
      progress: 42,
      icon: <RobotOutlined />,
      bullets: ['完善八大核心数据库', '供应商 360 画像与动态核价模型', '六大 AI Agent 上线', '嵌入寻源、履约、份额与风险决策流程'],
      kpis: [
        ['画像覆盖率', 75],
        ['自动评估率', 80],
        ['Agent 渗透率', 70],
      ],
    },
    {
      year: '2028',
      version: '供应网络远景',
      theme: '全球供应网络运营',
      status: '远景',
      progress: 18,
      icon: <LineChartOutlined />,
      bullets: ['全球优质资源池', '算法匹配最优渠道', '实时监控断供质量风险', '跨地域工厂协同生产'],
      kpis: [
        ['采购成本降低', 5],
        ['库存成本降低', 20],
        ['人效提升', 30],
      ],
    },
  ];

  return (
    <Space direction="vertical" size={18} className="page-stack">
      <Card
        title="阶段路线"
        className="roadmap-card"
        extra={<Tag color="red">2026 - 2028 资源湖演进</Tag>}
      >
        <div className="roadmap-summary">
          <div>
            <Text className="platform-eyebrow">SCROS ROADMAP</Text>
            <Title level={3}>从标准化资源共享，到 AI 驱动的全球供应网络运营</Title>
          </div>
          <Space wrap>
            <Tag color="red">一湖</Tag>
            <Tag color="red">两池</Tag>
            <Tag color="red">三平台</Tag>
            <Tag color="red">六 Agent</Tag>
          </Space>
        </div>
        <div className="roadmap-stage-line">
          {stages.map((stage) => (
            <div className="roadmap-stage" key={stage.year}>
              <div className="roadmap-stage-head">
                <span className="roadmap-stage-icon">{stage.icon}</span>
                <div>
                  <Text className="roadmap-year">{stage.year}</Text>
                  <Title level={4}>{stage.version}</Title>
                </div>
                <Tag color={stage.year === '2026' ? 'green' : 'default'}>{stage.status}</Tag>
              </div>
              <Text className="roadmap-theme">{stage.theme}</Text>
              <Progress percent={stage.progress} strokeColor={scoreColor(stage.progress)} />
              <div className="roadmap-bullets">
                {stage.bullets.map((bullet) => (
                  <Text key={bullet}>
                    <CheckCircleOutlined /> {bullet}
                  </Text>
                ))}
              </div>
            </div>
          ))}
        </div>
      </Card>
      <Row gutter={[16, 16]}>
        {stages.map((stage) => (
          <Col xs={24} lg={8} key={stage.year}>
            <Card className="kpi-card roadmap-kpi-card">
              <Space direction="vertical" size={12} className="roadmap-kpi-stack">
                <Space className="roadmap-kpi-head">
                  <Text className="roadmap-year">{stage.year}</Text>
                  <Tag>{stage.theme}</Tag>
                </Space>
                {stage.kpis.map(([name, value]) => (
                  <div className="roadmap-kpi-row" key={name}>
                    <Text>{name}</Text>
                    <Progress percent={Number(value)} strokeColor={scoreColor(Number(value))} />
                  </div>
                ))}
              </Space>
            </Card>
          </Col>
        ))}
      </Row>
    </Space>
  );
}

function AppShell() {
  const { message: messageApi } = AntdApp.useApp();
  const pathname = usePathname();
  const router = useRouter();
  const normalizedPath = pathname === '/' ? '/' : pathname.replace(/\/+$/, '');
  const page = getPageFromPath(normalizedPath);
  const agentKey = normalizedPath.startsWith(`${pagePath.agents}/`)
    ? normalizedPath.slice(`${pagePath.agents}/`.length)
    : null;
  const selectedAgent = agentKey ? agents.find((agent) => agent.key === agentKey) : null;
  const activeAgent = selectedAgent ?? (normalizedPath === pagePath.agents ? agents[0] : null);
  const [collapsed, setCollapsed] = useState(false);
  const [mobileNavOpen, setMobileNavOpen] = useState(false);
  const [selectedSupplier, setSelectedSupplier] = useState<Supplier | null>(null);
  const [requestOpen, setRequestOpen] = useState(false);

  const selectedMenuKeys = activeAgent ? [`${agentMenuKeyPrefix}${activeAgent.key}`] : [page];
  const navigate = (path: string) => router.push(path);
  const navigateToPage = (nextPage: PageKey) => navigate(pagePath[nextPage]);
  const handleMenuClick: MenuProps['onClick'] = ({ key }) => {
    setMobileNavOpen(false);
    if (key.startsWith(agentMenuKeyPrefix)) {
      navigate(`${pagePath.agents}/${key.slice(agentMenuKeyPrefix.length)}`);
      return;
    }
    navigateToPage(key as PageKey);
  };

  useEffect(() => {
    const knownPagePath = pathPageEntries.some(([path]) => path === normalizedPath);

    if (normalizedPath === '/') {
      router.replace(pagePath.dashboard);
    } else if (normalizedPath === pagePath.agents) {
      router.replace(defaultAgentPath);
    } else if (agentKey && !selectedAgent) {
      router.replace(defaultAgentPath);
    } else if (!knownPagePath && !selectedAgent) {
      router.replace(pagePath.dashboard);
    }
  }, [agentKey, normalizedPath, router, selectedAgent]);

  const renderPage = () => {
    if (activeAgent) {
      if (activeAgent.key === 'sourcing') {
        return <SourcingAgentPage />;
      }
      return <AgentExecutionPage agentKey={activeAgent.key} />;
    }

    switch (page) {
      case 'dashboard':
        return (
          <Dashboard
            onSupplierSelect={setSelectedSupplier}
            onCreateRequest={() => setRequestOpen(true)}
          />
        );
      case 'lake':
        return <ResourceLake />;
      case 'resourcePool':
        return <PoolPanel mode="resource" onSupplierSelect={setSelectedSupplier} />;
      case 'flexPool':
        return <PoolPanel mode="flex" onSupplierSelect={setSelectedSupplier} />;
      case 'resourceDev':
        return <Platforms active="resourceDev" onChange={navigateToPage} />;
      case 'dataGovernance':
        return <Platforms active="dataGovernance" onChange={navigateToPage} />;
      case 'decision':
        return <Platforms active="decision" onChange={navigateToPage} />;
      case 'agents':
        return <AgentExecutionPage agentKey={agents[0].key} />;
      case 'risk':
        return <RiskAudit />;
      case 'roadmap':
        return <Roadmap />;
    }
  };

  return (
    <Layout className="app-shell">
      <Sider width={252} collapsed={collapsed} collapsible onCollapse={setCollapsed} className="app-sider">
        <div className="brand">
          <div className="brand-mark">
            <span>塑机</span>
          </div>
          {!collapsed && (
            <div>
              <Text className="brand-title">海天塑机 SCROS</Text>
              <Text className="brand-subtitle">供应链资源湖后台</Text>
            </div>
          )}
        </div>
        <Menu
          mode="inline"
          selectedKeys={selectedMenuKeys}
          defaultOpenKeys={['poolGroup', 'platformGroup', 'agentsGroup']}
          items={menuItems}
          onClick={handleMenuClick}
        />
      </Sider>

      <Drawer
        title="主导航"
        placement="left"
        width={310}
        open={mobileNavOpen}
        onClose={() => setMobileNavOpen(false)}
        className="mobile-nav-drawer"
        aria-label="主导航"
        styles={{ body: { padding: 0 } }}
      >
        <div className="brand mobile-nav-brand">
          <div className="brand-mark"><span>塑机</span></div>
          <div>
            <Text className="brand-title">海天塑机 SCROS</Text>
            <Text className="brand-subtitle">供应链资源湖后台</Text>
          </div>
        </div>
        <Menu
          mode="inline"
          selectedKeys={selectedMenuKeys}
          defaultOpenKeys={['poolGroup', 'platformGroup', 'agentsGroup']}
          items={menuItems}
          onClick={handleMenuClick}
        />
      </Drawer>

      <Layout>
        <Header className="app-header">
          <Space align="center" className="header-left">
            <Button
              type="text"
              className="mobile-menu-button"
              icon={<MenuOutlined />}
              aria-label="打开主导航"
              onClick={() => setMobileNavOpen(true)}
            />
            <Title level={4}>{activeAgent ? `${activeAgent.name} 编排` : pageTitle[page]}</Title>
            <Tag className="brand-tag">集团级后台</Tag>
          </Space>
          <Space className="header-actions" size={14}>
            <Input prefix={<SearchOutlined />} placeholder="搜索供应商、物料、风险事件" className="global-search" />
            <Tooltip title="风险预警">
              <Badge count={17}>
                <Button shape="circle" icon={<BellOutlined />} aria-label="查看风险预警" />
              </Badge>
            </Tooltip>
            <Dropdown
              menu={{
                items: [
                  { key: 'settings', icon: <SettingOutlined />, label: '系统设置' },
                  { key: 'logout', icon: <LogoutOutlined />, label: '退出登录' },
                ],
              }}
            >
              <Space className="user-entry">
                <Avatar icon={<UserOutlined />} />
                <Text>采购运营中心</Text>
              </Space>
            </Dropdown>
          </Space>
        </Header>
        <Content className="app-content">
          {renderPage()}
        </Content>
      </Layout>

      <div className="floating-tools" aria-label="快捷工具">
        <Tooltip title="支持中心" placement="left">
          <Button shape="circle" icon={<CustomerServiceOutlined />} aria-label="打开支持中心" />
        </Tooltip>
        <Tooltip title="风险雷达" placement="left">
          <Button shape="circle" className="floating-primary" icon={<WarningOutlined />} aria-label="打开风险雷达" />
        </Tooltip>
        <Tooltip title="返回顶部" placement="left">
          <Button shape="circle" icon={<UpOutlined />} aria-label="返回页面顶部" onClick={() => window.scrollTo({ top: 0, behavior: 'smooth' })} />
        </Tooltip>
      </div>

      <Drawer
        title="供应商 360 度画像"
        width={520}
        open={Boolean(selectedSupplier)}
        onClose={() => setSelectedSupplier(null)}
      >
        {selectedSupplier && (
          <Space direction="vertical" size={18} className="drawer-stack">
            <Card>
              <Space align="start">
                <Avatar size={56} icon={<ShopOutlined />} />
                <Space direction="vertical" size={2}>
                  <Title level={4}>{selectedSupplier.name}</Title>
                  <Text type="secondary">
                    {selectedSupplier.category} / {selectedSupplier.region} / {selectedSupplier.owner}
                  </Text>
                </Space>
              </Space>
            </Card>
            <Descriptions bordered column={1} size="small">
              <Descriptions.Item label="统一供应商 ID">{selectedSupplier.key}</Descriptions.Item>
              <Descriptions.Item label="战略等级">{selectedSupplier.tier}</Descriptions.Item>
              <Descriptions.Item label="合作状态">{selectedSupplier.status}</Descriptions.Item>
              <Descriptions.Item label="风险等级">
                <Tag color={riskColor(selectedSupplier.risk)}>{selectedSupplier.risk}风险</Tag>
              </Descriptions.Item>
            </Descriptions>
            <Card title="分项评分">
              {[
                ['价格', selectedSupplier.score - 4],
                ['质量', selectedSupplier.score],
                ['交付', selectedSupplier.score - 2],
                ['产能', selectedSupplier.utilization],
                ['风险', selectedSupplier.risk === '低' ? 92 : selectedSupplier.risk === '中' ? 75 : 58],
              ].map(([name, value]) => (
                <div className="quality-row" key={name}>
                  <Text>{name}</Text>
                  <Progress percent={Number(value)} strokeColor={scoreColor(Number(value))} />
                </div>
              ))}
            </Card>
            <Alert
              type={selectedSupplier.risk === '高' ? 'error' : 'success'}
              showIcon
              message="Agent 建议"
              description={
                selectedSupplier.risk === '高'
                  ? '建议降低份额并启动备选供应商演练，整改完成前限制跨基地调用。'
                  : '建议纳入优先复用清单，可开放给同品类基地进行资源调用。'
              }
            />
          </Space>
        )}
      </Drawer>

      <Modal
        title="发起资源调用申请"
        open={requestOpen}
        onCancel={() => setRequestOpen(false)}
        onOk={() => {
          setRequestOpen(false);
          messageApi.success('资源调用申请已提交');
        }}
        okText="提交申请"
        cancelText="取消"
      >
        <Form layout="vertical">
          <Form.Item label="调用场景">
            <Select
              defaultValue="newSource"
              options={[
                { value: 'newSource', label: '新品类寻源' },
                { value: 'riskSwitch', label: '风险触发替代' },
                { value: 'costDown', label: '降本专项' },
                { value: 'capacity', label: '产能补充' },
              ]}
            />
          </Form.Item>
          <Form.Item label="目标品类">
            <Input defaultValue="液压系统 / 高压液压泵" />
          </Form.Item>
          <Form.Item label="权限范围">
            <Select
              mode="multiple"
              defaultValue={['group', 'base']}
              options={[
                { value: 'group', label: '集团' },
                { value: 'industry', label: '产业' },
                { value: 'base', label: '基地' },
                { value: 'category', label: '品类' },
              ]}
            />
          </Form.Item>
        </Form>
      </Modal>
    </Layout>
  );
}

export default function App() {
  return (
    <AntdApp>
      <AppShell />
    </AntdApp>
  );
}
