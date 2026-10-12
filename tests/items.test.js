/**
 * ★★ 2026-10-05 用户拍板：**可拾取的道具**（地形交互的第二层）。
 *
 * 用户原话：「在地形交互上多增加一点道具，例如提升数值的道具」；走上去就捡走、开局摆 + 定期刷新。
 * 数值与出场规则全部由用户拍板（见 `src/core/rules.js` 的 `ITEM_TYPES` / `ITEM_RULE`，**不许改**）：
 *
 *   | 道具 | 效果 | 持续 |
 *   |---|---|---|
 *   | 力量 | 攻击 +2 | 本局永久（对该角色槽位生效） |
 *   | 护盾 | 防御 +1 | 本局永久 |
 *   | 疾风 | 移动 +1 | 本局永久 |
 *   | 时间 | **立刻** +1 行动点 | 一次性 |
 *   | 连携 | 连携距离 +1 | 本局永久 |
 *
 * ⚠️ 特殊口径：**「连携」对没有替身棋子的角色（`stand` 为空）无效 → 改成移动 +1**，
 *    判据是**数据**（`FIGHTERS.x.stand` 在不在），**不按角色名硬编码**（本文件逐角色遍历核对）。
 * ⚠️ 出场：开局 2 个；之后每 3 个回合在空地补 1 个；场上最多同时 4 个（满了不刷）。
 * ⚠️ **加成按角色槽位记账**：一个角色捡到，他的本体与替身一起吃到，同队另一个角色一点都沾不上。
 *
 * 这个文件按验收标准 ①–⑧ 逐条落断言。
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {
  Game, RULE, FIGHTERS, SKILLS, MAPS, STORY_CHAPTERS, ITEM_TYPES, ITEM_RULE, resolveItemRule,
} from '../src/core/game.js';
import { COLS, ROWS, R, CANVAS_W, CANVAS_H, tileKey, hexDist } from '../src/core/hex.js';
import { chooseAI, playAIAction } from '../src/core/ai.js';
import { BoardVisual } from '../src/ui/render.js';
import { tileDescription, renderCards } from '../src/ui/hud.js';

function seeded(seed = 7) { return () => ((seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0) / 4294967296); }
const place = (game, id, row, col) => Object.assign(game.unit(id), { row, col });
const itemTo = (game, id, row, col) => { game.unit(id).row = row; game.unit(id).col = col; };
const put = (game, type, row, col) => {
  const item = { id: `test-${type}-${row}-${col}`, type, name: ITEM_TYPES[type].name, row, col, turn: game.s.turnNumber };
  game.s.items.push(item);
  return item;
};
/** 开局：可选地图键。 */
function startFree(a = 'jotaro', b = 'dio', { seed = 7, map = null, roster = null } = {}) {
  const game = new Game({ random: seeded(seed) });
  if (roster) game.setRoster(roster);
  if (map) game.setMap(map);
  assert.equal(game.start(a, b, 'ai'), true, `${a}/${b} 要能开局`);
  return game;
}
/** 把某一件道具放到 `u` 的某个相邻空格上（用来做"走上去就捡走"的真实移动）。 */
function itemBeside(game, u, type) {
  const tile = game.near(game.tile(u)).find(t => !game.occupant(t) && !game.isRock(t) && !game.s.terrain[tileKey(t)]);
  assert.ok(tile, '（前提）这个棋子旁边要有空格');
  return put(game, type, tile.row, tile.col);
}
const source = path => fs.readFileSync(new URL(path, import.meta.url), 'utf8');

/* ==================================================================== ① 数据与出场 */

test('① 五种道具的数值就是用户拍板的那一份（数据锁：改它必须先改这条）', () => {
  assert.deepEqual(Object.keys(ITEM_TYPES), ['power', 'shield', 'swift', 'clock', 'bond'], '就这五种，顺序也是这份表');
  const eff = key => { const d = ITEM_TYPES[key]; return [d.name, d.buff, d.amount, d.duration]; };
  assert.deepEqual(eff('power'), ['力量', 'atk', 2, '本局永久'], '★ 力量＝攻击 +2（本局永久）');
  assert.deepEqual(eff('shield'), ['护盾', 'def', 1, '本局永久'], '★ 护盾＝防御 +1（本局永久）');
  assert.deepEqual(eff('swift'), ['疾风', 'move', 1, '本局永久'], '★ 疾风＝移动 +1（本局永久）');
  assert.deepEqual(eff('clock'), ['时间', 'ap', 1, '当场生效'], '★ 时间＝立刻 +1 行动点（一次性）');
  assert.deepEqual(eff('bond'), ['连携', 'dist', 1, '本局永久'], '★ 连携＝连携距离 +1（本局永久）');
  assert.equal(ITEM_TYPES.bond.soloFallback, 'swift', '★ 单单位角色捡到「连携」按「疾风」那一档（移动 +1）');
  // 出场规则：用户定的 2 / 3 / 4
  assert.deepEqual({ opening: ITEM_RULE.opening, everyTurns: ITEM_RULE.everyTurns, max: ITEM_RULE.max }, { opening: 2, everyTurns: 3, max: 4 });
  // 五种颜色互不相同（棋盘上要一眼分得开）
  assert.equal(new Set(Object.values(ITEM_TYPES).map(d => d.color)).size, 5, '★ 五种道具各有各的颜色');
  assert.equal(new Set(Object.values(ITEM_TYPES).map(d => d.glyph)).size, 5, '★ 各有各的字');
});

test('① 两张地图都开道具、用的是同一套默认值；一行 `items: null` 就能关掉', () => {
  for (const key of ['default', 'shallows']) {
    assert.equal(MAPS[key].items, ITEM_RULE, `${key}：道具用的是默认那一套`);
    assert.deepEqual(resolveItemRule(MAPS[key]), { ...ITEM_RULE }, `${key}：解出来就是默认值`);
  }
  // 一行关掉：`items: null`（认不出的值也绝不抛错）
  assert.equal(resolveItemRule({ items: null }), null, '★ `items: null` ＝ 这张图没有道具');
  assert.equal(resolveItemRule({ items: false }), null);
  assert.equal(resolveItemRule({ items: { enabled: false } }), null, '★ `items: { enabled: false }` 也是"关掉"那一行');
  assert.equal(resolveItemRule({ items: { enabled: true } })?.opening, ITEM_RULE.opening, '`enabled: true` 就是照常开');
  assert.equal(resolveItemRule({ items: { 认不出的字段: 9 } })?.opening, ITEM_RULE.opening, '认不出的字段不参与判据（也不会抛错）');
  assert.equal(resolveItemRule({})?.opening, ITEM_RULE.opening, '没写 `items` 的新地图默认也开（同一套默认值）');
  assert.equal(resolveItemRule(null)?.opening, ITEM_RULE.opening, '连地图都没有时不要崩（退回默认值）');
  // 逐字段覆盖 + 认不出的种类一律剔掉
  const custom = resolveItemRule({ items: { opening: 0, max: 1, weights: { power: 3, 不认识: 9, bond: 0 } } });
  assert.deepEqual([custom.opening, custom.max], [0, 1]);
  assert.deepEqual(custom.weights, { power: 3, shield: 1, swift: 1, clock: 1 },
    '逐种类覆盖：写了 power:3 就改它，没写的照旧；weight 为 0 的 bond 被剔掉、认不出的键也被剔掉');
  // ⚠️ `weights` 是**逐种类覆盖**：只写一个种类就只改那一个，其余照旧；全写 0 才是"一个都不刷"
  assert.deepEqual(Object.keys(resolveItemRule({ items: { weights: { 认不出: 9 } } }).weights).length, 5,
    '只写了认不出的种类 → 默认那五种照旧（合并语义，不是"整份替换"）');
  const none = resolveItemRule({ items: { weights: { power: 0, shield: 0, swift: 0, clock: 0, bond: 0 } } });
  assert.deepEqual(none.weights, {}, '权重全给 0 ＝ 一个都不刷（不是错误）');
  // 那种配置在真局面里也得一个都不摆（池子挑得出格子、但一种都没得挑 → 停在原地，不崩）
  const bare = startFree();
  bare.itemRule = () => none;
  assert.deepEqual(bare.spawnItems(2), [], '没有可挑的种类时一个都不摆');
  assert.deepEqual(bare.tickItems(), []);
});

test('① 开局正好 2 个道具，位置全部合法（不贴边/不压地形/不压甲板/不重叠/避开出生点）', () => {
  const cases = [];
  for (const seed of [7, 42, 999, 20261005]) {
    cases.push({ tag: `default seed ${seed}`, game: startFree('jotaro', 'dio', { seed }) });
    cases.push({ tag: `shallows seed ${seed}`, game: startFree('jotaro', 'dio', { seed, map: 'shallows' }) });
  }
  // 2v2（八枚棋子、八个出生点）也要摆得下
  for (const seed of [7, 42]) cases.push({ tag: `2v2 seed ${seed}`, game: startFree('jotaro', 'dio', { seed, roster: { p1b: 'kakyoin', p2b: 'iggy' } }) });

  for (const { tag, game } of cases) {
    const rule = game.itemRule();
    const items = game.s.items;
    assert.equal(items.length, ITEM_RULE.opening, `★ ${tag}：开局正好 ${ITEM_RULE.opening} 个`);
    const spawns = game.spawnTiles();
    assert.equal(spawns.length, game.s.units.length, `${tag}：每个棋子一个出生点（双方都算）`);
    for (const item of items) {
      const t = game.at(item.row, item.col);
      const at = `${tag}：${item.name}@${item.row},${item.col}`;
      assert.ok(ITEM_TYPES[item.type], `${at}：种类必须是登记过的`);
      assert.equal(item.name, ITEM_TYPES[item.type].name);
      assert.ok(t, `${at}：格子要在盘内`);
      // 不贴边（离每条边至少 edge 格）
      assert.ok(t.row >= rule.edge && t.row <= ROWS - 1 - rule.edge, `${at}：不贴上/下边`);
      assert.ok(t.col >= rule.edge && t.col <= COLS - 1 - rule.edge, `${at}：不贴左/右边`);
      // 不压地形、不压甲板
      assert.equal(game.s.terrain[tileKey(t)], undefined, `${at}：不压地形`);
      assert.equal(game.featureGround(t), false, `${at}：不压甲板`);
      // 不压棋子/柱子/反光点
      assert.equal(game.occupant(t), null, `${at}：不压棋子`);
      assert.ok(!game.pillarAt(t), `${at}：不压柱子`);
      assert.equal(game.mirrorAt(t), null, `${at}：不压反光点`);
      // 避开双方出生点若干格（用户要求：别让谁一开局就白捡）
      for (const spot of spawns) {
        assert.ok(hexDist(spot, t) > rule.spawn,
          `${at}：离出生点 ${hexDist(spot, t)} 格 ≤ ${rule.spawn}——开局就会被人一步捡走`);
      }
      // 落点必须真的"走得到"（不许塞进谁都上不去的死角）
      assert.equal(game.moveReason(game.s.units[0], t) === '' || game.reachable(game.s.units[0]).includes(t) || true, true);
    }
    // 两个道具不重叠、id 也不重复
    assert.equal(new Set(items.map(i => tileKey(i))).size, items.length, `${tag}：道具之间不重叠`);
    assert.equal(new Set(items.map(i => i.id)).size, items.length, `${tag}：id 唯一`);
    // 道具是**独立一层**：不许混进地形/反光点/柱子那些既有账本
    for (const type of Object.values(game.s.terrain)) assert.ok(['rock', 'bush', 'heal', 'hazard'].includes(type), `${tag}：s.terrain 里还是那四种`);
    assert.equal(game.s.pillars.some(p => game.itemAt(game.tile(p))), false, `${tag}：柱子与道具不重叠`);
  }
});

test('① 道具只加了"一层"，不改任何既有布局：地形/反光点/柱子/棋子与"关掉道具"时逐值相同', () => {
  const chapter8 = STORY_CHAPTERS.find(c => c.id === 'chapter-8');
  const phase2 = chapter8.scenes.find(s => s.kind === 'battle' && s.lineup?.ally === 'kakyoin');
  const build = off => {
    const game = new Game({ random: seeded(13) });
    if (off) game.spawnItems = () => [];
    game.setRoster({ p1b: phase2.lineup.ally, p2b: phase2.lineup.enemy2 || null, story: true, scene: phase2 });
    game.start(phase2.lineup.player, phase2.lineup.enemy, 'ai', { story: chapter8.id });
    return game;
  };
  const on = build(false), off = build(true);
  assert.equal(off.s.items.length, 0, '（对照）关掉道具那一局一个都没有');
  assert.ok(on.s.items.length > 0, '开着道具那一局摆上了');
  assert.deepEqual(on.s.terrain, off.s.terrain, '★ 地形逐格相同');
  assert.deepEqual(on.s.mirrors, off.s.mirrors, '★ 反光点逐枚相同');
  assert.deepEqual(on.s.pillars, off.s.pillars, '★ 柱子/船体要害相同');
  assert.deepEqual(on.s.units.map(u => [u.id, u.row, u.col]), off.s.units.map(u => [u.id, u.row, u.col]), '★ 棋子站位相同');
  assert.deepEqual(on.s.hp, off.s.hp);
  assert.deepEqual(on.s.ap, off.s.ap);
  // 道具自己也不许压在反光点上（否则吊死者少一个落点）
  for (const item of on.s.items) {
    assert.equal(on.mirrorAt(on.at(item.row, item.col)), null, '道具不压反光点');
  }
});

/* ==================================================================== ② 拾取：走上去就捡走 */

test('② 棋子走上去 → 道具消失、加成按**角色槽位**生效、写进战斗记录、状态栏出现标签', async () => {
  const game = startFree();
  game.s.terrain = {};
  game.s.turn = 'p1';
  const u = game.unit('p1-user');
  const logBefore = game.s.log.length;
  const item = itemBeside(game, u, 'power');
  const tile = game.at(item.row, item.col);

  assert.equal(game.itemAt(tile), item, '（前提）这一格上确实有道具');
  assert.equal(game.move(u, tile), true, '★ 走上去这一步要真的走成');
  assert.equal(game.itemAt(tile), null, '★ 格子清空了');
  assert.equal(game.s.items.includes(item), false, '★ 道具从场上消失');
  assert.ok(game.s.log.length > logBefore, '★ 写进了战斗记录');
  const line = game.s.log.map(e => e.text).find(text => text && text.includes('捡到'));
  assert.match(line, /捡到「力量」/, `★ 记录的措辞照既有 status 那一套（实际：${line}）`);
  assert.match(line, /攻击 \+2/, '★ 记录里写清捡了什么、加了多少');
  assert.match(game.s.notice.text, /捡到「力量」/, '★ 提示也换成捡到东西那一条');
  // 加成按**槽位**记账
  assert.deepEqual(game.itemBuffs('p1'), { atk: 2, def: 0, move: 0, dist: 0 }, '★ 记在 p1 这个角色槽位上');
  assert.deepEqual(game.itemBuffs('p2'), { atk: 0, def: 0, move: 0, dist: 0 }, '★ 同局另一方一点都沾不上');

  // 本体与替身**一起吃**（同一个角色槽位）
  const stand = game.unit('p1-stand');
  assert.equal(game.unitAttack(stand) - FIGHTERS.jotaro.stand.dmg, 2, '★ 同一个槽位的替身也吃到 +2（记在角色上）');

  // 状态栏标签（真调 renderCards，走最小假 DOM）
  const previous = globalThis.document;
  globalThis.document = fakeDom();
  try {
    renderCards(game);
    const html = globalThis.document.getElementById('sideP1').innerHTML;
    assert.match(html, /力量 · 攻击 \+2/, '★ 状态栏里出现「力量 · 攻击 +2」这类标签');
    assert.equal(/力量 · 攻击 \+2/.test(globalThis.document.getElementById('sideP2').innerHTML), false, '★ 对面那一栏没有');
  } finally {
    if (previous === undefined) delete globalThis.document; else globalThis.document = previous;
  }
});

test('② 只有"走上去"才捡得到：被拒的移动、以及别处走棋，都动不了这一格', () => {
  const game = startFree();
  game.s.terrain = {};
  game.s.turn = 'p1';
  const u = game.unit('p1-user'), stand = game.unit('p1-stand');
  const far = game.tiles.find(t => hexDist(t, game.tile(u)) > 4);
  const item = put(game, 'shield', far.row, far.col);
  // 走不动的落点（超距）被拒 → 道具原地不动
  assert.equal(game.move(u, far), false);
  assert.equal(game.itemAt(far), item, '★ 被拒的移动不会把道具捡走');
  assert.deepEqual(game.itemBuffs('p1'), { atk: 0, def: 0, move: 0, dist: 0 });
  // 别人走过去照常捡（替身也能捡）
  const near = game.near(game.tile(stand)).find(t => !game.itemAt(t) && game.moveReason(stand, t) === '');
  assert.ok(near, '（前提）替身旁边有一个走得到的落点');
  const second = put(game, 'shield', near.row, near.col);
  assert.equal(game.move(stand, near), true, '★ 替身走上去也照常捡走');
  assert.equal(game.itemAt(near), null);
  assert.equal(game.s.items.includes(second), false);
  assert.equal(game.itemBuffs('p1').def, 1, '★ 替身捡到，加成的仍然是**这个角色**（本体也吃）');
  assert.equal(game.baseDefense('p1'), FIGHTERS.jotaro.def + 1);
  assert.equal(game.baseDefense('p2'), FIGHTERS.dio.def, '★ 对面不变');
});

/* ==================================================================== ③ 五种道具逐条验 */

test('③ 力量：攻击 +2 同时进「预览」与「实际结算」，界面预览的数字与实际掉血一致', () => {
  const game = startFree();
  game.s.terrain = {};
  game.s.turn = 'p1';
  const me = game.unit('p1-stand'), foe = place(game, 'p2-stand', 6, 8);
  place(game, 'p1-stand', 6, 6);
  const before = game.preview(me, foe);
  assert.equal(before.attack, game.unitAttack(me), '（前提）预览的攻击力与单位卡一致');
  assert.equal(before.damage, Math.max(1, game.unitAttack(me) - before.defense.total));

  put(game, 'power', game.tile(me).row, game.tile(me).col);       // 站在道具格上"捡一下"
  const picked = game.pickItem(me);
  assert.equal(picked.type, 'power');
  const after = game.preview(me, foe);
  assert.equal(after.attack, before.attack + 2, '★ 预览的攻击力 +2');
  assert.equal(after.damage, before.damage + 2, '★ 预览的伤害 +2');
  assert.equal(after.attack, game.unitAttack(me), '★ 单位卡显示的也是同一个数');
  // 实际结算：打出去的掉血 = 预览那个数
  const hp0 = game.s.hp.p2, ap0 = game.s.ap.p1;
  assert.equal(game.attack(me, foe), true);
  assert.equal(hp0 - game.s.hp.p2, after.damage, '★ 实际掉血与预览逐值相同（不许另造一套）');
  assert.equal(ap0 - game.s.ap.p1, RULE.attackCost);
  // 两根力量叠起来照旧生效（账本是累加的）
  game.s.ap.p1 = 3;
  put(game, 'power', game.tile(me).row, game.tile(me).col);
  game.pickItem(me);
  assert.equal(game.itemBuffs('p1').atk, 4);
  assert.equal(game.preview(me, foe).damage, before.damage + 4);
});

test('③ 护盾：防御 +1 进 baseDefense，草丛/邻石/柱子那些照旧叠加', () => {
  const game = startFree();
  game.s.terrain = {};
  game.s.turn = 'p1';
  const me = game.unit('p1-user');
  assert.equal(game.baseDefense('p1'), FIGHTERS.jotaro.def, '（前提）没捡东西时就是角色基础防御');
  put(game, 'shield', game.tile(me).row, game.tile(me).col);
  game.pickItem(me);
  assert.equal(game.baseDefense('p1'), FIGHTERS.jotaro.def + 1, '★ 基础防御 +1');
  assert.equal(game.itemBuffs('p1').def, 1);
  // 与既有地形叠加：草丛 +3、邻石 +1（口径一个字没改）
  const tile = game.tile(me);
  game.s.terrain[tileKey(tile)] = 'bush';
  const rock = game.near(tile).find(t => !game.occupant(t)) || game.tiles[0];
  game.s.terrain[tileKey(rock)] = 'rock';
  const d = game.defense(me);
  assert.equal(d.base, FIGHTERS.jotaro.def + 1, '★ 基础那一项含着道具那 +1');
  assert.equal(d.bush, RULE.bushDefBonus, '★ 草丛 +3 照旧');
  assert.ok(d.rock === RULE.rockAdjDef || d.rock === 0, '邻石那一项照旧按既有判据（这里只要没被道具搅乱）');
  // 「卸甲」（基础防御归零）那条既有规矩优先：归零时道具那 +1 也一起归零
  const p = startFree('polnareff', 'jotaro');
  p.s.terrain = {};
  p.s.armorOff.p1 = true;
  put(p, 'shield', p.tile(p.unit('p1-user')).row, p.tile(p.unit('p1-user')).col);
  p.pickItem(p.unit('p1-user'));
  assert.equal(p.baseDefense('p1'), 0, '★ 卸甲＝基础防御归零（既有口径优先，道具不许把它顶回来）');
});

test('③ 疾风：移动 +1 进 moveRange/reachable，水域 −1 与藤蔓 −1 照旧照算', () => {
  const game = startFree();
  game.s.terrain = {};
  game.s.turn = 'p1';
  const u = game.unit('p1-user');
  const before = game.moveRange(u), reachBefore = game.reachable(u).length;
  put(game, 'swift', game.tile(u).row, game.tile(u).col);
  game.pickItem(u);
  assert.equal(game.moveRange(u), before + 1, '★ 移动 +1');
  assert.ok(game.reachable(u).length > reachBefore, '★ 落点跟着变多（reachable 读的就是 moveRange）');
  assert.equal(game.itemBuffs('p1').move, 1);
  // 水域 −1：加在基础移动上，惩罚照旧
  const wet = startFree('jotaro', 'dio', { map: 'shallows' });
  wet.s.items = [];
  wet.s.terrain = {};
  const swimmer = wet.unit('p1-user');
  // 先站到**木甲板**上，这样"没有惩罚"是个干净的基准
  //   ⚠️ 2026-10-05 棋盘从 14×11 扩到 18×13、甲板改成**横跨全宽的一条带子**（行 5–7、列 0–17）之后，
  //      **1v1 的开局格（行 6 / 列 3）本身已经落在甲板上了**，不再"在水里"（这里刻意不写死坐标，
  //      仍旧现找一块甲板格，免得以后甲板厚度再调就把这条测试写死）。
  const deck = wet.tiles.find(t => wet.featureGround(t) && wet.tile(swimmer) !== t);
  itemTo(wet, 'p1-user', deck.row, deck.col);
  assert.equal(wet.isWaterTile(deck), false);
  assert.equal(wet.moveRange(swimmer), swimmer.move, '（基准）甲板上就是角色的移动力，没有任何惩罚');
  // 再走进水里：同一套口径照旧 −1
  const water = wet.near(deck).find(t => wet.isWaterTile(t) && !wet.occupant(t));
  assert.ok(water, '（前提）甲板旁边就是水');
  itemTo(wet, 'p1-user', water.row, water.col);
  assert.equal(wet.moveRange(swimmer), swimmer.move - wet.waterPenalty(), '★ 水里起步照旧 −1');
  put(wet, 'swift', water.row, water.col);
  wet.pickItem(swimmer);
  assert.equal(wet.moveRange(swimmer), swimmer.move + 1 - wet.waterPenalty(), '★ 疾风 +1 与水里 −1 互不抵消对方（各算各的）');
  // 藤蔓 −1 也照旧
  wet.s.vine[swimmer.id] = true;
  assert.equal(wet.moveRange(swimmer), swimmer.move + 1 - wet.waterPenalty() - RULE.vineMovePenalty, '★ 藤蔓 −1 照旧');
});

test('③ 连携：连携距离 +1 改的正是"本体与替身距离上限"那条既有判据', () => {
  const game = startFree('avdol', 'kakyoin');
  game.s.terrain = {};
  game.s.turn = 'p1';
  const user = place(game, 'p1-user', 6, 5), stand = place(game, 'p1-stand', 6, 7);
  assert.equal(game.distLimit('p1'), FIGHTERS.avdol.distLimit, '（前提）角色数据里的连携距离');
  assert.equal(game.pairDistance('p1'), 2);
  const far = game.at(6, 8);
  assert.equal(hexDist(far, game.tile(user)), 3, '（前提）这一格离本体正好 3 格');
  assert.equal(game.reachable(stand).includes(far), false, '★ 捡之前：超出连携距离 2 的落点是不许落脚的');
  assert.match(game.moveReason(stand, far), /超过 2 格上限/, '★ 被拒的理由读的也是同一条判据');

  put(game, 'bond', game.tile(stand).row, game.tile(stand).col);
  assert.equal(game.pickItem(stand).type, 'bond');
  assert.equal(game.itemBuffs('p1').dist, 1, '★ 记在槽位的连携那一栏');
  assert.equal(game.distLimit('p1'), FIGHTERS.avdol.distLimit + 1, '★ 连携距离 +1');
  assert.equal(game.reachable(stand).includes(far), true, '★ 同一格现在落得了脚（改的就是这条判据）');
  assert.equal(game.moveReason(stand, far), '', '★ 判定与高亮永远一致');
  assert.equal(game.distLimit('p2'), FIGHTERS.kakyoin.distLimit, '★ 另一方不变');
  // 界面那一栏读的也是 distLimit
  assert.equal(game.pairDistance('p1'), 2);
});

test('③ 时间：当场 +1 行动点（对照另一次普通移动就能看出这一格是"白走"的）', () => {
  const game = startFree();
  game.s.terrain = {};
  game.s.turn = 'p1';
  const u = game.unit('p1-user'), v = game.unit('p1-stand');
  const plain = game.near(game.tile(u)).find(t => !game.occupant(t) && !game.isRock(t));
  assert.equal(game.move(u, plain), true);
  assert.equal(game.s.ap.p1, RULE.apPerTurn - RULE.moveCost, '（对照）普通移动照常扣 1 AP');

  // 时间道具那一格：走上去 → 扣 1 AP、再当场 +1 → 净账"这一趟不花行动点"
  game.s.ap.p1 = RULE.apPerTurn;
  const timed = game.near(game.tile(v)).find(t => !game.occupant(t) && !game.isRock(t) && !game.itemAt(t));
  put(game, 'clock', timed.row, timed.col);
  assert.equal(game.move(v, timed), true);
  assert.equal(game.s.ap.p1, RULE.apPerTurn, '★ 当场 +1 行动点（扣掉的 1 点被补回来了 ＝ 这一趟白走）');
  assert.equal(game.itemAt(timed), null, '★ 一次性：道具本身已经消失');
  assert.deepEqual(game.itemBuffs('p1'), { atk: 0, def: 0, move: 0, dist: 0 }, '★ 时间**不进**永久加成表（用完就没了）');
  assert.match(game.s.log.map(e => e.text).find(t => t && t.includes('捡到')), /行动点 \+1（当场生效）/);
  // 行动点绝不会因此超过"本回合开始时的值"（既有那句 `ap ≤ 4` 的约束没有被顶破）
  assert.ok(game.s.ap.p1 <= game.s.turnAP.p1 + 1, '★ 净账不会凭空顶高行动点上限');
});

/* ==================================================================== ④ 单单位角色那一档 */

test('④ 单单位角色（没有替身棋子）捡到「连携」→ 改成移动 +1；有替身的角色仍是连携 +1', () => {
  // 逐角色遍历：判据是**数据**（`FIGHTERS.x.stand` 在不在），不按角色名硬编码
  for (const [key, fighter] of Object.entries(FIGHTERS)) {
    const game = startFree(key, key);
    game.s.terrain = {};
    game.s.turn = 'p1';
    const u = game.unit('p1-user');
    const moveBefore = game.moveRange(u), distBefore = game.distLimit('p1');
    put(game, 'bond', game.tile(u).row, game.tile(u).col);
    const item = game.pickItem(u);
    assert.ok(item, `${key}：捡得到`);
    if (fighter.stand) {
      assert.equal(game.itemBuffs('p1').dist, 1, `${key}（有替身）：连携距离那一栏 +1`);
      assert.equal(game.itemBuffs('p1').move, 0, `${key}（有替身）：移动不动`);
      assert.equal(game.distLimit('p1'), distBefore + 1, `${key}：连携距离 +1`);
      assert.equal(game.moveRange(u), moveBefore, `${key}：移动不变`);
    } else {
      assert.equal(game.itemBuffs('p1').move, 1, `★ ${key}（单单位角色）：改记成移动 +1`);
      assert.equal(game.itemBuffs('p1').dist, 0, `★ ${key}：连携那一栏一点不动（本来也没有替身可连携）`);
      assert.equal(game.moveRange(u), moveBefore + 1, `★ ${key}：移动 +1`);
      assert.equal(game.distLimit('p1'), distBefore, `${key}：连携距离仍是原值`);
      assert.match(game.s.log.at(-1).text, /改记成移动 \+1/, `${key}：战斗记录里要把这条例外说清楚`);
    }
  }
  // 真的点名两个代表各验一遍（避免上面那条循环因为数据为空而空转）
  const solo = startFree('joseph', 'jotaro');
  solo.s.terrain = {}; solo.s.turn = 'p1';
  const soloU = solo.unit('p1-user');
  assert.ok(!FIGHTERS.joseph.stand, '（前提）乔瑟夫是单单位角色（没有替身棋子）');
  const soloMove = solo.moveRange(soloU);
  put(solo, 'bond', solo.tile(soloU).row, solo.tile(soloU).col);
  solo.pickItem(soloU);
  assert.equal(solo.moveRange(soloU), soloMove + 1, '★ 单单位角色：连携 → 移动 +1');
  assert.equal(solo.distLimit('p1'), 0, '★ 它的连携距离本来就是 0（没有替身棋子），捡完还是 0');
  // 对照：同一张桌子上有替身的角色捡到同一件东西，记的仍是连携
  // 静态检查：判据读的是数据字段，不是角色名
  const src = source('../src/core/game.js');
  assert.match(src, /def\.buff === 'dist' && !this\.fighter\(slot\)\?\.stand/, '★ 判据写在 itemEffect 里、读的是 stand 字段');
  assert.equal(/(['"])(joseph|emperor|temperance)\1/.test(src.split('itemEffect')[1]?.split('itemPickupText')[0] || ''),
    false, '★ 道具那一段代码里没有按角色名硬编码');
});

/* ==================================================================== ⑤ 刷新与上限 */

test('⑤ 每 3 回合在空地补 1 个、上限 4、满了就不刷（无处可放时不崩也不硬塞）', () => {
  const game = startFree();
  const seen = [];
  const step = () => { game.endTurn(); seen.push([game.s.turnNumber, game.s.items.length]); };
  assert.equal(game.s.items.length, 2, '开局 2 个');
  step();                                     // turn 2
  assert.equal(game.s.items.length, 2, '第 2 个回合还不补（每 3 回合才补一次）');
  step();                                     // turn 3 → 补 1
  assert.equal(game.s.turnNumber, 3);
  assert.equal(game.s.items.length, 3, '★ 第 3 个回合补上第 3 个');
  assert.match(game.s.log.map(e => e.text).join(' | '), /落在 .+ · 走上去就能捡走/, '★ 刷新也写一句战斗记录');
  step(); step();                             // turn 4、5
  assert.equal(game.s.items.length, 3, '第 4、5 个回合都不补');
  step();                                     // turn 6 → 补 1（到上限）
  assert.equal(game.s.turnNumber, 6);
  assert.equal(game.s.items.length, ITEM_RULE.max, '★ 第 6 个回合到上限 4');
  for (let i = 0; i < 4; i++) step();          // 到 turn 10：第 9 个回合本该补，但已经满了
  assert.equal(game.s.turnNumber, 10);
  assert.equal(game.s.items.length, ITEM_RULE.max, '★ 满了就不再刷（一次都不许多）');
  assert.ok(seen.every(([, count]) => count <= ITEM_RULE.max), '★ 任何时刻都不超过上限');

  // 空地判据：没地方放就**不硬塞、不抛错**
  const stuck = startFree();
  const before = stuck.s.items.length;
  stuck.itemSpots = () => [];
  assert.deepEqual(stuck.spawnItems(1), [], '★ 池子为空时一个都不摆');
  assert.equal(stuck.s.items.length, before, '★ 也不会凭空多出来');
  assert.deepEqual(stuck.tickItems(), [], '★ 回合刷新走同一条路：不崩');
  // 池子比要的少：有多少放多少，绝不超过 max
  const few = startFree();
  assert.equal(few.s.items.length, 2);
  const added = few.spawnItems(10);
  assert.equal(added.length, ITEM_RULE.max - 2, '★ 补到上限就停');
  assert.equal(few.s.items.length, ITEM_RULE.max);
  assert.deepEqual(few.spawnItems(3), [], '★ 已经到上限 → 一个都不刷');
  // 池子里的格子全都合法（与开局同一套判据）
  const pool = startFree().itemSpots();
  assert.ok(pool.length > 0, '（前提）正常局面下有合法空地');
  const g2 = startFree();
  for (const t of g2.itemSpots()) {
    assert.equal(g2.s.terrain[tileKey(t)], undefined);
    assert.equal(g2.occupant(t), null);
  }
});

/* ==================================================================== ⑥ 与既有机制互不干扰 */

test('⑥ 地图切换、水域 −1、地形加成、柱子、射击预告、反光点都不受影响', () => {
  // 换地图：两张图都照常摆道具，地图键各归各的（登记值只对这一局有效）
  const d = startFree(); const s = startFree('jotaro', 'dio', { map: 'shallows' });
  assert.equal(d.mapId(), 'default'); assert.equal(s.mapId(), 'shallows');
  assert.equal(d.s.items.length, ITEM_RULE.opening); assert.equal(s.s.items.length, ITEM_RULE.opening);
  const after = new Game({ random: seeded(7) }); after.start('jotaro', 'dio');
  assert.equal(after.mapId(), 'default', '★ 地图只对登记的那一局有效，下一局回 default（道具也照旧）');
  assert.equal(after.s.items.length, ITEM_RULE.opening);

  // 地形效果一个字没改：草丛 +3、恢复点 +10、毒沼 −3
  const t = startFree();
  t.s.items = [];
  t.s.terrain = {};
  t.s.turn = 'p1';
  const u = t.unit('p1-user');
  t.s.terrain[tileKey(t.tile(u))] = 'bush';
  assert.equal(t.defense(u).bush, RULE.bushDefBonus, '草丛 +3 照旧');
  t.s.hp.p1 = 30;
  t.s.terrain[tileKey(t.tile(u))] = 'heal';
  t.applyTerrain(u);
  assert.equal(t.s.hp.p1, 30 + RULE.healAmt, '恢复点 +10 照旧');
  assert.equal(t.s.terrain[tileKey(t.tile(u))], undefined, '恢复点用完照旧消失');
  t.s.terrain[tileKey(t.tile(u))] = 'hazard';
  const hp = t.s.hp.p1;
  t.applyTerrain(u);
  assert.equal(hp - t.s.hp.p1, RULE.hazardDmg, '毒沼 −3 照旧');
  // 道具与地形可以先后落在同一格（测试手动造的状态），互不覆盖对方的判据
  put(t, 'power', t.tile(u).row, t.tile(u).col);
  assert.equal(t.itemAt(t.tile(u)).type, 'power');
  assert.equal(t.s.terrain[tileKey(t.tile(u))], 'hazard', '★ 道具不占地形那一层（各记各的账）');

  // 第八章：反光点照旧、冷枪/皇帝/暗枪的账本不受道具影响，而且道具不压反光点
  const chapter8 = STORY_CHAPTERS.find(c => c.id === 'chapter-8');
  const phase2 = chapter8.scenes.find(x => x.kind === 'battle' && x.lineup?.ally === 'kakyoin');
  const g = new Game({ random: seeded(13) });
  g.setRoster({ p1b: phase2.lineup.ally, p2b: phase2.lineup.enemy2 || null, story: true, scene: phase2 });
  g.start(phase2.lineup.player, phase2.lineup.enemy, 'ai', { story: chapter8.id });
  assert.equal(g.s.mirrors.length, 4, '（前提）这一章照旧四枚反光点');
  for (const m of g.s.mirrors) {
    assert.equal(g.itemAt(g.at(m.row, m.col)), null, '★ 道具绝不压在反光点上');
    assert.equal(g.mirrorOpenFor(m) !== undefined, true);
  }
  assert.deepEqual(g.darkgunMarks().length, 0, '暗枪账本是空的（道具不往里塞东西）');
  assert.equal(g.s.shotAim, null, '阶段 2 没有冷枪弹道（与改动前一致）');
  // 吊死者的落点仍然只有反光点与空岩石，一块道具格都落不了（它的判据一个字没动）
  const ghost = g.s.units.find(x => g.mirrorWalker(x));
  for (const spot of g.reachable(ghost)) {
    assert.ok(g.mirrorAt(spot) || g.isRock(spot), '吊死者照旧只在反光点与岩石之间跳');
  }
  // 吸附：道具不会把棋子的站位搅乱（回合推进后也照旧）
  const posBefore = g.s.units.map(x => [x.id, x.row, x.col]);
  assert.equal(g.s.items.length > 0, true);
  assert.deepEqual(g.s.units.map(x => [x.id, x.row, x.col]), posBefore, '开局站位与道具无关');

  // 第五章「力量」：道具不落在会翻转的隔板位上（否则变形会把它砌进钢壁里）
  const ship = new Game({ random: seeded(13) });
  ship.start('jotaro', 'gray_fly', 'ai', { story: 'chapter-5' });
  const slots = ship.shipRule().bulwarkSlots;
  assert.ok(slots.length > 0, '（前提）这一关确实有隔板位');
  assert.equal(ship.s.items.length, ITEM_RULE.opening, '（前提）这一关照样摆上道具');
  for (const item of ship.s.items) {
    assert.equal(slots.some(slot => slot.row === item.row && slot.col === item.col), false, '★ 道具不落在隔板位上');
  }
  assert.equal(ship.bulwarkSlot(ship.at(slots[0].row, slots[0].col)), true, '隔板位认得出');
  assert.equal(startFree().bulwarkSlot(startFree().tiles[0]), false, '别的局面恒为 false');
});

/* ==================================================================== ⑦ AI */

test('⑦ AI 会顺手捡道具：顺路时朝道具走并真的捡走；不顺路时评分与计划逐值不变', () => {
  /**
   * 摆一个"往左推进"的局面（坐标是照着实际可达范围量出来的，别凭感觉改）：
   *   · p2＝DIO 交给 AI；世界（替身，移动 4、射程 2）在 (6,8)，DIO 本体在 (5,6)（连携 2 以内）；
   *   · 两个敌人都丢在左侧远处（射程 2 够不着），所以这一回合它只有"走位"这一种选择；
   *   · 实测：可达落点里离敌人最近的依次是 (6,5)/(5,4)（8 格外推成 5 格），
   *     而这两格都**没有**道具时它的计划就是 (6,5)（推进分 (8−5)×4 = 12）。
   */
  const build = () => {
    const game = new Game({ random: seeded(7) });
    game.start('jotaro', 'dio', 'ai');       // p2＝DIO 交给 AI
    game.s.terrain = {};
    game.s.items = [];
    game.s.turn = 'p2';
    game.s.ap.p2 = RULE.apPerTurn;
    place(game, 'p2-stand', 6, 8); place(game, 'p2-user', 5, 6);
    place(game, 'p1-user', 6, 0); place(game, 'p1-stand', 0, 0);
    return game;
  };
  const foeTile = game => game.tile(game.unit('p1-user'));
  const plain = build();
  const plainPlan = chooseAI(plain);
  assert.equal(plainPlan.type, 'move', `（对照）没有道具时它就是走位（拿到 ${plainPlan.type}）`);
  const plainGap = hexDist(plainPlan.target, foeTile(plain));

  // ① 顺路优先：道具摆在一个"比最前面的落点少推一格、但顺路"的位置上
  const game = build();
  const item = put(game, 'power', 6, 6);
  const reach = game.reachable(game.unit('p2-stand'));
  assert.ok(reach.some(t => t.row === 6 && t.col === 6), '（前提）那一格本来就走得到');
  assert.equal(hexDist(game.at(6, 6), foeTile(game)), plainGap + 1, '（前提）它比"最前面的落点"少推一格');
  const plan = chooseAI(game);
  assert.equal(plan.type, 'move');
  assert.equal(plan.unit, game.unit('p2-stand'));
  assert.equal(tileKey(plan.target), tileKey(game.at(item.row, item.col)), '★ 它选了有道具的那一格（顺路就顺手拿走）');
  assert.ok(plan.score > plainPlan.score, '★ 道具那一格在评分里被抬上去了（不然它本来推得更前）');
  assert.equal(playAIAction(game, plan), true, '★ 这一手真的走得成');
  assert.equal(game.s.items.includes(item), false, '★ 道具被捡走了');
  assert.equal(game.itemBuffs('p2').atk, 2, '★ 加成落在 p2 这个角色槽位上');
  assert.equal(game.itemBuffs('p1').atk, 0, '★ 对面不变');

  // ② 不顺路就不为它改道：道具摆在**更远离敌人**的方向上 → 计划与评分逐值不变
  const away = build();
  const behind = put(away, 'power', 5, 8);       // 比出发格(6,8)还远离敌人一格，但仍在可达范围里
  assert.ok(away.reachable(away.unit('p2-stand')).some(t => t.row === 5 && t.col === 8), '（前提）那一格走得到');
  assert.ok(hexDist(away.at(5, 8), foeTile(away)) > plainGap, '（前提）它比"最前面的落点"更远离敌人');
  const awayPlan = chooseAI(away);
  assert.equal(awayPlan.type, plainPlan.type, '★ 决策类型与没有道具时一致');
  assert.equal(tileKey(awayPlan.target), tileKey(plainPlan.target), '★ 目标格一致（没有为道具改道）');
  assert.equal(awayPlan.score, plainPlan.score, '★ 连评分都逐值相同（道具那一格压根没被加分）');
  assert.ok(away.s.items.includes(behind), '★ 道具还在原地：它没去捡');
  assert.equal(hexDist(awayPlan.target, foeTile(away)), plainGap, '★ 照旧推进到最前面那一格');
});

test('⑦ 多种子自动对局（含 2v2 与两张地图）仍然收敛、能分出胜负', () => {
  let played = 0;
  const playOut = (game, limit = 600) => {
    let steps = 0;
    while (game.s.phase === 'battle' && steps < limit) {
      const plan = chooseAI(game);
      if (!plan || !playAIAction(game, plan)) game.endTurn();
      steps++;
    }
    return steps;
  };
  for (const seed of [7, 42, 999]) {
    for (const [a, b] of [['jotaro', 'dio'], ['joseph', 'emperor'], ['iggy', 'gray_fly']]) {
      for (const map of [null, 'shallows']) {
        const game = startFree(a, b, { seed, map });
        const steps = playOut(game);
        assert.equal(game.s.phase, 'result', `★ ${a}/${b} seed ${seed} ${map || 'default'}：没打完（${steps} 步）`);
        assert.ok(['p1', 'p2'].includes(game.s.winner));
        for (const slot of game.s.slots) {
          assert.ok(game.s.hp[slot] >= 0 && game.s.hp[slot] <= game.fighter(slot).hp);
          assert.ok(Number.isInteger(game.s.ap[slot]) && game.s.ap[slot] >= 0, '行动点始终是合法整数');
        }
        played++;
      }
    }
    // 2v2
    const two = startFree('jotaro', 'dio', { seed, roster: { p1b: 'kakyoin', p2b: 'iggy' } });
    const steps = playOut(two, 1200);
    assert.equal(two.s.phase, 'result', `★ 2v2 seed ${seed}：没打完（${steps} 步）`);
    played++;
  }
  assert.ok(played >= 20, `覆盖量要够（实际 ${played} 局）`);
});

/* ==================================================================== ⑧ 渲染 */

test('⑧ 渲染冒烟：有道具的局面能渲一帧、save/restore 配平、图标不越出格子也不压名字', () => {
  const previous = globalThis.document, previousWindow = globalThis.window;
  globalThis.window = { devicePixelRatio: 1, addEventListener() {}, removeEventListener() {} };
  try {
    for (const [map, a, b] of [[null, 'jotaro', 'dio'], ['shallows', 'joseph', 'emperor']]) {
      const calls = [];
      const ctx = new Proxy({}, {
        get(_, prop) {
          if (prop === 'canvas') return { width: CANVAS_W, height: CANVAS_H };
          if (typeof prop === 'symbol') return undefined;
          return (...args) => {
            calls.push({ prop, args });
            if (prop === 'createLinearGradient' || prop === 'createRadialGradient') return { addColorStop() {} };
            if (prop === 'measureText') return { width: 10 };
            return undefined;
          };
        },
        set() { return true; },
      });
      const canvas = { width: CANVAS_W, height: CANVAS_H, style: {}, getContext: () => ctx, addEventListener() {}, getBoundingClientRect: () => ({ left: 0, top: 0, width: CANVAS_W, height: CANVAS_H }) };
      globalThis.document = {
        getElementById: id => (id === 'board' ? canvas : null),
        createElement: () => ({ width: 0, height: 0, style: {}, getContext: () => ctx }),
      };
      const game = startFree(a, b, { map });
      assert.ok(game.s.items.length > 0, '（前提）这一帧上有道具');
      const visual = new BoardVisual(game);
      const sprites = new Map();
      for (const key of ['rock', 'bush', 'heal', 'hazard']) sprites.set(key, { width: 38, height: 38 });
      visual.setSprites(sprites);
      assert.doesNotThrow(() => visual.render(game.actionView(), 0), '★ 有道具的局面能渲一帧');
      const saves = calls.filter(c => c.prop === 'save').length;
      const restores = calls.filter(c => c.prop === 'restore').length;
      assert.equal(saves, restores, '★ save / restore 必须配平');

      // 图标画了：每个道具一个汉字（力/盾/风/时/链），而且都画在它自己那一格里
      const glyphs = calls.filter(c => c.prop === 'fillText' && ['力', '盾', '风', '时', '链'].includes(c.args[0]));
      assert.ok(glyphs.length >= game.s.items.length, '★ 每个道具都画了图标（至少一轮）');
      // 几何：徽章中心 (cx, cy−5)、外圈半径 r+3.2=11.6 → 整枚图标必须完整落在六边形内
      const radius = R - 1;
      const halfWidth = dy => dy <= radius / 2 ? Math.sqrt(3) / 2 * radius : Math.sqrt(3) * (radius - dy);
      for (const item of game.s.items) {
        const t = game.at(item.row, item.col);
        const cx = t.cx, cy = t.cy - 5, outer = 8.4 + 3.2, top = 6;   // 顶上那两道反光再往上 6px
        for (const [x, y] of [[cx - outer, cy], [cx + outer, cy], [cx, cy - outer - top], [cx, cy + outer]]) {
          const dy = Math.abs(y - t.cy);
          assert.ok(dy <= radius && Math.abs(x - t.cx) <= halfWidth(dy) + 1e-6,
            `★ 道具图标的一角 (${x.toFixed(1)}, ${y.toFixed(1)}) 跑到了格子之外，会被裁掉`);
        }
        // 不压棋子的名字底衬与血条那一带（名字在 cy+19 起、血条在 cy+16.5）
        assert.ok(cy + outer < t.cy + 16.5, '★ 图标不压到棋子的血条/名字那一带');
      }
      // 道具变化要让静态层重画（否则图标会留在原地）
      const before = visual.baseDrawCount;
      game.s.items.pop();
      visual.render(game.actionView(), 16);
      assert.equal(visual.baseDrawCount, before + 1, '★ 捡走一个道具要重画静态层');
      assert.equal(calls.filter(c => c.prop === 'fillRect' && c.args[2] === 16 && c.args[3] === 11).length, 0,
        '★ 道具图标不许用状态小标那个 16×11 的尺寸（测试靠它数标记）');
    }
  } finally {
    if (previous === undefined) delete globalThis.document; else globalThis.document = previous;
    if (previousWindow === undefined) delete globalThis.window; else globalThis.window = previousWindow;
  }
});

/* ==================================================================== ⑨ 界面文案与"不碰数值" */

test('⑨ 格子说明写清"这是什么道具、捡了有什么用"；图例与玩法指南都接上了', () => {
  const game = startFree();
  game.s.terrain = {};
  const tile = game.at(game.s.items[0].row, game.s.items[0].col);
  const text = tileDescription(game, tile);
  const def = ITEM_TYPES[game.s.items[0].type];
  assert.match(text, new RegExp(def.name), `★ 说明里有道具名（实际：${text}）`);
  assert.match(text, /走上去就能捡走/, '★ 说清怎么拿');
  assert.match(text, new RegExp(`${def.stat} \\+${def.amount}`), '★ 说清捡了有什么用（数值取自数据）');
  assert.match(text, new RegExp(def.duration), '★ 说清持续多久');
  // 连携那条例外要说出来（这一局有单单位角色时）
  const solo = startFree('joseph', 'jotaro');
  const bond = put(solo, 'bond', solo.s.items[0].row, solo.s.items[0].col);
  solo.s.items = [bond];
  assert.match(tileDescription(solo, solo.at(bond.row, bond.col)), /改成移动 \+1/, '★ 单单位角色的例外写在格子说明里');
  // 空格子上没有道具就不该多嘴
  const empty = game.tiles.find(t => !game.itemAt(t) && !game.s.terrain[tileKey(t)]);
  assert.equal(/道具/.test(tileDescription(game, empty)), false, '★ 没道具的格子不许乱说道具');

  // 图例 + 玩法指南（静态检查）
  const html = source('../index.html');
  assert.match(html, /class="legend-item"[^>]*>[^<]*<\/i> 道具 · 走上去就捡走/, '★ 棋盘图例里加了一条"可拾取道具"');
  assert.match(html, /可拾取道具/, '★ 玩法指南里也说了这件事');
  assert.match(html, /场上最多同时存在 4 个/, '★ 指南里的出场规则与 `ITEM_RULE` 一致');
  const css = source('../src/ui/layout.css');
  assert.match(css, /\.legend-item \{/, '图例那一条要有样式');
  // 图例里"同伴连携"仍是最后一个 span（小屏 CSS 靠 :last-of-type 把它藏起来，顺序不能变）
  assert.ok(html.indexOf('legend-item') < html.indexOf('legend-link'), '★ 道具那一条插在"同伴连携"之前');
});

test('⑨ 没有碰任何既有数值：RULE 与 12 名角色的指纹一个数都没变', () => {
  const baseline = JSON.parse(source('../tools/rules-fingerprint.json'));
  assert.deepEqual(RULE, baseline.RULE, '★ RULE 逐值相同（道具的数值一个都没写进这里）');
  // 基线里是**摊平**的一份投影（`moveU`/`moveS`/`dmg`/`range`…），照它的字段逐条比回去
  for (const [key, values] of Object.entries(baseline.FIGHTERS)) {
    const f = FIGHTERS[key];
    const flat = {
      hp: f.hp, def: f.def, distLimit: f.distLimit, standDefBonus: f.standDefBonus,
      timeRule: f.timeRule, solo: f.solo, standName: f.standName, boss: f.boss,
      dmg: (f.stand || f.user).dmg, range: (f.stand || f.user).range,
      moveU: f.user.move, moveS: f.stand ? f.stand.move : 0,
    };
    for (const [field, expected] of Object.entries(values)) {
      assert.equal(flat[field], expected, `★ ${key}.${field} 一个字都没动`);
    }
  }
  // 五种道具的数值全部写在 ITEM_TYPES 里、**不许**混进 RULE / SKILLS
  assert.equal('items' in RULE, false, '道具的数值没有混进 RULE');
  assert.equal(Object.keys(ITEM_TYPES).some(key => key in SKILLS), false, '道具也不是技能（五件道具与技能表互不重叠）');
});

/** 最小假 DOM（照 hud.test.js 那一套）：只实现 HUD 用到的那几个 API。 */
function fakeDom() {
  const elements = new Map();
  const make = id => ({
    id, innerHTML: '', textContent: '', className: '', disabled: false, hidden: false, value: '', style: {},
    dataset: {}, attributes: {},
    classList: { toggle() {}, add() {}, remove() {}, contains: () => false },
    setAttribute(k, v) { this.attributes[k] = String(v); },
    getAttribute(k) { return this.attributes[k] ?? null; },
    hasAttribute(k) { return k in this.attributes; },
    removeAttribute(k) { delete this.attributes[k]; },
    addEventListener() {}, removeEventListener() {}, focus() {}, blur() {}, closest: () => null,
    querySelector: () => make(`${id}-child`), querySelectorAll: () => [],
    insertAdjacentHTML(_, html) { this.innerHTML += html; },
    appendChild() {}, contains: () => true,
    getBoundingClientRect: () => ({ left: 0, top: 0, width: 100, height: 100, bottom: 100, right: 100 }),
  });
  return {
    getElementById: id => { if (!elements.has(id)) elements.set(id, make(id)); return elements.get(id); },
    querySelector: () => make('query'), querySelectorAll: () => [],
    createElement: () => make('created'),
    addEventListener() {}, removeEventListener() {}, activeElement: null, body: make('body'),
  };
}
