// 게임 데이터(몬스터·리더·장신구)와 시너지 구조의 타입.
// 시너지 3종(태그·위치·트리거)은 모두 "트리거 → 효과" 하나의 구조로 표현한다.
//  - 태그 버프 = battleStart 트리거 + tag 필터
//  - 위치 효과 = battleStart/act 트리거 + 방향(dirs) 필터
//  - 트리거 = battleStart / act / timer

export type Side = 0 | 1; // 0 = 플레이어(준비 완료를 누른 쪽), 1 = 상대(기록)
// 태그는 모드에서 추가할 수 있도록 문자열로 둔다. 기본 목록은 DEFAULT_TAGS.
export type Tag = string;
export const DEFAULT_TAGS: Tag[] = ['야수', '언데드', '전사', '마법', '성직', '자연'];
export type EnvId = 'normal' | 'hp' | 'atk';
export type StatusId = 'poison' | 'regen' | 'fury';

// 레벨별 수치: 숫자 하나면 모든 레벨 공통, 배열이면 [Lv1, Lv2, Lv3]
export type LNum = number | number[];

// 방향: 기준 칸(c)과 상하좌우·대각선. 보드는 아군·상대 모두 같은 칸 번호(1행 1열 = 1)를 쓴다.
export type Dir = 'c' | 'u' | 'd' | 'l' | 'r' | 'ul' | 'ur' | 'dl' | 'dr';
export const DIR_OFFSETS: Record<Dir, [number, number]> = {
  ul: [-1, -1], u: [-1, 0], ur: [-1, 1],
  l: [0, -1], c: [0, 0], r: [0, 1],
  dl: [1, -1], d: [1, 0], dr: [1, 1],
};
export const DIRS: Dir[] = ['ul', 'u', 'ur', 'l', 'c', 'r', 'dl', 'd', 'dr'];

export interface UnitFilter {
  side: 'ally' | 'enemy';
  // all: 그 진영 전체
  // near: 기준 칸에서 dirs 방향의 칸들. 기준 칸 = 아군이면 자신의 칸, 상대면 자신과 같은 번호의 칸(대칭 위치)
  // sameRow / sameCol: 기준 칸과 같은 행 / 열
  area: 'all' | 'near' | 'sameRow' | 'sameCol';
  dirs?: Dir[];
  tag?: Tag;
  row?: number; // 1~3 (절대 위치 조건)
  col?: number; // 1~3
  excludeSelf?: boolean;
}

// 피해·회복·실드 수치 = 공격력 x% + 주문력 x% + (실드만) 유닛 체력 x% + 고정값
// 팀 상태(독·재생·강화) 중첩 = 주문력 x% (반올림) + 고정값. 레벨업으로 주문력이 오르면 함께 강해진다.
export type Effect =
  | { type: 'damage'; atkPct?: LNum; powerPct?: LNum; flat?: LNum } // 상대 합산 HP에 피해
  | { type: 'heal'; atkPct?: LNum; powerPct?: LNum; flat?: LNum } // 아군 합산 HP 회복
  | { type: 'shield'; atkPct?: LNum; powerPct?: LNum; hpPct?: LNum; flat?: LNum } // 아군 실드
  | { type: 'status'; status: StatusId; powerPct?: LNum; flat?: LNum; to: 'ally' | 'enemy' }
  | { type: 'atkFlat'; target: UnitFilter; amount: LNum } // 공격력 +x (합산식 성장)
  | { type: 'atkPct'; target: UnitFilter; pct: LNum } // 공격력 x% 증감
  | { type: 'powerFlat'; target: UnitFilter; amount: LNum } // 주문력 +x
  | { type: 'powerPct'; target: UnitFilter; pct: LNum } // 주문력 x% 증감
  | { type: 'intervalPct'; target: UnitFilter; pct: LNum } // 행동 간격 x% 증감 (음수 = 빨라짐)
  | { type: 'extra'; target: UnitFilter; amount: LNum } // 추가발동 +x
  | { type: 'stun'; target: UnitFilter; ticks: LNum }
  | { type: 'maxHpPct'; pct: LNum } // 아군 최대 체력 x%
  // ── 전투 밖으로 이어지는 효과 (플레이어 쪽만 전투 후 런에 반영. 승패와 무관) ──
  | { type: 'permanent'; target: UnitFilter; stat: PermanentStat; amount: LNum } // 영구 강화: 이번 전투에 바로 적용 + 유닛에 남음
  | { type: 'gold'; amount: LNum } // 전투 후 골드 획득
  | { type: 'trinket'; grade: LNum; count?: LNum }; // 전투 후 무작위 장신구 획득 (등급 지정)

// 영구 강화로 올릴 수 있는 능력치 (StatMods의 일부)
export type PermanentStat = 'atk' | 'hp' | 'power' | 'intervalPct' | 'extra';
export const PERMANENT_STATS: PermanentStat[] = ['atk', 'hp', 'power', 'intervalPct', 'extra'];

export interface Trigger {
  on: 'battleStart' | 'act' | 'timer';
  atSec?: number; // timer 전용: 전투 시작 후 N초에 1회 (시스템 이벤트로 처리)
  effects: Effect[];
}

// 능력치 변화 묶음. 성장 선택지의 능력치와, 유닛에 붙는 전투 밖 영구 강화(OwnedUnit.bonus)가 같이 쓴다.
// 합치는 규칙이 다르다: 성장은 고를 때마다 합산, 영구 강화는 합성 때 계열(키)별로 가장 좋은 값 하나만 남긴다.
export interface StatMods {
  atk?: number;
  atkPct?: number;
  hp?: number;
  hpPct?: number;
  power?: number;
  powerPct?: number;
  intervalPct?: number; // 음수 = 빨라짐 (낮을수록 좋음)
  extra?: number;
  healShieldPct?: number;
}

// 성장 선택지 (리더 레벨업, 몬스터 합성 레벨업). 능력치 변화·새 능력·기존 능력 제거·태그 추가/제거.
export interface GrowthDef {
  id: string;
  name: string;
  desc: string;
  repeatable: boolean;
  deploy?: number; // 리더 전용: 배치 인원 + (통솔력)
  stats?: StatMods;
  triggers?: Trigger[]; // 새 능력 추가
  removeTriggers?: number[]; // 기본 능력 제거 (유닛 기본 능력 목록의 순번, 0부터)
  addTags?: Tag[];
  removeTags?: Tag[];
  // 외형 변화: 성격이 크게 바뀌는 성장(이브이 진화처럼). 고르면 일러스트가 이 성장의 형태로 바뀐다.
  // 파일 이름: art/monsters/<유닛 id>.lv<레벨>.<이 성장 id>.png
  form?: boolean;
}

export interface UnitDef {
  id: string;
  name: string;
  tags: Tag[];
  hp: number;
  atk: number;
  power?: number; // 주문력: 독·재생·강화 같은 수치형 능력의 기준
  intervalTicks: number;
  extra?: number;
  triggers: Trigger[];
  desc: string; // 비우면 트리거에서 자동 생성한 설명을 쓴다
  art?: string; // 카드 아트 이미지 URL (없으면 흰 배경 + 검은 글씨 카드)
}

export interface MonsterDef extends UnitDef {
  grade: number; // 1 일반 ~ 5 신화, 6 기원
  growth?: GrowthDef[]; // 이 몬스터 전용 성장 선택지 (공용 성장과 함께 제시)
}

export interface LeaderDef extends UnitDef {
  growth: GrowthDef[];
}

export interface TrinketDef {
  id: string;
  name: string;
  grade: number; // 1~5, 6 = 기원(상점 미등장)
  desc: string;
  triggers: Trigger[]; // 시스템 효과로 처리. 같은 장신구를 여러 개 가지면 그만큼 중첩
  passive?: { incomeBonus?: number; shopLevel?: number };
  art?: string;
}

export const GRADE_NAMES = ['', '일반', '희귀', '에픽', '전설', '신화', '기원'];
export const ENV_NAMES: Record<EnvId, string> = { normal: '일반', hp: '체력 증가', atk: '공격 증가' };
