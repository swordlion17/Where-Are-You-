import { fillTemplate, fmtClock, parseClock } from './clock';
import { itemVars } from './items';
import type { RouteDef, Script } from './types';

export interface RunSummary {
  mood: number;
  cake: number;
  flowers: number;
  arrivedAt: number;
  cakeClaim: boolean;
}

export interface Result {
  score: number;
  rank: string;
  /** Their first message at the door. */
  line: string;
  /** All messages at the door, `line` first. */
  lines: string[];
  lateText: string;
  arrival: string;
  cake: number;
}

export function lateText(arrivedAt: number, deadline: number): string {
  const diff = arrivedAt - deadline;
  if (diff > 0) return `${Math.ceil(diff / 60)} min late`;
  const early = Math.floor(-diff / 60);
  return early >= 1 ? `${early} min early` : 'right on time';
}

export function scoreRun(run: RunSummary, route: RouteDef, script: Script): Result {
  const deadline = parseClock(route.deadline);
  const cake = Math.round(run.cake);
  const onTime = run.arrivedAt <= deadline;
  const score = Math.round(run.mood + (cake >= 70 ? 15 : cake >= 35 ? 5 : -10) + run.flowers * 4 + (onTime ? 10 : 0));
  const ending = script.endings.find(e => score >= e.minScore) ?? script.endings[script.endings.length - 1];
  const vars = { ...route.vars, ...itemVars(route.item) };
  const line = fillTemplate(cake < 35 && ending.lineWithoutCake ? ending.lineWithoutCake : ending.line, vars);
  const lines = [line];
  const lowest = script.endings[script.endings.length - 1];
  if (ending !== lowest) {
    if (run.cakeClaim && cake < 35) lines.push(fillTemplate(script.extras.cakeLie, vars));
    else if (cake <= 0) lines.push(fillTemplate(script.extras.cakeOnShirt, vars));
    if (run.flowers >= 4) lines.push(fillTemplate(script.extras.flowers, vars));
  }
  return { score, rank: ending.rank, line, lines, lateText: lateText(run.arrivedAt, deadline), arrival: `${fmtClock(run.arrivedAt)} PM`, cake };
}
