// 엔진 이벤트 로그를 tick 단위 화면 프레임으로 바꾼다. 결과는 이미 엔진이 정했고, 이건 재생용이다.

import type { BattleResult, BEvent } from '../../src/battle/types.ts';
import { STATUS_IDS } from '../../src/data/types.ts';
import type { StatusId } from '../../src/data/types.ts';
import { tickLines } from '../../src/ui/replay.ts';

// 전투 중 유닛 하나의 현재 상태 (상세 정보 패널용)
export interface LiveUnit {
  hp: number; // 합산 HP에 더해진 이 유닛의 체력
  atk: number;
  power: number;
  interval: number; // tick
  haste: number; // 가속 합계
  extra: number;
  stunUntil: number; // 이 tick 전까지 기절
  acts: number;
  damage: number; // 지금까지 준 피해·회복·실드
  heal: number;
  shield: number;
}

export interface Frame {
  t: number;
  hp: [number, number];
  shield: [number, number];
  lostMax: [number, number]; // 괴사 등으로 잃은 최대 체력 (회복으로 못 되돌리는 부분)
  units: Record<string, LiveUnit>;
  acting: Set<string>;
  says: Record<string, string>; // 이 tick에 대사를 한 유닛 (능력 말풍선)
  actPulse: Record<string, number>; // 유닛이 행동한 tick 수 (움찔 애니메이션을 다시 트는 데 쓴다)
  hit: [boolean, boolean]; // 이 tick에 피해를 받은 진영
  statuses: [StatusStacks, StatusStacks]; // 진영별 팀 상태 중첩 (독·화상·재생·강화·가시)
  lines: string[];
}

export type StatusStacks = Record<StatusId, number>;
export const noStatus = (): StatusStacks => Object.fromEntries(STATUS_IDS.map((id) => [id, 0])) as StatusStacks;

// 전투 시작 직전(t=0 효과 전) 유닛 상태
export function initialUnits(r: BattleResult): Record<string, LiveUnit> {
  const out: Record<string, LiveUnit> = {};
  for (const u of r.units) {
    out[u.uid] = {
      hp: u.init.hp, atk: u.init.atk, power: u.init.power, interval: u.init.interval, haste: u.init.haste ?? 0, extra: u.init.extra,
      stunUntil: u.initStun, acts: 0, damage: 0, heal: 0, shield: 0,
    };
  }
  return out;
}

export function buildFrames(r: BattleResult): Frame[] {
  const groups = new Map<number, BEvent[]>();
  for (const e of r.events) {
    if (e.type === 'start' || e.type === 'end') continue;
    groups.set(e.t, [...(groups.get(e.t) ?? []), e]);
  }
  const hp: [number, number] = [r.timeline[0].hp[0], r.timeline[0].hp[1]];
  const lostMax: [number, number] = [0, 0];
  const shield: [number, number] = [0, 0];
  const units = initialUnits(r);
  const actPulse: Record<string, number> = {};
  const statuses: [StatusStacks, StatusStacks] = [noStatus(), noStatus()];
  for (const u of r.units) actPulse[u.uid] = 0;
  const frames: Frame[] = [];
  for (const [t, evs] of groups) {
    const acting = new Set<string>();
    const says: Record<string, string> = {};
    const hit: [boolean, boolean] = [false, false];
    for (const e of evs) {
      const team = e.target?.startsWith('team') ? Number(e.target.slice(4)) as 0 | 1 : null;
      const src = units[e.src]; // 출처가 유닛이면 그 유닛
      switch (e.type) {
        case 'credit': // 팀 상태·버프가 낸 몫 (버프 몫은 행동한 유닛(target) 기록에서 옮겨 온다)
          if (e.note === 'damage' || e.note === 'heal' || e.note === 'shield') {
            if (src) src[e.note] += e.amount ?? 0;
            const from = e.target ? units[e.target] : undefined;
            if (from) from[e.note] -= e.amount ?? 0;
          }
          break;
        case 'say':
          if (e.note) says[e.src] = e.note;
          break;
        case 'react':
          acting.add(e.src);
          break;
        case 'act':
          acting.add(e.src);
          if (src) src.acts++;
          break;
        case 'damage':
          if (team !== null) {
            hp[team] = e.after ?? hp[team];
            if (e.shieldAfter !== undefined) shield[team] = e.shieldAfter;
            hit[team] = true;
          }
          if (src) src.damage += e.amount ?? 0;
          break;
        case 'hpCost': // 자해: 체력만 줄고 누구의 피해로도 기록하지 않는다
          if (team !== null) {
            hp[team] = e.after ?? hp[team];
            hit[team] = true;
          }
          break;
        case 'heal':
          if (team !== null) hp[team] = e.after ?? hp[team];
          if (src) src.heal += e.amount ?? 0;
          break;
        case 'shield':
          if (team !== null) shield[team] = e.after ?? shield[team];
          if (src) src.shield += e.amount ?? 0;
          break;
        case 'buff': {
          const x = e.target ? units[e.target] : undefined;
          if (x && e.after !== undefined) {
            if (e.stat === 'atk') x.atk = e.after;
            if (e.stat === 'power') x.power = e.after;
            if (e.stat === 'interval') {
              x.interval = e.after;
              if (e.haste !== undefined) x.haste = e.haste;
            }
            if (e.stat === 'extra') x.extra = e.after;
          }
          if (e.stat === 'maxHp' && e.unit && units[e.unit]) units[e.unit].hp += e.amount ?? 0;
          if (e.stat === 'maxHp' && !e.unit && team !== null && (e.amount ?? 0) < 0) lostMax[team] -= e.amount ?? 0;
          break;
        }
        case 'stun': {
          const x = e.target ? units[e.target] : undefined;
          if (x) x.stunUntil = Math.max(x.stunUntil, t + (e.amount ?? 0));
          break;
        }
        case 'sudden':
          hp[0] -= e.amount ?? 0;
          hp[1] -= e.amount ?? 0;
          hit[0] = hit[1] = true;
          break;
        case 'status':
        case 'statusTick':
          if (team !== null && e.status && e.after !== undefined) statuses[team][e.status] = e.after;
          break;
        default:
          break;
      }
    }
    for (const uid of acting) actPulse[uid] = (actPulse[uid] ?? 0) + 1;
    // t=0의 능력치 변화는 자세히, 이후는 건수만
    const lines = tickLines(evs, t === 0);
    const snap: Record<string, LiveUnit> = {};
    for (const [uid, u] of Object.entries(units)) snap[uid] = { ...u };
    frames.push({
      t, hp: [...hp], shield: [...shield], lostMax: [...lostMax], units: snap, acting, says, actPulse: { ...actPulse }, hit,
      statuses: [{ ...statuses[0] }, { ...statuses[1] }], lines,
    });
  }
  return frames;
}
