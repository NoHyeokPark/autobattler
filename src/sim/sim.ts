// 밸런스 시뮬레이터. 설계 문서의 "검증 계획"을 수치로 확인한다.
//   npm run sim -- pairs  [--n 2000] [--day 8] [--seed 1] [--dummy-leader 500]
//                                                        무작위 팀 대전: 동률 우대, 전투 길이, 서든데스, 카드 승률, 추가발동 (--dummy-leader: 리더를 행동 없는 더미로)
//   npm run sim -- league [--runs 300] [--seed 1] [--write] 봇 풀 런: 골드 전략 비교, 환경 선택률, 매칭 폴백, 보스 승률
//   npm run sim -- slots  [--n 30] [--seed 1]               칸 효과 비교: 같은 유닛을 9칸에 놓고 승률 비교
//   npm run sim -- days   [--n 250] [--seed 1]              일차별 전투 길이 (체력 스케일링 조정용)
//   npm run sim -- party  [--day 7] [--n 150] [--foe bots|records] [--record-days 0] [--no-foe-leader] [--no-foe-trinkets] [--leaders keep|none|both] [--accum-from 7] [--league [--rounds 10]] [--trinkets [--trinket-mode add|solo]]
//                                                        밸런스 테스트: 에디터의 "밸런스 테스트" 탭에 저장한 파티(saves/balance-tests.json)를 봇 팀·플레이 기록과 붙여 승률 측정
//                                                        --league: 저장한 파티끼리 리그전 (상성표)
//                                                        --leaders none: 양쪽 리더를 빼고 / both: 리더 포함·제외를 둘 다 재서 차이(리더의 몫)를 본다
//                                                        --trinkets: 저장한 파티 전체에 장신구를 하나씩 넣어 평균 승률 변화 (add = 지금 장신구에 더하기, solo = 그것 하나만)
//                                                        --accum-from 7: 7일차부터 기준 일차 전날까지 하루 한 전투씩 얻은 영구 강화를 쌓고 잰다 (0 = 끔)
//   공통 옵션: 웹 에디터에서 적용한 mods/editor.json이 있으면 자동으로 쓴다.
//             --mod 모드이름 (mods/library/의 이름별 모드) 또는 --mod 파일.json 으로 다른 모드, --no-mod 로 기본 데이터(balance.ts 등)

import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { parseArgs } from 'node:util';
import { BALANCE } from '../config/balance.ts';
import { simulateBattle } from '../battle/engine.ts';
import { hashSeed } from '../core/rng.ts';
import { MONSTER_MAP, MONSTERS } from '../data/monsters.ts';
import { TRINKET_MAP } from '../data/trinkets.ts';
import { ENV_NAMES } from '../data/types.ts';
import type { EnvId } from '../data/types.ts';
import { buildBotTeam, STRATEGIES, STRATEGY_NAMES } from '../game/bot.ts';
import type { RecordStore } from '../game/matching.ts';
import { loadModFile, loadRecords, resolveModPath, saveRecords, SAVE_DIR } from '../game/storage.ts';
import type { TeamSnapshot } from '../battle/types.ts';
import { statModsText } from '../data/describe.ts';
import { padEnd, padStart } from '../ui/text.ts';
import { runLeague } from './league.ts';
import { ENVS, runPairs } from './pairs.ts';
import { accumTotals, avgSec, trinketCandidates, withTrinket, BALANCE_TEST_FILE, buildFoes, DEFAULT_OPTS, hasLeader, leaderRuns, prepareParty, leagueTotals, missingIn, recordFoes, recordTeams, runMatchup, runPartyTest, winPct } from './partyTest.ts';
import type { BalanceTestFile, LeaderMode, PartyTestOpts } from './partyTest.ts';

const { positionals, values } = parseArgs({
  allowPositionals: true,
  options: {
    n: { type: 'string' },
    day: { type: 'string' },
    runs: { type: 'string' },
    seed: { type: 'string' },
    write: { type: 'boolean' },
    mod: { type: 'string' },
    'no-mod': { type: 'boolean' },
    'no-foe-leader': { type: 'boolean' },
    'no-foe-trinkets': { type: 'boolean' },
    leaders: { type: 'string' },
    'dummy-leader': { type: 'string' },
    'accum-from': { type: 'string' },
    trinkets: { type: 'boolean' },
    'trinket-mode': { type: 'string' },
    foe: { type: 'string' },
    'record-days': { type: 'string' },
    league: { type: 'boolean' },
    rounds: { type: 'string' },
  },
});
// 웹 에디터에서 적용한 mods/editor.json이 있으면 자동으로 쓴다 (--no-mod로 끔, --mod로 다른 모드 이름·파일)
let modPath: string | undefined;
try {
  modPath = resolveModPath(values.mod, values['no-mod'] ?? false);
} catch (e) {
  console.error(e instanceof Error ? e.message : String(e));
  process.exit(1);
}
const modName = modPath ? loadModFile(modPath) : '기본 데이터';
if (modPath) console.log(`모드 적용: ${modName} (${modPath}) - 기본 데이터로 하려면 --no-mod`);
const SEED = Number(values.seed ?? 1);

const pct = (a: number, b: number) => (b === 0 ? '  -  ' : `${((a / b) * 100).toFixed(1)}%`);
const avg = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0);
function quantile(xs: number[], q: number): number {
  if (!xs.length) return 0;
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.floor(q * s.length))];
}
function table(rows: string[][], widths: number[]) {
  for (const r of rows) console.log(r.map((c, i) => (i === 0 ? padEnd(c, widths[i]) : padStart(c, widths[i]))).join(' '));
}

// ─────────────────────────────── pairs ───────────────────────────────
function pairs() {
  const n = Number(values.n ?? 2000);
  const day = Number(values.day ?? 8);
  const dummy = values['dummy-leader'] !== undefined ? Number(values['dummy-leader'] || 500) : undefined;
  console.log(`[pairs] ${day}일차 봇 팀 ${n}개 생성 후 대전 중...${dummy ? ` (리더 = 체력 ${dummy} 더미, 행동 없음)` : ''}`);
  const st = runPairs(n, day, SEED, { dummyLeaderHp: dummy });

  console.log(`\n== 동률 우대(플레이어 우선)의 영향 ==`);
  console.log(`  플레이어 측 승률: ${pct(st.playerWins, st.battles)} (${st.battles}전)`);
  console.log(`  진영만 바꿨을 때 승패가 뒤집힌 매치: ${pct(st.flips, n)}`);

  console.log(`\n== 환경별 전투 길이 / 서든데스 / 시작 즉시 종료 ==`);
  const rows = [['환경', '전투수', '평균', 'p10', 'p50', 'p90', '서든데스', 't=0종료', '3초내종료']];
  for (const env of ENVS) {
    const xs = st.lengths[env];
    rows.push([ENV_NAMES[env], String(xs.length), avg(xs).toFixed(1), quantile(xs, 0.1).toFixed(1), quantile(xs, 0.5).toFixed(1), quantile(xs, 0.9).toFixed(1), pct(st.sudden[env], xs.length), pct(st.instant[env], xs.length), pct(st.fast[env], xs.length)]);
  }
  table(rows, [10, 7, 6, 6, 6, 6, 9, 9, 10]);

  console.log(`\n== 카드(몬스터)별 승률 (포함한 팀 기준) ==`);
  const monRows = [['몬스터', '등급', '등장', '승률']];
  for (const m of st.monsters.filter((x) => x.games >= 20)) monRows.push([MONSTER_MAP[m.id].name, String(MONSTER_MAP[m.id].grade), String(m.games), pct(m.wins, m.games)]);
  table(monRows, [14, 4, 6, 7]);

  console.log(`\n== 장신구별 승률 (가진 팀 기준) ==`);
  const triRows = [['장신구', '등급', '등장', '승률']];
  for (const t of st.trinkets.filter((x) => x.games >= 20 && TRINKET_MAP[x.id])) triRows.push([TRINKET_MAP[t.id].name, String(TRINKET_MAP[t.id].grade), String(t.games), pct(t.wins, t.games)]);
  table(triRows, [14, 4, 6, 7]);

  console.log(`\n== 추가발동 합계(팀)별 행동 수·산출량 ==`);
  const exRows = [['추가발동', '팀수', '평균행동', '평균산출', '승률']];
  for (const b of st.extraBuckets) {
    exRows.push([b.hi === Infinity ? `${b.lo}+` : `${b.lo}~${b.hi}`, String(b.n), b.n ? (b.acts / b.n).toFixed(1) : '-', b.n ? (b.out / b.n).toFixed(0) : '-', pct(b.wins, b.n)]);
  }
  table(exRows, [9, 6, 9, 9, 7]);
}

// ─────────────────────────────── league ───────────────────────────────
function league() {
  const runs = Number(values.runs ?? 300);
  const store: RecordStore = values.write ? loadRecords() : { records: [] };
  console.log(`[league] 봇 ${runs}판 진행 중... (시작 기록 ${store.records.length}개)`);
  const st = runLeague(store, runs, SEED);

  console.log(`\n== 전략별 성적 ==`);
  const rows = [['전략', '판수', '평균승', '우승률', '평균점수', '7일내탈락', '전투당골드', '전투당장신구', '최대스택공격', '3패+남긴골드']];
  for (const s of STRATEGIES) {
    const v = st.strategies[s];
    rows.push([
      STRATEGY_NAMES[s], String(v.runs), (v.wins / v.runs).toFixed(2), pct(v.champs, v.runs), (v.score / v.runs).toFixed(2),
      pct(v.earlyOut, v.runs), (v.gold / Math.max(1, v.battles)).toFixed(2), (v.trinkets / Math.max(1, v.battles)).toFixed(2), (v.stack / v.runs).toFixed(1),
      (v.lateGoldLeft / Math.max(1, v.lateShops)).toFixed(1),
    ]);
  }
  table(rows, [14, 5, 7, 7, 9, 9, 10, 12, 12, 12]);
  console.log('  (전투당 골드·장신구 = 능력으로 전투 후 얻은 양. 최대스택공격 = 런 종료 시 보드 최대 영구 공격력. 3패+남긴골드 = 3패 이상일 때 상점 후 남긴 평균 골드)');

  console.log(`\n== 리더 변신·본질 강화별 성적 (봇은 보드에 많이 모인 태그 쪽을 고름. 본질 강화 = 원래 태그) ==`);
  for (const [k, v] of [...st.transforms.entries()].sort()) {
    console.log(`  ${padEnd(k, 26)} ${padStart(String(v.runs), 4)}판  평균승 ${(v.wins / v.runs).toFixed(2)}  우승률 ${pct(v.champs, v.runs)}`);
  }

  console.log(`\n== 노드·환경 선택률 ==`);
  const total = [...st.nodePick.values()].reduce((a, b) => a + b, 0);
  for (const [k, v] of [...st.nodePick.entries()].sort((a, b) => b[1] - a[1])) {
    const [kind, env] = k.split(':');
    console.log(`  ${padEnd(kind, 7)} ${padEnd(ENV_NAMES[env as EnvId], 10)} ${pct(v, total)}`);
  }

  console.log(`\n== 매칭 폴백 단계별 횟수·승률 ==`);
  for (const [k, v] of st.stages) console.log(`  ${padEnd(k, 22)} ${padStart(String(v.n), 6)}회  플레이어 승률 ${pct(v.wins, v.n)}`);

  console.log(`\n== 엘리트·보스 승률 ==`);
  for (const [k, v] of [...st.nodeWin.entries()].sort()) console.log(`  ${padEnd(k, 12)} ${padStart(String(v.n), 5)}회  승률 ${pct(v.wins, v.n)}`);

  console.log(`\n== 기록 상대 전투의 플레이어 측 승률 (환경별) ==`);
  for (const env of ENVS) console.log(`  ${padEnd(ENV_NAMES[env], 10)} ${padStart(String(st.sideByEnv[env].n), 6)}전  ${pct(st.sideByEnv[env].playerWins, st.sideByEnv[env].n)}`);

  console.log(`\n== 인원 제한 ${BALANCE.board.initialDeployLimit}일 때 비워 둔 칸 (봇 배치 기준) ==`);
  console.log('  ' + st.emptySlots.map((v, i) => `${i + 1}:${pct(v, st.limit6Boards)}`).join('  '));

  const exposures = store.records.map((r) => r.exposures).sort((a, b) => b - a);
  console.log(`\n기록 ${store.records.length}개, 최다 노출 ${exposures[0] ?? 0}회, 노출 0회 기록 ${exposures.filter((x) => x === 0).length}개`);
  if (values.write) {
    saveRecords(store);
    console.log(`기록 풀을 ${SAVE_DIR}\\records.json 에 저장했습니다. (게임에서 PvP 상대로 쓰입니다)`);
  }
}

// ─────────────────────────────── slots ───────────────────────────────
function slots() {
  const n = Number(values.n ?? 30);
  const day = 6;
  const bases = Array.from({ length: n }, (_, i) => ({
    base: buildBotTeam(day, hashSeed('slot-base', SEED, i)),
    opp: buildBotTeam(day, hashSeed('slot-opp', SEED, i)),
  }));
  console.log(`[slots] ${day}일차 팀 ${n}쌍, 몬스터(Lv2)를 9칸에 번갈아 놓고 양 진영으로 대전`);
  const header = ['몬스터', ...Array.from({ length: 9 }, (_, i) => `${i + 1}칸`), '최고'];
  const rows = [header];
  const bestCount = Array(9).fill(0);
  for (const m of MONSTERS.filter((x) => x.grade <= 5)) {
    const wins = Array(9).fill(0);
    for (const { base, opp } of bases) {
      const ri = base.board.findIndex((e) => e.kind === 'monster');
      if (ri < 0) continue;
      const vacated = base.board[ri].slot;
      for (let slot = 1; slot <= 9; slot++) {
        const board = base.board.filter((_, k) => k !== ri).map((e) => (e.slot === slot ? { ...e, slot: vacated } : { ...e }));
        board.push({ slot, kind: 'monster', defId: m.id, level: 2 });
        const team = { ...base, board };
        const w1 = simulateBattle({ player: team, enemy: opp, env: 'normal', day, seed: 0 }).winner === 0;
        const w2 = simulateBattle({ player: opp, enemy: team, env: 'normal', day, seed: 0 }).winner === 1;
        wins[slot - 1] += Number(w1) + Number(w2);
      }
    }
    const best = wins.indexOf(Math.max(...wins));
    bestCount[best]++;
    rows.push([m.name, ...wins.map((w) => pct(w, n * 2)), `${best + 1}칸`]);
  }
  table(rows, [14, 7, 7, 7, 7, 7, 7, 7, 7, 7, 5]);
  console.log(`\n칸별로 '최고 칸'이 된 몬스터 수: ${bestCount.map((c, i) => `${i + 1}칸 ${c}`).join(', ')}`);
}

// ─────────────────────────────── days ───────────────────────────────
// 일차별 전투 길이: 일차별 체력 스케일링(balance.scaling.hpPctByDay)을 맞출 때 쓴다.
function days() {
  const n = Number(values.n ?? 250);
  console.log(`[days] 일차마다 봇 팀 ${n}개를 양 진영으로 대전`);
  const rows = [['일차', '체력%', '중앙값', '평균', '서든데스', '3초내종료']];
  for (let day = 1; day <= BALANCE.run.maxDays; day++) {
    const st = runPairs(n, day, SEED);
    const all = ENVS.flatMap((e) => st.lengths[e]);
    const sd = ENVS.reduce((s, e) => s + st.sudden[e], 0);
    const fast = ENVS.reduce((s, e) => s + st.fast[e], 0);
    const hp = BALANCE.scaling.hpPctByDay[Math.min(day, BALANCE.scaling.hpPctByDay.length) - 1];
    rows.push([String(day), `${hp}%`, `${quantile(all, 0.5).toFixed(1)}s`, `${avg(all).toFixed(1)}s`, pct(sd, all.length), pct(fast, all.length)]);
  }
  table(rows, [5, 7, 8, 8, 9, 10]);
}

// ─────────────────────────────── party ───────────────────────────────
function leagueCells(list: { name: string; team: TeamSnapshot }[], o: PartyTestOpts, rounds: number) {
  const k = list.length;
  const cache = new Map<string, TeamSnapshot>();
  const teams = list.map((p) => prepareParty(p.team, o, cache).team); // 리더 빼기·영구 성장 누적은 파티마다 한 번
  o = { ...o, accumFrom: 0 };
  const cells: (number | null)[][] = list.map(() => list.map(() => null));
  for (let i = 0; i < k; i++) {
    for (let j = i + 1; j < k; j++) {
      const m = runMatchup(teams[i], teams[j], o, rounds, `${i}|${j}`);
      cells[i][j] = (100 * m.winsA) / m.battles;
      cells[j][i] = 100 - cells[i][j]!;
    }
  }
  return { cells, total: leagueTotals({ names: list.map((p) => p.name), cells }) };
}

function partyTrinkets(list: { name: string; team: TeamSnapshot }[], foes: TeamSnapshot[], o: PartyTestOpts) {
  const mode = values['trinket-mode'] === 'solo' ? 'solo' : 'add';
  const ro = leaderRuns(o)[0];
  const cache = new Map<string, TeamSnapshot>();
  const cands = trinketCandidates(1, 6);
  const base = list.map((p) => winPct(runPartyTest(withTrinket(p.team, '', mode), foes, ro, undefined, 0, foes.length, cache)));
  console.log(`장신구 비교: 파티 ${list.length}개 · ${mode === 'add' ? '지금 장신구에 더하기' : '이 장신구 하나만'} · 넣기 전 평균 ${(base.reduce((a, b) => a + b, 0) / base.length).toFixed(1)}%\n`);
  const rows = cands.map((id) => {
    const d = list.map((p, k) => winPct(runPartyTest(withTrinket(p.team, id, mode), foes, ro, undefined, 0, foes.length, cache)) - base[k]);
    const hi = d.indexOf(Math.max(...d));
    return { id, mean: d.reduce((a, b) => a + b, 0) / d.length, best: `${list[hi].name} ${d[hi] > 0 ? '+' : ''}${d[hi].toFixed(1)}` };
  });
  const byGrade = new Map<number, number[]>();
  for (const r of rows) byGrade.set(TRINKET_MAP[r.id].grade, [...(byGrade.get(TRINKET_MAP[r.id].grade) ?? []), r.mean]);
  const avgOf = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / xs.length;
  table([['장신구', '등급', '평균 변화', '등급 대비', '가장 오른 파티'], ...rows.sort((a, b) => b.mean - a.mean).map((r) => {
    const g = TRINKET_MAP[r.id].grade;
    return [TRINKET_MAP[r.id].name, String(g), `${r.mean > 0 ? '+' : ''}${r.mean.toFixed(1)}%p`, `${(r.mean - avgOf(byGrade.get(g)!)).toFixed(1)}%p`, r.best];
  })], [14, 4, 10, 10, 30]);
}

function partyLeague(list: { name: string; team: TeamSnapshot }[], o: PartyTestOpts) {
  const rounds = Number(values.rounds ?? 10);
  const [main, alt] = leaderRuns(o).map((ro) => leagueCells(list, ro, rounds));
  const nl = o.leaderMode === 'none';
  console.log(`리그전: ${list.length}개 파티 · ${o.day}일차 · 쌍마다 ${rounds * 2}전${o.accumFrom && o.accumFrom < o.day ? ` · 영구 성장 ${o.accumFrom}일차부터 누적` : ''}${nl ? ' · 양쪽 리더 제외' : alt ? ' · 리더 포함·제외 비교 (상성표는 리더 포함)' : ''}\n`);
  const order = list.map((_, i) => i).sort((a, b) => main.total[b] - main.total[a]);
  const head = ['파티', nl ? '리더 제외' : '리그 승률', ...(alt ? ['리더 제외', '리더 몫'] : []), ...list.map((_, j) => String(j + 1))];
  table([head, ...order.map((i) => [
    `${i + 1}. ${list[i].name}`, `${main.total[i].toFixed(1)}%`,
    ...(alt ? [`${alt.total[i].toFixed(1)}%`, `${(main.total[i] - alt.total[i]).toFixed(1)}%p`] : []),
    ...main.cells[i].map((c) => (c === null ? '·' : c.toFixed(0))),
  ])], [30, 9, ...(alt ? [9, 9] : []), ...list.map(() => 4)]);
}

function party() {
  const file = join(SAVE_DIR, 'balance-tests.json');
  if (!existsSync(file)) return console.log(`${BALANCE_TEST_FILE}가 없습니다. 웹 에디터의 "밸런스 테스트" 탭에서 파티를 만드세요.`);
  const data = JSON.parse(readFileSync(file, 'utf8')) as BalanceTestFile;
  const saved = data.mods?.[modName];
  if (!saved?.parties.length) return console.log(`"${modName}" 모드에 저장된 테스트 파티가 없습니다 (저장된 모드: ${Object.keys(data.mods ?? {}).join(', ') || '없음'})`);
  const o: PartyTestOpts = {
    ...DEFAULT_OPTS, ...saved.opts,
    ...(values.day ? { day: Number(values.day) } : {}), ...(values.n ? { n: Number(values.n) } : {}), ...(values.seed ? { seed: SEED } : {}),
    ...(values['no-foe-leader'] ? { foeLeader: false } : {}), ...(values['no-foe-trinkets'] ? { foeTrinkets: false } : {}),
    ...(values.foe === 'records' || values.foe === 'bots' ? { foeSource: values.foe } : {}), ...(values['record-days'] ? { recordDays: Number(values['record-days']) } : {}),
    ...(['keep', 'none', 'both'].includes(values.leaders ?? '') ? { leaderMode: values.leaders as LeaderMode } : {}),
    ...(values['accum-from'] !== undefined ? { accumFrom: Number(values['accum-from']) } : {}),
  };
  const usable = saved.parties.filter((p) => missingIn(p.team).length === 0);
  if (values.league) return partyLeague(usable.map((p) => ({ name: p.name, team: p.team })), o);
  const store = loadRecords();
  const foes = o.foeSource === 'records' ? recordFoes(store, modName, o) : buildFoes(o);
  if (!foes.length) return console.log(`${o.day}일차(±${o.recordDays}) 플레이 기록이 없습니다. --record-days 로 범위를 넓히거나 league --write 로 기록을 쌓으세요.`);
  const who = o.foeSource === 'records' ? `플레이 기록 ${recordTeams(store, modName, o).length}개(${o.day}일차${o.recordDays ? ` ±${o.recordDays}` : ''})` : `${o.day}일차 봇 팀 ${o.n}개`;
  if (values.trinkets) return partyTrinkets(usable.map((p) => ({ name: p.name, team: p.team })), foes, o);
  const runs = leaderRuns(o);
  const leaders = o.leaderMode === 'none' ? '양쪽 리더 제외' : o.leaderMode === 'both' ? '리더 포함·제외 비교' : `상대 리더 ${o.foeLeader ? '포함' : '제외'}`;
  const accum = o.accumFrom && o.accumFrom < o.day ? ` · 영구 성장 ${o.accumFrom}~${o.day - 1}일차 누적` : '';
  const cache = new Map<string, TeamSnapshot>();
  console.log(`${who}와 양 진영 (${2 * foes.length}전${runs.length > 1 ? ' × 2' : ''}) · ${leaders}${accum} · 상대 장신구 ${o.foeTrinkets ? '포함' : '제외'} · 빈 성장 ${o.fillGrowth ? '무작위' : '없음'}
`);
  const rows = [['파티', '승률', ...(runs.length > 1 ? ['리더 제외', '리더 몫'] : []), '평균', '서든데스', '리더 피해', ...(accum ? ['누적 영구 강화'] : [])]];
  for (const p of saved.parties) {
    const miss = missingIn(p.team);
    if (miss.length) {
      rows.push([p.name, '-', ...(runs.length > 1 ? ['-', '-'] : []), '-', '-', `없는 유닛: ${miss.join(', ')}`]);
      continue;
    }
    const [r, rn] = runs.map((ro) => runPartyTest(p.team, foes, ro, undefined, 0, foes.length, cache));
    const all = r.units.reduce((s, u) => s + u.damage, 0);
    const lead = r.units.filter((u) => u.leader).reduce((s, u) => s + u.damage, 0);
    const split = rn ? [`${winPct(rn).toFixed(1)}%`, hasLeader(p.team) ? `${(winPct(r) - winPct(rn)).toFixed(1)}%p` : '-'] : [];
    rows.push([p.name, `${winPct(r).toFixed(1)}%`, ...split, `${avgSec(r).toFixed(1)}s`, pct(r.sudden, r.battles), hasLeader(p.team) && !runs[0].noLeaders ? pct(lead, all) : '(리더 없음)',
      ...(accum ? [[...accumTotals(r.accum ?? [])].map(([slot, m]) => `${slot}번 ${statModsText(m)}`).join(' / ') || '-'] : [])]);
  }
  table(rows, [24, 7, ...(runs.length > 1 ? [9, 9] : []), 7, 8, 10]);
}

const mode = positionals[0] ?? 'pairs';
const t0 = Date.now();
if (mode === 'pairs') pairs();
else if (mode === 'league') league();
else if (mode === 'slots') slots();
else if (mode === 'days') days();
else if (mode === 'party') party();
else console.log('사용법: npm run sim -- pairs|league|slots|days|party [--n N] [--day D] [--runs R] [--seed S] [--write] [--mod 파일]');
console.log(`\n(${((Date.now() - t0) / 1000).toFixed(1)}초)`);
