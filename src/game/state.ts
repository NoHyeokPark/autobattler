import { BALANCE } from '../config/balance.ts';
import { findGrowth, LEADER_MAP } from '../data/leaders.ts';
import { MONSTER_MAP } from '../data/monsters.ts';
import { TRINKET_MAP } from '../data/trinkets.ts';
import type { EnvId, EventDef, StatMods } from '../data/types.ts';
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
  rerolls?: number; // 남은 다시 뽑기 횟수
}

export type ShopItem = { kind: 'monster' | 'trinket'; defId: string } | null;

// env = 예전 "환경 노드" (지도 이전의 기록에만 남아 있다). campfire = 모닥불(라이프 +1), event = 이벤트(?)
export type NodeKind = 'normal' | 'env' | 'elite' | 'boss' | 'final' | 'campfire' | 'event';
export interface NodeOption {
  kind: NodeKind;
  env: EnvId;
  mapId?: number; // 지도 노드 id
  mapKind?: NodeKind; // 지도에 그려진 원래 종류 (연장 중에는 엘리트·보스가 일반 전투로 진행된다)
}

// 런 지도: 일차마다 한 줄, 노드는 다음 날 노드들과 이어져 있다
export interface MapNode {
  id: number;
  day: number;
  lane: number;
  kind: NodeKind;
  env: EnvId;
  next: number[]; // 이어진 다음 날 노드 id
}
export interface RunMap {
  lanes: number;
  nodes: MapNode[];
}

export interface RewardStage {
  label: string;
  // 없으면 장신구. monster = 이벤트에서 고르는 몬스터 (고르면 다음 날 벤치로).
  // event = 이벤트 상황과 선택지 (event에 이벤트 데이터, 골드로 받기 없음). campfire = 휴식·단련 (options: 'rest' 또는 능력치, 골드로 받기 없음)
  kind?: 'trinket' | 'monster' | 'event' | 'campfire';
  options: string[]; // 장신구 id (monster면 몬스터 id, campfire면 'rest'·능력치, event면 비움)
  gold: number; // 받지 않고 골드로 바꿀 때 (event·campfire는 없음)
  event?: EventDef;
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
  reason: 'champion' | 'eliminated' | 'extensionStop' | 'extensionLost' | 'extensionDone' | 'outOfDays'; // outOfDays = 라이프가 남은 채 마지막 날이 끝남
  score: number;
}

// 화면에 보여 줄 몬스터 대사 (처음 구매·최고 레벨). 화면이 읽고 비운다
export interface VoiceEvent {
  defId: string;
  kind: 'buy' | 'maxLevel' | 'promote' | 'origin'; // origin = 기원 등급 획득 (defId = 몬스터 또는 장신구 id)
  trinket?: boolean; // origin: 장신구
  // promote: 전직한 유닛의 모습 (작은 알림에 카드로 보여 줌)
  promoId?: string;
  from?: string; // 전직 전 이름
  growth?: string[];
  form?: string;
}

// 기원 등급을 얻은 순간 알림 (몬스터 대사 자리의 작은 알림, 최근 몇 개만)
export function noteOrigin(s: RunState, defId: string, trinket = false) {
  s.voices = [...(s.voices ?? []), { defId, kind: 'origin' as const, ...(trinket ? { trinket: true } : {}) }].slice(-4);
}

// 몬스터 전직 선택 (길이 여럿일 때)
export interface PendingPromotion {
  uid: number;
  choices: string[];
}

export interface RunState {
  saveVersion: 1;
  ruleVersion: number;
  seenMonsters?: string[]; // 이번 런에서 한 번이라도 산 몬스터 (처음 구매 대사용)
  voices?: VoiceEvent[];
  notices?: string[]; // 하루 시작에 일어난 일 (일회성 장신구 발동 등). 화면이 알림으로 보여 주고 비운다
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
  nodes: NodeOption[]; // 오늘 고를 수 있는 노드 (지도에서 어제 노드와 이어진 것)
  nodeIndex: number | null;
  map?: RunMap; // 첫날 만든다 (지도 이전 저장은 다음 날 시작할 때 만든다)
  mapPath?: number[]; // 지나온 지도 노드 id (일차 순)
  extraLives?: number; // 모닥불로 얻은 라이프 (패배 한도 + 이것)
  pendingGift?: string; // 예전 저장: 이벤트에서 받은 몬스터 하나 (pendingGifts로 처리)
  pendingGifts?: string[]; // 이벤트에서 받은 몬스터: 다음 날 상점이 열릴 때 벤치에 (가득 차면 골드)
  phase: Phase;
  growthChoices: string[];
  growthRerolls?: number; // 리더 성장 선택지의 남은 다시 뽑기 횟수
  unitGrowth: PendingUnitGrowth[];
  formChoices?: PendingFormChoice[];
  unitPromotions?: PendingPromotion[];
  rewards: RewardStage[];
  extension: { active: boolean; wins: number; declined: boolean };
  log: DayLog[];
  end: RunEnd | null;
  profileRecorded?: boolean;
  nextUid: number;
  lastIncome: { base: number; interest: number; bonus: number; saved?: number }; // saved = 이자 기준 (수입 전 남긴 골드)
}

// 남은 라이프 (몇 번 더 질 수 있나). 0이면 탈락
export function livesLeft(s: RunState): number {
  return BALANCE.run.lossLimit + (s.extraLives ?? 0) - s.losses;
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

// 배치 인원 = 기본 + 리더 성장(통솔력) + 보드에 있는 몬스터의 통솔력(지휘자 등). 9칸이 상한
export function baseDeployLimit(s: RunState): number {
  const extra = s.growth.reduce((n, g) => n + (findGrowth(s.leaderId, g)?.deploy ?? 0), 0);
  return Math.min(BALANCE.board.maxDeploy, BALANCE.board.initialDeployLimit + extra);
}
export const unitDeploy = (u: { leader?: boolean; defId: string } | null | undefined) => (u && !u.leader ? MONSTER_MAP[u.defId]?.deploy ?? 0 : 0);
export function deployLimit(s: RunState): number {
  const fromBoard = s.board.reduce((n, u) => n + unitDeploy(u), 0);
  return Math.min(BALANCE.board.maxDeploy, baseDeployLimit(s) + fromBoard);
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
  return { name, leaderId: s.leaderId, leaderLevel: s.leaderLevel, growth: [...s.growth], board, trinkets: [...s.trinkets], gold: s.gold };
}
