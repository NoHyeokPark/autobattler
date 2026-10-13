import type { EnvId, PermanentStat, Side, StatMods } from '../data/types.ts';

// 전투에 들어가는 팀 스냅샷. PvP 기록도 이 형식을 그대로 담는다.
export interface BoardEntry {
  slot: number; // 1~9 (행 우선: 1행 1열 = 1, 3행 3열 = 9)
  kind: 'leader' | 'monster';
  defId: string;
  level: number;
  growth?: string[]; // 몬스터가 레벨업 때 고른 성장 id (리더 성장은 TeamSnapshot.growth)
  bonus?: StatMods; // 성장 외의 전투 밖 영구 강화
  form?: string; // 외형(일러스트) 성장 id. 전투에는 영향 없음
}

export interface TeamSnapshot {
  name: string;
  leaderId: string;
  leaderLevel: number;
  growth: string[];
  board: BoardEntry[];
  trinkets: string[];
}

export interface BattleInput {
  player: TeamSnapshot; // 준비 완료를 누른 쪽. 동률 시 우선
  enemy: TeamSnapshot;
  env: EnvId;
  day: number;
  seed: number;
}

export type BEventType =
  | 'start' | 'act' | 'damage' | 'heal' | 'shield' | 'status' | 'statusTick'
  | 'buff' | 'stun' | 'sudden' | 'gain' | 'end';

// 전투 밖으로 이어지는 획득 (진영별). 플레이어 쪽만 전투 후 런에 반영한다.
export interface BattleGains {
  gold: number;
  trinkets: number[]; // 획득할 장신구 등급 목록 (실제 장신구는 전투 후 런의 난수로 뽑는다)
  permanent: { slot: number; stat: PermanentStat; amount: number }[]; // 칸별 영구 강화 (합산)
}

// 엔진은 화면을 모르고 이벤트 로그만 출력한다.
// 이벤트에는 출처 유닛, 대상, 변화량, 변화 후 값을 담는다.
export interface BEvent {
  t: number; // tick
  type: BEventType;
  side: Side | -1; // 출처 진영 (-1 = 양측 공통 시스템)
  src: string; // 출처 id (유닛 uid / 'trinket:id' / 'status:poison' / 'system')
  srcName: string;
  target?: string; // 'team0' / 'team1' / 유닛 uid
  amount?: number;
  after?: number;
  note?: string;
  stat?: 'atk' | 'power' | 'interval' | 'extra' | 'maxHp'; // buff 이벤트: 바뀐 능력치 (after = 바뀐 값)
  shieldAfter?: number; // damage 이벤트: 피해 후 대상 팀 실드
}

export interface UnitSummary {
  uid: string;
  side: Side;
  slot: number;
  name: string;
  level: number;
  isLeader: boolean;
  startAtk: number;
  endAtk: number;
  startPower: number;
  endPower: number;
  interval: number;
  extra: number;
  acts: number;
  damage: number;
  heal: number;
  shield: number;
}

export interface TimelinePoint {
  t: number;
  hp: [number, number];
  shield: [number, number];
}

export interface BattleResult {
  winner: Side;
  endTick: number;
  reason: 'ko' | 'timeout';
  suddenDeath: boolean;
  maxHp: [number, number];
  finalHp: [number, number];
  units: UnitSummary[];
  sourceTotals: { src: string; srcName: string; side: Side; damage: number; heal: number; shield: number }[];
  timeline: TimelinePoint[];
  events: BEvent[];
  gains: [BattleGains, BattleGains];
}
