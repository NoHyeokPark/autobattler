// 트리거 데이터에서 사람이 읽는 설명을 만든다. 카드 설명이 비어 있을 때와 에디터의 "자동 설명"에 쓴다.

import { BALANCE } from '../config/balance.ts';
import { lv } from '../core/num.ts';
import { GRADE_NAMES } from './types.ts';
import { TRINKET_MAP } from './trinkets.ts';
import type { Dir, Effect, GrowthDef, LNum, Scale, ScaleSource, StatMods, StatusId, Trigger, UnitDef, UnitFilter, UnitKind } from './types.ts';

// 목적격 조사 (받침 있으면 "을", 없으면 "를")
export function withEul(word: string): string {
  const code = word.charCodeAt(word.length - 1) - 0xac00;
  if (code < 0 || code > 11171) return `${word}을(를)`;
  return `${word}${code % 28 ? '을' : '를'}`;
}

export type StatusCfg = (typeof BALANCE.statuses)[StatusId];

// 팀 상태가 하는 일. 수치는 설정(cfg)에서 읽으므로 에디터에서 고치는 중인 값으로도 부를 수 있다.
export function describeStatus(id: StatusId, cfg: StatusCfg = BALANCE.statuses[id]): string {
  if (!cfg) return id;
  const per = cfg.perStack === 1 ? '중첩' : `중첩 × ${cfg.perStack}`;
  const parts: string[] = [];
  if (cfg.periodTicks > 0) {
    const sec = cfg.periodTicks / BALANCE.ticksPerSec;
    const every = sec === 1 ? '매초' : `${sec}초마다`;
    parts.push(cfg.harmful
      ? `걸린 팀이 ${every} ${per}만큼 피해${cfg.bypassShield ? ' (실드 무시)' : ''}`
      : `${every} ${per}만큼 팀 체력 회복`);
    if (cfg.decay === 'minus1') parts.push('효과 후 중첩 1 감소');
    else if (cfg.decay === 'half') parts.push('효과 후 중첩 절반으로 감소');
    else parts.push('중첩은 줄지 않음');
  }
  const eroded = (cfg as { erodeStatus?: string }).erodeStatus as StatusId | undefined;
  const erodePct = (cfg as { erodePct?: number }).erodePct ?? 0;
  if (cfg.periodTicks > 0 && cfg.harmful && (cfg as { maxHpLoss?: boolean }).maxHpLoss) parts.push('들어간 피해만큼 최대 체력도 줄어듦 (이번 전투 동안, 회복으로 못 되돌림)');
  if (cfg.periodTicks > 0 && eroded && erodePct > 0) parts.push(`터질 때마다 같은 팀의 ${withEul(BALANCE.statuses[eroded]?.name ?? eroded)} 중첩 × ${erodePct}%만큼 줄임`);
  if (id === 'fury') parts.push(`아군 유닛의 피해 효과마다 피해 + ${per}`);
  if (id === 'thorns') {
    parts.push(`상대 유닛의 피해 효과를 받을 때마다 공격한 쪽에 ${per}만큼 피해${cfg.bypassShield ? ' (실드 무시)' : ''}`);
    parts.push('자주·여러 번 때리는 상대를 견제');
  }
  if (parts.length === 0 && !cfg.harmful) return '그 자체로는 효과가 없는 자원. "상태 소모" 효과로 쌓인 중첩을 써서 능력을 발동한다 (이로운 상태라 해주에 깎임)';
  return parts.join('. ') || '효과 없음 (주기 0)';
}

export function lnumText(v: LNum | undefined): string {
  if (v === undefined) return '0';
  return Array.isArray(v) ? v.join('/') : String(v);
}

const signed = (v: LNum) => {
  const first = Array.isArray(v) ? v[0] : v;
  const abs = Array.isArray(v) ? v.map(Math.abs) : Math.abs(v);
  return `${first < 0 ? '-' : '+'}${lnumText(abs)}`;
};

export const DIR_NAMES: Record<Dir, string> = {
  c: '기준', u: '위', d: '아래', l: '왼쪽', r: '오른쪽', ul: '왼쪽 위', ur: '오른쪽 위', dl: '왼쪽 아래', dr: '오른쪽 아래',
};
const ADJ = ['u', 'd', 'l', 'r'];
const AROUND = ['ul', 'u', 'ur', 'l', 'r', 'dl', 'd', 'dr'];
const sameSet = (a: string[], b: string[]) => a.length === b.length && a.every((x) => b.includes(x));

// center: 유닛이 아니라 보드 중앙 칸이 기준인 효과 (장신구)
export const KIND_NAMES: Record<UnitKind, string> = { leader: '리더', monster: '몬스터' };

export function filterText(f: UnitFilter, center = false): string {
  const ally = f.side === 'ally';
  const who = ally ? '아군' : '상대';
  const tag = `${f.tag ? ` ${f.tag}` : ''}${f.kind ? ` ${KIND_NAMES[f.kind]}` : ''}`;
  const pos = [f.row ? `${f.row}행` : '', f.col ? `${f.col}열` : ''].filter(Boolean).join(' ');
  let base: string;
  if (f.area === 'all') {
    base = `${pos ? `${pos} ` : ''}${who}${tag}${f.tag || f.kind || pos ? '' : ' 전체'}`;
  } else if (f.area === 'sameRow' || f.area === 'sameCol') {
    base = center
      ? `가운데 ${f.area === 'sameRow' ? '행(2행)' : '열(2열)'} ${who}${tag}`
      : `같은 ${f.area === 'sameRow' ? '행' : '열'} ${who}${tag}`;
  } else if (center) {
    const dirs = f.dirs ?? [];
    const others = dirs.filter((d) => d !== 'c');
    const ring = sameSet(others, ADJ) ? '상하좌우' : sameSet(others, AROUND) ? '주변 8칸' : others.map((d) => DIR_NAMES[d]).join('·');
    const mid = dirs.includes('c');
    const cells = mid && others.length ? `중앙 칸과 그 ${ring}` : mid ? '중앙 칸' : others.length ? `중앙 ${ring}` : '';
    base = cells ? `${cells} ${who}${tag}` : '(대상 없음)';
    if (pos) base = `${pos} ${base}`;
  } else {
    const dirs = f.dirs ?? [];
    const center = dirs.includes('c');
    const others = dirs.filter((d) => d !== 'c');
    const ring = sameSet(others, ADJ) ? '상하좌우' : sameSet(others, AROUND) ? '주변 8칸' : others.map((d) => DIR_NAMES[d]).join('·');
    if (ally) {
      if (!others.length) base = center ? '자신' : '(대상 없음)';
      else base = `${center ? '자신과 ' : ''}${ring === '상하좌우' ? '인접' : ring} 아군${tag}`;
    } else if (!others.length) {
      base = center ? `같은 칸 상대${tag}` : '(대상 없음)';
    } else {
      base = `${center ? '같은 칸과 ' : ''}대칭 위치 ${ring} 상대${tag}`;
    }
    if (pos) base = `${pos} ${base}`;
  }
  return f.excludeSelf && !center ? `${base}(자신 제외)` : base;
}

function amountText(e: { atkPct?: LNum; powerPct?: LNum; flat?: LNum; hpPct?: LNum; scales?: Scale[] }): string {
  const parts: string[] = [];
  if (e.atkPct !== undefined) parts.push(`공격력 ${lnumText(e.atkPct)}%`);
  if (e.powerPct !== undefined) parts.push(`주문력 ${lnumText(e.powerPct)}%`);
  if (e.hpPct !== undefined) parts.push(`체력 ${lnumText(e.hpPct)}%`);
  if (e.flat !== undefined) parts.push(lnumText(e.flat));
  for (const sc of e.scales ?? []) parts.push(`${scaleLabel(sc)} ${lnumText(sc.pct)}%`);
  return parts.join(' + ') || '0';
}

// 비례 출처 이름 ("상대 독", "아군 야수 수", "골드")
export function scaleLabel(sc: Scale): string {
  const st = BALANCE.statuses[sc.status ?? 'poison']?.name ?? sc.status ?? '독';
  const who = `${sc.tag ? `${sc.tag} ` : ''}${sc.kind ? `${KIND_NAMES[sc.kind]} ` : ''}`;
  switch (sc.src) {
    case 'atk': return '공격력';
    case 'power': return '주문력';
    case 'hp': return '체력';
    case 'haste': return '가속';
    case 'extra': return '추가발동';
    case 'acts': return '행동 횟수';
    case 'consumed': return '소모한 중첩';
    case 'paidHp': return '소모한 체력';
    case 'gold': return '골드';
    case 'allyStatus': return `아군 ${st}`;
    case 'enemyStatus': return `상대 ${st}`;
    case 'allyShield': return '아군 실드';
    case 'allyMissingHp': return '아군 잃은 체력';
    case 'enemyMissingHp': return '상대 잃은 체력';
    case 'allyCount': return `아군 ${who}수`;
    case 'enemyCount': return `상대 ${who}수`;
    default: return sc.src;
  }
}

// "희망 10 소모", "희망 5 이상이면 전부 소모", "상대의 독 3 소모"
function consumeHead(e: Extract<Effect, { type: 'consume' }>): string {
  const name = BALANCE.statuses[e.status]?.name ?? e.status;
  return `${e.from === 'enemy' ? '상대의 ' : ''}${name} ${lnumText(e.cost)}${e.all ? ' 이상이면 전부' : ''} 소모`;
}

const scalesText = (scales?: Scale[]) => (scales?.length ? ` + ${scales.map((sc) => `${scaleLabel(sc)} ${lnumText(sc.pct)}%`).join(' + ')}` : '');

const STATUS_IDS_LOCAL = () => Object.keys(BALANCE.statuses) as StatusId[];

export function describeEffect(e: Effect, center = false): string {
  const target = (t: UnitFilter) => filterText(t, center);
  switch (e.type) {
    case 'damage': return `${amountText(e)} ${e.pierce ? '관통 ' : ''}피해`;
    case 'heal': return `${amountText(e)} 회복`;
    case 'shield': return `${amountText(e)} 실드`;
    case 'status': {
      const name = BALANCE.statuses[e.status]?.name ?? e.status;
      return `${e.to === 'ally' ? '아군' : '상대'}에게 ${name} ${amountText(e)}`;
    }
    case 'atkFlat': return `${target(e.target)} 공격력 ${signed(e.amount)}${scalesText(e.scales)}`;
    case 'atkPct': return `${target(e.target)} 공격력 ${signed(e.pct)}%`;
    case 'powerFlat': return `${target(e.target)} 주문력 ${signed(e.amount)}${scalesText(e.scales)}`;
    case 'powerPct': return `${target(e.target)} 주문력 ${signed(e.pct)}%`;
    case 'haste': return `${target(e.target)} 가속 ${signed(e.amount)}${scalesText(e.scales)}`;
    case 'extra': return `${target(e.target)} 추가발동 ${signed(e.amount)}${scalesText(e.scales)}`;
    case 'stun': {
      const sec = Array.isArray(e.ticks) ? e.ticks.map((t) => t / BALANCE.ticksPerSec) : e.ticks / BALANCE.ticksPerSec;
      return `${target(e.target)} ${lnumText(sec)}초 기절`;
    }
    case 'maxHpPct': return `아군 최대 체력 ${signed(e.pct)}%`;
    case 'consume': {
      const inner = e.effects.map((x) => describeEffect(x, center)).join(', ') || '(효과 없음)';
      return `${consumeHead(e)} → ${inner}`;
    }
    case 'cleanse':
    case 'dispel': {
      const cleanse = e.type === 'cleanse';
      const names = STATUS_IDS_LOCAL().filter((id) => !!BALANCE.statuses[id]?.harmful === cleanse).map((id) => BALANCE.statuses[id].name).join('·');
      const what = `${cleanse ? '아군의 해로운 상태' : '상대의 이로운 상태'}${names ? `(${names})` : ''}`;
      const amt = [e.pct !== undefined ? `${lnumText(e.pct)}%` : '', e.flat !== undefined ? lnumText(e.flat) : ''].filter(Boolean).join(' + ') || '0';
      return `${cleanse ? '정화' : '해주'}: ${e.scope === 'largest' ? `가장 많이 쌓인 ${what} 하나` : what} 중첩 ${amt} 제거`;
    }
    case 'permanent': {
      const [name, unit] = STAT_NAMES[e.stat] ?? [e.stat, ''];
      return `${target(e.target)} ${name} 영구 ${signed(e.amount)}${unit}`;
    }
    case 'gold': return `골드 +${lnumText(e.amount)}`;
    case 'trinket': {
      const grades = Array.isArray(e.grade) ? e.grade : [e.grade];
      const gradeText = grades.every((g) => g === grades[0]) ? GRADE_NAMES[grades[0]] : grades.map((g) => GRADE_NAMES[g]).join('/');
      return `무작위 ${gradeText} 장신구 ${lnumText(e.count ?? 1)}개 획득`;
    }
    case 'mimic': return '반응한 유닛의 행동 효과를 내 능력치로 따라 함';
    case 'hpCost': return `${hpCostHead(e)} → ${e.effects.map((x) => describeEffect(x, center)).join(', ') || '(효과 없음)'}`;
    case 'conduct': {
      const who = `${filterText(e.target, center)}${e.uniqueTag ? ' 중 주변에 같은 태그가 없는 유닛' : ''}`;
      const rewards = [
        e.goldPer ? `1명당 골드 +${lnumText(e.goldPer)}` : '',
        e.trinketPer && e.trinketGrade ? `${e.trinketPer}명마다 ${GRADE_NAMES[e.trinketGrade]} 장신구` : '',
        e.perfect && e.perfectTrinket ? `${e.perfect}명이면 ${TRINKET_MAP[e.perfectTrinket]?.name ?? e.perfectTrinket}` : '',
      ].filter(Boolean);
      return `${withEul(who)} 행동시킴 (추가발동 포함)${rewards.length ? `. 전투 후 ${rewards.join(', ')}` : ''}`;
    }
    default: return '(알 수 없는 효과)';
  }
}

// 트리거 머리말: "전투 시작", "행동", "10초", "아군 체력 50% 이하 (1회)"
export function triggerHead(t: Trigger, center = false): string {
  const only = t.onlyIn?.length ? `${t.onlyIn.map((k) => (k === 'boss' ? '보스' : '엘리트')).join('·')}전 · ` : '';
  return only + baseTriggerHead(t, center);
}
function baseTriggerHead(t: Trigger, center: boolean): string {
  if (t.on === 'battleStart') return '전투 시작';
  if (t.on === 'act') return '행동';
  if (t.on === 'lowHp') return `아군 체력 ${t.hpPct ?? 50}% 이하 (1회)`;
  if (t.on === 'enemyLowHp') return `상대 체력 ${t.hpPct ?? 50}% 이하 (1회)`;
  if (t.on === 'react') return reactHead(t, center);
  if (t.repeat) return `${t.atSec ?? 0}초마다${t.limit ? ` (최대 ${t.limit}회)` : ''}`;
  return `${t.atSec ?? 0}초`;
}

// "인접 아군 행동 시", "상대 전체 행동 3번마다 (최대 5회)"
function reactHead(t: Trigger, center: boolean): string {
  const who = t.watch ? filterText(t.watch, center) : '(대상 없음)';
  const every = (t.every ?? 1) > 1 ? ` ${t.every}번마다` : ' 시';
  return `${who} 행동${every}${t.limit ? ` (최대 ${t.limit}회)` : ''}`;
}

export function describeTrigger(t: Trigger, center = false): string {
  const head = triggerHead(t, center);
  return `${head}: ${t.effects.map((e) => describeEffect(e, center)).join(', ') || '(효과 없음)'}.`;
}

export function describeTriggers(triggers: Trigger[], extra?: number, center = false): string {
  const parts = triggers.map((t) => describeTrigger(t, center));
  if (extra) parts.unshift(`기본 추가발동 ${extra}.`);
  return parts.join(' ');
}

export function unitDesc(def: Pick<UnitDef, 'desc' | 'triggers' | 'extra'>, center = false): string {
  return def.desc?.trim() ? def.desc : describeTriggers(def.triggers, def.extra, center);
}

const STAT_NAMES: Record<string, [string, string]> = {
  atk: ['공격력', ''], atkPct: ['공격력', '%'], hp: ['체력', ''], hpPct: ['체력', '%'],
  power: ['주문력', ''], powerPct: ['주문력', '%'], haste: ['가속', ''], intervalPct: ['행동 간격', '%'],
  extra: ['추가발동', ''], healShieldPct: ['회복·실드', '%'],
};

// "공격력 +3, 행동 간격 -10%"
export function statModsText(mods: StatMods | undefined): string {
  return Object.entries(mods ?? {})
    .filter(([, v]) => v)
    .map(([k, v]) => {
      const [name, unit] = STAT_NAMES[k] ?? [k, ''];
      return `${name} ${v! > 0 ? '+' : ''}${v}${unit}`;
    })
    .join(', ');
}

// 성장 선택지의 자동 설명 (기본 능력 목록이 있으면 제거되는 능력 내용도 적는다)
export function describeGrowth(g: GrowthDef, baseTriggers?: Trigger[]): string {
  const parts: string[] = [];
  if (g.deploy) parts.push(`배치 인원 +${g.deploy}`);
  const stats = statModsText(g.stats);
  if (stats) parts.push(stats);
  for (const i of g.removeTriggers ?? []) {
    const t = baseTriggers?.[i];
    parts.push(`능력 ${i + 1} 제거${t ? ` (${describeTrigger(t).replace(/\.$/, '')})` : ''}`);
  }
  if (g.addTags?.length) parts.push(`태그 추가: ${g.addTags.join(', ')}`);
  if (g.removeTags?.length) parts.push(`태그 제거: ${g.removeTags.join(', ')}`);
  for (const t of g.triggers ?? []) parts.push(`새 능력 - ${describeTrigger(t)}`);
  return parts.join(', ');
}

// 변신 성장의 태그 변화 ("전사 → 언데드")
export function tagChangeText(g: GrowthDef): string {
  const from = (g.removeTags ?? []).join('·');
  const to = (g.addTags ?? []).join('·');
  return from && to ? `${from} → ${to}` : to ? `+${to}` : from ? `-${from}` : '';
}

// ── 계산된 수치가 들어간 설명 (롤 툴팁처럼) ──
// 유닛의 실제 능력치로 수치를 계산해 "12(공격력 100%)"처럼 보여 준다. 화면은 이 조각을 받아 능력치별 색으로 그린다.
// 계산식은 전투 엔진과 같다: 피해 = 고정 + 공격력×% + 주문력×% (각각 내림), 회복·실드는 회복·실드 배율을 곱하고,
// 실드는 유닛 체력×%를 더하며, 팀 상태 중첩 = 주문력×% (반올림) + 고정.

export interface AmountPart {
  stat?: ScaleSource; // 없으면 고정값
  value: number; // stat이 있으면 %, 없으면 고정값
  label?: string; // 출처 이름
  known: boolean; // 지금 값을 알아서 총합에 들어갔는지 (전투 상황에 따라 바뀌는 출처는 전투 밖에서 모름)
}
export interface AmountSeg {
  total: number; // 아는 항목만의 합
  parts: AmountPart[];
  mult?: number; // 회복·실드 배율 % (100이 아닐 때)
  partial: boolean; // 모르는 항목이 있어서 실제로는 더 커질 수 있음
}
export type DescSeg = string | AmountSeg;

export interface DescStats {
  atk: number;
  power: number;
  hp: number;
  level: number;
  healShieldPct?: number;
  haste?: number;
  extra?: number;
  acts?: number;
  gold?: number;
  source?: (sc: Scale) => number | undefined; // 전투 중이면 팀 상태·유닛 수 등의 지금 값
}

const floorPct = (base: number, pct: number) => Math.floor((base * pct) / 100);

function knownSource(sc: Scale, st: DescStats): number | undefined {
  const fromCtx = st.source?.(sc);
  if (fromCtx !== undefined) return fromCtx;
  switch (sc.src) {
    case 'atk': return st.atk;
    case 'power': return st.power;
    case 'hp': return st.hp;
    case 'haste': return st.haste;
    case 'extra': return st.extra;
    case 'acts': return st.acts;
    case 'gold': return st.gold;
    default: return undefined;
  }
}

function amountSeg(e: { atkPct?: LNum; powerPct?: LNum; hpPct?: LNum; flat?: LNum; scales?: Scale[] }, st: DescStats, kind: 'damage' | 'healShield' | 'status'): AmountSeg {
  const L = st.level;
  const parts: AmountPart[] = [];
  const flat = lv(e.flat, L);
  if (e.flat !== undefined && flat) parts.push({ value: flat, known: true });
  let total = flat;
  const add = (sc: Scale) => {
    const pct = lv(sc.pct, L);
    if (!pct) return;
    const v = knownSource(sc, st);
    parts.push({ stat: sc.src, value: pct, label: scaleLabel(sc), known: v !== undefined });
    if (v !== undefined) total += kind === 'status' ? Math.round((v * pct) / 100) : floorPct(v, pct);
  };
  if (e.atkPct !== undefined) add({ src: 'atk', pct: e.atkPct });
  if (e.powerPct !== undefined) add({ src: 'power', pct: e.powerPct });
  if (e.hpPct !== undefined) add({ src: 'hp', pct: e.hpPct });
  for (const sc of e.scales ?? []) add(sc);
  const mult = kind === 'healShield' && st.healShieldPct !== undefined && st.healShieldPct !== 100 ? st.healShieldPct : undefined;
  if (mult !== undefined) total = floorPct(total, mult);
  return { total, parts, mult, partial: parts.some((p) => !p.known) };
}

// "아군 체력 10% + 5 소모"
function hpCostHead(e: { pct?: LNum; flat?: LNum }): string {
  const parts = [e.pct ? `현재 체력의 ${lnumText(e.pct)}%` : '', e.flat ? lnumText(e.flat) : ''].filter(Boolean);
  return `아군 체력 ${parts.join(' + ') || '0'} 소모`;
}

export function effectSegs(e: Effect, st: DescStats, center = false): DescSeg[] {
  switch (e.type) {
    case 'hpCost': {
      const out: DescSeg[] = [`${hpCostHead(e)} → `];
      e.effects.forEach((x, i) => {
        if (i > 0) out.push(', ');
        out.push(...effectSegs(x, { ...st, source: (sc) => (sc.src === 'paidHp' ? undefined : st.source?.(sc)) }, center));
      });
      if (e.effects.length === 0) out.push('(효과 없음)');
      return out;
    }
    case 'damage': return [amountSeg(e, st, 'damage'), e.pierce ? ' 관통 피해' : ' 피해'];
    case 'heal': return [amountSeg(e, st, 'healShield'), ' 회복'];
    case 'shield': return [amountSeg(e, st, 'healShield'), ' 실드'];
    case 'status': {
      const name = BALANCE.statuses[e.status]?.name ?? e.status;
      return [`${e.to === 'ally' ? '아군' : '상대'}에게 ${name} `, amountSeg(e, st, 'status')];
    }
    case 'consume': {
      const cost = lv(e.cost, st.level);
      const inner: DescStats = { ...st, source: (sc) => (sc.src === 'consumed' ? (e.all ? undefined : cost) : st.source?.(sc)) };
      const out: DescSeg[] = [`${consumeHead({ ...e, cost })} → `];
      e.effects.forEach((x, i) => {
        if (i > 0) out.push(', ');
        out.push(...effectSegs(x, inner, center));
      });
      if (e.effects.length === 0) out.push('(효과 없음)');
      return out;
    }
    case 'atkFlat':
    case 'powerFlat':
    case 'haste':
    case 'extra':
      if (e.scales?.length) {
        const name = e.type === 'atkFlat' ? '공격력' : e.type === 'powerFlat' ? '주문력' : e.type === 'haste' ? '가속' : '추가발동';
        return [`${filterText(e.target, center)} ${name} +`, amountSeg({ flat: e.amount, scales: e.scales }, st, 'damage')];
      }
      return plainSegs(e, st, center);
    default:
      return plainSegs(e, st, center);
  }
}

// 능력치에 비례하지 않는 효과는 레벨에 맞는 수치 하나로 보여 준다
function plainSegs(e: Effect, st: DescStats, center: boolean): DescSeg[] {
  const fixed = structuredClone(e) as unknown as Record<string, unknown>;
  for (const [k, v] of Object.entries(fixed)) if (Array.isArray(v) && v.every((x) => typeof x === 'number')) fixed[k] = lv(v as number[], st.level);
  return [describeEffect(fixed as unknown as Effect, center)];
}

export function triggerSegs(t: Trigger, st: DescStats, center = false): DescSeg[] {
  const head = triggerHead(t, center);
  const out: DescSeg[] = [`${head}: `];
  t.effects.forEach((e, i) => {
    if (i > 0) out.push(', ');
    out.push(...effectSegs(e, st, center));
  });
  if (t.effects.length === 0) out.push('(효과 없음)');
  out.push('.');
  return out;
}

// 줄 하나 = 능력 하나
export function abilityLines(triggers: Trigger[], extra: number | undefined, st: DescStats, center = false): DescSeg[][] {
  const lines = triggers.map((t) => triggerSegs(t, st, center));
  if (extra) lines.unshift([`기본 추가발동 ${extra}.`]);
  return lines;
}

// 글자로만 (툴팁·터미널): "12(공격력 100%)"
export function amountSegText(a: AmountSeg): string {
  const ratio = a.parts.filter((p) => p.stat).map((p) => `${p.label} ${p.value}%`);
  const flat = a.parts.find((p) => !p.stat);
  const inner = [...(flat && ratio.length ? [String(flat.value)] : []), ...ratio].join(' + ');
  return `${a.total}${a.partial ? '+' : ''}${inner ? `(${inner}${a.mult ? ` ×${a.mult}%` : ''})` : ''}`;
}

export function segsText(segs: DescSeg[]): string {
  return segs.map((s) => (typeof s === 'string' ? s : amountSegText(s))).join('');
}
