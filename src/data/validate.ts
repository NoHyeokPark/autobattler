// 모드 데이터 검증. errors가 있으면 적용하지 않는다. warnings는 적용은 되지만 확인이 필요한 것.

import type { TeamSnapshot } from '../battle/types.ts';
import type { RunState } from '../game/state.ts';
import { LEADER_MAP } from './leaders.ts';
import { MONSTER_MAP } from './monsters.ts';
import type { ModData } from './registry.ts';
import { TRINKET_MAP } from './trinkets.ts';
import { DIRS, inLevelRange, PERMANENT_STATS, SCALE_SOURCES, STATUS_IDS } from './types.ts';
import type { Effect, GrowthDef, LNum, Scale, Trigger, UnitFilter } from './types.ts';
import { GRADE_NAMES, MAX_GRADE } from './types.ts';

export interface Validation {
  errors: string[];
  warnings: string[];
}

const EFFECT_TYPES = ['damage', 'heal', 'shield', 'status', 'atkFlat', 'atkPct', 'powerFlat', 'powerPct', 'haste', 'extra', 'stun', 'maxHpPct', 'cleanse', 'dispel', 'consume', 'permanent', 'gold', 'trinket', 'mimic', 'conduct', 'hpCost'];
const AREAS = ['all', 'near', 'sameRow', 'sameCol'];
const STATUSES: string[] = STATUS_IDS;
const TRIGGER_ONS = ['battleStart', 'act', 'timer', 'lowHp', 'enemyLowHp', 'react'];
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
    if (f.kind && !['leader', 'monster'].includes(f.kind)) errors.push(`${where}: 유닛 종류는 리더 또는 몬스터`);
  };
  const scales = (list: Scale[] | undefined, where: string) => {
    for (const sc of list ?? []) {
      if (!SCALE_SOURCES.includes(sc.src)) errors.push(`${where}: 알 수 없는 비례 출처 "${sc.src}"`);
      lnum(sc.pct, `${where} 비례 %`, true);
      if ((sc.src === 'allyStatus' || sc.src === 'enemyStatus') && sc.status && !STATUSES.includes(sc.status)) errors.push(`${where}: 알 수 없는 상태 "${sc.status}"`);
      if (sc.tag && !tags.has(sc.tag)) warnings.push(`${where}: 등록되지 않은 태그 "${sc.tag}"`);
    }
  };
  const effect = (e: Effect, where: string) => {
    if (!EFFECT_TYPES.includes(e.type)) return errors.push(`${where}: 알 수 없는 효과 "${(e as { type: string }).type}"`);
    if ('scales' in e) scales(e.scales, where);
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
        if (e.powerPct === undefined && e.flat === undefined && !e.scales?.length) errors.push(`${where}: 주문력%·고정값·비례 중 하나가 필요합니다.`);
        break;
      case 'atkFlat': case 'powerFlat': case 'extra': filter(e.target, where); lnum(e.amount, `${where} 수치`, true); break;
      case 'atkPct': case 'powerPct': filter(e.target, where); lnum(e.pct, `${where} %`, true); break;
      case 'haste': filter(e.target, where); lnum(e.amount, `${where} 가속`, true); break;
      case 'stun': filter(e.target, where); lnum(e.ticks, `${where} 기절 tick`, true); break;
      case 'maxHpPct': lnum(e.pct, `${where} %`, true); break;
      case 'consume': {
        if (!STATUSES.includes(e.status)) errors.push(`${where}: 알 수 없는 상태 "${e.status}"`);
        lnum(e.cost, `${where} 소모량`, true);
        const costs = Array.isArray(e.cost) ? e.cost : [e.cost];
        if (costs.some((c) => c < 1)) errors.push(`${where}: 소모량은 1 이상`);
        if (!Array.isArray(e.effects)) { errors.push(`${where}: 소모 뒤 효과 목록이 없습니다.`); break; }
        if (e.effects.length === 0) warnings.push(`${where}: 소모만 하고 발동할 효과가 없습니다.`);
        e.effects.forEach((x, k) => {
          if (x.type === 'consume') errors.push(`${where} 안쪽 효과${k + 1}: 소모 안에 소모는 넣을 수 없습니다.`);
          else effect(x, `${where} 안쪽 효과${k + 1}`);
        });
        break;
      }
      case 'cleanse': case 'dispel': {
        lnum(e.pct, `${where} %`); lnum(e.flat, `${where} 고정값`);
        if (e.pct === undefined && e.flat === undefined) errors.push(`${where}: %나 고정값이 필요합니다.`);
        const pcts = e.pct === undefined ? [] : Array.isArray(e.pct) ? e.pct : [e.pct];
        if (pcts.some((p) => p > 50)) warnings.push(`${where}: 한 번에 50%보다 많이 지우면 상대 덱이 정화·해주 한 장에 무력해질 수 있습니다.`);
        break;
      }
      case 'permanent':
        filter(e.target, where);
        if (!PERMANENT_STATS.includes(e.stat)) errors.push(`${where}: 영구 강화 능력치가 올바르지 않습니다.`);
        lnum(e.amount, `${where} 수치`, true);
        if (e.target?.side === 'enemy') warnings.push(`${where}: 상대 유닛의 영구 강화는 이번 전투에만 적용됩니다 (상대는 기록이라 남지 않음).`);
        break;
      case 'gold': lnum(e.amount, `${where} 골드`, true); break;
      case 'hpCost': {
        lnum(e.pct, `${where} 체력 %`);
        lnum(e.flat, `${where} 체력 고정값`);
        if (!Array.isArray(e.effects)) { errors.push(`${where}: 체력 소모 뒤 효과 목록이 없습니다.`); break; }
        e.effects.forEach((x, k) => {
          if (x.type === 'hpCost' || x.type === 'consume') errors.push(`${where} 안쪽 효과${k + 1}: 체력 소모 안에 소모 효과는 넣을 수 없습니다.`);
          else effect(x, `${where} 안쪽 효과${k + 1}`);
        });
        break;
      }
      case 'conduct': {
        filter(e.target, where);
        lnum(e.goldPer, `${where} 1명당 골드`);
        if (e.trinketGrade !== undefined && (!isInt(e.trinketGrade) || e.trinketGrade < 1 || e.trinketGrade > MAX_GRADE)) errors.push(`${where}: 장신구 등급은 1~${MAX_GRADE}`);
        if (e.trinketPer !== undefined && (!isInt(e.trinketPer) || e.trinketPer < 1)) errors.push(`${where}: 몇 명마다는 1 이상의 정수`);
        if (e.perfectTrinket && !mod.trinkets.some((t) => t.id === e.perfectTrinket)) errors.push(`${where}: 완벽한 공연 장신구 "${e.perfectTrinket}"이(가) 없습니다.`);
        break;
      }
      case 'trinket': {
        lnum(e.grade, `${where} 등급`, true);
        lnum(e.count, `${where} 개수`);
        const grades = Array.isArray(e.grade) ? e.grade : [e.grade];
        if (grades.some((g) => g < 1 || g > MAX_GRADE)) errors.push(`${where}: 장신구 등급은 1~${MAX_GRADE}`);
        break;
      }
    }
  };
  const triggers = (list: Trigger[], where: string) => {
    if (!Array.isArray(list)) return errors.push(`${where}: 트리거 목록이 없습니다.`);
    list.forEach((t, i) => {
      const w = `${where} 트리거${i + 1}`;
      if (!TRIGGER_ONS.includes(t.on)) errors.push(`${w}: 시점이 올바르지 않습니다.`);
      if (t.on === 'timer' && !(isInt(t.atSec) && t.atSec! >= 0)) errors.push(`${w}: N초는 0 이상의 정수`);
      if (t.repeat && t.on !== 'timer') warnings.push(`${w}: "반복"은 전투 시작 후 N초 트리거에서만 동작합니다.`);
      if (t.on === 'timer' && t.repeat) {
        if (isInt(t.atSec) && t.atSec! < 1) errors.push(`${w}: 반복하려면 N초는 1 이상`);
        if (t.limit !== undefined && !(isInt(t.limit) && t.limit >= 1)) errors.push(`${w}: 최대 횟수는 1 이상의 정수`);
      }
      if ((t.on === 'lowHp' || t.on === 'enemyLowHp') && !(isInt(t.hpPct) && t.hpPct! >= 1 && t.hpPct! <= 99)) errors.push(`${w}: 체력 %는 1~99의 정수`);
      if (t.on === 'react') {
        if (!t.watch) errors.push(`${w}: 반응할 대상(지켜볼 유닛)이 없습니다.`);
        else filter(t.watch, `${w} 반응 대상`);
        if (t.every !== undefined && !(isInt(t.every) && t.every >= 1)) errors.push(`${w}: N번마다는 1 이상의 정수`);
        if (t.limit !== undefined && !(isInt(t.limit) && t.limit >= 1)) errors.push(`${w}: 최대 횟수는 1 이상의 정수`);
      }
      t.effects.forEach((e, j) => effect(e, `${w} 효과${j + 1}`));
      for (const k of t.onlyIn ?? []) if (k !== 'elite' && k !== 'boss') errors.push(`${w}: 노드 조건은 elite·boss만`);
      if (t.on !== 'react' && t.effects.some((e) => e.type === 'mimic')) warnings.push(`${w}: "따라 하기"는 반응 트리거에서만 동작합니다.`);
    });
  };
  const synergies = () => {
    const seen = new Set<string>();
    for (const sy of mod.synergies ?? []) {
      const w = `시너지 ${sy.name || sy.tag}`;
      if (!tags.has(sy.tag)) warnings.push(`${w}: 등록되지 않은 태그 "${sy.tag}"`);
      if (seen.has(sy.tag)) errors.push(`${w}: 같은 태그의 시너지가 두 개입니다.`);
      seen.add(sy.tag);
      let prev = 0;
      sy.tiers.forEach((t, i) => {
        if (!isInt(t.count) || t.count < 1) errors.push(`${w} ${i + 1}단계: 필요한 수는 1 이상의 정수`);
        else if (t.count <= prev) errors.push(`${w} ${i + 1}단계: 필요한 수가 앞 단계보다 커야 합니다.`);
        prev = t.count;
        triggers(t.triggers, `${w} ${i + 1}단계`);
      });
    }
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
      for (const k of ['minLevel', 'maxLevel'] as const) if (g[k] !== undefined && (!isInt(g[k]) || g[k]! < 1)) errors.push(`${w}: 등장 레벨은 1 이상의 정수`);
      if (g.minLevel !== undefined && g.maxLevel !== undefined && g.minLevel > g.maxLevel) errors.push(`${w}: 등장 레벨 구간이 비어 있습니다 (${g.minLevel} > ${g.maxLevel})`);
      for (const k of ['minGrade', 'maxGrade'] as const) if (g[k] !== undefined && (!isInt(g[k]) || g[k]! < 1 || g[k]! > MAX_GRADE)) errors.push(`${w}: 등장 등급은 1~${MAX_GRADE}`);
      if (g.minGrade !== undefined && g.maxGrade !== undefined && g.minGrade > g.maxGrade) errors.push(`${w}: 등장 등급 구간이 비어 있습니다`);
      for (const t of g.forTags ?? []) if (!tags.has(t)) warnings.push(`${w}: 등장 조건에 등록되지 않은 태그 "${t}"`);
    }
  };

  ids(mod.monsters, '몬스터');
  ids(mod.leaders, '리더');
  ids(mod.trinkets, '장신구');
  growth(mod.unitGrowth ?? [], '공용');
  growth(mod.eventGrowth ?? [], '리더 이벤트');
  for (const g of mod.eventGrowth ?? []) if (g.removeTriggers?.length) warnings.push(`리더 이벤트 성장 ${g.name}: 리더마다 기본 능력이 달라 '기본 능력 제거'는 쓰지 않는 것이 좋습니다.`);
  // 이벤트: 선택지가 있고, 결과가 가리키는 장신구·몬스터·성장이 있고, 등급·수치가 올바른지
  ids(mod.events ?? [], '이벤트');
  const trinketIds = new Set(mod.trinkets.map((t) => t.id));
  const monsterIds = new Set(mod.monsters.map((m) => m.id));
  const eventGrowthIds = new Set((mod.eventGrowth ?? []).map((g) => g.id));
  for (const ev of mod.events ?? []) {
    const w = `이벤트 ${ev.name || ev.id}`;
    if (!ev.text?.trim()) warnings.push(`${w}: 상황 글이 비어 있습니다.`);
    if (!ev.choices?.length) errors.push(`${w}: 선택지가 없습니다.`);
    if (ev.minDay !== undefined && ev.maxDay !== undefined && ev.minDay > ev.maxDay) errors.push(`${w}: 등장 일차 구간이 비어 있습니다.`);
    if (ev.weight !== undefined && !(ev.weight >= 0)) errors.push(`${w}: 등장 비율은 0 이상`);
    if (ev.choices?.length && ev.choices.every((c) => c.cost)) warnings.push(`${w}: 모든 선택지에 골드가 필요해서 골드가 모자라면 이 이벤트는 나오지 않습니다.`);
    (ev.choices ?? []).forEach((c, ci) => {
      const cw = `${w} 선택지${ci + 1}`;
      if (!c.text?.trim()) errors.push(`${cw}: 글이 비어 있습니다.`);
      if (c.cost !== undefined && !(isInt(c.cost) && c.cost >= 0)) errors.push(`${cw}: 골드 비용은 0 이상의 정수`);
      for (const o of c.outcomes ?? []) {
        if ((o.type === 'trinket' || o.type === 'monster') && o.id && !(o.type === 'trinket' ? trinketIds : monsterIds).has(o.id)) errors.push(`${cw}: 없는 ${o.type === 'trinket' ? '장신구' : '몬스터'} "${o.id}"`);
        if ((o.type === 'trinket' || o.type === 'monster') && o.grade !== undefined && !(isInt(o.grade) && o.grade >= 1 && o.grade <= MAX_GRADE)) errors.push(`${cw}: 등급은 1~${MAX_GRADE}`);
        if ((o.type === 'trinket' || o.type === 'monster') && o.choices !== undefined && !(isInt(o.choices) && o.choices >= 1)) errors.push(`${cw}: 고르기 수는 1 이상의 정수`);
        if (o.type === 'growth' && o.id && !eventGrowthIds.has(o.id)) errors.push(`${cw}: 리더 이벤트 성장에 없는 "${o.id}"`);
        if ((o.type === 'gold' || o.type === 'life' || o.type === 'leaderStat') && !isInt(o.amount)) errors.push(`${cw}: 수치는 정수`);
        if (o.type === 'leaderStat' && !['atk', 'power', 'hp', 'haste'].includes(o.stat)) errors.push(`${cw}: 리더 능력치가 올바르지 않습니다.`);
      }
    });
  }
  const maxGrade = MAX_GRADE;
  for (const m of mod.monsters) {
    const w = `몬스터 ${m.name || m.id}`;
    if (!isInt(m.grade) || m.grade < 1 || m.grade > maxGrade) errors.push(`${w}: 등급은 1~${MAX_GRADE}`);
    if (!isInt(m.hp) || m.hp < 1) errors.push(`${w}: 체력은 1 이상의 정수`);
    if (!isInt(m.atk) || m.atk < 0) errors.push(`${w}: 공격력은 0 이상의 정수`);
    if (m.power !== undefined && (!isInt(m.power) || m.power < 0)) errors.push(`${w}: 주문력은 0 이상의 정수`);
    if (!isInt(m.intervalTicks) || m.intervalTicks < 1) errors.push(`${w}: 행동 간격은 1 tick 이상`);
    if (m.extra !== undefined && (!isInt(m.extra) || m.extra < 0)) errors.push(`${w}: 추가발동은 0 이상의 정수`);
    if (m.deploy !== undefined && (!isInt(m.deploy) || m.deploy < 0)) errors.push(`${w}: 통솔력은 0 이상의 정수`);
    for (const t of m.tags) if (!tags.has(t)) warnings.push(`${w}: 등록되지 않은 태그 "${t}"`);
    triggers(m.triggers, w);
    growth(m.growth ?? [], w, m.triggers.length);
    if (m.promotions?.length) {
      growth(m.promotions, `${w} 전직`, m.triggers.length);
      ids([...(m.growth ?? []), ...m.promotions], `${w} 성장·전직`);
      for (const g of m.promotions) if (g.minLevel !== undefined || g.maxLevel !== undefined) warnings.push(`${w}: 전직 "${g.name}"의 등장 레벨은 쓰이지 않습니다 (전직은 Lv${mod.balance.unit.maxLevel}에 반드시).`);
    }
    for (const g of m.growth ?? []) if (g.transform || g.mastery) warnings.push(`${w}: 성장 "${g.name}"의 변신·본질 강화 표시는 리더 성장에서만 쓰입니다 (몬스터는 무시).`);
    const usesPower = JSON.stringify([m.triggers, m.growth ?? []]).includes('"powerPct"');
    if (usesPower && !m.power && !(m.growth ?? []).some((g) => g.stats?.power)) warnings.push(`${w}: 주문력 % 효과가 있지만 주문력이 0입니다.`);
  }
  // 변이로 다른 몬스터가 되어도 성장을 id로 찾으므로, 몬스터 전용 성장 id는 서로(그리고 공용과) 겹치지 않아야 한다
  const growthOwner = new Map<string, string>();
  for (const g of mod.unitGrowth ?? []) growthOwner.set(g.id, '공용');
  for (const m of mod.monsters) {
    for (const g of m.growth ?? []) {
      const prev = growthOwner.get(g.id);
      if (prev && prev !== m.name) warnings.push(`성장 id "${g.id}"가 ${prev}와 ${m.name}에 겹칩니다 (변이한 유닛의 성장이 다른 것으로 바뀔 수 있음)`);
      else growthOwner.set(g.id, m.name);
    }
  }
  if (!mod.monsters.some((m) => m.grade === 1 && m.shop !== false)) errors.push('상점에 나오는 일반(1등급) 몬스터가 최소 하나 있어야 합니다 (상점 기본 풀).');
  // 상점 확률이 있는 등급인데 몬스터가 없으면 가까운 등급으로 대신 나온다
  for (let g = 2; g <= maxGrade; g++) {
    if (mod.monsters.some((m) => m.grade === g && m.shop !== false)) continue;
    if (mod.balance.shop.odds.some((row) => (row[g - 1] ?? 0) > 0)) warnings.push(`상점에 나오는 ${GRADE_NAMES[g]}(${g}등급) 몬스터가 없는데 상점 확률표에 확률이 있습니다. 이 칸은 무시되고 나머지 등급 비율대로 뽑힙니다.`);
  }

  if (mod.leaders.length === 0) errors.push('리더가 최소 한 명 있어야 합니다.');
  for (const l of mod.leaders) {
    const w = `리더 ${l.name || l.id}`;
    if (!isInt(l.hp) || l.hp < 1) errors.push(`${w}: 체력은 1 이상의 정수`);
    if (!isInt(l.atk) || l.atk < 0) errors.push(`${w}: 공격력은 0 이상의 정수`);
    if (l.power !== undefined && (!isInt(l.power) || l.power < 0)) errors.push(`${w}: 주문력은 0 이상의 정수`);
    if (!isInt(l.intervalTicks) || l.intervalTicks < 1) errors.push(`${w}: 행동 간격은 1 tick 이상`);
    triggers(l.triggers, w);
    const promotions = l.promotions ?? [];
    growth(l.growth, w, l.triggers.length);
    growth(promotions, `${w} 전직`, l.triggers.length);
    ids([...l.growth, ...promotions], `${w} 성장·전직`);
    if (l.growth.length < mod.balance.leader.growthChoices) warnings.push(`${w}: 성장 선택지가 ${mod.balance.leader.growthChoices}개보다 적습니다.`);
    const maxLeaderLevel = 1 + mod.balance.leader.levelUpDays.length;
    for (let lv = 2; lv <= maxLeaderLevel; lv++) {
      if (mod.balance.leader.promotionLevels.includes(lv) && promotions.length > 0) continue;
      const n = l.growth.filter((g) => inLevelRange(g, lv)).length;
      if (n < mod.balance.leader.growthChoices) warnings.push(`${w}: 리더 Lv${lv}에 나올 수 있는 성장이 ${n}개뿐입니다 (등장 레벨 구간 확인).`);
    }
    for (const g of l.growth) if (g.transform || g.mastery) warnings.push(`${w}: 성장 "${g.name}"에 변신·본질 강화 표시가 있지만 일반 성장 목록에 있습니다 (전직 목록으로 옮기세요).`);
    const forms = promotions.filter((g) => !g.mastery).length;
    const masteries = promotions.filter((g) => g.mastery).length;
    if (forms > 0 && masteries === 0) warnings.push(`${w}: 본질 강화가 없어 전직 때 변신만 제시됩니다 (원래 덱을 유지할 길이 없음).`);
    if (masteries > 1) warnings.push(`${w}: 본질 강화가 ${masteries}개입니다. 고정 자리에는 첫 번째만 나오고 나머지는 변신 자리에 섞입니다.`);
    if (promotions.length === 1) warnings.push(`${w}: 전직이 1개뿐이라 고를 것 없이 그것만 제시됩니다.`);
  }
  synergies();
  for (const t of mod.trinkets) {
    const w = `장신구 ${t.name || t.id}`;
    if (!isInt(t.grade) || t.grade < 1 || t.grade > maxGrade) errors.push(`${w}: 등급은 1~${MAX_GRADE}`);
    const tmg = t.passive?.transmuteMaxGrade;
    if (tmg !== undefined && (!isInt(tmg) || tmg < 1 || tmg > maxGrade)) errors.push(`${w}: 변이 대상 등급 상한은 1~${MAX_GRADE}`);
    triggers(t.triggers, w);
    if (t.triggers.some((x) => x.on === 'act')) warnings.push(`${w}: 장신구는 행동하지 않으므로 "행동할 때마다" 트리거는 발동하지 않습니다.`);
    // 장신구의 위치 기준 대상(주변·같은 행·열)은 보드 중앙(2행 2열)이 기준 칸이다
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
  if (b.economy.monsterCost.length < maxGrade) errors.push(`몬스터 가격은 ${maxGrade}개(일반~기원) 필요`);
  if (b.economy.trinketCost.length < maxGrade) errors.push(`장신구 가격은 ${maxGrade}개(일반~기원) 필요`);
  if (b.engine.minIntervalTicks < 1) errors.push('최소 행동 간격은 1 tick 이상');
  if (b.suddenDeath.ratioDen < 1) errors.push('서든데스 등비 분모는 1 이상');
  for (const [id, cfg] of Object.entries(b.statuses)) {
    const c = cfg as { name: string; periodTicks: number; erodeStatus?: string; erodePct?: number };
    if (c.erodeStatus && !STATUSES.includes(c.erodeStatus)) errors.push(`팀 상태 ${c.name}: 줄일 상태 "${c.erodeStatus}"가 없습니다.`);
    if (c.erodeStatus === id) warnings.push(`팀 상태 ${c.name}: 자기 자신을 줄입니다 (감쇠 설정을 쓰는 게 낫습니다).`);
    if (c.erodeStatus && (c.erodePct ?? 0) > 0 && c.periodTicks <= 0) warnings.push(`팀 상태 ${c.name}: 주기 효과가 없어서(주기 0) 상호작용이 일어나지 않습니다.`);
  }
  b.shop.odds.forEach((row, i) => {
    const sum = row.reduce((a, x) => a + x, 0);
    if (row.length !== maxGrade) errors.push(`상점 확률표 ${i + 1}라운드: ${maxGrade}칸(일반~기원) 필요`);
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
