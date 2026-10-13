// 전투 후 분석 화면: 유닛별 피해·회복·실드, 시간대별 HP 그래프, 상대 보드와 장신구.

import { BALANCE } from '../config/balance.ts';
import { ENV_NAMES } from '../data/types.ts';
import type { DayBattle } from '../game/day.ts';
import { NODE_NAMES, renderSnapshotBoard } from './render.ts';
import { bar, cell, padStart, sec } from './text.ts';

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
      out.push(`${cell(SIDE[side], 5)}${cell(String(u.slot), 3)}${cell(name, 16)}${cell(atk, 12)}${cell(sec(u.interval), 6)}${cell(String(u.extra), 5)}${padStart(String(u.acts), 5)}${padStart(String(u.damage), 8)}${padStart(String(u.heal), 8)}${padStart(String(u.shield), 8)}`);
    }
  }
  const others = r.sourceTotals.filter((x) => !/^\d-\d$/.test(x.src));
  if (others.length) {
    out.push('-- 장신구·상태 효과 --');
    for (const o of others) {
      const parts = [o.damage && `피해 ${o.damage}`, o.heal && `회복 ${o.heal}`, o.shield && `실드 ${o.shield}`].filter(Boolean);
      const label = o.src.startsWith('status:') ? `${SIDE[o.side]}이 건 ${o.srcName}` : `${SIDE[o.side]} <장신구>${o.srcName}`;
      if (parts.length) out.push(`  ${label}: ${parts.join(', ')}`);
    }
  }

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
