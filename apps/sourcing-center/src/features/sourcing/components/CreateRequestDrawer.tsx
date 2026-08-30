'use client';

import { InboxOutlined } from '@ant-design/icons';
import { Alert, App, Button, Drawer, Form, Select, Space, Upload, Typography } from 'antd';
import type { UploadFile, UploadProps } from 'antd';
import { useEffect, useMemo, useState } from 'react';
import type { CatalogResponse, CreateSourcingRequestInput, EvaluationStrategy } from '../types';
import styles from '../pages/SourcingAgentPage.module.css';

const { Dragger } = Upload;
const { Text } = Typography;

type Props = {
  open: boolean;
  catalog: CatalogResponse | null;
  submitting: boolean;
  onClose: () => void;
  onSubmit: (input: CreateSourcingRequestInput) => Promise<void>;
};

type FormValue = Omit<CreateSourcingRequestInput, 'attachment'>;

async function fileToBase64(file: File): Promise<string> {
  const buffer = await file.arrayBuffer();
  const bytes = new Uint8Array(buffer);
  let binary = '';
  for (const byte of bytes) {
    binary += String.fromCharCode(byte);
  }
  return btoa(binary);
}

export default function CreateRequestDrawer({ open, catalog, submitting, onClose, onSubmit }: Props) {
  const { message } = App.useApp();
  const [form] = Form.useForm<FormValue>();
  const [selectedItemCode, setSelectedItemCode] = useState<string>();
  const [attachment, setAttachment] = useState<File | null>(null);
  const selectedItem = useMemo(
    () => catalog?.items.find((item) => item.code === selectedItemCode) ?? catalog?.items[0],
    [catalog, selectedItemCode],
  );

  useEffect(() => {
    if (!open || !catalog?.items.length) {
      return;
    }
    const item = catalog.items[0];
    setSelectedItemCode(item.code);
    form.setFieldsValue({
      itemCode: item.code,
      specificationCode: item.specifications[0]?.code,
      quantity: item.quantities[1]?.value ?? item.quantities[0]?.value,
      qualificationCodes: item.qualifications.slice(0, 1).map((entry) => entry.code),
      requiredDeliveryDays: item.deliveryOptions[1] ?? item.deliveryOptions[0] ?? 15,
      quoteDurationMinutes: catalog.quoteDurations?.at(-1) ?? 60,
      evaluationStrategy: 'BALANCED',
    });
    setAttachment(null);
  }, [catalog, form, open]);

  const uploadProps: UploadProps = {
    accept: '.pdf,.png,.jpg,.jpeg,.doc,.docx,.xlsx',
    maxCount: 1,
    fileList: attachment
      ? [{ uid: attachment.name, name: attachment.name, status: 'done', size: attachment.size } as UploadFile]
      : [],
    beforeUpload: (file) => {
      if (file.size > 5 * 1024 * 1024) {
        void message.error('附件不能超过 5 MB');
        return Upload.LIST_IGNORE;
      }
      setAttachment(file);
      return false;
    },
    onRemove: () => {
      setAttachment(null);
      return true;
    },
  };

  const submit = async () => {
    const value = await form.validateFields();
    const input: CreateSourcingRequestInput = { ...value };
    if (attachment) {
      input.attachment = {
        fileName: attachment.name,
        mimeType: attachment.type || 'application/octet-stream',
        sizeBytes: attachment.size,
        contentBase64: await fileToBase64(attachment),
      };
    }
    await onSubmit(input);
  };

  return (
    <Drawer
      title="创建寻源需求"
      width="min(920px, 96vw)"
      open={open}
      onClose={onClose}
      className={styles.createDrawer}
      extra={<Space><Button onClick={onClose}>取消</Button><Button type="primary" loading={submitting} onClick={submit}>创建并进入 Agent 寻源</Button></Space>}
    >
      <Space direction="vertical" size={18} style={{ width: '100%' }}>
        <Alert
          type="info"
          showIcon
          message="当前版本使用固定选项"
          description="选择物品后，规格、数量、资质和交付要求会从初始化模板中加载，确保能稳定匹配内外部供应商。"
        />
        <Form form={form} layout="vertical" requiredMark="optional" className={styles.createForm}>
          <Form.Item label="采购物品" name="itemCode" rules={[{ required: true }]}>
            <Select
              options={(catalog?.items ?? []).map((item) => ({ value: item.code, label: item.name }))}
              onChange={(code) => {
                const item = catalog?.items.find((entry) => entry.code === code);
                setSelectedItemCode(code);
                if (item) {
                  form.setFieldsValue({
                    specificationCode: item.specifications[0]?.code,
                    quantity: item.quantities[1]?.value ?? item.quantities[0]?.value,
                    qualificationCodes: item.qualifications.slice(0, 1).map((entry) => entry.code),
                    requiredDeliveryDays: item.deliveryOptions[1] ?? item.deliveryOptions[0],
                  });
                }
              }}
            />
          </Form.Item>
          <Form.Item label="规格与标准" name="specificationCode" rules={[{ required: true }]}>
            <Select options={(selectedItem?.specifications ?? []).map((item) => ({ value: item.code, label: item.label }))} />
          </Form.Item>
          <Form.Item label="采购数量" name="quantity" rules={[{ required: true }]}>
            <Select options={(selectedItem?.quantities ?? []).map((item) => ({ value: item.value, label: `${item.label}（${item.value.toLocaleString()} ${item.unit}）` }))} />
          </Form.Item>
          <Form.Item label="供应商资质" name="qualificationCodes" rules={[{ required: true }]}>
            <Select mode="multiple" options={(selectedItem?.qualifications ?? []).map((item) => ({ value: item.code, label: item.label }))} />
          </Form.Item>
          <Form.Item label="交付要求" name="requiredDeliveryDays" rules={[{ required: true }]}>
            <Select options={(selectedItem?.deliveryOptions ?? []).map((days) => ({ value: days, label: `${days} 天内` }))} />
          </Form.Item>
          <Form.Item label="报价截止时间" name="quoteDurationMinutes" rules={[{ required: true }]}>
            <Select options={(catalog?.quoteDurations ?? [15, 30, 60]).map((minutes) => ({ value: minutes, label: minutes < 60 ? `${minutes} 分钟后` : '1 小时后' }))} />
          </Form.Item>
          <Form.Item label="评估策略" name="evaluationStrategy" rules={[{ required: true }]}>
            <Select
              options={(catalog?.evaluationStrategies ?? [
                { value: 'BALANCED' as EvaluationStrategy, label: '综合均衡' },
                { value: 'PRICE_FIRST' as EvaluationStrategy, label: '价格优先' },
                { value: 'DELIVERY_FIRST' as EvaluationStrategy, label: '交期优先' },
              ])}
            />
          </Form.Item>
          <Form.Item label="采购附件（可选）" className={styles.fullFormItem}>
            <Dragger {...uploadProps}>
              <p className="ant-upload-drag-icon"><InboxOutlined /></p>
              <p className="ant-upload-text">点击或拖拽一份规格书、图纸到此处</p>
              <Text type="secondary">附件只供供应商下载，Agent 不读取；单文件不超过 5 MB。</Text>
            </Dragger>
          </Form.Item>
        </Form>
      </Space>
    </Drawer>
  );
}
