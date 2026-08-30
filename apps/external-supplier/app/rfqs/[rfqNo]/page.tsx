import RfqDetailPageClient from '@/src/components/RfqDetailPageClient';

interface PageProps {
  params: Promise<{ rfqNo: string }>;
}

export default async function RfqDetailPage({ params }: PageProps) {
  const { rfqNo } = await params;
  return <RfqDetailPageClient rfqNo={rfqNo} />;
}
