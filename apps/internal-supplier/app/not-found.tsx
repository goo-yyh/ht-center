'use client';

import { Button, Result } from 'antd';
import { useRouter } from 'next/navigation';

export default function NotFound() {
  const router = useRouter();
  return <Result status="404" title="页面不存在" subTitle="请返回受邀询价列表继续操作。" extra={<Button type="primary" onClick={() => router.push('/rfqs')}>返回询价列表</Button>} />;
}
