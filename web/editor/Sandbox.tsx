// 테스트 도구: 원하는 두 팀을 직접 짜서 전투를 돌려 보고(재생 + 분석), 봇 팀 대전으로 카드 승률을 빠르게 본다.
// 적용된 데이터 기준으로 계산한다 (초안은 "적용" 후 반영).

import { useState } from 'react';
import { BALANCE } from '../../src/config/balance.ts';
import { simulateBattle } from '../../src/battle/engine.ts';
import type { BoardEntry, TeamSnapshot } from '../../src/battle/types.ts';
import { hashSeed } from '../../src/core/rng.ts';
import { LEADER_MAP, LEADERS, leaderPath } from '../../src/data/leaders.ts';
import { MONSTER_MAP, MONSTERS } from '../../src/data/monsters.ts';
import { findUnitGrowth, maxGrowthCount, unitGrowthPool } from '../../src/data/growth.ts';
import { statModsText } from '../../src/data/describe.ts';
import type { GrowthDef, StatMods } from '../../src/data/types.ts';
import { PERMANENT_STATS } from '../../src/data/types.ts';
import { TRINKET_MAP, TRINKETS } from '../../src/data/trinkets.ts';
import { ENV_NAMES, GRADE_NAMES } from '../../src/data/types.ts';
import type { EnvId } from '../../src/data/types.ts';
import type { DayBattle } from '../../src/game/day.ts';
import { buildBotTeam } from '../../src/game/bot.ts';
import { ENVS, runPairs } from '../../src/sim/pairs.ts';
import type { PairsStats } from '../../src/sim/pairs.ts';
import { BattleView } from '../game/BattleView.tsx';
import { Check, Field, NumInput, Select } from './fields.tsx';

// leaderId ''이면 리더 없는 팀 (몬스터 밸런스 테스트용)
export interface Setup {
  leaderId: string;
  leaderLevel: number;
  growth: string[];
  cells: ({ kind: 'leader' | 'monster'; defId: string; level: number; growth?: string[]; bonus?: StatMods } | null)[]; // bonus = 전투 밖에서 쌓인 영구 강화
  trinkets: string[];
}

export function emptySetup(leaderId: string): Setup {
  const cells: Setup['cells'] = Array(9).fill(null);
  if (leaderId) cells[4] = { kind: 'leader', defId: leaderId, level: 1 };
  return { leaderId, leaderLevel: 1, growth: [], cells, trinkets: [] };
}

// 0인 항목은 빼고, 다 비면 bonus 자체를 뺀다
function bonusOf(b: StatMods | undefined): { bonus?: StatMods } {
  const clean = Object.fromEntries(Object.entries(b ?? {}).filter(([, v]) => v)) as StatMods;
  return Object.keys(clean).length ? { bonus: clean } : {};
}

const BONUS_LABELS: Record<string, string> = { atk: '공격력', hp: '체력', power: '주문력', haste: '가속', extra: '추가발동' };

// 영구 강화 (전투 밖에서 쌓인 스택: 망념의 로아·킹 슬라임 등). 플레이 기록에서 가져온 팀은 쌓인 값이 그대로 들어온다
function BonusPicker({ value, onChange }: { value: StatMods | undefined; onChange: (b: StatMods | undefined) => void }) {
  const text = statModsText(value);
  return (
    <details className="sandbox-growth">
      <summary>영구 강화{text ? `: ${text}` : ' 없음'}</summary>
      <div className="bonus-grid">
        {PERMANENT_STATS.map((k) => (
          <span key={k} className="inline">
            {BONUS_LABELS[k] ?? k}
            <NumInput width={52} value={value?.[k] ?? 0} onChange={(v) => onChange(bonusOf({ ...value, [k]: v }).bonus)} />
          </span>
        ))}
      </div>
    </details>
  );
}

export function toTeam(s: Setup, name: string): TeamSnapshot {
  const board: BoardEntry[] = [];
  s.cells.forEach((c, i) => {
    if (!c) return;
    if (c.kind === 'leader') {
      if (LEADER_MAP[s.leaderId]) board.push({ slot: i + 1, kind: 'leader', defId: s.leaderId, level: s.leaderLevel, ...bonusOf(c.bonus) });
    } else if (MONSTER_MAP[c.defId]) board.push({ slot: i + 1, kind: 'monster', defId: c.defId, level: c.level, ...(c.growth?.length ? { growth: [...c.growth] } : {}), ...bonusOf(c.bonus) });
  });
  const l = LEADER_MAP[s.leaderId];
  const known = (g: string) => !!l && (l.growth.some((x) => x.id === g) || !!l.promotions?.some((x) => x.id === g));
  return { name, leaderId: s.leaderId, leaderLevel: s.leaderLevel, growth: s.growth.filter(known), board, trinkets: [...s.trinkets] };
}

export function fromTeam(t: TeamSnapshot): Setup {
  const cells: Setup['cells'] = Array(9).fill(null);
  for (const e of t.board) cells[e.slot - 1] = { kind: e.kind, defId: e.defId, level: e.level, growth: e.growth ? [...e.growth] : undefined, bonus: e.bonus ? { ...e.bonus } : undefined };
  return { leaderId: t.leaderId, leaderLevel: t.leaderLevel, growth: [...t.growth], cells, trinkets: [...t.trinkets] };
}

// 몬스터 성장 선택 (전용 + 공용). 실제 게임에서 Lv2는 1개, Lv3은 합성한 Lv2 3장의 성장(최대 3개)을 가진다.
function GrowthPicker({ cell, onChange }: { cell: { defId: string; level: number; growth?: string[] }; onChange: (g: string[]) => void }) {
  const chosen = cell.growth ?? [];
  // 게임과 같은 규칙의 후보 + 이미 체크한 것 (해제할 수 있게)
  const base = unitGrowthPool(cell.defId, chosen);
  // 전직은 최고 레벨에서만, 하나만 (게임에서는 반드시 전직하지만 비교용으로 빼 볼 수 있게 둔다)
  const promos = cell.level >= BALANCE.unit.maxLevel ? MONSTER_MAP[cell.defId]?.promotions ?? [] : [];
  const pool = [...base, ...chosen.filter((id) => !base.some((g) => g.id === id) && !promos.some((p) => p.id === id)).map((id) => findUnitGrowth(cell.defId, id)).filter((g): g is GrowthDef => !!g)];
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
      {promos.length > 0 && (
        <div className="sandbox-promos">
          <span className="muted small">전직 (Lv{BALANCE.unit.maxLevel}, 하나만)</span>
          {promos.map((g) => (
            <Check
              key={g.id}
              label={g.name}
              value={chosen.includes(g.id)}
              onChange={(on) => onChange([...chosen.filter((x) => !promos.some((p) => p.id === x)), ...(on ? [g.id] : [])])}
            />
          ))}
        </div>
      )}
    </details>
  );
}

export function SideSetup({ title, s, onChange }: { title: string; s: Setup; onChange: (s: Setup) => void }) {
  const set = (fn: (x: Setup) => void) => {
    const next = structuredClone(s);
    fn(next);
    onChange(next);
  };
  const unitOpts: [string, string][] = [
    ['', '(빈 칸)'],
    ...(s.leaderId ? [['@leader', `[리더] ${LEADER_MAP[s.leaderId]?.name ?? ''}`] as [string, string]] : []),
    ...MONSTERS.map((m): [string, string] => [m.id, `${GRADE_NAMES[m.grade]} · ${m.name}`]),
  ];
  const leader = LEADER_MAP[s.leaderId];
  // 칸 위치 바꾸기: 손잡이(⠿)를 끌어 다른 칸에 놓으면 두 칸의 내용(리더 포함)을 맞바꾼다. 같은 팀 안에서만
  const [dragFrom, setDragFrom] = useState<number | null>(null);
  const [dragOver, setDragOver] = useState<number | null>(null);
  const endDrag = () => {
    setDragFrom(null);
    setDragOver(null);
  };
  const dropOn = (i: number) => {
    const from = dragFrom;
    endDrag();
    if (from === null || from === i) return;
    set((x) => {
      [x.cells[from], x.cells[i]] = [x.cells[i], x.cells[from]];
    });
  };
  return (
    <div className="panel sandbox-side">
      <h3>{title}</h3>
      <div className="inline wrap">
        <Field label="리더">
          <Select value={s.leaderId} options={[['', '(리더 없음)'], ...LEADERS.map((l): [string, string] => [l.id, l.name])]} onChange={(v) => set((x) => {
            x.leaderId = v;
            x.growth = [];
            if (!v) x.cells = x.cells.map((y) => (y?.kind === 'leader' ? null : y));
            else if (!x.cells.some((y) => y?.kind === 'leader')) {
              const at = x.cells[4] ? x.cells.findIndex((y) => !y) : 4;
              if (at >= 0) x.cells[at] = { kind: 'leader', defId: v, level: 1 };
            }
          })} />
        </Field>
        {s.leaderId && <Field label="리더 레벨"><NumInput value={s.leaderLevel} min={1} width={60} onChange={(v) => set((x) => { x.leaderLevel = v; })} /></Field>}
      </div>
      <div className="sandbox-grid">
        {s.cells.map((c, i) => (
          <div
            key={i}
            className={`sandbox-cell${dragFrom === i ? ' dragging' : ''}${dragOver === i && dragFrom !== null && dragFrom !== i ? ' drop-target' : ''}`}
            onDragOver={(e) => {
              if (dragFrom === null) return;
              e.preventDefault();
              e.dataTransfer.dropEffect = 'move';
              if (dragOver !== i) setDragOver(i);
            }}
            onDragLeave={(e) => {
              if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setDragOver((o) => (o === i ? null : o));
            }}
            onDrop={(e) => {
              e.preventDefault();
              dropOn(i);
            }}
          >
            <span className="slot-no">{i + 1}</span>
            <span
              className="cell-grip"
              draggable
              title="끌어서 다른 칸과 위치 바꾸기"
              onDragStart={(e) => {
                setDragFrom(i);
                e.dataTransfer.effectAllowed = 'move';
                e.dataTransfer.setData('text/plain', String(i + 1));
                const cell = e.currentTarget.parentElement;
                if (cell) e.dataTransfer.setDragImage(cell, 20, 10);
              }}
              onDragEnd={endDrag}
            >⠿</span>
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
            {c && <BonusPicker value={c.bonus} onChange={(b) => set((x) => { x.cells[i]!.bonus = b; })} />}
          </div>
        ))}
      </div>
      {leader && (
        <details>
          <summary>리더 성장 ({s.growth.length}){leaderPath(leader.id, s.growth) ? ` · 전직: ${leaderPath(leader.id, s.growth)!.name}` : ''}</summary>
          {!!leader.promotions?.length && (
            <div className="inline wrap sandbox-promos">
              <span className="muted small">전직 (하나만{s.leaderLevel < (BALANCE.leader.promotionLevels[0] ?? 1) ? `, 게임에서는 Lv${BALANCE.leader.promotionLevels[0]}부터` : ''})</span>
              {leader.promotions.map((g) => (
                <Check
                  key={g.id}
                  label={`${g.name}${g.mastery ? ' (본질 강화)' : ''}`}
                  value={s.growth.includes(g.id)}
                  onChange={(on) => set((x) => {
                    x.growth = [...x.growth.filter((y) => !leader.promotions!.some((p) => p.id === y)), ...(on ? [g.id] : [])];
                  })}
                />
              ))}
            </div>
          )}
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
  const [node, setNode] = useState<'normal' | 'elite' | 'boss'>('normal'); // 능력의 보스·엘리트전 조건 확인용
  const [a, setA] = useState<Setup>(() => fromTeam(buildBotTeam(6, 1)));
  const [b, setB] = useState<Setup>(() => fromTeam(buildBotTeam(6, 2)));
  const [battle, setBattle] = useState<DayBattle | null>(null);
  const [speed, setSpeed] = useState('skip');
  const [stats, setStats] = useState<PairsStats | null>(null);
  const [statN, setStatN] = useState(200);
  const [dummyOn, setDummyOn] = useState(false); // 리더를 더미로 (리더 변수 없이 몬스터 카드 승률 보기)
  const [dummyHp, setDummyHp] = useState(500);
  const [busy, setBusy] = useState(false);

  const run = () => {
    const player = toTeam(a, '아군 테스트 팀');
    const enemy = toTeam(b, '적군 테스트 팀');
    const result = simulateBattle({ player, enemy, env, day, seed: 1, node });
    setBattle({
      node: { kind: node, env },
      match: { team: enemy, stage: '테스트', recordId: null },
      input: { player, enemy, env, day, seed: 1, node },
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
          <Field label="노드" hint="보스·엘리트전에서만 있는 능력 확인용"><Select value={node} options={[['normal', '일반'], ['elite', '엘리트'], ['boss', '보스']]} onChange={setNode} /></Field>
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
          <Check label="리더를 더미로" value={dummyOn} onChange={setDummyOn} />
          {dummyOn && <Field label="더미 체력" hint="아무 행동도 하지 않는 유닛. 칸 효과·일차 체력 배율은 다른 유닛과 같이 받음"><NumInput value={dummyHp} min={1} width={70} onChange={setDummyHp} /></Field>}
          <button className="btn primary" disabled={busy} onClick={() => {
            setBusy(true);
            setTimeout(() => { setStats(runPairs(statN, day, hashSeed('web-pairs', Date.now()), { dummyLeaderHp: dummyOn ? dummyHp : undefined })); setBusy(false); }, 20);
          }}>{busy ? '계산 중...' : '실행'}</button>
          <span className="muted small">각 팀을 무작위 상대와 양 진영으로 붙입니다 (터미널: npm run sim -- pairs)</span>
        </div>
        {stats && (
          <div className="stats">
            <p>
              {stats.dummyLeaderHp ? <b>리더 = 체력 {stats.dummyLeaderHp} 더미 · </b> : null}{stats.battles}전 · 플레이어 측 승률 {pct(stats.playerWins, stats.battles)} · 진영만 바꿔 승패가 뒤집힌 매치 {pct(stats.flips, stats.n)}
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
                <thead><tr><th>장신구</th><th>등급</th><th>등장</th><th>승률</th></tr></thead>
                <tbody>
                  {stats.trinkets.filter((t) => t.games >= 10 && TRINKET_MAP[t.id]).map((t) => {
                    const rate = t.wins / t.games;
                    return (
                      <tr key={t.id}>
                        <td>{TRINKET_MAP[t.id].name}{TRINKET_MAP[t.id].triggers.length ? '' : ' *'}</td>
                        <td>{GRADE_NAMES[TRINKET_MAP[t.id].grade]}</td>
                        <td>{t.games}</td>
                        <td className={rate > 0.58 ? 'hot' : rate < 0.42 ? 'cold' : ''}>
                          <span className="rate-bar" style={{ width: `${rate * 100}%` }} />
                          {pct(t.wins, t.games)}
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
            <p className="muted small">승률 58% 초과는 빨강, 42% 미만은 파랑. 등장 10회 미만은 숨김. 장신구 * = 전투 능력이 없는 장신구(경제·일회성): 승률은 그 장신구를 고른 팀의 결과일 뿐입니다. 장신구 자체의 전투 효과는 밸런스 테스트 탭의 "장신구 비교"로 재세요. 기준 {BALANCE.ticksPerSec} tick = 1초.</p>
          </div>
        )}
      </section>
    </div>
  );
}
