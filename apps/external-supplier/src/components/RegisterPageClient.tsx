'use client';

import { CheckCircleOutlined, SafetyCertificateOutlined, TeamOutlined } from '@ant-design/icons';
import { Alert, App, Button, Card, Form, Input, Skeleton, Space, Tag, Typography } from 'antd';
import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import type { RegistrationInput, RegistrationProfile } from '@/src/contracts';
import { portalFetch, PortalApiError } from '@/src/client/api';
import { PortalShell } from '@/src/components/PortalShell';

const { Text, Title } = Typography;

const riskLabels = {
  LOW: { label: '低风险', color: 'success' },
  MEDIUM: { label: '中风险', color: 'warning' },
  HIGH: { label: '高风险', color: 'error' },
} as const;

function qualificationLabel(value: string): string {
  return value === 'ISO9001' ? 'ISO 9001' : value === 'IATF16949' ? 'IATF 16949' : value;
}

export default function RegisterPageClient() {
  const router = useRouter();
  const { message } = App.useApp();
  const [profile, setProfile] = useState<RegistrationProfile | null>(null);
  const [loadError, setLoadError] = useState<string>();
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    let active = true;
    const initialize = async () => {
      try {
        const result = await portalFetch<RegistrationProfile>('/api/registration-profile');
        if (!active) return;
        if (result.data.registered) {
          await portalFetch<{ supplierNo: string }>('/api/session', { method: 'POST' });
          if (active) {
            message.success('企业已完成注册，正在进入询价列表');
            router.replace('/rfqs');
            router.refresh();
          }
          return;
        }
        setProfile(result.data);
      } catch (error: unknown) {
        if (active) setLoadError(error instanceof Error ? error.message : '企业资料加载失败');
      }
    };
    void initialize();
    return () => {
      active = false;
    };
  }, [message, router]);

  async function submit(values: RegistrationInput) {
    setSubmitting(true);
    try {
      await portalFetch('/api/register', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          contactName: values.contactName,
          email: values.email,
          password: values.password,
        }),
      });
      message.success('注册成功，正在进入询价列表');
      router.replace('/rfqs');
      router.refresh();
    } catch (error) {
      if (error instanceof PortalApiError && error.code === 'SUPPLIER_ALREADY_REGISTERED') {
        message.error('该企业已完成注册。如演示数据刚刚重置，请刷新页面后重新操作');
      } else {
        message.error(error instanceof Error ? error.message : '注册失败，请稍后重试');
      }
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <PortalShell>
      <div className="register-wrap">
        <section className="register-intro">
          <Tag color="red">供应商协同</Tag>
          <h1>参与海天采购询价</h1>
          <p>确认已匹配的企业资料，完善联系人信息后即可进入供应商工作台，查看企业已受邀的采购询价。</p>
          <div className="register-points">
            <div className="register-point"><TeamOutlined /> 企业身份由寻源结果预先匹配</div>
            <div className="register-point"><SafetyCertificateOutlined /> 采购附件仅对受邀供应商开放</div>
            <div className="register-point"><CheckCircleOutlined /> 首次报价后可查看竞争力，并有一次重新报价机会</div>
          </div>
        </section>

        <Card className="surface-card register-card" title="供应商注册">
          {loadError ? (
            <Alert
              type="error"
              showIcon
              message="企业资料暂时无法加载"
              description={loadError}
              action={<Button size="small" onClick={() => window.location.reload()}>重新加载</Button>}
            />
          ) : !profile ? (
            <Skeleton active paragraph={{ rows: 8 }} />
          ) : (
            <>
              <div className="profile-block">
                <Space wrap size={8}>
                  <Text className="profile-name">{profile.name}</Text>
                  <Tag color="red">{profile.source}</Tag>
                  <Tag color={riskLabels[profile.riskLevel].color}>{riskLabels[profile.riskLevel].label}</Tag>
                </Space>
                <div className="profile-grid">
                  <div><span className="profile-label">供应商编号</span><span className="profile-value">{profile.supplierNo}</span></div>
                  <div><span className="profile-label">所在区域</span><span className="profile-value">{profile.region}</span></div>
                  {profile.unifiedSocialCreditCode && (
                    <div className="profile-wide"><span className="profile-label">统一社会信用代码</span><span className="profile-value">{profile.unifiedSocialCreditCode}</span></div>
                  )}
                  <div className="profile-wide"><span className="profile-label">企业地址</span><span className="profile-value">{profile.address}</span></div>
                  <div className="profile-wide">
                    <span className="profile-label">主要供应能力</span>
                    <Space wrap size={[6, 6]} className="profile-tags">
                      {profile.primaryCapabilities.map((capability) => <Tag key={capability}>{capability}</Tag>)}
                    </Space>
                  </div>
                  <div className="profile-wide">
                    <span className="profile-label">主要资质</span>
                    <Space wrap size={[6, 6]} className="profile-tags">
                      {profile.qualifications.map((qualification) => <Tag color="blue" key={qualification}>{qualificationLabel(qualification)}</Tag>)}
                    </Space>
                  </div>
                  <div className="profile-wide"><span className="profile-label">来源说明</span><span className="profile-value">{profile.sourceDetail}</span></div>
                  <div className="profile-wide"><span className="profile-label">风险提示</span><span className="profile-value">{profile.riskSummary}</span></div>
                </div>
              </div>

              <Title level={5}>完善联系人信息</Title>
              <Form<RegistrationInput> layout="vertical" requiredMark="optional" onFinish={submit}>
                <Form.Item label="联系人" name="contactName" rules={[{ required: true, message: '请输入联系人姓名' }, { min: 2, message: '联系人姓名至少 2 个字' }]}>
                  <Input autoComplete="name" maxLength={50} placeholder="请输入姓名" />
                </Form.Item>
                <Form.Item label="联系邮箱" name="email" rules={[{ required: true, message: '请输入联系邮箱' }, { type: 'email', message: '请输入正确的邮箱地址' }]}>
                  <Input autoComplete="email" maxLength={120} placeholder="name@company.com" />
                </Form.Item>
                <Form.Item label="设置密码" name="password" extra="仅用于当前供应商账号，不会在页面或日志中显示明文。" rules={[{ required: true, message: '请输入密码' }, { min: 8, message: '密码至少需要 8 位' }]}>
                  <Input.Password autoComplete="new-password" maxLength={72} placeholder="至少 8 位" />
                </Form.Item>
                <Button type="primary" htmlType="submit" size="large" block loading={submitting}>
                  确认注册并进入询价
                </Button>
              </Form>
            </>
          )}
        </Card>
      </div>
    </PortalShell>
  );
}
