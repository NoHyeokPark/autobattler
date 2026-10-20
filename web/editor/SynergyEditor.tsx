// 태그 시너지 편집: 태그마다 단계(필요한 수 + 능력). 능력은 장신구처럼 기준 칸이 보드 중앙이다.
// 단계는 가장 높게 도달한 것 하나만 적용되므로, 높은 단계에는 그 단계의 효과 전체를 적는다.

import type { ModData } from '../../src/data/registry.ts';
import { describeTriggers } from '../../src/data/describe.ts';
import type { TagSynergy } from '../../src/data/types.ts';
import { Field, NumInput, TextInput } from './fields.tsx';
import { TriggerEditor } from './TriggerEditor.tsx';

export function SynergyEditor({ draft, onChange }: { draft: ModData; onChange: () => void }) {
  const list = (draft.synergies ??= []);
  const find = (tag: string) => list.find((s) => s.tag === tag);
  const create = (tag: string) => {
    const prev = list.length ? Math.max(...list.flatMap((s) => s.tiers.map((t) => t.count))) : 2;
    list.push({ tag, tiers: [{ count: Math.min(prev, 2), triggers: [{ on: 'battleStart', effects: [] }] }] });
    onChange();
  };
  return (
    <section className="panel">
      <h3>태그 시너지</h3>
      <p className="muted">
        보드에 같은 태그 유닛이 정해진 수 이상 있으면 그 단계의 능력이 생깁니다 (TFT 특성처럼, 보조 수단). 같은 몬스터는 여러 장이어도 1명, 리더의 태그도 셉니다.
        도달한 가장 높은 단계 하나만 적용되니 높은 단계에는 그 단계의 효과 전체를 적으세요. 능력은 장신구처럼 기준 칸이 보드 중앙입니다.
      </p>
      {draft.tags.map((tag) => {
        const sy = find(tag);
        return (
          <details key={tag} className="synergy-edit" open={!!sy && sy.tiers.length > 0 && list.length <= 2}>
            <summary>
              <strong>{tag}</strong>{' '}
              {sy ? <span className="muted">{sy.name ? `${sy.name} · ` : ''}{sy.tiers.map((t) => `${t.count}명`).join(' / ')}</span> : <span className="muted">시너지 없음</span>}
            </summary>
            {!sy ? (
              <button className="btn small" onClick={() => create(tag)}>+ {tag} 시너지 만들기</button>
            ) : (
              <SynergyFields sy={sy} tags={draft.tags} onChange={onChange} onDelete={() => { list.splice(list.indexOf(sy), 1); onChange(); }} />
            )}
          </details>
        );
      })}
    </section>
  );
}

function SynergyFields({ sy, tags, onChange, onDelete }: { sy: TagSynergy; tags: string[]; onChange: () => void; onDelete: () => void }) {
  return (
    <div className="synergy-fields">
      <div className="inline wrap">
        <Field label="시너지 이름" hint="비우면 태그 이름"><TextInput value={sy.name ?? ''} onChange={(v) => { if (v) sy.name = v; else delete sy.name; onChange(); }} /></Field>
        <button className="btn tiny danger" onClick={() => { if (confirm(`${sy.tag} 시너지를 지울까요?`)) onDelete(); }}>시너지 삭제</button>
      </div>
      {sy.tiers.map((t, i) => (
        <div key={i} className="synergy-tier-edit">
          <div className="inline wrap">
            <strong>{i + 1}단계</strong>
            <Field label="필요한 수"><NumInput value={t.count} min={1} width={56} onChange={(v) => { t.count = Math.max(1, v); onChange(); }} /></Field>
            <Field label="설명" hint="비우면 아래 능력으로 자동" wide>
              <TextInput value={t.desc ?? ''} placeholder={describeTriggers(t.triggers, undefined, true)} onChange={(v) => { if (v) t.desc = v; else delete t.desc; onChange(); }} />
            </Field>
            <button className="btn tiny danger" onClick={() => { sy.tiers.splice(i, 1); onChange(); }}>단계 삭제</button>
          </div>
          <TriggerEditor triggers={t.triggers} tags={tags} onChange={onChange} center />
        </div>
      ))}
      <button className="btn small" onClick={() => {
        const last = sy.tiers[sy.tiers.length - 1];
        sy.tiers.push({ count: (last?.count ?? 0) + 2, triggers: structuredClone(last?.triggers ?? [{ on: 'battleStart', effects: [] }]) });
        onChange();
      }}>+ 단계 추가 (앞 단계 능력 복사)</button>
    </div>
  );
}
