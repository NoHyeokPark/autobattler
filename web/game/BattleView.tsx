// 전투 재생. tick 묶음을 짧은 간격으로 연속 재생하고(배속은 재생 속도만 바꾼다), 끝나면 분석을 보여 준다.

import { useEffect, useMemo, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { BALANCE } from '../../src/config/balance.ts';
import { describeStatus } from '../../src/data/describe.ts';
import { leaderVoice } from '../../src/data/leaders.ts';
import { ENV_NAMES, STATUS_IDS } from '../../src/data/types.ts';
import type { Scale } from '../../src/data/types.ts';
import type { TeamSnapshot } from '../../src/battle/types.ts';
import type { DayBattle } from '../../src/game/day.ts';
import { gainSummaryText, rawGainsText } from '../../src/game/run.ts';
import { NODE_NAMES } from '../../src/ui/render.ts';
import { BoardGrid } from '../components/BoardGrid.tsx';
import { Card } from '../components/Card.tsx';
import { Analysis } from './Analysis.tsx';
import { buildFrames, initialUnits, noStatus } from './frames.ts';
import type { Frame, LiveUnit, StatusStacks } from './frames.ts';
import { UnitDetail } from './UnitDetail.tsx';
import { entryCard } from './units.ts';

const DELAY: Record<string, number> = { '1': 260, '3': 85 };

// lost = 괴사 등으로 잃은 최대 체력 (오른쪽 끝 어두운 칸, 회복으로 채울 수 없음)
function HpBar({ hp, max, shield, hit, lost = 0 }: { hp: number; max: number; shield: number; hit: boolean; lost?: number }) {
  const pct = Math.max(0, Math.min(100, (hp / max) * 100));
  const sh = Math.max(0, Math.min(100, (shield / max) * 100));
  const lo = Math.max(0, Math.min(100, (lost / max) * 100));
  return (
    <div className={`hpbar ${hit ? 'hit' : ''}`}>
      <div className="hpbar-fill" style={{ width: `${pct}%` }} />
      {sh > 0 && <div className="hpbar-shield" style={{ width: `${sh}%` }} />}
      {lo > 0 && <div className="hpbar-lost" style={{ width: `${lo}%` }} title={`잃은 최대 체력 ${lost}`} />}
      <span className="hpbar-text">{Math.max(0, hp)} / {max - lost}{lost > 0 ? ` (최대 -${lost})` : ''}{shield > 0 ? ` (+실드 ${shield})` : ''}</span>
    </div>
  );
}

// 체력바 밑의 팀 상태 중첩 (독·화상·재생·강화·가시). 0이면 숨기고, 막 바뀐 값은 잠깐 강조한다.
const NO_STATUS: StatusStacks = noStatus();

function StatusRow({ now, prev }: { now: StatusStacks; prev: StatusStacks | null }) {
  const shown = STATUS_IDS.filter((id) => now[id] > 0);
  return (
    <div className="status-row">
      {shown.length === 0 && <span className="status-none">상태 없음</span>}
      {shown.map((id) => {
        const cfg = BALANCE.statuses[id];
        const changed = prev !== null && prev[id] !== now[id];
        return (
          <span key={id} className={`status-chip status-${id} ${changed ? 'changed' : ''}`} title={`${cfg.name}: ${describeStatus(id)}`}>
            {cfg.name} <strong>{now[id]}</strong>
          </span>
        );
      })}
    </div>
  );
}

// 움찔: 행동한 tick마다 애니메이션 이름을 a/b로 번갈아 바꿔서, 연달아 행동해도 매번 처음부터 다시 튼다.
// 클래스는 다음 행동까지 남겨 두므로 배속이 빨라도 애니메이션이 끝까지 재생된다.
function joltClass(frame: Frame | null, uid: string, animate: boolean) {
  const n = frame?.actPulse[uid] ?? 0;
  return animate && n > 0 ? `jolt-${n % 2 ? 'a' : 'b'}` : '';
}

interface SideProps {
  team: TeamSnapshot;
  side: 0 | 1;
  frame: Frame | null;
  live: Record<string, LiveUnit>;
  day: number;
  title: string;
  animate: boolean;
  selected: string | null;
  onSelect: (uid: string) => void;
}

function SideBoard({ team, side, frame, live, day, title, animate, selected, onSelect, says }: SideProps & { says: Record<string, string> }) {
  const cells: ReactNode[] = Array(9).fill(null);
  for (const e of team.board) {
    const uid = `${side}-${e.slot}`;
    cells[e.slot - 1] = (
      <div className={`battle-unit ${joltClass(frame, uid, animate)}`}>
        <Card
          data={entryCard(e, team)} size="sm" atkOverride={live[uid]?.atk} powerOverride={live[uid]?.power}
          acting={frame?.acting.has(uid)} selected={selected === uid} onClick={() => onSelect(uid)}
        />
        <span className="acts">행동 {live[uid]?.acts ?? 0}</span>
        {says[uid] && <div className={`speech side${side}`} key={says[uid]}>{says[uid]}</div>}
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

// 가운데 칸: 고른 유닛의 상세 정보
function DetailPanel({ battle, uid, live, t, frame, onClose }: { battle: DayBattle; uid: string | null; live: Record<string, LiveUnit>; t: number; frame: Frame | null; onClose: () => void }) {
  const summary = uid ? battle.result.units.find((u) => u.uid === uid) : undefined;
  const team = summary ? (summary.side === 0 ? battle.input.player : battle.input.enemy) : undefined;
  const entry = summary && team?.board.find((e) => e.slot === summary.slot);
  // 비례 출처의 지금 값 (팀 상태 중첩·체력·실드·유닛 수·골드). 전투 시작 전이면 시작 상태
  const source = (sc: Scale): number | undefined => {
    if (!summary) return undefined;
    const me = summary.side;
    const foe = (1 - me) as 0 | 1;
    const hp = frame?.hp ?? battle.result.timeline[0].hp;
    const teamOf = (s: 0 | 1) => (s === 0 ? battle.input.player : battle.input.enemy);
    const count = (s: 0 | 1) => teamOf(s).board.filter((e) =>
      (!sc.tag || (entryCard(e, teamOf(s)).tags ?? []).includes(sc.tag)) && (!sc.kind || sc.kind === e.kind)).length;
    switch (sc.src) {
      case 'gold': return teamOf(me).gold ?? 0;
      case 'allyStatus': return (frame?.statuses[me] ?? noStatus())[sc.status ?? 'poison'];
      case 'enemyStatus': return (frame?.statuses[foe] ?? noStatus())[sc.status ?? 'poison'];
      case 'allyShield': return frame?.shield[me] ?? 0;
      case 'allyMissingHp': return Math.max(0, battle.result.maxHp[me] - (frame?.lostMax[me] ?? 0) - hp[me]);
      case 'enemyMissingHp': return Math.max(0, battle.result.maxHp[foe] - (frame?.lostMax[foe] ?? 0) - hp[foe]);
      case 'allyCount': return count(me);
      case 'enemyCount': return count(foe);
      default: return undefined;
    }
  };
  return (
    <div className="battle-detail">
      {summary && team && entry && live[summary.uid] ? (
        <>
          <button className="btn small ghost detail-close" onClick={onClose}>닫기</button>
          <UnitDetail
            unit={entry} leaderGrowth={team.growth} card={entryCard(entry, team)}
            place={`${Math.floor((entry.slot - 1) / 3) + 1}행 ${((entry.slot - 1) % 3) + 1}열`}
            sideName={summary.side === 0 ? '아군' : '적군'}
            battle={{ summary, live: live[summary.uid], t, source }}
          />
        </>
      ) : (
        <div className="detail-empty muted">
          카드를 누르면 이 전투에서 실제로 적용되는 능력치·추가발동·성장을 여기서 볼 수 있습니다.
          <br />재생 중에도 실시간으로 바뀝니다.
        </div>
      )}
    </div>
  );
}

export function BattleView({ battle, speed, onSpeed, onDone }: { battle: DayBattle; speed: string; onSpeed: (s: string) => void; onDone: () => void }) {
  const r = battle.result;
  const frames = useMemo(() => buildFrames(r), [r]);
  const startUnits = useMemo(() => initialUnits(r), [r]);
  const [selected, setSelected] = useState<string | null>(null);
  const [i, setI] = useState(speed === 'skip' ? frames.length - 1 : -1);
  const [paused, setPaused] = useState(false);
  const logRef = useRef<HTMLDivElement>(null);
  const done = i >= frames.length - 1;
  // 리더 대사: 전투 시작 3초 동안, 팀 체력이 처음 30% 이하가 된 뒤 3초 동안 말풍선
  const voices = useMemo(() => ([0, 1] as const).map((s) => {
    const team = s === 0 ? battle.input.player : battle.input.enemy;
    return leaderVoice(team.leaderId, team.growth);
  }), [battle]);
  const lowAt = useMemo(() => ([0, 1] as const).map((s) => frames.find((f) => f.hp[s] * 100 <= 30 * (r.maxHp[s] - f.lostMax[s]))?.t ?? null), [frames, r]);
// 지금 말풍선: 최근 2초 안의 능력 대사가 먼저, 없으면 리더의 상황 대사
  const saysAt = (side: 0 | 1, t: number): Record<string, string> => {
    const out: Record<string, string> = {};
    if (done) return out;
    for (let k = i; k >= 0 && t - frames[k].t < 2 * BALANCE.ticksPerSec; k--) {
      for (const [uid, text] of Object.entries(frames[k].says)) if (uid.startsWith(`${side}-`) && !(uid in out)) out[uid] = text;
    }
    const team = side === 0 ? battle.input.player : battle.input.enemy;
    const leader = team.board.find((e) => e.kind === 'leader');
    const line = sayFor(side, t);
    if (leader && line && !(`${side}-${leader.slot}` in out)) out[`${side}-${leader.slot}`] = line;
    return out;
  };
  const sayFor = (s: 0 | 1, t: number): string | undefined => {
    if (done) return undefined;
    const low = lowAt[s];
    const lines = s === 0 ? voices[s].lines : voices[s].rival; // 상대 리더는 "상대일 때" 대사
    if (low !== null && t >= low && t < low + 3 * BALANCE.ticksPerSec) return lines.lowHp;
    if (t < 3 * BALANCE.ticksPerSec) return lines.battleStart;
    return undefined;
  };

  useEffect(() => {
    if (done || paused || speed === 'skip') return;
    const id = setTimeout(() => setI((x) => x + 1), DELAY[speed] ?? 85);
    return () => clearTimeout(id);
  }, [i, done, paused, speed]);

  useEffect(() => {
    logRef.current?.scrollTo({ top: logRef.current.scrollHeight });
  }, [i]);

  const frame = i >= 0 ? frames[i] : null;
  const prevFrame = i >= 1 ? frames[i - 1] : null;
  const hp = frame?.hp ?? r.timeline[0].hp;
  const shield = frame?.shield ?? [0, 0];
  const t = frame?.t ?? 0;
  const live = frame?.units ?? startUnits;
  const onSelect = (uid: string) => setSelected((s) => (s === uid ? null : uid));
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
        {([0, 1] as const).map((side) => (
          <div key={side} className="battle-hp-side">
            <div className="battle-hp-bar">
              <span className={`side-label p${side}t`}>{side === 0 ? '아군' : '적군'}</span>
              <HpBar hp={hp[side]} max={r.maxHp[side]} shield={shield[side]} hit={!!frame?.hit[side]} lost={frame?.lostMax[side] ?? 0} />
            </div>
            <StatusRow now={frame?.statuses[side] ?? NO_STATUS} prev={prevFrame?.statuses[side] ?? null} />
          </div>
        ))}
      </div>

      <div className="battle-sides">
        <SideBoard team={battle.input.player} side={0} frame={frame} live={live} day={battle.input.day} title="아군" animate={!done} selected={selected} onSelect={onSelect} says={saysAt(0, t)} />
        <DetailPanel battle={battle} uid={selected} live={live} t={t} frame={frame} onClose={() => setSelected(null)} />
        <SideBoard team={battle.input.enemy} side={1} frame={frame} live={live} day={battle.input.day} title={`적군 · ${battle.match.team.name}`} animate={!done} selected={selected} onSelect={onSelect} says={saysAt(1, t)} />
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
            {(battle.win ? voices[0].lines.win : voices[0].lines.lose) && <span className="banner-quote">“{battle.win ? voices[0].lines.win : voices[0].lines.lose}”</span>}
            {(battle.win ? voices[1].rival.lose : voices[1].rival.win) && <span className="banner-quote rival">상대: “{battle.win ? voices[1].rival.lose : voices[1].rival.win}”</span>}
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
