/**
 * 剧情 boss「暗蓝之月」（伪泰尼尔船长）与第四章的海面战场：
 *   数值与选人排除、拖入水下 / 吸盘突袭 / 水下呼吸三个技能、水域 −1 移动、
 *   画面正中那条木甲板（2026-10-05 用户拍板后是"全宽、厚 3 行"的一条带子＝54 格），
 *   以及第四章的幕次切分与剧情场地。
 * 按《开发交接文档》§5 的清单：数值断言、技能正反例、AI 能跑完整局。
 *
 * ⚠️ 用户 2026-09-26 明确选定的两条口径（改动前先看这里，别凭感觉改）：
 *   1）【溺水】**不减速**，唯一效果是「每个回合结束掉 2 点真实伤害」，共 2 次（A 方案：敌我回合结束都结算）。
 *   2）水域 −1 移动**只影响玩家方（p1）**，判定时机是「开始移动那一刻」。
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { Game, RULE, FIGHTERS, SKILLS, STORY_CHAPTERS, SEA_DECK, skillSetFor, playableFighters, isBoss, otherSide } from '../src/core/game.js';
import { hexDist, tileKey, ROWS, COLS, MID_ROW } from '../src/core/hex.js';
import { chooseAI, playAIAction } from '../src/core/ai.js';
import { CHARACTER_ART, artKeys, ARENAS, portrait, cutin } from '../src/ui/assets.js';
import { SPRITES } from '../src/ui/render.js';
import { tileDescription } from '../src/ui/hud.js';
import { storyRoadmap } from '../src/ui/story.js';

function seeded(seed = 7) { return () => ((seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0) / 4294967296); }
const place = (game, id, row, col) => Object.assign(game.unit(id), { row, col });
const chapter4 = STORY_CHAPTERS[3];
/**
 * ★ 2026-10-05：棋盘 14×11 → 18×13 之后，甲板跟着棋盘重新居中；
 *   ★★ 2026-10-05（本次改动）：用户拍板把甲板从"正中一小块 4×5 = 20 格"改成
 *   **"横跨左右全宽、厚 3 行"的一条带子**（18×13 上 ＝ 行 5~7、列 0~17，共 54 格，见 `SEA_DECK`）。
 * 所以夹具里的"甲板上那几个格子"一律**按 SEA_DECK 的几何中心算出来**，不写死行列——
 * 甲板再改形状（只要还盖住几何中心）夹具就不用动。
 */
const deckCentre = () => ({
  row: Math.floor((SEA_DECK.rowStart + SEA_DECK.rowEnd) / 2),
  col: Math.floor((SEA_DECK.colStart + SEA_DECK.colEnd) / 2),
});
/**
 * 第四章的对局：默认地形清空，双方摆在甲板中心那一格的两侧（各占相邻的一列），方便测射程与位移。
 * ⚠️ 摆位同样是相对甲板中心算的，所以甲板再居中也/再变形也不会失配。
 * （★ 2026-10-05 甲板改成全宽带子之后，这四个格子**仍然全在甲板上**：中心行 6 ∈ 行 5~7、
 *   中心列 8 与 9 ∈ 列 0~17，所以这个夹具一个字都不用改。）
 */
function fixture(positions = null) {
  const game = new Game({ random: seeded() });
  game.start(chapter4.player, chapter4.enemy, 'ai', { story: chapter4.id });
  game.s.terrain = {};
  const at = positions || (() => {
    const { row, col } = deckCentre();
    return { 'p2-stand': [row, col + 1], 'p2-user': [row - 1, col + 1], 'p1-stand': [row, col], 'p1-user': [row - 1, col] };
  })();
  for (const [id, [row, col]] of Object.entries(at)) place(game, id, row, col);
  return game;
}
/** 甲板上的一格（跟 SEA_DECK 走，供"站在甲板上起步"这类断言用）。 */
const deckTile = () => deckCentre();

test('暗蓝之月数值：40/2、连携 3、替身防加 2、替身攻 7 射程 1 移动 4，且不进选人列表', () => {
  const f = FIGHTERS.fake_captain;
  assert.equal(f.boss, true, '要带 boss 标记，否则会跑进选人界面');
  assert.equal(f.hp, 40);
  assert.equal(f.def, 2);
  assert.equal(f.distLimit, 3, '★ 连携距离 3');
  assert.equal(f.standDefBonus, 2, '★ 替身防御加成 2');
  assert.equal(f.user.name, '伪泰尼尔船长');
  assert.equal(f.user.move, 3, '本体（船长）移动 3、不能普攻');
  assert.equal(f.user.dmg || 0, 0);
  assert.equal(f.stand.name, '暗蓝之月');
  assert.equal(f.stand.move, 4);
  assert.equal(f.stand.dmg, 7, '★ 攻击 7');
  assert.equal(f.stand.range, 1, '贴身替身');
  assert.deepEqual(skillSetFor('fake_captain'), ['drag', 'sucker', 'aquatic']);
  assert.deepEqual(artKeys(CHARACTER_ART.fake_captain), ['fake_captain', 'dark_blue_moon']);
  // 四张素材都齐了，不该再标成"可选"（否则不参与素材缺失检查，破了图也没人发现——见陷阱 27）
  assert.equal(CHARACTER_ART.fake_captain.artOptional, undefined, '补图后要删掉 artOptional');
  assert.equal(portrait('fake_captain'), 'assets/out/portraits/fake_captain.webp');
  assert.equal(cutin('fake_captain'), 'assets/out/cutins/fake_captain.webp');

  assert.equal(isBoss('fake_captain'), true);
  const playable = playableFighters().map(item => item.key);
  assert.equal(playable.includes('fake_captain'), false, '★ boss 不能被玩家选中');
  // ⚠️ 2026-10-03 第三条用户拍板：第八章的**皇帝（`emperor`）改成了 PvP 可选角色**（撤掉 boss:true），
  //    所以可选角色由 7 名变 **8 名**（'fake_captain 不在列表里'那条一个字没动）。
  assert.equal(playable.length, 9, '可选角色现在是 9 名（皇帝 + 东方仗助）');
});

test('技能数值基线：拖入水下 1AP/2格/溺水2次×2点、吸盘突袭 1AP/贴身+3溺水再+2、水下呼吸每回合回 2', () => {
  const drag = SKILLS.drag, sucker = SKILLS.sucker, aquatic = SKILLS.aquatic;
  assert.equal(drag.cost, 1); assert.equal(drag.cd, 1); assert.equal(drag.range, 2);
  assert.equal(drag.by, 'stand');
  assert.equal(drag.drownTurns, 2, '★ 溺水持续 2 次结算');
  assert.equal(drag.drownDmg, 2, '★ 每次 2 点真实伤害');
  assert.equal(sucker.cost, 1); assert.equal(sucker.cd, 1); assert.equal(sucker.range, 1);
  assert.equal(sucker.bonus, 3); assert.equal(sucker.execute, 2, '★ 目标溺水时再 +2');
  assert.equal(aquatic.passive, true);
  assert.equal(aquatic.regen, 2, '★ 每个己方回合开始回 2 点');
  assert.equal(RULE.waterMovePenalty, 1, '★ 水里移动 −1');
});

test('拖入水下：挂上溺水、按射程与冷却判定、不能重复挂、只挂 debuff 不搬动目标', () => {
  const g = fixture();
  const stand = g.unit('p2-stand'), foe = g.unit('p1-stand');
  g.s.turn = 'p2'; g.s.ap.p2 = 3;
  assert.equal(hexDist(g.tile(stand), g.tile(foe)), 1, '先贴身，保证在射程内');
  const before = { row: foe.row, col: foe.col };

  g.select(stand.id);
  assert.equal(g.drag(foe), true);
  assert.equal(g.s.drown.p1, SKILLS.drag.drownTurns, '溺水回合数＝技能数据');
  assert.equal(g.s.ap.p2, 2, '花掉 1 AP');
  assert.equal(g.s.cd.p2.drag, SKILLS.drag.cd, '冷却记上了');
  assert.equal(g.s.stats.p2.skills, 1);
  // ★ 只挂 debuff：目标坐标一点没动（用户确认的方案里没有位移）
  assert.equal(foe.row, before.row);
  assert.equal(foe.col, before.col);

  // 不能对同一个目标重复挂
  g.s.cd.p2.drag = 0; g.s.ap.p2 = 3;
  assert.match(g.dragReason(stand, foe), /已经在水里/);
  assert.equal(g.drag(foe), false, '重复施放要被拒绝');
  assert.equal(g.s.ap.p2, 3, '被拒绝时不扣 AP');

  // 不能拖自己人
  const ally = g.unit('p2-user');
  assert.match(g.dragReason(stand, ally), /己方单位/);

  // 射程 2 打不到 4 格（相对对手当前那一格算，跟摆位/甲板居中无关）
  g.s.drown.p1 = 0;
  place(g, 'p1-stand', g.tile(stand).row, g.tile(stand).col - 4);
  assert.equal(hexDist(g.tile(stand), g.tile(foe)), 4);
  assert.match(g.dragReason(stand, foe), /超出射程/);
});

test('溺水：不减速，只在每个回合结束掉 2 点真实伤害，一共 2 次后自动结束', () => {
  const g = fixture();
  const stand = g.unit('p2-stand'), foe = g.unit('p1-stand');
  g.s.turn = 'p2'; g.s.ap.p2 = 3;
  g.select(stand.id); g.drag(foe);

  // ★ 不许减速：溺水期间移动距离与平时完全一样
  place(g, 'p1-stand', 1, 1);                       // 水里
  assert.equal(g.moveRange(foe), foe.move - RULE.waterMovePenalty, '只吃水域 −1，溺水本身不减速');
  place(g, 'p1-stand', deckTile().row, deckTile().col);   // 甲板上（跟着 SEA_DECK 居中）
  assert.equal(g.moveRange(foe), foe.move, '甲板上就是满移动');

  const hp0 = g.s.hp.p1;
  g.endTurn();                                      // 船长回合结束 → 第 1 次
  assert.equal(hp0 - g.s.hp.p1, SKILLS.drag.drownDmg, '★ 回合结束掉 2 点');
  assert.equal(g.s.drown.p1, 1, '还剩 1 次');
  g.endTurn();                                      // 承太郎回合结束 → 第 2 次（A 方案：敌我回合结束都结算）
  assert.equal(hp0 - g.s.hp.p1, SKILLS.drag.drownDmg * 2, '★ 两次共 4 点');
  assert.equal(g.s.drown.p1, 0, '结算完自动结束');
  g.endTurn();
  assert.equal(hp0 - g.s.hp.p1, SKILLS.drag.drownDmg * 2, '结束之后不再掉血');
  assert.equal(g.drowning('p1'), false);
});

test('溺水是真实伤害：无视防御与地形，溺水可以把人打到最后一点血并直接判负', () => {
  const g = fixture();
  const stand = g.unit('p2-stand'), foe = g.unit('p1-stand');
  g.s.turn = 'p2'; g.s.ap.p2 = 3;
  g.select(stand.id); g.drag(foe);
  // 站到草丛 + 邻岩石上，防御拉满——溺水照样掉满 2 点
  g.s.terrain[tileKey(g.tile(foe))] = 'bush';
  const hp0 = g.s.hp.p1;
  g.endTurn();
  assert.equal(hp0 - g.s.hp.p1, SKILLS.drag.drownDmg, '草丛/岩石不会减少溺水伤害');

  // 血量压到 2 点：下一次溺水结算正好打死，并走正常的胜负判定
  const g2 = fixture();
  g2.s.turn = 'p2'; g2.s.ap.p2 = 3;
  g2.select(g2.unit('p2-stand').id); g2.drag(g2.unit('p1-stand'));
  g2.s.hp.p1 = SKILLS.drag.drownDmg;
  g2.endTurn();
  assert.equal(g2.s.hp.p1, 0);
  assert.equal(g2.s.phase, 'result', '掉到 0 就该结束');
  assert.equal(g2.s.winner, 'p2');
});

test('吸盘突袭：攻击力 +3；目标正在溺水时再 +2（共 +5）', () => {
  const g = fixture();
  const stand = g.unit('p2-stand'), foe = g.unit('p1-stand');
  g.s.turn = 'p2'; g.s.ap.p2 = 3;
  assert.equal(hexDist(g.tile(stand), g.tile(foe)), 1);

  const dry = g.preview(stand, foe, 'sucker');
  assert.equal(dry.attack, stand.dmg + SKILLS.sucker.bonus, '目标没溺水：只有 +3');

  g.select(stand.id); g.drag(foe);
  const wet = g.preview(stand, foe, 'sucker');
  assert.equal(wet.attack, stand.dmg + SKILLS.sucker.bonus + SKILLS.sucker.execute,
    '★ 目标溺水：再 +2（共 +5）');
  assert.ok(wet.damage > dry.damage, '实际伤害也要更高');

  // 射程只有 1：2 格打不到（相对对手当前那一格算）
  g.s.drown.p1 = 0;
  place(g, 'p1-stand', g.tile(stand).row, g.tile(stand).col - 2);
  assert.equal(hexDist(g.tile(stand), g.tile(foe)), 2);
  assert.match(g.attackReason(stand, foe, 'sucker'), /超出射程/);
  assert.equal(g.attack(stand, foe, 'sucker'), false);
});

test('水下呼吸（被动）：每个己方回合开始回 2 点，不会超过上限，也能被灼烧减疗', () => {
  // 开局是 p1 的回合，结束它就轮到 p2 → 进 p2 回合时触发水下呼吸
  const g = fixture();
  g.s.hp.p2 = FIGHTERS.fake_captain.hp - 1;         // 只差 1 点满血
  g.endTurn();
  assert.equal(g.s.turn, 'p2');
  assert.equal(g.s.hp.p2, FIGHTERS.fake_captain.hp, '★ 回到自己回合就回血，且不超上限');

  // 掉血状态下回满 2 点
  const g2 = fixture();
  g2.s.hp.p2 = 20;
  g2.endTurn();
  assert.equal(g2.s.hp.p2, 22, '★ 每个己方回合开始回 2 点');

  // 灼烧时治疗减半（heal() 的既有规则，水下呼吸自动继承）
  const g3 = fixture();
  g3.s.hp.p2 = 10;
  g3.s.burn.p2 = 1;
  g3.endTurn();
  assert.equal(g3.s.hp.p2, 11, '★ 灼烧中回血减半：回 1 而不是 2');
});

test('水域 −1 移动：只影响玩家方、只看「开始移动那一刻」在哪，其他关卡完全没有水', () => {
  const g = fixture();
  const mine = g.unit('p1-stand'), theirs = g.unit('p2-stand');
  assert.equal(g.wateryArena(), true);

  place(g, 'p1-stand', 1, 1);                       // 水里
  place(g, 'p2-stand', 1, 1);
  assert.equal(g.inWater(mine), true);
  assert.equal(g.moveRange(mine), mine.move - RULE.waterMovePenalty, '★ 玩家在水里：移动 −1');
  assert.equal(g.moveRange(theirs), theirs.move, '★ boss 不受水域影响');

  // 判定时机＝开始移动那一刻：站在甲板上起步，走进水里也不减（走过去之后才按新位置算）
  place(g, 'p1-stand', deckTile().row, deckTile().col);
  assert.equal(g.inWater(mine), false);
  assert.equal(g.moveRange(mine), mine.move, '甲板上起步＝满移动');
  // 高亮可达范围必须跟 moveRange 一致：曾经把移动距离算了两遍（藤蔓一处、paths 一处），
  // 加水域规则时漏掉 paths 那一处，就会出现"显示能走 4 格、实际只能走 3 格"。
  // 这里量的是 paths() 里最长的那条路（reachable 还会再被连携距离砍一刀，不适合量步数）。
  const longest = () => Math.max(0, ...[...g.paths(g.unit('p1-stand')).values()].map(path => path.length));
  assert.equal(longest(), mine.move, '甲板上：最远 4 格');
  place(g, 'p1-stand', 1, 1);                       // 水里
  assert.equal(longest(), mine.move - RULE.waterMovePenalty, '★ 水里：最远只能 3 格，跟实际能走的一致');
  // 不变量：高亮出来的每一格，路径长度都不超过 moveRange
  for (const t of g.reachable(g.unit('p1-stand'))) {
    const path = g.paths(g.unit('p1-stand')).get(tileKey(t));
    assert.ok(path.length <= g.moveRange(g.unit('p1-stand')), '高亮范围不能超过实际移动距离');
  }

  // 别的对局没有水
  const g2 = new Game({ random: seeded() });
  g2.start('jotaro', 'dio');
  assert.equal(g2.wateryArena(), false);
  assert.equal(g2.isWaterTile(g2.tile(g2.unit('p1-stand'))), false);
  assert.equal(g2.moveRange(g2.unit('p1-stand')), g2.unit('p1-stand').move);
});

test('画面正中那条木甲板：带子上是甲板、带子外一律是水（全宽 54 格、垂直居中）', () => {
  const g = fixture();
  // ★★ 2026-10-05 用户拍板（本次改动）：原来是"4 列 × 5 行 = 20 格"的中块（列 7–10、行 4–8），
  //   现在是**"横跨左右全宽、厚 3 行"的一条带子**（列 0–17、行 5–7，18×3 = 54 格）。
  //   下面这两条被直接推翻：`deepEqual(SEA_DECK, {7,10,4,8})` 与 `deckCount === 20`。
  assert.deepEqual(SEA_DECK, { colStart: 0, colEnd: COLS - 1, rowStart: MID_ROW - 1, rowEnd: MID_ROW + 1 });
  // 居中的口径：纵向仍关于棋盘正中那一行对称；横向现在**正好铺满整行**（左右不留水）
  assert.equal(SEA_DECK.rowStart + SEA_DECK.rowEnd, ROWS - 1, '★ 甲板在行方向上居中');
  assert.equal(SEA_DECK.colStart, 0, '★ 甲板从最左一列开始');
  assert.equal(SEA_DECK.colEnd, COLS - 1, '★ 一直到最右一列（横跨左右全宽）');
  assert.equal(SEA_DECK.colStart + SEA_DECK.colEnd, COLS - 1, '（同一件事）列方向也居中');
  assert.equal(SEA_DECK.colStart, COLS - 1 - SEA_DECK.colEnd, '★ 左右两侧留出的水面一样宽——现在都是 0 列');
  const deckCount = (SEA_DECK.rowEnd - SEA_DECK.rowStart + 1) * (SEA_DECK.colEnd - SEA_DECK.colStart + 1);
  assert.equal(deckCount, 54, '18 列 × 3 行 = 54 格甲板');
  const deck = g.tiles.filter(t => !g.isWaterTile(t));
  assert.equal(deck.length, deckCount, '★ 甲板格数要和 SEA_DECK 完全对得上');
  for (const t of deck) {
    assert.ok(t.row >= SEA_DECK.rowStart && t.row <= SEA_DECK.rowEnd);
    assert.ok(t.col >= SEA_DECK.colStart && t.col <= SEA_DECK.colEnd);
  }
  // ★ 带子上是甲板、带子外全是水（逐格核对，不只是抽几个角）
  for (const t of g.tiles) {
    const onDeck = t.row >= SEA_DECK.rowStart && t.row <= SEA_DECK.rowEnd;
    assert.equal(g.isWaterTile(t), !onDeck, `${tileKey(t)}：只有行 ${SEA_DECK.rowStart}~${SEA_DECK.rowEnd} 是甲板`);
  }
  // 四角都是水（这条带子够不到上下两角）；带子的上下各一行都是水
  assert.equal(g.isWaterTile({ row: 0, col: 0 }), true, '左上角在水里');
  assert.equal(g.isWaterTile({ row: 0, col: COLS - 1 }), true, '右上角在水里');
  assert.equal(g.isWaterTile({ row: SEA_DECK.rowStart, col: 0 }), false, '带子最左边那一格在甲板上');
  assert.equal(g.isWaterTile({ row: SEA_DECK.rowEnd, col: COLS - 1 }), false, '带子最右边那一格在甲板上');
  assert.equal(g.isWaterTile({ row: SEA_DECK.rowStart - 1, col: SEA_DECK.colStart }), true, '甲板上面一行是水');
  assert.equal(g.isWaterTile({ row: SEA_DECK.rowEnd + 1, col: SEA_DECK.colEnd }), true, '甲板下面一行是水');
  // fixture 把双方都摆在甲板范围内，所以这里都是甲板格
  assert.equal(g.isWaterTile(g.tile(g.unit('p1-stand'))), false, '测试摆位在甲板上');
  // ⚠️ **真实开局**（本次改动之后）：`DEPLOY_ROW === MID_ROW` 正好落在甲板带子（行 5~7）中间，
  //    所以四枚棋子**都从甲板上开局**——旧数据下甲板只有 7~10 列，他们都在水里。
  //    这是用户明确要的连带结果（"第四章也跟着改"），不是回归。
  const fresh = new Game({ random: seeded() });
  fresh.start(chapter4.player, chapter4.enemy, 'ai', { story: chapter4.id });
  for (const u of fresh.s.units) {
    assert.equal(fresh.tile(u).row, MID_ROW, `${u.id} 开局摆在正中那一行`);
    assert.equal(fresh.isWaterTile(fresh.tile(u)), false, `${u.id} 开局站在甲板上（正中间那一行就是甲板）`);
  }
});

test('格子提示会说清脚下是什么：水里显示「移动 −1」，甲板显示木甲板', () => {
  const g = fixture();
  const water = { row: 1, col: 1 }, deck = deckTile();
  assert.match(tileDescription(g, water), /水面 · 移动 −1/);
  assert.match(tileDescription(g, deck), /木甲板/);
  assert.equal(tileDescription(g, deck).includes('移动 −1'), false, '甲板上不该出现 −1 提示');

  // 普通对战不加这套说法
  const g2 = new Game({ random: seeded() });
  g2.start('jotaro', 'dio');
  assert.equal(tileDescription(g2, water).includes('水面'), false);
});

test('第四章数据：读 → 打 → 读，承太郎没有时停、半血觉醒「星尘的怒火」，场地是海面', () => {
  assert.equal(STORY_CHAPTERS.length, 8, '现在一共八章（第八章「皇帝与吊死者」已加入）');
  assert.equal(chapter4.id, 'chapter-4');
  assert.equal(chapter4.player, 'jotaro');
  assert.equal(chapter4.enemy, 'fake_captain');
  assert.equal(chapter4.arena, 'sea', '★ 这一战在海面上');
  assert.deepEqual(chapter4.scenes.map(scene => scene.kind), ['read', 'battle', 'read'],
    '战斗放在第 1 段之后（第 2 段后半会剧透结果）');
  assert.equal(chapter4.scenes[0].readId, 'darkblue');
  assert.equal(chapter4.scenes[0].upto, 1);
  assert.equal(chapter4.scenes[2].from, 1);

  // 这一战的承太郎还没有时停
  assert.deepEqual(chapter4.swaps.jotaro.skills, ['ora', 'star']);
  assert.equal(chapter4.swaps.jotaro.skills.includes('time'), false, '★ 时停要留到最后打 DIO');
  // ★ 2026-10-04 用户要求：承太郎的觉醒名全章统一成「星尘的怒火」（这一章原来叫「等待」）
  assert.equal(chapter4.swaps.jotaro.rage.name, '星尘的怒火');
  assert.equal(chapter4.swaps.jotaro.rage.atk, 3);
  assert.equal(chapter4.swaps.jotaro.rage.ap, 1);

  const g = fixture();
  assert.equal(g.s.story.arena, 'sea');
  assert.deepEqual(g.skills('p1'), ['ora', 'star'], '进对局后技能表也跟着换');
  assert.equal(g.skills('p1').includes('time'), false);

  // 场地背景进了 SPRITES 才会被加载
  assert.equal(ARENAS.sea, 'assets/out/arenas/sea.webp');
  assert.ok(SPRITES['arena:sea'], '★ 海面背景必须进 SPRITES');
});

test('第四章在章节列表里是第四章、第 14–16 话，覆盖「暗蓝之月」那一弧', () => {
  const rows = storyRoadmap();
  assert.equal(rows[3].playable, true);
  assert.equal(rows[3].chapterId, 'chapter-4');
  assert.equal(rows[3].label, '第四章');
  assert.match(rows[3].range, /^第 14–16 话$/);
  assert.equal(rows.filter(row => row.title === '暗蓝之月' && !row.playable).length, 0,
    '暗蓝之月那一弧已被第四章覆盖，不该再单列一条"未开放"');
});

test('第四章能真的开打：boss 有本体和替身两个棋子，AI 能把这局打完', () => {
  const g = fixture();
  assert.equal(g.s.hp.p2, FIGHTERS.fake_captain.hp, 'boss 的共享生命取自他自己的数据');
  assert.equal(g.s.units.filter(u => u.side === 'p2').length, 2, 'boss 是双单位：本体 + 替身');
  assert.equal(g.unit('p2-stand').move, 4);
  assert.equal(g.unit('p2-stand').range, 1);
  assert.equal(g.distLimit('p2'), 3);
  assert.equal(otherSide('p1'), 'p2');

  // 双方都交给 AI，跑到分出胜负为止（这一步同时会踩到 drag / sucker 的 AI 分支）
  const game = new Game({ random: seeded(3) });
  game.start(chapter4.player, chapter4.enemy, 'ai', { story: chapter4.id });
  let guard = 0;
  while (game.s.phase === 'battle' && guard++ < 400) {
    const side = game.s.turn;
    if (!playAIAction(game, chooseAI(game))) game.endTurn();
    assert.equal(Number.isFinite(game.s.hp[side]), true, '血量必须是有限数');
    assert.ok(game.s.ap[side] >= 0, '行动点不能为负');
  }
  assert.ok(guard < 400, '★ 这一局必须在合理步数内结束（AI 不会卡死）');
  assert.equal(game.s.phase, 'result', '最终要分出胜负');
  assert.ok(['p1', 'p2'].includes(game.s.winner));
});
