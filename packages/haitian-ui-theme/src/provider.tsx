'use client';

import { AntdRegistry } from '@ant-design/nextjs-registry';
import { App as AntdApp, ConfigProvider } from 'antd';
import zhCN from 'antd/locale/zh_CN';
import type { ReactNode } from 'react';

import { haitianAdminTheme, haitianPortalTableTheme, haitianPortalTheme } from './index';

export type HaitianThemeVariant = 'admin' | 'portal' | 'portal-table';

export interface HaitianThemeProviderProps {
  children: ReactNode;
  variant?: HaitianThemeVariant;
  withApp?: boolean;
}

export function HaitianThemeProvider({
  children,
  variant = 'portal',
  withApp = false,
}: HaitianThemeProviderProps) {
  const theme = variant === 'admin'
    ? haitianAdminTheme
    : variant === 'portal-table'
      ? haitianPortalTableTheme
      : haitianPortalTheme;
  const content = withApp ? <AntdApp>{children}</AntdApp> : children;

  return (
    <AntdRegistry>
      <ConfigProvider locale={zhCN} theme={theme}>
        {content}
      </ConfigProvider>
    </AntdRegistry>
  );
}
