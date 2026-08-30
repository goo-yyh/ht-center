'use client';

import { Button, Result } from 'antd';
import { useEffect } from 'react';

export default function GlobalError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => {
    console.error('内部供应商页面渲染失败', error.digest ?? error.name);
  }, [error]);
  return <Result status="500" title="页面暂时无法显示" subTitle="请刷新重试；若问题持续，请检查核心业务 API 是否已启动。" extra={<Button type="primary" onClick={reset}>重新加载</Button>} />;
}
