// 모드 데이터 검증. errors가 있으면 적용하지 않는다. warnings는 적용은 되지만 확인이 필요한 것.

import type { TeamSnapshot } from '../battle/types.ts';
import type { RunState } from '../game/state.ts';
import { LEADER_MAP } from './leaders.ts';
import { MONSTER_MAP } from './monsters.ts';
import type { ModData } from './registry.ts';
import { TRINKET_MAP } from './trinkets.ts';
import { DIRS, PERMANENT_STATS } from './types.ts';
import type { Effect, GrowthDef, LNum, Trigger, UnitFilter } from './types.ts';

export interface Validation {
  errors: string[];
  warnings: string[];
}

const EFFECT_TYPES = ['damage', 'heal', 'shield', 'status', 'atkFlat', 'atkPct', 'powerFlat', 'powerPct', 'intervalPct', 'extra', 'stun', 'maxHpPct', 'permanent', 'gold', 'trinket'];
const AREAS = ['all', 'near', 'sameRow', 'sameCol'];
const STATUSES = ['poison', 'regen', 'fury'];
// 소수가 허용되는 수치 경로 (나머지 수치는 엔진이 정수로 계산하므로 정수만)
const FRACTION_OK = [/^rank\./];

const isInt = (v: unknown) => typeof v === 'number' && Number.isInteger(v);

export function validateMod(mod: ModData): Validation {
  const errors: string[] = [];
  const warnings: string[] = [];
  const tags = new Set(mod.tags);

  const lnum = (v: LNum | undefined, where: string, required = false) => {
    if (v === undefined) {
      if (required) errors.push(`${where}: 값이 필요합니다.`);
      return;
    }
    const arr = Array.isArray(v) ? v : [v];
    if (arr.length === 0 || arr.some((x) => !isInt(x))) errors.push(`${where}: 정수 또는 "1/2/3" 형태의 정수여야 합니다.`);
  };
  const filter = (f: UnitFilter, where: string) => {
    if (!f || !['ally', 'enemy'].includes(f.side) || !AREAS.includes(f.area)) return errors.push(`${where}: 대상 지정이 올바르지 않습니다.`);
    if (f.area === 'near') {
      if (!f.dirs?.length) errors.push(`${where}: 방향을 하나 이상 고르세요.`);
      else if (f.dirs.some((d) => !DIRS.includes(d))) errors.push(`${where}: 알 수 없는 방향`);
    }
    if (f.tag && !tags.has(f.tag)) warnings.push(`${where}: 등록되지 않은 태그 "${f.tag}"`);
    for (const k of ['row', 'col'] as const) if (f[k] !== undefined && ![1, 2, 3].includes(f[k]!)) errors.push(`${where}: ${k}는 1~3`);
  };
  const effect = (e: Effect, where: string) => {
    if (!EFFECT_TYPES.includes(e.type)) return errors.push(`${where}: 알 수 없는 효과 "${(e as { type: string }).type}"`);
    switch (e.type) {
      case 'damage': case 'heal':
        lnum(e.atkPct, `${where} 공격력%`); lnum(e.powerPct, `${where} 주문력%`); lnum(e.flat, `${where} 고정값`);
        break;
      case 'shield':
        lnum(e.atkPct, `${where} 공격력%`); lnum(e.powerPct, `${where} 주문력%`); lnum(e.hpPct, `${where} 체력%`); lnum(e.flat, `${where} 고정값`);
        break;
      case 'status':
        if (!STATUSES.includes(e.status)) errors.push(`${where}: 알 수 없는 상태 "${e.status}"`);
        lnum(e.powerPct, `${where} 주문력%`);
        lnum(e.flat, `${where} 고정값`);
        if (e.powerPct === undefined && e.flat === undefined) errors.push(`${where}: 주문력% 또는 고정값이 필요합니다.`);
        break;
      case 'atkFlat': case 'powerFlat': case 'extra': filter(e.target, where); lnum(e.amount, `${where} 수치`, true); break;
      case 'atkPct': case 'powerPct': case 'intervalPct': filter(e.target, where); lnum(e.pct, `${where} %`, true); break;
      case 'stun': filter(e.target, where); lnum(e.ticks, `${where} 기절 tick`, true); break;
      case 'maxHpPct': lnum(e.pct, `${where} %`, true); break;
      case 'permanent':
        filter(e.target, where);
        if (!PERMANENT_STATS.includes(e.stat)) errors.push(`${where}: 영구 강화 능력치가 올바르지 않습니다.`);
        lnum(e.amount, `${where} 수치`, true);
        if (e.target?.side === 'enemy') warnings.push(`${where}: 상대 유닛의 영구 강화는 이번 전투에만 적용됩니다 (상대는 기록이라 남지 않음).`);
        break;
      case 'gold': lnum(e.amount, `${where} 골드`, true); break;
      case 'trinket': {
        lnum(e.grade, `${where} 등급`, true);
        lnum(e.count, `${where} 개수`);
        const grades = Array.isArray(e.grade) ? e.grade : [e.grade];
        if (grades.some((g) => g < 1 || g > 6)) errors.push(`${where}: 장신구 등급은 1~6`);
        break;
      }
    }
  };
  const triggers = (list: Trigger[], where: string) => {
    if (!Array.isArray(list)) return errors.push(`${where}: 트리거 목록이 없습니다.`);
    list.forEach((t, i) => {
      const w = `${where} 트리거${i + 1}`;
      if (!['battleStart', 'act', 'timer'].includes(t.on)) errors.push(`${w}: 시점이 올바르지 않습니다.`);
      if (t.on === 'timer' && !(isInt(t.atSec) && t.atSec! >= 0)) errors.push(`${w}: N초는 0 이상의 정수`);
      t.effects.forEach((e, j) => effect(e, `${w} 효과${j + 1}`));
    });
  };
  const ids = (list: { id: string }[], kind: string) => {
    const seen = new Set<string>();
    for (const x of list) {
      if (!x.id?.trim()) errors.push(`${kind}: id가 비어 있습니다.`);
      else if (seen.has(x.id)) errors.push(`${kind}: id "${x.id}" 중복`);
      seen.add(x.id);
    }
  };
  // baseTriggerCount: 이 성장이 붙는 유닛의 기본 능력 수 (공용 성장은 undefined)
  const growth = (list: GrowthDef[], where: string, baseTriggerCount?: number) => {
    ids(list, `${where} 성장`);
    for (const g of list) {
      const w = `${where} 성장 ${g.name || g.id}`;
      if (g.triggers) triggers(g.triggers, w);
      for (const k of Object.values(g.stats ?? {})) if (k !== undefined && !isInt(k)) errors.push(`${w}: 능력치 변화는 정수`);
      for (const i of g.removeTriggers ?? []) {
        if (!isInt(i) || i < 0) errors.push(`${w}: 제거할 능력 번호가 올바르지 않습니다.`);
        else if (baseTriggerCount !== undefined && i >= baseTriggerCount) warnings.push(`${w}: 능력 ${i + 1}이(가) 없어 제거할 것이 없습니다.`);
      }
      for (const t of [...(g.addTags ?? []), ...(g.removeTags ?? [])]) if (!tags.has(t)) warnings.push(`${w}: 등록되지 않은 태그 "${t}"`);
    }
  };

  ids(mod.monsters, '몬스터');
  ids(mod.leaders, '리더');
  ids(mod.trinkets, '장신구');
  growth(mod.unitGrowth ?? [], '공용');
  const maxGrade = 6;
  for (const m of mod.monsters) {
    const w = `몬스터 ${m.name || m.id}`;
    if (!isInt(m.grade) || m.grade < 1 || m.grade > maxGrade) errors.push(`${w}: 등급은 1~6`);
    if (!isInt(m.hp) || m.hp < 1) errors.push(`${w}: 체력은 1 이상의 정수`);
    if (!isInt(m.atk) || m.atk < 0) errors.push(`${w}: 공격력은 0 이상의 정수`);
    if (m.power !== undefined && (!isInt(m.power) || m.power < 0)) errors.push(`${w}: 주문력은 0 이상의 정수`);
    if (!isInt(m.intervalTicks) || m.intervalTicks < 1) errors.push(`${w}: 행동 간격은 1 tick 이상`);
    if (m.extra !== undefined && (!isInt(m.extra) || m.extra < 0)) errors.push(`${w}: 추가발동은 0 이상의 정수`);
    for (const t of m.tags) if (!tags.has(t)) warnings.push(`${w}: 등록되지 않은 태그 "${t}"`);
    triggers(m.triggers, w);
    growth(m.growth ?? [], w, m.triggers.length);
    const usesPower = JSON.stringify([m.triggers, m.growth ?? []]).includes('"powerPct"');
    if (usesPower && !m.power && !(m.growth ?? []).some((g) => g.stats?.power)) warnings.push(`${w}: 주문력 % 효과가 있지만 주문력이 0입니다.`);
  }
  if (!mod.monsters.some((m) => m.grade === 1)) errors.push('일반(1등급) 몬스터가 최소 하나 있어야 합니다 (상점 기본 풀).');
  for (let g = 2; g <= 5; g++) if (!mod.monsters.some((m) => m.grade === g)) warnings.push(`${g}등급 몬스터가 없습니다. 해당 등급이 뽑히면 일반 몬스터가 대신 나옵니다.`);

  if (mod.leaders.length === 0) errors.push('리더가 최소 한 명 있어야 합니다.');
  for (const l of mod.leaders) {
    const w = `리더 ${l.name || l.id}`;
    if (!isInt(l.hp) || l.hp < 1) errors.push(`${w}: 체력은 1 이상의 정수`);
    if (!isInt(l.atk) || l.atk < 0) errors.push(`${w}: 공격력은 0 이상의 정수`);
    if (l.power !== undefined && (!isInt(l.power) || l.power < 0)) errors.push(`${w}: 주문력은 0 이상의 정수`);
    if (!isInt(l.intervalTicks) || l.intervalTicks < 1) errors.push(`${w}: 행동 간격은 1 tick 이상`);
    triggers(l.triggers, w);
    growth(l.growth, w, l.triggers.length);
    if (l.growth.length < mod.balance.leader.growthChoices) warnings.push(`${w}: 성장 선택지가 ${mod.balance.leader.growthChoices}개보다 적습니다.`);
  }
  for (const t of mod.trinkets) {
    const w = `장신구 ${t.name || t.id}`;
    if (!isInt(t.grade) || t.grade < 1 || t.grade > maxGrade) errors.push(`${w}: 등급은 1~6`);
    triggers(t.triggers, w);
    if (t.triggers.some((x) => x.on === 'act')) warnings.push(`${w}: 장신구는 행동하지 않으므로 "행동할 때마다" 트리거는 발동하지 않습니다.`);
    if (JSON.stringify(t.triggers).match(/"area":"(near|sameRow|sameCol)"/)) warnings.push(`${w}: 장신구는 칸이 없어서 위치 기준 대상(주변·같은 행·열)은 비어 있게 됩니다.`);
  }

  // 밸런스 수치
  const walk = (v: unknown, path: string) => {
    if (typeof v === 'number') {
      if (!Number.isFinite(v)) errors.push(`수치 ${path}: 숫자가 아닙니다.`);
      else if (!Number.isInteger(v) && !FRACTION_OK.some((r) => r.test(path))) errors.push(`수치 ${path}: 정수여야 합니다.`);
    } else if (Array.isArray(v)) v.forEach((x, i) => walk(x, `${path}[${i}]`));
    else if (v && typeof v === 'object') for (const [k, x] of Object.entries(v)) walk(x, path ? `${path}.${k}` : k);
  };
  walk(mod.balance, '');
  const b = mod.balance;
  if (b.board.maxDeploy > 9 || b.board.maxDeploy < 1) errors.push('최대 배치 인원은 1~9');
  if (b.board.initialDeployLimit > b.board.maxDeploy) errors.push('시작 배치 인원이 최대 배치 인원보다 큽니다.');
  if (b.board.benchSize < 1) errors.push('벤치는 1칸 이상');
  if (b.unit.levelStatPct.length < b.unit.maxLevel) errors.push('레벨별 능력치 배율 개수가 최대 레벨보다 적습니다.');
  if (b.economy.monsterCost.length < maxGrade) errors.push('몬스터 가격은 6개(일반~기원) 필요');
  if (b.economy.trinketCost.length < maxGrade) errors.push('장신구 가격은 6개(일반~기원) 필요');
  if (b.engine.minIntervalTicks < 1) errors.push('최소 행동 간격은 1 tick 이상');
  if (b.suddenDeath.ratioDen < 1) errors.push('서든데스 등비 분모는 1 이상');
  b.shop.odds.forEach((row, i) => {
    const sum = row.reduce((a, x) => a + x, 0);
    if (row.length !== maxGrade) errors.push(`상점 확률표 ${i + 1}라운드: 6칸(일반~기원) 필요`);
    if (sum <= 0) errors.push(`상점 확률표 ${i + 1}라운드: 합이 0`);
    else if (sum !== 100) warnings.push(`상점 확률표 ${i + 1}라운드: 합이 ${sum}% (100이 아님, 비율로 처리)`);
  });
  return { errors, warnings };
}

// 현재 데이터 기준으로 스냅샷(기록)이 재현 가능한지
export function snapshotValid(team: TeamSnapshot): boolean {
  if (!LEADER_MAP[team.leaderId]) return false;
  if (team.trinkets.some((id) => !TRINKET_MAP[id])) return false;
  return team.board.every((e) => (e.kind === 'leader' ? LEADER_MAP[e.defId] : MONSTER_MAP[e.defId]));
}

// 진행 중인 런이 현재 데이터에서 없는 id를 쓰는지
export function runIssues(s: RunState): string[] {
  const issues: string[] = [];
  if (!LEADER_MAP[s.leaderId]) issues.push(`리더 ${s.leaderId}`);
  for (const u of [...s.board, ...s.bench]) if (u && !u.leader && !MONSTER_MAP[u.defId]) issues.push(`몬스터 ${u.defId}`);
  for (const id of s.trinkets) if (!TRINKET_MAP[id]) issues.push(`장신구 ${id}`);
  for (const item of s.shop) if (item && !(item.kind === 'monster' ? MONSTER_MAP[item.defId] : TRINKET_MAP[item.defId])) issues.push(`상점 ${item.defId}`);
  return issues;
}
