// 테스트 도구: 원하는 두 팀을 직접 짜서 전투를 돌려 보고(재생 + 분석), 봇 팀 대전으로 카드 승률을 빠르게 본다.
// 적용된 데이터 기준으로 계산한다 (초안은 "적용" 후 반영).

import { useState } from 'react';
import { BALANCE } from '../../src/config/balance.ts';
import { simulateBattle } from '../../src/battle/engine.ts';
import type { BoardEntry, TeamSnapshot } from '../../src/battle/types.ts';
import { hashSeed } from '../../src/core/rng.ts';
import { LEADER_MAP, LEADERS } from '../../src/data/leaders.ts';
import { MONSTER_MAP, MONSTERS } from '../../src/data/monsters.ts';
import { maxGrowthCount, unitGrowthPool } from '../../src/data/growth.ts';
import { TRINKETS } from '../../src/data/trinkets.ts';
import { ENV_NAMES, GRADE_NAMES } from '../../src/data/types.ts';
import type { EnvId } from '../../src/data/types.ts';
import type { DayBattle } from '../../src/game/day.ts';
import { buildBotTeam } from '../../src/game/bot.ts';
import { ENVS, runPairs } from '../../src/sim/pairs.ts';
import type { PairsStats } from '../../src/sim/pairs.ts';
import { BattleView } from '../game/BattleView.tsx';
import { Check, Field, NumInput, Select } from './fields.tsx';

interface Setup {
  leaderId: string;
  leaderLevel: number;
  growth: string[];
  cells: ({ kind: 'leader' | 'monster'; defId: string; level: number; growth?: string[] } | null)[];
  trinkets: string[];
}

function emptySetup(leaderId: string): Setup {
  const cells: Setup['cells'] = Array(9).fill(null);
  cells[4] = { kind: 'leader', defId: leaderId, level: 1 };
  return { leaderId, leaderLevel: 1, growth: [], cells, trinkets: [] };
}

function toTeam(s: Setup, name: string): TeamSnapshot {
  const board: BoardEntry[] = [];
  s.cells.forEach((c, i) => {
    if (!c) return;
    if (c.kind === 'leader') board.push({ slot: i + 1, kind: 'leader', defId: s.leaderId, level: s.leaderLevel });
    else if (MONSTER_MAP[c.defId]) board.push({ slot: i + 1, kind: 'monster', defId: c.defId, level: c.level, ...(c.growth?.length ? { growth: [...c.growth] } : {}) });
  });
  return { name, leaderId: s.leaderId, leaderLevel: s.leaderLevel, growth: s.growth.filter((g) => LEADER_MAP[s.leaderId]?.growth.some((x) => x.id === g)), board, trinkets: [...s.trinkets] };
}

function fromTeam(t: TeamSnapshot): Setup {
  const cells: Setup['cells'] = Array(9).fill(null);
  for (const e of t.board) cells[e.slot - 1] = { kind: e.kind, defId: e.defId, level: e.level, growth: e.growth ? [...e.growth] : undefined };
  return { leaderId: t.leaderId, leaderLevel: t.leaderLevel, growth: [...t.growth], cells, trinkets: [...t.trinkets] };
}

// 몬스터 성장 선택 (전용 + 공용). 실제 게임에서 Lv2는 1개, Lv3은 합성한 Lv2 3장의 성장(최대 3개)을 가진다.
function GrowthPicker({ cell, onChange }: { cell: { defId: string; level: number; growth?: string[] }; onChange: (g: string[]) => void }) {
  const chosen = cell.growth ?? [];
  const pool = unitGrowthPool(cell.defId);
  return (
    <details className="sandbox-growth">
      <summary>성장 {chosen.length}/{maxGrowthCount(cell.level)}{chosen.length ? `: ${chosen.map((id) => pool.find((g) => g.id === id)?.name ?? id).join(', ')}` : ''}</summary>
      {pool.map((g) => (
        <Check
          key={g.id}
          label={g.name}
          value={chosen.includes(g.id)}
          onChange={(on) => onChange(on ? [...chosen, g.id] : chosen.filter((x) => x !== g.id))}
        />
      ))}
    </details>
  );
}

function SideSetup({ title, s, onChange }: { title: string; s: Setup; onChange: (s: Setup) => void }) {
  const set = (fn: (x: Setup) => void) => {
    const next = structuredClone(s);
    fn(next);
    onChange(next);
  };
  const unitOpts: [string, string][] = [
    ['', '(빈 칸)'],
    ['@leader', `[리더] ${LEADER_MAP[s.leaderId]?.name ?? ''}`],
    ...MONSTERS.map((m): [string, string] => [m.id, `${GRADE_NAMES[m.grade]} · ${m.name}`]),
  ];
  const leader = LEADER_MAP[s.leaderId];
  return (
    <div className="panel sandbox-side">
      <h3>{title}</h3>
      <div className="inline wrap">
        <Field label="리더">
          <Select value={s.leaderId} options={LEADERS.map((l): [string, string] => [l.id, l.name])} onChange={(v) => set((x) => { x.leaderId = v; x.growth = []; })} />
        </Field>
        <Field label="리더 레벨"><NumInput value={s.leaderLevel} min={1} width={60} onChange={(v) => set((x) => { x.leaderLevel = v; })} /></Field>
      </div>
      <div className="sandbox-grid">
        {s.cells.map((c, i) => (
          <div key={i} className="sandbox-cell">
            <span className="slot-no">{i + 1}</span>
            <Select
              value={c ? (c.kind === 'leader' ? '@leader' : c.defId) : ''}
              options={unitOpts}
              onChange={(v) => set((x) => {
                if (v === '@leader') x.cells = x.cells.map((y) => (y?.kind === 'leader' ? null : y));
                x.cells[i] = v === '' ? null : v === '@leader' ? { kind: 'leader', defId: x.leaderId, level: 1 } : { kind: 'monster', defId: v, level: c?.kind === 'monster' ? c.level : 1 };
              })}
            />
            {c?.kind === 'monster' && (
              <Select value={c.level} options={[[1, 'Lv1'], [2, 'Lv2'], [3, 'Lv3']]} onChange={(v) => set((x) => { x.cells[i]!.level = v; })} />
            )}
            {c?.kind === 'monster' && MONSTER_MAP[c.defId] && <GrowthPicker cell={c} onChange={(g) => set((x) => { x.cells[i]!.growth = g; })} />}
          </div>
        ))}
      </div>
      {leader && (
        <details>
          <summary>리더 성장 ({s.growth.length})</summary>
          <div className="tag-checks">
            {leader.growth.map((g) => (
              <span key={g.id} className="inline">
                {g.name}
                <NumInput width={44} min={0} value={s.growth.filter((x) => x === g.id).length} onChange={(n) => set((x) => {
                  x.growth = x.growth.filter((y) => y !== g.id).concat(Array(g.repeatable ? n : Math.min(n, 1)).fill(g.id));
                })} />
              </span>
            ))}
          </div>
        </details>
      )}
      <details>
        <summary>장신구 ({s.trinkets.length})</summary>
        <div className="tag-checks">
          {TRINKETS.map((t) => (
            <span key={t.id} className="inline" title="같은 장신구를 여러 개 가지면 효과가 중첩됩니다">
              {t.name} ({GRADE_NAMES[t.grade]})
              <NumInput width={44} min={0} value={s.trinkets.filter((y) => y === t.id).length} onChange={(n) => set((x) => {
                x.trinkets = x.trinkets.filter((y) => y !== t.id).concat(Array(n).fill(t.id));
              })} />
            </span>
          ))}
        </div>
      </details>
    </div>
  );
}

const pct = (a: number, b: number) => (b ? `${((a / b) * 100).toFixed(1)}%` : '-');
const median = (xs: number[]) => (xs.length ? [...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)] : 0);

export function Sandbox({ dirty, onApply }: { dirty: boolean; onApply: () => void }) {
  const firstLeader = LEADERS[0]?.id ?? '';
  const [day, setDay] = useState(6);
  const [env, setEnv] = useState<EnvId>('normal');
  const [a, setA] = useState<Setup>(() => fromTeam(buildBotTeam(6, 1)));
  const [b, setB] = useState<Setup>(() => fromTeam(buildBotTeam(6, 2)));
  const [battle, setBattle] = useState<DayBattle | null>(null);
  const [speed, setSpeed] = useState('skip');
  const [stats, setStats] = useState<PairsStats | null>(null);
  const [statN, setStatN] = useState(200);
  const [busy, setBusy] = useState(false);

  const run = () => {
    const player = toTeam(a, '아군 테스트 팀');
    const enemy = toTeam(b, '적군 테스트 팀');
    const result = simulateBattle({ player, enemy, env, day, seed: 1 });
    setBattle({
      node: { kind: 'normal', env },
      match: { team: enemy, stage: '테스트', recordId: null },
      input: { player, enemy, env, day, seed: 1 },
      result,
      win: result.winner === 0,
    });
  };

  if (battle) {
    return <BattleView battle={battle} speed={speed} onSpeed={setSpeed} onDone={() => setBattle(null)} />;
  }

  return (
    <div className="sandbox">
      {dirty && (
        <div className="banner warn">
          적용하지 않은 변경 사항이 있습니다. 테스트는 적용된 데이터로 계산합니다.
          <button className="btn small primary" onClick={onApply}>초안 적용</button>
        </div>
      )}
      <section className="panel">
        <h3>전투 테스트</h3>
        <div className="inline wrap">
          <Field label="일차" hint="1행 x값·환경 수치에 영향"><NumInput value={day} min={1} width={60} onChange={setDay} /></Field>
          <Field label="환경"><Select value={env} options={ENVS.map((e): [EnvId, string] => [e, ENV_NAMES[e]])} onChange={setEnv} /></Field>
          <Field label="재생"><Select value={speed} options={[['skip', '결과만'], ['3', '3배속'], ['1', '1배속']]} onChange={setSpeed} /></Field>
          <button className="btn primary" onClick={run}>전투 실행</button>
          <button className="btn" onClick={() => { setA(b); setB(a); }}>좌우 바꾸기</button>
          <button className="btn" onClick={() => setA(fromTeam(buildBotTeam(day, hashSeed('sbA', Date.now()))))}>아군 무작위 봇 팀</button>
          <button className="btn" onClick={() => setB(fromTeam(buildBotTeam(day, hashSeed('sbB', Date.now()))))}>적군 무작위 봇 팀</button>
          <button className="btn ghost" onClick={() => { setA(emptySetup(firstLeader)); setB(emptySetup(firstLeader)); }}>비우기</button>
        </div>
        <p className="muted small">아군 = 플레이어 측(동률 시 우선). 칸 번호는 1행 1열이 1, 3행 3열이 9.</p>
        <div className="sandbox-sides">
          <SideSetup title="아군 (플레이어)" s={a} onChange={setA} />
          <SideSetup title="적군 (기록)" s={b} onChange={setB} />
        </div>
      </section>

      <section className="panel">
        <h3>빠른 밸런스 통계 (봇 팀 대전)</h3>
        <div className="inline wrap">
          <Field label="일차"><NumInput value={day} min={1} width={60} onChange={setDay} /></Field>
          <Field label="팀 수"><NumInput value={statN} min={2} width={80} onChange={setStatN} /></Field>
          <button className="btn primary" disabled={busy} onClick={() => {
            setBusy(true);
            setTimeout(() => { setStats(runPairs(statN, day, hashSeed('web-pairs', Date.now()))); setBusy(false); }, 20);
          }}>{busy ? '계산 중...' : '실행'}</button>
          <span className="muted small">각 팀을 무작위 상대와 양 진영으로 붙입니다 (터미널: npm run sim -- pairs)</span>
        </div>
        {stats && (
          <div className="stats">
            <p>
              {stats.battles}전 · 플레이어 측 승률 {pct(stats.playerWins, stats.battles)} · 진영만 바꿔 승패가 뒤집힌 매치 {pct(stats.flips, stats.n)}
            </p>
            <table className="table">
              <thead><tr><th>환경</th><th>전투</th><th>중앙값(초)</th><th>서든데스</th><th>t=0 종료</th><th>3초 내 종료</th></tr></thead>
              <tbody>
                {ENVS.map((e) => (
                  <tr key={e}>
                    <td>{ENV_NAMES[e]}</td>
                    <td>{stats.lengths[e].length}</td>
                    <td>{median(stats.lengths[e]).toFixed(1)}</td>
                    <td>{pct(stats.sudden[e], stats.lengths[e].length)}</td>
                    <td>{pct(stats.instant[e], stats.lengths[e].length)}</td>
                    <td>{pct(stats.fast[e], stats.lengths[e].length)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            <div className="stats-cols">
              <table className="table">
                <thead><tr><th>몬스터</th><th>등급</th><th>등장</th><th>승률</th></tr></thead>
                <tbody>
                  {stats.monsters.filter((m) => m.games >= 10 && MONSTER_MAP[m.id]).map((m) => {
                    const rate = m.wins / m.games;
                    return (
                      <tr key={m.id}>
                        <td>{MONSTER_MAP[m.id].name}</td>
                        <td>{GRADE_NAMES[MONSTER_MAP[m.id].grade]}</td>
                        <td>{m.games}</td>
                        <td className={rate > 0.58 ? 'hot' : rate < 0.42 ? 'cold' : ''}>
                          <span className="rate-bar" style={{ width: `${rate * 100}%` }} />
                          {pct(m.wins, m.games)}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
              <table className="table">
                <thead><tr><th>팀 추가발동 합</th><th>팀 수</th><th>평균 행동</th><th>승률</th></tr></thead>
                <tbody>
                  {stats.extraBuckets.map((x) => (
                    <tr key={x.lo}>
                      <td>{x.hi === Infinity ? `${x.lo}+` : `${x.lo}~${x.hi}`}</td>
                      <td>{x.n}</td>
                      <td>{x.n ? (x.acts / x.n).toFixed(1) : '-'}</td>
                      <td>{pct(x.wins, x.n)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <p className="muted small">승률 58% 초과는 빨강, 42% 미만은 파랑. 등장 10회 미만은 숨김. 기준 {BALANCE.ticksPerSec} tick = 1초.</p>
          </div>
        )}
      </section>
    </div>
  );
}
