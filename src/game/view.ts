// 화면용 유닛 정보: 레벨·성장·영구 강화를 적용한 능력치와 설명. 터미널과 웹 카드가 함께 쓴다.

import { BALANCE } from '../config/balance.ts';
import { mulDiv } from '../core/num.ts';
import { describeTriggers, statModsText, unitDesc } from '../data/describe.ts';
import { computeUnit, findUnitGrowth } from '../data/growth.ts';
import { findGrowth } from '../data/leaders.ts';
import type { GrowthDef, LeaderDef, MonsterDef, StatMods, Tag } from '../data/types.ts';

export interface UnitView {
  name: string;
  level: number;
  isLeader: boolean;
  grade?: number;
  tags: Tag[];
  hp: number;
  atk: number;
  power: number;
  intervalTicks: number;
  extra: number;
  desc: string;
  growthNames: string[];
  bonusText: string; // 영구 강화 요약 ("공격력 +3, 행동 간격 -10%"), 없으면 ''
  art?: string;
}

function view(def: MonsterDef | LeaderDef, level: number, levelPct: number, growths: GrowthDef[], isLeader: boolean, bonus?: StatMods): UnitView {
  const c = computeUnit(def, levelPct, growths, bonus);
  return {
    name: def.name,
    level,
    isLeader,
    grade: 'grade' in def ? def.grade : undefined,
    tags: c.tags,
    hp: c.hp,
    atk: c.atk,
    power: c.power,
    intervalTicks: mulDiv(def.intervalTicks, c.intervalMul, 1000),
    extra: c.extra,
    // 성장으로 능력이 바뀌었으면 손으로 쓴 설명 대신 실제 능력에서 설명을 만든다
    desc: c.changedAbilities ? describeTriggers(c.triggers, c.extra) : unitDesc(def),
    growthNames: growths.map((g) => g.name),
    bonusText: statModsText(bonus),
    art: def.art,
  };
}

export function monsterView(def: MonsterDef, level = 1, growthIds: string[] = [], bonus?: StatMods): UnitView {
  const growths = growthIds.map((id) => findUnitGrowth(def.id, id)).filter((g): g is GrowthDef => !!g);
  return view(def, level, BALANCE.unit.levelStatPct[level - 1] ?? 100, growths, false, bonus);
}

export function leaderView(def: LeaderDef, level = 1, growthIds: string[] = [], bonus?: StatMods): UnitView {
  const growths = growthIds.map((id) => findGrowth(def.id, id)).filter((g): g is GrowthDef => !!g);
  return view(def, level, 100 + BALANCE.leader.statPctPerLevel * (level - 1), growths, true, bonus);
}

export function statLine(v: UnitView): string {
  const tps = BALANCE.ticksPerSec;
  return `HP${v.hp} 공${v.atk}${v.power ? ` 주문${v.power}` : ''} ${(v.intervalTicks / tps).toFixed(1)}s${v.extra ? ` 추가${v.extra}` : ''}`;
}
