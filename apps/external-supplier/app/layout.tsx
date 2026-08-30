import type { Metadata } from 'next';
import type { ReactNode } from 'react';
import { AntdRegistry } from '@ant-design/nextjs-registry';
import Providers from '@/app/providers';
import '@haitian/ui-theme/portal.css';
import '@/app/globals.css';

export const metadata: Metadata = {
  title: '海天外部供应商协同平台',
  description: '外部供应商询价、竞争力分析与报价协同平台',
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
