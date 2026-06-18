// ---------------------------------------------------------------------------
// champion-sim-data.ts —— 2026 世界杯各队夺冠/晋级阶段概率【静态兜底基线】
//
// 这是 DB（champion_sim 表）为空时的回退快照。实时值由 poller 在赛果变化时重算写库，
// 见 scripts/lib/champion-sim-core.mjs（模拟核心）、scripts/run-champion-sim.mjs（手动重算）、
// lib/db/champion-sim.ts（getChampionRace 读库组装）。运行期前端优先用 DB 实时值。
//
// 方法：小组赛已结束场次用真实比分、未赛场次用 v6 的 λ 泊松抽样；每组前 2 + 最佳 8 个第三名
// 出线；淘汰赛按有效实力(Elo)做种子单淘汰（强队晚相遇），平局以 Elo 微倾斜点球决出。
// 东道主(USA/MEX/CAN)全程享主场加成，故模型给东道主的概率高于博彩市场——这是模型设定，已注明。
// 数值单位均为百分比。仅供娱乐，非投注建议。
// ---------------------------------------------------------------------------

export type ChampionSim = {
  champ: number // 夺冠
  final: number // 进决赛
  sf: number // 进 4 强
  qf: number // 进 8 强
  r16: number // 进 16 强
  qualify: number // 小组出线（进 32 强）
}

export const CHAMPION_SIM: Record<string, ChampionSim> = {
  FRA: { champ: 10.2, final: 18.5, sf: 32.8, qf: 55.6, r16: 88, qualify: 92.7 },
  ESP: { champ: 10, final: 18.2, sf: 32.1, qf: 55, r16: 88.5, qualify: 97.8 },
  ARG: { champ: 8.4, final: 15.5, sf: 28.4, qf: 49.6, r16: 81.1, qualify: 94 },
  ENG: { champ: 7.4, final: 13.9, sf: 26.3, qf: 47, r16: 78.3, qualify: 95 },
  USA: { champ: 7.3, final: 13.5, sf: 25.5, qf: 45.8, r16: 77.7, qualify: 98.4 },
  POR: { champ: 6.3, final: 12, sf: 22.7, qf: 41.6, r16: 70.9, qualify: 93.2 },
  MEX: { champ: 6.1, final: 12, sf: 22.5, qf: 41.8, r16: 72.3, qualify: 98.1 },
  BRA: { champ: 5.6, final: 11, sf: 20.7, qf: 40, r16: 69.8, qualify: 98.1 },
  BEL: { champ: 4.6, final: 9.3, sf: 17.8, qf: 35.1, r16: 64, qualify: 97 },
  NED: { champ: 4.4, final: 8.9, sf: 16.8, qf: 32.8, r16: 59.5, qualify: 86.8 },
  GER: { champ: 4.3, final: 8.7, sf: 17.3, qf: 34, r16: 63.7, qualify: 99.7 },
  CRO: { champ: 3.6, final: 7.4, sf: 14.9, qf: 29.5, r16: 56.5, qualify: 91.9 },
  MAR: { champ: 3.5, final: 7.2, sf: 15, qf: 29.2, r16: 58.3, qualify: 97 },
  COL: { champ: 2.6, final: 5.7, sf: 11.8, qf: 24.2, r16: 50, qualify: 88 },
  URU: { champ: 2.2, final: 4.7, sf: 10.4, qf: 22, r16: 49.5, qualify: 91.8 },
  SUI: { champ: 1.9, final: 4.2, sf: 9.3, qf: 19.6, r16: 46.6, qualify: 89.6 },
  CAN: { champ: 1.5, final: 3.4, sf: 7.4, qf: 15.9, r16: 39.6, qualify: 78.2 },
  JPN: { champ: 1.4, final: 3.4, sf: 7.5, qf: 16.4, r16: 40.4, qualify: 80.7 },
  IRN: { champ: 1.4, final: 3.1, sf: 7.7, qf: 17.3, r16: 42.5, qualify: 91.7 },
  SEN: { champ: 1.2, final: 3, sf: 7, qf: 15.4, r16: 38.1, qualify: 79 },
  KOR: { champ: 1.1, final: 2.8, sf: 7.1, qf: 17.1, r16: 41.8, qualify: 95.1 },
  ECU: { champ: 0.9, final: 2.2, sf: 5.6, qf: 13.3, r16: 32.6, qualify: 78 },
  AUS: { champ: 0.8, final: 2, sf: 5.5, qf: 14.3, r16: 35.2, qualify: 93.3 },
  AUT: { champ: 0.8, final: 2.1, sf: 5.2, qf: 13, r16: 31.5, qualify: 78.5 },
  TUR: { champ: 0.4, final: 1, sf: 2.7, qf: 6.6, r16: 16.4, qualify: 42.2 },
  NOR: { champ: 0.4, final: 1.2, sf: 3.2, qf: 9.1, r16: 23.6, qualify: 67.9 },
  PAN: { champ: 0.4, final: 1.1, sf: 3.3, qf: 9.5, r16: 24.8, qualify: 73.9 },
  EGY: { champ: 0.3, final: 0.8, sf: 2.5, qf: 8.4, r16: 23.8, qualify: 79.7 },
  SCO: { champ: 0.2, final: 0.8, sf: 2.5, qf: 8, r16: 23.2, qualify: 82.7 },
  ALG: { champ: 0.2, final: 0.6, sf: 2, qf: 6.8, r16: 19, qualify: 66 },
  PAR: { champ: 0.1, final: 0.2, sf: 0.7, qf: 2.5, r16: 7.6, qualify: 30.4 },
  CIV: { champ: 0.1, final: 0.5, sf: 1.7, qf: 6.5, r16: 21.3, qualify: 94.5 },
  SWE: { champ: 0.1, final: 0.2, sf: 0.9, qf: 3.2, r16: 10.2, qualify: 48.5 },
  TUN: { champ: 0.1, final: 0.3, sf: 1.2, qf: 4.2, r16: 12.8, qualify: 52.7 },
  CZE: { champ: 0, final: 0.2, sf: 0.7, qf: 2.7, r16: 8.8, qualify: 43.6 },
  RSA: { champ: 0, final: 0, sf: 0.1, qf: 0.3, r16: 1.9, qualify: 23.5 },
  BIH: { champ: 0, final: 0, sf: 0, qf: 0.1, r16: 0.9, qualify: 33.3 },
  QAT: { champ: 0, final: 0.1, sf: 0.5, qf: 2.3, r16: 9.3, qualify: 65.1 },
  HAI: { champ: 0, final: 0, sf: 0, qf: 0, r16: 0, qualify: 1.1 },
  CUW: { champ: 0, final: 0, sf: 0, qf: 0, r16: 0, qualify: 4.9 },
  NZL: { champ: 0, final: 0, sf: 0, qf: 0, r16: 0, qualify: 5.1 },
  CPV: { champ: 0, final: 0, sf: 0, qf: 0.2, r16: 1.3, qualify: 24.8 },
  KSA: { champ: 0, final: 0, sf: 0.1, qf: 0.5, r16: 3.1, qualify: 35.9 },
  IRQ: { champ: 0, final: 0, sf: 0.1, qf: 0.6, r16: 2.7, qualify: 26.2 },
  JOR: { champ: 0, final: 0, sf: 0, qf: 0.4, r16: 1.9, qualify: 26.2 },
  COD: { champ: 0, final: 0, sf: 0.1, qf: 0.9, r16: 4, qualify: 34.7 },
  UZB: { champ: 0, final: 0.1, sf: 0.4, qf: 1.8, r16: 6.9, qualify: 44.4 },
  GHA: { champ: 0, final: 0, sf: 0, qf: 0, r16: 0.3, qualify: 9 },
}
