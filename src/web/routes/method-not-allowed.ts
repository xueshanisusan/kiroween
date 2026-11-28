import { jsonResult, type RouteResult } from './route-types.js';

export function methodNotAllowed(): RouteResult {
  return jsonResult(405, { error: 'method-not-allowed' }, { Allow: 'GET, HEAD' });
}
