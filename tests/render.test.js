import test from 'node:test';
import assert from 'node:assert/strict';
import { BoardVisual } from '../src/ui/render.js';
import { Game } from '../src/core/game.js';
import { CHARACTER_ART, artKeys } from '../src/ui/assets.js';
import { CANVAS_W, CANVAS_H, R, tileKey } from '../src/core/hex.js';

/**
 * 假 2D 上下文：记录所有调用，用来断言「渲染没有抛错、每个单位都画了立绘、save/restore 配平」。
 * 单单位角色（乔瑟夫）没有同伴，曾经让连携虚线那段抛错并中断整帧，
 * 表现为"选中他之后其他棋子的立绘全部消失"——这条测试专门防它回归。
 */
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

/**
 * 在测试环境里搭一个最小的「浏览器 + 画布」环境（渲染器构造时会用到
 * document.getElementById('board') 与 createElement('canvas')），跑完自动还原。
 */
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

/** 让渲染器拿到全部立绘（不依赖真实图片文件）。 */
function withSprites(visual) {
  const sprites = new Map();
  for (const art of Object.values(CHARACTER_ART)) for (const key of artKeys(art)) sprites.set(key, fakeImage());
  for (const key of ['rock', 'bush', 'heal', 'hazard']) sprites.set(key, fakeImage());
  visual.setSprites(sprites);
}

test('an RAF timestamp before the move event stays at the starting tile instead of indexing path[-1]', () => {
  const game = new Game(); game.start('jotaro', 'dio');
  const unit = game.unit('p1-user'), from = game.tile(unit), target = game.reachable(unit)[0];
  Object.assign(unit, { row: target.row, col: target.col });
  const visual = { game, moves: new Map([[unit.id, { from, path: [target], start: 1000, duration: 100 }]]) };
  const start = BoardVisual.prototype.position.call(visual, unit, 995);
  assert.deepEqual(start, { cx: from.cx, cy: from.cy });
  const midway = BoardVisual.prototype.position.call(visual, unit, 1050);
  assert.ok(Math.abs(midway.cx - (from.cx + target.cx) / 2) < 1e-6);
  assert.equal(BoardVisual.prototype.position.call(visual, unit, 1100), target);
  assert.equal(visual.moves.size, 0);
});

test('position 对空单位返回 null（单单位角色没有同伴时不该把整帧搞崩）', () => {
  const game = new Game(); game.start('joseph', 'dio');
  const visual = { game, moves: new Map() };
  assert.equal(BoardVisual.prototype.position.call(visual, undefined, 0), null);
});

test('单单位角色被选中时仍能画完一整帧：每个单位都轮到一次立绘', () => {
  // 渲染器构造时会用 document.getElementById('board') 与 createElement('canvas')，测试环境补最小桩
  const previous = globalThis.document, previousWindow = globalThis.window;
  globalThis.window = { devicePixelRatio: 1, addEventListener() {}, removeEventListener() {} };
  try {
    for (const selected of [true, false]) {
      const game = new Game({ random: () => .5 });
      game.start('joseph', 'jotaro');
      const { ctx, calls } = fakeContext();
      const canvas = { width: CANVAS_W, height: CANVAS_H, style: {}, getContext: () => ctx, addEventListener() {}, getBoundingClientRect: () => ({ left: 0, top: 0, width: CANVAS_W, height: CANVAS_H }) };
      globalThis.document = {
        getElementById: id => (id === 'board' ? canvas : null),
        createElement: () => ({ width: 0, height: 0, style: {}, getContext: () => fakeContext().ctx }),
      };
      const visual = new BoardVisual(game);
      withSprites(visual);
      if (selected) game.select('p1-user');
      const view = game.actionView();
      assert.doesNotThrow(() => visual.render(view, 0), '选中单单位角色后渲染不应抛错');
      const drawn = calls.filter(c => c.prop === 'drawImage').length;
      assert.ok(drawn >= game.s.units.length, `drawImage 只调用了 ${drawn} 次，至少要覆盖 ${game.s.units.length} 个单位`);
      const saves = calls.filter(c => c.prop === 'save').length;
      const restores = calls.filter(c => c.prop === 'restore').length;
      assert.equal(saves, restores, 'save / restore 必须配平，否则后续绘制会被裁切或位移');
    }
  } finally {
    if (previous === undefined) delete globalThis.document; else globalThis.document = previous;
    if (previousWindow === undefined) delete globalThis.window; else globalThis.window = previousWindow;
  }
});

/**
 * 画棋子时整格都在 `hexPath(…, R-1)` 的裁剪区里，所以任何贴边的小标记如果放到六边形之外，
 * 就会**整块被裁掉、玩家永远看不见**。灼烧标记当初画在 cy-28 —— 尖顶六边形在 dy=28 处的半宽
 * 只剩 8.7px，而标记从 cx+12 起算，于是它一直是个隐形标记（溺水标记最初照抄了这个位置，同样看不见）。
 * 这条测试把"标记必须完整落在六边形内"钉死。
 */
test('状态小标（灼烧 / 溺水 / 藤蔓）必须完整落在六边形内，否则会被裁剪吃掉', () => {
  const radius = R - 1;
  // 尖顶六边形：|dy| ≤ r/2 处半宽是 (√3/2)r，再往上线性收窄到 0
  const halfWidth = dy => dy <= radius / 2 ? Math.sqrt(3) / 2 * radius : Math.sqrt(3) * (radius - dy);
  const inside = (cx, cy, x, y) => {
    const dy = Math.abs(y - cy);
    return dy <= radius && Math.abs(x - cx) <= halfWidth(dy) + 1e-6;
  };

  const previous = globalThis.document, previousWindow = globalThis.window;
  globalThis.window = { devicePixelRatio: 1, addEventListener() {}, removeEventListener() {} };
  try {
    const game = new Game({ random: () => .5 });
    game.start('jotaro', 'fake_captain');
    game.s.terrain = {};
    // 三个标记同时挂在 boss 那一方：灼烧（按方）、溺水（按方）、藤蔓（按单位）
    game.s.burn.p2 = 2;
    game.s.drown.p2 = 2;
    game.s.vine['p2-stand'] = true;

    const { ctx, calls } = fakeContext();
    const canvas = { width: CANVAS_W, height: CANVAS_H, style: {}, getContext: () => ctx, addEventListener() {}, getBoundingClientRect: () => ({ left: 0, top: 0, width: CANVAS_W, height: CANVAS_H }) };
    globalThis.document = {
      getElementById: id => (id === 'board' ? canvas : null),
      createElement: () => ({ width: 0, height: 0, style: {}, getContext: () => fakeContext().ctx }),
    };
    const visual = new BoardVisual(game);
    withSprites(visual);
    visual.render(game.actionView(), 0);
    const bossUnits = game.s.units.filter(u => u.side === 'p2').length;

    // 标记是 16×11 的小方块（血条是 34×2，不会混进来）
    const badges = calls.filter(c => c.prop === 'fillRect' && c.args[2] === 16 && c.args[3] === 11);
    // 灼烧、溺水是按「方」记的 → 两个棋子各一个；藤蔓是按「单位」记的 → 只有替身那一个有
    const expected = bossUnits * 2 + 1;
    assert.equal(badges.length, expected, `应画 ${expected} 个标记，实际画了 ${badges.length} 个`);
    for (const { args } of badges) {
      const [x, y, w, h] = args;
      // 找到离这个标记最近的格子：它必须是画在某一格里的
      const centre = { x: x + w / 2, y: y + h / 2 };
      const tile = game.tiles.reduce((best, t) => Math.hypot(t.cx - centre.x, t.cy - centre.y) < Math.hypot(best.cx - centre.x, best.cy - centre.y) ? t : best);
      assert.ok(Math.hypot(tile.cx - centre.x, tile.cy - centre.y) < R, '标记必须落在某一格内');
      for (const [px, py] of [[x, y], [x + w, y], [x, y + h], [x + w, y + h]]) {
        assert.ok(inside(tile.cx, tile.cy, px, py),
          `★ 标记的一角 (${px.toFixed(1)}, ${py.toFixed(1)}) 跑到了格子 (${tile.row},${tile.col}) 的六边形之外，会被裁剪吃掉`);
      }
    }
  } finally {
    if (previous === undefined) delete globalThis.document; else globalThis.document = previous;
    if (previousWindow === undefined) delete globalThis.window; else globalThis.window = previousWindow;
  }
});

/**
 * 静态层（背景图 + 所有格子的地砖 + 地形 + 木甲板）是画到一张离屏画布上缓存的，
 * **只有地形或场地变了才该重画**。加战场背景时把 arena 拼进了缓存键，却忘了 `render()` 里
 * 那句比较还在用"只有地形"的旧键，于是两者永远不相等 —— 静态层**每帧重画一次（每秒 60 次）**，
 * 缓存完全失效。桌面看不出来，手机上是白白耗电发热。这条测试把缓存钉死。
 */
test('静态层只在场地或地形变化时重画，不能每帧重画（缓存必须真的生效）', () => {
  withBoardEnv(() => {
    const game = new Game({ random: () => .5 });
    game.start('jotaro', 'dio');
    const visual = new BoardVisual(game);
    withSprites(visual);
    const view = game.actionView();

    // 连画 30 帧，什么都没变 → 静态层一次都不该重画
    const before = visual.baseDrawCount;
    for (let frame = 0; frame < 30; frame++) visual.render(view, frame * 16);
    assert.equal(visual.baseDrawCount, before,
      `★ 没有变化时静态层重画了 ${visual.baseDrawCount - before} 次，缓存没生效`);

    // 地形变了 → 重画恰好一次
    game.s.terrain[tileKey(game.tiles[0])] = 'rock';
    visual.render(view, 1000);
    assert.equal(visual.baseDrawCount, before + 1, '地形变化应触发一次重画');
    visual.render(view, 1016);
    assert.equal(visual.baseDrawCount, before + 1, '变化之后不该继续重画');

    // 场地（arena）变了 → 也要重画一次（这正是当初写崩的那一处）
    game.s.story = { arena: 'sea' };
    visual.render(view, 2000);
    assert.equal(visual.baseDrawCount, before + 2, '★ 换场地必须触发重画（否则背景不会跟着换）');
  });
});
