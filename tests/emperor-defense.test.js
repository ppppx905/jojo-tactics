/**
 * ★★ 2026-10-05 用户拍板：**霍尔·霍斯（皇帝）的基础防御 2 → 1**。
 *
 * 用户口径（逐字）：只降他**基础防御**这 1 点，**其它数值一个都不许动**
 * （hp 40 / 移动 2 / 射程 5 / 攻击 7 / `solo` / `standName` / `sniper` / `kite` 全部保持），
 * 技能（瞄准／暗枪／皇帝）的数值与顺序也一个字不动。
 *
 * ⚠️ 连带影响**只有一处**（别漏）：第八章阶段 1 那条**幕级加成**是 `buff: { atk: 4, def: 2 }`
 *    ——加成本身照旧，变的是**基数**，所以他**那一场**的实际基础防御从 4 变成 **3**（1 + 2）。
 *    第一幕 `specialRules` 里写死的玩家可见文案「攻击 11、防御 4」已跟着改成「防御 3」。
 *
 * 这个文件是**新增**的，按验收标准 ①–④ 逐条守这次改动：
 *   ① `FIGHTERS.emperor.def === 1`，而且**其余字段逐值未变**（整份快照比对）；
 *   ② 实战口径：打他时按 1 点防御结算，`preview()` 与 `defense()` 逐值一致；
 *   ③ 第八章阶段 1 的幕级加成仍然生效、他那一场是 **1 + 2 = 3**，文案里写的也是 3；
 *   ④ 别的角色防御**一个都没变**（遍历全部 14 个角色 + 指纹基线对照）。
 *
 * ⚠️ 不重复既有覆盖：他的技能与旗标在 `emperor-skills.test.js` / `cutin-third-skill.test.js`、
 *    两阶段剧情在 `chapter8-phases.test.js` / `chapter8-scripted-loss.test.js`、
 *    冷枪在 `sniper.test.js`。这里只守"防御 −1"这一条改动的四个面。
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { Game, FIGHTERS, STORY_CHAPTERS } from '../src/core/game.js';
import { tileKey, hexDist } from '../src/core/hex.js';

function seeded(seed = 13) { return () => ((seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0) / 4294967296); }

const chapter8 = STORY_CHAPTERS.find(c => c.id === 'chapter-8');
/** 阶段 1（波鲁纳雷夫 单挑 皇帝）——**按阵容认**，不写死下标。 */
const phase1 = chapter8.scenes.find(scene => scene.kind === 'battle' && scene.lineup?.enemy === 'emperor');

/**
 * ① 改完之后他的**整份数据**（逐字段、逐嵌套对象）。
 * ⚠️ 写的是"改完应该长的样子"，所以 `def` 是 **1**——它同时钉住两件事：
 *    改对了那一个数、以及**别的字段一个都没被顺手改掉**（deepEqual 连多一个字段都挡得住）。
 */
const EMPEROR_SNAPSHOT = {
  key: 'emperor',
  label: '霍尔·霍斯 & 皇帝',
  solo: true,
  hp: 40,
  def: 1,
  distLimit: 0,
  standDefBonus: 0,
  standName: '皇帝',
  user: {
    name: '霍尔·霍斯', tag: '替身使者', emoji: '🤠', color: '#c8a24a',
    move: 2, range: 5, dmg: 7, sniper: true, kite: true,
  },
  stand: null,
};

/** ④ 全部 14 个角色的防御（改完之后的口径：**只有 emperor 是 1**，其余照旧都是 2）。 */
const DEF_BASELINE = {
  jotaro: 2, dio: 2, temperance: 2, geil: 2, emperor: 1, kakyoin: 2, avdol: 2,
  polnareff: 2, joseph: 2, iggy: 2, josuke: 2, gray_fly: 2, fake_captain: 2, forever: 2, ebony: 2,
};

/**
 * 找一格"干净地"：自己与六邻居都没有地形（草丛／岩石／恢复点／毒沼），
 * 也没有柱子与棋子——这样 `defense()` 里**只剩基础防御那一项**，数得清清楚楚。
 */
function cleanSpot(game, skip = []) {
  const taken = new Set(skip.filter(Boolean).map(tileKey));
  return game.tiles.find(t => !taken.has(tileKey(t))
    && !game.occupant(t) && !game.pillarAt(t) && !game.s.terrain[tileKey(t)]
    && game.near(t).every(n => !game.occupant(n) && !game.pillarAt(n) && !game.s.terrain[tileKey(n)]));
}

// ===================== ① 基础防御＝1，其余逐值未变 =====================

test('① 基础防御 2 → 1，其余字段逐值未变（整份快照比对）', () => {
  assert.equal(FIGHTERS.emperor.def, 1, '★★ 用户拍板：他的基础防御是 1');
  // 整份快照：既钉住"该变的变了"，也钉住"不该变的没动"（少一个字段、多一个字段都会红）
  assert.deepEqual(FIGHTERS.emperor, EMPEROR_SNAPSHOT, '★ 除 def 之外，他的数据一个字都没动');
  // 用户点名"一个都不许动"的那几个数再单独念一遍（快照红了也能一眼看出是谁）
  assert.equal(FIGHTERS.emperor.hp, 40, '血 40 照旧');
  assert.equal(FIGHTERS.emperor.solo, true, '仍是单单位');
  assert.equal(FIGHTERS.emperor.stand, null, '皇帝不单独占棋子');
  assert.equal(FIGHTERS.emperor.standName, '皇帝', '替身名照旧');
  assert.equal(FIGHTERS.emperor.distLimit, 0, '连携距离照旧');
  assert.equal(FIGHTERS.emperor.standDefBonus, 0, '替身防御加成照旧');
  assert.equal(FIGHTERS.emperor.user.move, 2, '移动 2 照旧');
  assert.equal(FIGHTERS.emperor.user.range, 5, '射程 5 照旧');
  assert.equal(FIGHTERS.emperor.user.dmg, 7, '攻击 7 照旧');
  // ⚠️ 两个旗标也没被碰到（用户点名不许动）
  assert.equal(FIGHTERS.emperor.user.sniper, true, '★ `sniper` 旗标照旧');
  assert.equal(FIGHTERS.emperor.user.kite, true, '★ `kite` 旗标照旧');
  assert.equal(FIGHTERS.emperor.boss, undefined, '仍不是 boss（照旧进选人列表）');
});

test('① 技能表也没被碰到：三个技能、顺序照旧，数值逐值未变', () => {
  const game = new Game({ random: seeded(13) });
  assert.equal(game.start('emperor', 'polnareff', 'ai'), true);
  assert.deepEqual(game.skills('p1'), ['aim', 'darkgun', 'emperor'],
    '★ 技能与顺序一个字没动（「暗枪」第二、「皇帝」第三）');
});

// ===================== ② 实战口径：按 1 点防御结算 =====================

test('② 打他时按 1 点防御结算，而且 preview() 与 defense() 逐值一致', () => {
  const game = new Game({ random: seeded(13) });
  assert.equal(game.start('polnareff', 'emperor', 'ai'), true);
  const emperor = game.s.units.find(u => u.slot === 'p2' && u.kind === 'user');
  const blade = game.s.units.find(u => u.slot === 'p1' && u.kind === 'stand');
  const own = game.s.units.find(u => u.slot === 'p1' && u.kind === 'user');

  // 把他摆到一格干净地上、波波的替身站到他旁边（这样防御里只剩基础那一项）
  const spot = cleanSpot(game, [game.tile(blade), game.tile(own)]);
  assert.ok(spot, '（前提）棋盘上要有一格干净地');
  Object.assign(emperor, { row: spot.row, col: spot.col });
  const beside = game.near(spot).find(n => !game.occupant(n) && !game.pillarAt(n) && !game.s.terrain[tileKey(n)]);
  assert.ok(beside, '（前提）旁边要有一格能站人');
  Object.assign(blade, { row: beside.row, col: beside.col });

  // 基础防御就是 1（没有草丛／岩石／柱子／替身加成掺进来）
  assert.equal(game.baseDefense('p2'), 1, '★★ 他的基础防御是 1');
  assert.deepEqual(game.defense(emperor), { base: 1, stand: 0, bush: 0, rock: 0, pillar: 0, total: 1 },
    '★ 干净地上的结算防御＝1');

  // preview 与 defense 同一条口径（预览和实际结算对不上就是骗玩家）
  game.s.turn = 'p1';
  const pv = game.preview(blade, emperor);
  assert.equal(game.unitAttack(blade), 7, '（前提）银色战车这一击是 7 点');
  assert.equal(pv.attack, 7);
  assert.equal(pv.defense.total, 1, '★ 预览里的防御就是 1');
  assert.equal(pv.defense.total, game.defense(emperor).total, '★★ preview() 与 defense() 逐值一致');
  assert.deepEqual(pv.defense, game.defense(emperor), '★ 连每一小项都一样（base／bush／rock／pillar）');
  // 7 − 1 = 6：改之前（防御 2）这里是 5 —— 这一条就是"降了那一点"的可观测结果
  assert.equal(pv.damage, 6, '★ 净伤 6（7 − 1；防御还是 2 的话这里是 5）');

  // 真打出去：掉的血与预览逐值相同（证明"按 1 点结算"落在实战里，不只是预览）
  const before = game.s.hp.p2;
  assert.equal(game.attack(blade, emperor), true, '照常能出手');
  assert.equal(before - game.s.hp.p2, pv.damage, '★★ 实际掉血＝预览伤害');
  assert.equal(before - game.s.hp.p2, 6, '★ 实战里这一下也是 6（按 1 点防御结算）');
  assert.equal(game.s.hp.p2, FIGHTERS.emperor.hp - 6);
});

test('② 自由对局里他对"皇帝"锁定那一下的结算也照常（防御 −1 不影响锁定链路）', () => {
  // ⚠️ 「皇帝」是"锁定一个单位、一回合后按常规结算防御"——它打的是**目标**的防御，
  //    所以他自己降防不该动到这一条；这里只是守着"没被连带改坏"。
  const game = new Game({ random: seeded(13) });
  assert.equal(game.start('emperor', 'polnareff', 'ai'), true);
  const gun = game.s.units.find(u => u.slot === 'p1' && u.kind === 'user');
  const foe = game.s.units.find(u => u.slot === 'p2' && u.kind === 'stand');
  // 开局时双方离得远、射程 5 里一个敌人都没有，所以先把对手挪进他的射程里
  const gunTile = game.tile(gun);
  const spot = game.tiles.find(t => tileKey(t) !== tileKey(gunTile) && !game.occupant(t) && !game.pillarAt(t)
    && !game.isRock(t) && hexDist(gunTile, t) <= 5);
  assert.ok(spot, '（前提）要能找一格离他 5 格内的空地');
  Object.assign(foe, { row: spot.row, col: spot.col });

  assert.equal(game.select(gun.id), true);
  assert.equal(game.beginSkill(gun, 'emperor'), true, '他能亲手放「皇帝」');
  assert.equal(game.emperorLock(foe), true);
  assert.equal(game.emperorDamage(foe), Math.max(1, 10 - game.defense(foe).total), '★ 锁定伤害照旧按目标防御算');
  assert.equal(game.preview(gun, foe, 'emperor').damage, game.emperorDamage(foe),
    '★ 锁定那一下的预览与实际结算仍然逐值一致');
});

// ===================== ③ 第八章阶段 1：加成照旧，落点变 3 =====================

test('③ 阶段 1 的幕级加成仍然生效，而且他那一场是 1 + 2 = 3（文案里写的也是 3）', () => {
  // ① 幕上的加成数据一个字没动（用户 2026-10-03 定的 +4 攻 / +2 防）
  assert.deepEqual(phase1.buff, { slot: 'p2', atk: 4, def: 2 }, '★ 加成照旧是幕级数据 `{ atk: 4, def: 2 }`');

  const game = new Game({ random: seeded(13) });
  game.setRoster({ p1b: null, p2b: null, story: true, scene: phase1 });
  assert.equal(game.start('polnareff', 'emperor', 'ai', { story: chapter8.id }), true);
  const emperor = game.s.units.find(u => u.slot === 'p2' && u.kind === 'user');

  assert.equal(game.baseDefense('p2'), 3, '★★ 这一场他的基础防御＝1 + 2 ＝ 3（改之前是 4）');
  assert.equal(game.s.fighters.p2.def, 3, '★ 并进拷贝里的 def ＝ 1 + 2 ＝ 3（基数是 1）');
  assert.equal(game.s.fighters.p2.user.dmg, 11, '★ 攻击那一路照旧 7 + 4 ＝ 11');
  assert.equal(game.defense(emperor).base, 3, '★ 结算口径里的 base 也是 3');
  // 屏幕上也读得到：棋子卡上那一栏是 3（不掺地形）
  assert.equal(game.defense(emperor).total, 3 + game.defense(emperor).bush + game.defense(emperor).rock + game.defense(emperor).pillar,
    '★ total ＝ base(3) ＋ 地形那几项，口径没变');
  // ② 原始数据没被污染（加成只落在拷贝上）
  assert.equal(FIGHTERS.emperor.def, 1, '★★ 跑完这一场之后 FIGHTERS 里还是 1');

  // ③ 玩家可见文案：写死的「防御 4」必须跟着改成 3
  const rules = (phase1.specialRules || []).join('');
  assert.match(rules, /攻击 11、防御 3/, '★★ 第一幕规则里写的是"攻击 11、防御 3"');
  assert.equal(/防御 4/.test(rules), false, '★★ 旧的"防御 4"不许再出现在玩家可见文案里');

  // ④ 这一场的机制与旗标照旧（冷枪还在、他仍是单单位）
  assert.equal(game.sniperRule() !== null, true, '★ 阶段 1 的场边冷枪还在');
  assert.deepEqual(game.s.units.filter(u => u.slot === 'p2').length, 1);
  assert.deepEqual(game.skills('p2'), ['aim', 'darkgun', 'emperor'], '★ 技能与顺序照旧');
});

// ===================== ④ 别的角色一个数都没变 =====================

test('④ 别的角色防御一个都没变（遍历全部 14 个角色的快照）', () => {
  const all = Object.fromEntries(Object.entries(FIGHTERS).map(([key, f]) => [key, f.def]));
  assert.deepEqual(all, DEF_BASELINE, '★★ 只有 emperor 是 1，其余 13 个角色的防御照旧都是 2');
  assert.equal(Object.keys(FIGHTERS).length, 15, '（前提）角色现在是 15 个（多了东方仗助）');
  // 换个写法再念一遍：原基线里"不等于 2"的角色只允许有一个，而且必须是他
  const notTwo = Object.entries(all).filter(([, def]) => def !== 2).map(([key]) => key);
  assert.deepEqual(notTwo, ['emperor'], '★ 全场唯一被改动的就是他');
  // 用户点名的这句话：别的角色**一个都没变**
  for (const [key, def] of Object.entries(DEF_BASELINE)) {
    if (key === 'emperor') continue;
    assert.equal(FIGHTERS[key].def, 2, `★ ${key} 的防御仍然是 ${def}`);
  }
});

test('④ 引擎侧也一样：每个角色上场时读到的基础防御＝他自己那份数据', () => {
  for (const key of Object.keys(FIGHTERS)) {
    // 波鲁纳雷夫本人不跟自己打，换一个对手（其余角色都用同一把尺）
    const foe = key === 'polnareff' ? 'jotaro' : 'polnareff';
    const game = new Game({ random: seeded(13) });
    assert.equal(game.start(foe, key, 'ai'), true, `${key} 要能当对手开局`);
    assert.equal(game.baseDefense('p2'), FIGHTERS[key].def, `★ ${key} 上场后的基础防御＝数据里的 ${FIGHTERS[key].def}`);
    assert.equal(game.fighter('p2').def, FIGHTERS[key].def, `★ ${key} 那份 fighter 数据也没被动过`);
  }
});

test('④ 指纹基线（tools/rules-fingerprint.json）里压根没有他 → 这次改动碰不到它', () => {
  const baseline = JSON.parse(fs.readFileSync(new URL('../tools/rules-fingerprint.json', import.meta.url), 'utf8'));
  assert.equal('emperor' in baseline.FIGHTERS, false, '★ 基线没有 emperor 这一项（所以降他 1 点防御不会让指纹测试变红）');
  assert.equal('geil' in baseline.FIGHTERS, false, '★ 同理 geil 也不在基线里');
  // 基线里收录到的那些角色，防御逐值对得上（改动的边界只在他一个人身上）
  for (const [key, values] of Object.entries(baseline.FIGHTERS)) {
    assert.equal(FIGHTERS[key].def, values.def, `★ 基线里的 ${key}：防御仍是 ${values.def}`);
  }
  assert.equal(Object.keys(baseline.FIGHTERS).length, 12, '（前提）基线收录 12 个角色');
});
