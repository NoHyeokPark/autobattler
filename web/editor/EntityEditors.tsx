// 몬스터·리더·장신구 편집기. 왼쪽은 카드 목록, 오른쪽은 폼 + 카드 미리보기 + JSON 직접 편집.
// 편집은 초안(draft) 객체를 제자리에서 바꾸고 onChange로 알린다. 게임에는 "적용"을 눌러야 반영된다.

import { useState } from 'react';
import type { ReactNode } from 'react';
import { BALANCE } from '../../src/config/balance.ts';
import { describeGrowth, describeTrigger, describeTriggers } from '../../src/data/describe.ts';
import type { ModData } from '../../src/data/registry.ts';
import type { GrowthDef, LeaderDef, MonsterDef, TrinketDef, Trigger, UnitDef } from '../../src/data/types.ts';
import { GRADE_NAMES } from '../../src/data/types.ts';
import { Card, growthCard, leaderCard, monsterCard, trinketCard } from '../components/Card.tsx';
import type { CardData } from '../components/Card.tsx';
import { Check, Field, NumInput, NumListInput, OptNumInput, Select, TextArea, TextInput } from './fields.tsx';
import { ArtSlots } from './ArtSlots.tsx';
import { TriggerEditor } from './TriggerEditor.tsx';

interface EditorProps {
  draft: ModData;
  onChange: () => void;
}

const GRADE_OPTS: [number, string][] = [1, 2, 3, 4, 5, 6].map((g) => [g, `${g} ${GRADE_NAMES[g]}`]);

function uniqueId(base: string, taken: { id: string }[]) {
  let i = 1;
  while (taken.some((x) => x.id === `${base}_${i}`)) i++;
  return `${base}_${i}`;
}

// ── 공통 조각 ──

function DescField({ value, auto, onChange }: { value: string; auto: string; onChange: (v: string) => void }) {
  return (
    <Field label="설명" hint="비워 두면 아래 트리거에서 자동 생성한 설명을 카드에 씁니다" wide>
      <TextArea value={value} onChange={onChange} placeholder={auto} />
      <div className="inline">
        <button className="btn small" onClick={() => onChange(auto)}>자동 설명으로 채우기</button>
        <button className="btn small ghost" onClick={() => onChange('')}>비우기(자동)</button>
      </div>
    </Field>
  );
}

function TagsField({ tags, all, onChange }: { tags: string[]; all: string[]; onChange: () => void }) {
  return (
    <Field label="태그" wide>
      <div className="tag-checks">
        {all.map((t) => (
          <Check key={t} label={t} value={tags.includes(t)} onChange={(on) => {
            const i = tags.indexOf(t);
            if (on && i < 0) tags.push(t);
            if (!on && i >= 0) tags.splice(i, 1);
            onChange();
          }} />
        ))}
      </div>
    </Field>
  );
}

function UnitStatFields({ u, onChange }: { u: UnitDef; onChange: () => void }) {
  const TPS = BALANCE.ticksPerSec;
  return (
    <>
      <Field label="체력"><NumInput value={u.hp} min={1} onChange={(v) => { u.hp = v; onChange(); }} /></Field>
      <Field label="공격력"><NumInput value={u.atk} min={0} onChange={(v) => { u.atk = v; onChange(); }} /></Field>
      <Field label="주문력" hint="독·재생·강화 같은 수치형 능력의 기준 (레벨업으로 함께 성장)">
        <OptNumInput value={u.power} min={0} onChange={(v) => { if (v) u.power = v; else delete u.power; onChange(); }} />
      </Field>
      <Field label="행동 간격 (tick)" hint={`${TPS} tick = 1초 → 현재 ${(u.intervalTicks / TPS).toFixed(1)}초`}>
        <NumInput value={u.intervalTicks} min={1} onChange={(v) => { u.intervalTicks = v; onChange(); }} />
      </Field>
      <Field label="기본 추가발동"><OptNumInput value={u.extra} min={0} onChange={(v) => { if (v) u.extra = v; else delete u.extra; onChange(); }} /></Field>
    </>
  );
}

// 객체를 JSON으로 직접 편집 (모드 도구용)
function JsonBox({ obj, onChange }: { obj: object; onChange: () => void }) {
  const [text, setText] = useState(() => JSON.stringify(obj, null, 2));
  const [err, setErr] = useState('');
  return (
    <details className="json-box" onToggle={() => setText(JSON.stringify(obj, null, 2))}>
      <summary>JSON 직접 편집</summary>
      <textarea className="input mono" rows={14} value={text} onChange={(e) => setText(e.target.value)} />
      <div className="inline">
        <button className="btn small" onClick={() => {
          try {
            const next = JSON.parse(text) as Record<string, unknown>;
            const rec = obj as Record<string, unknown>;
            for (const k of Object.keys(rec)) delete rec[k];
            Object.assign(rec, next);
            setErr('');
            onChange();
          } catch (e) {
            setErr(String(e));
          }
        }}>JSON 반영</button>
        <button className="btn small ghost" onClick={() => setText(JSON.stringify(obj, null, 2))}>되돌리기</button>
        {err && <span className="bad-text">{err}</span>}
      </div>
    </details>
  );
}

function EntityLayout<T extends { id: string; name: string }>({ items, sel, setSel, toCard, filter, onAdd, onDuplicate, onDelete, children, preview }: {
  items: T[];
  sel: number;
  setSel: (i: number) => void;
  toCard: (x: T) => CardData;
  filter?: (x: T) => boolean;
  onAdd: () => void;
  onDuplicate: () => void;
  onDelete: () => void;
  children: ReactNode;
  preview: ReactNode;
}) {
  const [q, setQ] = useState('');
  const visible = items.map((x, i) => ({ x, i })).filter(({ x }) => (!q || x.name.includes(q) || x.id.includes(q)) && (!filter || filter(x)));
  return (
    <div className="entity-editor">
      <aside className="entity-list">
        <div className="inline">
          <input className="input" placeholder="검색" value={q} onChange={(e) => setQ(e.target.value)} />
          <button className="btn small primary" onClick={onAdd}>+ 새로</button>
        </div>
        <div className="entity-cards">
          {visible.map(({ x, i }) => (
            <Card key={`${i}-${x.id}`} data={toCard(x)} size="sm" selected={i === sel} onClick={() => setSel(i)} />
          ))}
        </div>
      </aside>
      {items[sel] ? (
        <section className="entity-form">
          <div className="entity-form-head">
            <h3>{items[sel].name} <span className="muted mono">{items[sel].id}</span></h3>
            <div className="spacer" />
            <button className="btn small" onClick={onDuplicate}>복제</button>
            <button className="btn small danger" onClick={onDelete}>삭제</button>
          </div>
          <div className="entity-body">
            <div className="form-grid">{children}</div>
            <div className="preview">{preview}</div>
          </div>
        </section>
      ) : (
        <section className="entity-form"><p className="muted">왼쪽에서 항목을 고르세요.</p></section>
      )}
    </div>
  );
}

function useSelection(len: number) {
  const [sel, setSel] = useState(0);
  return [Math.min(sel, Math.max(0, len - 1)), setSel] as const;
}

// ── 몬스터 ──

export function MonsterEditor({ draft, onChange }: EditorProps) {
  const list = draft.monsters;
  const [sel, setSel] = useSelection(list.length);
  const [grade, setGrade] = useState(0);
  const m = list[sel] as MonsterDef | undefined;
  return (
    <>
      <div className="inline filter-bar">
        <span className="muted">등급</span>
        <Select value={grade} options={[[0, '전체'], ...GRADE_OPTS]} onChange={setGrade} />
        <span className="muted">{list.length}종</span>
      </div>
      <EntityLayout
        items={list}
        sel={sel}
        setSel={setSel}
        toCard={(x) => monsterCard(x)}
        filter={(x) => !grade || x.grade === grade}
        onAdd={() => {
          list.push({ id: uniqueId('monster', list), name: '새 몬스터', grade: grade || 1, tags: [], hp: 40, atk: 5, intervalTicks: 20, triggers: [{ on: 'act', effects: [{ type: 'damage', atkPct: 100 }] }], desc: '' });
          setSel(list.length - 1);
          onChange();
        }}
        onDuplicate={() => {
          if (!m) return;
          list.push({ ...structuredClone(m), id: uniqueId(m.id, list), name: `${m.name} 복사본` });
          setSel(list.length - 1);
          onChange();
        }}
        onDelete={() => {
          if (!m || !confirm(`${m.name}을(를) 삭제할까요?`)) return;
          list.splice(sel, 1);
          onChange();
        }}
        preview={m && (
          <>
            <Card data={monsterCard(m, 1)} size="lg" />
            <div className="card-row">
              <Card data={monsterCard(m, 2)} size="sm" />
              <Card data={monsterCard(m, 3)} size="sm" />
            </div>
            <p className="muted small">가격 {BALANCE.economy.monsterCost[m.grade - 1]}G · Lv2/Lv3는 능력치 배율 {BALANCE.unit.levelStatPct.slice(1).join('%/')}%</p>
          </>
        )}
      >
        {m && (
          <>
            <Field label="id" hint="기록·저장에 쓰이는 고유 키"><TextInput mono value={m.id} onChange={(v) => { m.id = v; onChange(); }} /></Field>
            <Field label="이름"><TextInput value={m.name} onChange={(v) => { m.name = v; onChange(); }} /></Field>
            <Field label="등급"><Select value={m.grade} options={GRADE_OPTS} onChange={(v) => { m.grade = v; onChange(); }} /></Field>
            <UnitStatFields u={m} onChange={onChange} />
            <TagsField tags={m.tags} all={draft.tags} onChange={onChange} />
            <div className="field-wide">
              <h4>일러스트</h4>
              <ArtSlots
                kind="monsters"
                id={m.id}
                maxLevel={BALANCE.unit.maxLevel}
                formGrowths={[...(m.growth ?? []), ...draft.unitGrowth].filter((g) => g.form)}
                legacyArt={m.art}
                onClearLegacy={() => { delete m.art; onChange(); }}
              />
            </div>
            <DescField value={m.desc} auto={describeTriggers(m.triggers, m.extra)} onChange={(v) => { m.desc = v; onChange(); }} />
            <div className="field-wide">
              <h4>기본 능력 (트리거 → 효과)</h4>
              <TriggerEditor triggers={m.triggers} tags={draft.tags} onChange={onChange} numbered />
            </div>
            <div className="field-wide">
              <h4>
                전용 성장 선택지 ({m.growth?.length ?? 0})
                <span className="muted small"> Lv2가 될 때 공용 성장 {draft.unitGrowth.length}개와 섞어 {BALANCE.unit.growthChoices}개를 제시. Lv3은 합성한 Lv2 3장의 성장을 모두 가짐</span>
              </h4>
              <GrowthList list={(m.growth ??= [])} tags={draft.tags} baseTriggers={m.triggers} onChange={onChange} />
            </div>
            <div className="field-wide"><JsonBox key={`${sel}-${m.id}`} obj={m} onChange={onChange} /></div>
          </>
        )}
      </EntityLayout>
    </>
  );
}

// ── 성장 선택지 (리더·몬스터·공용 공통) ──

const GROWTH_STATS: [keyof NonNullable<GrowthDef['stats']>, string, string?][] = [
  ['atk', '공격력 +'],
  ['atkPct', '공격력 %'],
  ['hp', '체력 +'],
  ['hpPct', '체력 %'],
  ['power', '주문력 +'],
  ['powerPct', '주문력 %'],
  ['intervalPct', '행동 간격 %', '음수면 빨라짐'],
  ['extra', '추가발동 +'],
  ['healShieldPct', '회복·실드 %'],
];

function TagToggles({ label, list, all, onChange }: { label: string; list: string[]; all: string[]; onChange: (v: string[]) => void }) {
  return (
    <Field label={label} wide>
      <div className="tag-checks">
        {all.map((t) => (
          <Check key={t} label={t} value={list.includes(t)} onChange={(on) => onChange(on ? [...list, t] : list.filter((x) => x !== t))} />
        ))}
      </div>
    </Field>
  );
}

// baseTriggers: 이 성장이 붙는 유닛의 기본 능력 (공용 성장은 없음 → 번호로 지정)
function GrowthEditor({ g, tags, baseTriggers, leader, onChange, onDelete }: {
  g: GrowthDef;
  tags: string[];
  baseTriggers?: Trigger[];
  leader?: boolean;
  onChange: () => void;
  onDelete: () => void;
}) {
  const stats = g.stats ?? {};
  const setStat = (key: keyof NonNullable<GrowthDef['stats']>, v: number | undefined) => {
    g.stats ??= {};
    if (v === undefined || v === 0) delete g.stats[key];
    else g.stats[key] = v;
    if (Object.keys(g.stats).length === 0) delete g.stats;
    onChange();
  };
  const setList = (key: 'addTags' | 'removeTags' | 'removeTriggers', v: (string | number)[]) => {
    if (v.length) (g as unknown as Record<string, unknown>)[key] = v;
    else delete g[key];
    onChange();
  };
  const removed = g.removeTriggers ?? [];
  const auto = describeGrowth(g, baseTriggers);
  return (
    <details className="growth">
      <summary>
        <strong>{g.name}</strong> <span className="muted">{g.desc || auto}</span>
        {g.repeatable && <span className="pill small-pill">반복</span>}
        {g.form && <span className="pill small-pill">외형 변화</span>}
      </summary>
      <div className="form-grid">
        <Field label="id"><TextInput mono value={g.id} onChange={(v) => { g.id = v; onChange(); }} /></Field>
        <Field label="이름"><TextInput value={g.name} onChange={(v) => { g.name = v; onChange(); }} /></Field>
        <Field label="설명" hint="비우면 아래 내용으로 자동 설명" wide><TextInput value={g.desc} placeholder={auto} onChange={(v) => { g.desc = v; onChange(); }} /></Field>
        <Check label="반복 선택 가능" value={g.repeatable} onChange={(v) => { g.repeatable = v; onChange(); }} />
        <Check
          label="외형 변화 (일러스트가 바뀜)"
          value={!!g.form}
          onChange={(v) => { if (v) g.form = true; else delete g.form; onChange(); }}
        />
        {leader && (
          <Field label="배치 인원 +" hint="통솔력. 9칸이 차면 선택지에서 빠짐">
            <OptNumInput value={g.deploy} min={0} onChange={(v) => { if (v) g.deploy = v; else delete g.deploy; onChange(); }} />
          </Field>
        )}
        {GROWTH_STATS.map(([key, label, hint]) => (
          <Field key={key} label={label} hint={hint}>
            <OptNumInput value={stats[key]} onChange={(v) => setStat(key, v)} />
          </Field>
        ))}
        <TagToggles label="태그 추가" list={g.addTags ?? []} all={tags} onChange={(v) => setList('addTags', v)} />
        <TagToggles label="태그 제거" list={g.removeTags ?? []} all={tags} onChange={(v) => setList('removeTags', v)} />
        <Field label="기본 능력 제거" hint="고르면 해당 기본 능력이 사라집니다 (새 능력과 함께 쓰면 '교체')" wide>
          {baseTriggers ? (
            <div className="remove-list">
              {baseTriggers.length === 0 && <span className="muted">기본 능력이 없습니다.</span>}
              {baseTriggers.map((t, i) => (
                <Check
                  key={i}
                  label={`능력 ${i + 1}: ${describeTrigger(t)}`}
                  value={removed.includes(i)}
                  onChange={(on) => setList('removeTriggers', on ? [...removed, i].sort() : removed.filter((x) => x !== i))}
                />
              ))}
            </div>
          ) : (
            <NumListInput value={removed.map((i) => i + 1)} onChange={(v) => setList('removeTriggers', v.filter((x) => x >= 1).map((x) => x - 1))} />
          )}
        </Field>
        <div className="field-wide">
          <h4>새 능력 추가</h4>
          <TriggerEditor triggers={(g.triggers ??= [])} tags={tags} onChange={onChange} />
        </div>
        <button className="btn small danger" onClick={onDelete}>이 성장 삭제</button>
      </div>
    </details>
  );
}

function GrowthList({ list, tags, baseTriggers, leader, onChange }: { list: GrowthDef[]; tags: string[]; baseTriggers?: Trigger[]; leader?: boolean; onChange: () => void }) {
  return (
    <>
      {list.map((g, i) => (
        <GrowthEditor key={i} g={g} tags={tags} baseTriggers={baseTriggers} leader={leader} onChange={onChange} onDelete={() => { list.splice(i, 1); onChange(); }} />
      ))}
      <button className="btn small" onClick={() => { list.push({ id: uniqueId('growth', list), name: '새 성장', desc: '', repeatable: false }); onChange(); }}>
        + 성장 추가
      </button>
    </>
  );
}

// 모든 몬스터가 공유하는 성장 선택지
export function CommonGrowthEditor({ draft, onChange }: EditorProps) {
  return (
    <section className="panel">
      <h3>공용 몬스터 성장 ({draft.unitGrowth.length})</h3>
      <p className="muted">
        몬스터가 3장 합성으로 Lv2가 될 때, 그 몬스터의 전용 성장과 이 목록을 합쳐 {BALANCE.unit.growthChoices}개를 무작위로 제시합니다. Lv3은 새로 고르지 않고 합성에 쓴 Lv2 3장의 성장을 모두 물려받습니다(반복 불가 성장이 겹치면 하나만).
        전용 성장과 id가 같으면 전용 쪽이 우선합니다. 공용 성장의 "기본 능력 제거"는 몬스터마다 능력이 달라서 번호(1부터)로 지정합니다.
      </p>
      <div className="card-row wrap growth-cards">
        {draft.unitGrowth.map((g, i) => <Card key={i} data={growthCard(g)} size="sm" />)}
      </div>
      <GrowthList list={draft.unitGrowth} tags={draft.tags} onChange={onChange} />
    </section>
  );
}

// ── 리더 ──

export function LeaderEditor({ draft, onChange }: EditorProps) {
  const list = draft.leaders;
  const [sel, setSel] = useSelection(list.length);
  const l = list[sel] as LeaderDef | undefined;
  return (
    <EntityLayout
      items={list}
      sel={sel}
      setSel={setSel}
      toCard={(x) => leaderCard(x)}
      onAdd={() => {
        list.push({
          id: uniqueId('leader', list), name: '새 리더', tags: [], hp: 120, atk: 6, intervalTicks: 20, desc: '',
          triggers: [{ on: 'act', effects: [{ type: 'damage', atkPct: 100 }] }],
          growth: [{ id: 'command', name: '통솔력', desc: '배치 인원 +1', repeatable: true, deploy: 1 }],
        });
        setSel(list.length - 1);
        onChange();
      }}
      onDuplicate={() => {
        if (!l) return;
        list.push({ ...structuredClone(l), id: uniqueId(l.id, list), name: `${l.name} 복사본` });
        setSel(list.length - 1);
        onChange();
      }}
      onDelete={() => {
        if (!l || !confirm(`${l.name}을(를) 삭제할까요?`)) return;
        list.splice(sel, 1);
        onChange();
      }}
      preview={l && (
        <>
          <Card data={leaderCard(l, 1)} size="lg" />
          <p className="muted small">레벨당 체력·공격력·주문력 +{BALANCE.leader.statPctPerLevel}% · 레벨업 {BALANCE.leader.levelUpDays.join('·')}일차</p>
          <div className="card-row wrap">
            {l.growth.map((g, i) => <Card key={i} data={growthCard(g, l.triggers)} size="sm" />)}
          </div>
        </>
      )}
    >
      {l && (
        <>
          <Field label="id"><TextInput mono value={l.id} onChange={(v) => { l.id = v; onChange(); }} /></Field>
          <Field label="이름"><TextInput value={l.name} onChange={(v) => { l.name = v; onChange(); }} /></Field>
          <UnitStatFields u={l} onChange={onChange} />
          <TagsField tags={l.tags} all={draft.tags} onChange={onChange} />
          <div className="field-wide">
            <h4>일러스트</h4>
            <ArtSlots
              kind="leaders"
              id={l.id}
              maxLevel={1 + BALANCE.leader.levelUpDays.length}
              formGrowths={l.growth.filter((g) => g.form)}
              legacyArt={l.art}
              onClearLegacy={() => { delete l.art; onChange(); }}
            />
          </div>
          <DescField value={l.desc} auto={describeTriggers(l.triggers, l.extra)} onChange={(v) => { l.desc = v; onChange(); }} />
          <div className="field-wide">
            <h4>기본 능력</h4>
            <TriggerEditor triggers={l.triggers} tags={draft.tags} onChange={onChange} numbered />
          </div>
          <div className="field-wide">
            <h4>성장 선택지 ({l.growth.length}) <span className="muted small">레벨업 때 {BALANCE.leader.growthChoices}개를 무작위로 제시</span></h4>
            <GrowthList list={l.growth} tags={draft.tags} baseTriggers={l.triggers} leader onChange={onChange} />
          </div>
          <div className="field-wide"><JsonBox key={`${sel}-${l.id}`} obj={l} onChange={onChange} /></div>
        </>
      )}
    </EntityLayout>
  );
}

// ── 장신구 ──

export function TrinketEditor({ draft, onChange }: EditorProps) {
  const list = draft.trinkets;
  const [sel, setSel] = useSelection(list.length);
  const t = list[sel] as TrinketDef | undefined;
  const passive = (key: 'incomeBonus' | 'shopLevel', label: string, hint: string) => t && (
    <Field label={label} hint={hint}>
      <OptNumInput value={t.passive?.[key]} min={0} onChange={(v) => {
        t.passive ??= {};
        if (v) t.passive[key] = v;
        else delete t.passive[key];
        if (Object.keys(t.passive).length === 0) delete t.passive;
        onChange();
      }} />
    </Field>
  );
  return (
    <EntityLayout
      items={list}
      sel={sel}
      setSel={setSel}
      toCard={(x) => trinketCard(x)}
      onAdd={() => {
        list.push({ id: uniqueId('trinket', list), name: '새 장신구', grade: 1, desc: '', triggers: [{ on: 'battleStart', effects: [{ type: 'shield', flat: 30 }] }] });
        setSel(list.length - 1);
        onChange();
      }}
      onDuplicate={() => {
        if (!t) return;
        list.push({ ...structuredClone(t), id: uniqueId(t.id, list), name: `${t.name} 복사본` });
        setSel(list.length - 1);
        onChange();
      }}
      onDelete={() => {
        if (!t || !confirm(`${t.name}을(를) 삭제할까요?`)) return;
        list.splice(sel, 1);
        onChange();
      }}
      preview={t && (
        <>
          <Card data={trinketCard(t)} size="lg" />
          <p className="muted small">
            {t.grade === 6 ? '기원 등급: 상점에 나오지 않음 (12일차 보스 보상)' : `상점 가격 ${BALANCE.economy.trinketCost[t.grade - 1]}G`}
          </p>
        </>
      )}
    >
      {t && (
        <>
          <Field label="id"><TextInput mono value={t.id} onChange={(v) => { t.id = v; onChange(); }} /></Field>
          <Field label="이름"><TextInput value={t.name} onChange={(v) => { t.name = v; onChange(); }} /></Field>
          <Field label="등급"><Select value={t.grade} options={GRADE_OPTS} onChange={(v) => { t.grade = v; onChange(); }} /></Field>
          {passive('incomeBonus', '매일 수입 +', '보유 효과 (전투 밖)')}
          {passive('shopLevel', '상점 레벨 +', '확률표를 한 단계 앞당김')}
          <div className="field-wide">
            <h4>일러스트</h4>
            <ArtSlots kind="trinkets" id={t.id} maxLevel={1} formGrowths={[]} legacyArt={t.art} onClearLegacy={() => { delete t.art; onChange(); }} />
          </div>
          <DescField value={t.desc} auto={describeTriggers(t.triggers)} onChange={(v) => { t.desc = v; onChange(); }} />
          <div className="field-wide">
            <h4>전투 효과 (시스템 효과로 처리 — 유닛보다 먼저, 추가발동·기절 영향 없음)</h4>
            <TriggerEditor triggers={t.triggers} tags={draft.tags} onChange={onChange} />
          </div>
          <div className="field-wide"><JsonBox key={`${sel}-${t.id}`} obj={t} onChange={onChange} /></div>
        </>
      )}
    </EntityLayout>
  );
}
