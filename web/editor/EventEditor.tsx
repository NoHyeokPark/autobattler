// 이벤트 편집기 (지도의 ? 노드). 이벤트 = 등장 일차 구간 + 상황 글 + 선택지, 선택지 = 글 + (골드 비용) + 결과 목록.

import { useState } from 'react';
import type { ModData } from '../../src/data/registry.ts';
import { GRADE_NAMES, LEADER_STAT_NAMES, LEADER_STATS, MAX_GRADE } from '../../src/data/types.ts';
import type { EventChoice, EventDef, EventOutcome, LeaderStat } from '../../src/data/types.ts';
import { describeChoice } from '../../src/game/events.ts';
import { Field, NumInput, OptNumInput, Select, TextArea, TextInput } from './fields.tsx';

type Props = { draft: ModData; onChange: () => void };

const OUTCOME_TYPES: [EventOutcome['type'], string][] = [
  ['trinket', '장신구'],
  ['monster', '몬스터 (다음 날 벤치로)'],
  ['growth', '리더 이벤트 성장'],
  ['gold', '골드'],
  ['life', '라이프'],
  ['leaderStat', '리더 능력치'],
];

function newOutcome(type: EventOutcome['type']): EventOutcome {
  switch (type) {
    case 'trinket': return { type, choices: 1 };
    case 'monster': return { type, choices: 1 };
    case 'growth': return { type };
    case 'gold': return { type, amount: 10 };
    case 'life': return { type, amount: 1 };
    case 'leaderStat': return { type, stat: 'atk', amount: 2 };
  }
}

function move<T>(list: T[], i: number, d: number) {
  const j = i + d;
  if (j < 0 || j >= list.length) return;
  [list[i], list[j]] = [list[j], list[i]];
}

function uniqueId(base: string, taken: { id: string }[]) {
  let i = 1;
  while (taken.some((x) => x.id === `${base}_${i}`)) i++;
  return `${base}_${i}`;
}

const dayText = (e: EventDef) => (e.minDay || e.maxDay ? `${e.minDay ?? 1}~${e.maxDay ?? ''}일차` : '모든 일차');

export function EventEditor({ draft, onChange }: Props) {
  const list = draft.events ?? (draft.events = []);
  const [sel, setSelRaw] = useState(0);
  const at = Math.min(sel, Math.max(0, list.length - 1));
  const ev = list[at] as EventDef | undefined;
  const total = list.reduce((a, e) => a + Math.max(0, e.weight ?? 1), 0);
  return (
    <div className="entity-editor">
      <aside className="entity-list">
        <div className="inline">
          <button className="btn small primary" onClick={() => {
            list.push({ id: uniqueId('event', list), name: '새 이벤트', text: '', choices: [{ text: '지나간다', outcomes: [] }] });
            setSelRaw(list.length - 1);
            onChange();
          }}>+ 새로</button>
        </div>
        <div className="event-list">
          {list.map((e, i) => (
            <button key={`${i}-${e.id}`} className={`event-list-item ${i === at ? 'active' : ''}`} onClick={() => setSelRaw(i)}>
              <strong>{e.name || e.id}</strong>
              <span className="muted small">{dayText(e)} · 비율 {e.weight ?? 1}{total > 0 ? ` (${Math.round((100 * Math.max(0, e.weight ?? 1)) / total)}%)` : ''} · 선택지 {e.choices.length}</span>
            </button>
          ))}
        </div>
        <p className="muted small">이벤트 노드(?)에서 전투 뒤, 그날 일차에 맞는 이벤트 중 비율대로 하나가 나옵니다. 고를 수 있는 선택지가 하나도 없으면(골드 부족 등) 그 이벤트는 그날 나오지 않습니다.</p>
      </aside>
      {ev ? (
        <section className="entity-form">
          <div className="entity-form-head">
            <h3>{ev.name} <span className="muted mono">{ev.id}</span></h3>
            <div className="spacer" />
            <button className="btn small" onClick={() => {
              list.push({ ...structuredClone(ev), id: uniqueId(ev.id, list), name: `${ev.name} 복사본` });
              setSelRaw(list.length - 1);
              onChange();
            }}>복제</button>
            <button className="btn small danger" onClick={() => {
              if (!confirm(`${ev.name}을(를) 삭제할까요?`)) return;
              list.splice(at, 1);
              onChange();
            }}>삭제</button>
          </div>
          <div className="form-grid">
            <Field label="id"><TextInput mono value={ev.id} onChange={(v) => { ev.id = v; onChange(); }} /></Field>
            <Field label="이름"><TextInput value={ev.name} onChange={(v) => { ev.name = v; onChange(); }} /></Field>
            <Field label="등장 비율" hint="다른 이벤트와의 상대 비율 (0 = 안 나옴)">
              <NumInput value={ev.weight ?? 1} min={0} onChange={(v) => { if (v === 1) delete ev.weight; else ev.weight = v; onChange(); }} />
            </Field>
            <Field label="등장 일차 (부터)" hint="비우면 처음부터">
              <OptNumInput value={ev.minDay} min={1} onChange={(v) => { if (v === undefined) delete ev.minDay; else ev.minDay = v; onChange(); }} />
            </Field>
            <Field label="등장 일차 (까지)" hint="비우면 끝까지">
              <OptNumInput value={ev.maxDay} min={1} onChange={(v) => { if (v === undefined) delete ev.maxDay; else ev.maxDay = v; onChange(); }} />
            </Field>
            <Field label="상황 글 (모달)" wide><TextArea rows={3} value={ev.text} onChange={(v) => { ev.text = v; onChange(); }} /></Field>
          </div>
          <h4>선택지</h4>
          <div className="trigger-list">
            {ev.choices.map((c, ci) => (
              <ChoiceEditor key={ci} c={c} index={ci} draft={draft} onChange={onChange}
                onMove={(d) => { move(ev.choices, ci, d); onChange(); }}
                onDelete={ev.choices.length > 1 ? () => { ev.choices.splice(ci, 1); onChange(); } : undefined} />
            ))}
          </div>
          <button className="btn small" onClick={() => { ev.choices.push({ text: '새 선택지', outcomes: [] }); onChange(); }}>+ 선택지</button>
          <h4>미리 보기</h4>
          <div className="event-preview">
            <strong>이벤트: {ev.name}</strong>
            <p className="event-text">{ev.text || '(상황 글 없음)'}</p>
            <div className="event-choices">
              {ev.choices.map((c, i) => (
                <div key={i} className="event-choice">
                  <strong>{c.text}</strong>
                  <span className="muted small">{describeChoice(c)}</span>
                </div>
              ))}
            </div>
          </div>
        </section>
      ) : (
        <section className="entity-form"><p className="muted">이벤트가 없습니다. 이벤트 노드는 전투만 하고 넘어갑니다.</p></section>
      )}
    </div>
  );
}

function ChoiceEditor({ c, index, draft, onChange, onMove, onDelete }: {
  c: EventChoice; index: number; draft: ModData; onChange: () => void; onMove: (d: number) => void; onDelete?: () => void;
}) {
  return (
    <div className="trigger">
      <div className="trigger-head">
        <span className="trigger-no">선택지 {index + 1}</span>
        <span className="trigger-summary">{describeChoice(c)}</span>
        <div className="spacer" />
        <button className="btn tiny" onClick={() => onMove(-1)}>위</button>
        <button className="btn tiny" onClick={() => onMove(1)}>아래</button>
        {onDelete && <button className="btn tiny danger" onClick={onDelete}>삭제</button>}
      </div>
      <div className="form-grid">
        <Field label="선택지 글" wide><TextInput value={c.text} onChange={(v) => { c.text = v; onChange(); }} /></Field>
        <Field label="골드 비용" hint="모자라면 고를 수 없음 (비우면 없음)">
          <OptNumInput value={c.cost} min={0} onChange={(v) => { if (!v) delete c.cost; else c.cost = v; onChange(); }} />
        </Field>
        <Field label="결과 글" hint="고른 뒤 알림에 보일 글 (비우면 선택지 글)" wide>
          <TextInput value={c.result ?? ''} onChange={(v) => { if (v) c.result = v; else delete c.result; onChange(); }} />
        </Field>
      </div>
      <div className="event-outcomes">
        {c.outcomes.map((o, oi) => (
          <OutcomeEditor key={oi} o={o} draft={draft}
            onReplace={(next) => { c.outcomes[oi] = next; onChange(); }}
            onChange={onChange}
            onDelete={() => { c.outcomes.splice(oi, 1); onChange(); }} />
        ))}
        <button className="btn tiny" onClick={() => { c.outcomes.push(newOutcome('trinket')); onChange(); }}>+ 결과</button>
      </div>
    </div>
  );
}

function OutcomeEditor({ o, draft, onReplace, onChange, onDelete }: {
  o: EventOutcome; draft: ModData; onReplace: (o: EventOutcome) => void; onChange: () => void; onDelete: () => void;
}) {
  const gradeOptions: [number, string][] = [[0, '일차 확률표'], ...Array.from({ length: MAX_GRADE }, (_, i) => [i + 1, GRADE_NAMES[i + 1]] as [number, string])];
  return (
    <div className="effect-head event-outcome">
      <Select value={o.type} options={OUTCOME_TYPES} onChange={(t) => onReplace(newOutcome(t))} />
      {(o.type === 'trinket' || o.type === 'monster') && (() => {
        const items = o.type === 'trinket' ? draft.trinkets : draft.monsters;
        return (
          <>
            <Select value={o.id ? 'fixed' : 'random'} options={[['random', '등급에서 무작위'], ['fixed', '지정']]} onChange={(m) => {
              if (m === 'fixed') { o.id = items[0]?.id; delete o.grade; delete o.choices; } else { delete o.id; o.choices = 1; }
              onChange();
            }} />
            {o.id ? (
              <Select value={o.id} options={items.map((x) => [x.id, `${x.name} (${GRADE_NAMES[x.grade]})`] as [string, string])} onChange={(id) => { o.id = id; onChange(); }} />
            ) : (
              <>
                <Select value={o.grade ?? 0} options={gradeOptions} onChange={(g) => { if (g) o.grade = g; else delete o.grade; onChange(); }} />
                <span className="inline" title="1 = 바로 하나 지급, 2 이상 = 그 등급에서 이만큼 보여 주고 하나 고르기 (안 고르면 골드)">
                  <NumInput value={o.choices ?? 1} min={1} width={48} onChange={(v) => { o.choices = v; onChange(); }} />개 중 고르기
                </span>
              </>
            )}
          </>
        );
      })()}
      {o.type === 'growth' && (
        <Select value={o.id ?? ''} options={[['', '아직 없는 것 중 무작위'], ...(draft.eventGrowth ?? []).map((g) => [g.id, g.name] as [string, string])]}
          onChange={(id) => { if (id) o.id = id; else delete o.id; onChange(); }} />
      )}
      {o.type === 'gold' && (
        <>
          <NumInput value={o.amount} width={64} onChange={(v) => { o.amount = v; onChange(); }} />
          <span className="inline" title="일차마다 더하는 골드 (예: 1이면 5일차에 +5)">+ 일차 ×
            <NumInput value={o.perDay ?? 0} width={48} onChange={(v) => { if (v) o.perDay = v; else delete o.perDay; onChange(); }} />
          </span>
          <span className="muted small">음수면 잃음</span>
        </>
      )}
      {o.type === 'life' && (
        <>
          <NumInput value={o.amount} width={56} onChange={(v) => { o.amount = v; onChange(); }} />
          <span className="muted small">음수면 잃음 (라이프가 0이 되는 선택지는 고를 수 없음)</span>
        </>
      )}
      {o.type === 'leaderStat' && (
        <>
          <Select value={o.stat} options={LEADER_STATS.map((k) => [k, LEADER_STAT_NAMES[k]] as [LeaderStat, string])} onChange={(k) => { o.stat = k; onChange(); }} />
          <NumInput value={o.amount} width={64} onChange={(v) => { o.amount = v; onChange(); }} />
        </>
      )}
      <div className="spacer" />
      <button className="btn tiny danger" onClick={onDelete}>삭제</button>
    </div>
  );
}
