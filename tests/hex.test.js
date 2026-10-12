import test from 'node:test';
import assert from 'node:assert/strict';
import { makeTiles, tileAt, containsPoint, clientPoint, R, HX, CANVAS_W, CANVAS_H, COLS, ROWS } from '../src/core/hex.js';

const tiles = makeTiles();
// ★ 2026-10-05 用户拍板：棋盘从 14×11 放大到 **18×13**，所以格数 154 → **234**（角点与命中测试的字面量同步更新）。
//   ⚠️ 只有这三个数变了：几何口径（对称边界、圆心命中、CSS 缩放反查）逐字未动。
test('234 hexagons share symmetric bounds, centers and exact polygon hit tests', () => {
  assert.equal(tiles.length, 234);
  assert.equal(COLS * ROWS, 234, '格数 ＝ 列 × 行');
  assert.equal(new Set(tiles.map(t => `${t.q},${t.r}`)).size, 234);
  const left = Math.min(...tiles.map(t => t.cx)) - HX / 2;
  const right = CANVAS_W - Math.max(...tiles.map(t => t.cx)) - HX / 2;
  const top = Math.min(...tiles.map(t => t.cy)) - R;
  const bottom = CANVAS_H - Math.max(...tiles.map(t => t.cy)) - R;
  assert.ok(Math.abs(left - right) < 1);
  assert.ok(Math.abs(top - bottom) < 1);
  for (const tile of tiles) {
    assert.equal(tileAt(tiles, tile.cx, tile.cy), tile);
    // Every vertex and edge interior, including odd-row offsets and board edges.
    for (let i = 0; i < 6; i++) {
      const a = (i * 60 - 30) * Math.PI / 180;
      const x = tile.cx + Math.cos(a) * (R - 2), y = tile.cy + Math.sin(a) * (R - 2);
      assert.ok(containsPoint(tile, x, y));
      assert.equal(tileAt(tiles, x, y), tile);
    }
  }
  assert.equal(tileAt(tiles, 0, 0), null);
  assert.equal(tileAt(tiles, CANVAS_W - 1, CANVAS_H - 1), null);
  assert.equal(tileAt(tiles, NaN, 20), null);
  const first = tiles[0];
  assert.equal(tileAt(tiles, first.cx - R + 1, first.cy), null, 'outside the polygon but inside its circumcircle');
});

test('CSS scale and scrolling convert back to the identical logical tile', () => {
  for (const scale of [.42, .71, 1, 1.12, 1.8]) {
    const rect = { left: -180.25, top: 83.625, width: CANVAS_W * scale, height: CANVAS_H * scale };
    for (const tile of tiles) {
      const p = clientPoint(rect, rect.left + tile.cx * scale, rect.top + tile.cy * scale);
      assert.equal(tileAt(tiles, p.x, p.y), tile);
    }
  }
});
