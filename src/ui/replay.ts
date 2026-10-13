// 전투 재생. 엔진 이벤트 로그를 tick 단위로 묶어 짧은 간격으로 연속 출력한다.
// 재생 속도는 화면만의 문제이며 결과는 엔진이 이미 정했다.

import type { BattleResult, BEvent } from '../battle/types.ts';
import { bar, padStart, sec } from './text.ts';

export type Speed = '1' | '3' | 'skip';

const SIDE = ['아군', '적군'];
const DELAY_MS: Record<Speed, number> = { '1': 220, '3': 70, skip: 0 };

interface SrcAgg {
  side: number;
  name: string;
  acts: number;
  damage: number;
  heal: number;
  shield: number;
  notes: string[];
}

function sideOf(e: BEvent): number {
  return e.side === -1 ? 0 : e.side;
}

// 유닛은 "아군 [5]기사", 상태는 "적군에 걸린 독", 장신구는 "아군 <장신구>녹슨 반지"
function sourceLabel(e: BEvent): string {
  const side = SIDE[sideOf(e)];
  if (e.src.startsWith('status:')) return `${SIDE[Number(e.target?.slice(4) ?? 0)]}에 걸린 ${e.srcName}`;
  if (e.src.startsWith('trinket:')) return `${side} <장신구>${e.srcName}`;
  const slot = /^\d-(\d)$/.exec(e.src);
  return slot ? `${side} [${slot[1]}]${e.srcName}` : `${side} ${e.srcName}`;
}

// 한 tick의 이벤트를 출처별로 묶은 설명 줄 (들여쓰기 없음). 웹 전투 로그도 이 함수를 쓴다.
export function tickLines(evs: BEvent[], verboseBuffs: boolean): string[] {
  const lines: string[] = [];
  const aggs = new Map<string, SrcAgg>();
  const agg = (e: BEvent) => {
    let a = aggs.get(e.src);
    if (!a) {
      a = { side: sideOf(e), name: sourceLabel(e), acts: 0, damage: 0, heal: 0, shield: 0, notes: [] };
      aggs.set(e.src, a);
    }
    return a;
  };
  let buffCount = 0;
  for (const e of evs) {
    switch (e.type) {
      case 'act': agg(e).acts++; break;
      case 'damage': agg(e).damage += e.amount ?? 0; break;
      case 'heal': agg(e).heal += e.amount ?? 0; break;
      case 'shield': agg(e).shield += e.amount ?? 0; break;
      case 'status': agg(e).notes.push(`${e.note} +${e.amount}(${e.target === `team${e.side}` ? '아군' : '상대'} ${e.after})`); break;
      case 'statusTick': break;
      case 'stun': agg(e).notes.push(`${e.note} ${sec(e.amount ?? 0)} 기절`); break;
      case 'gain': agg(e).notes.push(`획득 ${e.note}`); break;
      case 'buff':
        if (verboseBuffs) lines.push(`* ${SIDE[sideOf(e)]} ${e.note}`);
        else buffCount++;
        break;
      case 'sudden': lines.push(`!! 서든데스: ${e.note}`); break;
      default: break;
    }
  }
  for (const a of aggs.values()) {
    const parts: string[] = [];
    if (a.damage) parts.push(`피해 ${a.damage}`);
    if (a.heal) parts.push(`회복 ${a.heal}`);
    if (a.shield) parts.push(`실드 ${a.shield}`);
    parts.push(...a.notes);
    if (parts.length === 0 && a.acts === 0) continue;
    const acts = a.acts > 1 ? ` x${a.acts}` : '';
    lines.push(`${a.name}${acts}: ${parts.join(', ') || '행동'}`);
  }
  if (buffCount) lines.push(`(능력치 변화 ${buffCount}건)`);
  return lines;
}

export function formatTick(t: number, evs: BEvent[], hpLine: string, verboseBuffs: boolean): string[] {
  const lines = tickLines(evs, verboseBuffs);
  if (lines.length === 0) return [];
  const pad = '         ';
  return [`[${padStart(sec(t), 6)}]`, ...lines.map((l) => pad + l), pad + hpLine];
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export async function replay(result: BattleResult, speed: Speed, write: (s: string) => void, animate: boolean) {
  if (speed === 'skip') return;
  const delay = animate ? DELAY_MS[speed] : 0;
  const groups = new Map<number, BEvent[]>();
  for (const e of result.events) {
    if (e.type === 'start' || e.type === 'end') continue;
    groups.set(e.t, [...(groups.get(e.t) ?? []), e]);
  }
  // timeline[0]은 전투 시작 효과(최대 체력 증가 등)를 적용한 뒤의 값이다.
  const hp: [number, number] = [result.timeline[0].hp[0], result.timeline[0].hp[1]];
  for (const [t, evs] of groups) {
    for (const e of evs) {
      if ((e.type === 'damage' || e.type === 'heal') && e.after !== undefined && e.target?.startsWith('team')) {
        hp[Number(e.target.slice(4))] = e.after;
      }
      if (e.type === 'sudden') {
        hp[0] -= e.amount ?? 0;
        hp[1] -= e.amount ?? 0;
      }
    }
    const hpLine = `HP 아군 ${bar(hp[0], result.maxHp[0], 10)} ${Math.max(0, hp[0])}/${result.maxHp[0]}  적군 ${bar(hp[1], result.maxHp[1], 10)} ${Math.max(0, hp[1])}/${result.maxHp[1]}`;
    const lines = formatTick(t, evs, hpLine, t === 0);
    if (lines.length === 0) continue;
    write(lines.join('\n'));
    if (delay) await sleep(delay);
  }
}
