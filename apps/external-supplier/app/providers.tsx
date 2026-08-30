'use client';

import '@ant-design/v5-patch-for-react-19';
import { haitianPortalTheme } from '@haitian/ui-theme';
import { App, ConfigProvider } from 'antd';
import zhCN from 'antd/locale/zh_CN';
import type { ReactNode } from 'react';

export default function Providers({ children }: Readonly<{ children: ReactNode }>) {
  return (
    <ConfigProvider locale={zhCN} theme={haitianPortalTheme}>
      <App>{children}</App>
    </ConfigProvider>
  );
}
