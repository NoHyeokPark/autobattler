// 런 지도 (슬레이 더 스파이어식): 14일치 노드와 이어진 길. 상점 화면의 "지도" 버튼으로 열고, 노드 선택 칸에는 미니맵으로 보인다.
// 지나온 길은 진하게, 오늘 고를 수 있는 노드는 테두리로 강조하고 누르면 그 노드를 고른다.
// 지금 위치에서 더는 갈 수 없는 앞날 노드는 흐리게 그린다.

import { BALANCE } from '../../src/config/balance.ts';
import { ENV_NAMES } from '../../src/data/types.ts';
import type { MapNode, NodeKind, RunState } from '../../src/game/state.ts';
import { NODE_NAMES, nodeText } from '../../src/ui/render.ts';
import { Modal } from '../components/Modal.tsx';

const GLYPH: Record<NodeKind, string> = { normal: '일', env: '환', elite: '엘', boss: '보', final: '최', campfire: '불', event: '?' };

// 크기: 전체 지도 / 미니맵 (미니맵은 오늘부터 2일 뒤까지만, 보드 오른쪽의 세로 칸에 맞춘 비율)
const FULL = { col: 64, row: 74, padX: 46, padY: 44, r: 18, foot: 34 };
const MINI = { col: 66, row: 92, padX: 30, padY: 36, r: 17, foot: 22 };
const MINI_AFTER = 2;

export function RunMapSvg({ run, disabled, onPick, mini = false }: { run: RunState; disabled: boolean; onPick: (index: number) => void; mini?: boolean }) {
  const map = run.map;
  if (!map) return null;
  const S = mini ? MINI : FULL;
  const lastDay = Math.max(...map.nodes.map((n) => n.day));
  const from = mini ? Math.min(run.day, lastDay) : 1;
  const to = mini ? Math.min(lastDay, from + MINI_AFTER) : lastDay;
  const shown = (n: MapNode) => n.day >= from && n.day <= to;
  const x = (d: number) => S.padX + (d - from) * S.col;
  const y = (lane: number) => S.padY + lane * S.row;
  const width = S.padX * 2 + (to - from) * S.col;
  const height = S.padY + (map.lanes - 1) * S.row + S.foot;
  const path = run.mapPath ?? [];
  const visited = new Set(path);
  const pathEdges = new Set(path.slice(1).map((id, i) => `${path[i]}-${id}`));
  // 오늘 고를 수 있는 노드 → run.nodes 번호
  const optionIndex = new Map(run.nodes.map((n, i) => [n.mapId, i]));
  const selectedId = run.nodeIndex !== null ? run.nodes[run.nodeIndex]?.mapId : undefined;
  const pickable = (n: MapNode) => n.day === run.day && optionIndex.has(n.id) && run.phase === 'shop' && !disabled;
  // 오늘 고를 수 있는 노드에서 닿는 앞날 노드 (나머지 앞날 노드는 흐리게)
  const reach = new Set<number>();
  const stack = run.nodes.map((n) => n.mapId).filter((id): id is number => id !== undefined);
  while (stack.length) {
    const id = stack.pop()!;
    if (reach.has(id)) continue;
    reach.add(id);
    stack.push(...map.nodes[id].next);
  }
  const svgSize = mini ? {} : { width, height };

  return (
    <svg className={`run-map ${mini ? 'mini' : ''}`} viewBox={`0 0 ${width} ${height}`} {...svgSize} role="img" aria-label={mini ? '미니맵' : '런 지도'}>
      {/* 오늘 열 */}
      <rect x={x(run.day) - S.col / 2} y={4} width={S.col} height={height - 8} rx={10} className="map-today" />
      {Array.from({ length: to - from + 1 }, (_, i) => from + i).map((d) => (
        <text key={d} x={x(d)} y={mini ? 14 : 18} className={`map-day ${BALANCE.run.bossDays.includes(d) ? 'boss-day' : ''}`}>{d}</text>
      ))}
      {/* 길 */}
      {map.nodes.filter(shown).flatMap((n) => n.next.filter((id) => shown(map.nodes[id])).map((id) => {
        const m = map.nodes[id];
        const on = pathEdges.has(`${n.id}-${id}`);
        const ahead = visited.has(n.id) && n.id === path[path.length - 1] && optionIndex.has(id);
        const far = n.day >= run.day && !(reach.has(n.id) && reach.has(id));
        return <line key={`${n.id}-${id}`} x1={x(n.day)} y1={y(n.lane)} x2={x(m.day)} y2={y(m.lane)} className={`map-edge ${on ? 'on' : ''} ${ahead ? 'ahead' : ''} ${far ? 'far' : ''}`} />;
      }))}
      {/* 노드 */}
      {map.nodes.filter(shown).map((n) => {
        const idx = optionIndex.get(n.id);
        const can = pickable(n);
        const cls = [
          'map-node', `k-${n.kind}`, `e-${n.env}`, visited.has(n.id) ? 'visited' : '', n.day === run.day && idx !== undefined ? 'open' : '',
          n.id === selectedId ? 'selected' : '', n.day < run.day && !visited.has(n.id) ? 'past' : '', n.day >= run.day && !reach.has(n.id) ? 'far' : '',
        ].filter(Boolean).join(' ');
        return (
          <g key={n.id} className={cls} transform={`translate(${x(n.day)} ${y(n.lane)})`} onClick={can ? () => onPick(idx!) : undefined} style={can ? { cursor: 'pointer' } : undefined}>
            <title>{`${n.day}일차 · ${nodeText({ kind: n.kind, env: n.env }, n.day)}${can ? ' (누르면 선택)' : ''}`}</title>
            <circle r={S.r} />
            <text className="glyph" dy="0.35em">{GLYPH[n.kind]}</text>
            {n.env !== 'normal' && (mini ? <circle className="env-dot" cx={S.r * 0.75} cy={-S.r * 0.75} r={3.5} /> : <text className="env" y={S.r + 11}>{n.env === 'hp' ? '체력' : '공격'}</text>)}
          </g>
        );
      })}
    </svg>
  );
}

export function MapModal({ run, disabled, onPick, onClose }: { run: RunState; disabled: boolean; onPick: (index: number) => void; onClose: () => void }) {
  if (!run.map) {
    return (
      <Modal title="지도" onClose={onClose}>
        <p className="muted">이 런은 지도 이전에 시작해서, 다음 날부터 지도가 생깁니다.</p>
      </Modal>
    );
  }
  return (
    <Modal title={`지도 · ${run.day}일차`} onClose={onClose} wide>
      <div className="run-map-wrap">
        <RunMapSvg run={run} disabled={disabled} onPick={onPick} />
      </div>
      <div className="map-legend">
        {(['normal', 'elite', 'boss', 'campfire', 'event', 'final'] as NodeKind[]).map((k) => (
          <span key={k} className={`map-legend-item k-${k}`}><b>{GLYPH[k]}</b> {NODE_NAMES[k] === '?' ? '이벤트' : NODE_NAMES[k]}</span>
        ))}
        <span className="muted small">아래 글자 = 환경 ({ENV_NAMES.hp}, {ENV_NAMES.atk}) · 진한 길 = 지나온 길 · 파란 테두리 = 오늘 고를 수 있는 노드 (누르면 선택) · 흐린 노드 = 지금 위치에서 갈 수 없음</span>
      </div>
      <p className="muted small">
        모닥불: 장신구 대신 휴식(라이프 +{BALANCE.campfire.restLives}) 또는 단련(리더 능력치 하나) · 이벤트(?): 장신구 대신 이벤트 상황과 선택지 · 엘리트·보스: 일차+1 상대, 이기면 장신구 보상 추가 ·
        {' '}연장 중에는 엘리트·보스가 일반 전투 · {BALANCE.run.maxDays}일차 시작 때 남은 라이프는 하나당 {BALANCE.run.spareLifeGold}골드
      </p>
    </Modal>
  );
}
