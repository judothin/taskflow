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

// Special one-off achievements (not a tiered track). `allpets` is derived from
// the pet collection; the rest are activity achievements resolved from the DB
// (see SpecialBadgesContext) and passed in as flags.
export const SPECIAL_BADGES = [
  { key: 'allpets',      name: 'Collector',    tier: 'allpets',      img: RANK('allpets') },
  { key: 'firefighter',  name: 'Firefighter',  tier: 'firefighter',  img: RANK('firefighter'),  req: 'Clear 25 critical tasks' },
  { key: 'century',      name: 'Century',      tier: 'century',      img: RANK('century'),      req: '100 done in one month' },
  { key: 'speed-runner', name: 'Speed Runner', tier: 'speed-runner', img: RANK('speed-runner'), req: 'Finish within 10 min' },
  { key: 'clean-sweep',  name: 'Clean Sweep',  tier: 'clean-sweep',  img: RANK('clean-sweep'),  req: 'Zero open & in-progress' },
];

// Account-tenure ranks (how long they've had the account) — named so they
// read as membership length, not the user's real-life age.
// Months are approximated at 30 days, years exact at 365, so the whole ladder
// stays strictly ascending. `label` is the human requirement text.
export const AGE_BADGES = [
  { key: 'age1',    days: 1,    name: 'Newcomer',      label: '1 day',    img: RANK('1d') },
  { key: 'age5',    days: 5,    name: 'Rookie',        label: '5 days',   img: RANK('5d') },
  { key: 'age14',   days: 14,   name: 'Regular',       label: '2 weeks',  img: RANK('2w') },
  { key: 'age21',   days: 21,   name: 'Familiar',      label: '3 weeks',  img: RANK('3w') },
  { key: 'age30',   days: 30,   name: 'Member',        label: '1 month',  img: RANK('1m') },
  { key: 'age60',   days: 60,   name: 'Established',   label: '2 months', img: RANK('2m') },
  { key: 'age90',   days: 90,   name: 'Seasoned',      label: '3 months', img: RANK('3m') },
  { key: 'age120',  days: 120,  name: 'Committed',     label: '4 months', img: RANK('4m') },
  { key: 'age150',  days: 150,  name: 'Dedicated',     label: '5 months', img: RANK('5m') },
  { key: 'age180',  days: 180,  name: 'Devoted',       label: '6 months', img: RANK('6m') },
  { key: 'age210',  days: 210,  name: 'Trusted',       label: '7 months', img: RANK('7m') },
  { key: 'age240',  days: 240,  name: 'Reliable',      label: '8 months', img: RANK('8m') },
  { key: 'age270',  days: 270,  name: 'Stalwart',      label: '9 months', img: RANK('9m') },
  { key: 'age300',  days: 300,  name: 'Steadfast',     label: '10 months', img: RANK('10m') },
  { key: 'age330',  days: 330,  name: 'Loyal',         label: '11 months', img: RANK('11m') },
  { key: 'age365',  days: 365,  name: 'Veteran',       label: '1 year',   img: RANK('1y') },
  { key: 'age540',  days: 540,  name: 'Senior',        label: '18 months', img: RANK('18m') },
  { key: 'age730',  days: 730,  name: 'Elder',         label: '2 years',  img: RANK('2y') },
  { key: 'age900',  days: 900,  name: 'Distinguished', label: '30 months', img: RANK('30m') },
  { key: 'age1095', days: 1095, name: 'Venerable',     label: '3 years',  img: RANK('3y') },
  { key: 'age1260', days: 1260, name: 'Luminary',      label: '42 months', img: RANK('42m') },
  { key: 'age1460', days: 1460, name: 'Sage',          label: '4 years',  img: RANK('4y') },
  { key: 'age1620', days: 1620, name: 'Icon',          label: '54 months', img: RANK('54m') },
  { key: 'age1825', days: 1825, name: 'Legend',        label: '5 years',  img: '/ranks/5y-Photoroom%20(1).png' },
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
export function getRankBadges(level, createdAt, tasksDone = 0, pets = {}, specialFlags = {}) {
  const lvl = level || 1;
  const days = ageDaysSince(createdAt);
  const done = tasksDone || 0;
  const owned = pets.speciesOwned || 0;
  const totalSpecies = pets.speciesTotal || 0;

  const levelBadges = LEVEL_BADGES.map(b => ({
    ...b, kind: 'level', earned: lvl >= b.level, req: `Lv ${b.level}`, value: String(b.level),
    cur: lvl, target: b.level, unit: '',
  }));
  const ageBadges = AGE_BADGES.map(b => ({
    ...b, kind: 'age', earned: days >= b.days, req: b.label || dayLabel(b.days), value: b.label || dayLabel(b.days),
    cur: days, target: b.days, unit: 'd',
  }));
  const taskBadges = TASK_BADGES.map(b => ({
    ...b, kind: 'task', earned: done >= b.count, req: `${b.count} done`, value: String(b.count),
    cur: done, target: b.count, unit: '',
  }));
  const specialBadges = SPECIAL_BADGES.map(b => {
    if (b.key === 'allpets') {
      return {
        ...b, kind: 'special',
        earned: totalSpecies > 0 && owned >= totalSpecies,
        req: 'Collect every pet',
        value: totalSpecies ? `${owned}/${totalSpecies}` : '',
        cur: owned, target: totalSpecies, unit: '',
      };
    }
    return { ...b, kind: 'special', earned: !!specialFlags[b.key], req: b.req || '', value: '' };
  });

  const all = [...levelBadges, ...ageBadges, ...taskBadges, ...specialBadges];
  return {
    level: lvl, days, tasksDone: done, levelBadges, ageBadges, taskBadges, specialBadges,
    earnedCount: all.filter(b => b.earned).length,
    total: all.length,
  };
}
