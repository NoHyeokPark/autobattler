// 조절용 수치는 모두 여기에 둔다. 코드에는 수치를 하드코딩하지 않는다.
// 시간 단위는 tick(정수)이며 1초 = ticksPerSec tick이다.
// 퍼센트는 정수 %, 배율은 정수 permille(1000 = 1.0배)로 적는다.

export const BALANCE = {
  // 전투 규칙이 바뀌면 올린다. 다른 버전의 기록과는 매칭하지 않는다.
  ruleVersion: 2,
  ticksPerSec: 10,

  engine: {
    // JS 정수 안전 범위(약 9천조) 안쪽에서 값을 잘라내는 안전 한도. 규칙 상한이 아니다.
    safeLimit: 1_000_000_000_000_000,
    // 행동 간격의 최솟값(tick). 0초 연사를 막는다.
    minIntervalTicks: 2,
    // 행동 1회당 추가발동 처리 상한(엔진 안전 한도).
    maxExtraActs: 200,
    // 서든데스로도 끝나지 않을 때의 강제 종료 시각(초). 남은 HP 비율로 판정한다.
    maxBattleSec: 300,
  },

  suddenDeath: {
    startSec: 60,
    baseDamage: 20,
    // 매 초 피해 = 이전 피해 × ratioNum / ratioDen (등비수열)
    ratioNum: 3,
    ratioDen: 2,
    bypassShield: true,
  },

  // 전투 밖으로 이어지는 능력(골드·장신구 획득)의 전투당 상한. 추가발동으로 폭주하지 않게 막는다.
  // 영구 강화는 전투당 상한 없음 (트리거 시점·수치로 조절)
  battleGains: {
    maxGoldPerBattle: 8,
    maxTrinketsPerBattle: 2,
  },

  board: {
    initialDeployLimit: 6, // 리더 포함
    maxDeploy: 9,
    benchSize: 6,
  },

  // 칸 효과 = 열 효과 + 행 효과. 행동 간격 보정끼리는 곱연산.
  slot: {
    col1: { stunTicks: 30, intervalPermille: 700 }, // 3초 기절 시작, 최종값에 별도 0.7배
    col2: { hpPctPerDeployed: 5 }, // 배치 인원 1명당 이 유닛 최대 체력 +5%
    col3: { intervalPermille: 1200 }, // 행동 간격 +20%, 시작 시 남은 대기 시간 0
    row1: { atkBonusByDay: [1, 1, 2, 2, 2, 3, 3, 3, 4, 4, 4, 5, 5, 5] }, // 1행 x값(일차별)
    row2: { healShieldPct: 10 },
    row3: { intervalPermille: 1500, extra: 1 },
  },

  // 일차가 지날수록 피해량(레벨업·스케일링)이 커지므로 양측 최대 체력을 같은 비율로 늘린다 (%, 1일차부터).
  // 시뮬레이터(npm run sim -- days)로 맞춘 값: 스케일링 없으면 전투 중앙값이 21초 → 11초로 줄고
  // 14일차 3초 내 종료가 11.6%였다. 이 값으로 평균 19~23초, 3초 내 종료 0~0.4%.
  scaling: {
    hpPctByDay: [100, 100, 100, 105, 110, 115, 125, 135, 155, 180, 205, 235, 265, 300],
  },

  env: {
    hp: { maxHpPct: 30 },
    atk: { atkBonusByDay: [2, 2, 3, 3, 4, 4, 5, 5, 6, 6, 7, 7, 8, 8] },
  },

  // 팀 단위 상태. 주기적 효과는 periodTicks마다 시스템 이벤트로 처리한다.
  // 강화(fury)와 가시(thorns)는 주기 효과 대신 엔진이 따로 처리한다 (설명: describeStatus)
  // maxHpLoss: 해로운 주기 피해가 최대 체력도 같이 줄인다 (이번 전투 동안)
  // 상호작용(erode): 이 상태가 터질 때마다(주기 효과) 같은 팀의 erodeStatus 중첩을 (이 상태 중첩 × erodePct%)만큼 줄인다 (내림).
  //   예) 화상 → 가시 50%: 화상 8이 터지면 그 팀의 가시 -4. 비우면() 상호작용 없음
  statuses: {
    poison: { name: '독', harmful: true, periodTicks: 10, perStack: 1, bypassShield: true, decay: 'none', erodeStatus: '', erodePct: 0, maxHpLoss: false },
    burn: { name: '화상', harmful: true, periodTicks: 10, perStack: 1, bypassShield: true, decay: 'minus1', erodeStatus: 'thorns', erodePct: 50, maxHpLoss: false },
    // 괴사: 피해만큼 최대 체력도 줄인다 (이번 전투 동안, 회복으로 못 되돌림). 회복 덱 견제. 실드에는 막힌다 (독과 반대)
    necrosis: { name: '괴사', harmful: true, periodTicks: 10, perStack: 1, bypassShield: false, decay: 'minus1', erodeStatus: '', erodePct: 0, maxHpLoss: true },
    regen: { name: '재생', harmful: false, periodTicks: 10, perStack: 1, bypassShield: false, decay: 'none', erodeStatus: '', erodePct: 0, maxHpLoss: false },
    fury: { name: '강화', harmful: false, periodTicks: 0, perStack: 1, bypassShield: false, decay: 'none', erodeStatus: '', erodePct: 0, maxHpLoss: false },
    // 희망: 주기 효과가 없는 자원. 쌓아 두었다가 "상태 소모" 효과로 써서 능력을 발동한다 (이로운 상태라 해주에 깎인다)
    hope: { name: '희망', harmful: false, periodTicks: 0, perStack: 1, bypassShield: false, decay: 'none', erodeStatus: '', erodePct: 0, maxHpLoss: false },
    thorns: { name: '가시', harmful: false, periodTicks: 0, perStack: 1, bypassShield: false, decay: 'none', erodeStatus: '', erodePct: 0, maxHpLoss: false },
  },

  unit: {
    mergeCount: 3,
    maxLevel: 3,
    levelStatPct: [100, 190, 360], // 몬스터 레벨별 체력·공격력·주문력 배율
    growthChoices: 3, // 레벨업 때 제시하는 성장 선택지 수 (전용 + 공용 성장 중 무작위)
    // 성장을 고르는 레벨. Lv3은 고르지 않고, 합성에 쓴 Lv2 3장의 성장을 모두 물려받는다.
    growthChoiceLevels: [2],
    growthRerolls: 1, // 성장 선택지 다시 뽑기 횟수 (선택 한 번마다)
  },

  leader: {
    levelUpDays: [4, 7, 10, 13],
    statPctPerLevel: 15, // 리더 레벨당 체력·공격력·주문력 +15%
    growthChoices: 3,
    // 전직(변신·본질 강화) 선택이 나오는 리더 레벨 (레벨업 일차 4·7·10·13 → Lv2·3·4·5). 이 레벨에서는 일반 성장 대신 전직만 제시한다.
    promotionLevels: [3],
    growthRerolls: 1, // 성장 선택지 다시 뽑기 횟수 (레벨업 한 번마다. 전직은 모두 나와 있어 없음)
  },

  economy: {
    startGold: 0,
    baseIncome: 10,
    interestPer: 10,
    interestMax: 5,
    rerollCost: 1,
    monsterCost: [1, 2, 3, 4, 5, 8, 10], // 일반·고급·희귀·영웅·전설·신화·기원
    sellPct: 100, // 판매가 = 구매가 × 합성에 쓴 장수 × sellPct%
    trinketCost: [4, 6, 8, 11, 14, 17, 0], // 기원은 상점에 나오지 않음 // 몬스터 레벨업보다 가성비가 나쁘게
    skipRewardGold: 4,
    skipEliteBonusGold: 4,
    skipBossRewardGold: 8,
  },

  shop: {
    slots: 6,
    maxTrinkets: 2,
    trinketChancePct: 15, // 칸마다 장신구가 나올 확률
    hideMaxLevelOwned: true, // 최고 레벨(Lv3)로 가진 몬스터는 상점에 나오지 않음 (한 유닛 도배 방지)
    // 상점 레벨 장신구는 확률표를 한 단계 앞당긴다(설계 후보 a).
    // 열: 일반, 고급, 희귀, 영웅, 전설, 신화, 기원. 행: 라운드(일차) 1~14
    odds: [
      [90, 10, 0, 0, 0, 0, 0],
      [84, 15, 1, 0, 0, 0, 0],
      [75, 20, 5, 0, 0, 0, 0],
      [64, 25, 10, 1, 0, 0, 0],
      [45, 35, 15, 5, 0, 0, 0],
      [29, 40, 20, 10, 1, 0, 0],
      [20, 35, 25, 15, 5, 0, 0],
      [20, 30, 25, 15, 10, 0, 0],
      [20, 28, 25, 15, 12, 0, 0],
      [20, 25, 25, 15, 15, 0, 0],
      [20, 23, 23, 17, 17, 0, 0],
      [20, 20, 20, 20, 20, 0, 0],
      [20, 20, 20, 20, 19, 1, 0],
      [20, 20, 20, 20, 19, 1, 0],
    ],
  },

  run: {
    maxDays: 14,
    winTarget: 10,
    lossLimit: 5,
    bossDays: [3, 6, 9, 12],
    finalBossDay: 14,
    // 보스 보상 장신구 등급 (3=희귀, 4=영웅, 5=전설, 6=신화, 7=기원)
    bossRewardGrade: { 3: 3, 6: 4, 9: 5, 12: 6 } as Record<number, number>,
    rewardChoices: 3, // 보상 선택지 수 (등급 하나를 뽑고 그 등급 장신구 중에서. 이벤트 떠돌이 몬스터도 이 수만큼)
    // 14일차(maxDays)가 시작될 때 남은 라이프(마지막 전투에 필요한 1개를 뺀 것) 하나당 골드
    spareLifeGold: 30,
  },

  // 런 지도 (슬레이 더 스파이어식): 일차마다 한 줄, 지난 노드에서 이어진 다음 노드 중 하나를 고른다
  map: {
    lanes: 4, // 갈래(열) 수
    paths: 6, // 지도를 만들 때 긋는 길 수 (많을수록 갈림길이 많다)
    campfireDays: [4, 7, 10, 13], // 모닥불이 선택지로 나오는 일차 (보스 다음 날)
    // 모닥불 칸을 뽑을 때 전날 보스와 이어진 칸의 가중치 배율 (1 = 차이 없음).
    // 보스→다음 날 모닥불 연결 비율: x1 ≈ 48%, x3 ≈ 64%, x5 ≈ 71%, x8 ≈ 75%, 상한(길 모양 한계) ≈ 85%
    campfireBossWeight: 8,
    eliteFromDay: 2, // 엘리트가 나오기 시작하는 일차
    safeDays: [6] as number[], // 이날로 갈 때는 어느 전날 노드에서든 엘리트·보스가 아닌 선택지가 하나 이상 있다
    // 보스·모닥불·최종 보스가 아닌 칸의 종류 비율 (1일차는 일반만, 14일차는 최종 보스 + 일반)
    kindWeights: { normal: 55, elite: 20, event: 25 },
    envWeights: { normal: 50, hp: 25, atk: 25 }, // 노드 환경 비율
  },

  // 모닥불 (슬레이 더 스파이어의 휴식·단련): 전투 뒤 보상 단계에서 휴식(라이프) 또는 단련(리더 능력치 하나) 중 하나
  campfire: {
    restLives: 1, // 휴식: 라이프 +
    train: { atk: 2, power: 5, hp: 100, haste: 10 }, // 단련: 고른 능력치 하나를 이만큼 영구히 (리더 레벨 배율과 별도로 더한다)
  },

  rank: {
    // 연장 승리 누적 보너스 (index = 연장 승수). 대안: [0, 1, 2, 4, 8]
    extensionBonus: [0, 1, 2, 3.5, 6],
    extensionLossScore: 4,
    championScore: 5,
    finalBossBonus: 1,
  },

  matching: {
    // 시드 봇은 실제 기록보다 약간 약하게: 매일 수입에서 이만큼 뺀다.
    seedBotIncomePenalty: 1,
    // 기록당 노출 횟수 상한(넘은 기록은 다른 후보가 있을 때 뽑지 않는다).
    exposureCap: 30,
  },
};

export type Balance = typeof BALANCE;
