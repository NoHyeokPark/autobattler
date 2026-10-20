// 에이전트 MCP 서버: 실제로 띄워서 JSON-RPC로 초기화 → 도구 목록 → 새 런 → 명령 → 상태를 주고받는다 (기본 데이터·임시 저장 폴더)
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createInterface } from 'node:readline';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

const SERVER = fileURLToPath(new URL('../src/agent/mcp.ts', import.meta.url));

test('MCP 서버: initialize · tools/list · new_game · act · get_state · info · action_log', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'ab-mcp-'));
  const child = spawn(process.execPath, ['--disable-warning=ExperimentalWarning', SERVER], {
    env: { ...process.env, AB_AGENT_DIR: join(dir, 'agent'), AB_SAVE_DIR: join(dir, 'saves'), AB_AGENT_NO_MOD: '1' },
    stdio: ['pipe', 'pipe', 'pipe'],
  });
  const replies = new Map<number, (v: Record<string, any>) => void>();
  const stray: string[] = [];
  createInterface({ input: child.stdout }).on('line', (line) => {
    const msg = JSON.parse(line); // 표준 출력에는 프로토콜 메시지만 (아니면 여기서 실패)
    if (typeof msg.id === 'number' && replies.has(msg.id)) replies.get(msg.id)!(msg);
    else stray.push(line);
  });
  let next = 1;
  const call = (method: string, params: Record<string, unknown> = {}) => new Promise<Record<string, any>>((resolve, reject) => {
    const id = next++;
    const timer = setTimeout(() => reject(new Error(`timeout: ${method}`)), 20_000);
    replies.set(id, (m) => { clearTimeout(timer); resolve(m); });
    child.stdin.write(JSON.stringify({ jsonrpc: '2.0', id, method, params }) + '\n');
  });
  const tool = async (name: string, args: Record<string, unknown> = {}) => {
    const r = await call('tools/call', { name, arguments: args });
    assert.equal(r.result.isError, undefined, JSON.stringify(r));
    return r.result.content[0].text as string;
  };
  try {
    const init = await call('initialize', { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'test', version: '0' } });
    assert.equal(init.result.protocolVersion, '2025-06-18');
    assert.ok(init.result.capabilities.tools);
    child.stdin.write(JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' }) + '\n');
    const list = await call('tools/list');
    assert.deepEqual(list.result.tools.map((t: { name: string }) => t.name), ['rules', 'new_game', 'get_state', 'act', 'info', 'action_log']);
    assert.match(await tool('rules'), /명령/);
    assert.match(await tool('get_state'), /진행 중인 런이 없습니다/);
    const start = await tool('new_game', { leader: '1', seed: 42 });
    assert.match(start, /새 런/);
    assert.match(start, /1일차 · 상점/);
    const acted = await tool('act', { commands: 'buy S1; node 1; ready', note: '첫날은 싼 유닛으로 자리 채우기' });
    assert.match(acted, /전투 (승리|패배)/);
    assert.match(await tool('get_state'), /1일차|2일차/);
    assert.ok((await tool('info', { target: '5' })).includes('[리더]'));
    const log1 = await tool('action_log');
    assert.match(log1, /ready/);
    assert.match(log1, /💭 D1 첫날은 싼 유닛으로 자리 채우기/);
    // 진행 중에는 새 런을 거절, abandon이면 포기로 기록하고 시작
    assert.match(await tool('new_game', { leader: '2', seed: 1 }), /진행 중인 런이 있습니다/);
    const again = await tool('new_game', { leader: '2', seed: 1, abandon: true });
    assert.match(again, /새 런/);
    assert.match(again, /1판 · 우승 0 · 탈락 0 · 포기 1/);
    // 이자 최대 안내
    assert.match(await tool('act', { commands: 'state' }), /이자/);
    const bad = await call('tools/call', { name: 'nope', arguments: {} });
    assert.equal(bad.result.isError, true);
    const unknown = await call('resources/list');
    assert.equal(unknown.error.code, -32601);
    assert.deepEqual(stray, [], '알림에는 답하지 않는다');
  } finally {
    child.kill();
    rmSync(dir, { recursive: true, force: true });
  }
});
