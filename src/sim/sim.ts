// 밸런스 시뮬레이터. 설계 문서의 "검증 계획"을 수치로 확인한다.
//   npm run sim -- pairs  [--n 2000] [--day 8] [--seed 1]   무작위 팀 대전: 동률 우대, 전투 길이, 서든데스, 카드 승률, 추가발동
//   npm run sim -- league [--runs 300] [--seed 1] [--write] 봇 풀 런: 골드 전략 비교, 환경 선택률, 매칭 폴백, 보스 승률
//   npm run sim -- slots  [--n 30] [--seed 1]               칸 효과 비교: 같은 유닛을 9칸에 놓고 승률 비교
//   npm run sim -- days   [--n 250] [--seed 1]              일차별 전투 길이 (체력 스케일링 조정용)
//   공통 옵션: --mod 파일.json  (웹 에디터에서 내보낸 모드 데이터로 실행)

import { parseArgs } from 'node:util';
import { BALANCE } from '../config/balance.ts';
import { simulateBattle } from '../battle/engine.ts';
import { hashSeed } from '../core/rng.ts';
import { MONSTER_MAP, MONSTERS } from '../data/monsters.ts';
import { ENV_NAMES } from '../data/types.ts';
import type { EnvId } from '../data/types.ts';
import { buildBotTeam, STRATEGIES, STRATEGY_NAMES } from '../game/bot.ts';
import type { RecordStore } from '../game/matching.ts';
import { loadModFile, loadRecords, saveRecords, SAVE_DIR } from '../game/storage.ts';
import { padEnd, padStart } from '../ui/text.ts';
import { runLeague } from './league.ts';
import { ENVS, runPairs } from './pairs.ts';

const { positionals, values } = parseArgs({
  allowPositionals: true,
  options: {
    n: { type: 'string' },
    day: { type: 'string' },
    runs: { type: 'string' },
    seed: { type: 'string' },
    write: { type: 'boolean' },
    mod: { type: 'string' },
  },
});
if (values.mod) console.log(`모드 적용: ${loadModFile(values.mod)}`);
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
  console.log(`[pairs] ${day}일차 봇 팀 ${n}개 생성 후 대전 중...`);
  const st = runPairs(n, day, SEED);

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

const mode = positionals[0] ?? 'pairs';
const t0 = Date.now();
if (mode === 'pairs') pairs();
else if (mode === 'league') league();
else if (mode === 'slots') slots();
else if (mode === 'days') days();
else console.log('사용법: npm run sim -- pairs|league|slots|days [--n N] [--day D] [--runs R] [--seed S] [--write] [--mod 파일]');
console.log(`\n(${((Date.now() - t0) / 1000).toFixed(1)}초)`);
