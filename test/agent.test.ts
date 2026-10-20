// 에이전트 플레이 모드: 명령 묶음이 게임 함수를 그대로 부르는지 (같은 행동 → 웹·터미널과 같은 결과), 행동 기록으로 다시 실행하면 같은 런이 되는지
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { execute, info, observe, replayActions, rulesText, startRun } from '../src/agent/agent.ts';
import type { AgentAction } from '../src/agent/agent.ts';
import { applyMod, DEFAULT_MOD } from '../src/data/registry.ts';
import { MONSTER_MAP } from '../src/data/monsters.ts';
import { playBattle } from '../src/game/day.ts';
import type { RecordStore } from '../src/game/matching.ts';
import { chooseExtend, chooseGrowth, chooseReward, selectNode } from '../src/game/run.ts';
import { buy, chooseForm, choosePromotion, chooseUnitGrowth, itemCost, move } from '../src/game/shop.ts';
import type { RunState } from '../src/game/state.ts';
import { deployedCount, deployLimit } from '../src/game/state.ts';

applyMod(structuredClone(DEFAULT_MOD));

// 단순한 정책: 선택은 1번, 상점은 살 수 있는 만큼 사고 빈 칸에 올리고 1번 노드로 전투
function policy(s: RunState): string[] {
  if (s.phase === 'growth' || s.phase === 'unitGrowth' || s.phase === 'reward') return ['pick 1'];
  if (s.phase === 'extendChoice') return ['extend no'];
  const cmds: string[] = [];
  let gold = s.gold;
  s.shop.forEach((item, i) => {
    if (item && item.kind === 'monster' && itemCost(item) <= gold && s.bench.some((u) => !u)) {
      cmds.push(`buy S${i + 1}`);
      gold -= itemCost(item);
    }
  });
  return cmds;
}
function place(s: RunState): string[] {
  const cmds: string[] = [];
  let n = deployedCount(s);
  const empty = s.board.map((u, i) => (u ? -1 : i)).filter((i) => i >= 0);
  s.bench.forEach((u, i) => {
    if (u && n < deployLimit(s) && empty.length) {
      cmds.push(`move B${i + 1} ${empty.shift()! + 1}`);
      n++;
    }
  });
  return cmds;
}

// 같은 명령을 게임 함수로 직접 (웹·터미널이 하는 것과 같은 호출)
function direct(s: RunState, store: RecordStore, cmd: string) {
  const [c, a, b] = cmd.split(' ');
  const loc = (t: string) => (t.startsWith('B') ? { area: 'bench' as const, index: Number(t.slice(1)) - 1 } : { area: 'board' as const, index: Number(t) - 1 });
  switch (c) {
    case 'buy': return buy(s, Number(a.slice(1)) - 1);
    case 'move': return move(s, loc(a), loc(b));
    case 'node': return selectNode(s, Number(a) - 1);
    case 'ready': return playBattle(s, store);
    case 'extend': return chooseExtend(s, a === 'yes');
    case 'pick':
      if (s.phase === 'growth') return chooseGrowth(s, Number(a) - 1);
      if (s.phase === 'reward') return chooseReward(s, Number(a) - 1);
      if (s.unitGrowth.length) return chooseUnitGrowth(s, Number(a) - 1);
      if (s.formChoices?.length) return chooseForm(s, Number(a) - 1);
      return choosePromotion(s, Number(a) - 1);
  }
  throw new Error(`test: ${cmd}`);
}

function playWhole(seed: number) {
  const runId = `agent-test-${seed}`;
  const agent = startRun('knight', seed, runId);
  const twin = startRun('knight', seed, runId);
  const storeA: RecordStore = { records: [] };
  const storeB: RecordStore = { records: [] };
  const log: AgentAction[] = [];
  for (let guard = 0; guard < 400 && agent.phase !== 'ended'; guard++) {
    let cmds = policy(agent);
    if (agent.phase === 'shop') {
      // 사고 나서 올리기·노드·전투는 사고 난 뒤 상태를 보고 정한다 (에이전트가 두 번에 나눠 보내는 것과 같다)
      const r1 = execute(agent, storeA, cmds.join('; '));
      for (const a of r1.actions) direct(twin, storeB, a.cmd); // 실패한 시도도 같이 (웹에서 눌러 실패한 것과 같다)
      log.push(...r1.actions);
      cmds = [...place(agent), 'node 1', 'ready'];
    }
    const r = execute(agent, storeA, cmds.join('; '));
    for (const a of r.actions) direct(twin, storeB, a.cmd);
    log.push(...r.actions);
    assert.equal(JSON.stringify(agent), JSON.stringify(twin), `D${agent.day} ${cmds.join('; ')} 뒤 상태가 다름`);
  }
  return { agent, log, runId };
}

test('에이전트 명령은 게임 함수를 직접 부른 것과 같은 결과 (한 판 끝까지), 행동 기록으로 다시 실행해도 같다', () => {
  for (const seed of [3, 11]) {
    const { agent, log, runId } = playWhole(seed);
    assert.equal(agent.phase, 'ended', `seed ${seed}: 끝까지 진행`);
    assert.ok(log.some((a) => a.cmd === 'ready'));
    assert.ok(log.some((a) => a.phase === 'growth'), '리더 성장 선택을 거침');
    const re = replayActions('knight', seed, runId, log, { records: [] });
    assert.deepEqual(re.failed, []);
    assert.equal(JSON.stringify(re.state), JSON.stringify(agent));
  }
});

test('명령 묶음: 실패하면 멈추고, 전투 뒤에도 멈춘다. 단계에 안 맞는 명령은 이유를 알려 준다', () => {
  const s = startRun('knight', 5, 'agent-batch');
  const store: RecordStore = { records: [] };
  const r = execute(s, store, 'buy S9; buy S1');
  assert.deepEqual(r.actions.map((a) => [a.cmd, a.failed]), [['buy S9', true]]); // 실패한 시도도 기록 (다시 실행할 때 같게)
  assert.match(r.lines[0], /^✗/);
  assert.match(r.stopped ?? '', /1개/);
  const p = execute(s, store, 'pick 1');
  assert.match(p.lines[0], /상점 단계/);
  const b = execute(s, store, 'node 1; ready; reroll');
  assert.equal(b.battles.length, 1);
  assert.equal(b.actions.filter((a) => !a.failed).length, 2);
  assert.match(b.stopped ?? '', /전투/);
  // 정보·상태 조회는 상태를 바꾸지 않고 기록에도 안 남는다
  const before = JSON.stringify(s);
  const i = execute(s, store, 'info 1; state');
  assert.equal(i.actions.length, 0);
  assert.equal(JSON.stringify(s), before);
});

test('관찰·정보·규칙 텍스트', () => {
  const s = startRun('knight', 9, 'agent-text');
  const o = observe(s);
  assert.match(o, /1일차 · 상점/);
  assert.match(o, /S1 /);
  assert.match(o, /명령: buy/);
  const shopMonster = s.shop.findIndex((x) => x?.kind === 'monster');
  assert.match(info(s, `S${shopMonster + 1}`), new RegExp(MONSTER_MAP[s.shop[shopMonster]!.defId].name));
  assert.match(info(s, '5'), /\[리더\]/);
  assert.ok(info(null, 'monsters').split('\n').length > 5);
  assert.match(rulesText(), /명령/);
});

test('합성 미리 보기: 사면 나올 성장 선택지를 미리 보여 주고, 실제로 사면 똑같다. pick 이름으로 고르고 같은 묶음에서 이어 간다', () => {
  const s = startRun('knight', 21, 'agent-preview');
  s.gold = 50;
  const i = s.shop.findIndex((x) => x?.kind === 'monster');
  const defId = s.shop[i]!.defId;
  s.bench[0] = { uid: s.nextUid++, defId, level: 1 };
  s.bench[1] = { uid: s.nextUid++, defId, level: 1 };
  const o = observe(s);
  assert.match(o, /↳ 사면 Lv2 합성/);
  // 미리 본 선택지 = 실제 선택지
  const twin = structuredClone(s);
  buy(twin, i);
  assert.equal(twin.phase, 'unitGrowth');
  const shown = o.split('\n').find((l) => l.includes(`Lv2 성장]`))!;
  for (const id of twin.unitGrowth[0].choices) assert.ok(shown.includes(`${twin.unitGrowth[0].choices.indexOf(id) + 1}.`));
  assert.equal(JSON.stringify(s.unitGrowth), '[]', '미리 보기는 진짜 상태를 바꾸지 않는다');
  // 두 번째 선택지를 이름으로 고르고, 같은 묶음에서 노드까지
  const store: RecordStore = { records: [] };
  const want = twin.unitGrowth[0].choices[1];
  const wantName = shown.split(' / ')[1].replace(/^\d+\./, '').split(' — ')[0];
  const r = execute(s, store, `buy S${i + 1}; pick ${wantName}; node 2`);
  assert.deepEqual(r.lines.map((l) => l[0]), ['✓', '✓', '✓'], r.lines.join('\n'));
  assert.equal(s.phase, 'shop');
  assert.equal(s.nodeIndex, 1);
  assert.ok([...s.board, ...s.bench].some((u) => u?.defId === defId && u.level === 2 && u.growth?.includes(want)));
  // 없는 이름은 실패하고 멈춘다
  const t = startRun('knight', 21, 'agent-preview-2');
  t.gold = 50;
  t.bench[0] = { uid: t.nextUid++, defId, level: 1 };
  t.bench[1] = { uid: t.nextUid++, defId, level: 1 };
  const bad = execute(t, store, `buy S${i + 1}; pick 없는성장; node 2`);
  assert.equal(bad.lines[1][0], '✗');
  assert.match(bad.lines[1], /선택지에 없습니다/);
  assert.equal(t.phase, 'unitGrowth');
});

test('리더 성장 선택 중에도 상점이 보여서 "pick; buy ..."를 한 번에 보낼 수 있다', () => {
  const s = startRun('knight', 4, 'agent-growth');
  const store: RecordStore = { records: [] };
  // 리더 레벨업 날까지 진행
  for (let guard = 0; guard < 50 && s.phase !== 'growth' && s.phase !== 'ended'; guard++) {
    if (s.phase === 'shop') execute(s, store, 'node 1; ready');
    else execute(s, store, s.phase === 'extendChoice' ? 'extend no' : 'pick 1');
  }
  assert.equal(s.phase, 'growth');
  const o = observe(s);
  assert.match(o, /성장: 하나를 고르세요|전직/);
  assert.match(o, /상점 \(위에서 고른 뒤/);
  const k = s.shop.findIndex((x) => x && x.kind === 'monster');
  const r = execute(s, store, `pick 1; buy S${k + 1}`);
  assert.deepEqual(r.lines.map((l) => l[0]), ['✓', '✓'], r.lines.join('\n'));
});

test('이자 최대일 때 더 남겨도 이자가 붙지 않는다고 알려 준다', () => {
  const s = startRun('knight', 2, 'agent-interest');
  s.gold = 5;
  assert.match(observe(s), /G 더 남기면 이자\+1/);
  s.gold = 200;
  assert.match(observe(s), /이자 최대: \d+G 넘게 남긴 골드는 이자가 더 붙지 않음/);
});
