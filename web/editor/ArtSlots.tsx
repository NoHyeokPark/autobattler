// 일러스트 칸: 레벨별 + 외형 변화 성장별로 필요한 파일 목록과 현재 상태를 보여 주고 업로드한다.
// 파일은 프로젝트의 art/ 폴더에 저장된다 (개발 서버 필요). 이름 규칙은 src/data/art.ts

import { useState } from 'react';
import { ART_KEY_RE, artKey } from '../../src/data/art.ts';
import type { ArtKind, ArtRef } from '../../src/data/art.ts';
import type { GrowthDef } from '../../src/data/types.ts';
import { artFileUrl, deleteArt, hasArt, resolveArt, uploadArt, useArtVersion } from '../lib/art.ts';

interface Slot {
  label: string;
  ref: ArtRef;
}

function SlotView({ slot, onMessage }: { slot: Slot; onMessage: (m: string) => void }) {
  const [busy, setBusy] = useState(false);
  const key = artKey(slot.ref);
  const own = hasArt(key);
  const shown = resolveArt(slot.ref); // 없으면 대신 보이는 이미지
  const fileUrl = artFileUrl(key);
  const fileName = fileUrl ? fileUrl.replace(/^\/art\//, '').replace(/\?.*$/, '') : `${key}.webp`;
  return (
    <div className={`art-slot ${own ? 'has' : 'missing'}`}>
      <div className="art-thumb">
        {shown ? <img src={shown.url} alt={slot.label} loading="lazy" decoding="async" /> : <span className="muted small">없음</span>}
      </div>
      <div className="art-info">
        <strong>{slot.label}</strong>
        <code className="art-file">art/{fileName}</code>
        <span className="muted small">
          {own ? '파일 있음' : shown ? `없음 → ${shown.key.split('/')[1]} 이미지로 대신 표시` : '없음 → 글자 카드'}
        </span>
        <div className="inline">
          <label className={`btn tiny file-btn ${busy ? 'disabled' : ''}`}>
            {own ? '바꾸기' : '업로드'}
            <input
              type="file"
              accept="image/*"
              disabled={busy}
              onChange={async (e) => {
                const f = e.target.files?.[0];
                e.target.value = '';
                if (!f) return;
                setBusy(true);
                try {
                  const r = await uploadArt(key, f);
                  onMessage(`art/${key}.webp 저장 (${Math.round(r.bytes / 1024)}KB, 원본 ${Math.round(f.size / 1024)}KB → 최대 512px webp)`);
                } catch (err) {
                  onMessage(String(err instanceof Error ? err.message : err));
                } finally {
                  setBusy(false);
                }
              }}
            />
          </label>
          {own && (
            <button className="btn tiny danger" disabled={busy} onClick={async () => {
              if (!confirm(`art/${fileName} 파일을 삭제할까요?`)) return;
              try {
                await deleteArt(key);
                onMessage(`art/${fileName} 삭제`);
              } catch (err) {
                onMessage(String(err instanceof Error ? err.message : err));
              }
            }}>삭제</button>
          )}
        </div>
      </div>
    </div>
  );
}

export function ArtSlots({ kind, id, maxLevel, formGrowths, legacyArt, onClearLegacy }: {
  kind: ArtKind;
  id: string;
  maxLevel: number;
  formGrowths: GrowthDef[];
  legacyArt?: string;
  onClearLegacy?: () => void;
}) {
  useArtVersion();
  const [msg, setMsg] = useState('');
  const base: Slot[] = Array.from({ length: maxLevel }, (_, i) => ({ label: `Lv${i + 1} 기본`, ref: { kind, id, level: i + 1 } }));
  const forms: { g: GrowthDef; slots: Slot[] }[] = formGrowths.map((g) => ({
    g,
    slots: Array.from({ length: maxLevel - 1 }, (_, i) => ({ label: `Lv${i + 2} · ${g.name}`, ref: { kind, id, level: i + 2, form: g.id } })),
  }));
  const validId = ART_KEY_RE.test(`${kind}/${id}`);
  return (
    <div className="art-slots">
      <p className="muted small">
        프로젝트의 <code>art/</code> 폴더에 저장됩니다. 업로드하면 최대 512px webp로 줄입니다.
        {kind !== 'trinkets' && ' 외형 변화 성장을 고른 유닛은 그 형태의 일러스트를 쓰고, 파일이 없으면 기본 형태로 대신합니다.'}
      </p>
      {!validId && <p className="bad-text">id에 영문·숫자·_·- 외의 글자가 있어 일러스트 파일 이름으로 쓸 수 없습니다.</p>}
      <div className="art-grid">
        {base.map((s) => <SlotView key={artKey(s.ref)} slot={s} onMessage={setMsg} />)}
      </div>
      {forms.length > 0 && <h4>외형 변화 성장</h4>}
      {forms.map(({ g, slots }) => (
        <div key={g.id} className="art-grid">
          {slots.map((s) => <SlotView key={artKey(s.ref)} slot={s} onMessage={setMsg} />)}
        </div>
      ))}
      {kind !== 'trinkets' && forms.length === 0 && (
        <p className="muted small">외형 변화 성장이 없습니다. 성장 선택지에서 "외형 변화"를 켜면 여기에 칸이 생깁니다.</p>
      )}
      {legacyArt && (
        <p className="warn-text small">
          예전 방식의 이미지 주소가 데이터에 남아 있습니다 (파일이 없을 때만 쓰임).{' '}
          {onClearLegacy && <button className="btn tiny" onClick={onClearLegacy}>지우기</button>}
        </p>
      )}
      {msg && <p className="small">{msg}</p>}
      <p className="muted small">id를 바꾸면 기존 파일과 연결이 끊깁니다. 파일 이름도 같이 바꿔 주세요.</p>
    </div>
  );
}
