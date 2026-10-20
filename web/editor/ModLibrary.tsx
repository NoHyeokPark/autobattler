// 이름별 모드 목록 (mods/library/<모드 이름>.json). 모드마다 유닛 풀·수치를 바꿔 여러 버전을 두고 골라 쓴다.
// 적용 = 게임에 반영 + mods/editor.json(적용 중)에 저장. 편집 = 초안으로만 불러오기.
// 삭제는 mods/backup/library/로 옮기기라서 되살릴 수 있다.

import { useEffect, useState } from 'react';
import { modFileName } from '../../src/data/modFile.ts';
import { activeModName, DEFAULT_MOD } from '../../src/data/registry.ts';
import type { ModData } from '../../src/data/registry.ts';
import { deleteLibraryMod, listLibrary, readLibraryMod, storageMode, writeLibraryMod } from '../lib/persist.ts';
import type { LibraryMod } from '../lib/persist.ts';

export interface LibraryActions {
  draft: ModData;
  dirty: boolean;
  onReplace: (mod: ModData, note: string, origin?: string | null) => void;
  onApplyMod: (mod: ModData, origin: string) => Promise<void>;
  onSaveDraft: () => Promise<void>;
}

export function downloadMod(mod: ModData) {
  const blob = new Blob([JSON.stringify(mod, null, 2)], { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = modFileName(mod.name);
  a.click();
  URL.revokeObjectURL(a.href);
}

const when = (ms: number) => new Date(ms).toLocaleString('ko-KR', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' });

export function ModLibrary({ draft, dirty, onReplace, onApplyMod, onSaveDraft }: LibraryActions) {
  const [mods, setMods] = useState<LibraryMod[] | null>(null);
  const [err, setErr] = useState('');
  const active = activeModName();
  const project = storageMode() === 'project';

  const refresh = () => {
    listLibrary().then((r) => { setMods(r.mods); setErr(''); }).catch((e) => setErr(String(e instanceof Error ? e.message : e)));
  };
  useEffect(refresh, []);

  const run = async (fn: () => Promise<void>) => {
    try {
      await fn();
    } catch (e) {
      setErr(String(e instanceof Error ? e.message : e));
    }
    refresh();
  };
  const leaveDraft = () => !dirty || confirm('적용하지 않은 변경 사항이 있습니다. 버리고 다른 모드를 불러올까요?');
  const exists = (name: string) => mods?.some((m) => m.file === modFileName(name));

  const askName = (title: string, init: string): string | null => {
    const name = prompt(title, init)?.trim();
    if (!name) return null;
    if (exists(name) && !confirm(`"${name}" 이름의 모드가 이미 있습니다. 덮어쓸까요? (이전 내용은 백업)`)) return null;
    return name;
  };

  if (!project) {
    return (
      <section className="panel">
        <h3>이름별 모드</h3>
        <p className="muted">개발 서버(npm run web)로 실행할 때만 프로젝트 폴더에 모드를 이름별로 보관할 수 있습니다. 지금은 아래 "JSON 내보내기·가져오기"를 쓰세요.</p>
      </section>
    );
  }

  return (
    <section className="panel">
      <h3>이름별 모드</h3>
      <p className="muted">
        모드마다 유닛 풀·수치를 바꿔 여러 버전을 두고 골라 쓸 수 있습니다. 파일은 <code>mods/library/모드이름.json</code>.
        "적용"하면 게임과 터미널 시뮬레이터가 그 모드를 씁니다 (<code>npm run sim -- league --mod 모드이름</code>으로 적용하지 않고 비교도 가능).
        PvP 기록도 모드별로 따로 매칭됩니다.
      </p>
      <div className="inline wrap">
        <button className="btn" onClick={() => {
          if (!leaveDraft()) return;
          const name = askName('새 모드 이름 (기본 데이터에서 시작)', '새 모드');
          if (name) onReplace({ ...structuredClone(DEFAULT_MOD), name }, `기본 데이터로 새 모드 "${name}"을(를) 시작했습니다. 편집한 뒤 "변경 사항 적용" 또는 "초안 저장"을 누르세요.`, null);
        }}>새 모드 (기본 데이터에서)</button>
        <button className="btn" onClick={() => void run(onSaveDraft)} title="게임에 적용하지 않고 이름별 보관만">초안 저장: "{draft.name}"</button>
      </div>
      {err && <p className="bad-text">{err}</p>}
      {mods === null ? <p className="muted">불러오는 중...</p> : mods.length === 0 ? <p className="muted">아직 저장된 모드가 없습니다.</p> : (
        <div className="table-wrap">
          <table className="table mod-library">
            <thead>
              <tr><th>모드</th><th>몬스터</th><th>리더</th><th>장신구</th><th>저장</th><th /></tr>
            </thead>
            <tbody>
              {mods.map((m) => {
                const isActive = m.name === active;
                return (
                  <tr key={m.file} className={isActive ? 'active-mod' : ''}>
                    <td>
                      <strong>{m.name}</strong>
                      {isActive && <span className="pill small-pill ok">적용 중</span>}
                      {m.name === draft.name && !isActive && <span className="pill small-pill">편집 중</span>}
                    </td>
                    <td>{m.monsters}</td>
                    <td>{m.leaders}</td>
                    <td>{m.trinkets}</td>
                    <td className="muted small">{when(m.savedAt)}</td>
                    <td className="inline wrap">
                      <button className="btn small primary" disabled={isActive && !dirty} title="게임에 바로 반영" onClick={() => leaveDraft() && void run(async () => onApplyMod(await readLibraryMod(m.file), m.file))}>적용</button>
                      <button className="btn small" title="초안으로만 불러오기 (적용 전까지 게임은 그대로)" onClick={() => leaveDraft() && void run(async () => onReplace(await readLibraryMod(m.file), `"${m.name}"을(를) 초안으로 불러왔습니다. 확인 후 "변경 사항 적용"을 누르세요.`, m.file))}>편집</button>
                      <button className="btn small" onClick={() => {
                        const name = askName(`"${m.name}" 복제: 새 이름`, `${m.name} 복사본`);
                        if (name) void run(async () => { await writeLibraryMod({ ...(await readLibraryMod(m.file)), name }); });
                      }}>복제</button>
                      <button className="btn small" onClick={() => void run(async () => downloadMod(await readLibraryMod(m.file)))}>내보내기</button>
                      <button
                        className="btn small danger" disabled={isActive} title={isActive ? '적용 중인 모드는 지울 수 없습니다' : 'mods/backup/library/로 옮깁니다'}
                        onClick={() => confirm(`"${m.name}"을(를) 지울까요? (mods/backup/library/로 옮겨 두므로 되살릴 수 있습니다)`) && void run(() => deleteLibraryMod(m.file))}
                      >삭제</button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
