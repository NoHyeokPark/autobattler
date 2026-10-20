import { T } from './targets.ts';
import { GRADE_NAMES } from './types.ts';
import type { TrinketDef } from './types.ts';

// 장신구: 보유만으로 효과. 판매 불가. 전투 효과는 모두 시스템 효과로 처리한다.
// 같은 장신구를 여러 번 얻을 수 있고, 가진 개수만큼 효과가 중첩된다 (상한 없음).
// 시스템 효과에는 주문력이 없으므로 팀 상태는 고정값(flat)으로 준다.
export const TRINKETS: TrinketDef[] = [
  // ── 일반 ──
  {
    id: 'rusty_ring', name: '녹슨 반지', grade: 1, desc: '전투 시작: 실드 40',
    triggers: [{ on: 'battleStart', effects: [{ type: 'shield', flat: 40 }] }],
  },
  {
    id: 'leather_glove', name: '가죽 장갑', grade: 1, desc: '전투 시작: 아군 전체 공격력 +1',
    triggers: [{ on: 'battleStart', effects: [{ type: 'atkFlat', target: T.allies(), amount: 1 }] }],
  },
  {
    id: 'lucky_coin', name: '행운의 동전', grade: 1, desc: '매일 수입 +1 골드',
    triggers: [], passive: { incomeBonus: 1 },
  },
  // ── 희귀 ──
  {
    id: 'poison_dagger', name: '독 바른 단검', grade: 2, desc: '전투 시작: 상대에게 독 3',
    triggers: [{ on: 'battleStart', effects: [{ type: 'status', status: 'poison', flat: 3, to: 'enemy' }] }],
  },
  {
    id: 'beast_fang', name: '야수의 이빨', grade: 2, desc: '전투 시작: 아군 야수 공격력 +20%',
    triggers: [{ on: 'battleStart', effects: [{ type: 'atkPct', target: T.allies('야수'), pct: 20 }] }],
  },
  {
    id: 'telescope', name: '망원경', grade: 2, desc: '상점 레벨 +1 (등급 확률표 한 단계 앞당김)',
    triggers: [], passive: { shopLevel: 1 },
  },
  {
    id: 'holy_water', name: '성수', grade: 2, desc: '전투 시작: 아군 재생 2',
    triggers: [{ on: 'battleStart', effects: [{ type: 'status', status: 'regen', flat: 2, to: 'ally' }] }],
  },
  {
    id: 'spell_tome', name: '마법서', grade: 2, desc: '전투 시작: 아군 전체 주문력 +15%',
    triggers: [{ on: 'battleStart', effects: [{ type: 'powerPct', target: T.allies(), pct: 15 }] }],
  },
  // ── 에픽 ──
  {
    id: 'hourglass', name: '모래시계', grade: 3, desc: '전투 시작: 아군 전체 가속 +11',
    triggers: [{ on: 'battleStart', effects: [{ type: 'haste', target: T.allies(), amount: 11 }] }],
  },
  // 대응용 장신구: 중첩 빌드(독·화상 / 재생·강화·가시)를 견제. 어느 덱이든 슬롯 하나를 내서 챙길 수 있게 희귀 등급
  {
    id: 'purifying_salt', name: '정화의 소금', grade: 2, desc: '',
    triggers: [
      { on: 'timer', atSec: 8, effects: [{ type: 'cleanse', pct: 30 }] },
      { on: 'timer', atSec: 16, effects: [{ type: 'cleanse', pct: 30 }] },
    ],
  },
  {
    id: 'unraveling_needle', name: '해주의 바늘', grade: 2, desc: '',
    triggers: [
      { on: 'timer', atSec: 8, effects: [{ type: 'dispel', pct: 30 }] },
      { on: 'timer', atSec: 16, effects: [{ type: 'dispel', pct: 30 }] },
    ],
  },
  {
    id: 'ward_charm', name: '수호의 부적', grade: 3, desc: '10초: 실드 250',
    triggers: [{ on: 'timer', atSec: 10, effects: [{ type: 'shield', flat: 250 }] }],
  },
  {
    id: 'bone_totem', name: '뼈 토템', grade: 3, desc: '전투 시작: 아군 언데드 공격력 +4',
    triggers: [{ on: 'battleStart', effects: [{ type: 'atkFlat', target: T.allies('언데드'), amount: 4 }] }],
  },
  {
    id: 'treasure_map', name: '보물 지도 조각', grade: 3, desc: '전투 시작: 무작위 일반 장신구 1개 획득 (전투 후)',
    triggers: [{ on: 'battleStart', effects: [{ type: 'trinket', grade: 1, count: 1 }] }],
  },
  {
    id: 'explorer_map', name: '탐험가의 지도', grade: 3, desc: '상점 레벨 +2 (등급 확률표 두 단계 앞당김)',
    triggers: [], passive: { shopLevel: 2 },
  },
  // ── 전설 ──
  {
    id: 'war_drum', name: '전쟁의 북', grade: 4, desc: '15초: 아군 전체 공격력 2배',
    triggers: [{ on: 'timer', atSec: 15, effects: [{ type: 'atkPct', target: T.allies(), pct: 100 }] }],
  },
  {
    id: 'echo_bell', name: '메아리 종', grade: 4, desc: '전투 시작: 3행 아군 추가발동 +1',
    triggers: [{ on: 'battleStart', effects: [{ type: 'extra', target: { side: 'ally', area: 'all', row: 3 }, amount: 1 }] }],
  },
  {
    id: 'giant_belt', name: '거인의 허리띠', grade: 4, desc: '전투 시작: 아군 최대 체력 +20%',
    triggers: [{ on: 'battleStart', effects: [{ type: 'maxHpPct', pct: 20 }] }],
  },
  // ── 신화 ──
  {
    id: 'time_crown', name: '시간의 왕관', grade: 5, desc: '전투 시작: 아군 전체 추가발동 +1',
    triggers: [{ on: 'battleStart', effects: [{ type: 'extra', target: T.allies(), amount: 1 }] }],
  },
  {
    id: 'frost_heart', name: '서리 심장', grade: 5, desc: '5초: 상대 전체 4초 기절',
    triggers: [{ on: 'timer', atSec: 5, effects: [{ type: 'stun', target: T.enemies(), ticks: 40 }] }],
  },
  // ── 성장 촉진 (1회용, 장신구 등급 이하의 몬스터 대상) ──
  // 진화의 돌 계열: 얻으면 보드·벤치의 Lv1 유닛 하나를 무작위로 Lv2로 (성장 선택). 대상이 없으면 생길 때까지 보관
  ...([
    ['evo_pebble', '진화의 조약돌', 1],
    ['evo_stone', '진화의 돌', 2],
    ['evo_crystal', '진화의 결정', 3],
    ['evo_gem', '진화의 보석', 4],
  ] as const).map(([id, name, grade]): TrinketDef => ({
    id, name, grade, triggers: [], passive: { upgradeOnBoard: true },
    desc: `1회용: 보드·벤치의 ${GRADE_NAMES[grade]} 이하 Lv1 유닛 하나를 무작위로 Lv2로 (성장 선택). 대상이 없으면 생길 때까지 보관`,
  })),
  // 각성의 두루마리 계열: 다음에 사는 몬스터가 Lv2로 들어온다 (성장 선택)
  ...([
    ['awk_note', '각성의 쪽지', 1],
    ['awk_scroll', '각성의 두루마리', 2],
    ['awk_tome', '각성의 서', 3],
    ['awk_canon', '각성의 경전', 4],
  ] as const).map(([id, name, grade]): TrinketDef => ({
    id, name, grade, triggers: [], passive: { upgradeNextBuy: true },
    desc: `1회용: 다음에 구매하는 ${GRADE_NAMES[grade]} 이하 몬스터가 Lv2로 들어옴 (성장 선택)`,
  })),

  // 변이: 푸시 유어 럭. 드물게 나오고, 신화 몬스터가 걸리면 기원 몬스터가 될 수도 있다
  {
    id: 'chaos_die', name: '혼돈의 주사위', grade: 4, triggers: [], passive: { transmute: true },
    desc: '1회용: 보드의 몬스터 하나를 무작위로 골라 한 단계 높은 등급의 무작위 몬스터로 바꿈. 레벨·고른 성장·영구 강화는 그대로',
  },
  {
    id: 'golden_baton', name: '황금 지휘봉', grade: 7, shop: false, triggers: [], passive: { transmuteAll: true, transmuteExcept: ['conductor'] },
    desc: '1회용: 지휘자를 제외한 보드의 모든 몬스터를 한 단계 높은 등급의 무작위 몬스터로 바꿈 (레벨·성장·영구 강화 유지). 지휘자의 완벽한 공연 보상',
  },
  {
    id: 'chaos_coin', name: '혼돈의 동전', grade: 3, triggers: [], passive: { transmute: true, transmuteMaxGrade: 2 },
    desc: '1회용: 보드의 일반·고급 몬스터 하나를 무작위로 골라 한 단계 높은 등급의 무작위 몬스터로 바꿈. 레벨·고른 성장·영구 강화는 그대로',
  },

  // ── 기원 (12일차 보스 보상 전용) ──
  {
    id: 'origin_heart', name: '기원의 심장', grade: 6, desc: '전투 시작: 아군 공격력 +100%, 최대 체력 +50%',
    triggers: [{
      on: 'battleStart', effects: [
        { type: 'atkPct', target: T.allies(), pct: 100 },
        { type: 'maxHpPct', pct: 50 },
      ],
    }],
  },
  {
    id: 'origin_loop', name: '영겁의 고리', grade: 6, desc: '전투 시작: 아군 전체 추가발동 +2',
    triggers: [{ on: 'battleStart', effects: [{ type: 'extra', target: T.allies(), amount: 2 }] }],
  },
];

export const TRINKET_MAP: Record<string, TrinketDef> = Object.fromEntries(TRINKETS.map((t) => [t.id, t]));

// 장신구 분류: 일회성(효과를 한 번 쓰면 사라짐) / 지속(가지고 있는 동안 계속). 효과에서 자동으로 정해진다
export function isOneShot(t: TrinketDef | undefined): boolean {
  const p = t?.passive;
  return !!(p?.upgradeOnBoard || p?.upgradeNextBuy || p?.transmute || p?.transmuteAll);
}
