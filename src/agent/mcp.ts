// 에이전트 플레이 모드 MCP 서버 (stdio, JSON-RPC 2.0 한 줄 = 메시지 하나). 의존성 없이 필요한 부분만 구현한다.
// Claude Code는 프로젝트의 .mcp.json으로 연결한다. 다른 MCP 클라이언트는:
//   command: node, args: [--disable-warning=ExperimentalWarning, src/agent/mcp.ts] (작업 폴더 = 프로젝트)
// 도구: rules · new_game · get_state · act · info · action_log (명령줄 버전 cli.ts와 같은 session.ts를 쓴다)
// 표준 출력에는 프로토콜 메시지만 쓴다 (로그는 표준 오류로).

import { dirname, join } from 'node:path';
import { createInterface } from 'node:readline';
import { fileURLToPath } from 'node:url';

// 저장 위치(saves/)·모드(mods/)를 프로젝트 기준으로 찾게 작업 폴더를 맞춘 뒤 게임 모듈을 불러온다
process.chdir(join(dirname(fileURLToPath(import.meta.url)), '..', '..'));
const S = await import('./session.ts');

const SERVER = { name: 'autobattler', version: '0.1.0' };
const INSTRUCTIONS = [
  '덱빌딩 오토배틀러(한국어)를 플레이하는 도구입니다.',
  '처음에 rules로 규칙과 명령을 읽고, new_game으로 런을 시작하세요 (이미 진행 중이면 get_state).',
  'act에는 여러 명령을 ;로 이어서 한 번에 보내세요 (예: "buy S2; move B1 5; node 1; ready"). 실패하거나 전투가 끝나면 거기서 멈추고 결과와 새 상태를 돌려줍니다.',
  '카드 설명은 상태에 요약되어 있고, 자세한 것은 info로 보세요.',
  'act에는 note로 이번 행동의 이유를 한두 문장 남겨 주세요 (나중에 플레이를 돌아볼 때 씁니다).',
  '런은 끝까지 플레이합니다. 진행 중에 new_game을 부르면 거절되고, abandon: true로 포기하면 포기로 기록됩니다.',
].join(' ');

type Json = Record<string, unknown>;
const TOOLS = [
  { name: 'rules', description: '게임 규칙 요약과 명령어 목록 (처음 한 번 읽기). Rules summary and command syntax.', inputSchema: { type: 'object', properties: {} } },
  {
    name: 'new_game',
    description: '새 런을 시작한다. 진행 중인 런이 있으면 거절된다 (abandon: true면 그 런을 포기로 기록하고 시작). Start a new run.',
    inputSchema: {
      type: 'object',
      properties: {
        leader: { type: 'string', description: '리더: 번호(1부터)·이름·id·random. 비우면 무작위' },
        seed: { type: 'integer', description: '시드 (같은 시드 + 같은 행동 = 같은 결과). 비우면 무작위' },
        abandon: { type: 'boolean', description: '진행 중인 런을 포기하고 새로 시작 (포기로 기록됨)' },
      },
    },
  },
  { name: 'get_state', description: '지금 상태 (단계·골드·보드·벤치·상점·선택지·가능한 명령). Current observation.', inputSchema: { type: 'object', properties: {} } },
  {
    name: 'act',
    description: '명령 실행. ; 또는 줄바꿈으로 여러 개. 예: "buy S2; move B1 5; node 1; ready", "pick 2", "gold". 실패하거나 전투가 끝나면 멈춘다. Execute commands.',
    inputSchema: {
      type: 'object',
      properties: {
        commands: { type: 'string', description: '명령들 (rules 참고)' },
        note: { type: 'string', description: '이번 행동의 이유 한두 문장 (행동 기록에 남음). Short reasoning for this action.' },
      },
      required: ['commands'],
    },
  },
  {
    name: 'info',
    description: '자세한 정보 (상태 변화 없음): S1~S6 상점, 1~9 보드, B1~B6 벤치, 몬스터·장신구·리더 이름, monsters, trinkets, leaders, synergies, slots.',
    inputSchema: { type: 'object', properties: { target: { type: 'string' } }, required: ['target'] },
  },
  { name: 'action_log', description: '이번 런의 행동 기록과 메모, 지금까지의 런 이력 요약. Action log with notes.', inputSchema: { type: 'object', properties: {} } },
];

function callTool(name: string, args: Json): string {
  switch (name) {
    case 'rules': return S.agentRules();
    case 'new_game': return S.agentNew(typeof args.leader === 'string' ? args.leader : undefined, typeof args.seed === 'number' ? args.seed : undefined, args.abandon === true);
    case 'get_state': return S.agentState();
    case 'act': return S.agentAct(String(args.commands ?? ''), typeof args.note === 'string' ? args.note : undefined);
    case 'info': return S.agentInfo(String(args.target ?? ''));
    case 'action_log': return S.agentLog();
  }
  throw new Error(`알 수 없는 도구: ${name}`);
}

const send = (msg: Json) => process.stdout.write(JSON.stringify({ jsonrpc: '2.0', ...msg }) + '\n');

function handle(msg: Json) {
  const id = msg.id as string | number | undefined;
  const method = String(msg.method ?? '');
  const params = (msg.params ?? {}) as Json;
  if (id === undefined) return; // 알림 (notifications/initialized 등): 답하지 않는다
  try {
    switch (method) {
      case 'initialize':
        return send({ id, result: { protocolVersion: params.protocolVersion ?? '2025-06-18', capabilities: { tools: { listChanged: false } }, serverInfo: SERVER, instructions: INSTRUCTIONS } });
      case 'ping':
        return send({ id, result: {} });
      case 'tools/list':
        return send({ id, result: { tools: TOOLS } });
      case 'tools/call': {
        const name = String(params.name ?? '');
        try {
          return send({ id, result: { content: [{ type: 'text', text: callTool(name, (params.arguments ?? {}) as Json) }] } });
        } catch (e) {
          return send({ id, result: { content: [{ type: 'text', text: `오류: ${e instanceof Error ? e.message : String(e)}` }], isError: true } });
        }
      }
      default:
        return send({ id, error: { code: -32601, message: `Method not found: ${method}` } });
    }
  } catch (e) {
    send({ id, error: { code: -32603, message: e instanceof Error ? e.message : String(e) } });
  }
}

// 한 줄씩 차례로 처리 (세션 파일을 쓰므로 동시에 처리하지 않는다)
const rl = createInterface({ input: process.stdin });
rl.on('line', (line) => {
  if (!line.trim()) return;
  let msg: Json;
  try {
    msg = JSON.parse(line) as Json;
  } catch {
    send({ id: null, error: { code: -32700, message: 'Parse error' } });
    return;
  }
  handle(msg);
});
process.stderr.write(`[autobattler mcp] ready (${process.cwd()})\n`);
