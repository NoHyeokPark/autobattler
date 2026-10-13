import { T } from './targets.ts';
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
    id: 'hourglass', name: '모래시계', grade: 3, desc: '전투 시작: 아군 전체 행동 간격 -10%',
    triggers: [{ on: 'battleStart', effects: [{ type: 'intervalPct', target: T.allies(), pct: -10 }] }],
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
