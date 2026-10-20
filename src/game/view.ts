// 화면용 유닛 정보: 레벨·성장·영구 강화를 적용한 능력치와 설명. 터미널과 웹 카드가 함께 쓴다.

import { BALANCE } from '../config/balance.ts';
import { mulDiv } from '../core/num.ts';
import { abilityLines, segsText, statModsText, unitDesc } from '../data/describe.ts';
import type { DescStats } from '../data/describe.ts';
import { baseStats, computeUnit, findUnitGrowth, monsterName } from '../data/growth.ts';
import type { ComputedUnit } from '../data/growth.ts';
import type { UnitStats } from '../battle/types.ts';
import { findGrowth, LEADER_MAP, leaderPath } from '../data/leaders.ts';
import { MONSTER_MAP } from '../data/monsters.ts';
import { hasteInterval } from '../data/types.ts';
import type { GrowthDef, LeaderDef, MonsterDef, StatMods, Tag, Trigger } from '../data/types.ts';

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
  haste: number; // 가속 합계
  extra: number;
  desc: string;
  // 자동 설명이면 능력 목록과 계산용 능력치 (화면이 계수·계산값을 색으로 그린다). 손으로 쓴 설명이면 없음
  ability?: { triggers: Trigger[]; stats: DescStats };
  growthNames: string[];
  deploy?: number; // 보드에 있을 때 배치 인원 + (몬스터 통솔력)
  bonusText: string; // 영구 강화 요약 ("공격력 +3, 행동 간격 -10%"), 없으면 ''
  art?: string;
}

function view(def: MonsterDef | LeaderDef, level: number, levelPct: number, growths: GrowthDef[], isLeader: boolean, bonus?: StatMods): UnitView {
  const c = computeUnit(def, levelPct, growths, bonus);
  const auto = c.changedAbilities || !def.desc?.trim();
  const stats: DescStats = { atk: c.atk, power: c.power, hp: c.hp, level, healShieldPct: c.healShieldPct };
  return {
    name: def.name,
    level,
    isLeader,
    grade: 'grade' in def ? def.grade : undefined,
    tags: c.tags,
    hp: c.hp,
    atk: c.atk,
    power: c.power,
    intervalTicks: hasteInterval(def.intervalTicks, c.haste),
    haste: c.haste,
    extra: c.extra,
    // 성장으로 능력이 바뀌었거나 설명을 비워 두면 실제 능력에서 계산된 수치로 설명을 만든다
    desc: auto ? abilityLines(c.triggers, c.extra, stats).map(segsText).join(' ') : unitDesc(def),
    ability: auto ? { triggers: c.triggers, stats } : undefined,
    growthNames: growths.map((g) => g.name),
    bonusText: statModsText(bonus),
    art: def.art,
  };
}

export function monsterView(def: MonsterDef, level = 1, growthIds: string[] = [], bonus?: StatMods): UnitView {
  const growths = growthIds.map((id) => findUnitGrowth(def.id, id)).filter((g): g is GrowthDef => !!g);
  return { ...view(def, level, BALANCE.unit.levelStatPct[level - 1] ?? 100, growths, false, bonus), name: monsterName(def.id, growthIds), ...(def.deploy ? { deploy: def.deploy } : {}) };
}

export function leaderView(def: LeaderDef, level = 1, growthIds: string[] = [], bonus?: StatMods): UnitView {
  const growths = growthIds.map((id) => findGrowth(def.id, id)).filter((g): g is GrowthDef => !!g);
  const v = view(def, level, 100 + BALANCE.leader.statPctPerLevel * (level - 1), growths, true, bonus);
  return { ...v, name: leaderPath(def.id, growthIds)?.name ?? def.name }; // 전직한 리더는 전직 이름으로
}

export function statLine(v: UnitView): string {
  const tps = BALANCE.ticksPerSec;
  return `HP${v.hp} 공${v.atk}${v.power ? ` 주문${v.power}` : ''} ${(v.intervalTicks / tps).toFixed(1)}s${v.extra ? ` 추가${v.extra}` : ''}`;
}

// 보드에 있는 몬스터(리더 제외)의 태그별 수. 성장으로 바뀐 태그까지 반영한다.
// 리더 변신을 고를 때 "어느 쪽이 잘 모였나"를 보여 주고, 봇도 이걸 보고 고른다.
export function boardTagCounts(board: ({ defId: string; level: number; leader?: boolean; growth?: string[] } | null)[]): Map<Tag, number> {
  const counts = new Map<Tag, number>();
  for (const u of board) {
    const def = u && !u.leader ? MONSTER_MAP[u.defId] : undefined;
    if (!u || !def) continue;
    for (const t of monsterView(def, u.level, u.growth).tags) counts.set(t, (counts.get(t) ?? 0) + 1);
  }
  return counts;
}

// 변신 레벨 선택지가 맞추는 태그: 변신은 새로 얻는 태그, 본질 강화는 리더가 원래 가진 태그
export function pathTags(leaderId: string, g: GrowthDef | undefined): Tag[] {
  if (!g) return [];
  if (g.mastery && !g.transform) return LEADER_MAP[leaderId]?.tags ?? [];
  return g.addTags ?? [];
}

type EntryLike = { kind: 'leader' | 'monster'; defId: string; level: number; growth?: string[]; bonus?: StatMods };

// 보드 유닛 하나를 계산한 결과 (레벨·성장·영구 강화 반영, 칸 효과 전)
export function entryComputed(e: EntryLike, leaderGrowth: string[]): { def: MonsterDef | LeaderDef; c: ComputedUnit } | null {
  const isLeader = e.kind === 'leader';
  const def = isLeader ? LEADER_MAP[e.defId] : MONSTER_MAP[e.defId];
  if (!def) return null;
  const pct = isLeader ? 100 + BALANCE.leader.statPctPerLevel * (e.level - 1) : BALANCE.unit.levelStatPct[e.level - 1] ?? 100;
  const growths = (isLeader ? leaderGrowth.map((id) => findGrowth(e.defId, id)) : (e.growth ?? []).map((id) => findUnitGrowth(e.defId, id)))
    .filter((g): g is GrowthDef => !!g);
  return { def, c: computeUnit(def, pct, growths, e.bonus) };
}

// 보드 유닛 하나의 기본 능력치 (전투 엔진의 전투 전 값과 같다). 상세 보기에서 쓴다
export function entryBaseStats(e: EntryLike, leaderGrowth: string[]): UnitStats | null {
  const r = entryComputed(e, leaderGrowth);
  return r ? baseStats(r.def, r.c) : null;
}
