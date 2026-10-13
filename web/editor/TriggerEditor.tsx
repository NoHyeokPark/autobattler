// 트리거(시점) → 효과 목록 편집기. 시너지 3종(태그·위치·트리거)이 모두 이 구조로 표현된다.

import { BALANCE } from '../../src/config/balance.ts';
import { DIR_NAMES, describeEffect, describeTrigger, filterText } from '../../src/data/describe.ts';
import { T } from '../../src/data/targets.ts';
import { DIRS } from '../../src/data/types.ts';
import type { Dir, Effect, PermanentStat, StatusId, Trigger, UnitFilter } from '../../src/data/types.ts';
import { Check, Field, LNumInput, NumInput, Select } from './fields.tsx';

type EffectType = Effect['type'];

export const EFFECT_LABELS: [EffectType, string][] = [
  ['damage', '피해'],
  ['heal', '회복'],
  ['shield', '실드'],
  ['status', '팀 상태 부여 (독·재생·강화)'],
  ['atkFlat', '공격력 +x (합산)'],
  ['atkPct', '공격력 x%'],
  ['powerFlat', '주문력 +x (합산)'],
  ['powerPct', '주문력 x%'],
  ['intervalPct', '행동 간격 x%'],
  ['extra', '추가발동 +x'],
  ['stun', '기절'],
  ['maxHpPct', '아군 최대 체력 x%'],
  ['permanent', '영구 강화 (전투 후에도 유지)'],
  ['gold', '골드 획득 (전투 후)'],
  ['trinket', '장신구 획득 (전투 후)'],
];

const PERMANENT_LABELS: [PermanentStat, string][] = [
  ['atk', '공격력 +'],
  ['hp', '체력 +'],
  ['power', '주문력 +'],
  ['intervalPct', '행동 간격 % (음수 = 빨라짐)'],
  ['extra', '추가발동 +'],
];

const DEFAULT_EFFECT: Record<EffectType, Effect> = {
  damage: { type: 'damage', atkPct: 100 },
  heal: { type: 'heal', atkPct: 100 },
  shield: { type: 'shield', atkPct: 100 },
  status: { type: 'status', status: 'poison', powerPct: 10, to: 'enemy' },
  atkFlat: { type: 'atkFlat', target: T.adjacent(), amount: 1 },
  atkPct: { type: 'atkPct', target: T.allies(), pct: 20 },
  powerFlat: { type: 'powerFlat', target: T.adjacent(), amount: 5 },
  powerPct: { type: 'powerPct', target: T.allies(), pct: 20 },
  intervalPct: { type: 'intervalPct', target: T.adjacent(), pct: -10 },
  extra: { type: 'extra', target: T.self(), amount: 1 },
  stun: { type: 'stun', target: T.mirror(), ticks: 20 },
  maxHpPct: { type: 'maxHpPct', pct: 10 },
  permanent: { type: 'permanent', target: T.self(), stat: 'atk', amount: 1 },
  gold: { type: 'gold', amount: 1 },
  trinket: { type: 'trinket', grade: 1, count: 1 },
};

const AREAS: [UnitFilter['area'], string][] = [
  ['all', '진영 전체'],
  ['near', '칸 지정 (방향)'],
  ['sameRow', '기준 칸과 같은 행'],
  ['sameCol', '기준 칸과 같은 열'],
];

const ON_LABELS: [Trigger['on'], string][] = [
  ['battleStart', '전투 시작 시'],
  ['act', '행동할 때마다'],
  ['timer', '전투 시작 후 N초 (1회)'],
];

// 3x3 방향 선택: 가운데가 기준 칸 (아군 = 자신, 상대 = 같은 번호의 칸)
function DirGrid({ f, onChange }: { f: UnitFilter; onChange: () => void }) {
  const dirs = f.dirs ?? [];
  const toggle = (d: Dir) => {
    f.dirs = dirs.includes(d) ? dirs.filter((x) => x !== d) : [...dirs, d];
    onChange();
  };
  const preset = (list: Dir[]) => {
    f.dirs = list;
    onChange();
  };
  return (
    <div className="dir-picker">
      <div className="dir-grid">
        {DIRS.map((d) => (
          <button key={d} type="button" className={`dir ${dirs.includes(d) ? 'on' : ''} ${d === 'c' ? 'center' : ''}`} title={DIR_NAMES[d]} onClick={() => toggle(d)}>
            {d === 'c' ? (f.side === 'ally' ? '자신' : '같은칸') : ''}
          </button>
        ))}
      </div>
      <div className="dir-presets">
        <button type="button" className="btn tiny" onClick={() => preset(['c'])}>{f.side === 'ally' ? '자신' : '같은 칸'}</button>
        <button type="button" className="btn tiny" onClick={() => preset(['u', 'd', 'l', 'r'])}>상하좌우</button>
        <button type="button" className="btn tiny" onClick={() => preset(['ul', 'u', 'ur', 'l', 'r', 'dl', 'd', 'dr'])}>주변 8칸</button>
        <button type="button" className="btn tiny" onClick={() => preset(['ul', 'ur', 'dl', 'dr'])}>대각선</button>
      </div>
    </div>
  );
}

function FilterEditor({ f, tags, onChange }: { f: UnitFilter; tags: string[]; onChange: () => void }) {
  const set = <K extends keyof UnitFilter>(k: K, v: UnitFilter[K]) => {
    if (v === undefined || v === false || v === '') delete f[k];
    else f[k] = v;
    onChange();
  };
  return (
    <div className="filter-editor">
      <div className="filter-row">
        <Field label="대상 진영">
          <Select value={f.side} options={[['ally', '아군'], ['enemy', '상대']]} onChange={(v) => set('side', v)} />
        </Field>
        <Field label="범위" hint={f.side === 'enemy' ? '기준 칸 = 자신과 같은 번호의 상대 칸 (대칭 위치)' : '기준 칸 = 자신의 칸'}>
          <Select value={f.area} options={AREAS} onChange={(v) => {
            f.area = v;
            if (v === 'near') f.dirs = f.dirs?.length ? f.dirs : f.side === 'ally' ? ['u', 'd', 'l', 'r'] : ['c'];
            else delete f.dirs;
            onChange();
          }} />
        </Field>
        {f.area === 'near' && <DirGrid f={f} onChange={onChange} />}
      </div>
      <div className="filter-row">
        <Field label="태그 조건">
          <Select value={f.tag ?? ''} options={[['', '없음'], ...tags.map((t): [string, string] => [t, t])]} onChange={(v) => set('tag', v || undefined)} />
        </Field>
        <Field label="행 조건">
          <Select value={f.row ?? 0} options={[[0, '전체'], [1, '1행'], [2, '2행'], [3, '3행']]} onChange={(v) => set('row', v || undefined)} />
        </Field>
        <Field label="열 조건">
          <Select value={f.col ?? 0} options={[[0, '전체'], [1, '1열'], [2, '2열'], [3, '3열']]} onChange={(v) => set('col', v || undefined)} />
        </Field>
        {f.side === 'ally' && <Check label="자신 제외" value={!!f.excludeSelf} onChange={(v) => set('excludeSelf', v)} />}
      </div>
      <div className="filter-summary">대상: {filterText(f)}</div>
    </div>
  );
}

function EffectEditor({ e, tags, onChange }: { e: Effect; tags: string[]; onChange: () => void }) {
  const lnum = (label: string, key: string, optional = true, hint?: string) => (
    <Field label={label} hint={hint}>
      <LNumInput
        optional={optional}
        value={(e as unknown as Record<string, number | number[] | undefined>)[key]}
        onChange={(v) => {
          const rec = e as unknown as Record<string, unknown>;
          if (v === undefined) delete rec[key];
          else rec[key] = v;
          onChange();
        }}
      />
    </Field>
  );
  switch (e.type) {
    case 'damage':
    case 'heal':
      return <div className="effect-fields">{lnum('공격력 %', 'atkPct')}{lnum('주문력 %', 'powerPct')}{lnum('고정값', 'flat')}</div>;
    case 'shield':
      return <div className="effect-fields">{lnum('공격력 %', 'atkPct')}{lnum('주문력 %', 'powerPct')}{lnum('유닛 체력 %', 'hpPct')}{lnum('고정값', 'flat')}</div>;
    case 'status':
      return (
        <div className="effect-fields">
          <Field label="상태">
            <Select<StatusId>
              value={e.status}
              options={(Object.keys(BALANCE.statuses) as StatusId[]).map((k) => [k, BALANCE.statuses[k].name])}
              onChange={(v) => { e.status = v; onChange(); }}
            />
          </Field>
          <Field label="받는 쪽">
            <Select value={e.to} options={[['enemy', '상대'], ['ally', '아군']]} onChange={(v) => { e.to = v; onChange(); }} />
          </Field>
          {lnum('주문력 %', 'powerPct', true, '중첩 = 주문력 x% (반올림)')}
          {lnum('고정값', 'flat', true, '장신구처럼 주문력이 없는 효과용')}
        </div>
      );
    case 'atkFlat':
    case 'powerFlat':
    case 'extra':
      return <div className="effect-fields">{lnum('수치', 'amount', false, '음수면 감소')}<FilterEditor f={e.target} tags={tags} onChange={onChange} /></div>;
    case 'atkPct':
    case 'powerPct':
    case 'intervalPct':
      return <div className="effect-fields">{lnum('%', 'pct', false, e.type === 'intervalPct' ? '음수면 빨라짐' : '음수면 감소 (디버프)')}<FilterEditor f={e.target} tags={tags} onChange={onChange} /></div>;
    case 'stun':
      return <div className="effect-fields">{lnum('기절 tick', 'ticks', false, `${BALANCE.ticksPerSec} tick = 1초`)}<FilterEditor f={e.target} tags={tags} onChange={onChange} /></div>;
    case 'maxHpPct':
      return <div className="effect-fields">{lnum('%', 'pct', false)}</div>;
    case 'permanent':
      return (
        <div className="effect-fields">
          <Field label="능력치">
            <Select<PermanentStat> value={e.stat} options={PERMANENT_LABELS} onChange={(v) => { e.stat = v; onChange(); }} />
          </Field>
          {lnum('수치', 'amount', false, '이번 전투에 바로 적용 + 유닛에 남음. 같은 유닛에는 쌓이고, 합성 때는 계열별 최고값')}
          <FilterEditor f={e.target} tags={tags} onChange={onChange} />
        </div>
      );
    case 'gold':
      return <div className="effect-fields">{lnum('골드', 'amount', false, `전투당 최대 ${BALANCE.battleGains.maxGoldPerBattle} (수치 탭에서 조절)`)}</div>;
    case 'trinket':
      return (
        <div className="effect-fields">
          {lnum('등급', 'grade', false, '1 일반 ~ 5 신화, 6 기원. 2/2/3처럼 레벨별 지정 가능')}
          {lnum('개수', 'count', true, `전투당 최대 ${BALANCE.battleGains.maxTrinketsPerBattle}개`)}
        </div>
      );
  }
}

function move<T>(arr: T[], i: number, d: number) {
  const j = i + d;
  if (j < 0 || j >= arr.length) return;
  [arr[i], arr[j]] = [arr[j], arr[i]];
}

export function TriggerEditor({ triggers, tags, onChange, numbered }: { triggers: Trigger[]; tags: string[]; onChange: () => void; numbered?: boolean }) {
  return (
    <div className="trigger-list">
      {triggers.map((t, ti) => (
        <div key={ti} className="trigger">
          <div className="trigger-head">
            {numbered && <span className="trigger-no" title="성장의 '능력 제거'에서 이 번호를 씁니다">능력 {ti + 1}</span>}
            <Select value={t.on} options={ON_LABELS} onChange={(v) => {
              t.on = v;
              if (v === 'timer') t.atSec ??= 10;
              else delete t.atSec;
              onChange();
            }} />
            {t.on === 'timer' && (
              <span className="inline">
                <NumInput value={t.atSec ?? 0} min={0} width={60} onChange={(v) => { t.atSec = v; onChange(); }} />초
              </span>
            )}
            <span className="trigger-summary">{describeTrigger(t)}</span>
            <div className="spacer" />
            <button className="btn tiny" onClick={() => { move(triggers, ti, -1); onChange(); }}>위</button>
            <button className="btn tiny" onClick={() => { move(triggers, ti, 1); onChange(); }}>아래</button>
            <button className="btn tiny danger" onClick={() => { triggers.splice(ti, 1); onChange(); }}>삭제</button>
          </div>
          {t.effects.map((e, ei) => (
            <div key={ei} className="effect">
              <div className="effect-head">
                <Select<EffectType> value={e.type} options={EFFECT_LABELS} onChange={(v) => { t.effects[ei] = structuredClone(DEFAULT_EFFECT[v]); onChange(); }} />
                <span className="muted small">{describeEffect(e)}</span>
                <div className="spacer" />
                <button className="btn tiny" onClick={() => { move(t.effects, ei, -1); onChange(); }}>위</button>
                <button className="btn tiny" onClick={() => { move(t.effects, ei, 1); onChange(); }}>아래</button>
                <button className="btn tiny danger" onClick={() => { t.effects.splice(ei, 1); onChange(); }}>삭제</button>
              </div>
              <EffectEditor e={e} tags={tags} onChange={onChange} />
            </div>
          ))}
          <button className="btn tiny" onClick={() => { t.effects.push(structuredClone(DEFAULT_EFFECT.damage)); onChange(); }}>+ 효과 추가</button>
        </div>
      ))}
      <button className="btn small" onClick={() => { triggers.push({ on: 'act', effects: [structuredClone(DEFAULT_EFFECT.damage)] }); onChange(); }}>
        + 트리거 추가
      </button>
    </div>
  );
}
