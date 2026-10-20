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
export type StatusId = 'poison' | 'burn' | 'necrosis' | 'regen' | 'fury' | 'thorns' | 'hope';
export const STATUS_IDS: StatusId[] = ['poison', 'burn', 'necrosis', 'regen', 'fury', 'thorns', 'hope'];

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
  kind?: UnitKind; // 리더만 / 몬스터만 (없으면 둘 다)
  excludeSelf?: boolean;
}

export type UnitKind = 'leader' | 'monster';

// ── 비례 ("내 X만큼") ──
// 수치에 더해지는 항: 출처 값 × pct / 100 (내림. 팀 상태 중첩은 반올림). 예) 상대 독 중첩 × 200% = 독 1당 +2
// 유닛이 없는 효과(장신구)는 유닛 능력치 출처가 0이고, 골드·팀 상태·유닛 수 같은 출처는 그대로 쓴다.
export type ScaleSource =
  | 'atk' | 'power' | 'hp' | 'haste' | 'extra' | 'acts' // 자신
  | 'gold' // 내 골드 (전투 시점)
  | 'allyStatus' | 'enemyStatus' // 팀 상태 중첩 (status로 지정)
  | 'allyShield' | 'allyMissingHp' | 'enemyMissingHp'
  | 'allyCount' | 'enemyCount' // 유닛 수 (tag·kind로 거름)
  | 'consumed' // 상태 소모 효과 안에서: 이번에 소모한 중첩
  | 'paidHp'; // 체력 소모 효과 안에서: 이번에 소모한 아군 체력
export const SCALE_SOURCES: ScaleSource[] = ['atk', 'power', 'hp', 'haste', 'extra', 'acts', 'gold', 'allyStatus', 'enemyStatus', 'allyShield', 'allyMissingHp', 'enemyMissingHp', 'allyCount', 'enemyCount', 'consumed', 'paidHp'];
export interface Scale {
  src: ScaleSource;
  pct: LNum;
  status?: StatusId; // allyStatus·enemyStatus
  tag?: Tag; // allyCount·enemyCount
  kind?: UnitKind; // allyCount·enemyCount
}

// 피해·회복·실드 수치 = 공격력 x% + 주문력 x% + (실드만) 유닛 체력 x% + 고정값 + 비례(scales)
// 팀 상태(독·화상·재생·강화·가시) 중첩 = 주문력 x% (반올림) + 고정값 + 비례. 레벨업으로 주문력이 오르면 함께 강해진다.
export type Effect =
  | { type: 'damage'; atkPct?: LNum; powerPct?: LNum; flat?: LNum; scales?: Scale[]; pierce?: boolean } // 상대 합산 HP에 피해. pierce = 관통 (실드 무시)
  | { type: 'heal'; atkPct?: LNum; powerPct?: LNum; flat?: LNum; scales?: Scale[] } // 아군 합산 HP 회복
  | { type: 'shield'; atkPct?: LNum; powerPct?: LNum; hpPct?: LNum; flat?: LNum; scales?: Scale[] } // 아군 실드
  | { type: 'status'; status: StatusId; powerPct?: LNum; flat?: LNum; scales?: Scale[]; to: 'ally' | 'enemy' }
  | { type: 'atkFlat'; target: UnitFilter; amount: LNum; scales?: Scale[] } // 공격력 +x (합산식 성장)
  | { type: 'atkPct'; target: UnitFilter; pct: LNum } // 공격력 x% 증감
  | { type: 'powerFlat'; target: UnitFilter; amount: LNum; scales?: Scale[] } // 주문력 +x
  | { type: 'powerPct'; target: UnitFilter; pct: LNum } // 주문력 x% 증감
  | { type: 'haste'; target: UnitFilter; amount: LNum; scales?: Scale[] } // 가속 +x (음수 = 감속). 행동 간격 = 기본 × 100 / (100 + 가속)
  | { type: 'extra'; target: UnitFilter; amount: LNum; scales?: Scale[] } // 추가발동 +x
  | { type: 'stun'; target: UnitFilter; ticks: LNum }
  | { type: 'maxHpPct'; pct: LNum } // 아군 최대 체력 x%
  // 정화: 아군에게 걸린 해로운 상태 / 해주: 상대에게 걸린 이로운 상태 (상태 설정의 "해로움"으로 구분)
  // 상태마다 중첩 × pct% (내림) + flat 만큼 줄인다. scope = 해당 상태 전부 / 가장 많이 쌓인 하나
  | { type: 'cleanse' | 'dispel'; pct?: LNum; flat?: LNum; scope?: 'all' | 'largest' }
  // 상태 소모: 팀 상태(희망 등)를 cost만큼 (all이면 cost 이상일 때 전부) 써서 안쪽 효과들을 발동한다. 모자라면 아무 일도 없다
  // 안쪽 효과는 비례 출처 "소모한 중첩"(consumed)을 쓸 수 있다. from = 소모할 팀 (기본 아군, 상대면 상대에게 걸린 상태를 터뜨림)
  | { type: 'consume'; status: StatusId; cost: LNum; all?: boolean; from?: 'ally' | 'enemy'; effects: Effect[]; say?: string } // say = 소모에 성공했을 때 말풍선 (필살기 대사)
  // ── 전투 밖으로 이어지는 효과 (플레이어 쪽만 전투 후 런에 반영. 승패와 무관) ──
  | { type: 'permanent'; target: UnitFilter; stat: PermanentStat; amount: LNum } // 영구 강화: 이번 전투에 바로 적용 + 유닛에 남음
  | { type: 'gold'; amount: LNum } // 전투 후 골드 획득
  | { type: 'trinket'; grade: LNum; count?: LNum } // 전투 후 무작위 장신구 획득 (등급 지정)
  // 따라 하기 (반응 트리거 안에서만): 반응한 그 유닛의 "행동할 때" 효과를 내 능력치·내 편 기준으로 그대로 한다 (영구 강화·골드·장신구 획득 포함)
  | { type: 'mimic' }
  // 지휘 (전투 시작용): 대상 유닛들을 지금 바로 행동시킨다 (추가발동 포함, 기절 무시, 쿨다운은 그대로).
  // uniqueTag = 태그가 있고 자기 주변 8칸에 태그가 겹치는 유닛이 없는 유닛만. 행동시킨 수 n에 따라 전투 후 보상:
  // 골드 n×goldPer, trinketPer명마다 trinketGrade 무작위 장신구 1개, n ≥ perfect면 perfectTrinket(장신구 id)
  // 체력 소모 (자해): 아군 팀 체력을 현재 체력 pct% + flat만큼 깎고(실드 무시, 1 아래로는 안 내려감) 안쪽 효과를 발동한다.
  // 안쪽 효과는 비례 출처 "소모한 체력"(paidHp)을 쓸 수 있다. 체력이 줄어 "아군 체력 N% 이하" 트리거도 발동한다
  | { type: 'hpCost'; pct?: LNum; flat?: LNum; effects: Effect[]; say?: string }
  | { type: 'conduct'; target: UnitFilter; uniqueTag?: boolean; goldPer?: LNum; trinketGrade?: number; trinketPer?: number; perfect?: number; perfectTrinket?: string };

// 영구 강화로 올릴 수 있는 능력치 (StatMods의 일부)
export type PermanentStat = 'atk' | 'hp' | 'power' | 'haste' | 'extra';
export const PERMANENT_STATS: PermanentStat[] = ['atk', 'hp', 'power', 'haste', 'extra'];

export interface Trigger {
  on: 'battleStart' | 'act' | 'timer' | 'lowHp' | 'enemyLowHp' | 'react';
  atSec?: number; // timer 전용: 전투 시작 후 N초에 1회 (시스템 이벤트로 처리)
  repeat?: boolean; // timer 전용: N초마다 반복 (N, 2N, 3N초 …, limit이 있으면 그 횟수까지). N은 1 이상
  say?: string; // 이 능력이 발동할 때 유닛 카드 위 말풍선 (플레이버)
  hpPct?: number; // lowHp·enemyLowHp 전용: 아군(상대) 팀 체력이 최대 체력의 N% 이하가 되는 순간 1회
  // react 전용: watch에 걸리는 유닛(자신 제외)이 행동할 때마다 (추가발동 1회도 행동 1번). 위치는 전투 시작 때 정해진다.
  // 반응으로 낸 효과는 행동이 아니라서 다른 반응을 부르지 않는다. 기절 중에는 반응하지 않는다.
  watch?: UnitFilter;
  every?: number; // N번 행동할 때마다 (기본 1)
  limit?: number; // react·반복 timer: 전투당 최대 발동 횟수 (없으면 제한 없음)
  // 이 전투가 이 노드일 때만 이 능력이 있다 (없으면 항상). boss = 보스·최종 보스
  onlyIn?: ('elite' | 'boss')[];
  effects: Effect[];
}

// 태그 시너지: 보드에 이 태그가 count명 이상이면 그 단계의 능력이 생긴다 (장신구 능력처럼 기준 칸 = 중앙)
export interface SynergyTier {
  count: number;
  triggers: Trigger[];
  desc?: string; // 비우면 능력에서 자동 설명
}
export interface TagSynergy {
  tag: Tag;
  name?: string; // 시너지 이름 (예: "연대"). 비우면 태그 이름
  tiers: SynergyTier[];
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
  haste?: number; // 가속: 합산. 행동 간격 = 기본 × 100 / (100 + 가속). 음수 = 감속
  intervalPct?: number; // 예전 형식 (행동 간격 %). 불러올 때 가속으로 바꾸며, 옛 저장 데이터를 위해 계산에서만 읽는다
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
  // 등장 레벨 구간: 이 레벨에 도달할 때만 선택지에 나온다 (리더 = 리더 레벨 2~, 몬스터 = 성장을 고르는 레벨). 없으면 제한 없음
  minLevel?: number;
  maxLevel?: number;
  // 공용 몬스터 성장 전용 등장 조건: 등급 구간(없으면 제한 없음)과 태그.
  // forTags가 있으면 tagMode에 따라: only = 그 태그 중 하나라도 가진 몬스터에게만 (기본), except = 하나라도 가지면 제외
  minGrade?: number;
  maxGrade?: number;
  forTags?: Tag[];
  tagMode?: 'only' | 'except';
  // ── 전직 (LeaderDef.promotions 안에서만 쓰는 종류) ──
  // 변신: 태그와 기본 콘셉트가 크게 바뀐다. 본질 강화: 태그를 유지하고 원래 콘셉트를 키운다 (전직 선택의 맨 앞 고정 자리).
  // 둘 다 리더당 하나만 가질 수 있고, 고르면 리더 이름이 이 성장의 이름으로 바뀐다.
  transform?: boolean;
  mastery?: boolean;
  // 전직 성장의 대사: 고르면 리더의 기본 대사(quote)와 상황별 대사 중 쓴 칸이 이것으로 바뀐다
  quote?: string;
  lines?: LeaderLines;
  rivalLines?: LeaderLines;
  lore?: string; // 전직 선택 화면에서 이 길을 펼치면 나오는 이야기 (빈 줄로 문단 구분)
}

// ── 가속 ──
// 행동 간격 = 기본 간격 × 100 / (100 + 가속). 가속 1점의 가치가 항상 같다 (가속 +100 = 행동 횟수 2배).
// 감속(음수)은 100 + 가속이 HASTE_FLOOR 아래로 내려가지 않는다 (최대 5배 느려짐).
export const HASTE_FLOOR = 20;
export function hasteInterval(baseTicks: number, haste: number): number {
  return Math.floor((baseTicks * 100) / Math.max(HASTE_FLOOR, 100 + haste));
}
// 예전 "행동 간격 p%"를 한 번 적용했을 때와 같은 가속 (예: -15% → +18, +40% → -29)
export function hasteFromIntervalPct(p: number): number {
  if (p <= -95) return 1900;
  return Math.round((-100 * p) / (100 + p));
}

// 성장의 등장 레벨 구간 (minLevel·maxLevel) 안인지
export const inLevelRange = (g: GrowthDef, level: number): boolean =>
  (g.minLevel === undefined || level >= g.minLevel) && (g.maxLevel === undefined || level <= g.maxLevel);

// 몬스터 대사 (플레이버 텍스트)
export interface MonsterLines {
  detail?: string; // 상세 보기
  buy?: string; // 이번 런에서 처음 샀을 때
  maxLevel?: string; // 최고 레벨(Lv3)이 됐을 때
}
export const MONSTER_LINE_KEYS: [keyof MonsterLines, string][] = [['detail', '상세 보기'], ['buy', '처음 구매'], ['maxLevel', '최고 레벨 달성']];

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
  lines?: MonsterLines; // 상세 보기·처음 구매·최고 레벨 대사
  grade: number; // 1 일반 ~ 6 신화, 7 기원 (GRADE_NAMES)
  shop?: boolean; // false = 상점에 나오지 않음 (혼돈의 주사위 같은 변이·이벤트로만 얻음)
  deploy?: number; // 보드에 있는 동안 배치 인원 +N (통솔력). 1이면 자기 자리를 스스로 채워 배치 제한에서 자유로운 셈
  growth?: GrowthDef[]; // 이 몬스터 전용 성장 선택지 (공용 성장과 함께 제시)
  // 전직: 최고 레벨(Lv3)이 되면 반드시 이 중 하나가 된다 (하나면 바로, 여럿이면 고름). 일부 몬스터에만 쓴다.
  // 고르면 이름이 전직 이름으로 바뀌고 성장처럼 능력치·능력·태그가 더해진다. quote = 전직할 때 대사
  promotions?: GrowthDef[];
}

// 리더의 상황별 대사 (플레이버 텍스트, 전투와 무관). 전직 성장에도 같은 칸이 있고, 전직하면 쓴 칸만 바뀐다
export interface LeaderLines {
  battleStart?: string; // 전투 시작 말풍선
  lowHp?: string; // 아군 체력 30% 이하 말풍선
  win?: string; // 승리 배너
  lose?: string; // 패배 배너
  promote?: string; // 전직 선택지·전직 연출 (전직 성장에만 씀)
}
export const LINE_KEYS: [keyof LeaderLines, string][] = [['battleStart', '전투 시작'], ['lowHp', '위기 (체력 30% 이하)'], ['win', '승리'], ['lose', '패배']];

export interface LeaderDef extends UnitDef {
  // 리더 소개 화면용 (전투와 무관). 나중에 캐릭터 이름·서사를 넣는 자리
  title?: string; // 칭호·한 줄 소개 (예: "균형의 검사")
  quote?: string; // 대사 한 줄
  lore?: string; // 소개·서사 (빈 줄로 문단 구분)
  lines?: LeaderLines; // 상황별 대사 - 플레이어 리더일 때 (전투 시작·위기·승리·패배·전직)
  rivalLines?: LeaderLines; // 상황별 대사 - 상대 리더(기록)로 나왔을 때. 비운 칸은 lines
  growth: GrowthDef[]; // 일반 성장 선택지 (레벨업마다 무작위 제시, minLevel·maxLevel로 등장 구간 지정)
  // 전직: 일반 성장과 따로, BALANCE.leader.promotionLevels 레벨업에 이 목록만 제시한다 (본질 강화 맨 앞 고정 + 변신 전부).
  // 리더당 하나만 고른다.
  promotions?: GrowthDef[];
}

export interface TrinketDef {
  id: string;
  name: string;
  grade: number; // 1~6, 7 = 기원(상점 미등장)
  shop?: boolean; // false = 상점·보상의 무작위 뽑기에 나오지 않음 (이벤트 등으로만 얻음)
  desc: string;
  triggers: Trigger[]; // 시스템 효과로 처리. 같은 장신구를 여러 개 가지면 그만큼 중첩
  passive?: {
    incomeBonus?: number;
    shopLevel?: number;
    // ── 일회성 효과 (쓰면 사라진다) ──
    // 대상은 이 장신구 등급 이하의 몬스터
    upgradeOnBoard?: boolean; // 보드·벤치의 Lv1 유닛 하나를 무작위로 Lv2로 (대상이 없으면 생길 때까지 보관). 이름은 저장 호환용
    upgradeNextBuy?: boolean; // 다음에 구매하는 몬스터를 Lv2로
    // 변이: 보드의 몬스터 하나를 무작위로 골라 한 단계 높은 등급의 무작위 몬스터로 바꾼다.
    // 레벨·고른 성장·영구 강화는 그대로 (몬스터가 있는 최고 등급은 대상 아님)
    transmute?: boolean;
    transmuteMaxGrade?: number; // 변이 대상 등급 상한 (예: 2 = 고급 이하만). 없으면 제한 없음
    // 일괄 변이 (황금 지휘봉): 보드의 몬스터 전부를 한 번에 변이. transmuteExcept의 몬스터 id는 빼고 (예: 지휘자)
    transmuteAll?: boolean;
    transmuteExcept?: string[];
  };
  art?: string;
}

// 등급 (1~7). 기원은 상점에 나오지 않고 보스 보상·특수 효과로만 나온다. 색: 회색·초록·파랑·보라·노랑·빨강·검정
export const GRADE_NAMES = ['', '일반', '고급', '희귀', '영웅', '전설', '신화', '기원'];
export const MAX_GRADE = 7;
export const ORIGIN_GRADE = 7;
export const ENV_NAMES: Record<EnvId, string> = { normal: '일반', hp: '체력 증가', atk: '공격 증가' };

// ── 이벤트 (지도의 ? 노드) ──
// 전투 뒤 상황 글과 선택지를 보여 주고, 고른 선택지의 결과를 순서대로 처리한다.
export type LeaderStat = 'atk' | 'power' | 'hp' | 'haste';
export const LEADER_STATS: LeaderStat[] = ['atk', 'power', 'hp', 'haste'];
export const LEADER_STAT_NAMES: Record<LeaderStat, string> = { atk: '공격력', power: '주문력', hp: '체력', haste: '가속' };
export type EventOutcome =
  // 장신구·몬스터: id를 정하면 그것, 없으면 grade 등급에서 무작위 (grade 없으면 일차 상점 확률표로 등급).
  // choices가 2 이상이면 그 등급에서 서로 다른 것을 그만큼 보여 주고 하나 고르기 (안 고르면 골드). 몬스터는 다음 날 벤치로
  | { type: 'trinket'; id?: string; grade?: number; choices?: number }
  | { type: 'monster'; id?: string; grade?: number; choices?: number }
  | { type: 'growth'; id?: string } // 리더 이벤트 성장: id 없으면 아직 없는 것 중 무작위
  | { type: 'gold'; amount: number; perDay?: number } // 골드 + 일차 × perDay (음수면 잃는다, 0 아래로는 안 내려감)
  | { type: 'life'; amount: number } // 라이프 +/- (이걸로 라이프가 0이 되는 선택지는 고를 수 없다)
  | { type: 'leaderStat'; stat: LeaderStat; amount: number }; // 리더 능력치 영구 +
export interface EventChoice {
  text: string; // 선택지 글
  cost?: number; // 골드를 내야 고를 수 있다 (모자라면 고를 수 없음)
  result?: string; // 고른 뒤 보여 줄 글 (비우면 결과 요약만)
  outcomes: EventOutcome[];
}
export interface EventDef {
  id: string;
  name: string;
  text: string; // 상황 글 (모달)
  minDay?: number; // 등장 일차 구간 (없으면 제한 없음)
  maxDay?: number;
  weight?: number; // 등장 비율 (기본 1)
  choices: EventChoice[];
}
