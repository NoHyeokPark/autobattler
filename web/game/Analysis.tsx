// 전투 후 분석: 유닛별 피해·회복·실드, 시간대별 HP 그래프, 상대 보드와 장신구.

import { otherSources } from '../../src/ui/analysis.ts';
import type { ReactNode } from 'react';
import { BALANCE } from '../../src/config/balance.ts';
import type { BattleResult } from '../../src/battle/types.ts';
import { TRINKET_MAP } from '../../src/data/trinkets.ts';
import type { DayBattle } from '../../src/game/day.ts';
import { trinketCounts } from '../../src/game/state.ts';
import { BoardGrid } from '../components/BoardGrid.tsx';
import { Card, trinketCard } from '../components/Card.tsx';
import { entryCard } from './units.ts';

const SIDE = ['아군', '적군'];

export function HpChart({ r }: { r: BattleResult }) {
  const W = 640;
  const H = 180;
  const P = 28;
  const TPS = BALANCE.ticksPerSec;
  const endT = Math.max(r.endTick, 1);
  const x = (t: number) => P + ((W - P * 2) * t) / endT;
  const y = (hp: number, side: 0 | 1) => H - P - ((H - P * 2) * Math.max(0, Math.min(hp, r.maxHp[side]))) / r.maxHp[side];
  const line = (side: 0 | 1) => r.timeline.map((p) => `${x(p.t).toFixed(1)},${y(p.hp[side], side).toFixed(1)}`).join(' ');
  const sd = BALANCE.suddenDeath.startSec * TPS;
  const ticks: number[] = [];
  for (let s = 0; s * TPS <= endT; s += endT / TPS > 60 ? 20 : endT / TPS > 20 ? 10 : 5) ticks.push(s);
  return (
    <svg className="hp-chart" viewBox={`0 0 ${W} ${H}`} role="img" aria-label="시간대별 HP 그래프">
      <line x1={P} y1={H - P} x2={W - P} y2={H - P} className="axis" />
      <line x1={P} y1={P} x2={P} y2={H - P} className="axis" />
      {ticks.map((s) => (
        <g key={s}>
          <line x1={x(s * TPS)} y1={H - P} x2={x(s * TPS)} y2={H - P + 4} className="axis" />
          <text x={x(s * TPS)} y={H - P + 16} className="axis-label" textAnchor="middle">{s}s</text>
        </g>
      ))}
      <text x={P - 4} y={P + 4} className="axis-label" textAnchor="end">100%</text>
      <text x={P - 4} y={H - P} className="axis-label" textAnchor="end">0</text>
      {sd <= endT && <line x1={x(sd)} y1={P} x2={x(sd)} y2={H - P} className="sd-line" />}
      <polyline points={line(0)} className="hp-line p0" />
      <polyline points={line(1)} className="hp-line p1" />
      <text x={W - P} y={P - 10} textAnchor="end" className="legend"><tspan className="p0t">■ 아군</tspan>  <tspan className="p1t">■ 적군</tspan></text>
    </svg>
  );
}

export function Analysis({ b }: { b: DayBattle }) {
  const r = b.result;
  const others = otherSources(r);
  const enemyCells: ReactNode[] = Array(9).fill(null);
  for (const e of b.match.team.board) enemyCells[e.slot - 1] = <Card data={entryCard(e, b.match.team)} size="sm" />;
  const change = (a: number, z: number) => (a === z ? `${z}` : `${a}→${z}`);
  return (
    <div className="analysis">
      <h3>전투 분석</h3>
      <div className="table-wrap">
        <table className="table">
          <thead>
            <tr><th>진영</th><th>칸</th><th>유닛</th><th>공격력</th><th>주문력</th><th>간격</th><th>추가</th><th>행동</th><th>피해</th><th>회복</th><th>실드</th></tr>
          </thead>
          <tbody>
            {r.units.map((u) => (
              <tr key={u.uid} className={`side${u.side}`}>
                <td>{SIDE[u.side]}</td>
                <td>{u.slot}</td>
                <td>{u.isLeader ? '[리더] ' : ''}{u.name} Lv{u.level}</td>
                <td>{change(u.startAtk, u.endAtk)}</td>
                <td>{u.startPower || u.endPower ? change(u.startPower, u.endPower) : '-'}</td>
                <td>{(u.interval / BALANCE.ticksPerSec).toFixed(1)}s</td>
                <td>{u.extra}</td>
                <td className="num">{u.acts}</td>
                <ShareCell total={u.damage} parts={[['상태', u.statusDamage], ['버프', u.buffDamage]]} />
                <ShareCell total={u.heal} parts={[['재생', u.statusHeal], ['버프', u.buffHeal]]} />
                <ShareCell total={u.shield} parts={[['버프', u.buffShield]]} />
              </tr>
            ))}
            {others.map((o) => (
              <tr key={`${o.side}${o.label}`} className={`side${o.side} other`}>
                <td>{SIDE[o.side]}</td>
                <td>-</td>
                <td colSpan={6}>{o.label}</td>
                <td className="num">{o.damage}</td>
                <td className="num">{o.heal}</td>
                <td className="num">{o.shield}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="muted small">유닛의 피해·회복·실드에는 그 유닛이 건 팀 상태(독·화상·괴사·가시·재생)가 낸 몫(상태)과, 다른 아군에게 건 전투 한정 버프(강화 상태, 공격력·주문력 증가)가 낸 몫(버프)이 포함됩니다. 버프 몫은 받은 유닛의 기록에서 빠지고, 영구 강화로 오른 능력치는 받은 유닛의 몫입니다. 장신구는 진영별로 묶었습니다.</p>
      <h3>시간대별 HP</h3>
      <HpChart r={r} />
      <h3>상대 보드 · {b.match.team.name}</h3>
      <BoardGrid cells={enemyCells} day={b.input.day} compact />
      {b.match.team.trinkets.length > 0 && (
        <div className="card-row wrap">
          {trinketCounts(b.match.team.trinkets).map(([id, n]) => (TRINKET_MAP[id] ? <Card key={id} data={trinketCard(TRINKET_MAP[id], n)} size="sm" /> : null))}
        </div>
      )}
    </div>
  );
}

// 합계 + 남에게 건 상태·버프로 낸 몫 (예: 120 (상태 30 · 버프 12))
function ShareCell({ total, parts }: { total: number; parts: [string, number][] }) {
  const shown = parts.filter(([, n]) => n > 0);
  const direct = total - shown.reduce((s, [, n]) => s + n, 0);
  return (
    <td className="num" title={shown.length ? [`직접 ${direct}`, ...shown.map(([k, n]) => `${k} ${n}`)].join(' + ') : undefined}>
      {total}
      {shown.length > 0 && <span className="dot-share"> ({shown.map(([k, n]) => `${k} ${n}`).join(' · ')})</span>}
    </td>
  );
}
