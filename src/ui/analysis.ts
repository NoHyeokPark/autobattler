// 전투 후 분석 화면: 유닛별 피해·회복·실드, 시간대별 HP 그래프, 상대 보드와 장신구.

import type { BattleResult } from '../battle/types.ts';
import { BALANCE } from '../config/balance.ts';
import { ENV_NAMES } from '../data/types.ts';
import type { DayBattle } from '../game/day.ts';
import { NODE_NAMES, renderSnapshotBoard } from './render.ts';
import { bar, cell, padStart, sec } from './text.ts';

const mark = (total: number, shared: number) => (shared > 0 ? `${total}*` : String(total));

export interface OtherRow { side: 0 | 1; label: string; damage: number; heal: number; shield: number }
export function otherSources(r: BattleResult): OtherRow[] {
  const rows = new Map<string, OtherRow>();
  for (const x of r.sourceTotals) {
    if (/^\d-\d+$/.test(x.src)) continue; // 유닛
    const trinket = x.src.startsWith('trinket:') || x.src.startsWith('trinkets:');
    const synergy = x.src.startsWith('synergy:');
    const key = trinket ? `trinkets:${x.side}` : x.src;
    const label = trinket ? '<장신구>' : synergy ? `<시너지> ${x.src.split(':')[2]}` : `${x.side === 0 ? '아군' : '적군'}이 건 ${x.srcName}`;
    const row = rows.get(key) ?? { side: x.side as 0 | 1, label, damage: 0, heal: 0, shield: 0 };
    row.damage += x.damage;
    row.heal += x.heal;
    row.shield += x.shield;
    rows.set(key, row);
  }
  return [...rows.values()].filter((o) => o.damage || o.heal || o.shield).sort((a, b) => a.side - b.side);
}

const SIDE = ['아군', '적군'];

import { gainSummaryText, rawGainsText } from '../game/run.ts';

export function renderAnalysis(b: DayBattle): string {
  const r = b.result;
  const out: string[] = ['==================== 전투 분석 ===================='];
  out.push(`결과: ${b.win ? '승리!' : '패배'} | ${sec(r.endTick)} | ${r.reason === 'ko' ? 'KO' : '시간 초과 판정'} | 서든데스 ${r.suddenDeath ? '발동' : '없음'}`);
  out.push(`노드: ${NODE_NAMES[b.node.kind]} | 환경: ${ENV_NAMES[b.node.env]} | 상대: ${b.match.team.name} [매칭: ${b.match.stage}]`);
  out.push(`최종 HP: 아군 ${Math.max(0, r.finalHp[0])}/${r.maxHp[0]} | 적군 ${Math.max(0, r.finalHp[1])}/${r.maxHp[1]}`);
  const gained = b.gains ? gainSummaryText(b.gains) : rawGainsText(r.gains[0], b.input.player);
  if (gained) out.push(`전투 후 획득: ${gained}`);

  out.push('-- 유닛별 기록 --');
  out.push(`${cell('진영', 5)}${cell('칸', 3)}${cell('유닛', 16)}${cell('공격력', 12)}${cell('간격', 6)}${cell('추가', 5)}${padStart('행동', 5)}${padStart('피해', 8)}${padStart('회복', 8)}${padStart('실드', 8)}`);
  for (const side of [0, 1]) {
    for (const u of r.units.filter((x) => x.side === side)) {
      const name = `${u.isLeader ? '[L]' : ''}${u.name} Lv${u.level}`;
      const atk = u.startAtk === u.endAtk ? `${u.endAtk}` : `${u.startAtk}->${u.endAtk}`;
      out.push(`${cell(SIDE[side], 5)}${cell(String(u.slot), 3)}${cell(name, 16)}${cell(atk, 12)}${cell(sec(u.interval), 6)}${cell(String(u.extra), 5)}${padStart(String(u.acts), 5)}${padStart(mark(u.damage, u.statusDamage + u.buffDamage), 8)}${padStart(mark(u.heal, u.statusHeal + u.buffHeal), 8)}${padStart(mark(u.shield, u.buffShield), 8)}`);
    }
  }
  const others = otherSources(r);
  if (others.length) {
    out.push('-- 장신구 --');
    for (const o of others) {
      const parts = [o.damage && `피해 ${o.damage}`, o.heal && `회복 ${o.heal}`, o.shield && `실드 ${o.shield}`].filter(Boolean);
      out.push(`  ${SIDE[o.side]} ${o.label}: ${parts.join(', ')}`);
    }
  }
  out.push('  (* = 그 유닛이 건 팀 상태(독·화상·괴사·가시·재생)나 다른 아군에게 건 전투 한정 버프(강화, 공격력·주문력)의 몫 포함)');

  out.push('-- HP 그래프 (5초 간격) --');
  const step = 5 * BALANCE.ticksPerSec;
  const points = r.timeline.filter((p, i) => p.t % step === 0 || i === r.timeline.length - 1);
  for (const p of points) {
    const hp0 = Math.max(0, p.hp[0]);
    const hp1 = Math.max(0, p.hp[1]);
    out.push(`  ${padStart(sec(p.t), 6)} 아군 ${bar(hp0, r.maxHp[0], 15)} ${padStart(String(hp0), 6)}  적군 ${bar(hp1, r.maxHp[1], 15)} ${padStart(String(hp1), 6)}`);
  }

  out.push(`-- 상대 보드: ${b.match.team.name} --`);
  out.push(renderSnapshotBoard(b.match.team));
  return out.join('\n');
}
