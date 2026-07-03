/**
 * Bot-brain config shape + defaults — shared by the admin routes/panel.
 * The live consumer is the `onBotTurn` Cloud Function
 * (sbs-staging-functions/functions/index.js), which reads Firestore
 * `system_config/botBrain` on every bot pick. Keep field names in sync.
 */
export interface BotBrainConfig {
  enabled: boolean;
  fastMinDelaySec: number;
  fastMaxDelaySec: number;
  slowMinDelaySec: number;
  slowMaxDelaySec: number;
  topN: number;
  positionCaps: { QB: number; RB: number; WR: number; TE: number; DST: number };
}

export const BRAIN_DEFAULTS: BotBrainConfig = {
  enabled: true,
  fastMinDelaySec: 10,
  fastMaxDelaySec: 30,
  slowMinDelaySec: 30,
  slowMaxDelaySec: 90,
  topN: 5,
  positionCaps: { QB: 3, RB: 7, WR: 8, TE: 3, DST: 3 },
};

export const BRAIN_DOC = { col: 'system_config', doc: 'botBrain' } as const;
