// 에이전트 플레이 모드 명령줄: 한 번 실행에 한 가지 일을 하고 결과 텍스트를 출력한다 (상태는 saves/agent/session.json에 이어진다).
//   npm run agent -- rules                 규칙 요약 (처음 한 번)
//   npm run agent -- new [리더] [--seed N] [--abandon]  새 런 (리더: 번호·이름·id·random). 진행 중인 런이 있으면 --abandon이 필요 (포기로 기록)
//   npm run agent -- state                 지금 상태
//   npm run agent -- do "buy S2; move B1 5; node 1; ready" [--note "이유"]   명령 묶음 실행 (메모는 행동 기록에 남음)
//   npm run agent -- info 도깨비불          정보 (S1, 5, B2, 이름, monsters, trinkets, leaders, synergies, slots)
//   npm run agent -- log                   이번 런의 행동 기록
//   옵션: --share-records (에이전트 기록을 PvP 기록 풀에 넣기), --dir 폴더 (세션 위치), --mod 모드이름
//   MCP 서버로 쓰려면 src/agent/mcp.ts (.mcp.json)

const argv = process.argv.slice(2);
const opt = (name: string) => {
  const i = argv.indexOf(`--${name}`);
  if (i < 0) return undefined;
  const v = argv[i + 1];
  argv.splice(i, v !== undefined && !v.startsWith('--') ? 2 : 1);
  return v !== undefined && !v.startsWith('--') ? v : '';
};
// 값 없는 옵션 (뒤의 단어를 값으로 먹지 않는다)
const flag = (name: string) => {
  const i = argv.indexOf(`--${name}`);
  if (i >= 0) argv.splice(i, 1);
  return i >= 0;
};
// 저장 위치·모드 설정은 모듈을 불러오기 전에 정한다 (session.ts가 불러올 때 읽는다)
if (flag('share-records')) process.env.AB_AGENT_SHARE_RECORDS = '1';
const abandon = flag('abandon');
const dir = opt('dir');
if (dir) process.env.AB_AGENT_DIR = dir;
const mod = opt('mod');
if (mod) process.env.AB_AGENT_MOD = mod;
const seed = opt('seed');
const note = opt('note');

const s = await import('./session.ts');
const [cmd, ...rest] = argv;
const arg = rest.join(' ');
let out: string;
try {
  switch (cmd) {
    case 'rules': out = s.agentRules(); break;
    case 'new': out = s.agentNew(arg || undefined, seed ? Number(seed) : undefined, abandon); break;
    case 'state': case undefined: out = s.agentState(); break;
    case 'do': case 'act': out = s.agentAct(arg, note || undefined); break;
    case 'info': out = s.agentInfo(arg); break;
    case 'log': out = s.agentLog(); break;
    default: out = `알 수 없는 명령 "${cmd}". rules | new [리더] [--seed N] | state | do "명령들" | info 대상 | log`;
  }
} catch (e) {
  out = `오류: ${e instanceof Error ? e.message : String(e)}`;
  process.exitCode = 1;
}
process.stdout.write(out + '\n');
