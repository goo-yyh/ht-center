import type { Metadata } from 'next';
import type { ReactNode } from 'react';
import { AntdRegistry } from '@ant-design/nextjs-registry';

import '@haitian/ui-theme/portal.css';
import './styles.css';
import Providers from './providers';

export const metadata: Metadata = {
  title: '海天内部供应商协同平台',
  description: '海天智能寻源内部供应商询价与报价入口',
};

export default function RootLayout({ children }: Readonly<{ children: ReactNode }>) {
  return (
    <html lang="zh-CN">
      <body>
        <AntdRegistry>
          <Providers>{children}</Providers>
        </AntdRegistry>
      </body>
    </html>
  );
}
