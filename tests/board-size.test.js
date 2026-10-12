/**
 * ★★ 2026-10-05 用户拍板：**棋盘从 14×11（154 格）放大到 18 列 × 13 行（234 格）**。
 *
 * 这是一次**纯尺寸**改动——不加新地形、不加新地图、**一个数值都没改**。
 * 但"尺寸"牵连的东西远不止两个常量，这个文件就是给那些连带项立的规矩（按验收清单 ①~⑥）：
 *
 *   ① 尺寸本身：`COLS === 18 && ROWS === 13`、格数 234、坐标/画布跟着涨且不越界；
 *   ② 开局摆位：1v1 与 2v2 **双方严格镜像（镜像列 ＝ COLS−1−列）、不重叠、都在界内、不过中线、
 *      与敌方保持合理距离**（开局没有任何人够得着对手）；
 *   ③ 地形数量**按面积给足**（不是"还在"），而且**不与任何单位的出生点相邻、不压单位与柱子、
 *      不跑到棋盘外**；
 *   ④ 三处写死坐标的剧情机制跟着棋盘走：第四章木甲板**仍在画面正中央**
 *      （2026-10-05 用户拍板后它是"横跨左右全宽、厚 3 行"的一条带子＝54 格）、
 *      第五章要害**仍固定在角落**（角落本身也是按 COLS/ROWS 算的）、第八章反光点**仍在中场不贴边**；
 *   ⑤ 多种子自动对局仍然全部收敛：2v2、第八章两场、以及**全配对（14×14 = 196 组）**；
 *   ⑥ 渲染冒烟：一帧画得出来、save/restore 配平、**棋子名字与血条仍在界内且够大**（格子变小后的可读性）。
 *
 * ⚠️ 这个文件**只读**引擎与渲染，不改任何数值；改尺寸之后如果它红了，先想清楚是"判据该跟着算"还是"数据该改"。
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  COLS, ROWS, R, HX, VY, LABEL, PAD, CANVAS_W, CANVAS_H, MID_ROW, mirrorCol,
  makeTiles, tileKey, hexDist,
} from '../src/core/hex.js';
import { Game, FIGHTERS, STORY_CHAPTERS, STRENGTH, SEA_DECK, MIRRORS } from '../src/core/game.js';
import { chooseAI, playAIAction } from '../src/core/ai.js';
import { BoardVisual } from '../src/ui/render.js';
import { CHARACTER_ART, artKeys } from '../src/ui/assets.js';

function seeded(seed = 42) { return () => ((seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0) / 4294967296); }
const tiles = makeTiles();
const chapter = id => STORY_CHAPTERS.find(c => c.id === id);
/** 阶段 1 / 阶段 2（按阵容认，不写死下标）。 */
const chapter8 = chapter('chapter-8');
const phase1 = chapter8.scenes.find(s => s.kind === 'battle' && s.lineup?.enemy === 'emperor');
const phase2 = chapter8.scenes.find(s => s.kind === 'battle' && s.lineup?.enemy === 'geil');
/** 棋盘正中心（列方向是"两个中间列之间"，所以取 (COLS−1)/2）。 */
const MID_COL = (COLS - 1) / 2;
/** 旧棋盘（14×11）的几个数：**只用来对照"真的长大了"**，引擎里不认它们。 */
const OLD = { cols: 14, rows: 11, area: 154, terrain: { rock: 6, bush: 4, heal: 2, hazard: 2 } };
const TERRAIN_TYPES = ['rock', 'bush', 'heal', 'hazard'];
const terrainCounts = game => Object.fromEntries(TERRAIN_TYPES.map(t =>
  [t, Object.values(game.s.terrain).filter(x => x === t).length]));
const unitTiles = game => [...game.s.units, ...game.s.pillars].map(u => game.tile(u)).filter(Boolean);

/** 开一局 2v2（自由对局：第二个角色走 setRoster 登记）。 */
function duo(a = 'jotaro', b = 'dio', ab = 'kakyoin', bb = 'iggy', { mode = 'hotseat', seed = 42 } = {}) {
  const game = new Game({ random: seeded(seed) });
  game.setRoster({ p1b: ab, p2b: bb });
  assert.equal(game.start(a, b, mode), true, '2v2 要能开');
  return game;
}
/** 按某一幕的阵容开一局（＝ main.js 里那一套的等价写法）。 */
function openScene(scene, { seed = 13 } = {}) {
  const game = new Game({ random: seeded(seed) });
  game.setRoster({ p1b: scene.lineup.ally || null, p2b: scene.lineup.enemy2 || null, story: true, scene });
  assert.equal(game.start(scene.lineup.player, scene.lineup.enemy, 'ai', { story: chapter8.id }), true);
  return game;
}
/** 把 AI 对局打到底（返回走了多少步）。 */
function playOut(game, guard = 900) {
  let steps = 0;
  while (game.s.phase === 'battle' && steps < guard) {
    const plan = chooseAI(game);
    if (!plan || !playAIAction(game, plan)) game.endTurn();
    steps++;
  }
  return steps;
}

// ===================== ① 尺寸本身 =====================

test('① 棋盘就是 18 列 × 13 行：234 个格子，坐标与画布都跟着涨且不越界', () => {
  assert.equal(COLS, 18, '★ 用户拍板：14 列 → 18 列');
  assert.equal(ROWS, 13, '★ 用户拍板：11 行 → 13 行');
  assert.equal(COLS * ROWS, 234, '格数 ＝ 列 × 行');
  assert.equal(tiles.length, 234, 'makeTiles() 铺出来的格数');
  assert.equal(new Set(tiles.map(tileKey)).size, 234, '每格的行列组合互不重复');
  assert.equal(new Set(tiles.map(t => `${t.q},${t.r}`)).size, 234, '轴向坐标也互不重复');
  assert.ok(COLS > OLD.cols && ROWS > OLD.rows, '两个方向都真的变大了');
  // 镜像列与正中行：**由 COLS/ROWS 算**，所以它们必须跟着变
  assert.equal(mirrorCol(0), COLS - 1, '镜像 0 → 17');
  assert.equal(mirrorCol(COLS - 1), 0, '镜像是对合的');
  assert.equal(mirrorCol(5), 12);
  assert.equal(MID_ROW, 6, '13 行的正中那一行是第 6 行（旧 11 行时是第 5 行）');
  // 画布由 COLS/ROWS 算出来（逻辑画布 1106×742），而且**每一格都装得下**
  assert.ok(CANVAS_W > OLD.cols * HX, '画布比旧棋盘还窄就说明没跟着算');
  for (const t of tiles) {
    assert.ok(t.cx - HX / 2 >= 0 && t.cx + HX / 2 <= CANVAS_W, `第 ${t.row} 行第 ${t.col} 列横向越界`);
    assert.ok(t.cy - R >= LABEL && t.cy + R <= CANVAS_H - LABEL, `第 ${t.row} 行第 ${t.col} 列纵向越界`);
  }
  // 边上的坐标带（A–R / 1–13）也还在用整体尺寸算
  assert.ok(CANVAS_H >= 2 * (LABEL + PAD) + (ROWS - 1) * VY + 2 * R);
});

// ===================== ② 开局摆位 =====================

test('② 1v1 开局：四枚棋子不重叠、都在界内、严格镜像、不过中线，且离敌方足够远', () => {
  const game = new Game({ random: seeded(5) });
  game.start('jotaro', 'dio');
  const side = team => game.s.units.filter(u => u.side === team);

  // 都在界内、都不在同一格
  const occupied = game.s.units.map(u => tileKey(game.tile(u)));
  assert.equal(new Set(occupied).size, 4, '四枚棋子各占一格');
  for (const u of game.s.units) {
    assert.ok(u.row >= 0 && u.row < ROWS && u.col >= 0 && u.col < COLS, `${u.id} 出界了`);
    assert.ok(game.tile(u), `${u.id} 不在棋盘上`);
  }
  // 摆在**正中那一行**（不是写死的第 5 行）
  for (const u of game.s.units) assert.equal(u.row, MID_ROW, `${u.id} 应摆在正中那一行`);

  // ★ 严格镜像：P2 列 ＝ mirrorCol(P1 列)（18 列时就是 17 − 列），行相同
  for (const kind of ['user', 'stand']) {
    const p1 = game.unit(`p1-${kind}`), p2 = game.unit(`p2-${kind}`);
    assert.equal(p2.col, mirrorCol(p1.col), `${kind}：双方应左右镜像`);
    assert.equal(p2.row, p1.row);
  }
  // 具体位置（用户拍板的相对关系：离左右边各 3 列、替身朝内、两名使者相距 11 列）
  assert.deepEqual([game.unit('p1-user').col, game.unit('p1-stand').col], [3, 5]);
  assert.deepEqual([game.unit('p2-user').col, game.unit('p2-stand').col], [14, 12]);
  assert.equal(Math.min(...game.s.units.map(u => u.col)), 3, '★ 不挤在边缘（离左边至少 3 列）');
  assert.equal(COLS - 1 - Math.max(...game.s.units.map(u => u.col)), 3, '★ 离右边也是 3 列');
  assert.equal(hexDist(game.tile(game.unit('p1-user')), game.tile(game.unit('p2-user'))), 11,
    '★ 两名使者相距 11 列（旧棋盘是 9 列）');

  // 不过中线：谁都不许一开局就站在对方半场
  for (const u of side('p1')) assert.ok(u.col < MID_COL, `${u.id} 越过了中线`);
  for (const u of side('p2')) assert.ok(u.col > MID_COL, `${u.id} 越过了中线`);
  // 与敌方保持合理距离：最近的两枚棋子至少隔 3 格，而且**开局没有任何人够得着对手**
  const cross = Math.min(...side('p1').flatMap(a => side('p2')
    .map(b => hexDist(game.tile(a), game.tile(b)))));
  assert.ok(cross >= 3, `两队最近只隔 ${cross} 格，贴脸了`);
  assert.equal(cross, 7, '最近的组合是两名替身（5 与 12 之间隔 7 格）');
  for (const u of game.s.units) {
    const reachableFoes = game.targets(u, u.range || 0);
    assert.equal(reachableFoes.length, 0, `★ ${u.id} 一开局就够得着对手（射程 ${u.range}）`);
  }
  // 每个角色自己的两枚棋子都在连携距离内、又不叠在一起
  for (const slot of game.s.slots) {
    assert.ok(game.pairDistance(slot) > 0 && game.pairDistance(slot) <= game.distLimit(slot),
      `${slot} 的连携距离 ${game.pairDistance(slot)} 不合法`);
  }
  // 替身比使者更靠中线（旧口径照旧）
  for (const team of ['p1', 'p2']) {
    const toCentre = kind => Math.abs(MID_COL - game.unit(`${team}-${kind}`).col);
    assert.ok(toCentre('stand') < toCentre('user'), `${team} 的替身应更靠中线`);
  }
});

test('② 2v2 开局：八枚棋子同样镜像、不重叠、都在界内、不过中线，四列严格成对', () => {
  const game = duo();
  const side = team => game.s.units.filter(u => u.side === team);
  assert.equal(game.s.units.length, 8, '每方两个角色 × 两枚棋子');

  const occupied = game.s.units.map(u => tileKey(game.tile(u)));
  assert.equal(new Set(occupied).size, 8, '八枚棋子各占一格');
  for (const u of game.s.units) {
    assert.ok(u.row >= 0 && u.row < ROWS && u.col >= 0 && u.col < COLS, `${u.id} 出界了`);
    assert.equal(u.row, MID_ROW, `${u.id} 应摆在正中那一行`);
  }
  // 每一对（本体/替身、第一个/第二个角色）都严格镜像
  for (const [mine, theirs] of [['p1-user', 'p2-user'], ['p1-stand', 'p2-stand'],
    ['p1b-user', 'p2b-user'], ['p1b-stand', 'p2b-stand']]) {
    assert.equal(game.unit(theirs).col, mirrorCol(game.unit(mine).col), `${mine} 与 ${theirs} 应左右镜像`);
    assert.equal(game.unit(theirs).row, game.unit(mine).row);
  }
  // 具体列位：P1 在 1/3（第二对，外圈）与 5/7（第一对，内圈）；镜像出 P2 的 16/14 与 12/10
  assert.deepEqual([...side('p1').map(u => u.col)].sort((a, b) => a - b), [1, 3, 5, 7]);
  assert.deepEqual([...side('p2').map(u => u.col)].sort((a, b) => a - b), [10, 12, 14, 16]);
  // 不过中线（两方各占一边），而且离边界也不贴死
  for (const u of side('p1')) assert.ok(u.col < MID_COL, `${u.id} 越过了中线`);
  for (const u of side('p2')) assert.ok(u.col > MID_COL, `${u.id} 越过了中线`);
  assert.ok(Math.min(...game.s.units.map(u => u.col)) >= 1, '最外侧离左边还有 1 列');
  assert.ok(Math.max(...game.s.units.map(u => u.col)) <= COLS - 2, '最外侧离右边还有 1 列');
  // 与敌方保持合理距离：内圈两队最近隔 3 格（与旧棋盘一致），且开局没人够得着对手
  const cross = Math.min(...side('p1').flatMap(a => side('p2')
    .map(b => hexDist(game.tile(a), game.tile(b)))));
  assert.equal(cross, 3, '★ 内圈两队最近隔 3 格（旧棋盘也是 3 格，一个数没变）');
  for (const u of game.s.units) {
    assert.equal(game.targets(u, u.range || 0).length, 0, `★ ${u.id} 一开局就够得着对手`);
  }
  for (const slot of game.s.slots) {
    assert.ok(game.pairDistance(slot) > 0 && game.pairDistance(slot) <= game.distLimit(slot),
      `${slot} 的连携距离 ${game.pairDistance(slot)} 不合法`);
  }
  // 同一队的四个列位互不相同（不会两对叠在一根线上）
  assert.equal(new Set(side('p1').map(u => u.col)).size, 4);
  assert.equal(new Set(side('p2').map(u => u.col)).size, 4);
  // 多个种子都成立（摆位是数据的，不该看运气）
  for (const seed of [7, 2024, 12345]) {
    const g = duo('jotaro', 'dio', 'kakyoin', 'iggy', { seed });
    for (const u of g.s.units) assert.equal(u.row, MID_ROW, `seed ${seed}：${u.id} 的行`);
    assert.equal(new Set(g.s.units.map(u => tileKey(g.tile(u)))).size, 8, `seed ${seed}：不能有重叠`);
  }
});

// ===================== ③ 地形数量与判据 =====================

test('③ 地形数量按面积给足（×1.52），而且不挨出生点、不压单位与柱子、不跑到棋盘外', () => {
  const areaRatio = (COLS * ROWS) / OLD.area;   // 234 / 154 ≈ 1.5195
  for (const seed of [42, 7, 999, 20261005]) {
    const game = new Game({ random: seeded(seed) });
    game.start('avdol', 'kakyoin');
    const counts = terrainCounts(game);
    let total = 0;
    for (const type of TERRAIN_TYPES) {
      // ① **下限**：每种都不许少于"按面积摊下来的数量"（四舍五入）
      assert.ok(counts[type] >= Math.round(OLD.terrain[type] * areaRatio),
        `seed ${seed}：岩石/草丛/恢复点/毒沼里的 ${type} 只有 ${counts[type]} 块，没按面积给足`);
      assert.ok(counts[type] > OLD.terrain[type], `seed ${seed}：${type} 至少要比旧棋盘多`);
      total += counts[type];
    }
    // ② 正好是"基线 × 面积比"（不是拍脑袋凑的数）
    assert.deepEqual(counts, Object.fromEntries(TERRAIN_TYPES.map(t =>
      [t, Math.round(OLD.terrain[t] * areaRatio)])), `seed ${seed}：地形数量的口径`);
    assert.ok(total > Object.values(OLD.terrain).reduce((a, b) => a + b, 0), '总数也要涨');
    // ③ 判据照旧：不与**任何单位的出生点**相邻（`hexDist > 1`）
    for (const u of game.s.units) for (const t of game.tiles.filter(t => game.s.terrain[tileKey(t)])) {
      assert.ok(hexDist(game.tile(u), t) > 1, `seed ${seed}：地形贴着 ${u.id} 的出生点`);
    }
    // ④ 不与单位/柱子冲突，而且每一块都真的落在棋盘上（数量涨了也不能"铺到格子外面去"）
    const taken = new Set(unitTiles(game).map(tileKey));
    for (const key of Object.keys(game.s.terrain)) {
      const [row, col] = key.split(',').map(Number);
      const tile = game.at(row, col);
      assert.ok(tile, `seed ${seed}：地形落在 (${key}) —— 那不是棋盘上的格子`);
      assert.equal(taken.has(key), false, `seed ${seed}：地形压在单位或柱子上（${key}）`);
    }
  }
  // 船体关卡照旧一块野外地形都不撒（这条规则没被"数量变多"带跑）
  const ship = new Game({ random: seeded(13) });
  ship.start(chapter('chapter-5').player, chapter('chapter-5').enemy, 'ai', { story: 'chapter-5' });
  for (const type of Object.values(ship.s.terrain)) assert.equal(type, 'rock', '船舱里只有钢壁');
});

// ===================== ④ 三处剧情机制坐标 =====================

test('④-1 第四章的木甲板还在画面正中央（2026-10-05 起是"全宽、厚 3 行"的一条带子）', () => {
  const sea = new Game({ random: seeded(7) });
  sea.start(chapter('chapter-4').player, chapter('chapter-4').enemy, 'ai', { story: 'chapter-4' });
  const deck = tiles.filter(t => !sea.isWaterTile(t));
  // ★★ 2026-10-05 用户拍板（本次改动）：原来是"4 列 × 5 行 = 20 格"，现在是
  //   **"横跨左右全宽、厚 3 行、垂直居中"** → 18 × 3 = 54 格（`deck.length === 20` 被直接推翻）。
  assert.equal(deck.length, 54, '★ 现在是"全宽一条带子"：18 列 × 3 行 = 54 格');
  assert.equal(deck.length, COLS * (SEA_DECK.rowEnd - SEA_DECK.rowStart + 1), '★ 格数 ＝ 整行宽 × 行数');
  // 居中：纵向仍关于棋盘中心对称；横向现在**铺满整行**（0 与 COLS−1 都是甲板）
  assert.equal(SEA_DECK.rowStart + SEA_DECK.rowEnd, ROWS - 1, '★ 行方向居中');
  assert.equal(SEA_DECK.colStart + SEA_DECK.colEnd, COLS - 1, '列方向也居中（铺满全宽时这一条自然成立）');
  assert.equal(SEA_DECK.colStart, 0, '★ 甲板从最左一列开始（不留水面）');
  assert.equal(SEA_DECK.colEnd, COLS - 1, '★ 一直到最右一列（横跨左右全宽）');
  assert.equal(SEA_DECK.rowEnd - SEA_DECK.rowStart + 1, 3, '★ 厚度正好 3 行');
  // "画面中央"的像素口径：甲板那 54 格的包围盒中心 ≈ 画布中心
  const box = deck.reduce((a, t) => ({
    x0: Math.min(a.x0, t.cx - HX / 2), x1: Math.max(a.x1, t.cx + HX / 2),
    y0: Math.min(a.y0, t.cy - R), y1: Math.max(a.y1, t.cy + R),
  }), { x0: Infinity, x1: -Infinity, y0: Infinity, y1: -Infinity });
  assert.ok(Math.abs((box.x0 + box.x1) / 2 - CANVAS_W / 2) <= HX / 2, '★ 甲板横向在画面中央（半列以内）');
  assert.ok(Math.abs((box.y0 + box.y1) / 2 - CANVAS_H / 2) <= 1, '★ 甲板纵向正好在画面中央');
  // 而且它**确实挪过位置**（旧棋盘的 5–8 / 3–7 与加地图时的 7–10 / 4–8 都已经不对了）
  assert.notDeepEqual(SEA_DECK, { colStart: 5, colEnd: 8, rowStart: 3, rowEnd: 7 });
  assert.notDeepEqual(SEA_DECK, { colStart: 7, colEnd: 10, rowStart: 4, rowEnd: 8 });
});

test('④-2 第五章的船体要害仍在角落（三个角落坐标都按 COLS/ROWS 算，不是旧常数）', () => {
  const corner = (r, c) => (r <= 1 || r >= ROWS - 2) && (c <= 1 || c >= COLS - 2);
  assert.equal(STRENGTH.parts.length, 3, '还是三个要害');
  for (const def of STRENGTH.parts) {
    assert.ok(corner(def.row, def.col), `要害「${def.name}」应固定在角落，现在是 (${def.row},${def.col})`);
    assert.ok(def.row >= 0 && def.row < ROWS && def.col >= 0 && def.col < COLS, '角落也得在界内');
  }
  assert.equal(new Set(STRENGTH.parts.map(p => `${p.row},${p.col}`)).size, 3, '三个要害各占一角');
  // ★ "角落"贴着**新棋盘**的右下角：右下那个要害必须用上 COLS−2 / ROWS−2
  assert.ok(STRENGTH.parts.some(p => p.col === COLS - 2), '右上那个要害要贴着新的右边');
  assert.ok(STRENGTH.parts.some(p => p.row === ROWS - 2), '右下那个要害要贴着新的下边');
  // 开局真的只有一个要害、而且就在那个角落里
  const game = new Game({ random: seeded(13) });
  game.start(chapter('chapter-5').player, chapter('chapter-5').enemy, 'ai', { story: 'chapter-5' });
  const parts = game.shipParts('p2');
  assert.equal(parts.length, 1);
  assert.ok(corner(parts[0].row, parts[0].col), '开局那个要害也在角落');
  // 棋盘变形的隔板位也必须落在棋盘里、且不与要害重合
  for (const slot of STRENGTH.bulwarkSlots) {
    assert.ok(slot.row >= 0 && slot.row < ROWS && slot.col >= 0 && slot.col < COLS,
      `隔板位 (${slot.row},${slot.col}) 跑到棋盘外了`);
    assert.equal(STRENGTH.parts.some(p => p.row === slot.row && p.col === slot.col), false, '隔板位不该压着要害');
  }
  // 猩猩的登场点也在（新）正中央
  assert.equal(STRENGTH.bossSpawn.row, MID_ROW);
  assert.ok(Math.abs(STRENGTH.bossSpawn.col - MID_COL) <= 1, '登场点要在中线附近');
});

test('④-3 第八章的反光点仍撒在中场、不贴边（判据按 COLS/ROWS 算）', () => {
  for (const seed of [13, 7919, 9421]) {
    const game = openScene(phase2, { seed });
    const mirrors = game.s.mirrors;
    assert.equal(mirrors.length, MIRRORS.count, `seed ${seed}：该撒满 ${MIRRORS.count} 个`);
    for (const m of mirrors) {
      assert.ok(m.row >= MIRRORS.margin && m.row <= ROWS - 1 - MIRRORS.margin, `seed ${seed}：第 ${m.row} 行贴边了`);
      assert.ok(m.col >= MIRRORS.margin && m.col <= COLS - 1 - MIRRORS.margin, `seed ${seed}：第 ${m.col} 列贴边了`);
      // "中场"＝ 离每条边至少 margin 格；所以它一定不是外圈那几行/列
      assert.ok(m.row > 0 && m.row < ROWS - 1 && m.col > 0 && m.col < COLS - 1, '总之不在最外圈');
    }
    assert.equal(new Set(mirrors.map(m => `${m.row},${m.col}`)).size, mirrors.length, '反光点之间不重叠');
  }
  // 中场够大：18×13 上 margin=2 划出 14×9 = 126 格，撒 4 个绰绰有余（旧棋盘是 10×7 = 70 格）
  const midField = tiles.filter(t => t.row >= MIRRORS.margin && t.row <= ROWS - 1 - MIRRORS.margin
    && t.col >= MIRRORS.margin && t.col <= COLS - 1 - MIRRORS.margin);
  assert.equal(midField.length, (COLS - 2 * MIRRORS.margin) * (ROWS - 2 * MIRRORS.margin));
  assert.ok(midField.length >= OLD.cols * OLD.rows / 2, '中场本身也得跟着变大');
});

// ===================== ⑤ 多种子收敛 =====================

test('⑤ 2v2 用真 AI 也打得完（多个种子，不许卡死）', () => {
  for (const seed of [7, 2024, 13, 9421]) {
    const game = duo('jotaro', 'dio', 'kakyoin', 'iggy', { mode: 'ai', seed });
    const steps = playOut(game, 600);
    assert.ok(steps < 600, `seed ${seed}：这一局没打完（走了 ${steps} 步，说明 AI 在空过回合）`);
    assert.equal(game.s.phase, 'result', `seed ${seed}：要分出胜负`);
    assert.ok(['p1', 'p2'].includes(game.s.winner), `seed ${seed}：胜负落在某一队上`);
    // 对局状态在整局里始终合法
    for (const slot of game.s.slots) {
      assert.ok(Number.isFinite(game.s.hp[slot]) && game.s.hp[slot] >= 0, `seed ${seed}：${slot} 的血量`);
      assert.ok(game.pairDistance(slot) <= game.distLimit(slot), `seed ${seed}：${slot} 的连携距离`);
    }
  }
});

test('⑤ 第八章两场（皇帝 / 吊死者）都打得完，机制仍不串场', () => {
  for (const [name, scene] of [['阶段 1', phase1], ['阶段 2', phase2]]) {
    for (const seed of [13, 7919]) {
      const game = openScene(scene, { seed });
      const steps = playOut(game, 900);
      assert.ok(steps < 900, `★ ${name} seed ${seed}：没打完（走了 ${steps} 步）`);
      assert.equal(game.s.phase, 'result', `${name} seed ${seed}：要分出胜负`);
      // 阶段 1 永远没有反光点、阶段 2 永远没有弹道（旗标没被尺寸改坏）
      if (scene.lineup.enemy === 'emperor') assert.deepEqual(game.s.mirrors, []);
      else assert.equal(game.s.shotAim, null);
    }
  }
});

test('⑤ 全配对（15×15 = 225 组）在放大后的棋盘上仍然全部收敛', () => {
  // ⚠️ 既有那一批（两个种子）在 `tests/game.test.js` 里；这里换一个种子再跑一遍全配对，
  //    专门守"棋盘变大之后有没有哪一对突然打不完"（现在最慢的一组 80 步、上限 500 步）。
  const keys = Object.keys(FIGHTERS);
  assert.equal(keys.length ** 2, 225);
  let worst = 0, worstPair = '';
  for (const a of keys) for (const b of keys) {
    const game = new Game({ random: seeded(77) });
    game.start(a, b);
    let actions = 0;
    while (game.s.phase === 'battle' && actions < 500) {
      assert.ok(playAIAction(game, chooseAI(game)), `${a}/${b}: AI 的决定被拒了`);
      actions++;
    }
    if (actions > worst) { worst = actions; worstPair = `${a}/${b}`; }
    assert.equal(game.s.phase, 'result', `★ ${a}/${b} 没打完（${actions} 步）`);
    assert.ok(['p1', 'p2'].includes(game.s.winner), `${a}/${b}: 胜负落在某一队上`);
  }
  assert.ok(worst <= 500, `最慢的一组 ${worstPair} 走了 ${worst} 步`);
});

// ===================== ⑥ 渲染冒烟 =====================

/**
 * 假 2D 上下文：**比 render.test.js 那个多记两样东西** —— 属性赋值（`ctx.font = ...`）
 * 与"这一刻有没有处在 clip 里"。棋盘放大后格子变小，名字/血条究竟还看不看得清、
 * 有没有被六边形的裁剪吃掉笔画，都要靠这两样才量得出来。
 */
function recorder() {
  const calls = [];
  const stack = [];
  let font = '';
  const ctx = new Proxy({}, {
    get(_, prop) {
      if (prop === 'canvas') return { width: CANVAS_W, height: CANVAS_H };
      if (typeof prop === 'symbol') return undefined;
      return (...args) => {
        if (prop === 'save') stack.push(false);
        else if (prop === 'clip' && stack.length) stack[stack.length - 1] = true;
        else if (prop === 'restore') stack.pop();
        calls.push({ prop, args, font, clipped: stack.some(Boolean) });
        if (prop === 'createLinearGradient' || prop === 'createRadialGradient') return { addColorStop() {} };
        if (prop === 'measureText') return { width: 10 };
        return undefined;
      };
    },
    set(_, prop, value) { if (prop === 'font') font = value; return true; },
  });
  return { ctx, calls };
}
const fakeImage = (width = 192, height = 288) => ({ width, height });
/** 在假 DOM 里建一个渲染器（照 render.test.js 的写法）。 */
function withVisual(game, run) {
  const previous = globalThis.document, previousWindow = globalThis.window;
  globalThis.window = { devicePixelRatio: 1, addEventListener() {}, removeEventListener() {} };
  try {
    const { ctx, calls } = recorder();
    const canvas = { width: CANVAS_W, height: CANVAS_H, style: {}, dataset: {},
      getContext: () => ctx, addEventListener() {}, getBoundingClientRect: () => ({ left: 0, top: 0, width: CANVAS_W, height: CANVAS_H }) };
    globalThis.document = {
      getElementById: id => (id === 'board' ? canvas : null),
      createElement: () => ({ width: 0, height: 0, style: {}, getContext: () => recorder().ctx }),
    };
    const visual = new BoardVisual(game);
    const sprites = new Map();
    for (const art of Object.values(CHARACTER_ART)) for (const key of artKeys(art)) sprites.set(key, fakeImage());
    for (const key of ['rock', 'bush', 'heal', 'hazard']) sprites.set(key, fakeImage());
    visual.setSprites(sprites);
    return run({ visual, calls });
  } finally {
    if (previous === undefined) delete globalThis.document; else globalThis.document = previous;
    if (previousWindow === undefined) delete globalThis.window; else globalThis.window = previousWindow;
  }
}
const drawnTexts = calls => calls.filter(c => c.prop === 'fillText' || c.prop === 'strokeText');
/** 棋子那条身份标签（`P1 · 主` / `P1·2 · 替`）。 */
const isUnitTag = text => /^(P1|P2)(·2)? · (主|替)$/.test(String(text));

test('⑥ 一帧画得出来、save/restore 配平、所有文字都在画布内（1v1 / 2v2 / 海面 / 船舱）', () => {
  const frames = [
    ['1v1 承太郎 对 DIO', (() => { const g = new Game({ random: seeded(42) }); g.start('jotaro', 'dio'); return g; })()],
    ['2v2（八枚棋子）', duo()],
    ['第四章海面（木甲板）', (() => {
      const g = new Game({ random: seeded(7) });
      g.start(chapter('chapter-4').player, chapter('chapter-4').enemy, 'ai', { story: 'chapter-4' });
      return g;
    })()],
    ['第五章船舱（角落要害 + 钢壁）', (() => {
      const g = new Game({ random: seeded(13) });
      g.start(chapter('chapter-5').player, chapter('chapter-5').enemy, 'ai', { story: 'chapter-5' });
      return g;
    })()],
  ];
  for (const [name, game] of frames) {
    withVisual(game, ({ visual, calls }) => {
      const view = game.actionView();
      assert.doesNotThrow(() => visual.render(view, 0), `${name}：这一帧不该抛错`);
      const saves = calls.filter(c => c.prop === 'save').length;
      const restores = calls.filter(c => c.prop === 'restore').length;
      assert.equal(saves, restores, `${name}：save / restore 必须配平`);
      // 棋子都轮到了立绘
      const images = calls.filter(c => c.prop === 'drawImage').length;
      assert.ok(images >= game.s.units.length, `${name}：drawImage 只画了 ${images} 次`);
      // 所有文字都在画布内（放大后画布是 1106×742，坐标带与落款都不能跑出去）
      for (const { prop, args } of drawnTexts(calls)) {
        const [text, x, y] = args;
        assert.ok(x >= 0 && x <= CANVAS_W, `${name}：${prop}「${text}」的 x=${x} 跑出画布`);
        assert.ok(y >= 0 && y <= CANVAS_H, `${name}：${prop}「${text}」的 y=${y} 跑出画布`);
      }
    });
  }
});

test('⑥ 棋子的名字与血条：放大后仍然够大、而且不再被六边形的裁剪切掉笔画', () => {
  const game = duo();
  withVisual(game, ({ visual, calls }) => {
    assert.doesNotThrow(() => visual.render(game.actionView(), 0), '这一帧不该抛错');
    // ① 名字那一行：8 枚棋子各一条（填充那一次；每一条前面还跟着一次描边），
    //   字号 ≥ 9.5px（原来是 8.5px，格子变小后必须补回来）
    const labels = calls.filter(c => c.prop === 'fillText' && isUnitTag(c.args[0]));
    assert.equal(labels.length, game.s.units.length, '每枚棋子都要有名字，一条都不能少');
    for (const call of labels) {
      const size = Number(/(\d+(?:\.\d+)?)px/.exec(call.font)?.[1]);
      assert.ok(size >= 9.5, `★「${call.args[0]}」只有 ${size}px，放大棋盘后看不清了`);
      assert.equal(call.clipped, false, `★「${call.args[0]}」画在裁剪区里 —— 六边形下端很窄，笔画会被切掉`);
      // 名字下面必须有那条深色描边（`strokeText`），否则压在立绘/花纹上读不清
      const outline = drawnTexts(calls).find(c => c.prop === 'strokeText' && c.args[0] === call.args[0]);
      assert.ok(outline, `★「${call.args[0]}」缺少深色描边`);
      assert.equal(outline.font, call.font, '描边与填充必须是同一号字');
    }
    // ② 血条：每枚棋子一条 36×2.6 的横条（原 34×2，同样按比例放大）
    const bars = calls.filter(c => c.prop === 'fillRect' && c.args[2] >= 36 && c.args[3] <= 4);
    assert.ok(bars.length >= game.s.units.length, `★ 血条只有 ${bars.length} 条，至少要覆盖 ${game.s.units.length} 枚棋子`);
    for (const bar of bars) {
      const [x, y, w, h] = bar.args;
      assert.ok(w >= 36 && h >= 2.5, `血条 ${w}×${h} 太小了`);
      assert.ok(x >= 0 && x + w <= CANVAS_W && y >= 0 && y + h <= CANVAS_H, '血条要落在画布内');
    }
  });
});
