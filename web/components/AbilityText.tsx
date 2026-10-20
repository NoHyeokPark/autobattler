// 능력 설명을 계산된 수치 + 계수로 그린다 (롤 툴팁처럼).
//   12(⚔100%) 피해   → 굵은 숫자 = 지금 능력치로 계산한 값, 괄호 = 어떤 능력치에 몇 % 비례하는지
// 숫자 색은 비례하는 능력치 색 (공격력 주황·주문력 보라·체력 빨강), 여러 능력치가 섞이면 검정.
// 고정값만 있는 수치는 그냥 굵은 숫자.

import { abilityLines, amountSegText } from '../../src/data/describe.ts';
import type { AmountSeg, DescSeg, DescStats } from '../../src/data/describe.ts';
import type { Trigger } from '../../src/data/types.ts';
import { StatIcon } from './StatIcons.tsx';
import type { StatKind } from './StatIcons.tsx';

// 아이콘이 있는 출처 (자신의 능력치). 나머지(골드·팀 상태·유닛 수 등)는 이름으로 쓴다
const ICONS: Partial<Record<string, StatKind>> = { atk: 'atk', power: 'power', hp: 'hp', haste: 'interval', extra: 'extra' };
const TONED = new Set(['atk', 'power', 'hp']);

function Amount({ a }: { a: AmountSeg }) {
  const ratios = a.parts.filter((p) => p.stat);
  const flat = a.parts.find((p) => !p.stat);
  const only = ratios.length === 1 && !flat ? ratios[0].stat! : null;
  const tone = ratios.length === 0 ? 'flat' : only && TONED.has(only) ? only : 'mixed';
  return (
    <span className="amt" title={amountSegText(a) + (a.partial ? ' (+ = 전투 상황에 따라 더 커짐)' : '')}>
      {/* 모든 항목을 전투 중에만 알 수 있으면 숫자 없이 계수만 */}
      {!(a.partial && a.parts.every((p) => !p.known)) && <b className={`amt-total amt-${tone}`}>{a.total}{a.partial && <span className="amt-plus">+</span>}</b>}
      {ratios.length > 0 && (
        <span className="amt-ratio">
          ({flat && <span className="r-flat">{flat.value} + </span>}
          {ratios.map((p, i) => {
            const icon = ICONS[p.stat!];
            return (
              <span key={i} className={`r r-${p.stat} ${p.known ? '' : 'r-dyn'}`}>
                {i > 0 && ' + '}
                {icon ? <StatIcon kind={icon} /> : <span className="r-label">{p.label} </span>}
                {p.value}%
              </span>
            );
          })}
          {a.mult !== undefined && <span className="r-mult"> ×{a.mult}%</span>})
        </span>
      )}
    </span>
  );
}

export function Segs({ segs }: { segs: DescSeg[] }) {
  return <>{segs.map((s, i) => (typeof s === 'string' ? <span key={i}>{s}</span> : <Amount key={i} a={s} />))}</>;
}

// block: 능력마다 한 줄 (상세 보기). 아니면 이어 쓰기 (카드 안, 줄 수 제한과 함께)
export function AbilityText({ triggers, extra, stats, center, block }: {
  triggers: Trigger[]; extra?: number; stats: DescStats; center?: boolean; block?: boolean;
}) {
  const lines = abilityLines(triggers, extra, stats, center);
  if (lines.length === 0) return <span className="muted">능력 없음</span>;
  if (block) return <div className="ability-lines">{lines.map((l, i) => <div key={i}><Segs segs={l} /></div>)}</div>;
  return <>{lines.map((l, i) => <span key={i}>{i > 0 && ' '}<Segs segs={l} /></span>)}</>;
}
