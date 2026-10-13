// 엔진 이벤트 로그를 tick 단위 화면 프레임으로 바꾼다. 결과는 이미 엔진이 정했고, 이건 재생용이다.

import type { BattleResult, BEvent } from '../../src/battle/types.ts';
import { tickLines } from '../../src/ui/replay.ts';

export interface Frame {
  t: number;
  hp: [number, number];
  shield: [number, number];
  atk: Record<string, number>;
  power: Record<string, number>;
  acts: Record<string, number>;
  acting: Set<string>;
  hit: [boolean, boolean]; // 이 tick에 피해를 받은 진영
  lines: string[];
}

export function buildFrames(r: BattleResult): Frame[] {
  const groups = new Map<number, BEvent[]>();
  for (const e of r.events) {
    if (e.type === 'start' || e.type === 'end') continue;
    groups.set(e.t, [...(groups.get(e.t) ?? []), e]);
  }
  const hp: [number, number] = [r.timeline[0].hp[0], r.timeline[0].hp[1]];
  const shield: [number, number] = [0, 0];
  const atk: Record<string, number> = {};
  const power: Record<string, number> = {};
  const acts: Record<string, number> = {};
  for (const u of r.units) {
    atk[u.uid] = u.startAtk;
    power[u.uid] = u.startPower;
    acts[u.uid] = 0;
  }
  const frames: Frame[] = [];
  for (const [t, evs] of groups) {
    const acting = new Set<string>();
    const hit: [boolean, boolean] = [false, false];
    for (const e of evs) {
      const team = e.target?.startsWith('team') ? Number(e.target.slice(4)) as 0 | 1 : null;
      switch (e.type) {
        case 'act':
          acting.add(e.src);
          acts[e.src] = (acts[e.src] ?? 0) + 1;
          break;
        case 'damage':
          if (team !== null) {
            hp[team] = e.after ?? hp[team];
            if (e.shieldAfter !== undefined) shield[team] = e.shieldAfter;
            hit[team] = true;
          }
          break;
        case 'heal':
          if (team !== null) hp[team] = e.after ?? hp[team];
          break;
        case 'shield':
          if (team !== null) shield[team] = e.after ?? shield[team];
          break;
        case 'buff':
          if (e.stat === 'atk' && e.target && e.after !== undefined) atk[e.target] = e.after;
          if (e.stat === 'power' && e.target && e.after !== undefined) power[e.target] = e.after;
          break;
        case 'sudden':
          hp[0] -= e.amount ?? 0;
          hp[1] -= e.amount ?? 0;
          hit[0] = hit[1] = true;
          break;
        default:
          break;
      }
    }
    // t=0의 능력치 변화는 자세히, 이후는 건수만
    const lines = tickLines(evs, t === 0);
    frames.push({ t, hp: [...hp], shield: [...shield], atk: { ...atk }, power: { ...power }, acts: { ...acts }, acting, hit, lines });
  }
  return frames;
}
