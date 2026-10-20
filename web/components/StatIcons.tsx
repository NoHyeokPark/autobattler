// 능력치 아이콘 (체력·공격력·주문력·행동 간격·추가발동). 글자 대신 아이콘 + 숫자로 짧게 보여 준다.
// 마우스를 올리면 능력치 이름이 나온다.

import { BALANCE } from '../../src/config/balance.ts';

export type StatKind = 'hp' | 'atk' | 'power' | 'interval' | 'extra';

export const STAT_LABELS: Record<StatKind, string> = {
  hp: '체력', atk: '공격력', power: '주문력', interval: '행동 간격', extra: '추가발동',
};

const PATHS: Record<StatKind, string> = {
  hp: 'M12 20.5s-7.5-4.6-9.2-9.4C1.6 7.6 4 4.5 7.2 4.5c2 0 3.6 1.1 4.8 2.8 1.2-1.7 2.8-2.8 4.8-2.8 3.2 0 5.6 3.1 4.4 6.6-1.7 4.8-9.2 9.4-9.2 9.4z',
  atk: 'M14.5 3.5H20.5V9.5L10 20l-3.5.5.5-3.5zM4.5 14.5l5 5M3 21l3-3',
  power: 'M12 3l2.1 6.9L21 12l-6.9 2.1L12 21l-2.1-6.9L3 12l6.9-2.1z',
  interval: 'M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18zM12 7.5V12l3 2',
  extra: 'M4.5 11A7.5 7.5 0 0 1 17.6 6.4M20 3.5v4h-4M19.5 13a7.5 7.5 0 0 1-13.1 4.6M4 20.5v-4h4',
};

export function StatIcon({ kind }: { kind: StatKind }) {
  return (
    <svg className={`stat-icon stat-icon-${kind}`} viewBox="0 0 24 24" width="1em" height="1em" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d={PATHS[kind]} />
    </svg>
  );
}

// 카드용 능력치 줄. buffed: 전투 중 기본값과 달라진 능력치 (강조)
export function StatLine({ hp, atk, power, intervalTicks, extra, buffed = [] }: {
  hp?: number; atk?: number; power?: number; intervalTicks?: number; extra?: number; buffed?: StatKind[];
}) {
  const item = (kind: StatKind, value: string, show = true) => show && (
    <span key={kind} className={`stat ${buffed.includes(kind) ? 'buffed' : ''}`} title={`${STAT_LABELS[kind]} ${value}`}>
      <StatIcon kind={kind} />{value}
    </span>
  );
  return (
    <span className="stat-line">
      {item('hp', String(hp ?? 0))}
      {item('atk', String(atk ?? 0))}
      {item('power', String(power ?? 0), !!power)}
      {item('interval', `${+((intervalTicks ?? 0) / BALANCE.ticksPerSec).toFixed(1)}`)}
      {item('extra', `+${extra}`, !!extra)}
    </span>
  );
}
