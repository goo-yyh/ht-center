import type { ReactNode } from 'react';
import { redirect } from 'next/navigation';
import { readExternalSession } from '@/src/server/session';

export const dynamic = 'force-dynamic';

export default async function RfqsLayout({ children }: Readonly<{ children: ReactNode }>) {
  if (!(await readExternalSession())) redirect('/register');
  return children;
}
