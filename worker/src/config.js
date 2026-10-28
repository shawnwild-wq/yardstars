// Yard Stars — server-side economy and shop. All balance numbers live here.
export const ECON = {
  ENERGY_MAX: 100,
  ENERGY_REGEN_MS: 5 * 60 * 1000,      // +1 energy every 5 minutes (full 100 in ~8 h 20 min)
  GOAL_ENERGY: 10,                     // per daily goal (max 3 a day)
  LEVEL_ENERGY: 10,                    // per level up
  COIN_EARN_PER_MIN: 80,               // sanity cap for coins earned between saves
  COIN_EARN_SLACK: 600,
  STARTER_WINDOW_MS: 3 * 24 * 3600 * 1000,
  MAX_STATE_BYTES: 96 * 1024,
};

// Renovations: id -> seconds to build (prices are checked on the client; time is enforced here)
export const REPAIRS = {
  walls: 60, rug: 5 * 60, sofa: 15 * 60, lamp: 30 * 60, table: 45 * 60,
  shelf: 60 * 60, plant: 90 * 60, pictures: 2 * 3600, wardrobe: 3 * 3600, lights: 4 * 3600,
  // the street: yard, sports ground, cafe, park, market (8 each)
  y_bench: 600,
  y_sandbox: 900,
  y_swing: 1380,
  y_lamp: 2100,
  y_flowers: 3120,
  y_slide: 4740,
  y_tree: 7140,
  y_fountain: 10800,
  s_pullup: 1200,
  s_kettle: 1740,
  s_bench: 2580,
  s_mats: 3840,
  s_bag: 5640,
  s_tire: 8280,
  s_rack: 12240,
  s_board: 18000,
  c_table: 1800,
  c_plants: 2580,
  c_counter: 3660,
  c_coffee: 5220,
  c_showcase: 7440,
  c_oven: 10620,
  c_sign: 15120,
  c_lights: 21600,
  p_bench: 2700,
  p_flowers: 3780,
  p_lamp: 5280,
  p_pond: 7440,
  p_bridge: 10440,
  p_yoga: 14640,
  p_gazebo: 20520,
  p_statue: 28800,
  m_veg: 3600,
  m_fruit: 5160,
  m_bread: 7320,
  m_milk: 10440,
  m_fish: 14880,
  m_flowers: 21240,
  m_scale: 30300,
  m_arch: 43200,
};
// which place every renovation belongs to; a finished place gives 5 energy jars once
export const PLACE_OF = Object.fromEntries(Object.keys(REPAIRS).map((id) => [id, ({ y: 'yard', s: 'sport', c: 'cafe', p: 'park', m: 'market' })[id[1] === '_' ? id[0] : ''] || 'home']));
export const PLACE_JARS = 5;
export const REPAIR_NAMES = {
  walls: 'Новые стены и пол', rug: 'Мягкий ковёр', sofa: 'Диван', lamp: 'Торшер', table: 'Столик',
  shelf: 'Книжная полка', plant: 'Большой цветок', pictures: 'Картины', wardrobe: 'Шкаф', lights: 'Гирлянда',
  y_bench: "Скамейка",
  y_sandbox: "Песочница",
  y_swing: "Качели",
  y_lamp: "Фонарь",
  y_flowers: "Клумба",
  y_slide: "Горка",
  y_tree: "Дерево с домиком",
  y_fountain: "Фонтанчик",
  s_pullup: "Турник",
  s_kettle: "Гири",
  s_bench: "Скамья для жима",
  s_mats: "Маты",
  s_bag: "Боксёрская груша",
  s_tire: "Покрышка",
  s_rack: "Силовая рама",
  s_board: "Табло рекордов",
  c_table: "Столик под зонтом",
  c_plants: "Кадки с цветами",
  c_counter: "Стойка бариста",
  c_coffee: "Кофемашина",
  c_showcase: "Витрина с тортами",
  c_oven: "Печь для пиццы",
  c_sign: "Вывеска «У Шефа»",
  c_lights: "Гирлянда фонариков",
  p_bench: "Лавочка",
  p_flowers: "Розарий",
  p_lamp: "Фонари",
  p_pond: "Пруд с утками",
  p_bridge: "Мостик",
  p_yoga: "Площадка для йоги",
  p_gazebo: "Беседка",
  p_statue: "Статуя",
  m_veg: "Овощной лоток",
  m_fruit: "Фруктовый лоток",
  m_bread: "Хлебный лоток",
  m_milk: "Молочный лоток",
  m_fish: "Рыбный лоток",
  m_flowers: "Цветочный лоток",
  m_scale: "Большие весы",
  m_arch: "Арка «Рынок»",
};

// Shop. price in Telegram Stars (XTR).
export const SKUS = {
  starter: { title: 'Стартовый набор', desc: '300 монет, 20 банок энергии, 2 сундука и худи Yard Stars', stars: 50, once: true, starter: true,
             give: { coins: 300, jars: 20, chests: 2, items: ['top:ys_hoodie'] } },
  builder:  { title: 'Второй мастер', desc: 'Два ремонта одновременно — навсегда', stars: 300, once: true, give: {} },
  jars10:   { title: '10 банок энергии', desc: '+5 ⚡ каждая, хранятся без предела', stars: 20, give: { jars: 10 } },
  jars50:   { title: 'Выгодный набор энергии', desc: '50 банок (+250 ⚡) и сундук — в 2 раза выгоднее', stars: 60, give: { jars: 50, chests: 1 } },
  coinsS:   { title: '100 монет', desc: 'Горсть монет', stars: 25, give: { coins: 100 } },
  coinsM:   { title: '550 монет', desc: 'Мешочек монет (+10%)', stars: 100, give: { coins: 550 } },
  coinsL:   { title: '1200 монет', desc: 'Сундучок монет (+20%)', stars: 200, give: { coins: 1200 } },
  coinsXL:  { title: '3500 монет', desc: 'Сундук монет (+40%)', stars: 500, give: { coins: 3500 } },
  test:     { title: 'Проверка оплаты', desc: 'Тестовая покупка за 1 звезду', stars: 1, adminOnly: true, give: { coins: 10 } },
  // dynamic: speed:<repairId>, hero:<heroId>
};
// Heroes: 4 starters (one chosen at start, the rest are gifts at GIFT_LEVELS), others bought or built from shards.
export const HEROES = {
  trainer: 'starter', lifter: 'starter', office: 'starter', cat: 'starter',
  strongman: 'epic', muaythai: 'epic', coachf: 'rare', student: 'rare', zoomer: 'epic',
  kid: 'epic', chef: 'rare', dog: 'rare', hamster: 'rare', grandma: 'rare', yoga: 'epic',
};
export const HERO_NAMES = { trainer: 'Тренер', lifter: 'Лифтёр', office: 'Офисник', cat: 'Кот', strongman: 'Стронгмен', muaythai: 'Тайский боец',
  coachf: 'Тренер Лена', student: 'Студентка', zoomer: 'Зумер', kid: 'Ребёнок', chef: 'Шеф', dog: 'Пёс', hamster: 'Хомяк', grandma: 'Бабушка', yoga: 'Йог Мира' };
export const HERO_PRICE = { rare: 300, epic: 500 };
export const GIFT_LEVELS = [3, 6, 10];
export const SHARD_HEROES_PER_LEVELS = 4;     // at most one shard-built hero per 4 levels (anti-cheat cap)
export const TEAM_OPEN = [{ lvl: 1 }, { lvl: 10, stars: 300 }, { lvl: 20, stars: 600 }, { lvl: 30, stars: 900 }];
export const TEAM_SIZE = 5;

// Looks: price 0 = free base look. Others are bought once and kept forever.
export const LOOKS = {
  trainer: { t_a: 0, t_b: 75, t_c: 75, t_hero: 250, t_samurai: 250 },
  lifter: { l_plain: 0, l_bald: 75, l_hair: 75, l_hairbeard: 75, l_viking: 500, l_gold: 1000 },
  office: { o_a: 0, o_b: 75, o_c: 75, o_boss: 250, o_astro: 500 },
  cat: { c_a: 0, c_b: 75, c_c: 75, c_pirate: 250, c_knight: 500 },
  strongman: { strongman_a: 0, strongman_h1: 75, strongman_h2: 75, strongman_b: 250 }, muaythai: { muaythai_a: 0, muaythai_h1: 75, muaythai_h2: 75, muaythai_b: 250 }, coachf: { coachf_a: 0, coachf_h1: 75, coachf_h2: 75, coachf_b: 250 },
  student: { student_a: 0, student_h1: 75, student_h2: 75, student_b: 250 }, zoomer: { zoomer_a: 0, zoomer_h1: 75, zoomer_h2: 75, zoomer_b: 250 }, kid: { kid_a: 0, kid_h1: 75, kid_h2: 75, kid_b: 250 }, chef: { chef_a: 0, chef_h1: 75, chef_h2: 75, chef_b: 250 },
  dog: { dog_a: 0, dog_h1: 75, dog_h2: 75 }, hamster: { hamster_a: 0, hamster_h1: 75, hamster_h2: 75 }, grandma: { grandma_a: 0, grandma_h1: 75, grandma_h2: 75, grandma_b: 250 }, yoga: { yoga_a: 0, yoga_h1: 75, yoga_h2: 75, yoga_b: 250 },
};
export const LOOK_NAMES = {
  l_bald: 'Лысый', l_hair: 'С причёской', l_hairbeard: 'Причёска и борода', t_b: 'Блонд', t_c: 'Кудри и борода', t_hero: 'Супер-тренер', t_samurai: 'Сенсей', l_viking: 'Викинг', l_gold: 'Золотой чемпион',
  o_b: 'Гладко зачёсан', o_c: 'Лысина и борода', o_boss: 'Директор', o_astro: 'Астронавт', c_b: 'Серый кот', c_c: 'Чёрный кот', c_pirate: 'Пират', c_knight: 'Рыцарь',
  strongman_b: 'Турнир силачей', muaythai_b: 'Бой на стадионе', coachf_b: 'Марафон', student_b: 'Выпускной', zoomer_b: 'Звезда реков',
  kid_b: 'Юный учёный', chef_b: 'Банкет', grandma_b: 'Пироги', yoga_b: 'Вечерний уют',
  strongman_h1: 'Блондин', strongman_h2: 'Узел и усы',
  muaythai_h1: 'Блонд-ёжик', muaythai_h2: 'Коса',
  coachf_h1: 'Пикси', coachf_h2: 'Высокий хвост',
  student_h1: 'Каре и очки', student_h2: 'Розовая прядь',
  zoomer_h1: 'Синий маллет', zoomer_h2: 'Панамка',
  kid_h1: 'Кудряшки', kid_h2: 'Ирокез',
  chef_h1: 'Лысый с усами', chef_h2: 'Пучок и бородка',
  dog_h1: 'Далматинец', dog_h2: 'Чёрно-подпалый',
  hamster_h1: 'Белый', hamster_h2: 'Серый',
  grandma_h1: 'Пучок с цветком', grandma_h2: 'Сиреневая химия',
  yoga_h1: 'Серебряное каре', yoga_h2: 'Косички',
};
// Gear bought for Stars (gear for coins is handled by the game, coins are checked anyway).
export const GEAR_STARS = {
  'lifter:benchbelt': ['Пояс для жима', 100], 'lifter:stiffwraps': ['Кистевики жёсткие', 75], 'lifter:kneewraps': ['Коленные бинты', 100],
  'lifter:elbows': ['Налокотники', 75], 'lifter:dlshoes': ['Тяговые', 100],
  'trainer:clipboard': ['План тренировок', 75], 'office:headphones': ['Наушники', 75], 'cat:toyfish': ['Рыбка-игрушка', 75],
  'strongman:straps': ['Лямки', 75], 'muaythai:mongkon': ['Монгкон', 75], 'coachf:tracker': ['Фитнес-браслет', 75],
  'student:scarf': ['Шарф университета', 75], 'zoomer:ringlight': ['Кольцевая лампа', 75], 'kid:rocket': ['Ракета', 75],
  'chef:knife': ['Нож шефа', 75], 'dog:house': ['Будка', 75], 'hamster:ball': ['Шар для прогулок', 75],
  'grandma:jam': ['Варенье', 75], 'yoga:bowl': ['Поющая чаша', 75],
};
// Base appearance (hair, beard, fur): the first is free, the rest open with hero levels or for Stars; costumes are bought.
export const HAIR = {
  trainer: ['t_a', 't_b', 't_c'], lifter: ['l_plain', 'l_bald', 'l_hair', 'l_hairbeard'],
  office: ['o_a', 'o_b', 'o_c'], cat: ['c_a', 'c_b', 'c_c'],
  ...Object.fromEntries(['strongman', 'muaythai', 'coachf', 'student', 'zoomer', 'kid', 'chef', 'dog', 'hamster', 'grandma', 'yoga']
    .map((h) => [h, [h + '_a', h + '_h1', h + '_h2']])),
};
// hero level that opens each appearance for free (by its place in HAIR); earlier only for Stars
export const HAIR_LEVELS = [1, 5, 15, 25];
// costumes are shown and sold from this hero level, by price tier
export const costumeLevel = (stars) => (stars >= 1000 ? 30 : stars >= 500 ? 20 : 10);
export const HERO_MAX_LEVEL = 30;
export function lookInfo(id) {
  for (const [hero, L] of Object.entries(LOOKS)) if (id in L) return { hero, stars: L[id] };
  return null;
}

export function speedPrice(msLeft) {
  const min = Math.ceil(msLeft / 60000);
  return Math.max(5, Math.min(50, Math.ceil(min / 5)));
}

// Energy jars: kept in stock without a limit, +5 energy each; 2 come as a daily gift.
export const JAR_ENERGY = 5, DAILY_JARS = 2;
// Hero skills the server has to know (energy and build time). Value = per × hero level; works only for heroes in an open team.
export const SERVER_SKILLS = { trainer: ['regen', 0.01], strongman: ['build', 0.01], coachf: ['goalE', 0.2], yoga: ['levelE', 0.5] };
// Hero stars from extra shards: cost of each next star, skill grows +20% per star; at most 1 star per 5 player levels.
export const STAR_COST = [10, 20, 30, 40, 50];
export const STAR_SKILL = 0.2;
export const STARS_PER_LEVELS = 5;
// Neighbour help: each help cuts 10% of the build time (at least 2 min); 5 helps a day per player; helper gets a jar for up to 3 helps a day.
export const HELPS = { CUT: 0.1, MIN_MS: 2 * 60 * 1000, PER_DAY: 5, REWARD_PER_DAY: 3 };

// Free energy: claim twice a day (like TopHeroes «Получите бесплатно»)
export const FREE_ENERGY = 30, FREE_PER_DAY = 2;
// Daily shop for coins: refreshed every local day, limits per day
export const DSHOP = {
  jar:   { coins: 80,  lim: 3, title: 'Банка энергии' },
  chest: { coins: 150, lim: 2, title: 'Сундук' },
  shard: { coins: 120, lim: 2, title: 'Осколок героя' },
};
// Weekly shop for coins: 3 heroes rotate every week, shards of the chosen hero
export const WSHOP = { coins: 300, lim: 3, heroes: 3 };
