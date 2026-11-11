import type { RouteDef, Script } from '../sim/types';
import classic from './scripts/classic.json';
import tuesday from './routes/tuesday.json';
import anniversary from './routes/anniversary.json';

/** Routes in the order they appear on the start screen. */
export const ROUTES: RouteDef[] = [tuesday as RouteDef, anniversary as RouteDef];
export const SCRIPTS: Script[] = [classic as Script];

export function routeById(id: string): RouteDef {
  return ROUTES.find(r => r.id === id) ?? ROUTES[0];
}
