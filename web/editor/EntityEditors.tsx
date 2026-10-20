// 몬스터·리더·장신구 편집기. 왼쪽은 카드 목록, 오른쪽은 폼 + 카드 미리보기 + JSON 직접 편집.
// 편집은 초안(draft) 객체를 제자리에서 바꾸고 onChange로 알린다. 게임에는 "적용"을 눌러야 반영된다.

import { useState } from 'react';
import type { ReactNode } from 'react';
import { BALANCE } from '../../src/config/balance.ts';
import { describeGrowth, describeTrigger, describeTriggers } from '../../src/data/describe.ts';
import type { ModData } from '../../src/data/registry.ts';
import type { GrowthDef, LeaderDef, LeaderLines, MonsterDef, MonsterLines, TrinketDef, Trigger, UnitDef } from '../../src/data/types.ts';
import { isOneShot } from '../../src/data/trinkets.ts';
import { GRADE_NAMES, LINE_KEYS, MAX_GRADE, MONSTER_LINE_KEYS, ORIGIN_GRADE } from '../../src/data/types.ts';
import { Card, growthCard, leaderCard, monsterCard, trinketCard } from '../components/Card.tsx';
import type { CardData } from '../components/Card.tsx';
import { Check, Field, NumInput, NumListInput, OptNumInput, Select, TextArea, TextInput } from './fields.tsx';
import { ArtSlots } from './ArtSlots.tsx';
import { TriggerEditor } from './TriggerEditor.tsx';
import { LeaderIntro } from '../game/LeaderIntro.tsx';
import { PromotionPreview } from '../game/PromotionChoice.tsx';
import { loadProfile } from '../lib/persist.ts';

interface EditorProps {
  draft: ModData;
  onChange: () => void;
}

const GRADE_OPTS: [number, string][] = GRADE_NAMES.slice(1).map((name, i) => [i + 1, `${i + 1} ${name}`]);
const GRADE_RANGE_OPTS: [number, string][] = [[0, '제한 없음'], ...GRADE_OPTS];

function uniqueId(base: string, taken: { id: string }[]) {
  let i = 1;
  while (taken.some((x) => x.id === `${base}_${i}`)) i++;
  return `${base}_${i}`;
}

// ── 공통 조각 ──

// 상황별 대사 (전투 시작·위기·승리·패배, 전직이면 전직 대사도). rival = 상대 리더로 나왔을 때. 비운 칸은 저장하지 않는다
function LinesFields({ owner, promotion, rival, onChange }: { owner: { lines?: LeaderLines; rivalLines?: LeaderLines }; promotion?: boolean; rival?: boolean; onChange: () => void }) {
  const field = rival ? 'rivalLines' : 'lines';
  const keys: [keyof LeaderLines, string][] = promotion && !rival ? [['promote', '전직할 때 (선택지·전직 연출)'], ...LINE_KEYS] : LINE_KEYS;
  const set = (k: keyof LeaderLines, v: string) => {
    const next = { ...(owner[field] ?? {}) };
    if (v.trim()) next[k] = v;
    else delete next[k];
    if (Object.keys(next).length) owner[field] = next;
    else delete owner[field];
    onChange();
  };
  const legend = rival
    ? (promotion ? '전직 후 대사 - 상대일 때 (비우면 플레이어일 때 대사)' : '상황별 대사 - 상대 리더로 나왔을 때 (비우면 플레이어일 때 대사)')
    : (promotion ? '전직 후 대사 - 플레이어일 때 (쓴 칸만 바뀌고, 비우면 원래 리더 대사)' : '상황별 대사 - 플레이어일 때 (전투 중 말풍선·결과)');
  return (
    <fieldset className="subgroup">
      <legend>{legend}</legend>
      <div className="form-grid">
        {keys.map(([k, label]) => (
          <Field key={k} label={label}><TextInput value={owner[field]?.[k] ?? ''} onChange={(v) => set(k, v)} /></Field>
        ))}
      </div>
    </fieldset>
  );
}

// 몬스터 대사: 상세 보기·처음 구매·최고 레벨
function MonsterLinesFields({ m, onChange }: { m: MonsterDef; onChange: () => void }) {
  const set = (k: keyof MonsterLines, v: string) => {
    const next = { ...(m.lines ?? {}) };
    if (v.trim()) next[k] = v;
    else delete next[k];
    if (Object.keys(next).length) m.lines = next;
    else delete m.lines;
    onChange();
  };
  return (
    <fieldset className="subgroup">
      <legend>대사 (상세 보기에 표시, 처음 구매·Lv3 달성 때 상점에 말풍선)</legend>
      <div className="form-grid">
        {MONSTER_LINE_KEYS.map(([k, label]) => (
          <Field key={k} label={label} wide={k === 'detail'}><TextInput value={m.lines?.[k] ?? ''} onChange={(v) => set(k, v)} /></Field>
        ))}
      </div>
    </fieldset>
  );
}

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
            <Check label="상점에 나옴" value={m.shop !== false} onChange={(v) => { if (v) delete m.shop; else m.shop = false; onChange(); }} />
            <Field label="통솔력" hint="보드에 있는 동안 배치 인원 +N. 1이면 자기 자리를 스스로 채운다 (지휘자)">
              <NumInput value={m.deploy ?? 0} min={0} width={60} onChange={(v) => { if (v) m.deploy = v; else delete m.deploy; onChange(); }} />
            </Field>
            <UnitStatFields u={m} onChange={onChange} />
            <TagsField tags={m.tags} all={draft.tags} onChange={onChange} />
            <div className="field-wide">
              <h4>일러스트</h4>
              <ArtSlots
                kind="monsters"
                id={m.id}
                maxLevel={BALANCE.unit.maxLevel}
                formGrowths={[...(m.growth ?? []), ...(m.promotions ?? []), ...draft.unitGrowth].filter((g) => g.form)}
                legacyArt={m.art}
                onClearLegacy={() => { delete m.art; onChange(); }}
              />
            </div>
            <DescField value={m.desc} auto={describeTriggers(m.triggers, m.extra)} onChange={(v) => { m.desc = v; onChange(); }} />
            <div className="field-wide"><MonsterLinesFields m={m} onChange={onChange} /></div>
            <div className="field-wide">
              <h4>기본 능력 (트리거 → 효과)</h4>
              <TriggerEditor triggers={m.triggers} tags={draft.tags} onChange={onChange} numbered />
            </div>
            <div className="field-wide">
              <h4>
                전용 성장 선택지 ({m.growth?.length ?? 0})
                <span className="muted small"> Lv2가 될 때 공용 성장 {draft.unitGrowth.length}개와 섞어 {BALANCE.unit.growthChoices}개를 제시. Lv3은 합성한 Lv2 3장의 성장을 모두 가짐</span>
              </h4>
              <GrowthList list={(m.growth ??= [])} tags={draft.tags} baseTriggers={m.triggers} idsInUse={m.promotions} onChange={onChange} />
            </div>
            <div className="field-wide">
              <h4>
                전직 ({m.promotions?.length ?? 0})
                <span className="muted small"> Lv{BALANCE.unit.maxLevel}이 되면 반드시 전직. 하나면 바로, 여럿이면 고름. 이름이 전직 이름으로 바뀌고 성장처럼 더해짐 (가진 성장은 유지). 일러스트: art/monsters/{m.id}.lv{BALANCE.unit.maxLevel}.전직id.png</span>
              </h4>
              {m.promotions?.length
                ? <GrowthList list={m.promotions} tags={draft.tags} baseTriggers={m.triggers} monsterPromotion idsInUse={m.growth} onChange={() => { if (m.promotions?.length === 0) delete m.promotions; onChange(); }} />
                : <button className="btn small" onClick={() => { m.promotions = [{ id: uniqueId('promotion', [...(m.growth ?? [])]), name: '새 전직', desc: '', repeatable: false, form: true }]; onChange(); }}>+ 전직 추가</button>}
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
  ['haste', '가속 +', '행동 간격 = 기본 × 100 / (100 + 가속). +100이면 2배 빠름, 음수 = 감속'],
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
// promotion: 리더 전직 목록의 항목 (종류 = 변신 / 본질 강화, 등장 레벨은 전직 레벨로 정해짐)
// common: 공용 몬스터 성장 (등장 조건 = 등급 구간·태그. 몬스터는 정해진 레벨에서만 고르므로 레벨 구간 대신)
function GrowthEditor({ g, tags, baseTriggers, leader, promotion, common, monsterPromotion, onChange, onDelete }: {
  g: GrowthDef;
  tags: string[];
  baseTriggers?: Trigger[];
  leader?: boolean;
  promotion?: boolean;
  common?: boolean;
  monsterPromotion?: boolean; // 몬스터 전직 (반복·등장 레벨 없음, 전직 대사)
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
        {g.transform && <span className="pill small-pill transform-pill">변신</span>}
        {g.mastery && <span className="pill small-pill mastery-pill">본질 강화</span>}
        {(g.minLevel !== undefined || g.maxLevel !== undefined) && <span className="pill small-pill">Lv{g.minLevel ?? 1}~{g.maxLevel ?? ''}</span>}
        {(g.minGrade !== undefined || g.maxGrade !== undefined) && <span className="pill small-pill">{GRADE_NAMES[g.minGrade ?? 1]}~{GRADE_NAMES[g.maxGrade ?? MAX_GRADE]}</span>}
        {!!g.forTags?.length && <span className="pill small-pill">{g.tagMode === 'except' ? '제외: ' : ''}{g.forTags.join('·')}</span>}
      </summary>
      <div className="form-grid">
        <Field label="id"><TextInput mono value={g.id} onChange={(v) => { g.id = v; onChange(); }} /></Field>
        <Field label="이름"><TextInput value={g.name} onChange={(v) => { g.name = v; onChange(); }} /></Field>
        <Field label="설명" hint="비우면 아래 내용으로 자동 설명" wide><TextInput value={g.desc} placeholder={auto} onChange={(v) => { g.desc = v; onChange(); }} /></Field>
        {!monsterPromotion && <Check label="반복 선택 가능" value={g.repeatable} onChange={(v) => { g.repeatable = v; onChange(); }} />}
        {monsterPromotion && (
          <Field label="전직 대사" hint="전직할 때 작은 알림과 전직 선택지에 나오는 한 줄 (비우면 몬스터의 최고 레벨 대사)" wide>
            <TextInput value={g.quote ?? ''} onChange={(v) => { if (v) g.quote = v; else delete g.quote; onChange(); }} />
          </Field>
        )}
        <Check
          label="외형 변화 (일러스트가 바뀜)"
          value={!!g.form}
          onChange={(v) => { if (v) g.form = true; else delete g.form; onChange(); }}
        />
        {promotion && (
          <>
            <Field label="전직 후 기본 대사" hint="소개 화면 등에 나오는 한 줄. 비우면 원래 리더 대사" wide>
              <TextInput value={g.quote ?? ''} onChange={(v) => { if (v) g.quote = v; else delete g.quote; onChange(); }} />
            </Field>
            <Field label="전직 이야기" hint="Lv3 전직 선택 화면에서 이 길을 펼치면 나오는 서사. 빈 줄로 문단 구분" wide>
              <TextArea rows={4} value={g.lore ?? ''} onChange={(v) => { if (v.trim()) g.lore = v; else delete g.lore; onChange(); }} />
            </Field>
            <div className="field-wide"><LinesFields owner={g} promotion onChange={onChange} /></div>
            <div className="field-wide"><LinesFields owner={g} promotion rival onChange={onChange} /></div>
          </>
        )}
        {promotion && (
          <Field label="전직 종류" hint="변신 = 태그·콘셉트가 바뀜 (무작위 순서) / 본질 강화 = 태그 유지, 원래 콘셉트 강화 (맨 앞 고정 자리)">
            <Select
              value={g.mastery ? 'mastery' : 'transform'}
              options={[['transform', '변신'], ['mastery', '본질 강화 (고정 자리)']]}
              onChange={(v) => {
                if (v === 'mastery') { g.mastery = true; delete g.transform; } else { g.transform = true; delete g.mastery; }
                onChange();
              }}
            />
          </Field>
        )}
        {common && (
          <>
            <Field label="등장 등급 구간" hint="이 등급의 몬스터에게만 선택지로 나옴 (비우면 제한 없음)">
              <span className="inline">
                <Select value={g.minGrade ?? 0} options={GRADE_RANGE_OPTS} onChange={(v) => { if (v) g.minGrade = v; else delete g.minGrade; onChange(); }} />
                ~
                <Select value={g.maxGrade ?? 0} options={GRADE_RANGE_OPTS} onChange={(v) => { if (v) g.maxGrade = v; else delete g.maxGrade; onChange(); }} />
              </span>
            </Field>
            <Field label="태그 조건" hint="체크한 태그가 없으면 모든 몬스터. 지금 태그(성장으로 바뀐 태그 포함) 기준" wide>
              <div className="inline wrap">
                <Select
                  value={g.tagMode ?? 'only'}
                  options={[['only', '체크한 태그 중 하나라도 있는 몬스터에게만'], ['except', '체크한 태그가 하나라도 있으면 나오지 않음']]}
                  onChange={(v) => { if (v === 'except') g.tagMode = 'except'; else delete g.tagMode; onChange(); }}
                />
                <div className="tag-checks">
                  {tags.map((t) => (
                    <Check key={t} label={t} value={!!g.forTags?.includes(t)} onChange={(on) => {
                      const next = on ? [...(g.forTags ?? []), t] : (g.forTags ?? []).filter((x) => x !== t);
                      if (next.length) g.forTags = next;
                      else { delete g.forTags; delete g.tagMode; }
                      onChange();
                    }} />
                  ))}
                </div>
              </div>
            </Field>
          </>
        )}
        {!promotion && !common && !monsterPromotion && (
          <Field label="등장 레벨 구간" hint={leader ? '이 리더 레벨에 도달할 때만 선택지에 나옴 (비우면 제한 없음)' : '이 레벨로 성장을 고를 때만 선택지에 나옴 (비우면 제한 없음, 성장을 고르는 레벨은 수치 탭)'}>
            <span className="inline">
              Lv<OptNumInput value={g.minLevel} min={1} onChange={(v) => { if (v) g.minLevel = v; else delete g.minLevel; onChange(); }} />
              ~ Lv<OptNumInput value={g.maxLevel} min={1} onChange={(v) => { if (v) g.maxLevel = v; else delete g.maxLevel; onChange(); }} />
            </span>
          </Field>
        )}
        {leader && !promotion && (
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

// idsInUse: id 중복을 피할 다른 목록 (리더의 일반 성장 ↔ 전직은 같은 id를 쓰면 안 된다)
function GrowthList({ list, tags, baseTriggers, leader, promotion, common, monsterPromotion, idsInUse = [], onChange }: {
  list: GrowthDef[]; tags: string[]; baseTriggers?: Trigger[]; leader?: boolean; promotion?: boolean; common?: boolean; monsterPromotion?: boolean; idsInUse?: { id: string }[]; onChange: () => void;
}) {
  const add = () => {
    const id = uniqueId(promotion || monsterPromotion ? 'promotion' : 'growth', [...list, ...idsInUse]);
    list.push(promotion
      ? { id, name: '새 전직', desc: '', repeatable: false, transform: true, form: true }
      : monsterPromotion
        ? { id, name: '새 전직', desc: '', repeatable: false, form: true }
        : { id, name: '새 성장', desc: '', repeatable: false });
    onChange();
  };
  return (
    <>
      {list.map((g, i) => (
        <GrowthEditor key={i} g={g} tags={tags} baseTriggers={baseTriggers} leader={leader} promotion={promotion} common={common} monsterPromotion={monsterPromotion} onChange={onChange} onDelete={() => { list.splice(i, 1); onChange(); }} />
      ))}
      <button className="btn small" onClick={add}>{promotion || monsterPromotion ? '+ 전직 추가' : '+ 성장 추가'}</button>
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
        능력치만 바꾸는 공용 성장은 그 능력치가 없는 몬스터에게는 나오지 않습니다 (공격력 0이면 공격력 성장, 주문력 0이면 주문력 성장 제외).
        성장마다 "등장 등급 구간"과 "태그 조건"으로 어떤 몬스터에게 나올지 정할 수 있습니다 (태그별 전용 성장, 특정 태그는 못 받는 성장).
      </p>
      <div className="card-row wrap growth-cards">
        {draft.unitGrowth.map((g, i) => <Card key={i} data={growthCard(g)} size="sm" />)}
      </div>
      <GrowthList list={draft.unitGrowth} tags={draft.tags} common onChange={onChange} />
    </section>
  );
}

// 리더 이벤트 성장: 지도의 이벤트 노드(?)에서 얻는 성장. 모든 리더 공용, 레벨업 성장 선택지에는 나오지 않는다
export function EventGrowthEditor({ draft, onChange }: EditorProps) {
  const list = draft.eventGrowth ?? (draft.eventGrowth = []);
  return (
    <section className="panel">
      <h3>리더 이벤트 성장 ({list.length})</h3>
      <p className="muted">
        "이벤트" 탭의 선택지 결과 "리더 이벤트 성장"으로 이 목록에서 얻습니다 (지정하거나, 아직 없는 것 중 무작위. 모든 리더 공용, 반복 불가 성장은 이미 가졌으면 제외).
        레벨업 때의 성장 선택지에는 나오지 않습니다. 리더마다 기본 능력이 달라서 "기본 능력 제거"는 쓰지 않는 것이 좋습니다.
      </p>
      <div className="card-row wrap growth-cards">
        {list.map((g, i) => <Card key={i} data={growthCard(g)} size="sm" />)}
      </div>
      <GrowthList list={list} tags={draft.tags} leader onChange={onChange} />
    </section>
  );
}

// ── 리더 ──

export function LeaderEditor({ draft, onChange }: EditorProps) {
  const list = draft.leaders;
  const [sel, setSel] = useSelection(list.length);
  const l = list[sel] as LeaderDef | undefined;
  const [intro, setIntro] = useState(false); // 리더 소개 화면 미리보기
  const [promo, setPromo] = useState(false); // 전직 선택 화면 미리보기
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
          <Field label="칭호" hint="리더 소개 화면의 한 줄 소개"><TextInput value={l.title ?? ''} placeholder="예: 앞에 서는 검" onChange={(v) => { if (v) l.title = v; else delete l.title; onChange(); }} /></Field>
          <Field label="대사" hint="소개 화면에 나오는 한 줄" wide><TextInput value={l.quote ?? ''} onChange={(v) => { if (v) l.quote = v; else delete l.quote; onChange(); }} /></Field>
          <div className="field-wide"><LinesFields owner={l} onChange={onChange} /></div>
          <div className="field-wide"><LinesFields owner={l} rival onChange={onChange} /></div>
          <Field label="소개·서사" hint="리더 소개 화면에 나오는 글. 빈 줄로 문단을 나눕니다" wide>
            <TextArea rows={5} value={l.lore ?? ''} onChange={(v) => { if (v.trim()) l.lore = v; else delete l.lore; onChange(); }} />
            <div className="inline"><button className="btn small" onClick={() => setIntro(true)}>소개 화면 미리보기</button>{' '}
              <button className="btn small" disabled={!(l.promotions ?? []).length} onClick={() => setPromo(true)}>전직 선택 화면 미리보기</button></div>
          </Field>
          {promo && <PromotionPreview leader={l} onClose={() => setPromo(false)} />}
          {intro && <LeaderIntro leaders={list} index={sel} origin={null} profile={loadProfile()} onIndex={setSel} onClose={() => setIntro(false)} />}
          <UnitStatFields u={l} onChange={onChange} />
          <TagsField tags={l.tags} all={draft.tags} onChange={onChange} />
          <div className="field-wide">
            <h4>일러스트</h4>
            <ArtSlots
              kind="leaders"
              id={l.id}
              maxLevel={1 + BALANCE.leader.levelUpDays.length}
              formGrowths={[...l.growth, ...(l.promotions ?? [])].filter((g) => g.form)}
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
            <h4>성장 선택지 ({l.growth.length}) <span className="muted small">레벨업 때 등장 레벨 구간에 맞는 것 중 {BALANCE.leader.growthChoices}개를 무작위로 제시</span></h4>
            <GrowthList list={l.growth} tags={draft.tags} baseTriggers={l.triggers} leader idsInUse={l.promotions} onChange={onChange} />
          </div>
          <div className="field-wide">
            <h4>
              전직 ({(l.promotions ?? []).length}){' '}
              <span className="muted small">
                리더 Lv{BALANCE.leader.promotionLevels.join('·')}에 일반 성장 대신 이 목록만 제시. 본질 강화는 맨 앞 고정 자리, 변신은 뒤에. 리더당 하나만 고르고, 고르면 리더 이름이 전직 이름으로 바뀜
              </span>
            </h4>
            <GrowthList list={(l.promotions ??= [])} tags={draft.tags} baseTriggers={l.triggers} leader promotion idsInUse={l.growth} onChange={onChange} />
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
            {t.grade === ORIGIN_GRADE ? '기원 등급: 상점에 나오지 않음 (보스 보상)' : `상점 가격 ${BALANCE.economy.trinketCost[t.grade - 1]}G`}
          </p>
        </>
      )}
    >
      {t && (
        <>
          <Field label="id"><TextInput mono value={t.id} onChange={(v) => { t.id = v; onChange(); }} /></Field>
          <Field label="이름"><TextInput value={t.name} onChange={(v) => { t.name = v; onChange(); }} /></Field>
          <Field label="등급"><Select value={t.grade} options={GRADE_OPTS} onChange={(v) => { t.grade = v; onChange(); }} /></Field>
          <Check label="상점·보상에 나옴" value={t.shop !== false} onChange={(v) => { if (v) delete t.shop; else t.shop = false; onChange(); }} />
          {passive('incomeBonus', '매일 수입 +', '보유 효과 (전투 밖)')}
          {passive('shopLevel', '상점 레벨 +', '확률표를 한 단계 앞당김')}
          <div className="field-wide">
            <h4>
              분류: <span className={`pill ${isOneShot(t) ? 'warn' : 'ok'}`}>{isOneShot(t) ? '일회성' : '지속'}</span>
              <span className="muted small"> 아래 일회성 효과 중 하나라도 켜면 일회성(쓰면 사라짐), 아니면 지속</span>
            </h4>
            {(['upgradeOnBoard', 'upgradeNextBuy', 'transmute'] as const).map((key) => (
              <Check
                key={key}
                label={key === 'upgradeOnBoard'
                  ? `일회성: 보드·벤치의 ${GRADE_NAMES[t.grade]} 이하 Lv1 유닛 하나를 무작위로 Lv2로 (대상이 생길 때까지 보관)`
                  : key === 'upgradeNextBuy'
                    ? `일회성: 다음에 구매하는 ${GRADE_NAMES[t.grade]} 이하 몬스터를 Lv2로`
                    : '일회성: 변이 - 보드의 몬스터 하나를 한 단계 높은 등급의 무작위 몬스터로 (레벨·성장·영구 강화 유지)'}
                value={!!t.passive?.[key]}
                onChange={(on) => {
                  t.passive ??= {};
                  if (on) t.passive[key] = true;
                  else delete t.passive[key];
                  if (Object.keys(t.passive).length === 0) delete t.passive;
                  onChange();
                }}
              />
            ))}
            <Check
              label="일회성: 일괄 변이 - 보드의 몬스터 전부를 한 단계 높은 등급의 무작위 몬스터로 (황금 지휘봉)"
              value={!!t.passive?.transmuteAll}
              onChange={(on) => {
                t.passive ??= {};
                if (on) t.passive.transmuteAll = true;
                else { delete t.passive.transmuteAll; delete t.passive.transmuteExcept; }
                if (Object.keys(t.passive).length === 0) delete t.passive;
                onChange();
              }}
            />
            {t.passive?.transmuteAll && (
              <Field label="일괄 변이에서 뺄 몬스터 id" hint="쉼표로 구분 (예: conductor)">
                <TextInput mono value={(t.passive.transmuteExcept ?? []).join(', ')} onChange={(v) => {
                  const ids = v.split(',').map((x) => x.trim()).filter(Boolean);
                  if (ids.length) t.passive!.transmuteExcept = ids;
                  else delete t.passive!.transmuteExcept;
                  onChange();
                }} />
              </Field>
            )}
            {t.passive?.transmute && (
              <Field label="변이 대상 등급 상한" hint="이 등급 이하 몬스터만 변이 (제한 없음 = 몬스터가 있는 최고 등급 아래 전부)">
                <Select
                  value={t.passive.transmuteMaxGrade ?? 0}
                  options={GRADE_RANGE_OPTS}
                  onChange={(v) => { if (v) t.passive!.transmuteMaxGrade = v; else delete t.passive!.transmuteMaxGrade; onChange(); }}
                />
              </Field>
            )}
            <span className="field-hint">Lv2 효과의 대상 등급 = 이 장신구의 등급 이하. 쓰면 장신구가 사라지고, Lv2가 되면 성장 선택이 뜹니다.</span>
          </div>
          <div className="field-wide">
            <h4>일러스트</h4>
            <ArtSlots kind="trinkets" id={t.id} maxLevel={1} formGrowths={[]} legacyArt={t.art} onClearLegacy={() => { delete t.art; onChange(); }} />
          </div>
          <DescField value={t.desc} auto={describeTriggers(t.triggers, undefined, true)} onChange={(v) => { t.desc = v; onChange(); }} />
          <div className="field-wide">
            <h4>전투 효과 (시스템 효과로 처리 — 유닛보다 먼저, 추가발동·기절 영향 없음)</h4>
            <TriggerEditor triggers={t.triggers} tags={draft.tags} onChange={onChange} center />
          </div>
          <div className="field-wide"><JsonBox key={`${sel}-${t.id}`} obj={t} onChange={onChange} /></div>
        </>
      )}
    </EntityLayout>
  );
}
