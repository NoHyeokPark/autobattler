// 성장 선택지 적용. 엔진(전투 능력치)과 화면(카드)이 같은 계산을 쓴다.
//  - 몬스터: Lv2가 될 때 (전용 성장 + 공용 성장) 중에서 하나를 고른다.
//    Lv3은 새로 고르지 않고 합성에 쓴 Lv2 3장의 성장을 모두 가진다 (반복 불가 성장은 하나만).
//  - 리더: 레벨업 일차마다 리더 성장 목록에서 하나를 고른다.

import { BALANCE } from '../config/balance.ts';
import { mulDiv } from '../core/num.ts';
import type { Rng } from '../core/rng.ts';
import { MONSTER_MAP } from './monsters.ts';
import type { GrowthDef, StatMods, Tag, Trigger, UnitDef } from './types.ts';

// 모든 몬스터가 공유하는 성장 선택지
export const UNIT_GROWTH: GrowthDef[] = [
  { id: 'u_might', name: '근력 강화', desc: '공격력 +25%', repeatable: true, stats: { atkPct: 25 } },
  { id: 'u_tough', name: '강인함', desc: '체력 +35%', repeatable: true, stats: { hpPct: 35 } },
  { id: 'u_arcane', name: '마력 증폭', desc: '주문력 +40%', repeatable: true, stats: { powerPct: 40 } },
  { id: 'u_swift', name: '날렵함', desc: '행동 간격 -12%', repeatable: true, stats: { intervalPct: -12 } },
  { id: 'u_double', name: '연속 행동', desc: '추가발동 +1, 대신 행동 간격 +40%', repeatable: false, stats: { extra: 1, intervalPct: 40 } },
  {
    id: 'u_growing', name: '자라나는 힘', desc: '새 능력: 전투 시작 시 자신 공격력 영구 +1', repeatable: false,
    triggers: [{ on: 'battleStart', effects: [{ type: 'permanent', target: { side: 'ally', area: 'near', dirs: ['c'] }, stat: 'atk', amount: 1 }] }],
  },
];

export function findUnitGrowth(defId: string, growthId: string): GrowthDef | undefined {
  return MONSTER_MAP[defId]?.growth?.find((g) => g.id === growthId) ?? UNIT_GROWTH.find((g) => g.id === growthId);
}

// 몬스터가 받을 수 있는 성장 전체 (전용이 같은 id의 공용보다 우선)
export function unitGrowthPool(defId: string): GrowthDef[] {
  const own = MONSTER_MAP[defId]?.growth ?? [];
  return [...own, ...UNIT_GROWTH.filter((g) => !own.some((o) => o.id === g.id))];
}

export function rollUnitGrowth(defId: string, taken: string[], rng: Rng): string[] {
  const pool = unitGrowthPool(defId).filter((g) => g.repeatable || !taken.includes(g.id));
  rng.shuffle(pool);
  return pool.slice(0, BALANCE.unit.growthChoices).map((g) => g.id);
}

// 이 레벨의 몬스터가 정상적으로 가질 수 있는 성장 개수 (Lv1 0, Lv2 1, Lv3 = Lv2 3장분 3)
export function maxGrowthCount(level: number): number {
  if (level <= 1) return 0;
  return BALANCE.unit.mergeCount * maxGrowthCount(level - 1) + (BALANCE.unit.growthChoiceLevels.includes(level) ? 1 : 0);
}

export interface ComputedUnit {
  hp: number;
  atk: number;
  power: number;
  intervalMul: number; // permille
  extra: number;
  healShieldPct: number;
  tags: Tag[];
  triggers: Trigger[];
  changedAbilities: boolean; // 성장으로 능력이 추가·제거됐는지 (카드 설명을 자동 생성할지)
}

// 높을수록 좋은지 (행동 간격은 낮을수록 좋다)
const LOWER_IS_BETTER: (keyof StatMods)[] = ['intervalPct'];

// 영구 강화 병합: 합산하지 않고 계열(키)별로 가장 좋은 값 하나만 남긴다.
// 예) 행동 간격 -10%, -15%, -5%인 Lv1 3장을 합성 → -15% (-30%가 되지 않는다)
// 없는 값은 0으로 본다. 그래서 불리한 값(공격력 -3 같은)은 강화가 없는 재료와 합치면 사라진다.
export function mergeBonus(list: (StatMods | undefined)[]): StatMods | undefined {
  const keys = new Set(list.flatMap((b) => Object.keys(b ?? {}))) as Set<keyof StatMods>;
  const out: StatMods = {};
  for (const k of keys) {
    const values = list.map((b) => b?.[k] ?? 0);
    const best = LOWER_IS_BETTER.includes(k) ? Math.min(...values) : Math.max(...values);
    if (best !== 0) out[k] = best;
  }
  return Object.keys(out).length ? out : undefined;
}

// 레벨 배율(levelPct %)을 적용한 기본 능력치에 성장과 영구 강화를 더한다. 고정값을 먼저 더하고 % 증감을 나중에 곱한다.
export function computeUnit(def: UnitDef, levelPct: number, growthList: GrowthDef[], bonus?: StatMods): ComputedUnit {
  // 영구 강화는 능력치만 바꾸는 성장처럼 계산한다
  const growths = bonus ? [...growthList, { id: '@bonus', name: '', desc: '', repeatable: false, stats: bonus }] : growthList;
  let hp = mulDiv(def.hp, levelPct, 100);
  let atk = mulDiv(def.atk, levelPct, 100);
  let power = mulDiv(def.power ?? 0, levelPct, 100);
  let intervalMul = 1000;
  let extra = def.extra ?? 0;
  let healShieldPct = 100;
  let atkPct = 0;
  let hpPct = 0;
  let powerPct = 0;
  const removed = new Set(growths.flatMap((g) => g.removeTriggers ?? []));
  const triggers = def.triggers.filter((_, i) => !removed.has(i));
  const tags = [...def.tags];
  let changedAbilities = removed.size > 0;
  for (const g of growths) {
    const s = g.stats ?? {};
    atk += s.atk ?? 0;
    hp += s.hp ?? 0;
    power += s.power ?? 0;
    extra += s.extra ?? 0;
    healShieldPct += s.healShieldPct ?? 0;
    atkPct += s.atkPct ?? 0;
    hpPct += s.hpPct ?? 0;
    powerPct += s.powerPct ?? 0;
    if (s.intervalPct) intervalMul = Math.max(1, mulDiv(intervalMul, 1000 + s.intervalPct * 10, 1000));
    if (g.triggers?.length) {
      triggers.push(...g.triggers);
      changedAbilities = true;
    }
    for (const t of g.removeTags ?? []) {
      const i = tags.indexOf(t);
      if (i >= 0) tags.splice(i, 1);
    }
    for (const t of g.addTags ?? []) if (!tags.includes(t)) tags.push(t);
  }
  return {
    hp: Math.max(1, mulDiv(hp, 100 + hpPct, 100)),
    atk: Math.max(0, mulDiv(atk, 100 + atkPct, 100)),
    power: Math.max(0, mulDiv(power, 100 + powerPct, 100)),
    intervalMul,
    extra: Math.max(0, extra),
    healShieldPct,
    tags,
    triggers,
    changedAbilities,
  };
}
