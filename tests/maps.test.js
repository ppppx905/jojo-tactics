/**
 * ★★ 2026-10-05 用户拍板：**地图（MAP）体系**。
 *
 * 用户的定义：**一张地图 ＝ 一套地形布局 ＋ 配套背景画**，而且每张地图要能体现出自己的特点
 * （打起来手感不一样）。棋盘尺寸**保持不变**（仍是 18×13，见 hex.js）。
 * 本次落地的两张：
 *   · `default`＝沿用改动前那一套（地形撒法 ＋ 默认深色底），**行为必须与改动前逐值一致**；
 *   · `shallows`「浅滩水路」＝大片水面 ＋ **画面正中横着一条全宽的木甲板**（2026-10-05 用户拍板：
 *     甲板从"正中一小块 4×5"改成"横跨左右全宽、厚 3 行"的一条带子＝54 格；这张图**不刷毒沼**）
 *     ＋ 配套背景 `sea`，特点是「**水里的玩家方移动 −1**」（沿用第四章那条既有口径：
 *     只看"开始移动那一刻"在哪、只影响玩家方、甲板上照常）。
 *
 * 这个文件按验收标准的六条逐条落断言：
 *   ① `MAPS` 注册表结构完整，且 **default 与改动前逐值一致**（逐格比对地形，见下面那份"旧算法"）；
 *   ② `shallows`：水占多数、**甲板是一条全宽带子且居中（54 格 / 行 5~7 / 垂直对称于 `MID_ROW`）**、
 *      水里玩家方 −1、敌方不受影响、甲板上满移动、**不刷毒沼**；
 *   ③ PvP 选地图：默认 default；选 shallows 后地形/背景/水规则都生效；`?map=` 能指定；非法名字兜底；
 *   ④ 第四章跟着新数据走（甲板范围/开局水陆分布按 54 格的带子算，水规则与观感仍是同一套）；
 *   ⑤ 两张地图上多种子自动对局（含全配对抽样）全部收敛；
 *   ⑥ 渲染冒烟：两张地图各渲一帧不抛错、save/restore 配平。
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {
  Game, MAPS, DEFAULT_MAP_ID, resolveMapId, mapList, deckRectOf, SEA_DECK,
  FIGHTERS, STORY_CHAPTERS, RULE, playableFighters, teamOf,
} from '../src/core/game.js';
import { COLS, ROWS, MID_ROW, HX, R, CANVAS_W, CANVAS_H, tileKey, hexDist } from '../src/core/hex.js';
import { chooseAI, playAIAction } from '../src/core/ai.js';
import { ARENAS, CHARACTER_ART, artKeys } from '../src/ui/assets.js';
import { SPRITES, BoardVisual } from '../src/ui/render.js';

function seeded(seed = 7) { return () => ((seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0) / 4294967296); }
const place = (game, id, row, col) => Object.assign(game.unit(id), { row, col });
const chapter = id => STORY_CHAPTERS.find(c => c.id === id);
/** 开局：`map` 走 setMap 登记（与大厅同一条路），剧情走章节自带的地图。 */
function startFree(a, b, map = null, { seed = 7, mode = 'ai' } = {}) {
  const game = new Game({ random: seeded(seed) });
  if (map) game.setMap(map);
  game.start(a, b, mode);
  return game;
}
/** 地形计数（默认地图的元素就这四种）。 */
function terrainCounts(game) {
  const counts = {};
  for (const type of Object.values(game.s.terrain)) counts[type] = (counts[type] || 0) + 1;
  return counts;
}

/* ==================================================================== ① 注册表 + default 逐值一致 */

test('① 地图注册表：每张地图都有 id/name/arena/terrain/features，且数据自洽', () => {
  assert.ok(MAPS[DEFAULT_MAP_ID], '★ 必须有 default 这张地图（它是"沿用现在这一套"的落点）');
  assert.deepEqual(Object.keys(MAPS), ['default', 'shallows'], '本次先做两张（结构上以后加图只改这份数据）');
  for (const [key, map] of Object.entries(MAPS)) {
    assert.equal(map.id, key, `${key}：id 必须与注册表的键一致`);
    assert.equal(typeof map.name, 'string');
    assert.ok(map.name.length, `${key}：要有给玩家看的名字`);
    assert.equal('arena' in map, true, `${key}：要有 arena 字段（背景素材键；没有背景就是 null）`);
    assert.equal(typeof map.terrain, 'object', `${key}：要有地形撒法数据`);
    assert.equal(typeof map.features, 'object', `${key}：要有特性对象（没有特性就是 {}）`);
    // 地形数量必须是**非负整数**基线（撒法由 game.js 按面积换算，这里只存基线）。
    // ★★ 2026-10-05（本次改动）：原来是"必须 > 0"，被"**浅滩水路不刷毒沼**（`hazard: 0`）"
    //    这条用户拍板直接推翻——0 现在是一个**合法且有明确含义**的值（＝这张图不撒这一种），
    //    但"不许是负数/小数/认不出的元素名"这三条**一个字都没放松**。
    //    ⚠️ "不许把某一种地形从体系里删掉"这件事改由下面那条 mapList 级的断言守着
    //      （毒沼这个地形本身必须还在：`default` 里照旧 3 块基线 > 0）。
    for (const [type, base] of Object.entries(map.terrain)) {
      assert.ok(Number.isInteger(base) && base >= 0, `${key}：地形 ${type} 的基线要是非负整数，现在是 ${base}`);
      assert.ok(['rock', 'bush', 'heal', 'hazard'].includes(type), `${key}：认不出的地形元素 ${type}`);
    }
    assert.ok(Object.values(map.terrain).some(base => base > 0), `${key}：一张图总得撒点什么地形`);
    // arena 必须真的是一张登记过的背景素材（否则大厅选了图、背景却是空的）
    if (map.arena) {
      assert.ok(ARENAS[map.arena], `${key}：arena「${map.arena}」必须登记在 ui/assets.js 的 ARENAS 里`);
      assert.ok(SPRITES[`arena:${map.arena}`], `${key}：背景 ${map.arena} 必须能进 SPRITES，否则不会被加载`);
    }
  }
  // 毒沼这个**地形本身**没被删：别的图（default）还照旧在用它
  assert.equal(MAPS.default.terrain.hazard, 2, '★ 毒沼没有被删掉——default 上还是那条基线 2（18×13 上 3 块）');
  // 注册表的两个纯函数：列出全部地图 / 认不出的键一律兜底成 default（绝不抛错）
  assert.deepEqual(mapList().map(m => m.id), Object.keys(MAPS));
  for (const bad of [undefined, null, '', 'nope', 42, {}, 'Map', 'SHALLOWS']) {
    assert.equal(resolveMapId(bad), DEFAULT_MAP_ID, `认不出的地图值 ${String(bad)} 要兜底成 default`);
  }
  assert.equal(resolveMapId('shallows'), 'shallows');
  // 没有水域特性的地图算不出甲板（deckRectOf 返回 null，不是"整张棋盘都是甲板"）
  assert.equal(deckRectOf(MAPS.default), null);
  assert.equal(deckRectOf(null), null);
});

test('① default 地图的地形数据就是改动前那份基线，18×13 上仍是 岩石 9 / 草丛 6 / 恢复点 3 / 毒沼 3', () => {
  const OLD_TERRAIN_BASE = { rock: 6, bush: 4, heal: 2, hazard: 2 };   // 改动前写死在 game.js 里的那份
  const OLD_BASE_AREA = 154;                                          // 14×11
  assert.deepEqual(MAPS.default.terrain, OLD_TERRAIN_BASE, '★ 基线一个数都没改（只是从 game.js 搬进了地图数据）');
  const ratio = (COLS * ROWS) / OLD_BASE_AREA;
  const expected = Object.fromEntries(Object.entries(OLD_TERRAIN_BASE)
    .map(([type, base]) => [type, Math.max(base, Math.round(base * ratio))]));
  assert.deepEqual(expected, { rock: 9, bush: 6, heal: 3, hazard: 3 }, '18×13 上仍是这四个数');
  for (const seed of [7, 42, 20261005]) {
    const game = startFree('avdol', 'kakyoin', null, { seed });
    assert.deepEqual(terrainCounts(game), expected, `seed ${seed}：default 地图的地形数量`);
  }
});

/**
 * ★★ 「default 与改动前逐值一致」的**硬证据**：把改动前那段 `generateTerrain()` 原样重写一遍，
 *    用**同一个随机序列**跑出结果，再逐格比对。
 *
 * 怎么保证"同一个随机序列"：给引擎的随机器套一层记录器，把 `start()` 期间消耗掉的随机值全记下来。
 *
 * ⚠️⚠️ **2026-10-05 加"可拾取道具"之后，这条测试原来那句断言被直接推翻**：
 *    原文写的是「地形生成是这些对局里**唯一的随机消费者**」（于是"记录到的个数正好等于
 *    `候选格数 − 1`"），而**道具的随机摆放也要消耗随机数**，所以那个等式不再成立。
 *    ⚠️ 它要守的东西**一个字都没变**：**default 的地图地形仍与改动前逐格一致**。所以改成两条
 *    等效而且更准确的断言（第 ①、② 条）：
 *      ① **关掉道具**（把 `spawnItems` 在这一局上打桩成空操作）时，地形仍是唯一的消费者
 *         —— `drawn.length === 候选格数 − 1`，原文那句一字未改地留在这里；
 *      ② **开着道具**（真实开局）时，**地形那一趟消耗的正好是前 `候选格数 − 1` 个随机值**——
 *         因为 `generateTerrain()` 排在 `spawnItems()` **之前**，道具只是"接着往下消耗"，
 *         绝不会回头影响地形。于是"逐格重放旧算法"照样能逐值比对（下面第 ③ 步）。
 */
test('① default 地图的地形与改动前的算法逐格一致（同一随机序列重放旧算法比对）', () => {
  const OLD_TERRAIN_BASE = { rock: 6, bush: 4, heal: 2, hazard: 2 };
  const OLD_BASE_AREA = 154;
  /** 带记录的随机器：值与纯种子的随机器一模一样，只多记一份流水。 */
  function recorder(seed) {
    let state = seed >>> 0;
    const drawn = [];
    return { random: () => { const v = ((state = (Math.imul(state, 1664525) + 1013904223) >>> 0) / 4294967296); drawn.push(v); return v; }, drawn };
  }
  for (const seed of [7, 42, 999, 20261005]) {
    // ① 道具关掉的那一局：地形生成仍是这个开局里**唯一的随机消费者**（原文那句断言，一字没动）
    const quiet = recorder(seed);
    const plain = new Game({ random: quiet.random });
    plain.spawnItems = () => [];                       // 打桩：这一局一个道具都不发
    plain.start('jotaro', 'dio');
    const spawn = plain.s.units.map(u => plain.tile(u));
    const open = plain.tiles.filter(t => spawn.every(st => hexDist(st, t) > 1));
    assert.equal(plain.s.items.length, 0, `seed ${seed}：（对照前提）这一局确实没有道具`);
    assert.equal(quiet.drawn.length, open.length - 1,
      `seed ${seed}：没有道具时，地形生成应当是这个开局里唯一的随机消费者（洗牌消耗 候选格数−1 个随机值）`);

    // ② 真实开局（**带道具**）：地形那一趟只能消耗前 (候选格数 − 1) 个随机值
    const noisy = recorder(seed);
    const game = new Game({ random: noisy.random });
    game.start('jotaro', 'dio');
    assert.ok(noisy.drawn.length >= open.length - 1,
      `seed ${seed}：地形至少要消耗 候选格数−1 个随机值（实际 ${noisy.drawn.length}）`);
    assert.ok(game.s.items.length > 0, `seed ${seed}：★ 开局就该摆上道具（见 ITEM_RULE.opening）`);
    assert.deepEqual(game.s.terrain, plain.s.terrain,
      `seed ${seed}：★ 道具的随机摆放**不许影响地形**——开着道具与关着道具的地形必须逐格相同`);

    // ③ 重放旧算法：候选格＝全部格子 − 出生点邻格（**旧口径没有"甲板不撒"这一条**）
    for (let i = open.length - 1; i > 0; i--) {
      const j = Math.min(i, Math.floor(noisy.drawn[open.length - 1 - i] * (i + 1)));
      [open[i], open[j]] = [open[j], open[i]];
    }
    const ratio = (COLS * ROWS) / OLD_BASE_AREA;
    const expected = {};
    for (const [type, base] of Object.entries(OLD_TERRAIN_BASE)) {
      const count = Math.max(base, Math.round(base * ratio));
      for (let i = 0; i < count; i++) expected[tileKey(open.pop())] = type;
    }
    // ④ 逐格比对（键与值都要一样；顺序无关，deepEqual 对对象键顺序不敏感）
    assert.deepEqual(game.s.terrain, expected, `seed ${seed}：default 地图的地形必须与改动前逐值相同`);
    assert.equal(game.mapId(), DEFAULT_MAP_ID, `seed ${seed}：不选地图就是 default`);
    // ⑤ 行为也逐值一致：default 没有场地特性，所以"水/甲板/背景/移动惩罚"全部退化回改动前的样子
    assert.equal(game.wateryArena(), false);
    assert.equal(game.deckRect(), null);
    assert.equal(game.arenaKey(), null, '背景仍然是默认深色底');
    assert.equal(game.waterPenalty(), 0);
    for (const u of game.s.units) {
      assert.equal(game.isWaterTile(game.tile(u)), false, `${u.id}：default 地图上没有水`);
      assert.equal(game.moveRange(u), u.move, `${u.id}：default 地图上的移动与改动前一样（没有任何惩罚，也没捡到「疾风」）`);
    }
  }
});

/* ==================================================================== ② shallows 地图 */

test('② 浅滩水路：大片水面 ＋ 画面正中横着一条全宽木甲板（54 格、行 5~7、垂直居中）', () => {
  const map = MAPS.shallows;
  assert.equal(map.id, 'shallows');
  assert.equal(map.name, '浅滩水路');
  assert.equal(map.arena, 'sea', '★ 配套背景画是海面那张');
  const game = startFree('jotaro', 'dio', 'shallows');
  assert.equal(game.mapId(), 'shallows');
  assert.equal(game.wateryArena(), true, '★ 这张地图有水域特性');
  assert.equal(game.arenaKey(), 'sea', '★ 背景跟着地图走（自由对局里也是海面）');

  // 甲板的几何：由 features.water.deck 的尺寸算出居中矩形（唯一口径 deckRectOf）
  const deck = game.deckRect();
  assert.deepEqual(deck, deckRectOf(map));
  assert.deepEqual(deck, SEA_DECK, '★ 和第四章那条甲板是同一块（同一套数据）');
  assert.equal(deck.colStart + deck.colEnd, COLS - 1, '列方向居中');
  assert.equal(deck.rowStart + deck.rowEnd, ROWS - 1, '行方向居中');
  const deckCount = (deck.rowEnd - deck.rowStart + 1) * (deck.colEnd - deck.colStart + 1);
  assert.equal(deckCount, map.features.water.deck.cols * map.features.water.deck.rows);
  // ★★ 2026-10-05 用户拍板（本次改动）：原来是"4 列 × 5 行 = 20 格"，现在改成
  //   **"横跨左右全宽的一条带子、厚 3 行、垂直居中"** → 18 × 3 = 54 格。
  assert.equal(deckCount, 54, '★ 甲板 ＝ 横跨左右全宽的一条带子：18 列 × 3 行 = 54 格');
  // 三个几何口径一次钉死：全宽（列 0~17）、厚度 3 行且正好是行 5~7、关于 MID_ROW 对称
  assert.deepEqual(deck, { colStart: 0, colEnd: COLS - 1, rowStart: MID_ROW - 1, rowEnd: MID_ROW + 1 },
    '★ 甲板 ＝列 0~17（全宽）＋ 行 5~7（垂直居中，正中那一行就是 MID_ROW）');
  assert.equal(deck.colEnd - deck.colStart + 1, COLS, '★ 甲板横向铺满整行（一格水都不留）');
  assert.equal(deck.rowEnd - deck.rowStart + 1, 3, '★ 厚度正好 3 行');
  assert.equal((deck.rowStart + deck.rowEnd) / 2, MID_ROW, '★ 甲板关于 MID_ROW 严格对称（垂直居中）');

  // 水占多数：棋盘上绝大多数格子是水，甲板是少数
  const water = game.tiles.filter(t => game.isWaterTile(t));
  assert.equal(water.length, COLS * ROWS - deckCount);
  assert.equal(water.length, 180, '★ 水面 ＝ 234 − 54 = 180 格');
  assert.equal(water.length + deckCount, COLS * ROWS, '甲板 ∪ 水面 = 整张棋盘');
  // ⚠️ 原来是 `water > deckCount * 4`（20 格甲板时水是它的 11 倍）。甲板变成 54 格之后这个
  //    倍数**被新数据直接推翻**（180 / 54 ≈ 3.3），所以改成等价的"水仍然占多数"两条：
  //    ① 水面比甲板多；② 水面超过棋盘一半（180 > 117）——语义没放松，只是不再用旧的倍数。
  assert.ok(water.length > deckCount, `水要占多数（现在 ${water.length} 格水 vs ${deckCount} 格甲板）`);
  assert.ok(water.length > (COLS * ROWS) / 2, `水面要超过棋盘一半（现在 ${water.length} / ${COLS * ROWS}）`);
  assert.equal(game.tiles.filter(t => !game.isWaterTile(t)).length, deckCount, '甲板格数要和数据完全对得上');
  // ★ "除这 3 行外全是水"：逐格核对——凡是不在行 5~7 的都是水、行 5~7 的都是甲板
  for (const t of game.tiles) {
    const onDeck = t.row >= deck.rowStart && t.row <= deck.rowEnd;
    assert.equal(game.isWaterTile(t), !onDeck, `${tileKey(t)}：只有行 ${deck.rowStart}~${deck.rowEnd} 是甲板，其余全在水里`);
  }
  // 四角是水（甲板这条带子够不到上下两角）；带子的上下各一行都是水
  assert.equal(game.isWaterTile({ row: 0, col: 0 }), true);
  assert.equal(game.isWaterTile({ row: ROWS - 1, col: COLS - 1 }), true);
  assert.equal(game.isWaterTile({ row: deck.rowStart, col: deck.colStart }), false, '甲板左上角（列 0）在甲板上');
  assert.equal(game.isWaterTile({ row: deck.rowEnd, col: deck.colEnd }), false, '甲板右下角（列 17）在甲板上');
  assert.equal(game.isWaterTile({ row: deck.rowStart, col: Math.floor(COLS / 2) }), false, '甲板正中也是甲板');
  assert.equal(game.isWaterTile({ row: deck.rowStart - 1, col: deck.colStart }), true, '甲板上面一行是水');
  assert.equal(game.isWaterTile({ row: deck.rowEnd + 1, col: deck.colEnd }), true, '甲板下面一行是水');
  // "画面中央"的像素口径：甲板那 54 格的包围盒中心 ≈ 画布中心（与 board-size ④-1 同一条判据）
  const box = game.tiles.filter(t => !game.isWaterTile(t)).reduce((a, t) => ({
    x0: Math.min(a.x0, t.cx - HX / 2), x1: Math.max(a.x1, t.cx + HX / 2),
    y0: Math.min(a.y0, t.cy - R), y1: Math.max(a.y1, t.cy + R),
  }), { x0: Infinity, x1: -Infinity, y0: Infinity, y1: -Infinity });
  assert.ok(Math.abs((box.x0 + box.x1) / 2 - CANVAS_W / 2) <= HX / 2, '★ 甲板横向在画面中央（半列以内）');
  assert.ok(Math.abs((box.y0 + box.y1) / 2 - CANVAS_H / 2) <= 1, '★ 甲板纵向正好在画面中央');
});

test('② 水里的玩家方移动 −1：只看"开始移动那一刻"，敌方与甲板上都照常（第四章口径的复刻）', () => {
  const game = startFree('jotaro', 'fake_captain', 'shallows');
  const mine = game.unit('p1-stand'), theirs = game.unit('p2-stand');
  const deck = game.deckRect();
  const deckTile = { row: Math.floor((deck.rowStart + deck.rowEnd) / 2), col: Math.floor((deck.colStart + deck.colEnd) / 2) };
  assert.equal(RULE.waterMovePenalty, 1, '★ 水里移动 −1');

  // 1）玩家方在水里：移动 −1
  place(game, 'p1-stand', 1, 1);
  place(game, 'p2-stand', 1, 1);
  assert.equal(game.inWater(mine), true);
  assert.equal(game.inWater(theirs), true, '敌方也在水里');
  assert.equal(game.moveRange(mine), mine.move - RULE.waterMovePenalty, '★ 玩家在水里：移动 −1');
  assert.equal(game.moveRange(theirs), theirs.move, '★ 敌方（水生替身）不受影响');

  // 2）甲板上：照常满移动（起点在甲板上就不减，哪怕这一趟走进水里）
  place(game, 'p1-stand', deckTile.row, deckTile.col);
  assert.equal(game.inWater(mine), false);
  assert.equal(game.moveRange(mine), mine.move, '甲板上起步＝满移动');
  // 高亮可达范围必须与 moveRange 一致（历史坑：路径与显示各算一遍就会对不上）
  const longest = () => Math.max(0, ...[...game.paths(game.unit('p1-stand')).values()].map(path => path.length));
  assert.equal(longest(), mine.move, '甲板上：最远就是满移动');
  place(game, 'p1-stand', 1, 1);
  assert.equal(longest(), mine.move - RULE.waterMovePenalty, '★ 水里最远的路也要跟着 −1（显示与实际一致）');
  for (const t of game.reachable(game.unit('p1-stand'))) {
    assert.ok(game.paths(game.unit('p1-stand')).get(tileKey(t)).length <= game.moveRange(game.unit('p1-stand')),
      '高亮范围不能超过实际移动距离');
  }

  // 3）判定时机＝"开始移动那一刻"：起点在甲板、落点在水里 → 这一趟仍按甲板算（满移动）
  //    ⚠️ 2026-10-05 甲板改成"全宽 3 行"之后，这一段的**夹具**必须跟着改（判据一个字没改）：
  //       原来从"甲板正中那一格"起步就能走到水面，是因为旧甲板只有正中一块、四周紧邻水面；
  //       现在甲板是一条 3 行的带子，**正中那一格离上下水面各隔 2 行**，而 `reachable()` 还要过
  //       "落点距同伴 ≤ `distLimit`（承太郎是 2）"那一关（同伴本体留在出生点 (MID_ROW,3)），
  //       于是从正中起步**一格水面都够不着**（实测 `wet.length === 0`）——那不是规则变了，
  //       是夹具的起点太靠中间了。所以把起步格与同伴都挪到**甲板最上面那一行**：
  //       起步 (5,6)、同伴 (5,4)（同为甲板、相距正好 2 格＝满连携距离），
  //       这样"从甲板起步、落点在水面"在连携距离内真的成立（(4,5) 等水面格就在 2 步之内）。
  const deckEdge = { row: deck.rowStart, col: 6 }, mateTile = { row: deck.rowStart, col: 4 };
  place(game, 'p1-stand', deckEdge.row, deckEdge.col);
  place(game, 'p1-user', mateTile.row, mateTile.col);
  assert.equal(game.inWater(game.unit('p1-stand')), false, '（新夹具）起步格仍在甲板上');
  const wet = game.reachable(game.unit('p1-stand')).filter(t => game.isWaterTile(t));
  assert.ok(wet.length, '甲板边上一定有能走到的水面格');
  assert.equal(game.moveRange(game.unit('p1-stand')), mine.move, '起点在甲板上，这一趟去哪都不减');

  // 4）只影响玩家方：同一队（p1）的两个槽位都算玩家方；敌方两队都不受影响
  assert.equal(game.waterSlows('p1'), true);
  assert.equal(game.waterSlows('p2'), false);
  assert.equal(teamOf('p1b'), 'p1', '2v2 的第二个玩家位也算玩家方');
  assert.equal(game.waterPenalty(), RULE.waterMovePenalty, '惩罚值读的是地图数据，数值仍只有一个来源');

  // 5）别的对局没有水：default 地图上一切都照常
  const plain = startFree('jotaro', 'dio');
  assert.equal(plain.mapId(), DEFAULT_MAP_ID);
  assert.equal(plain.wateryArena(), false);
  assert.equal(plain.deckRect(), null);
  assert.equal(plain.isWaterTile(plain.tile(plain.unit('p1-stand'))), false);
  assert.equal(plain.moveRange(plain.unit('p1-stand')), plain.unit('p1-stand').move);
  assert.equal(plain.waterSlows('p1'), false);
});

test('② 浅滩水路的地形：少一点礁石（基线 4 → 18×13 上 6 块）、**不刷毒沼**，撒法判据一条不变且甲板上不长野外地形', () => {
  const map = MAPS.shallows;
  // ★★ 2026-10-05 用户拍板（本次改动）：这张图的 `hazard` 基线改成 **0**（不刷毒沼）——
  //    原来是 `hazard: 2`（18×13 上 3 块），那条断言被直接推翻；另外三种一个数都没动。
  assert.deepEqual(map.terrain, { rock: 4, bush: 4, heal: 2, hazard: 0 });
  const ratio = (COLS * ROWS) / 154;
  const expected = Object.fromEntries(Object.entries(map.terrain)
    .map(([type, base]) => [type, Math.max(base, Math.round(base * ratio))]));
  assert.deepEqual(expected, { rock: 6, bush: 6, heal: 3, hazard: 0 },
    '★ 毒沼 0 块；另外三种仍是"基线 × 面积比"的旧口径（算式一个字没改）');
  for (const seed of [7, 42, 20261005]) {
    const game = startFree('avdol', 'kakyoin', 'shallows', { seed });
    // ★ 数量口径：`terrainCounts()` 只数 `s.terrain` 里真实存在的格子，所以**没有 hazard 这个键**
    //   （`hazard: 0` ＝ 一块都不撒；这不是"撒了 0 块"，是压根没撒过）。
    assert.deepEqual(terrainCounts(game), { rock: 6, bush: 6, heal: 3 }, `seed ${seed}：浅滩水路的地形数量`);
    assert.equal(Object.values(game.s.terrain).includes('hazard'), false, `seed ${seed}：★ 这张图上一块毒沼都不许有`);
    assert.equal(Object.values(game.s.terrain).length, 15, `seed ${seed}：地形总数 ＝ 6 + 6 + 3（毒沼不参与）`);
    assert.ok(expected.rock < 9, '比默认地图少一点石头（开阔水面）');
    for (const [key, type] of Object.entries(game.s.terrain)) {
      const [row, col] = key.split(',').map(Number);
      const tile = game.at(row, col);
      assert.ok(tile, `seed ${seed}：地形落在棋盘外（${key}）`);
      assert.equal(game.featureGround(tile), false, `seed ${seed}：甲板上不该长野外地形（${key} / ${type}）`);
      for (const u of game.s.units) {
        assert.ok(hexDist(game.tile(u), tile) > 1, `seed ${seed}：地形贴着 ${u.id} 的出生点`);
      }
    }
  }
  // 毒沼这个**地形本身**照旧能用：同一套撒法在 default 上还是 3 块、效果也照旧（见 game.test.js）
  const plain = startFree('avdol', 'kakyoin', null, { seed: 7 });
  assert.equal(terrainCounts(plain).hazard, 3, '★ 毒沼没被删：default 上照旧 3 块');
  // ★ 同一张图、同一个种子：把 hazard 基线改回 2 只**多撒毒沼**，另外三种落点逐格不变
  //   （因为 hazard 在 `terrain` 表里排最后、且"0 块"时循环体一次都不进，随机数消耗顺序没变）。
  //   ⚠️ 这里用**覆写这一局的 `map()`**来造对照局，**绝不去改 `MAPS` 注册表**——
  //     同一个进程里别的测试文件也在读它，改全局会有串扰风险。
  const replay = new Game({ random: seeded(7) });
  replay.map = () => ({ ...MAPS.shallows, terrain: { ...MAPS.shallows.terrain, hazard: 2 } });
  replay.start('avdol', 'kakyoin');
  const dry = startFree('avdol', 'kakyoin', 'shallows', { seed: 7 });
  const withoutHazard = Object.fromEntries(Object.entries(dry.s.terrain).filter(([, type]) => type !== 'hazard'));
  const onlyOthers = Object.fromEntries(Object.entries(replay.s.terrain).filter(([, type]) => type !== 'hazard'));
  assert.equal(terrainCounts(replay).hazard, 3, '（对照）把基线改回 2 时确实会撒 3 块毒沼');
  assert.deepEqual(onlyOthers, withoutHazard, '★ 关掉毒沼不影响另外三种地形的落点（随机数顺序没变）');
});

/* ==================================================================== ②-补 道具没被新甲板弄坏 */

test('② 甲板改成 54 格的全宽带子之后，道具照旧开局摆 2 个（放置判据一条没松，水面上照旧能漂）', () => {
  // ⚠️ 这一段是给本次改动补的**回归**：甲板从 20 格变 54 格，`itemSpots()` 要多排掉 34 个格子。
  //    判据本身一个字没改（不贴边 / 不压地形 / **不压甲板** / 不压隔板位 / 不重叠 / 避开出生点），
  //    这里只证明"池子还够、开局那 2 个照旧摆得出来、而且仍然只落在水里"。
  const cases = [];
  for (const seed of [7, 42, 999, 20261005]) {
    cases.push({ tag: `shallows 1v1 seed ${seed}`, game: startFree('jotaro', 'dio', 'shallows', { seed }) });
  }
  cases.push({ tag: 'shallows 2v2', game: (() => {
    const g = new Game({ random: seeded(7) });
    g.setRoster({ p1b: 'kakyoin', p2b: 'iggy' });
    g.setMap('shallows').start('jotaro', 'dio', 'hotseat');
    return g;
  })() });
  cases.push({ tag: '第四章海面那一战', game: (() => {
    const chapter4 = chapter('chapter-4');
    const g = new Game({ random: seeded(7) });
    g.start(chapter4.player, chapter4.enemy, 'ai', { story: chapter4.id });
    return g;
  })() });

  for (const { tag, game } of cases) {
    const rule = game.itemRule();
    assert.ok(rule, `${tag}：浅滩水路仍然开着道具`);
    const pool = game.itemSpots();
    assert.ok(pool.length >= 40, `${tag}：甲板变宽后合法格池仍然够用（现在 ${pool.length} 格）`);
    assert.equal(game.s.items.length, rule.opening, `★ ${tag}：开局照旧摆 ${rule.opening} 个`);
    for (const item of game.s.items) {
      const t = game.at(item.row, item.col);
      const at = `${tag}：${item.name}@${item.row},${item.col}`;
      assert.equal(game.featureGround(t), false, `${at}：★ 绝不压在甲板那条带子上`);
      assert.equal(game.s.terrain[tileKey(t)], undefined, `${at}：不压地形`);
      assert.ok(t.row >= rule.edge && t.row <= ROWS - 1 - rule.edge, `${at}：不贴上/下边`);
      assert.ok(t.col >= rule.edge && t.col <= COLS - 1 - rule.edge, `${at}：不贴左/右边`);
      for (const spot of game.spawnTiles()) {
        assert.ok(hexDist(spot, t) > rule.spawn, `${at}：离出生点 ${hexDist(spot, t)} 格，太近了`);
      }
    }
    // 这份"有意取舍"没被新甲板推翻：**水面格照样可以放道具**（若连水面也排除，这张图除甲板外
    // 全是水，池子会直接清空成 0——见 game.js 的 `itemSpots()` 那段注释）。
    // 甲板那 54 格现在全被排除，池子实测仍有 60~71 格，所以"开局摆 2 个"照旧成立。
    assert.ok(pool.some(t => game.isWaterTile(t)), `${tag}：水面上照旧可以漂道具`);
  }
});

/* ==================================================================== ③ PvP 选地图 */

test('③ PvP：不选就是 default；登记 shallows 后地形/背景/水规则一起生效（登记值只对这一局有效）', () => {
  // 1）默认：不登记地图 → default，没有水、没有背景、地形是改动前那一套
  const plain = new Game({ random: seeded(7) });
  plain.start('jotaro', 'dio');
  assert.equal(plain.mapId(), DEFAULT_MAP_ID);
  assert.equal(plain.arenaKey(), null, '没有背景图 → 渲染层用默认深色底');
  assert.equal(plain.wateryArena(), false);
  assert.deepEqual(terrainCounts(plain), { rock: 9, bush: 6, heal: 3, hazard: 3 });

  // 2）登记 shallows（大厅点地图按钮走的就是这条路）
  const wet = new Game({ random: seeded(7) });
  wet.setMap('shallows').start('jotaro', 'dio');
  assert.equal(wet.mapId(), 'shallows');
  assert.equal(wet.arenaKey(), 'sea', '★ 背景跟着地图走');
  assert.equal(wet.wateryArena(), true, '★ 水规则跟着地图走');
  assert.deepEqual(terrainCounts(wet), { rock: 6, bush: 6, heal: 3 }, '★ 地形也跟着地图走（这张图不刷毒沼，所以没有 hazard 这个键）');
  // 同一个种子、同一个摆位，只有地图不同 → 地形必然不同（否则"地图"等于没换）
  assert.notDeepEqual(wet.s.terrain, plain.s.terrain, '换了地图，地形布局就该不一样');

  // 3）登记值只对那一局有效：下一局不登记就回到 default（与 roster / control 同一套口径）
  const again = new Game({ random: seeded(7) });
  again.setMap('shallows');
  again.start('jotaro', 'dio');
  assert.equal(again.mapId(), 'shallows');
  again.start('jotaro', 'dio');       // 第二局：没有重新登记
  assert.equal(again.mapId(), DEFAULT_MAP_ID, '★ 地图只对登记的那一局有效，下一局回到 default');
  assert.equal(again.wateryArena(), false);

  // 4）合法登记值都能用；非法名字兜底成 default（不崩）
  for (const key of Object.keys(MAPS)) {
    const g = new Game({ random: seeded(7) });
    g.setMap(key).start('jotaro', 'dio');
    assert.equal(g.mapId(), key);
  }
  for (const bad of ['nope', '', '  ', 'SHALLOWS', 42, {}]) {
    const g = new Game({ random: seeded(7) });
    assert.doesNotThrow(() => g.setMap(bad).start('jotaro', 'dio'), `非法地图名 ${String(bad)} 不该抛错`);
    assert.equal(g.mapId(), DEFAULT_MAP_ID, `非法地图名 ${String(bad)} 要兜底成 default`);
    assert.equal(g.s.phase, 'battle', '兜底之后照样能开局');
  }
  // 2v2 也照常（水域只按"队"判断，p1 的两个角色都算玩家方）
  const duo = new Game({ random: seeded(7) });
  duo.setRoster({ p1b: 'kakyoin', p2b: 'iggy' });
  duo.setMap('shallows').start('jotaro', 'dio', 'hotseat');
  assert.equal(duo.mapId(), 'shallows');
  assert.equal(duo.s.slots.length, 4);
  assert.equal(duo.waterSlows(teamOf('p1b')), true);
});

test('③ 大厅：地图按钮按 MAPS 渲染、默认选中 default，?map= 与非法名字都由 applyMapParam 收敛', async () => {
  const { applyMapParam, mapLabel } = await import('../src/ui/hud.js');
  // 1）纯函数：认得出就用、认不出退回 default（网址参数与按钮共用）
  const draft = { map: 'default' };
  assert.equal(applyMapParam(draft, 'shallows'), 'shallows');
  assert.equal(draft.map, 'shallows');
  assert.equal(applyMapParam(draft, 'nope'), DEFAULT_MAP_ID, '★ 非法名字兜底');
  assert.equal(applyMapParam(draft, undefined), DEFAULT_MAP_ID);
  assert.equal(mapLabel('shallows'), '浅滩水路');
  assert.equal(mapLabel('nope'), '默认战场', '认不出的键显示默认地图的名字（界面不会出现空白）');

  // 2）渲染：按钮是**按数据**出来的（加地图不用改界面），默认这张被按下
  await withDom(async dom => {
    const { renderDraft } = await import('../src/ui/hud.js');
    renderDraft({ p1: 'jotaro', p2: 'dio', mode: 'ai' });     // 老调用点：连 map 字段都没有
    const html = dom.get('mapPick').innerHTML;
    for (const map of mapList()) {
      assert.ok(html.includes(`data-map="${map.id}"`), `地图按钮里要有 ${map.id}`);
      assert.ok(html.includes(map.name), `地图按钮上要写中文名「${map.name}」`);
    }
    assert.match(html, /data-map="default" aria-pressed="true"/, '★ 默认仍然是 default（不是浅滩水路）');
    assert.match(html, /data-map="shallows" aria-pressed="false"/);
    assert.equal(dom.get('mapNote').textContent, MAPS.default.blurb, '要写出当前地图打起来哪里不一样');

    renderDraft({ p1: 'jotaro', p2: 'dio', mode: 'ai', map: 'shallows' });
    assert.match(dom.get('mapPick').innerHTML, /data-map="shallows" aria-pressed="true"/);
    assert.equal(dom.get('mapNote').textContent, MAPS.shallows.blurb);
    // 认不出的 map 值照样渲染成 default 被选中（不崩、不出现"没有地图被选中"）
    renderDraft({ p1: 'jotaro', p2: 'dio', mode: 'ai', map: 'nope' });
    assert.match(dom.get('mapPick').innerHTML, /data-map="default" aria-pressed="true"/);
  });

  // 3）接线（静态）：网址参数 ?map= 与大厅按钮都接上了，而且地图走 setMap（start() 的写法不动）
  const main = fs.readFileSync(new URL('../src/main.js', import.meta.url), 'utf8');
  assert.match(main, /map: resolveMapId\(query\.get\('map'\)\)/, '★ 网址参数 ?map= 要能指定地图');
  assert.match(main, /button\.dataset\.map/, '大厅的地图按钮要有接线');
  assert.match(main, /applyMapParam\(draft, button\.dataset\.map\)/, '按钮点击要走同一个收敛口径');
  assert.match(main, /game\.setMap\(draft\.map\)/, '开打前把地图登记进引擎');
  assert.match(main, /game\.start\(draft\.p1, draft\.p2, draft\.mode, \{ story: draft\.story \}\)/, '★ start() 的调用写法不许变');
});

/* ==================================================================== ④ 第四章行为未变 */

test('④ 第四章跟着新数据走：甲板＝那条全宽带子、水里 −1 与观感仍是同一套', () => {
  const chapter4 = chapter('chapter-4');
  assert.equal(chapter4.arena, 'sea', '★ 章节的 arena 一个字都没动（它现在表示"背景用海面那张"）');
  assert.equal(chapter4.map, 'shallows', '★ 这一战指定的地图就是浅滩水路');
  const game = new Game({ random: seeded(7) });
  game.start(chapter4.player, chapter4.enemy, 'ai', { story: chapter4.id });
  assert.equal(game.mapId(), 'shallows');
  assert.equal(game.s.story.arena, 'sea');
  assert.equal(game.arenaKey(), 'sea');
  assert.equal(game.wateryArena(), true, '★ 这一战仍然有水域规则');

  // 甲板：★★ 2026-10-05 用户拍板"第四章也跟着改"——从"中央 4×5 = 20 格"改成
  //   "横跨左右全宽、厚 3 行"的那条带子（18×3 = 54 格，行 5~7）。原来是
  //   `deepEqual(SEA_DECK, {7,10,4,8})` ＋ `!isWaterTile` 的格数 === 20，这两条被直接推翻。
  assert.deepEqual(SEA_DECK, { colStart: 0, colEnd: COLS - 1, rowStart: MID_ROW - 1, rowEnd: MID_ROW + 1 });
  assert.deepEqual(game.deckRect(), SEA_DECK);
  assert.equal(game.tiles.filter(t => !game.isWaterTile(t)).length, 54, '★ 这一战的甲板现在有 54 格');
  // ★ 开局水陆分布跟着变：`DEPLOY_ROW === MID_ROW === 6` 正好落在甲板带子（行 5~7）**中间**，
  //   所以四枚棋子**都从甲板上开局**——旧数据下它们在 (6,3)/(6,5)/(6,12)/(6,14)，
  //   而旧甲板只有 7~10 列，所以那时候"双方都在水里"。这一条是用户明确要的连带结果（不是回归）。
  assert.equal(game.unit('p1-user').row, MID_ROW, '（前提）开局摆在正中那一行');
  for (const u of game.s.units) {
    assert.equal(game.isWaterTile(game.tile(u)), false, `${u.id} 开局站在甲板上（甲板带子覆盖了正中那一行）`);
    assert.equal(game.featureGround(game.tile(u)), true, `${u.id} 开局那一格就是甲板`);
  }
  // 水规则一个字没改：水里 −1、只影响玩家方
  place(game, 'p1-stand', 1, 1);
  place(game, 'p2-stand', 1, 1);
  assert.equal(game.isWaterTile({ row: 1, col: 1 }), true, '（前提）(1,1) 在水里');
  assert.equal(game.moveRange(game.unit('p1-stand')), game.unit('p1-stand').move - RULE.waterMovePenalty);
  assert.equal(game.moveRange(game.unit('p2-stand')), game.unit('p2-stand').move, '★ 敌方（水生替身）照旧不受影响');
  // 甲板上满移动（从带子的正中那一格起步）
  const deck = game.deckRect();
  place(game, 'p1-stand', Math.floor((deck.rowStart + deck.rowEnd) / 2), Math.floor((deck.colStart + deck.colEnd) / 2));
  assert.equal(game.moveRange(game.unit('p1-stand')), game.unit('p1-stand').move);
  // 这张图不刷毒沼，第四章这一战上也一块都没有
  assert.equal(Object.values(game.s.terrain).includes('hazard'), false, '★ 第四章这一战也不该长毒沼');

  // 这一战照旧能由 AI 打完（水域没有制造死局）
  const played = new Game({ random: seeded(3) });
  played.start(chapter4.player, chapter4.enemy, 'ai', { story: chapter4.id });
  let guard = 0;
  while (played.s.phase === 'battle' && guard++ < 400) {
    if (!playAIAction(played, chooseAI(played))) played.endTurn();
  }
  assert.ok(guard < 400, '★ 第四章必须在合理步数内结束');
  assert.equal(played.s.phase, 'result');

  // 剧情模式**忽略**大厅登记的地图：在选人页点过浅滩，也不该改掉别的章节的战场
  const chapter2 = chapter('chapter-2');
  const plane = new Game({ random: seeded(7) });
  plane.setMap('shallows');
  plane.start(chapter2.player, chapter2.enemy, 'ai', { story: chapter2.id });
  assert.equal(plane.mapId(), DEFAULT_MAP_ID, '★ 剧情章节没声明地图就用 default，不被大厅选择带跑');
  assert.equal(plane.arenaKey(), 'plane', '第二章仍然是客机背景');
  assert.equal(plane.wateryArena(), false);
});

/* ==================================================================== ⑤ 收敛 */

/** 跑到分出胜负；返回用掉的行动数（超上限则返回 −1）。 */
function playOut(game, cap = 500) {
  let n = 0;
  while (game.s.phase === 'battle' && n < cap) {
    assert.ok(playAIAction(game, chooseAI(game)), 'AI 不该给出被拒的决定');
    n++;
  }
  return game.s.phase === 'result' ? n : -1;
}

test('⑤ 两张地图上多种子自动对局全部收敛：全配对（15×15）+ 抽样种子 + 2v2', () => {
  const pairings = Object.keys(FIGHTERS);
  for (const map of ['default', 'shallows']) {
    // 1）全配对：每个角色 × 每个角色（自由对局默认的两边都是这么来的）
    for (const a of pairings) for (const b of pairings) {
      const g = new Game({ random: seeded(13) });
      g.setMap(map).start(a, b);
      const n = playOut(g);
      assert.ok(n >= 0, `${map}：${a}/${b} 没收敛（超过 500 步）`);
      assert.ok(['p1', 'p2'].includes(g.s.winner), `${map}：${a}/${b} 要有胜者`);
      for (const side of ['p1', 'p2']) {
        assert.ok(Number.isFinite(g.s.hp[side]) && g.s.hp[side] >= 0, `${map}：${a}/${b} 的血量必须是合法数`);
        assert.ok(g.pairDistance(side) <= g.distLimit(side), `${map}：${a}/${b} 的连携距离不能失配`);
      }
    }
    // 2）抽样：隔几个配对换一个种子，确认"收敛"不是某个种子的运气
    for (const seed of [7919, 20261005]) {
      for (let i = 0; i < pairings.length; i++) {
        const a = pairings[i], b = pairings[(i * 5 + 3) % pairings.length];
        const g = new Game({ random: seeded(seed) });
        g.setMap(map).start(a, b);
        assert.ok(playOut(g) >= 0, `${map} / seed ${seed}：${a}/${b} 没收敛`);
      }
    }
    // 3）2v2：四个角色一起上（两方各两个），水域只减玩家方，照样要收得住
    for (const seed of [13, 7919]) {
      const g = new Game({ random: seeded(seed) });
      g.setRoster({ p1b: 'kakyoin', p2b: 'iggy' });
      g.setMap(map).start('jotaro', 'dio', 'hotseat');
      assert.equal(g.s.slots.length, 4, `${map}：2v2 应当有四个槽位`);
      assert.ok(playOut(g, 800) >= 0, `${map} / seed ${seed}：2v2 没收敛`);
    }
  }
});

test('⑤ 浅滩水路上双方都够得着：没有任何一枚棋子的移动被水域削成 0（不会出现"谁都走不动"）', () => {
  for (const key of Object.keys(FIGHTERS)) {
    const g = new Game({ random: seeded(7) });
    g.setMap('shallows').start(key, 'polnareff');
    for (const u of g.s.units) {
      const inWaterRange = g.moveRange(u);
      assert.ok(inWaterRange >= 1, `${u.id} 在水里的移动被削到 ${inWaterRange} 了——会造出够不着的死局`);
      assert.ok(inWaterRange <= u.move, `${u.id} 的移动不该反而变大`);
    }
    // 开局那一刻：每一枚棋子都至少有一个合法落点或一个射程内的对手（不会被完全锁死）
    for (const u of g.s.units) {
      const canMove = g.s.terrain ? g.reachable(u).length > 0 : true;
      const canHit = g.targets(u, u.range || 0).length > 0;
      assert.ok(canMove || canHit, `${u.id} 开局既走不了也打不着`);
    }
  }
});

/* ==================================================================== ⑥ 渲染冒烟 */

function fakeContext() {
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
  return { ctx, calls };
}
const fakeImage = (width = 192, height = 288) => ({ width, height });
/** 渲染器要拿到立绘、地形皮肤与**场地背景**（地图自带的那张也要在，否则背景那段不会被走到）。 */
function withSprites(visual) {
  const sprites = new Map();
  for (const art of Object.values(CHARACTER_ART)) for (const key of artKeys(art)) sprites.set(key, fakeImage());
  for (const key of ['rock', 'bush', 'heal', 'hazard']) sprites.set(key, fakeImage());
  for (const key of Object.keys(ARENAS)) sprites.set(`arena:${key}`, fakeImage(1536, 1024));
  visual.setSprites(sprites);
}
function withBoardEnv(run) {
  const previous = globalThis.document, previousWindow = globalThis.window;
  globalThis.window = { devicePixelRatio: 1, addEventListener() {}, removeEventListener() {} };
  try {
    const { ctx, calls } = fakeContext();
    const canvas = { width: CANVAS_W, height: CANVAS_H, style: {}, getContext: () => ctx, addEventListener() {}, getBoundingClientRect: () => ({ left: 0, top: 0, width: CANVAS_W, height: CANVAS_H }) };
    globalThis.document = {
      getElementById: id => (id === 'board' ? canvas : null),
      createElement: () => ({ width: 0, height: 0, style: {}, getContext: () => fakeContext().ctx }),
    };
    return run({ ctx, calls });
  } finally {
    if (previous === undefined) delete globalThis.document; else globalThis.document = previous;
    if (previousWindow === undefined) delete globalThis.window; else globalThis.window = previousWindow;
  }
}

test('⑥ 渲染冒烟：两张地图各渲一帧都不抛错，立绘齐、save/restore 配平，且换图会重画静态层', () => {
  withBoardEnv(({ calls }) => {
    for (const map of ['default', 'shallows']) {
      const game = new Game({ random: seeded(7) });
      game.setMap(map).start('jotaro', 'fake_captain');
      const visual = new BoardVisual(game);
      withSprites(visual);
      const view = game.actionView();
      assert.doesNotThrow(() => visual.render(view, 0), `${map}：渲染不该抛错`);
      const saves = calls.filter(c => c.prop === 'save').length;
      const restores = calls.filter(c => c.prop === 'restore').length;
      assert.equal(saves, restores, `${map}：save / restore 必须配平`);
      assert.ok(saves > 0, `${map}：这一帧应当真的画了东西`);
      const drawn = calls.filter(c => c.prop === 'drawImage').length;
      assert.ok(drawn >= game.s.units.length, `${map}：drawImage 至少要覆盖全部棋子`);
      // 静态层缓存键含地图键：换地图一定要重画（水与甲板是按地图数据铺的）
      const before = visual.baseDrawCount;
      game.s.mapId = map === 'default' ? 'shallows' : 'default';
      visual.render(view, 1000);
      assert.equal(visual.baseDrawCount, before + 1, `${map}：换地图必须触发一次静态层重画`);
      visual.render(view, 1016);
      assert.equal(visual.baseDrawCount, before + 1, `${map}：换完不该继续重画（缓存要生效）`);
    }
  });
});

test('⑥ 浅滩水路的画法与第四章同一套：水面铺满、甲板就是那条 54 格的带子（渲染读的是同一份判定）', () => {
  const game = startFree('jotaro', 'fake_captain', 'shallows');
  const deck = game.deckRect();
  const water = game.tiles.filter(t => game.isWaterTile(t));
  // 渲染层（drawSea / 每格的底色）用的就是这两个判定，所以"画出来的水与甲板"必然与规则一致
  assert.equal(water.length + game.tiles.filter(t => game.featureGround(t)).length, game.tiles.length);
  assert.equal(game.tiles.filter(t => game.featureGround(t)).length, 54, '★ 画出来的甲板就是那 54 格');
  for (const t of game.tiles) {
    assert.equal(game.featureGround(t), !game.isWaterTile(t), `${tileKey(t)}：甲板判定在两处必须一致`);
  }
  // 插画/皮肤回退：这张地图没有专属地形皮肤时照样能画（不会因为找不到图而整帧中断）
  const plane = startFree('jotaro', 'dio', 'default');
  assert.equal(plane.featureGround(plane.tiles[0]), false, 'default 地图没有特性地面（甲板不撒那条判据因此不影响它）');
  assert.equal(deck.rowStart >= 0 && deck.colEnd <= COLS - 1, true, '甲板必须落在棋盘里');
});

/* ==================================================================== 选人名单（顺带钉住"没动数值"） */

test('两张地图都不改任何角色/技能的数值：FIGHTERS 与可选角色名单与改动前一致', () => {
  assert.equal(Object.keys(FIGHTERS).length, 15, '15 名角色（其中 6 名是剧情 boss）');
  assert.equal(playableFighters().length, 9, '可选角色是 9 名');
  assert.equal(FIGHTERS.jotaro.hp, 40);
  assert.equal(FIGHTERS.jotaro.def, 2);
  assert.equal(FIGHTERS.fake_captain.stand.move, 4, '水生替身的移动与"水里 −1"无关，一个数都没动');
  const g = startFree('jotaro', 'fake_captain', 'shallows');
  assert.equal(g.unit('p2-stand').move, FIGHTERS.fake_captain.stand.move);
  assert.equal(g.moveRange(g.unit('p2-stand')), FIGHTERS.fake_captain.stand.move);
});

/* ------------------------------------------------------------------ 最小假 DOM（照 hud.test.js 那套） */

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
    querySelector: () => make(id + '-child'),
    querySelectorAll: () => [],
    insertAdjacentHTML(_, html) { this.innerHTML += html; },
    appendChild() {}, contains: () => true,
    getBoundingClientRect: () => ({ left: 0, top: 0, width: 100, height: 100, bottom: 100, right: 100 }),
  });
  const document = {
    getElementById: id => { if (!elements.has(id)) elements.set(id, make(id)); return elements.get(id); },
    querySelector: () => make('query'),
    querySelectorAll: () => [],
    createElement: () => make('created'),
    addEventListener() {}, removeEventListener() {},
    activeElement: null, body: make('body'),
  };
  return { document, elements, get: id => document.getElementById(id) };
}
async function withDom(run) {
  const previous = globalThis.document;
  const dom = fakeDom();
  globalThis.document = dom.document;
  try { return await run(dom); } finally {
    if (previous === undefined) delete globalThis.document; else globalThis.document = previous;
  }
}
