// 런 지도 (슬레이 더 스파이어식). 첫날 런 시드로 14일치 지도를 만들고, 매일 어제 노드와 이어진 노드 중 하나를 고른다.
//  - 길(path)을 여러 개 그어서 만든다: 1일차의 한 갈래에서 시작해 매일 옆 갈래(-1·0·+1)로 이동, 다른 길과 엇갈리지 않게.
//  - 보스와 엘리트는 같은 노드다 (둘 다 일차+1 상대). 보스 날(run.bossDays)에 나온 엘리트를 보스로 그릴 뿐이라 보스 날에는 엘리트가 없다.
//    (보스 날 다음 날은 리더 성장 날이라 일차+1 상대가 이미 성장을 고른 상태 = 다른 날 엘리트보다 세다. 그래서 보스로 부르고 보상이 더 좋다.
//     같은 날 엘리트와 보스가 함께 나오면 같은 상대에 보상만 더 좋은 보스가 완전한 상위호환이 된다)
//    보스 날에는 한 노드를 꼭 보스로 정하고, 나머지 칸 중 엘리트로 뽑힌 칸도 보스가 된다.
//  - 안전 날(map.safeDays)로 갈 때는 어느 전날 노드에서든 엘리트·보스가 아닌 다음 노드가 하나 이상 있다.
//    (전날 노드의 다음 노드가 모두 엘리트·보스면 꼭 정한 보스가 아닌 하나를 엘리트·보스 없이 다시 뽑는다.
//     꼭 정하는 보스는 어떤 전날 노드의 유일한 다음 노드가 아닌 칸에 둔다)
//  - 모닥불 날(map.campfireDays)에는 한 노드가 모닥불 (보스·모닥불 모두 고를 수 있는 선택지 중 하나).
//    전날 보스와 이어진 칸이 map.campfireBossWeight배 잘 뽑힌다 (보스 뒤 휴식, 항상은 아님).
//  - 1일차는 일반만, 마지막 날(run.finalBossDay)은 최종 보스 하나 + 일반. 나머지는 kindWeights(일반·엘리트·이벤트).
//  - 노드마다 환경(일반·체력·공격)이 붙는다 (envWeights).
//  - 같은 일차에 종류·환경이 완전히 같은 노드는 만들지 않는다 (가능한 조합이 모자라도록 수치를 바꾸면 그때만 겹치게 둔다).
//    1일차는 일반만이라 조합이 환경 수뿐이므로, 1일차 시작 갈래 수를 그만큼으로 줄인다.
// 연장 중에는 엘리트·보스 노드가 일반 전투로 진행된다 (지도에는 그대로 그리고 mapKind로 원래 종류를 남긴다).

import { BALANCE } from '../config/balance.ts';
import type { Rng } from '../core/rng.ts';
import type { EnvId } from '../data/types.ts';
import type { MapNode, NodeKind, NodeOption, RunMap, RunState } from './state.ts';

const ENVS: EnvId[] = ['normal', 'hp', 'atk'];

// (d일차 a→b)와 (d일차 c→e)가 엇갈리는가 (끝점을 공유하면 엇갈림이 아니다)
const crosses = (a: number, b: number, c: number, e: number) => (a < c && b > e) || (a > c && b < e);

// 안전 날 규칙이 지켜졌는가: 안전 날 전날의 모든 노드에 엘리트·보스가 아닌 다음 노드가 있다
export function safeDaysOk(map: RunMap): boolean {
  return (BALANCE.map.safeDays ?? []).every((d) =>
    map.nodes.filter((p) => p.day === d - 1).every((p) => p.next.length === 0 || p.next.some((id) => map.nodes[id].kind !== 'elite' && map.nodes[id].kind !== 'boss')));
}

// 길 모양 때문에 안전 날 규칙과 "보스 날 보스 하나 이상"을 함께 지킬 수 없으면 (예: 안전 날 줄의 노드마다 그 노드로만 가는 전날 노드가 있다)
// 이어지는 난수로 지도를 다시 만든다. 계속 안 되면 마지막 지도를 쓴다
export function generateMap(rng: Rng): RunMap {
  let map = generateOnce(rng);
  for (let i = 0; i < 50 && !safeDaysOk(map); i++) map = generateOnce(rng);
  return map;
}

function generateOnce(rng: Rng): RunMap {
  const R = BALANCE.run;
  const M = BALANCE.map;
  const days = R.maxDays;
  const lanes = Math.max(1, M.lanes);
  const edges = new Map<number, [number, number][]>(); // 일차 → (갈래 → 다음 갈래)
  const visited = new Set<string>();
  const mark = (d: number, l: number) => visited.add(`${d}:${l}`);
  // 1일차 시작 갈래: 서로 다른 갈래에서 시작해 선택지가 여럿이 되게, 다만 1일차에 만들 수 있는 서로 다른 노드 수(환경 수)까지만
  const envKinds = (Object.keys(M.envWeights) as EnvId[]).filter((e) => M.envWeights[e] > 0).length;
  const starts = Array.from({ length: lanes }, (_, i) => i);
  rng.shuffle(starts);
  starts.length = Math.max(1, Math.min(lanes, envKinds));
  starts.sort((a, b) => a - b);
  for (let p = 0; p < Math.max(1, M.paths); p++) {
    let lane = p < starts.length ? starts[p] : starts[rng.int(starts.length)];
    mark(1, lane);
    for (let d = 1; d < days; d++) {
      const list = edges.get(d) ?? [];
      const steps = [-1, 0, 1];
      rng.shuffle(steps);
      const cands = [...steps.map((x) => lane + x), ...list.filter(([a]) => Math.abs(a - lane) <= 1).map(([, b]) => b)]
        .filter((b) => b >= 0 && b < lanes && Math.abs(b - lane) <= 1);
      const next = cands.find((b) => !list.some(([a, e]) => crosses(lane, b, a, e))) ?? lane;
      if (!list.some(([a, b]) => a === lane && b === next)) list.push([lane, next]);
      edges.set(d, list);
      lane = next;
      mark(d + 1, lane);
    }
  }
  // 노드 만들기
  const nodes: MapNode[] = [];
  const idOf = new Map<string, number>();
  for (let d = 1; d <= days; d++) {
    for (let l = 0; l < lanes; l++) {
      if (!visited.has(`${d}:${l}`)) continue;
      idOf.set(`${d}:${l}`, nodes.length);
      nodes.push({ id: nodes.length, day: d, lane: l, kind: 'normal', env: 'normal', next: [] });
    }
  }
  for (const [d, list] of edges) for (const [a, b] of list) nodes[idOf.get(`${d}:${a}`)!].next.push(idOf.get(`${d + 1}:${b}`)!);
  for (const n of nodes) n.next.sort((x, y) => nodes[x].lane - nodes[y].lane);
  // 종류·환경 정하기: 줄마다 이미 쓴 (종류, 환경) 조합은 피해서 뽑는다
  const envW = M.envWeights as Record<EnvId, number>;
  for (let d = 1; d <= days; d++) {
    const row = nodes.filter((n) => n.day === d);
    const used = new Set<string>();
    const take = (n: MapNode, kindW: Partial<Record<NodeKind, number>>) => {
      const combos: [NodeKind, EnvId, number][] = [];
      for (const [k, kw] of Object.entries(kindW) as [NodeKind, number][]) for (const e of ENVS) combos.push([k, e, Math.max(0, kw) * Math.max(0, envW[e] ?? 0)]);
      const fresh = combos.filter(([k, e, w]) => w > 0 && !used.has(`${k}:${e}`));
      const pool = fresh.length ? fresh : combos.filter(([, , w]) => w > 0); // 조합이 모자라면 겹치게 둔다
      const [k, e] = pool.length ? pool[rng.weighted(pool.map(([, , w]) => w))] : (['normal', 'normal'] as [NodeKind, EnvId]);
      n.kind = k;
      n.env = e;
      used.add(`${k}:${e}`);
    };
    const special: NodeKind | null = d === R.finalBossDay ? 'final' : R.bossDays.includes(d) ? 'boss' : M.campfireDays.includes(d) ? 'campfire' : null;
    const safe = d > 1 && (M.safeDays ?? []).includes(d);
    const prevRow = safe ? nodes.filter((n) => n.day === d - 1) : [];
    // 안전 날: 어떤 전날 노드의 유일한 다음 노드에는 꼭 정하는 보스를 두지 않는다 (그 노드에서 갈 곳이 보스뿐이 된다)
    const soleNext = new Set(prevRow.filter((p) => p.next.length === 1).map((p) => p.next[0]));
    const pickable = special === 'boss' && safe ? row.filter((n) => !soleNext.has(n.id)) : row;
    const pickFrom = pickable.length ? pickable : row;
    // 모닥불: 전날 보스와 이어진 칸을 campfireBossWeight배 잘 뽑히게 (보스 뒤 휴식이 보통의 흐름이 되게, 항상은 아니게)
    const afterBoss = new Set(nodes.filter((n) => n.day === d - 1 && n.kind === 'boss').flatMap((n) => n.next));
    const pickW = pickFrom.map((n) => (special === 'campfire' && afterBoss.has(n.id) ? Math.max(0, M.campfireBossWeight ?? 1) : 1));
    const pick = special ? pickFrom[pickW.some((w) => w > 0) ? rng.weighted(pickW) : rng.int(pickFrom.length)] : null;
    if (pick) take(pick, { [special!]: 1 });
    const kindW = () => ({ ...M.kindWeights, ...(d < M.eliteFromDay ? { elite: 0 } : {}) }) as Partial<Record<NodeKind, number>>;
    for (const n of row) {
      if (n === pick) continue;
      if (d === 1 || d === R.finalBossDay) take(n, { normal: 1 });
      else {
        const w = kindW();
        if (special === 'boss') [w.boss, w.elite] = [w.elite ?? 0, 0]; // 보스 날의 엘리트 = 보스
        take(n, w);
      }
    }
    // 안전 날: 다음 노드가 모두 엘리트·보스인 전날 노드가 있으면, 그중 꼭 정한 보스가 아닌 하나를 엘리트·보스 없이 다시 뽑는다
    const hard = (n: MapNode) => n.kind === 'elite' || n.kind === 'boss';
    for (const p of prevRow) {
      const next = p.next.map((id) => nodes[id]);
      if (!next.length || !next.every(hard)) continue;
      const cands = next.filter((n) => n !== pick);
      if (!cands.length) continue; // 그 줄에 노드가 하나뿐이면 보스를 남긴다
      take(cands[rng.int(cands.length)], { ...kindW(), elite: 0, boss: 0 });
    }
  }
  return { lanes, nodes };
}

// 이 런에서 엘리트·보스가 일반 전투로 진행되는가 (연장 중)
// 9승 이후에도 엘리트·보스는 그대로다: 지도에서 길을 고른 것 자체가 선택이라, 마지막 날들이 세도 부당하지 않다
function effectiveKind(s: RunState, kind: NodeKind): NodeKind {
  if (s.extension.active) return kind === 'elite' || kind === 'boss' || kind === 'final' ? 'normal' : kind;
  return kind;
}

// 오늘 고를 수 있는 노드: 어제 고른 노드와 이어진 것 (지도가 처음이거나 어긋나면 오늘 줄 전체)
export function mapOptions(s: RunState): NodeOption[] {
  const map = s.map;
  if (!map) return [];
  const row = map.nodes.filter((n) => n.day === s.day);
  const prevId = s.mapPath?.[s.mapPath.length - 1];
  const prev = prevId !== undefined ? map.nodes[prevId] : undefined;
  const linked = prev && prev.day === s.day - 1 ? row.filter((n) => prev.next.includes(n.id)) : [];
  const list = (linked.length ? linked : row).sort((a, b) => a.lane - b.lane);
  return list.map((n) => {
    const kind = effectiveKind(s, n.kind);
    return { kind, env: n.env, mapId: n.id, ...(kind !== n.kind ? { mapKind: n.kind } : {}) };
  });
}

// 텍스트 지도 (터미널·에이전트용). 열 = 일차, 행 = 갈래. 글자 폭을 맞추려고 영문 기호를 쓴다.
// 지나온 노드는 [ ], 오늘 고를 수 있는 노드는 < >. 아래에 일차별 이어짐(갈래 → 다음 날 갈래)을 적는다
export const KIND_MARK: Record<NodeKind, string> = { normal: 'N', env: 'V', elite: 'E', boss: 'B', final: 'F', campfire: 'C', event: '?' };
export const ENV_MARK: Record<EnvId, string> = { normal: '-', hp: 'h', atk: 'a' };
export function mapText(s: RunState): string {
  const map = s.map;
  if (!map) return '지도가 아직 없습니다 (다음 날 시작할 때 만들어집니다).';
  const days = Math.max(...map.nodes.map((n) => n.day));
  const path = new Set(s.mapPath ?? []);
  const open = new Set(s.nodes.map((n) => n.mapId));
  const at = (d: number, l: number) => map.nodes.find((n) => n.day === d && n.lane === l);
  const cell = (n: MapNode | undefined) => {
    if (!n) return '    ';
    const body = `${KIND_MARK[n.kind]}${ENV_MARK[n.env]}`;
    return path.has(n.id) ? `[${body}]` : open.has(n.id) && n.day === s.day ? `<${body}>` : ` ${body} `;
  };
  const lines = [`일차  ${Array.from({ length: days }, (_, i) => String(i + 1).padStart(3) + ' ').join('')}`];
  for (let l = 0; l < map.lanes; l++) lines.push(`갈래${l + 1} ${Array.from({ length: days }, (_, i) => cell(at(i + 1, l))).join('')}`);
  lines.push('종류: N=일반 E=엘리트 B=보스 C=모닥불(라이프+1) ?=이벤트 F=최종 보스 / 환경: -=일반 h=체력 증가 a=공격 증가');
  lines.push('[ ] = 지나온 길, < > = 오늘 고를 수 있는 노드 (node 번호는 위 갈래부터 1, 2, ...)');
  lines.push('이어짐 (일차: 갈래→다음 날 갈래):');
  for (let d = Math.max(1, s.day); d < days; d++) {
    const row = map.nodes.filter((n) => n.day === d).sort((a, b) => a.lane - b.lane);
    lines.push(`  D${d}→${d + 1}: ${row.map((n) => `${n.lane + 1}→${n.next.map((id) => map.nodes[id].lane + 1).join('/')}`).join('  ')}`);
  }
  return lines.join('\n');
}
