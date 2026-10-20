// 이름별 모드: 파일 이름 규칙, 라이브러리 목록·처음 복사·삭제(백업으로 옮김), 모드별 PvP 기록 매칭
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { Rng } from '../src/core/rng.ts';
import { isSafeModFile, modFileName } from '../src/data/modFile.ts';
import { activeModName, applyMod, DEFAULT_MOD } from '../src/data/registry.ts';
import { findOpponent, makeRecord, modRecordCount } from '../src/game/matching.ts';
import type { RecordStore } from '../src/game/matching.ts';
import { beginDay } from '../src/game/run.ts';
import { createRun } from '../src/game/state.ts';
import { backupLibrary, listLibrary } from '../tools/savePlugin.ts';

test('모드 파일 이름: 못 쓰는 문자는 _로, 경로 이동은 거부', () => {
  assert.equal(modFileName('마법소녀의 도시'), '마법소녀의 도시.json');
  assert.equal(modFileName('a/b:c?'), 'a_b_c_.json');
  assert.equal(modFileName('  끝에 점.  '), '끝에 점.json');
  assert.equal(modFileName(''), '이름 없는 모드.json');
  assert.ok(isSafeModFile('마법소녀의 도시.json'));
  for (const bad of ['../editor.json', '..\\x.json', 'a/b.json', '..json', 'x.txt', 'C:x.json']) assert.ok(!isSafeModFile(bad), bad);
});

test('라이브러리: 적용 중인 모드를 처음 한 번 복사해 넣고, 삭제는 백업 폴더로 옮긴다', () => {
  const root = mkdtempSync(join(tmpdir(), 'ab-modlib-'));
  try {
    mkdirSync(join(root, 'mods'), { recursive: true });
    writeFileSync(join(root, 'mods', 'editor.json'), JSON.stringify({ ...DEFAULT_MOD, name: '마법소녀의 도시' }));
    const first = listLibrary(root);
    assert.equal(first.active, '마법소녀의 도시');
    assert.deepEqual(first.mods.map((m) => m.name), ['마법소녀의 도시']);
    assert.equal(first.mods[0].monsters, DEFAULT_MOD.monsters.length);

    // 같은 이름 파일이 이미 있으면 덮어쓰지 않는다
    const lib = join(root, 'mods', 'library', '마법소녀의 도시.json');
    writeFileSync(lib, JSON.stringify({ ...DEFAULT_MOD, name: '마법소녀의 도시', monsters: [] }));
    assert.equal(listLibrary(root).mods[0].monsters, 0);

    writeFileSync(join(root, 'mods', 'library', '실험.json'), JSON.stringify({ ...DEFAULT_MOD, name: '실험' }));
    backupLibrary(root, '실험.json', 'copy');
    backupLibrary(root, '실험.json', 'move');
    assert.ok(!existsSync(join(root, 'mods', 'library', '실험.json')));
    const backups = readdirSync(join(root, 'mods', 'backup', 'library'));
    assert.equal(backups.filter((f) => f.startsWith('실험@deleted-')).length, 1);
    assert.equal(backups.filter((f) => f.startsWith('실험@') && !f.includes('deleted')).length, 1);
    assert.deepEqual(listLibrary(root).mods.map((m) => m.name), ['마법소녀의 도시']);
    assert.equal(JSON.parse(readFileSync(lib, 'utf8')).monsters.length, 0);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('PvP 기록은 만든 모드에서만 매칭된다 (모드 표시가 없는 예전 기록은 모든 모드와 매칭)', () => {
  const node = { kind: 'normal' as const, env: 'normal' as const };
  const other = createRun('saint', 2, 'other-run');
  beginDay(other);
  const me = createRun('knight', 1, 'me-run');
  beginDay(me);
  try {
    applyMod({ ...structuredClone(DEFAULT_MOD), name: '모드 A' });
    const store: RecordStore = { records: [makeRecord(other, node, 'A')] };
    assert.equal(store.records[0].mod, '모드 A');
    assert.equal(findOpponent(store, me, node, new Rng(1)).stage, '같은 일차·같은 환경');

    applyMod({ ...structuredClone(DEFAULT_MOD), name: '모드 B' });
    assert.equal(activeModName(), '모드 B');
    assert.equal(modRecordCount(store), 0);
    assert.equal(findOpponent(store, me, node, new Rng(1)).stage, '시드 봇');

    delete store.records[0].mod; // 예전 기록
    assert.equal(modRecordCount(store), 1);
    assert.equal(findOpponent(store, me, node, new Rng(1)).stage, '같은 일차·같은 환경');
  } finally {
    applyMod(structuredClone(DEFAULT_MOD));
  }
});
