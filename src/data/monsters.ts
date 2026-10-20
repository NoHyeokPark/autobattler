import { T } from './targets.ts';
import type { MonsterDef } from './types.ts';

// 몬스터 데이터. 행동 간격은 tick(10 tick = 1초).
// 레벨 배열 [Lv1, Lv2, Lv3]은 3장 합성으로 레벨이 오를 때 쓰는 값이다.
// 체력·공격력·주문력은 레벨 배율(balance.unit.levelStatPct)로 함께 오른다.
// growth: 이 몬스터 전용 성장 선택지 (레벨업 때 공용 성장과 섞여 제시된다)
export const MONSTERS: MonsterDef[] = [
  // ── 일반 (1원) ──
  {
    id: 'slime', name: '슬라임', grade: 1, tags: ['야수'], hp: 45, atk: 5, intervalTicks: 20,
    triggers: [{ on: 'act', effects: [{ type: 'damage', atkPct: 100 }] }],
    desc: '',
    growth: [
      {
        id: 'slime_jelly', name: '끈적이는 몸', desc: '새 능력: 행동 시 공격력 80% 실드', repeatable: false,
        triggers: [{ on: 'act', effects: [{ type: 'shield', atkPct: 80 }] }],
      },
    ],
  },
  {
    id: 'goblin', name: '고블린', grade: 1, tags: ['야수'], hp: 28, atk: 3, intervalTicks: 12,
    triggers: [{ on: 'act', effects: [{ type: 'damage', atkPct: 100 }] }],
    desc: '',
    growth: [
      {
        id: 'gob_gang', name: '패거리', desc: '새 능력: 전투 시작 시 인접 야수 공격력 +2', repeatable: false,
        triggers: [{ on: 'battleStart', effects: [{ type: 'atkFlat', target: T.adjacent('야수'), amount: 2 }] }],
      },
    ],
  },
  {
    id: 'skeleton', name: '해골 병사', grade: 1, tags: ['언데드'], hp: 35, atk: 6, intervalTicks: 22,
    triggers: [
      { on: 'battleStart', effects: [{ type: 'atkFlat', target: T.adjacent('언데드'), amount: [2, 4, 8] }] },
      { on: 'act', effects: [{ type: 'damage', atkPct: 100 }] },
    ],
    desc: '',
    growth: [
      { id: 'skel_knight', name: '망자의 기사', desc: '전사 태그 추가, 체력 +30%', repeatable: false, addTags: ['전사'], stats: { hpPct: 30 }, form: true },
    ],
  },
  {
    id: 'mushroom', name: '독버섯', grade: 1, tags: ['자연'], hp: 32, atk: 1, power: 10, intervalTicks: 20,
    triggers: [{ on: 'act', effects: [{ type: 'status', status: 'poison', powerPct: 10, to: 'enemy' }] }],
    desc: '',
    growth: [
      {
        id: 'mush_burst', name: '포자 폭발', desc: '새 능력: 전투 시작 시 상대에게 독 (주문력 30%)', repeatable: false,
        triggers: [{ on: 'battleStart', effects: [{ type: 'status', status: 'poison', powerPct: 30, to: 'enemy' }] }],
      },
    ],
  },
  {
    id: 'acolyte', name: '견습 사제', grade: 1, tags: ['성직'], hp: 30, atk: 5, intervalTicks: 30,
    triggers: [{ on: 'act', effects: [{ type: 'heal', atkPct: 150 }] }],
    desc: '',
    growth: [
      {
        id: 'aco_ward', name: '보호 기도', desc: '회복 능력을 잃고, 행동 시 공격력 220% 실드', repeatable: false,
        removeTriggers: [0],
        triggers: [{ on: 'act', effects: [{ type: 'shield', atkPct: 220 }] }],
      },
    ],
  },
  {
    id: 'squire', name: '견습 기사', grade: 1, tags: ['전사'], hp: 50, atk: 4, intervalTicks: 22,
    triggers: [{ on: 'act', effects: [{ type: 'damage', atkPct: 100 }, { type: 'shield', atkPct: 60 }] }],
    desc: '',
  },

  // 성장형: 처음엔 약하지만 전투마다 영구 강화가 쌓인다 (이기든 지든)
  {
    id: 'caterpillar', name: '애벌레', grade: 1, tags: ['야수'], hp: 26, atk: 2, intervalTicks: 22,
    triggers: [
      { on: 'battleStart', effects: [{ type: 'permanent', target: T.self(), stat: 'atk', amount: [1, 2, 3] }] },
      { on: 'act', effects: [{ type: 'damage', atkPct: 100 }] },
    ],
    desc: '',
  },
  // 경제형: 약한 대신 전투 후 골드를 준다
  {
    id: 'peddler', name: '행상 고블린', grade: 1, tags: ['야수'], hp: 24, atk: 2, intervalTicks: 25,
    triggers: [
      { on: 'battleStart', effects: [{ type: 'gold', amount: [1, 1, 2] }] },
      { on: 'act', effects: [{ type: 'damage', atkPct: 100 }] },
    ],
    desc: '',
  },

  // ── 희귀 (2원) ──
  {
    id: 'trainee', name: '수련생', grade: 2, tags: ['전사'], hp: 40, atk: 4, intervalTicks: 22,
    triggers: [
      { on: 'battleStart', effects: [{ type: 'permanent', target: T.adjacent(), stat: 'atk', amount: [1, 1, 2] }] },
      { on: 'act', effects: [{ type: 'damage', atkPct: 100 }] },
    ],
    desc: '',
  },
  {
    id: 'miner', name: '금광 드워프', grade: 2, tags: ['전사'], hp: 50, atk: 3, intervalTicks: 40,
    triggers: [{ on: 'act', effects: [{ type: 'damage', atkPct: 100 }, { type: 'gold', amount: 1 }] }],
    desc: '',
  },
  {
    id: 'wolf', name: '늑대', grade: 2, tags: ['야수'], hp: 42, atk: 6, intervalTicks: 15,
    triggers: [
      { on: 'battleStart', effects: [{ type: 'haste', target: T.adjacent('야수'), amount: [11, 18, 33] }] },
      { on: 'act', effects: [{ type: 'damage', atkPct: 100 }] },
    ],
    desc: '',
    growth: [
      {
        id: 'wolf_alpha', name: '우두머리', desc: '인접 가속 능력을 잃고, 주변 8칸 야수 가속 +14/22/33', repeatable: false,
        removeTriggers: [0],
        triggers: [{ on: 'battleStart', effects: [{ type: 'haste', target: T.around('야수'), amount: [14, 22, 33] }] }],
      },
    ],
  },
  {
    id: 'shieldbearer', name: '방패병', grade: 2, tags: ['전사'], hp: 70, atk: 4, intervalTicks: 30,
    triggers: [{ on: 'act', effects: [{ type: 'shield', atkPct: 300 }] }],
    desc: '',
  },
  {
    id: 'bats', name: '박쥐 떼', grade: 2, tags: ['야수'], hp: 26, atk: 3, intervalTicks: 20, extra: 1,
    triggers: [{ on: 'act', effects: [{ type: 'damage', atkPct: 100 }] }],
    desc: '',
  },
  {
    id: 'smith', name: '대장장이', grade: 2, tags: ['전사'], hp: 45, atk: 3, intervalTicks: 30,
    triggers: [{
      on: 'act', effects: [
        { type: 'damage', atkPct: 100 },
        { type: 'atkFlat', target: T.adjacent(), amount: [1, 2, 4] },
      ],
    }],
    desc: '행동: 100% 피해, 인접 아군 공격력 영구 +1/2/4 (스케일링).',
    growth: [
      {
        id: 'smith_line', name: '명장', desc: '강화 대상이 인접 → 같은 행 아군 전체로 바뀜', repeatable: false,
        removeTriggers: [0],
        triggers: [{
          on: 'act', effects: [
            { type: 'damage', atkPct: 100 },
            { type: 'atkFlat', target: { side: 'ally', area: 'sameRow', excludeSelf: true }, amount: [1, 2, 4] },
          ],
        }],
      },
    ],
  },
  {
    id: 'hexer', name: '저주술사', grade: 2, tags: ['마법'], hp: 35, atk: 6, intervalTicks: 25,
    triggers: [
      { on: 'battleStart', effects: [{ type: 'atkPct', target: T.mirror(), pct: [-30, -45, -70] }] },
      { on: 'act', effects: [{ type: 'damage', atkPct: 100 }] },
    ],
    desc: '',
    growth: [
      {
        id: 'hex_cross', name: '십자 저주', desc: '새 능력: 전투 시작 시 대칭 위치 상하좌우 상대 공격력 -20%', repeatable: false,
        triggers: [{ on: 'battleStart', effects: [{ type: 'atkPct', target: T.enemy(['u', 'd', 'l', 'r']), pct: -20 }] }],
      },
    ],
  },
  {
    id: 'ghoul', name: '구울', grade: 2, tags: ['언데드'], hp: 55, atk: 5, intervalTicks: 20,
    triggers: [{ on: 'act', effects: [{ type: 'damage', atkPct: 100 }, { type: 'heal', atkPct: 40 }] }],
    desc: '',
  },

  // ── 에픽 (3원) ──
  {
    id: 'ogre', name: '오우거', grade: 3, tags: ['야수'], hp: 130, atk: 28, intervalTicks: 50,
    triggers: [{ on: 'act', effects: [{ type: 'damage', atkPct: 100 }] }],
    desc: '행동: 100% 피해. 느리지만 강하다.',
    growth: [
      {
        id: 'ogre_frenzy', name: '광분', desc: '기본 공격을 잃고, 행동 시 공격력 70% 피해를 두 번', repeatable: false,
        removeTriggers: [0],
        triggers: [{ on: 'act', effects: [{ type: 'damage', atkPct: 70 }, { type: 'damage', atkPct: 70 }] }],
      },
    ],
  },
  {
    id: 'plague', name: '역병 술사', grade: 3, tags: ['언데드'], hp: 50, atk: 2, power: 30, intervalTicks: 20,
    triggers: [{ on: 'act', effects: [{ type: 'status', status: 'poison', powerPct: 10, to: 'enemy' }] }],
    desc: '',
    growth: [
      {
        id: 'plague_carrier', name: '역병 보균자', desc: '언데드 태그를 잃고 자연 태그를 얻음, 주문력 +30%', repeatable: false,
        removeTags: ['언데드'], addTags: ['자연'], stats: { powerPct: 30 }, form: true,
      },
    ],
  },
  {
    id: 'bard', name: '음유시인', grade: 3, tags: ['성직'], hp: 45, atk: 0, power: 10, intervalTicks: 40,
    triggers: [{ on: 'act', effects: [{ type: 'status', status: 'fury', powerPct: 10, to: 'ally' }] }],
    desc: '행동: 아군에 강화 (주문력 10%). 강화 1당 모든 공격 피해 +1.',
  },
  {
    id: 'frost', name: '얼음 마법사', grade: 3, tags: ['마법'], hp: 40, atk: 10, intervalTicks: 30,
    triggers: [
      { on: 'timer', atSec: 10, effects: [{ type: 'stun', target: { side: 'enemy', area: 'sameRow' }, ticks: [20, 30, 50] }] },
      { on: 'act', effects: [{ type: 'damage', atkPct: 100 }] },
    ],
    desc: '',
    growth: [
      {
        id: 'frost_blizzard', name: '눈보라', desc: '10초 기절 대상이 같은 행 → 상대 전체 (기절 시간 절반)', repeatable: false,
        removeTriggers: [0],
        triggers: [{ on: 'timer', atSec: 10, effects: [{ type: 'stun', target: T.enemies(), ticks: [10, 15, 25] }] }],
      },
    ],
  },
  {
    id: 'guardian', name: '수호 정령', grade: 3, tags: ['자연'], hp: 70, atk: 0, intervalTicks: 100,
    triggers: [{ on: 'timer', atSec: 8, effects: [{ type: 'shield', flat: [150, 300, 600] }] }],
    desc: '8초: 실드 150/300/600 (행동하지 않음).',
  },
  {
    id: 'tortoise', name: '고대 거북', grade: 3, tags: ['자연'], hp: 90, atk: 3, intervalTicks: 40,
    triggers: [
      { on: 'battleStart', effects: [{ type: 'permanent', target: T.self(), stat: 'hp', amount: [8, 15, 30] }] },
      { on: 'act', effects: [{ type: 'shield', hpPct: 12 }] },
    ],
    desc: '',
  },
  {
    id: 'treasure', name: '보물 사냥꾼', grade: 3, tags: ['야수'], hp: 45, atk: 6, intervalTicks: 30,
    triggers: [
      { on: 'battleStart', effects: [{ type: 'trinket', grade: [1, 1, 2], count: 1 }] },
      { on: 'act', effects: [{ type: 'damage', atkPct: 100 }] },
    ],
    desc: '',
  },
  {
    id: 'monk', name: '수도승', grade: 3, tags: ['전사'], hp: 55, atk: 6, intervalTicks: 18,
    triggers: [{
      on: 'act', effects: [
        { type: 'damage', atkPct: 100 },
        { type: 'haste', target: T.self(), amount: [3, 4, 6] },
      ],
    }],
    desc: '행동: 100% 피해, 자신 가속 +3/4/6 (전투 중 누적).',
  },

  // ── 전설 (4원) ──
  {
    id: 'berserker', name: '광전사', grade: 4, tags: ['전사'], hp: 80, atk: 10, intervalTicks: 18,
    triggers: [{
      on: 'act', effects: [
        { type: 'damage', atkPct: 100 },
        { type: 'atkFlat', target: T.self(), amount: [2, 4, 8] },
      ],
    }],
    desc: '행동: 100% 피해, 자신 공격력 영구 +2/4/8.',
  },
  {
    id: 'lich', name: '리치', grade: 4, tags: ['언데드', '마법'], hp: 70, atk: 16, power: 20, intervalTicks: 30,
    triggers: [
      { on: 'battleStart', effects: [{ type: 'atkPct', target: T.allies('언데드'), pct: [30, 50, 90] }] },
      { on: 'act', effects: [{ type: 'damage', atkPct: 100 }] },
    ],
    desc: '',
    growth: [
      {
        id: 'lich_touch', name: '죽음의 손길', desc: '새 능력: 행동 시 상대에게 독 (주문력 15%)', repeatable: false,
        triggers: [{ on: 'act', effects: [{ type: 'status', status: 'poison', powerPct: 15, to: 'enemy' }] }],
      },
    ],
  },
  {
    id: 'priest', name: '대사제', grade: 4, tags: ['성직'], hp: 75, atk: 10, power: 20, intervalTicks: 35,
    triggers: [{
      on: 'act', effects: [
        { type: 'heal', atkPct: 200 },
        { type: 'status', status: 'regen', powerPct: 10, to: 'ally' },
      ],
    }],
    desc: '',
  },
  {
    id: 'assassin', name: '그림자 암살자', grade: 4, tags: ['전사'], hp: 45, atk: 13, intervalTicks: 25, extra: 1,
    triggers: [{ on: 'act', effects: [{ type: 'damage', atkPct: 100 }] }],
    desc: '',
  },
  {
    id: 'sage', name: '현자', grade: 4, tags: ['마법'], hp: 55, atk: 4, power: 20, intervalTicks: 35,
    triggers: [
      { on: 'battleStart', effects: [{ type: 'permanent', target: T.allies('마법'), stat: 'power', amount: [2, 4, 8] }] },
      { on: 'act', effects: [{ type: 'damage', atkPct: 100, powerPct: 60 }] },
    ],
    desc: '',
  },
  {
    id: 'treant', name: '고목 정령', grade: 4, tags: ['자연'], hp: 160, atk: 6, intervalTicks: 30,
    triggers: [
      { on: 'battleStart', effects: [{ type: 'maxHpPct', pct: [8, 15, 30] }] },
      { on: 'act', effects: [{ type: 'shield', atkPct: 200 }] },
    ],
    desc: '',
  },

  // ── 신화 (5원) ──
  {
    id: 'dragon', name: '드래곤', grade: 5, tags: ['야수'], hp: 200, atk: 120, intervalTicks: 200,
    triggers: [{ on: 'act', effects: [{ type: 'damage', atkPct: 100 }] }],
    desc: '행동 간격 20초의 한방 유닛. 행동: 100% 피해.',
  },
  {
    id: 'worldtree', name: '세계수', grade: 5, tags: ['자연'], hp: 260, atk: 8, power: 30, intervalTicks: 40,
    triggers: [{
      on: 'act', effects: [
        { type: 'heal', atkPct: 300 },
        { type: 'status', status: 'regen', powerPct: 10, to: 'ally' },
      ],
    }],
    desc: '',
  },
  {
    id: 'chrono', name: '시간술사', grade: 5, tags: ['마법'], hp: 60, atk: 8, intervalTicks: 40,
    triggers: [
      { on: 'battleStart', effects: [{ type: 'extra', target: T.adjacent(), amount: [1, 1, 2] }] },
      { on: 'act', effects: [{ type: 'damage', atkPct: 100 }] },
    ],
    desc: '',
  },
  {
    id: 'warlord', name: '전쟁군주', grade: 5, tags: ['전사'], hp: 120, atk: 15, intervalTicks: 25,
    triggers: [
      { on: 'battleStart', effects: [{ type: 'atkPct', target: T.allies('전사'), pct: [30, 50, 90] }] },
      { on: 'act', effects: [{ type: 'damage', atkPct: 100 }] },
    ],
    desc: '',
  },

  // ── 기원 (13라운드 이후 극저확률) ──
  {
    id: 'primordial', name: '태초의 군주', grade: 6, tags: ['야수', '전사'], hp: 400, atk: 40, intervalTicks: 25, extra: 2,
    triggers: [
      { on: 'battleStart', effects: [{ type: 'atkPct', target: T.allies(), pct: [50, 80, 150] }] },
      { on: 'act', effects: [{ type: 'damage', atkPct: 100 }] },
    ],
    desc: '',
  },
  // 거울 정령: 같은 칸의 상대가 행동할 때마다 그 행동을 내 능력치로 따라 한다 (추가발동도 하나하나). 상대 배치가 곧 내 능력
  {
    id: 'mirror_spirit', name: '거울 정령', grade: 7, shop: false, tags: [], hp: 260, atk: 24, power: 24, intervalTicks: 40,
    triggers: [{ on: 'react', watch: { side: 'enemy', area: 'near', dirs: ['c'] }, effects: [{ type: 'mimic' }] }],
    desc: '',
    lines: { detail: '네가 무엇을 하든, 나도 똑같이.' },
  },
  // 지휘자: 상점에 나오는 기원. 전투 시작에 주변 8칸에서 "자기 주변에 같은 태그가 없는" 유닛을 행동시키고,
  // 그 수만큼 보상 (골드, 3명마다 고급 장신구, 8명이면 황금 지휘봉). 태그를 엇갈려 놓는 배치 퍼즐 덱
  {
    id: 'conductor', name: '지휘자', grade: 7, tags: [], hp: 220, atk: 10, intervalTicks: 40,
    deploy: 1, // 보드에 있으면 배치 인원 +1: 자기 자리를 스스로 채워 8명 연주를 노리기 쉽게
    triggers: [{
      on: 'battleStart', say: '자, 모두의 소리를 들려줘.',
      effects: [{ type: 'conduct', target: { side: 'ally', area: 'near', dirs: ['u', 'd', 'l', 'r', 'ul', 'ur', 'dl', 'dr'] }, uniqueTag: true, goldPer: 1, trinketGrade: 2, trinketPer: 3, perfect: 8, perfectTrinket: 'golden_baton' }],
    }],
    desc: '',
    lines: { buy: '공연을 시작하지.', detail: '같은 소리는 둘이 필요 없어. 각자의 소리를 내.' },
  },
];

export const MONSTER_MAP: Record<string, MonsterDef> = Object.fromEntries(MONSTERS.map((m) => [m.id, m]));
