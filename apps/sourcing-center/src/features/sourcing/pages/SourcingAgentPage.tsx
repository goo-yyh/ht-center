'use client';

import { ExclamationCircleOutlined } from '@ant-design/icons';
import { Alert, App as AntdApp, Button, Input, Modal, Spin } from 'antd';
import { useCallback, useEffect, useRef, useState } from 'react';
import { sourcingApi, SourcingApiError } from '../api/client';
import CreateRequestDrawer from '../components/CreateRequestDrawer';
import RequestDetailDrawer from '../components/RequestDetailDrawer';
import SourcingDashboard from '../components/SourcingDashboard';
import type {
  CatalogResponse,
  CreateSourcingRequestInput,
  DashboardResponse,
  DeepSeekHealth,
  SourcingRequestDetail,
} from '../types';
import styles from './SourcingAgentPage.module.css';

const emptyDashboard: DashboardResponse = {
  stats: { total: 0, sourcing: 0, bidding: 0, evaluating: 0, awardPending: 0, completed: 0 },
  requests: [],
};

function readableError(error: unknown): string {
  if (error instanceof SourcingApiError) {
    return `${error.message}（${error.code}）`;
  }
  return error instanceof Error ? error.message : '操作失败，请稍后重试';
}

function syncRequestQuery(requestNo?: string) {
  const url = new URL(window.location.href);
  if (requestNo) {
    url.searchParams.set('request', requestNo);
  } else {
    url.searchParams.delete('request');
  }
  window.history.replaceState(window.history.state, '', `${url.pathname}${url.search}${url.hash}`);
}

export default function SourcingAgentPage() {
  const { message, modal } = AntdApp.useApp();
  const [dashboard, setDashboard] = useState<DashboardResponse>(emptyDashboard);
  const [deepSeekHealth, setDeepSeekHealth] = useState<DeepSeekHealth | null>(null);
  const [catalog, setCatalog] = useState<CatalogResponse | null>(null);
  const [serverTime, setServerTime] = useState(new Date().toISOString());
  const [loading, setLoading] = useState(true);
  const [actionRunning, setActionRunning] = useState(false);
  const [agentRunning, setAgentRunning] = useState(false);
  const [evaluationRunning, setEvaluationRunning] = useState(false);
  const [quoteSimulationRunning, setQuoteSimulationRunning] = useState(false);
  const [createOpen, setCreateOpen] = useState(false);
  const [selectedRequestNo, setSelectedRequestNo] = useState<string>();
  const [detail, setDetail] = useState<SourcingRequestDetail | null>(null);
  const [fatalError, setFatalError] = useState<string>();
  const [resetOpen, setResetOpen] = useState(false);
  const [resetConfirmation, setResetConfirmation] = useState('');
  const initializedRef = useRef(false);
  const selectedRequestNoRef = useRef<string | undefined>(undefined);
  const detailRequestSequenceRef = useRef(0);
  const agentSubmissionRef = useRef(false);
  const evaluationSubmissionRef = useRef(false);
  const quoteSimulationSubmissionRef = useRef(false);
  const closeRfqDialogRef = useRef(false);
  const closeRfqSubmissionRef = useRef(false);
  const initialRequestHandledRef = useRef(false);

  const loadDashboard = useCallback(async (silent = false) => {
    if (!silent) setLoading(true);
    try {
      if (!initializedRef.current) {
        await sourcingApi.initializeDemo();
        initializedRef.current = true;
      }
      const [dashboardResponse, healthResponse, catalogResponse] = await Promise.all([
        sourcingApi.getDashboard(),
        sourcingApi.getHealth(),
        catalog ? Promise.resolve(null) : sourcingApi.getCatalog(),
      ]);
      setDashboard(dashboardResponse.data);
      setDeepSeekHealth(healthResponse.data.deepSeek);
      setServerTime(dashboardResponse.meta.serverTime);
      if (catalogResponse) setCatalog(catalogResponse.data);
      setFatalError(undefined);
    } catch (error) {
      setFatalError(readableError(error));
    } finally {
      if (!silent) setLoading(false);
    }
  }, [catalog]);

  const loadDetail = useCallback(async (requestNo: string, silent = false, signal?: AbortSignal, open = false) => {
    const sequence = ++detailRequestSequenceRef.current;
    if (!silent) setLoading(true);
    try {
      const response = await sourcingApi.getRequest(requestNo, signal);
      if (signal?.aborted || sequence !== detailRequestSequenceRef.current) return;
      if (open) {
        selectedRequestNoRef.current = requestNo;
        setSelectedRequestNo(requestNo);
        syncRequestQuery(requestNo);
      } else if (selectedRequestNoRef.current !== requestNo) {
        return;
      }
      setDetail(response.data);
      setServerTime(response.meta.serverTime);
    } catch (error) {
      if (!signal?.aborted && !silent) message.error(readableError(error));
    } finally {
      if (!silent && sequence === detailRequestSequenceRef.current) setLoading(false);
    }
  }, [message]);

  const agentPollingActive = Boolean(
    selectedRequestNo && (
      agentRunning
      || evaluationRunning
      || detail?.activeSourcingAgentRun?.status === 'RUNNING'
      || detail?.activeEvaluationAgentRun?.status === 'RUNNING'
    ),
  );

  useEffect(() => {
    void loadDashboard();
  }, [loadDashboard]);

  useEffect(() => {
    if (loading || initialRequestHandledRef.current) return;
    initialRequestHandledRef.current = true;
    const requestNo = new URLSearchParams(window.location.search).get('request')?.trim();
    if (requestNo) void loadDetail(requestNo, false, undefined, true);
  }, [loadDetail, loading]);

  useEffect(() => {
    const timer = window.setInterval(() => {
      void loadDashboard(true);
      if (selectedRequestNo && !agentPollingActive) void loadDetail(selectedRequestNo, true);
    }, 5000);
    return () => window.clearInterval(timer);
  }, [agentPollingActive, loadDashboard, loadDetail, selectedRequestNo]);

  useEffect(() => {
    if (!selectedRequestNo || !agentPollingActive) return;
    const controller = new AbortController();
    let stopped = false;
    let timer: number | undefined;
    const tick = async () => {
      await loadDetail(selectedRequestNo, true, controller.signal);
      if (!stopped) timer = window.setTimeout(() => void tick(), 500);
    };
    void tick();
    return () => {
      stopped = true;
      controller.abort();
      if (timer != null) window.clearTimeout(timer);
    };
  }, [agentPollingActive, loadDetail, selectedRequestNo]);

  const runAction = async (action: () => Promise<{ data: SourcingRequestDetail; meta: { serverTime: string } }>, success: string) => {
    setActionRunning(true);
    try {
      const response = await action();
      if (selectedRequestNoRef.current === response.data.requestNo) {
        ++detailRequestSequenceRef.current;
        setDetail(response.data);
        setServerTime(response.meta.serverTime);
      }
      message.success(success);
      await loadDashboard(true);
    } catch (error) {
      message.error(readableError(error));
      throw error;
    } finally {
      setActionRunning(false);
    }
  };

  const runAgentMessage = async (requestNo: string, agentMessage: string) => {
    if (agentSubmissionRef.current) return;
    agentSubmissionRef.current = true;
    setActionRunning(true);
    setAgentRunning(true);
    try {
      const response = await sourcingApi.sendAgentMessage(requestNo, agentMessage);
      if (selectedRequestNoRef.current === requestNo) {
        ++detailRequestSequenceRef.current;
        setDetail(response.data);
        setServerTime(response.meta.serverTime);
      }
      message.success('Agent 寻源已完成');
      await loadDashboard(true);
    } catch (error) {
      message.error(readableError(error));
      await loadDetail(requestNo, true);
      throw error;
    } finally {
      agentSubmissionRef.current = false;
      setAgentRunning(false);
      setActionRunning(false);
    }
  };

  const runEvaluation = async (requestNo: string, rfqNo: string) => {
    if (evaluationSubmissionRef.current) return;
    evaluationSubmissionRef.current = true;
    setActionRunning(true);
    setEvaluationRunning(true);
    try {
      const response = await sourcingApi.evaluateRfq(rfqNo);
      if (selectedRequestNoRef.current === requestNo) {
        ++detailRequestSequenceRef.current;
        setDetail(response.data);
        setServerTime(response.meta.serverTime);
      }
      message.success('Agent 报价评估已完成');
      await loadDashboard(true);
    } catch (error) {
      message.error(readableError(error));
      await loadDetail(requestNo, true);
      throw error;
    } finally {
      evaluationSubmissionRef.current = false;
      setEvaluationRunning(false);
      setActionRunning(false);
    }
  };

  const simulateRemainingQuotes = async (requestNo: string, rfqNo: string) => {
    if (quoteSimulationSubmissionRef.current) return;
    quoteSimulationSubmissionRef.current = true;
    setActionRunning(true);
    setQuoteSimulationRunning(true);
    try {
      const response = await sourcingApi.simulateRemainingQuotes(rfqNo);
      if (selectedRequestNoRef.current === requestNo) {
        ++detailRequestSequenceRef.current;
        setDetail(response.data.detail);
        setServerTime(response.meta.serverTime);
      }
      if (response.data.simulatedCount) {
        const registrationMessage = response.data.registeredExternalCount
          ? `，并完成 ${response.data.registeredExternalCount} 家外部供应商演示注册`
          : '';
        message.success(`已补齐 ${response.data.simulatedCount} 份不同的报价${registrationMessage}，当前 ${response.data.submittedCount}/${response.data.invitedCount} 家已提交`);
      } else {
        message.info('所有受邀供应商均已提交报价，无需补齐');
      }
      await loadDashboard(true);
    } catch (error) {
      message.error(readableError(error));
      await loadDetail(requestNo, true);
      throw error;
    } finally {
      quoteSimulationSubmissionRef.current = false;
      setQuoteSimulationRunning(false);
      setActionRunning(false);
    }
  };

  const createRequest = async (input: CreateSourcingRequestInput) => {
    setActionRunning(true);
    try {
      const response = await sourcingApi.createRequest(input);
      setCreateOpen(false);
      ++detailRequestSequenceRef.current;
      selectedRequestNoRef.current = response.data.requestNo;
      setDetail(response.data);
      setSelectedRequestNo(response.data.requestNo);
      syncRequestQuery(response.data.requestNo);
      setServerTime(response.meta.serverTime);
      message.success(`寻源需求 ${response.data.requestNo} 已创建`);
      await loadDashboard(true);
    } catch (error) {
      message.error(readableError(error));
      throw error;
    } finally {
      setActionRunning(false);
    }
  };

  const closeRfq = () => {
    if (!detail?.rfq || closeRfqDialogRef.current || closeRfqSubmissionRef.current) return;
    closeRfqDialogRef.current = true;
    const rfqNo = detail.rfq.rfqNo;
    const allSubmitted = detail.rfq.counts.submitted === detail.rfq.counts.invited;
    modal.confirm({
      title: allSubmitted ? '确认停止报价并进入评估？' : '确认提前停止报价？',
      icon: <ExclamationCircleOutlined />,
      content: allSubmitted
        ? '全部受邀供应商已提交报价。停止后将锁定各供应商的最新版本，并可继续进行 Agent 评估。该操作不能撤销。'
        : '停止后将锁定当前已提交的最新报价，未提交的供应商不能继续报价。该操作不能撤销。',
      okText: '停止并进入评估',
      okButtonProps: { danger: true },
      cancelText: '继续等待',
      onCancel: () => {
        closeRfqDialogRef.current = false;
      },
      onOk: async () => {
        if (closeRfqSubmissionRef.current) return;
        closeRfqSubmissionRef.current = true;
        try {
          await runAction(() => sourcingApi.closeRfq(rfqNo), '报价已停止，可以继续进行 Agent 评估');
        } finally {
          closeRfqSubmissionRef.current = false;
          closeRfqDialogRef.current = false;
        }
      },
    });
  };

  const resetDemo = async () => {
    setActionRunning(true);
    try {
      await sourcingApi.resetDemo();
      message.success('三个系统的数据基线已统一恢复');
      setResetOpen(false);
      setResetConfirmation('');
      ++detailRequestSequenceRef.current;
      selectedRequestNoRef.current = undefined;
      setSelectedRequestNo(undefined);
      setDetail(null);
      syncRequestQuery();
      await loadDashboard();
    } catch (error) {
      message.error(readableError(error));
    } finally {
      setActionRunning(false);
    }
  };

  if (loading && !dashboard.requests.length && !fatalError) {
    return <div className={styles.fullLoading}><Spin size="large" /><span>正在初始化寻源数据…</span></div>;
  }

  return (
    <div className={styles.pageRoot}>
      {fatalError && (
        <Alert
          type="error"
          showIcon
          closable
          message="寻源服务暂时不可用"
          description={fatalError}
          action={<Button onClick={() => void loadDashboard()}>重试</Button>}
          className={styles.fatalAlert}
        />
      )}

      <SourcingDashboard
        dashboard={dashboard}
        deepSeekHealth={deepSeekHealth}
        loading={loading}
        onCreate={() => setCreateOpen(true)}
        onOpen={(requestNo) => void loadDetail(requestNo, false, undefined, true)}
        onReset={() => setResetOpen(true)}
      />

      <CreateRequestDrawer
        open={createOpen}
        catalog={catalog}
        submitting={actionRunning}
        onClose={() => setCreateOpen(false)}
        onSubmit={createRequest}
      />

      <RequestDetailDrawer
        open={Boolean(selectedRequestNo)}
        detail={detail}
        serverTime={serverTime}
        loading={loading}
        actionRunning={actionRunning}
        agentRunning={agentRunning || detail?.activeSourcingAgentRun?.status === 'RUNNING'}
        evaluationRunning={evaluationRunning || detail?.activeEvaluationAgentRun?.status === 'RUNNING'}
        quoteSimulationRunning={quoteSimulationRunning}
        onClose={() => {
          ++detailRequestSequenceRef.current;
          selectedRequestNoRef.current = undefined;
          setSelectedRequestNo(undefined);
          setDetail(null);
          syncRequestQuery();
        }}
        onReload={() => selectedRequestNo && void loadDetail(selectedRequestNo)}
        onSendAgentMessage={(agentMessage) => detail
          ? runAgentMessage(detail.requestNo, agentMessage)
          : Promise.resolve()}
        onPublish={() => detail
          ? runAction(() => sourcingApi.publishRfq(detail.requestNo), '全部合法候选已邀请，通知发送记录已生成')
          : Promise.resolve()}
        onCloseRfq={closeRfq}
        onSimulateRemainingQuotes={() => detail?.rfq
          ? simulateRemainingQuotes(detail.requestNo, detail.rfq.rfqNo)
          : Promise.resolve()}
        onEvaluate={() => detail?.rfq
          ? runEvaluation(detail.requestNo, detail.rfq.rfqNo)
          : Promise.resolve()}
        onCreatePr={(quoteNo) => detail
          ? runAction(() => sourcingApi.createPurchaseRequisition(detail.requestNo, quoteNo), '采购申请 PR 已创建')
          : Promise.resolve()}
      />

      <Modal
        title="重置 Demo 数据"
        open={resetOpen}
        okText="确认重置"
        cancelText="取消"
        okButtonProps={{ danger: true, disabled: resetConfirmation !== '重置 Demo 数据', loading: actionRunning }}
        onCancel={() => { setResetOpen(false); setResetConfirmation(''); }}
        onOk={() => void resetDemo()}
      >
        <Alert
          type="warning"
          showIcon
          message="这会清除现场新增的需求、注册、报价、评估和 PR，并一次恢复三个应用的五条固定场景。"
        />
        <p>请输入“重置 Demo 数据”确认：</p>
        <Input value={resetConfirmation} onChange={(event) => setResetConfirmation(event.target.value)} />
      </Modal>
    </div>
  );
}
