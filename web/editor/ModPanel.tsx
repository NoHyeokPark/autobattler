// 모드 관리: 이름별 모드 목록, 이름, 새 기본 항목 가져오기, 태그 목록, 내보내기/가져오기, 기본값으로 초기화.

import { useState } from 'react';
import { DEFAULT_KINDS, DEFAULT_MOD, defaultKey, importDefaults, missingDefaults, parseMod } from '../../src/data/registry.ts';
import type { ModData } from '../../src/data/registry.ts';
import { Field, TextInput } from './fields.tsx';
import { downloadMod, ModLibrary } from './ModLibrary.tsx';
import type { LibraryActions } from './ModLibrary.tsx';

export function ModPanel({ draft, dirty, onChange, onReplace, onApplyMod, onSaveDraft }: LibraryActions & { onChange: () => void }) {
  const [newTag, setNewTag] = useState('');
  const [importErr, setImportErr] = useState('');
  const used = (t: string) =>
    JSON.stringify([draft.monsters, draft.leaders, draft.trinkets, draft.unitGrowth]).includes(`"${t}"`);

  const exportMod = () => downloadMod(draft);

  return (
    <div className="mod-panel">
      <ModLibrary draft={draft} dirty={dirty} onReplace={onReplace} onApplyMod={onApplyMod} onSaveDraft={onSaveDraft} />

      <section className="panel">
        <h3>편집 중인 모드 정보</h3>
        <div className="form-grid">
          <Field label="모드 이름" hint="이름을 바꿔 적용·저장하면 새 이름으로 따로 보관됩니다 (원래 이름의 모드는 그대로 남음)">
            <TextInput value={draft.name} onChange={(v) => { draft.name = v; onChange(); }} />
          </Field>
        </div>
        <p className="muted">
          몬스터 {draft.monsters.length} · 리더 {draft.leaders.length} · 장신구 {draft.trinkets.length} · 공용 성장 {draft.unitGrowth.length} · 태그 {draft.tags.length}
        </p>
      </section>

      <NewDefaults draft={draft} onChange={onChange} />

      <section className="panel">
        <h3>태그</h3>
        <p className="muted">태그 시너지(예: "아군 야수 공격력 +20%")에 쓰는 계열 이름입니다.</p>
        <div className="tag-list">
          {draft.tags.map((t, i) => (
            <span key={t} className="tag-chip">
              {t}
              <button
                className="chip-x"
                title={used(t) ? '사용 중인 태그' : '삭제'}
                onClick={() => {
                  if (used(t) && !confirm(`"${t}" 태그를 쓰는 유닛이 있습니다. 목록에서만 지울까요?`)) return;
                  draft.tags.splice(i, 1);
                  onChange();
                }}
              >
                x
              </button>
            </span>
          ))}
        </div>
        <div className="inline">
          <TextInput value={newTag} placeholder="새 태그" onChange={setNewTag} />
          <button className="btn small" disabled={!newTag.trim() || draft.tags.includes(newTag.trim())} onClick={() => { draft.tags.push(newTag.trim()); setNewTag(''); onChange(); }}>
            추가
          </button>
        </div>
      </section>

      <section className="panel">
        <h3>내보내기 · 가져오기</h3>
        <p className="muted">
          모드 파일(JSON)은 터미널 버전에서도 쓸 수 있습니다: <code>npm run play -- --mod 파일.json</code>,{' '}
          <code>npm run sim -- pairs --mod 파일.json</code>
        </p>
        <div className="inline wrap">
          <button className="btn primary" onClick={exportMod}>JSON 내보내기</button>
          <label className="btn file-btn">
            JSON 가져오기
            <input
              type="file"
              accept="application/json,.json"
              onChange={async (e) => {
                const f = e.target.files?.[0];
                e.target.value = '';
                if (!f) return;
                try {
                  onReplace(parseMod(await f.text()), `"${f.name}"을(를) 불러왔습니다. 확인 후 적용하세요.`);
                  setImportErr('');
                } catch (err) {
                  setImportErr(String(err instanceof Error ? err.message : err));
                }
              }}
            />
          </label>
          <button className="btn danger" onClick={() => { if (confirm('모든 데이터를 기본값으로 되돌릴까요? (적용 전까지는 초안만 바뀝니다)')) onReplace(structuredClone(DEFAULT_MOD), '기본 데이터를 불러왔습니다. 적용하면 게임에 반영됩니다.'); }}>
            기본값으로 초기화
          </button>
        </div>
        {importErr && <p className="bad-text">{importErr}</p>}
      </section>
    </div>
  );
}

// 기본 데이터에는 있는데 이 모드에는 없는 항목. 모드를 저장한 뒤 코드에 추가된 콘텐츠가 여기 나온다.
// (일부러 지운 기본 항목도 여기 다시 보이므로, 체크를 풀고 넣으면 된다)
function NewDefaults({ draft, onChange }: { draft: ModData; onChange: () => void }) {
  const missing = missingDefaults(draft);
  const key = defaultKey;
  const [off, setOff] = useState<Set<string>>(new Set());
  const [msg, setMsg] = useState('');
  const picked = missing.filter((m) => !off.has(key(m)));
  const toggle = (k: string) => setOff((s) => {
    const n = new Set(s);
    if (n.has(k)) n.delete(k);
    else n.add(k);
    return n;
  });

  const run = () => {
    const tags = importDefaults(draft, picked);
    setMsg(`${picked.length}개 항목을 초안에 넣었습니다${tags.length ? ` (태그 추가: ${tags.join(', ')})` : ''}. 위의 "변경 사항 적용"을 눌러야 게임과 파일에 반영됩니다.`);
    setOff(new Set());
    onChange();
  };

  return (
    <section className="panel">
      <h3>새 기본 항목 가져오기</h3>
      <p className="muted">
        모드는 저장한 순간의 데이터 전체라서, 그 뒤 게임에 추가된 몬스터·장신구 등은 이 모드를 쓰는 동안 나오지 않습니다.
        기본 데이터에는 있는데 이 모드에 없는 항목을 골라 넣을 수 있습니다. 이미 있는 항목(직접 고친 것 포함)은 건드리지 않습니다.
      </p>
      {missing.length === 0 ? (
        <p className="ok-text">{msg || '빠진 기본 항목이 없습니다.'}{draft.ignoredDefaults?.length ? <> <button className="btn tiny ghost" onClick={() => { delete draft.ignoredDefaults; onChange(); }}>숨긴 {draft.ignoredDefaults.length}개 다시 보기</button></> : null}</p>
      ) : (
        <>
          {DEFAULT_KINDS.map(([kind, label]) => {
            const items = missing.filter((m) => m.kind === kind);
            if (items.length === 0) return null;
            return (
              <div key={kind} className="new-defaults">
                <h4>{label} {items.length}</h4>
                <div className="inline wrap">
                  {items.map((m) => (
                    <label key={key(m)} className={`pick-chip ${off.has(key(m)) ? '' : 'on'}`}>
                      <input type="checkbox" checked={!off.has(key(m))} onChange={() => toggle(key(m))} />
                      {m.parentName && <span className="muted">{m.parentName} › </span>}{m.name} <span className="muted">({m.id})</span>
                    </label>
                  ))}
                </div>
              </div>
            );
          })}
          <div className="inline">
            <button className="btn primary" disabled={picked.length === 0} onClick={run}>선택한 {picked.length}개 가져오기</button>
            <button className="btn small ghost" onClick={() => setOff(new Set())}>모두 선택</button>
            <button className="btn small ghost" onClick={() => setOff(new Set(missing.map(key)))}>모두 해제</button>
            <button
              className="btn small" disabled={off.size === 0} title="이 모드에 일부러 넣지 않을 기본 항목. 숨긴 항목은 다시 보이지 않습니다 (적용해야 저장)"
              onClick={() => { draft.ignoredDefaults = [...new Set([...(draft.ignoredDefaults ?? []), ...off])]; setOff(new Set()); setMsg(`${off.size}개 항목을 이 모드에서 숨겼습니다.`); onChange(); }}
            >체크 해제한 {off.size}개 숨기기</button>
          </div>
          {msg && <p className="ok-text">{msg}</p>}
        </>
      )}
    </section>
  );
}
