// ============================================================
// Pet badges — awards a pet earns by leveling up and by age.
// Purely derived from pet.level and pet.created_at (no DB).
// ============================================================

const RANK = (f) => `/ranks/${f}-Photoroom.png`;

export const LEVEL_BADGES = [
  { key: 'lvl5',   level: 5,   name: 'Bronze',      tier: 'bronze',     img: RANK('lvl5') },
  { key: 'lvl10',  level: 10,  name: 'Silver',      tier: 'silver',     img: RANK('lvl10') },
  { key: 'lvl20',  level: 20,  name: 'Gold',        tier: 'gold',       img: RANK('lvl20') },
  { key: 'lvl30',  level: 30,  name: 'Platinum',    tier: 'platinum',   img: RANK('lvl30') },
  { key: 'lvl40',  level: 40,  name: 'Diamond',     tier: 'diamond',    img: RANK('lvl40') },
  { key: 'lvl50',  level: 50,  name: 'Champion',    tier: 'champion',   img: RANK('lvl50') },
  { key: 'lvl70',  level: 70,  name: 'Grand Champ', tier: 'grandchamp', img: RANK('lvl70') },
  { key: 'lvl100', level: 100, name: 'Supreme',     tier: 'supreme',    img: RANK('lvl100') },
];

// Task-achievement ranks — by total tasks the user has completed.
const TASK_THRESHOLDS = [5, 15, 30, 50, 100, 125, 150, 175, 200, 250, 300, 400, 500, 700, 1000];
export const TASK_BADGES = TASK_THRESHOLDS.map(n => ({
  key: `task${n}`, count: n, name: `${n} Tasks`, tier: `task${n}`, img: RANK(`${n}t`),
}));

// Account-tenure ranks (how long they've had the account) — named so they
// read as membership length, not the user's real-life age.
export const AGE_BADGES = [
  { key: 'age1',    days: 1,    name: 'Newcomer',  tier: 'newborn',    img: RANK('1d') },
  { key: 'age5',    days: 5,    name: 'Rookie',    tier: 'baby',       img: RANK('5d') },
  { key: 'age14',   days: 14,   name: 'Regular',   tier: 'toddler',    img: RANK('2w') },
  { key: 'age21',   days: 21,   name: 'Member',    tier: 'preteen',    img: RANK('3w') },
  { key: 'age30',   days: 30,   name: 'Committed', tier: 'teen',       img: RANK('1m') },
  { key: 'age60',   days: 60,   name: 'Seasoned',  tier: 'youngadult', img: RANK('2m') },
  { key: 'age90',   days: 90,   name: 'Devoted',   tier: 'adult',      img: RANK('3m') },
  { key: 'age150',  days: 150,  name: 'Stalwart',  tier: 'elder',      img: RANK('5m') },
  { key: 'age365',  days: 365,  name: 'Veteran',   tier: 'ancient',    img: RANK('1y') },
  { key: 'age1825', days: 1825, name: 'Legend',    tier: 'immortal',   img: RANK('5y') },
];

export function ageDaysSince(createdAt) {
  if (!createdAt) return 0;
  return Math.max(0, Math.floor((Date.now() - new Date(createdAt).getTime()) / 86400000));
}

function dayLabel(d) {
  if (d >= 365) return `${Math.round(d / 365)}y`;
  if (d >= 30)  return `${Math.round(d / 30)}mo`;
  if (d >= 7)   return `${Math.round(d / 7)}w`;
  return `${d}d`;
}

// Ranks are a USER thing: level badges from the user's level, age badges from
// how long the account has existed, task badges from tasks completed. Returns
// all three lists (each flagged `earned`) plus earned/total counts.
export function getRankBadges(level, createdAt, tasksDone = 0) {
  const lvl = level || 1;
  const days = ageDaysSince(createdAt);
  const done = tasksDone || 0;

  const levelBadges = LEVEL_BADGES.map(b => ({
    ...b, kind: 'level', earned: lvl >= b.level, req: `Lv ${b.level}`, value: String(b.level),
  }));
  const ageBadges = AGE_BADGES.map(b => ({
    ...b, kind: 'age', earned: days >= b.days, req: dayLabel(b.days), value: dayLabel(b.days),
  }));
  const taskBadges = TASK_BADGES.map(b => ({
    ...b, kind: 'task', earned: done >= b.count, req: `${b.count} done`, value: String(b.count),
  }));

  const all = [...levelBadges, ...ageBadges, ...taskBadges];
  return {
    level: lvl, days, tasksDone: done, levelBadges, ageBadges, taskBadges,
    earnedCount: all.filter(b => b.earned).length,
    total: all.length,
  };
}
