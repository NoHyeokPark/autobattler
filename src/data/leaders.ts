import { T } from './targets.ts';
import type { GrowthDef, LeaderDef } from './types.ts';

// 통솔력(배치 인원 +1)은 모든 리더가 가진 성장 선택지다. 9칸이 가득 차면 나오지 않는다.
const command = (): GrowthDef => ({ id: 'command', name: '통솔력', desc: '배치 인원 +1', repeatable: true, deploy: 1 });

export const LEADERS: LeaderDef[] = [
  {
    id: 'knight', name: '기사', tags: ['전사'], hp: 140, atk: 8, intervalTicks: 20,
    triggers: [{ on: 'act', effects: [{ type: 'damage', atkPct: 100 }] }],
    desc: '균형 잡힌 전사형 리더. 인접 멤버 강화와 연속 공격으로 성장한다.',
    growth: [
      command(),
      { id: 'k_atk', name: '검술 단련', desc: '리더 공격력 +6', repeatable: true, stats: { atk: 6 } },
      {
        id: 'k_rally', name: '돌격 명령', desc: '전투 시작: 인접 멤버 공격력 +30%', repeatable: false,
        triggers: [{ on: 'battleStart', effects: [{ type: 'atkPct', target: T.adjacent(), pct: 30 }] }],
      },
      { id: 'k_haste', name: '신속', desc: '리더 행동 간격 -15%', repeatable: true, stats: { intervalPct: -15 } },
      { id: 'k_extra', name: '연속 베기', desc: '리더 추가발동 +1', repeatable: true, stats: { extra: 1 } },
      {
        id: 'k_oath', name: '전사의 맹세', desc: '전투 시작: 아군 전사 공격력 +25%', repeatable: false,
        triggers: [{ on: 'battleStart', effects: [{ type: 'atkPct', target: T.allies('전사'), pct: 25 }] }],
      },
      {
        id: 'k_veteran', name: '백전노장', desc: '전투 시작: 리더 공격력 영구 +2 (전투마다 쌓임)', repeatable: false,
        triggers: [{ on: 'battleStart', effects: [{ type: 'permanent', target: T.self(), stat: 'atk', amount: 2 }] }],
      },
      {
        id: 'k_beastmaster', name: '야수 조련', desc: '리더에 야수 태그 추가, 아래 아군 공격력 +40%', repeatable: false,
        addTags: ['야수'], form: true,
        triggers: [{ on: 'battleStart', effects: [{ type: 'atkPct', target: T.ally(['d']), pct: 40 }] }],
      },
    ],
  },
  {
    id: 'necro', name: '강령술사', tags: ['언데드', '마법'], hp: 110, atk: 5, power: 20, intervalTicks: 25,
    triggers: [
      { on: 'act', effects: [{ type: 'damage', atkPct: 100 }] },
      { on: 'act', effects: [{ type: 'status', status: 'poison', powerPct: 10, to: 'enemy' }] },
    ],
    desc: '독과 언데드를 다루는 리더. 장기전과 언데드 덱에 강하다.',
    growth: [
      command(),
      {
        id: 'n_plague', name: '역병', desc: '리더 행동 시 독 추가 (주문력 10%)', repeatable: true,
        triggers: [{ on: 'act', effects: [{ type: 'status', status: 'poison', powerPct: 10, to: 'enemy' }] }],
      },
      {
        id: 'n_lord', name: '죽음의 군주', desc: '전투 시작: 아군 언데드 공격력 +30%', repeatable: false,
        triggers: [{ on: 'battleStart', effects: [{ type: 'atkPct', target: T.allies('언데드'), pct: 30 }] }],
      },
      {
        id: 'n_curse', name: '쇠약의 저주', desc: '전투 시작: 상대 전체 공격력 -10%', repeatable: false,
        triggers: [{ on: 'battleStart', effects: [{ type: 'atkPct', target: T.enemies(), pct: -10 }] }],
      },
      { id: 'n_extra', name: '망령 소환', desc: '리더 추가발동 +1', repeatable: true, stats: { extra: 1 } },
      { id: 'n_bone', name: '뼈 갑옷', desc: '리더 체력 +70', repeatable: true, stats: { hp: 70 } },
      {
        id: 'n_lich', name: '리치화', desc: '기본 공격(능력 1)을 잃고 주문력 +100%', repeatable: false,
        removeTriggers: [0], stats: { powerPct: 100 }, form: true,
      },
    ],
  },
  {
    id: 'saint', name: '성녀', tags: ['성직'], hp: 120, atk: 6, power: 20, intervalTicks: 30,
    triggers: [{ on: 'act', effects: [{ type: 'heal', atkPct: 150 }, { type: 'shield', atkPct: 100 }] }],
    desc: '회복·실드 리더. 버티면서 서든데스와 장기전을 노린다.',
    growth: [
      command(),
      { id: 's_bless', name: '축복 강화', desc: '리더 회복·실드량 +30%', repeatable: true, stats: { healShieldPct: 30 } },
      {
        id: 's_spring', name: '생명의 샘', desc: '전투 시작: 아군 재생 (주문력 15%)', repeatable: true,
        triggers: [{ on: 'battleStart', effects: [{ type: 'status', status: 'regen', powerPct: 15, to: 'ally' }] }],
      },
      { id: 's_extra', name: '이중 기도', desc: '리더 추가발동 +1', repeatable: true, stats: { extra: 1 } },
      {
        id: 's_grace', name: '은총', desc: '전투 시작: 인접 멤버 행동 간격 -15%', repeatable: false,
        triggers: [{ on: 'battleStart', effects: [{ type: 'intervalPct', target: T.adjacent(), pct: -15 }] }],
      },
      {
        id: 's_crusade', name: '성전', desc: '전투 시작: 아군 강화 (주문력 10%)', repeatable: true,
        triggers: [{ on: 'battleStart', effects: [{ type: 'status', status: 'fury', powerPct: 10, to: 'ally' }] }],
      },
      { id: 's_wisdom', name: '지혜', desc: '리더 주문력 +50%', repeatable: true, stats: { powerPct: 50 } },
    ],
  },
];

export const LEADER_MAP: Record<string, LeaderDef> = Object.fromEntries(LEADERS.map((l) => [l.id, l]));

export function findGrowth(leaderId: string, growthId: string): GrowthDef | undefined {
  return LEADER_MAP[leaderId]?.growth.find((g) => g.id === growthId);
}

// 리더 외형(일러스트 형태) = 마지막으로 고른 외형 변화 성장
export function leaderForm(leaderId: string, growthIds: string[]): string | undefined {
  for (let i = growthIds.length - 1; i >= 0; i--) if (findGrowth(leaderId, growthIds[i])?.form) return growthIds[i];
  return undefined;
}
