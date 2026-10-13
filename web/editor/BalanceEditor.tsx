// 밸런스 수치 편집기. config/balance.ts의 구조를 그대로 따라 그리므로, 수치를 추가하면 여기에도 자동으로 나온다.
// 라벨이 없는 항목은 키 이름으로 표시한다.

import type { ModData } from '../../src/data/registry.ts';
import { GRADE_NAMES } from '../../src/data/types.ts';
import { Check, Field, NumInput, NumListInput, Select, TextInput } from './fields.tsx';

const SECTIONS: Record<string, string> = {
  ruleVersion: '규칙 버전',
  engine: '엔진 안전 장치',
  battleGains: '전투 밖 획득 상한 (전투당)',
  suddenDeath: '서든데스',
  board: '보드와 벤치',
  slot: '칸 효과 (열 + 행)',
  scaling: '일차별 체력 스케일링',
  env: '환경',
  statuses: '팀 상태 효과',
  unit: '몬스터 레벨업 (3장 합성)',
  leader: '리더 성장',
  economy: '경제',
  shop: '상점',
  run: '런 진행',
  rank: '랭크 점수',
  matching: 'PvP 매칭',
};

const LABELS: Record<string, string> = {
  ruleVersion: '규칙 버전 (다르면 옛 기록과 매칭 안 함)',
  'battleGains.maxGoldPerBattle': '골드 획득 상한',
  'battleGains.maxTrinketsPerBattle': '장신구 획득 상한',
  'engine.safeLimit': '정수 안전 한도',
  'engine.minIntervalTicks': '최소 행동 간격 (tick)',
  'engine.maxExtraActs': '행동당 추가발동 처리 상한',
  'engine.maxBattleSec': '강제 종료 시각 (초, HP 비율 판정)',
  'suddenDeath.startSec': '시작 시각 (초)',
  'suddenDeath.baseDamage': '첫 피해',
  'suddenDeath.ratioNum': '등비 분자',
  'suddenDeath.ratioDen': '등비 분모',
  'suddenDeath.bypassShield': '실드 무시',
  'board.initialDeployLimit': '시작 배치 인원 (리더 포함)',
  'board.maxDeploy': '최대 배치 인원',
  'board.benchSize': '벤치 칸 수',
  'slot.col1.stunTicks': '1열: 시작 기절 (tick)',
  'slot.col1.intervalPermille': '1열: 행동 간격 배율 (‰, 최종값에 별도 적용)',
  'slot.col2.hpPctPerDeployed': '2열: 배치 인원당 체력 %',
  'slot.col3.intervalPermille': '3열: 행동 간격 배율 (‰, 시작 즉시 행동)',
  'slot.row1.atkBonusByDay': '1행: 공격력 + x (일차별, 쉼표 구분)',
  'slot.row2.healShieldPct': '2행: 회복·실드 %',
  'slot.row3.intervalPermille': '3행: 행동 간격 배율 (‰)',
  'slot.row3.extra': '3행: 추가발동 +',
  'env.hp.maxHpPct': '체력 증가 환경: 최대 체력 %',
  'env.atk.atkBonusByDay': '공격 증가 환경: 공격력 + (일차별)',
  'unit.mergeCount': '합성에 필요한 장수',
  'unit.maxLevel': '최대 레벨',
  'unit.levelStatPct': '레벨별 체력·공격력·주문력 % (Lv1, Lv2, Lv3)',
  'unit.growthChoices': '레벨업 성장 선택지 수',
  'unit.growthChoiceLevels': '성장을 고르는 레벨 (그 외 레벨은 재료의 성장을 물려받음)',
  'scaling.hpPctByDay': '일차별 양측 최대 체력 % (1일차부터, 쉼표 구분)',
  'leader.levelUpDays': '레벨업 일차',
  'leader.statPctPerLevel': '레벨당 체력·공격력·주문력 +%',
  'leader.growthChoices': '성장 선택지 수',
  'economy.startGold': '시작 골드',
  'economy.baseIncome': '매일 기본 수입',
  'economy.interestPer': '이자: 골드 N원마다 +1',
  'economy.interestMax': '이자 최대',
  'economy.rerollCost': '리롤 비용',
  'economy.monsterCost': '몬스터 가격 (일반~기원)',
  'economy.sellPct': '판매가 % (구매가 × 장수 기준)',
  'economy.trinketCost': '장신구 가격 (일반~기원)',
  'economy.skipRewardGold': '보상 대신 골드',
  'economy.skipEliteBonusGold': '엘리트 보너스 대신 골드',
  'economy.skipBossRewardGold': '보스 보상 대신 골드',
  'shop.slots': '상점 칸 수',
  'shop.maxTrinkets': '장신구 최대 칸 수',
  'shop.trinketChancePct': '칸마다 장신구 확률 %',
  'run.maxDays': '최대 일차',
  'run.winTarget': '우승 승수',
  'run.lossLimit': '탈락 패배 수',
  'run.bossDays': '보스 일차',
  'run.finalBossDay': '최종 보스 일차',
  'run.rewardChoices': '보상 장신구 선택지 수',
  'rank.extensionBonus': '연장 승리 누적 보너스 (0승, 1승, ...)',
  'rank.extensionLossScore': '연장 패배 시 점수',
  'rank.championScore': '우승 점수',
  'rank.finalBossBonus': '최종 보스 승리 보너스',
  'matching.seedBotIncomePenalty': '시드 봇 수입 감소 (약하게)',
  'matching.exposureCap': '기록당 노출 상한',
};

const DECAY_OPTS: [string, string][] = [['none', '감쇠 없음'], ['minus1', '주기마다 -1'], ['half', '주기마다 절반']];
const FRACTION = (path: string) => path.startsWith('rank.');

type Obj = Record<string, unknown>;

function OddsTable({ odds, onChange }: { odds: number[][]; onChange: () => void }) {
  return (
    <div className="table-wrap">
      <table className="table odds">
        <thead>
          <tr><th>라운드</th>{GRADE_NAMES.slice(1).map((g) => <th key={g}>{g}</th>)}<th>합</th></tr>
        </thead>
        <tbody>
          {odds.map((row, r) => {
            const sum = row.reduce((a, b) => a + b, 0);
            return (
              <tr key={r}>
                <td>{r + 1}</td>
                {row.map((v, c) => (
                  <td key={c}><NumInput value={v} min={0} width={52} onChange={(n) => { row[c] = n; onChange(); }} /></td>
                ))}
                <td className={sum === 100 ? 'muted' : 'bad-text'}>{sum}%</td>
              </tr>
            );
          })}
        </tbody>
      </table>
      <div className="inline">
        <button className="btn small" onClick={() => { odds.push([...odds[odds.length - 1]]); onChange(); }}>+ 라운드</button>
        <button className="btn small ghost" disabled={odds.length <= 1} onClick={() => { odds.pop(); onChange(); }}>- 라운드</button>
      </div>
    </div>
  );
}

function Node({ obj, k, path, onChange }: { obj: Obj; k: string; path: string; onChange: () => void }) {
  const v = obj[k];
  const label = LABELS[path] ?? k;
  if (path === 'ticksPerSec') {
    return <Field label="1초당 tick" hint="데이터가 tick 단위라 바꿀 수 없음"><NumInput value={v as number} readOnly onChange={() => {}} /></Field>;
  }
  if (path === 'shop.odds') {
    return <div className="field-wide"><h4>상점 등급 확률표 (%)</h4><OddsTable odds={v as number[][]} onChange={onChange} /></div>;
  }
  if (path === 'run.bossRewardGrade') {
    const rec = v as Record<string, number>;
    return (
      <div className="field-wide">
        <h4>보스 보상 장신구 등급 (일차 → 등급)</h4>
        <div className="inline wrap">
          {Object.keys(rec).map((day) => (
            <Field key={day} label={`${day}일차`}>
              <Select value={rec[day]} options={[3, 4, 5, 6].map((g): [number, string] => [g, GRADE_NAMES[g]])} onChange={(g) => { rec[day] = g; onChange(); }} />
            </Field>
          ))}
        </div>
      </div>
    );
  }
  if (typeof v === 'number') return <Field label={label}><NumInput value={v} int={!FRACTION(path)} onChange={(n) => { obj[k] = n; onChange(); }} /></Field>;
  if (typeof v === 'boolean') return <Check label={label} value={v} onChange={(b) => { obj[k] = b; onChange(); }} />;
  if (typeof v === 'string') {
    if (k === 'decay') return <Field label="감쇠"><Select value={v} options={DECAY_OPTS} onChange={(s) => { obj[k] = s; onChange(); }} /></Field>;
    return <Field label={k === 'name' ? '표시 이름' : label}><TextInput value={v} onChange={(s) => { obj[k] = s; onChange(); }} /></Field>;
  }
  if (Array.isArray(v) && v.every((x) => typeof x === 'number')) {
    return <Field label={label} wide><NumListInput value={v as number[]} int={!FRACTION(path)} onChange={(arr) => { obj[k] = arr; onChange(); }} /></Field>;
  }
  if (v && typeof v === 'object') {
    return (
      <fieldset className="subgroup">
        <legend>{k}</legend>
        <div className="form-grid">
          {Object.keys(v as Obj).map((ck) => <Node key={ck} obj={v as Obj} k={ck} path={`${path}.${ck}`} onChange={onChange} />)}
        </div>
      </fieldset>
    );
  }
  return null;
}

export function BalanceEditor({ draft, onChange }: { draft: ModData; onChange: () => void }) {
  const b = draft.balance as unknown as Obj;
  const top = Object.keys(b);
  const scalars = top.filter((k) => typeof b[k] !== 'object');
  const groups = top.filter((k) => typeof b[k] === 'object');
  return (
    <div className="balance-editor">
      <p className="muted">모든 수치는 정수입니다 (랭크 점수만 소수 가능). ‰ = 1000분율 (1000 = 1.0배). 1초 = 10 tick.</p>
      <section className="panel">
        <h3>기본</h3>
        <div className="form-grid">{scalars.map((k) => <Node key={k} obj={b} k={k} path={k} onChange={onChange} />)}</div>
      </section>
      {groups.map((k) => (
        <section key={k} className="panel">
          <h3>{SECTIONS[k] ?? k}</h3>
          <div className="form-grid">
            {Object.keys(b[k] as Obj).map((ck) => <Node key={ck} obj={b[k] as Obj} k={ck} path={`${k}.${ck}`} onChange={onChange} />)}
          </div>
        </section>
      ))}
    </div>
  );
}
