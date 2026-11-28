import { jsonResult, type RouteContext, type RouteResult } from './route-types.js';

export function notFound(ctx: RouteContext): RouteResult {
  return jsonResult(404, { error: 'not-found' }, {}, ctx.method === 'HEAD');
}
