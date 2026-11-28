import { jsonResult, type RouteContext, type RouteResult } from './route-types.js';

/** Liveness only; independent of episode state. */
export function healthz(ctx: RouteContext): RouteResult {
  return jsonResult(200, { status: 'ok' }, {}, ctx.method === 'HEAD');
}
