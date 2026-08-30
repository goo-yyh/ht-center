export function buildCoreHeaders(serviceToken: string, supplierNo?: string, extra?: HeadersInit): Headers {
  const headers = new Headers(extra);
  headers.set('accept', 'application/json');
  headers.set('x-demo-service-token', serviceToken);
  headers.set('authorization', `Bearer ${serviceToken}`);
  if (supplierNo) headers.set('x-demo-supplier-no', supplierNo);
  return headers;
}
