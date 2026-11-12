export type ObstacleType = 'puddle' | 'banana' | 'cone' | 'hydrant' | 'dog' | 'skater' | 'pigeons' | 'flower' | 'hole';

export interface ObstacleDef {
  type: ObstacleType;
  x: number;
  /** Flowers only: 'low' is grabbed while walking, 'high' needs a jump. */
  height?: 'low' | 'high';
}

export interface RouteDef {
  id: string;
  title: string;
  blurb: string;
  item: 'cake';
  /** Rain darkens the sky, lights the lamps early and adds falling rain. */
  weather?: 'rain';
  /** Clock times as "H:MM" (PM). */
  start: string;
  deadline: string;
  /** World units from the start line to the front gate. */
  length: number;
  /** Texts sent the moment the run starts. */
  intro: string[];
  /** Template values used by the texting script, e.g. {food}. */
  vars: Record<string, string>;
  obstacles: ObstacleDef[];
}

export interface ReplyOption {
  text: string;
  mood: number;
  promiseMinutes?: number;
  claimsCake?: boolean;
  /** Immediate answer from them after this reply. */
  answer?: string;
}

export interface ScheduledText {
  /** Minutes relative to the route's deadline (negative = before). */
  at: number;
  text: string;
  replies?: string;
}

export interface Ending {
  minScore: number;
  rank: string;
  line: string;
  /** Used instead of `line` when the cake is mostly gone. */
  lineWithoutCake?: string;
}

export interface Script {
  id: string;
  name: string;
  /** One word for the start screen and share card: "your {adjective} girlfriend". */
  adjective: string;
  /** Phone header face from best mood to worst (five). */
  faces?: string[];
  schedule: ScheduledText[];
  replies: Record<string, ReplyOption[]>;
  reactions: Record<string, string>;
  promiseBroken: string;
  /** Highest minScore first. */
  endings: Ending[];
  extras: { cakeLie: string; cakeOnShirt: string; flowers: string };
}

export type Relation = 'girlfriend' | 'boyfriend' | 'partner';

export interface Vec { x: number; y: number }
