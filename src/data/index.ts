import type { RouteDef, Script } from '../sim/types';
import classic from './scripts/classic.json';
import worried from './scripts/worried.json';
import tuesday from './routes/tuesday.json';
import anniversary from './routes/anniversary.json';
import parents from './routes/parents.json';

/** Routes in the order they appear on the start screen. */
export const ROUTES: RouteDef[] = [tuesday as RouteDef, anniversary as RouteDef, parents as RouteDef];
/** Partner personalities; the first is the default. */
export const SCRIPTS: Script[] = [classic as Script, worried as Script];

export function routeById(id: string): RouteDef {
  return ROUTES.find(r => r.id === id) ?? ROUTES[0];
}

export function scriptById(id: string | undefined): Script {
  return SCRIPTS.find(s => s.id === id) ?? SCRIPTS[0];
}
