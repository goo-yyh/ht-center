import { registrationInputSchema } from '@/src/contracts';
import { coreApiRequest } from '@/src/server/core-api';
import { apiFailure, apiSuccess } from '@/src/server/route-response';
import { setExternalSessionCookie } from '@/src/server/session';

export const dynamic = 'force-dynamic';

export async function POST(request: Request) {
  try {
    const input = registrationInputSchema.parse(await request.json());
    const result = await coreApiRequest<unknown>('/external/register', {
      method: 'POST',
      body: input,
    });
    if (!result.meta.workspaceInstanceId) {
      throw new Error('核心服务未返回工作区实例标识');
    }
    await setExternalSessionCookie(result.meta.workspaceInstanceId);
    return apiSuccess(result.data, result.meta, 201);
  } catch (error) {
    return apiFailure(error);
  }
}
