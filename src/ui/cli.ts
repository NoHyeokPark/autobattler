// 텍스트 UI 진입점: npm run play [-- --new] [--seed N] [--speed 1|3|skip]

import { createInterface } from 'node:readline';
import { BALANCE } from '../config/balance.ts';
import { LEADERS } from '../data/leaders.ts';
import { MONSTER_MAP } from '../data/monsters.ts';
import { TRINKET_MAP } from '../data/trinkets.ts';
import { GRADE_NAMES } from '../data/types.ts';
import { playBattle } from '../game/day.ts';
import { recordRunEnd } from '../game/profile.ts';
import type { Profile } from '../game/profile.ts';
import type { RecordStore } from '../game/matching.ts';
import { beginDay, chooseExtend, chooseGrowth, chooseReward, rerollGrowth, selectNode, stopExtension } from '../game/run.ts';
import { buy, chooseForm, choosePromotion, chooseUnitGrowth, getAt, move, reroll, rerollUnitGrowth, sell } from '../game/shop.ts';
import type { Loc, OpResult } from '../game/shop.ts';
import { createRun } from '../game/state.ts';
import { mapText } from '../game/map.ts';
import { leaderView, statLine } from '../game/view.ts';
import type { RunState } from '../game/state.ts';
import { loadModFile, loadProfile, loadRecords, loadRun, resolveModPath, SAVE_DIR, saveProfile, saveRecords, saveRun } from '../game/storage.ts';
import { renderAnalysis } from './analysis.ts';
import {
  HELP, renderEnd, renderFormChoice, renderPromotionChoice, renderGrowth, renderProfile, renderReward, renderShopPhase, renderSlotHelp, renderTrinkets, renderUnitGrowth, renderUnitInfo,
} from './render.ts';
import { replay } from './replay.ts';
import type { Speed } from './replay.ts';

const interactive = Boolean(process.stdin.isTTY);
const print = (s = '') => process.stdout.write(s + '\n');

function createInput() {
  const rl = createInterface({ input: process.stdin, terminal: interactive });
  const queue: string[] = [];
  const waiters: ((s: string) => void)[] = [];
  let closed = false;
  rl.on('line', (line) => {
    const w = waiters.shift();
    if (w) w(line);
    else queue.push(line);
  });
  rl.on('close', () => {
    closed = true;
    while (waiters.length) waiters.shift()!('quit');
  });
  return {
    async ask(prompt: string): Promise<string> {
      process.stdout.write(prompt);
      let line: string;
      if (queue.length) line = queue.shift()!;
      else if (closed) line = 'quit';
      else line = await new Promise<string>((r) => waiters.push(r));
      if (!interactive) process.stdout.write(line + '\n'); // 파이프 입력이면 입력을 화면에 남긴다
      return line.trim();
    },
    close: () => rl.close(),
  };
}

type Input = ReturnType<typeof createInput>;

function parseArgs(argv: string[]) {
  const get = (name: string) => {
    const i = argv.indexOf(`--${name}`);
    return i >= 0 ? argv[i + 1] : undefined;
  };
  const speed = get('speed');
  return {
    mod: resolveModPath(get('mod'), argv.includes('--no-mod')),
    fresh: argv.includes('--new'),
    seed: get('seed') !== undefined ? Number(get('seed')) : undefined,
    speed: (speed === '1' || speed === '3' || speed === 'skip' ? speed : '3') as Speed,
  };
}

function parseLoc(token: string | undefined): Loc | null {
  if (!token) return null;
  const m = /^b([1-6])$/i.exec(token);
  if (m) return { area: 'bench', index: Number(m[1]) - 1 };
  if (/^[1-9]$/.test(token)) return { area: 'board', index: Number(token) - 1 };
  return null;
}

function report(r: OpResult) {
  print(r.ok ? `  > ${r.msg}` : `  ! ${r.msg}`);
}

async function newRun(io: Input, profile: Profile, seedArg?: number): Promise<RunState | null> {
  print(renderProfile(profile));
  print('\n리더를 고르세요.');
  LEADERS.forEach((l, i) => print(`  ${i + 1}. ${l.name} [${l.tags.join(', ')}] ${statLine(leaderView(l))} - ${l.desc}`));
  for (;;) {
    const a = await io.ask('리더 번호> ');
    if (a === 'quit') return null;
    const leader = LEADERS[Number(a) - 1];
    if (!leader) continue;
    const seed = seedArg ?? (Date.now() & 0x7fffffff);
    const s = createRun(leader.id, seed, `run-${Date.now().toString(36)}-${seed}`);
    beginDay(s);
    saveRun(s);
    print(`\n${leader.name}(으)로 런을 시작합니다. (시드 ${seed})`);
    return s;
  }
}

async function shopCommand(io: Input, s: RunState, store: RecordStore, profile: Profile, opts: { speed: Speed }): Promise<'quit' | void> {
  const line = await io.ask('> ');
  const [cmd, a, b] = line.split(/\s+/);
  switch ((cmd ?? '').toLowerCase()) {
    case '': return;
    case 'help': case 'h': case '?': print(HELP); return;
    case 'quit': case 'q': saveRun(s); return 'quit';
    case 'buy': case 'p': report(buy(s, Number(a) - 1)); break;
    case 'sell': {
      const loc = parseLoc(a);
      report(loc ? sell(s, loc) : { ok: false, msg: '위치를 확인하세요. 예) sell b1, sell 5' });
      break;
    }
    case 'mv': case 'move': {
      const from = parseLoc(a);
      const to = parseLoc(b);
      report(from && to ? move(s, from, to) : { ok: false, msg: '예) mv b1 5, mv 5 7' });
      break;
    }
    case 'r': case 'reroll': report(reroll(s)); break;
    case 'lock':
      s.shopLocked = !s.shopLocked;
      report({ ok: true, msg: `상점 잠금 ${s.shopLocked ? 'ON (다음 날 상점 유지)' : 'OFF'}` });
      break;
    case 'node': case 'n': report(selectNode(s, Number(a) - 1)); break;
    case 'i': case 'info': {
      const shop = /^s([1-9])$/i.exec(a ?? '');
      if (shop) {
        const item = s.shop[Number(shop[1]) - 1];
        if (!item) print('  ! 빈 칸입니다.');
        else if (item.kind === 'monster') print(renderUnitInfo({ uid: -1, defId: item.defId, level: 1 }, s, null));
        else print(`${TRINKET_MAP[item.defId].name} [${GRADE_NAMES[TRINKET_MAP[item.defId].grade]}] ${TRINKET_MAP[item.defId].desc}`);
        return;
      }
      const loc = parseLoc(a);
      const u = loc ? getAt(s, loc) : null;
      if (!u) print('  ! 유닛이 없습니다. 예) i 5, i b1, i s2');
      else print(renderUnitInfo(u, s, loc!.area === 'board' ? loc!.index + 1 : null));
      return;
    }
    case 't': print(renderTrinkets(s.trinkets)); return;
    case 'slots': print(renderSlotHelp(s.day)); return;
    case 'map': print(mapText(s)); return;
    case 'speed':
      if (a === '1' || a === '3' || a === 'skip') {
        opts.speed = a;
        report({ ok: true, msg: `전투 재생 속도: ${a}` });
      } else print('  ! speed 1 | speed 3 | speed skip');
      return;
    case 'stop': report(stopExtension(s)); break;
    case 'go': case 'ready': {
      const battle = playBattle(s, store);
      saveRecords(store);
      saveRun(s);
      print(`\n상대 매칭: ${battle.match.team.name} [${battle.match.stage}]`);
      await replay(battle.result, opts.speed, print, interactive);
      print(renderAnalysis(battle));
      if (s.end) {
        recordRunEnd(profile, s);
        saveProfile(profile);
      }
      return;
    }
    default: print('  ! 알 수 없는 명령입니다. help를 입력하세요.'); return;
  }
  saveRun(s);
  print(renderShopPhase(s));
}

async function playRun(io: Input, s: RunState, store: RecordStore, profile: Profile, opts: { speed: Speed }): Promise<'quit' | 'ended'> {
  let lastShown = '';
  for (;;) {
    switch (s.phase) {
      case 'growth': {
        print(renderGrowth(s));
        const a = await io.ask('성장 번호> ');
        if (a === 'quit') return 'quit';
        report(a === 'r' ? rerollGrowth(s) : chooseGrowth(s, Number(a) - 1));
        saveRun(s);
        break;
      }
      case 'unitGrowth': {
        if (s.unitGrowth.length === 0 && !s.formChoices?.length && s.unitPromotions?.length) {
          print(renderPromotionChoice(s));
          const a = await io.ask('전직 번호> ');
          if (a === 'quit') return 'quit';
          report(choosePromotion(s, Number(a) - 1));
        } else if (s.unitGrowth.length === 0 && s.formChoices?.length) {
          print(renderFormChoice(s));
          const a = await io.ask('진화 모습 번호> ');
          if (a === 'quit') return 'quit';
          report(chooseForm(s, Number(a) - 1));
        } else {
          print(renderUnitGrowth(s));
          const a = await io.ask('성장 번호> ');
          if (a === 'quit') return 'quit';
          report(a === 'r' ? rerollUnitGrowth(s) : chooseUnitGrowth(s, Number(a) - 1));
        }
        saveRun(s);
        lastShown = '';
        break;
      }
      case 'shop': {
        const key = `${s.day}-shop`;
        if (lastShown !== key) {
          print(renderShopPhase(s));
          lastShown = key;
        }
        if ((await shopCommand(io, s, store, profile, opts)) === 'quit') return 'quit';
        break;
      }
      case 'reward': {
        print(renderReward(s));
        const a = await io.ask('보상 선택 (번호/g)> ');
        if (a === 'quit') return 'quit';
        report(chooseReward(s, a.toLowerCase() === 'g' ? 'gold' : Number(a) - 1));
        saveRun(s);
        break;
      }
      case 'extendChoice': {
        print(`\n${BALANCE.run.winTarget}승 달성! 연장하면 매일 '여기서 멈추기'가 가능하고, 1패하면 ${BALANCE.rank.extensionLossScore}점으로 끝납니다.`);
        print(`  연장 승리 보너스: ${BALANCE.rank.extensionBonus.slice(1).map((b, i) => `${i + 1}승 +${b}`).join(', ')}`);
        const a = await io.ask('연장하시겠습니까? (y = 연장 / n = 우승 확정)> ');
        if (a === 'quit') return 'quit';
        report(chooseExtend(s, a.toLowerCase() === 'y'));
        if (s.end) {
          recordRunEnd(profile, s);
          saveProfile(profile);
        }
        saveRun(s);
        break;
      }
      case 'ended':
        print(renderEnd(s, profile));
        return 'ended';
    }
  }
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const io = createInput();
  const opts = { speed: args.speed };
  print('=== 덱빌딩 오토배틀러 프로토타입 v0.1 ===');
  print(`(저장 위치: ${SAVE_DIR})`);
  if (args.mod) print(`모드 적용: ${loadModFile(args.mod)} (${args.mod}) - 기본 데이터로 하려면 --no-mod`);
  const profile = loadProfile();
  const store = loadRecords();
  print(`PvP 기록 풀: ${store.records.length}개 | 몬스터 ${Object.keys(MONSTER_MAP).length}종 | 장신구 ${Object.keys(TRINKET_MAP).length}종`);

  let s: RunState | null = args.fresh ? null : loadRun();
  if (s && (s.phase === 'ended' || s.ruleVersion !== BALANCE.ruleVersion)) s = null;
  if (s) {
    const a = await io.ask(`저장된 런이 있습니다 (${s.day}일차, ${s.wins}승 ${s.losses}패). 이어서 할까요? (y/n)> `);
    if (a.toLowerCase() !== 'y') s = null;
  }
  for (;;) {
    if (!s) s = await newRun(io, profile, args.seed);
    if (!s) break;
    const r = await playRun(io, s, store, profile, opts);
    if (r === 'quit') {
      print('저장했습니다. 다음에 이어서 할 수 있습니다.');
      break;
    }
    const again = await io.ask('\n새 런을 시작할까요? (y/n)> ');
    if (again.toLowerCase() !== 'y') break;
    s = null;
  }
  io.close();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
