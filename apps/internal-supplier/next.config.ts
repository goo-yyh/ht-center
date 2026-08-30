import path from 'node:path';
import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,
  turbopack: {
    root: path.resolve(process.cwd(), '../..'),
  },
  transpilePackages: ['@haitian/sourcing-contracts', '@haitian/ui-theme'],
};

export default nextConfig;
