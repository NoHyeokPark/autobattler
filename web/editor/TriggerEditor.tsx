// 트리거(시점) → 효과 목록 편집기. 시너지 3종(태그·위치·트리거)이 모두 이 구조로 표현된다.

import { createContext, useContext } from 'react';
import { BALANCE } from '../../src/config/balance.ts';
import { DIR_NAMES, describeEffect, describeStatus, describeTrigger, filterText, lnumText, scaleLabel } from '../../src/data/describe.ts';
import { T } from '../../src/data/targets.ts';
import { TRINKETS } from '../../src/data/trinkets.ts';
import { DIRS, GRADE_NAMES, STATUS_IDS } from '../../src/data/types.ts';
import type { Dir, Effect, PermanentStat, Scale, ScaleSource, StatusId, Trigger, UnitFilter, UnitKind } from '../../src/data/types.ts';
import { Check, Field, LNumInput, NumInput, Select, TextInput, OptNumInput } from './fields.tsx';

type EffectType = Effect['type'];

export const EFFECT_LABELS: [EffectType, string][] = [
  ['damage', '피해'],
  ['heal', '회복'],
  ['shield', '실드'],
  ['status', '팀 상태 부여 (독·화상·재생·강화·가시)'],
  ['atkFlat', '공격력 +x (합산)'],
  ['atkPct', '공격력 x%'],
  ['powerFlat', '주문력 +x (합산)'],
  ['powerPct', '주문력 x%'],
  ['haste', '가속 +x (합산)'],
  ['extra', '추가발동 +x'],
  ['stun', '기절'],
  ['maxHpPct', '아군 최대 체력 x%'],
  ['cleanse', '정화 (아군의 해로운 상태 제거)'],
  ['dispel', '해주 (상대의 이로운 상태 제거)'],
  ['consume', '상태 소모 (희망 등을 써서 효과 발동)'],
  ['permanent', '영구 강화 (전투 후에도 유지)'],
  ['gold', '골드 획득 (전투 후)'],
  ['trinket', '장신구 획득 (전투 후)'],
  ['mimic', '따라 하기 (반응 트리거: 그 유닛의 행동을 따라 함)'],
  ['conduct', '지휘 (대상 유닛을 바로 행동시키고 수만큼 보상)'],
  ['hpCost', '체력 소모 (자해: 아군 체력을 써서 효과 발동)'],
];

const PERMANENT_LABELS: [PermanentStat, string][] = [
  ['atk', '공격력 +'],
  ['hp', '체력 +'],
  ['power', '주문력 +'],
  ['haste', '가속 (합산, 음수 = 감속)'],
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
  haste: { type: 'haste', target: T.adjacent(), amount: 15 },
  extra: { type: 'extra', target: T.self(), amount: 1 },
  stun: { type: 'stun', target: T.mirror(), ticks: 20 },
  maxHpPct: { type: 'maxHpPct', pct: 10 },
  cleanse: { type: 'cleanse', pct: 25 },
  dispel: { type: 'dispel', pct: 25 },
  consume: { type: 'consume', status: 'hope', cost: 5, effects: [{ type: 'damage', atkPct: 100, scales: [{ src: 'consumed', pct: 300 }] }] },
  permanent: { type: 'permanent', target: T.self(), stat: 'atk', amount: 1 },
  gold: { type: 'gold', amount: 1 },
  trinket: { type: 'trinket', grade: 1, count: 1 },
  mimic: { type: 'mimic' },
  hpCost: { type: 'hpCost', pct: 10, effects: [{ type: 'damage', scales: [{ src: 'paidHp', pct: 200 }] }] },
  conduct: { type: 'conduct', target: { side: 'ally', area: 'near', dirs: ['u', 'd', 'l', 'r', 'ul', 'ur', 'dl', 'dr'] }, uniqueTag: true, goldPer: 1 },
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
  ['timer', '전투 시작 후 N초 (1회, 반복 가능)'],
  ['lowHp', '아군 체력 N% 이하가 될 때 (1회)'],
  ['enemyLowHp', '상대 체력 N% 이하가 될 때 (1회)'],
  ['react', '반응: 지정한 유닛이 행동할 때마다'],
];

// 기준 칸이 보드 중앙인 편집기인지 (장신구). 유닛이면 자신의 칸이 기준
const CenterAnchor = createContext(false);

// 3x3 방향 선택: 가운데가 기준 칸 (아군 = 자신, 상대 = 같은 번호의 칸. 장신구는 양쪽 모두 중앙 칸)
function DirGrid({ f, onChange }: { f: UnitFilter; onChange: () => void }) {
  const center = useContext(CenterAnchor);
  const mid = center ? '중앙' : f.side === 'ally' ? '자신' : '같은칸';
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
            {d === 'c' ? mid : ''}
          </button>
        ))}
      </div>
      <div className="dir-presets">
        <button type="button" className="btn tiny" onClick={() => preset(['c'])}>{center ? '중앙 칸' : f.side === 'ally' ? '자신' : '같은 칸'}</button>
        <button type="button" className="btn tiny" onClick={() => preset(['u', 'd', 'l', 'r'])}>상하좌우</button>
        <button type="button" className="btn tiny" onClick={() => preset(['ul', 'u', 'ur', 'l', 'r', 'dl', 'd', 'dr'])}>주변 8칸</button>
        <button type="button" className="btn tiny" onClick={() => preset(['ul', 'ur', 'dl', 'dr'])}>대각선</button>
      </div>
    </div>
  );
}

// noSelf: 반응 대상처럼 자신이 늘 빠지는 곳 (자신 제외 체크를 숨긴다)
function FilterEditor({ f, tags, onChange, noSelf }: { f: UnitFilter; tags: string[]; onChange: () => void; noSelf?: boolean }) {
  const center = useContext(CenterAnchor);
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
        <Field label="범위" hint={center ? '장신구의 기준 칸 = 보드 중앙 (2행 2열). 상대 대상이면 상대 보드의 중앙' : f.side === 'enemy' ? '기준 칸 = 자신과 같은 번호의 상대 칸 (대칭 위치)' : '기준 칸 = 자신의 칸'}>
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
        <Field label="유닛 종류">
          <Select value={f.kind ?? ''} options={[['', '전체'], ['leader', '리더만'], ['monster', '몬스터만']]} onChange={(v) => set('kind', (v || undefined) as UnitKind | undefined)} />
        </Field>
        {f.side === 'ally' && !center && !noSelf && <Check label="자신 제외" value={!!f.excludeSelf} onChange={(v) => set('excludeSelf', v)} />}
      </div>
      <div className="filter-summary">대상: {filterText(f, center)}</div>
    </div>
  );
}

// "내 X만큼" 비례 항 목록: 출처 + 비율 % (100% = 출처 1당 1)
const SCALABLE: Effect['type'][] = ['damage', 'heal', 'shield', 'status', 'atkFlat', 'powerFlat', 'haste', 'extra'];
const SOURCE_LABELS: [ScaleSource, string][] = [
  ['atk', '자신 공격력'], ['power', '자신 주문력'], ['hp', '자신 체력'], ['haste', '자신 가속'], ['extra', '자신 추가발동'],
  ['acts', '자신 행동 횟수 (이번 전투)'], ['gold', '내 골드'], ['allyStatus', '아군 팀 상태 중첩'], ['enemyStatus', '상대 팀 상태 중첩'],
  ['allyShield', '아군 실드'], ['allyMissingHp', '아군 잃은 체력'], ['enemyMissingHp', '상대 잃은 체력'],
  ['allyCount', '아군 유닛 수'], ['enemyCount', '상대 유닛 수'], ['consumed', '소모한 중첩 (상태 소모 안에서만)'], ['paidHp', '소모한 체력 (체력 소모 안에서만)'],
];

function ScalesEditor({ e, tags, onChange }: { e: Effect & { scales?: Scale[] }; tags: string[]; onChange: () => void }) {
  const list = e.scales ?? [];
  const set = (next: Scale[]) => {
    if (next.length) e.scales = next;
    else delete e.scales;
    onChange();
  };
  return (
    <div className="scales">
      <div className="scales-head">
        <strong>비례</strong> <span className="muted small">"내 X만큼": 출처 값 × % 를 더합니다 (100% = 1당 1). 예) 상대 독 중첩 × 200% = 독 1당 +2</span>
      </div>
      {list.map((sc, i) => (
        <div key={i} className="scale-row">
          <Select<ScaleSource> value={sc.src} options={SOURCE_LABELS} onChange={(v) => { sc.src = v; if (!v.endsWith('Status')) delete sc.status; else sc.status ??= 'poison'; if (!v.endsWith('Count')) { delete sc.tag; delete sc.kind; } onChange(); }} />
          {sc.src.endsWith('Status') && (
            <Select<StatusId> value={sc.status ?? 'poison'} options={STATUS_IDS.map((k) => [k, BALANCE.statuses[k]?.name ?? k])} onChange={(v) => { sc.status = v; onChange(); }} />
          )}
          {sc.src.endsWith('Count') && (
            <>
              <Select value={sc.tag ?? ''} options={[['', '모든 태그'], ...tags.map((t): [string, string] => [t, t])]} onChange={(v) => { if (v) sc.tag = v; else delete sc.tag; onChange(); }} />
              <Select value={sc.kind ?? ''} options={[['', '리더·몬스터'], ['leader', '리더만'], ['monster', '몬스터만']]} onChange={(v) => { if (v) sc.kind = v as UnitKind; else delete sc.kind; onChange(); }} />
            </>
          )}
          <span className="inline">× <LNumInput value={sc.pct} onChange={(v) => { sc.pct = v ?? 0; onChange(); }} />%</span>
          <span className="muted small">{scaleLabel(sc)} {lnumText(sc.pct)}%</span>
          <button className="btn tiny danger" onClick={() => set(list.filter((_, j) => j !== i))}>삭제</button>
        </div>
      ))}
      <button className="btn tiny" onClick={() => set([...list, { src: 'gold', pct: 100 }])}>+ 비례 추가</button>
    </div>
  );
}

function EffectEditor({ e, tags, onChange }: { e: Effect; tags: string[]; onChange: () => void }) {
  return (
    <>
      <EffectFields e={e} tags={tags} onChange={onChange} />
      {SCALABLE.includes(e.type) && <ScalesEditor e={e} tags={tags} onChange={onChange} />}
    </>
  );
}

function EffectFields({ e, tags, onChange }: { e: Effect; tags: string[]; onChange: () => void }) {
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
      return (
        <div className="effect-fields">
          {lnum('공격력 %', 'atkPct')}{lnum('주문력 %', 'powerPct')}{lnum('고정값', 'flat')}
          <Check label="관통 (실드 무시)" value={!!e.pierce} onChange={(v) => { if (v) e.pierce = true; else delete e.pierce; onChange(); }} />
        </div>
      );
    case 'heal':
      return <div className="effect-fields">{lnum('공격력 %', 'atkPct')}{lnum('주문력 %', 'powerPct')}{lnum('고정값', 'flat')}</div>;
    case 'shield':
      return <div className="effect-fields">{lnum('공격력 %', 'atkPct')}{lnum('주문력 %', 'powerPct')}{lnum('유닛 체력 %', 'hpPct')}{lnum('고정값', 'flat')}</div>;
    case 'status':
      return (
        <div className="effect-fields">
          <Field label="상태" hint={describeStatus(e.status)}>
            <Select<StatusId>
              value={e.status}
              options={STATUS_IDS.map((k) => [k, BALANCE.statuses[k]?.name ?? k])}
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
    case 'haste':
      return <div className="effect-fields">{lnum('가속', 'amount', false, '합산. 행동 간격 = 기본 × 100 / (100 + 가속). +100이면 2배 빠름, 음수 = 감속')}<FilterEditor f={e.target} tags={tags} onChange={onChange} /></div>;
    case 'atkFlat':
    case 'powerFlat':
    case 'extra':
      return <div className="effect-fields">{lnum('수치', 'amount', false, '음수면 감소')}<FilterEditor f={e.target} tags={tags} onChange={onChange} /></div>;
    case 'atkPct':
    case 'powerPct':
      return <div className="effect-fields">{lnum('%', 'pct', false, '음수면 감소 (디버프)')}<FilterEditor f={e.target} tags={tags} onChange={onChange} /></div>;
    case 'stun':
      return <div className="effect-fields">{lnum('기절 tick', 'ticks', false, `${BALANCE.ticksPerSec} tick = 1초`)}<FilterEditor f={e.target} tags={tags} onChange={onChange} /></div>;
    case 'maxHpPct':
      return <div className="effect-fields">{lnum('%', 'pct', false)}</div>;
    case 'consume':
      return (
        <div className="effect-fields consume">
          <Field label="소모할 상태" hint={describeStatus(e.status)}>
            <Select<StatusId> value={e.status} options={STATUS_IDS.map((k) => [k, BALANCE.statuses[k]?.name ?? k])} onChange={(v) => { e.status = v; onChange(); }} />
          </Field>
          <Field label="어느 팀의">
            <Select value={e.from ?? 'ally'} options={[['ally', '아군에게 쌓인 것'], ['enemy', '상대에게 걸린 것 (터뜨리기)']]} onChange={(v) => { if (v === 'enemy') e.from = v; else delete e.from; onChange(); }} />
          </Field>
          {lnum('소모량', 'cost', false, '이만큼 쌓여 있어야 발동. 모자라면 아무 일도 없음')}
          <Check label="이상이면 전부 소모" value={!!e.all} onChange={(v) => { if (v) e.all = true; else delete e.all; onChange(); }} />
          <Field label="필살기 대사" hint="소모에 성공했을 때 카드 위 말풍선 (비우면 없음)" wide>
            <TextInput value={e.say ?? ''} onChange={(v) => { if (v) e.say = v; else delete e.say; onChange(); }} />
          </Field>
          <div className="consume-inner field-wide">
            <div className="muted small">소모하면 발동할 효과 — 비례 출처 "소모한 중첩"으로 쓴 만큼 강하게 만들 수 있어요</div>
            <EffectList effects={e.effects} tags={tags} onChange={onChange} nested />
          </div>
        </div>
      );
    case 'cleanse':
    case 'dispel':
      return (
        <div className="effect-fields">
          {lnum('중첩 %', 'pct', true, '상태마다 중첩 × % 만큼 제거 (내림). 많이 쌓은 덱일수록 많이 깎임. 50% 이하 권장')}
          {lnum('고정값', 'flat', true, '상태마다 추가로 이만큼 제거')}
          <Field label="범위" hint="전부 = 해당 범주의 상태 모두 / 가장 큰 하나 = 가장 많이 쌓인 상태 하나만 (여러 상태를 섞은 덱에 덜 불리)">
            <Select value={e.scope ?? 'all'} options={[['all', '해당 상태 전부'], ['largest', '가장 많이 쌓인 하나']]} onChange={(v) => { if (v === 'largest') e.scope = v; else delete e.scope; onChange(); }} />
          </Field>
        </div>
      );
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
          {lnum('등급', 'grade', false, `${GRADE_NAMES.slice(1).map((n, i) => `${i + 1} ${n}`).join(', ')}. 2/2/3처럼 레벨별 지정 가능`)}
          {lnum('개수', 'count', true, `전투당 최대 ${BALANCE.battleGains.maxTrinketsPerBattle}개`)}
        </div>
      );
    case 'hpCost':
      return (
        <div className="effect-fields consume">
          {lnum('현재 체력 %', 'pct', true, '지금 아군 체력의 이 %만큼')}
          {lnum('고정값', 'flat', true, '더해서 소모. 체력은 1 아래로 내려가지 않음 (실드 무시)')}
          <Field label="말풍선" hint="소모할 때 카드 위 대사 (비우면 없음)" wide>
            <TextInput value={e.say ?? ''} onChange={(v) => { if (v) e.say = v; else delete e.say; onChange(); }} />
          </Field>
          <div className="consume-inner field-wide">
            <div className="muted small">체력을 쓰면 발동할 효과 — 비례 출처 "소모한 체력"으로 쓴 만큼 강하게. 체력이 줄어 "아군 체력 N% 이하" 능력도 발동합니다</div>
            <EffectList effects={e.effects} tags={tags} onChange={onChange} nested />
          </div>
        </div>
      );
    case 'conduct':
      return (
        <div className="effect-fields">
          <FilterEditor f={e.target} tags={tags} onChange={onChange} />
          <Check label="주변에 같은 태그가 없는 유닛만 (태그 없는 유닛 제외)" value={!!e.uniqueTag} onChange={(v) => { if (v) e.uniqueTag = true; else delete e.uniqueTag; onChange(); }} />
          {lnum('1명당 골드', 'goldPer', true, '행동시킨 유닛 1명당 전투 후 골드')}
          <Field label="장신구 보상" hint="행동시킨 수를 이 수로 나눈 몫(내림)만큼 그 등급의 무작위 장신구">
            <span className="inline">
              <OptNumInput value={e.trinketPer} min={1} onChange={(v) => { if (v) e.trinketPer = v; else delete e.trinketPer; onChange(); }} />명마다
              <Select value={e.trinketGrade ?? 0} options={[[0, '없음'], ...GRADE_NAMES.slice(1).map((n, i): [number, string] => [i + 1, n])]} onChange={(v) => { if (v) e.trinketGrade = v; else delete e.trinketGrade; onChange(); }} />
            </span>
          </Field>
          <Field label="완벽한 공연" hint="행동시킨 수가 이 이상이면 정해진 장신구 획득">
            <span className="inline">
              <OptNumInput value={e.perfect} min={1} onChange={(v) => { if (v) e.perfect = v; else delete e.perfect; onChange(); }} />명 이상 →
              <Select value={e.perfectTrinket ?? ''} options={[['', '없음'], ...TRINKETS.map((t): [string, string] => [t.id, `${t.name} (${GRADE_NAMES[t.grade]})`])]} onChange={(v) => { if (v) e.perfectTrinket = v; else delete e.perfectTrinket; onChange(); }} />
            </span>
          </Field>
        </div>
      );
    case 'mimic':
      return <p className="muted small">반응 트리거에서 쓰면, 반응한 유닛의 "행동할 때" 효과를 이 유닛의 능력치·편 기준으로 그대로 합니다 (추가발동은 하나하나 따라 함). 영구 강화·골드·장신구 획득도 이 유닛의 편이 얻습니다. 따라 한 효과를 다시 따라 하지는 않습니다.</p>;
  }
}

function move<T>(arr: T[], i: number, d: number) {
  const j = i + d;
  if (j < 0 || j >= arr.length) return;
  [arr[i], arr[j]] = [arr[j], arr[i]];
}

// 효과 목록 (트리거의 효과들, 상태 소모의 안쪽 효과들). nested면 상태 소모를 고를 수 없다
function EffectList({ effects, tags, onChange, nested }: { effects: Effect[]; tags: string[]; onChange: () => void; nested?: boolean }) {
  const center = useContext(CenterAnchor);
  const labels = nested ? EFFECT_LABELS.filter(([k]) => k !== 'consume') : EFFECT_LABELS;
  return (
    <>
      {effects.map((e, ei) => (
        <div key={ei} className="effect">
          <div className="effect-head">
            <Select<EffectType> value={e.type} options={labels} onChange={(v) => { effects[ei] = structuredClone(DEFAULT_EFFECT[v]); onChange(); }} />
            <span className="muted small">{describeEffect(e, center)}</span>
            <div className="spacer" />
            <button className="btn tiny" onClick={() => { move(effects, ei, -1); onChange(); }}>위</button>
            <button className="btn tiny" onClick={() => { move(effects, ei, 1); onChange(); }}>아래</button>
            <button className="btn tiny danger" onClick={() => { effects.splice(ei, 1); onChange(); }}>삭제</button>
          </div>
          <EffectEditor e={e} tags={tags} onChange={onChange} />
        </div>
      ))}
      <button className="btn tiny" onClick={() => { effects.push(structuredClone(DEFAULT_EFFECT.damage)); onChange(); }}>{nested ? '+ 안쪽 효과 추가' : '+ 효과 추가'}</button>
    </>
  );
}

// center: 장신구처럼 기준 칸이 보드 중앙인 효과
export function TriggerEditor({ triggers, tags, onChange, numbered, center = false }: { triggers: Trigger[]; tags: string[]; onChange: () => void; numbered?: boolean; center?: boolean }) {
  return (
    <CenterAnchor.Provider value={center}>
    <div className="trigger-list">
      {triggers.map((t, ti) => (
        <div key={ti} className="trigger">
          <div className="trigger-head">
            {numbered && <span className="trigger-no" title="성장의 '능력 제거'에서 이 번호를 씁니다">능력 {ti + 1}</span>}
            <Select value={t.on} options={ON_LABELS} onChange={(v) => {
              t.on = v;
              if (v === 'timer') t.atSec ??= 10;
              else delete t.atSec;
              if (v === 'lowHp' || v === 'enemyLowHp') t.hpPct ??= 50;
              else delete t.hpPct;
              if (v === 'react') t.watch ??= { side: 'ally', area: 'near', dirs: ['u', 'd', 'l', 'r'] };
              else { delete t.watch; delete t.every; }
              if (v !== 'timer') delete t.repeat;
              if (v !== 'react' && !(v === 'timer' && t.repeat)) delete t.limit;
              onChange();
            }} />
            {t.on === 'timer' && (
              <span className="inline">
                <NumInput value={t.atSec ?? 0} min={t.repeat ? 1 : 0} width={60} onChange={(v) => { t.atSec = t.repeat ? Math.max(1, v) : v; onChange(); }} />초
                <Check label="반복" value={!!t.repeat} onChange={(on) => {
                  if (on) {
                    t.repeat = true;
                    t.atSec = Math.max(1, t.atSec ?? 0);
                  } else {
                    delete t.repeat;
                    delete t.limit;
                  }
                  onChange();
                }} />
                {t.repeat && (
                  <span className="inline" title="이 전투에서 최대 몇 번까지 발동하는지 (0 = 제한 없음)">
                    최대 <NumInput value={t.limit ?? 0} min={0} width={56} onChange={(v) => { if (v > 0) t.limit = v; else delete t.limit; onChange(); }} />회
                  </span>
                )}
              </span>
            )}
            {(t.on === 'lowHp' || t.on === 'enemyLowHp') && (
              <span className="inline" title={`${t.on === 'lowHp' ? '아군' : '상대'} 팀 체력이 최대 체력의 이 % 이하가 되는 순간 한 번 발동`}>
                체력 <NumInput value={t.hpPct ?? 50} min={1} width={60} onChange={(v) => { t.hpPct = Math.max(1, Math.min(99, v)); onChange(); }} />% 이하
              </span>
            )}
            <span className="inline only-in" title="이 노드의 전투에서만 이 능력이 있습니다 (둘 다 비우면 항상)">
              {(['elite', 'boss'] as const).map((k) => (
                <Check key={k} label={k === 'boss' ? '보스전만' : '엘리트전만'} value={!!t.onlyIn?.includes(k)} onChange={(on) => {
                  const next = (t.onlyIn ?? []).filter((x) => x !== k).concat(on ? [k] : []);
                  if (next.length) t.onlyIn = next;
                  else delete t.onlyIn;
                  onChange();
                }} />
              ))}
            </span>
            <span className="trigger-summary">{describeTrigger(t, center)}</span>
            {!center && (
              <input className="say-input" placeholder="말풍선 (발동할 때)" value={t.say ?? ''} title="이 능력이 발동할 때 카드 위에 뜨는 대사 (비우면 없음)"
                onChange={(ev) => { if (ev.target.value) t.say = ev.target.value; else delete t.say; onChange(); }} />
            )}
            <div className="spacer" />
            <button className="btn tiny" onClick={() => { move(triggers, ti, -1); onChange(); }}>위</button>
            <button className="btn tiny" onClick={() => { move(triggers, ti, 1); onChange(); }}>아래</button>
            <button className="btn tiny danger" onClick={() => { triggers.splice(ti, 1); onChange(); }}>삭제</button>
          </div>
          {t.on === 'react' && t.watch && <ReactFields t={t} tags={tags} onChange={onChange} />}
          <EffectList effects={t.effects} tags={tags} onChange={onChange} />
        </div>
      ))}
      <button className="btn small" onClick={() => { triggers.push({ on: 'act', effects: [structuredClone(DEFAULT_EFFECT.damage)] }); onChange(); }}>
        + 트리거 추가
      </button>
    </div>
    </CenterAnchor.Provider>
  );
}

// 반응 트리거: 지켜볼 유닛(위치·태그 등) + N번마다 + 최대 횟수
function ReactFields({ t, tags, onChange }: { t: Trigger; tags: string[]; onChange: () => void }) {
  const center = useContext(CenterAnchor);
  return (
    <div className="react-fields">
      <div className="muted small">
        반응할 유닛 ({center ? '기준 = 보드 중앙' : '기준 = 자신의 칸, 자신은 제외'}). 추가발동도 행동 1번으로 셉니다. 반응으로 낸 효과는 다른 반응을 부르지 않고, 기절 중에는 반응하지 않습니다.
      </div>
      <FilterEditor f={t.watch!} tags={tags} onChange={onChange} noSelf />
      <span className="inline" title="지켜보는 유닛들이 합쳐서 이 횟수만큼 행동할 때마다 1번 발동">
        <NumInput value={t.every ?? 1} min={1} width={56} onChange={(v) => { if (v > 1) t.every = v; else delete t.every; onChange(); }} />번 행동마다
      </span>
      <span className="inline" title="이 전투에서 최대 몇 번까지 발동하는지 (0 = 제한 없음)">
        최대 <NumInput value={t.limit ?? 0} min={0} width={56} onChange={(v) => { if (v > 0) t.limit = v; else delete t.limit; onChange(); }} />회 (0 = 무제한)
      </span>
    </div>
  );
}
