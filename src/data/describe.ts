// 트리거 데이터에서 사람이 읽는 설명을 만든다. 카드 설명이 비어 있을 때와 에디터의 "자동 설명"에 쓴다.

import { BALANCE } from '../config/balance.ts';
import { GRADE_NAMES } from './types.ts';
import type { Dir, Effect, GrowthDef, LNum, StatMods, Trigger, UnitDef, UnitFilter } from './types.ts';

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

export function filterText(f: UnitFilter): string {
  const ally = f.side === 'ally';
  const who = ally ? '아군' : '상대';
  const tag = f.tag ? ` ${f.tag}` : '';
  const pos = [f.row ? `${f.row}행` : '', f.col ? `${f.col}열` : ''].filter(Boolean).join(' ');
  let base: string;
  if (f.area === 'all') {
    base = `${pos ? `${pos} ` : ''}${who}${tag}${f.tag || pos ? '' : ' 전체'}`;
  } else if (f.area === 'sameRow' || f.area === 'sameCol') {
    base = `같은 ${f.area === 'sameRow' ? '행' : '열'} ${who}${tag}`;
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
  return f.excludeSelf ? `${base}(자신 제외)` : base;
}

function amountText(e: { atkPct?: LNum; powerPct?: LNum; flat?: LNum; hpPct?: LNum }): string {
  const parts: string[] = [];
  if (e.atkPct !== undefined) parts.push(`공격력 ${lnumText(e.atkPct)}%`);
  if (e.powerPct !== undefined) parts.push(`주문력 ${lnumText(e.powerPct)}%`);
  if (e.hpPct !== undefined) parts.push(`체력 ${lnumText(e.hpPct)}%`);
  if (e.flat !== undefined) parts.push(lnumText(e.flat));
  return parts.join(' + ') || '0';
}

export function describeEffect(e: Effect): string {
  switch (e.type) {
    case 'damage': return `${amountText(e)} 피해`;
    case 'heal': return `${amountText(e)} 회복`;
    case 'shield': return `${amountText(e)} 실드`;
    case 'status': {
      const name = BALANCE.statuses[e.status]?.name ?? e.status;
      return `${e.to === 'ally' ? '아군' : '상대'}에게 ${name} ${amountText(e)}`;
    }
    case 'atkFlat': return `${filterText(e.target)} 공격력 ${signed(e.amount)}`;
    case 'atkPct': return `${filterText(e.target)} 공격력 ${signed(e.pct)}%`;
    case 'powerFlat': return `${filterText(e.target)} 주문력 ${signed(e.amount)}`;
    case 'powerPct': return `${filterText(e.target)} 주문력 ${signed(e.pct)}%`;
    case 'intervalPct': return `${filterText(e.target)} 행동 간격 ${signed(e.pct)}%`;
    case 'extra': return `${filterText(e.target)} 추가발동 ${signed(e.amount)}`;
    case 'stun': {
      const sec = Array.isArray(e.ticks) ? e.ticks.map((t) => t / BALANCE.ticksPerSec) : e.ticks / BALANCE.ticksPerSec;
      return `${filterText(e.target)} ${lnumText(sec)}초 기절`;
    }
    case 'maxHpPct': return `아군 최대 체력 ${signed(e.pct)}%`;
    case 'permanent': {
      const [name, unit] = STAT_NAMES[e.stat] ?? [e.stat, ''];
      return `${filterText(e.target)} ${name} 영구 ${signed(e.amount)}${unit}`;
    }
    case 'gold': return `골드 +${lnumText(e.amount)}`;
    case 'trinket': {
      const grades = Array.isArray(e.grade) ? e.grade : [e.grade];
      const gradeText = grades.every((g) => g === grades[0]) ? GRADE_NAMES[grades[0]] : grades.map((g) => GRADE_NAMES[g]).join('/');
      return `무작위 ${gradeText} 장신구 ${lnumText(e.count ?? 1)}개 획득`;
    }
    default: return '(알 수 없는 효과)';
  }
}

export function describeTrigger(t: Trigger): string {
  const head = t.on === 'battleStart' ? '전투 시작' : t.on === 'act' ? '행동' : `${t.atSec ?? 0}초`;
  return `${head}: ${t.effects.map(describeEffect).join(', ') || '(효과 없음)'}.`;
}

export function describeTriggers(triggers: Trigger[], extra?: number): string {
  const parts = triggers.map(describeTrigger);
  if (extra) parts.unshift(`기본 추가발동 ${extra}.`);
  return parts.join(' ');
}

export function unitDesc(def: Pick<UnitDef, 'desc' | 'triggers' | 'extra'>): string {
  return def.desc?.trim() ? def.desc : describeTriggers(def.triggers, def.extra);
}

const STAT_NAMES: Record<string, [string, string]> = {
  atk: ['공격력', ''], atkPct: ['공격력', '%'], hp: ['체력', ''], hpPct: ['체력', '%'],
  power: ['주문력', ''], powerPct: ['주문력', '%'], intervalPct: ['행동 간격', '%'],
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
