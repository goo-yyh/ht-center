'use client';

import { AntdRegistry } from '@ant-design/nextjs-registry';
import { haitianAdminTheme } from '@haitian/ui-theme';
import { ConfigProvider } from 'antd';
import zhCN from 'antd/locale/zh_CN';
import type { ReactNode } from 'react';

export default function Providers({ children }: Readonly<{ children: ReactNode }>) {
  return (
    <AntdRegistry>
      <ConfigProvider locale={zhCN} theme={haitianAdminTheme}>{children}</ConfigProvider>
    </AntdRegistry>
  );
}
