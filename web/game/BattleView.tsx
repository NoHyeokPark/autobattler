// 전투 재생. tick 묶음을 짧은 간격으로 연속 재생하고(배속은 재생 속도만 바꾼다), 끝나면 분석을 보여 준다.

import { useEffect, useMemo, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { BALANCE } from '../../src/config/balance.ts';
import { ENV_NAMES } from '../../src/data/types.ts';
import type { TeamSnapshot } from '../../src/battle/types.ts';
import type { DayBattle } from '../../src/game/day.ts';
import { gainSummaryText, rawGainsText } from '../../src/game/run.ts';
import { NODE_NAMES } from '../../src/ui/render.ts';
import { BoardGrid } from '../components/BoardGrid.tsx';
import { Card } from '../components/Card.tsx';
import { Analysis } from './Analysis.tsx';
import { buildFrames } from './frames.ts';
import type { Frame } from './frames.ts';
import { entryCard } from './units.ts';

const DELAY: Record<string, number> = { '1': 260, '3': 85 };

function HpBar({ hp, max, shield, hit }: { hp: number; max: number; shield: number; hit: boolean }) {
  const pct = Math.max(0, Math.min(100, (hp / max) * 100));
  const sh = Math.max(0, Math.min(100, (shield / max) * 100));
  return (
    <div className={`hpbar ${hit ? 'hit' : ''}`}>
      <div className="hpbar-fill" style={{ width: `${pct}%` }} />
      {sh > 0 && <div className="hpbar-shield" style={{ width: `${sh}%` }} />}
      <span className="hpbar-text">{Math.max(0, hp)} / {max}{shield > 0 ? ` (+실드 ${shield})` : ''}</span>
    </div>
  );
}

function SideBoard({ team, side, frame, day, title }: { team: TeamSnapshot; side: 0 | 1; frame: Frame | null; day: number; title: string }) {
  const cells: ReactNode[] = Array(9).fill(null);
  for (const e of team.board) {
    const uid = `${side}-${e.slot}`;
    cells[e.slot - 1] = (
      <div className="battle-unit">
        <Card data={entryCard(e, team)} size="sm" atkOverride={frame?.atk[uid]} powerOverride={frame?.power[uid]} acting={frame?.acting.has(uid)} />
        <span className="acts">행동 {frame?.acts[uid] ?? 0}</span>
      </div>
    );
  }
  return (
    <div className={`battle-side side${side}`}>
      <h3>{title}</h3>
      <BoardGrid cells={cells} day={day} compact />
    </div>
  );
}

export function BattleView({ battle, speed, onSpeed, onDone }: { battle: DayBattle; speed: string; onSpeed: (s: string) => void; onDone: () => void }) {
  const r = battle.result;
  const frames = useMemo(() => buildFrames(r), [r]);
  const [i, setI] = useState(speed === 'skip' ? frames.length - 1 : -1);
  const [paused, setPaused] = useState(false);
  const logRef = useRef<HTMLDivElement>(null);
  const done = i >= frames.length - 1;

  useEffect(() => {
    if (done || paused || speed === 'skip') return;
    const id = setTimeout(() => setI((x) => x + 1), DELAY[speed] ?? 85);
    return () => clearTimeout(id);
  }, [i, done, paused, speed]);

  useEffect(() => {
    logRef.current?.scrollTo({ top: logRef.current.scrollHeight });
  }, [i]);

  const frame = i >= 0 ? frames[i] : null;
  const hp = frame?.hp ?? r.timeline[0].hp;
  const shield = frame?.shield ?? [0, 0];
  const t = frame?.t ?? 0;
  const shown = frames.slice(Math.max(0, i - 60), i + 1);
  const gained = battle.gains ? gainSummaryText(battle.gains) : rawGainsText(r.gains[0], battle.input.player);

  return (
    <div className="battle">
      <div className="battle-head panel">
        <div>
          <strong>{NODE_NAMES[battle.node.kind]} 노드</strong> · 환경 {ENV_NAMES[battle.node.env]} · 상대 {battle.match.team.name}
          <span className="muted"> [매칭: {battle.match.stage}]</span>
        </div>
        <div className="battle-controls">
          <span className="clock">{(t / BALANCE.ticksPerSec).toFixed(1)}s</span>
          {!done && <button className="btn" onClick={() => setPaused((p) => !p)}>{paused ? '재생' : '일시정지'}</button>}
          {(['1', '3'] as const).map((s) => (
            <button key={s} className={`btn ${speed === s ? 'active' : ''}`} onClick={() => onSpeed(s)}>{s}배속</button>
          ))}
          {!done && <button className="btn" onClick={() => setI(frames.length - 1)}>건너뛰기</button>}
        </div>
      </div>

      <div className="battle-hp">
        <div><span className="side-label p0t">아군</span><HpBar hp={hp[0]} max={r.maxHp[0]} shield={shield[0]} hit={!!frame?.hit[0]} /></div>
        <div><span className="side-label p1t">적군</span><HpBar hp={hp[1]} max={r.maxHp[1]} shield={shield[1]} hit={!!frame?.hit[1]} /></div>
      </div>

      <div className="battle-sides">
        <SideBoard team={battle.input.player} side={0} frame={frame} day={battle.input.day} title="아군" />
        <SideBoard team={battle.input.enemy} side={1} frame={frame} day={battle.input.day} title={`적군 · ${battle.match.team.name}`} />
      </div>

      <div className="battle-log" ref={logRef}>
        {shown.map((f) => (
          <div key={f.t} className="log-tick">
            <span className="log-time">{(f.t / BALANCE.ticksPerSec).toFixed(1)}s</span>
            <div>{f.lines.map((l, k) => <div key={k} className={l.startsWith('아군') ? 'p0t' : l.startsWith('적군') ? 'p1t' : ''}>{l}</div>)}</div>
          </div>
        ))}
      </div>

      {done && (
        <>
          <div className={`result-banner ${battle.win ? 'win' : 'lose'}`}>
            {battle.win ? '승리!' : '패배'} · {(r.endTick / BALANCE.ticksPerSec).toFixed(1)}초 · {r.reason === 'ko' ? 'KO' : '시간 초과 판정'}
            {r.suddenDeath ? ' · 서든데스 발동' : ''}
            <button className="btn primary" onClick={onDone}>계속</button>
          </div>
          {gained && (
            <div className="gain-banner">
              <strong>{battle.gains ? '전투 후 획득' : '획득 예정 (테스트 전투라 반영되지 않음)'}</strong> {gained}
            </div>
          )}
          <Analysis b={battle} />
          <div className="center"><button className="btn primary" onClick={onDone}>계속</button></div>
        </>
      )}
    </div>
  );
}
