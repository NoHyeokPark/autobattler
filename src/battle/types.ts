import type { EnvId, PermanentStat, Side, StatMods, StatusId } from '../data/types.ts';

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
  gold?: number; // 전투 시점의 골드 ("내 골드만큼" 효과용)
}

export interface BattleInput {
  player: TeamSnapshot; // 준비 완료를 누른 쪽. 동률 시 우선
  enemy: TeamSnapshot;
  env: EnvId;
  day: number;
  seed: number;
  node?: 'normal' | 'env' | 'elite' | 'boss' | 'final' | 'campfire' | 'event'; // 이 전투의 노드 (능력의 "보스·엘리트전에서만" 조건용, 없으면 일반)
}

export type BEventType =
  | 'start' | 'act' | 'damage' | 'heal' | 'shield' | 'status' | 'statusTick'
  | 'buff' | 'stun' | 'sudden' | 'gain' | 'say' | 'credit' | 'react' | 'hpCost' | 'end'; // react = 다른 유닛의 행동에 반응해 발동 // credit = 팀 상태가 낸 피해·회복을 건 유닛 몫으로 기록 (note: damage | heal)

// 전투 밖으로 이어지는 획득 (진영별). 플레이어 쪽만 전투 후 런에 반영한다.
export interface BattleGains {
  gold: number;
  trinkets: number[]; // 획득할 장신구 등급 목록 (실제 장신구는 전투 후 런의 난수로 뽑는다)
  permanent: { slot: number; stat: PermanentStat; amount: number }[]; // 칸별 영구 강화 (합산)
  named?: string[]; // 정해진 장신구 (id) - 지휘의 완벽한 공연 보상 등
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
  status?: StatusId; // status·statusTick 이벤트: 어떤 팀 상태인지 (after = 그 뒤 중첩 수)
  haste?: number; // buff interval 이벤트: 바뀐 뒤 가속 합계
  unit?: string; // buff maxHp 이벤트: 체력이 영구로 오른 유닛 uid (팀 최대 체력 증가와 구분)
}

// 유닛 능력치 묶음 (화면의 상세 정보용). interval은 tick, healShieldPct는 회복·실드 배율 %
export interface UnitStats {
  hp: number;
  atk: number;
  power: number;
  interval: number;
  haste: number; // 가속 합계 (interval은 이것과 칸 효과를 반영한 결과)
  extra: number;
  healShieldPct: number;
}

export interface UnitSummary {
  uid: string;
  side: Side;
  slot: number;
  name: string;
  level: number;
  isLeader: boolean;
  base: UnitStats; // 전투 전 능력치: 레벨·성장·영구 강화까지 (카드에 보이는 값)
  init: UnitStats; // 전투 시작 직전: base + 칸 효과·환경 (이후 변화는 buff 이벤트로)
  initStun: number; // 시작 기절 (tick, 1열)
  startAtk: number;
  endAtk: number;
  startPower: number;
  endPower: number;
  interval: number;
  extra: number;
  acts: number;
  damage: number; // 직접 낸 피해 + 팀 상태로 낸 몫
  heal: number;
  shield: number;
  statusDamage: number; // damage 중 팀 상태(독·화상·괴사·가시)로 낸 몫
  statusHeal: number; // heal 중 재생으로 낸 몫
  // 다른 아군에게 건 전투 한정 버프(강화 상태, 공격력·주문력 +N·+%)가 낸 몫 (damage/heal/shield에 포함, 받은 쪽 기록에서는 빠짐). 영구 강화는 받은 유닛 몫
  buffDamage: number;
  buffHeal: number;
  buffShield: number;
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
  synergies?: { side: Side; tag: string; name: string; count: number; tier: number; need: number }[]; // 발동한 태그 시너지
}
