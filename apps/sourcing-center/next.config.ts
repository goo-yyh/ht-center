import path from 'node:path';
import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  // 共享包位于仓库根目录，显式声明共同父目录供 Turbopack 解析 file: 依赖。
  turbopack: {
    root: path.resolve(process.cwd(), '../..'),
  },
  transpilePackages: ['@haitian/sourcing-contracts', '@haitian/ui-theme'],
};

export default nextConfig;
