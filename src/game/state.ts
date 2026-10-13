import { BALANCE } from '../config/balance.ts';
import { findGrowth, LEADER_MAP } from '../data/leaders.ts';
import { TRINKET_MAP } from '../data/trinkets.ts';
import type { EnvId, StatMods } from '../data/types.ts';
import type { TeamSnapshot } from '../battle/types.ts';

export interface OwnedUnit {
  uid: number;
  defId: string; // 리더면 리더 id
  level: number;
  leader?: boolean;
  growth?: string[]; // 몬스터가 레벨업 때 고른 성장 id
  // 성장 외의 전투 밖 영구 강화 (이벤트·보상 등으로 얻는 자리). 합성 때 계열별 최고값만 남는다 (mergeBonus)
  bonus?: StatMods;
  // 현재 외형(일러스트) = 외형 변화 성장의 id. 없으면 기본 형태
  form?: string;
}

// Lv3 합성 때 재료들의 외형이 서로 다르면 어느 외형으로 진화할지 고른다 ('' = 기본 형태)
export interface PendingFormChoice {
  uid: number;
  options: string[];
}

// 합성으로 레벨이 오른 몬스터의 성장 선택 대기열
export interface PendingUnitGrowth {
  uid: number;
  level: number;
  choices: string[];
}

export type ShopItem = { kind: 'monster' | 'trinket'; defId: string } | null;

export type NodeKind = 'normal' | 'env' | 'elite' | 'boss' | 'final';
export interface NodeOption {
  kind: NodeKind;
  env: EnvId;
}

export interface RewardStage {
  label: string;
  options: string[]; // 장신구 id
  gold: number; // 받지 않고 골드로 바꿀 때
}

export interface DayLog {
  day: number;
  node: NodeOption;
  win: boolean;
  opponent: string;
  matchStage: string;
  seconds: number;
  gains?: string; // 전투 후 획득 요약
}

// growth: 리더 성장 선택 / unitGrowth: 합성 레벨업한 몬스터의 성장 선택 (상점 단계 중에 끼어든다)
export type Phase = 'growth' | 'shop' | 'unitGrowth' | 'reward' | 'extendChoice' | 'ended';

export interface RunEnd {
  reason: 'champion' | 'eliminated' | 'extensionStop' | 'extensionLost' | 'extensionDone';
  score: number;
}

export interface RunState {
  saveVersion: 1;
  ruleVersion: number;
  runId: string;
  rng: number;
  leaderId: string;
  leaderLevel: number;
  growth: string[];
  day: number;
  wins: number;
  losses: number;
  gold: number;
  board: (OwnedUnit | null)[]; // 9칸, index = 슬롯 - 1
  bench: (OwnedUnit | null)[]; // 6칸
  shop: ShopItem[];
  shopLocked: boolean;
  trinkets: string[];
  nodes: NodeOption[];
  nodeIndex: number | null;
  phase: Phase;
  growthChoices: string[];
  unitGrowth: PendingUnitGrowth[];
  formChoices?: PendingFormChoice[];
  rewards: RewardStage[];
  extension: { active: boolean; wins: number; declined: boolean };
  log: DayLog[];
  end: RunEnd | null;
  profileRecorded?: boolean;
  nextUid: number;
  lastIncome: { base: number; interest: number; bonus: number };
}

export function createRun(leaderId: string, seed: number, runId: string): RunState {
  if (!LEADER_MAP[leaderId]) throw new Error(`unknown leader ${leaderId}`);
  const board: (OwnedUnit | null)[] = Array(9).fill(null);
  board[4] = { uid: 0, defId: leaderId, level: 1, leader: true }; // 리더는 가운데에서 시작
  return {
    saveVersion: 1,
    ruleVersion: BALANCE.ruleVersion,
    runId,
    rng: seed | 0,
    leaderId,
    leaderLevel: 1,
    growth: [],
    day: 0,
    wins: 0,
    losses: 0,
    gold: BALANCE.economy.startGold,
    board,
    bench: Array(BALANCE.board.benchSize).fill(null),
    shop: [],
    shopLocked: false,
    trinkets: [],
    nodes: [],
    nodeIndex: null,
    phase: 'shop',
    growthChoices: [],
    unitGrowth: [],
    formChoices: [],
    rewards: [],
    extension: { active: false, wins: 0, declined: false },
    log: [],
    end: null,
    nextUid: 1,
    lastIncome: { base: 0, interest: 0, bonus: 0 },
  };
}

export function deployLimit(s: RunState): number {
  const extra = s.growth.reduce((n, g) => n + (findGrowth(s.leaderId, g)?.deploy ?? 0), 0);
  return Math.min(BALANCE.board.maxDeploy, BALANCE.board.initialDeployLimit + extra);
}

export function deployedCount(s: RunState): number {
  return s.board.filter((u) => u !== null).length;
}

// 장신구 보유 개수 (같은 장신구를 여러 번 얻으면 중첩)
export function trinketCounts(ids: string[]): [string, number][] {
  const m = new Map<string, number>();
  for (const id of ids) m.set(id, (m.get(id) ?? 0) + 1);
  return [...m.entries()];
}

export function shopLevel(s: RunState): number {
  return s.trinkets.reduce((n, id) => n + (TRINKET_MAP[id]?.passive?.shopLevel ?? 0), 0);
}

export function toSnapshot(s: RunState, name: string): TeamSnapshot {
  const board = [];
  for (let i = 0; i < 9; i++) {
    const u = s.board[i];
    if (!u) continue;
    if (u.leader) board.push({ slot: i + 1, kind: 'leader' as const, defId: u.defId, level: s.leaderLevel, ...(u.bonus ? { bonus: { ...u.bonus } } : {}) });
    else {
      board.push({
        slot: i + 1, kind: 'monster' as const, defId: u.defId, level: u.level,
        ...(u.growth?.length ? { growth: [...u.growth] } : {}),
        ...(u.bonus ? { bonus: { ...u.bonus } } : {}),
        ...(u.form ? { form: u.form } : {}),
      });
    }
  }
  return { name, leaderId: s.leaderId, leaderLevel: s.leaderLevel, growth: [...s.growth], board, trinkets: [...s.trinkets] };
}
