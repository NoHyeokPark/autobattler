// 모드 관리: 이름, 태그 목록, 내보내기/가져오기, 기본값으로 초기화.

import { useState } from 'react';
import { DEFAULT_MOD, parseMod } from '../../src/data/registry.ts';
import type { ModData } from '../../src/data/registry.ts';
import { Field, TextInput } from './fields.tsx';

export function ModPanel({ draft, onChange, onReplace }: { draft: ModData; onChange: () => void; onReplace: (mod: ModData, note: string) => void }) {
  const [newTag, setNewTag] = useState('');
  const [importErr, setImportErr] = useState('');
  const used = (t: string) =>
    JSON.stringify([draft.monsters, draft.leaders, draft.trinkets, draft.unitGrowth]).includes(`"${t}"`);

  const exportMod = () => {
    const blob = new Blob([JSON.stringify(draft, null, 2)], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `${draft.name.replace(/[\\/:*?"<>|\s]+/g, '_') || 'mod'}.json`;
    a.click();
    URL.revokeObjectURL(a.href);
  };

  return (
    <div className="mod-panel">
      <section className="panel">
        <h3>모드 정보</h3>
        <div className="form-grid">
          <Field label="모드 이름"><TextInput value={draft.name} onChange={(v) => { draft.name = v; onChange(); }} /></Field>
        </div>
        <p className="muted">
          몬스터 {draft.monsters.length} · 리더 {draft.leaders.length} · 장신구 {draft.trinkets.length} · 공용 성장 {draft.unitGrowth.length} · 태그 {draft.tags.length}
        </p>
      </section>

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
