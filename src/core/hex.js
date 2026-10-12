/**
 * 尖顶六边形的唯一几何来源，供规则、绘制和指针共用。
 *
 * ★★ 2026-10-05 用户拍板：**棋盘从 14×11 放大到 18×13**（154 格 → 234 格）。
 *   这是一次**纯尺寸**改动：格子几何（`R` / `HX` / `VY` / `PAD`）一个数都没动，
 *   所以每格的观感、地形贴图、棋子立绘的比例全都与改动前逐值相同——变的只有**有多少格**。
 *   ⚠️ 连带口径（改动前先看这三条）：
 *     ① 逻辑画布 `CANVAS_W`／`CANVAS_H` 由 COLS/ROWS **算出来**，所以它们会自动变大
 *        （877×643 → 1106×742）；`layout.js` 会把画布缩放到容器里，于是**屏幕上的格子变小约 13%~21%**。
 *        格内那几个字号（名字／状态小标／血条）按这个比例在 `render.js` 里做了补偿，别照抄旧值。
 *     ② 凡是「棋盘中心 / 角落 / 镜像列 / 不贴边」的判据一律**按 COLS/ROWS 算**，不许写死；
 *        摆位表在 `game.js` 的 `DEPLOY`，场景判据在 `rules.js` 的 `SEA_DECK` / `STRENGTH` / `MIRRORS`。
 *     ③ 一张 18 列的棋盘上，镜像列 ＝ `COLS - 1 - 列`（**17 − 列**）。
 */
const SQ3 = Math.sqrt(3);

export const COLS = 18;
export const ROWS = 13;
export const R = 33;
export const PAD = 24;
export const HX = SQ3 * R;      // 列间距 ≈ 57.16
export const VY = 1.5 * R;      // 行间距 = 49.5
export const LABEL = 17;        // 边缘坐标带宽度

export const BOARD_W = Math.ceil(PAD * 2 + COLS * HX + HX / 2);
export const BOARD_H = Math.ceil(PAD * 2 + R * 2 + (ROWS - 1) * VY);
export const CANVAS_W = BOARD_W;
export const CANVAS_H = BOARD_H + LABEL * 2;

/**
 * 左右镜像列：P1 的列 → P2 的列（关于棋盘中心镜像）。
 * ⚠️ **唯一口径**——摆位（game.js 的 `deploySpot`）、场景数据（rules.js）都调它，
 *    别在任何地方手写 `COLS - 1 - 列`（18 列时是 17 − 列，14 列时代是 13 − 列，写死了就会随尺寸失配）。
 */
export const mirrorCol = col => COLS - 1 - col;
/**
 * 棋盘**正中的那一行**（13 行 → 6；旧 11 行时是 5）：开局摆位行、
 * 「从棋盘中央登场」这类判据都用它，别写死行号。
 */
export const MID_ROW = (ROWS - 1) >> 1;

/** 生成全部格子。q/r 为轴向坐标，cx/cy 为画布像素中心（已含 LABEL 偏移）。 */
export function makeTiles() {
  const tiles = [];
  for (let row = 0; row < ROWS; row++) {
    for (let col = 0; col < COLS; col++) {
      tiles.push({
        row,
        col,
        r: row,
        q: col - ((row - (row % 2)) >> 1),
        cx: PAD + HX / 2 + col * HX + (row % 2) * (HX / 2),
        cy: LABEL + PAD + R + row * VY,
      });
    }
  }
  return tiles;
}

export function buildIndex(tiles) {
  const byQR = new Map();
  const byRC = new Map();
  for (const t of tiles) {
    byQR.set(`${t.q},${t.r}`, t);
    byRC.set(`${t.row},${t.col}`, t);
  }
  return { byQR, byRC, at: (r, c) => byRC.get(`${r},${c}`) || null };
}

export function hexDist(a, b) {
  const dq = a.q - b.q;
  const dr = a.r - b.r;
  return (Math.abs(dq) + Math.abs(dr) + Math.abs(dq + dr)) / 2;
}

export function neighbors(t, byQR) {
  const { q, r } = t;
  return [
    [q + 1, r], [q - 1, r], [q, r + 1],
    [q, r - 1], [q + 1, r - 1], [q - 1, r + 1],
  ].map(([qq, rr]) => byQR.get(`${qq},${rr}`)).filter(Boolean);
}

/** 尖顶六边形的路径（半径可略缩以留出格间缝隙）。 */
export function hexPath(ctx, cx, cy, radius = R) {
  ctx.beginPath();
  for (let i = 0; i < 6; i++) {
    const a = (Math.PI / 180) * (60 * i - 30);
    const x = cx + radius * Math.cos(a);
    const y = cy + radius * Math.sin(a);
    if (i) ctx.lineTo(x, y);
    else ctx.moveTo(x, y);
  }
  ctx.closePath();
}

/** 精确的六边形包含测试；圆形近似会把棋盘外的角落也算作格子。 */
export function containsPoint(t, mx, my, radius = R) {
  const dx = Math.abs(t.cx - mx), dy = Math.abs(t.cy - my);
  return dx <= SQ3 * radius / 2 + 1e-7 && dy <= radius + 1e-7
    && dx + SQ3 * dy <= SQ3 * radius + 1e-7;
}

/** Client CSS pixels → logical coordinates, independent of backing-store DPR. */
export function clientPoint(rect, clientX, clientY) {
  return { x: (clientX - rect.left) * CANVAS_W / rect.width,
    y: (clientY - rect.top) * CANVAS_H / rect.height };
}

export const tileKey = t => `${t.row},${t.col}`;
export const tileLabel = t => t ? `${String.fromCharCode(65 + t.col)}${t.row + 1}` : '—';

/** 把逻辑画布坐标反查成格子。 */
export function tileAt(tiles, mx, my) {
  if (!Number.isFinite(mx) || !Number.isFinite(my)) return null;
  let best = null;
  let bd = Infinity;
  for (const t of tiles) {
    const d = (t.cx - mx) ** 2 + (t.cy - my) ** 2;
    if (d < bd) { bd = d; best = t; }
  }
  return best && containsPoint(best, mx, my) ? best : null;
}

/* ------------------------------------------------------------------ 绘制 */

// 底盘基调：靛蓝→沙金 双色调（见 ART_BIBLE §2.1）
const TILE_LIGHT = "#302b43";
const TILE_DARK = "#2b263c";
const TILE_TOP_EDGE = "rgba(200,182,153,.28)";
const TILE_BOT_EDGE = "rgba(12,8,24,.7)";

/** 画一格「实体地砖」：顶部高光 + 底部厚边 + 投影，做出厚度。 */
export function drawSlab(ctx, t, radius = R - 1) {
  const checker = (t.row + t.col) % 2;

  // 投影
  ctx.save();
  hexPath(ctx, t.cx, t.cy + 2.5, radius);
  ctx.fillStyle = "rgba(0,0,0,.55)";
  ctx.fill();
  ctx.restore();

  // 砖面
  hexPath(ctx, t.cx, t.cy, radius);
  ctx.fillStyle = checker ? TILE_LIGHT : TILE_DARK;
  ctx.fill();

  // Deterministic, low contrast stone grain. Pure geometry stays editable.
  ctx.save();
  hexPath(ctx, t.cx, t.cy, radius - 1);
  ctx.clip();
  let seed = (t.row * 199 + t.col * 431 + 17) >>> 0;
  for (let i = 0; i < 20; i++) {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
    const x = t.cx + ((seed & 255) / 255 - .5) * R * 2;
    const y = t.cy + (((seed >>> 8) & 255) / 255 - .5) * R * 2;
    ctx.fillStyle = i % 3 ? 'rgba(217,192,146,.07)' : 'rgba(8,6,20,.2)';
    ctx.fillRect(x, y, i % 2 ? 1 : 2, 1);
  }
  if ((t.row * 7 + t.col) % 5 === 0) {
    ctx.strokeStyle = 'rgba(16,12,28,.4)';
    ctx.lineWidth = .8;
    ctx.beginPath();
    ctx.moveTo(t.cx + 13, t.cy - 22);
    ctx.lineTo(t.cx + 8, t.cy - 13);
    ctx.lineTo(t.cx + 13, t.cy - 7);
    ctx.stroke();
  }
  ctx.restore();

  // 底部厚边
  ctx.save();
  hexPath(ctx, t.cx, t.cy, radius);
  ctx.clip();
  ctx.fillStyle = TILE_BOT_EDGE;
  ctx.fillRect(t.cx - R, t.cy + radius - 4, R * 2, 10);
  ctx.restore();

  // 顶部高光
  ctx.save();
  hexPath(ctx, t.cx, t.cy, radius);
  ctx.clip();
  ctx.strokeStyle = TILE_TOP_EDGE;
  ctx.lineWidth = 1.6;
  ctx.beginPath();
  ctx.moveTo(t.cx - radius * 0.86, t.cy - radius * 0.5);
  ctx.lineTo(t.cx, t.cy - radius);
  ctx.lineTo(t.cx + radius * 0.86, t.cy - radius * 0.5);
  ctx.stroke();
  ctx.restore();

  // 描边
  hexPath(ctx, t.cx, t.cy, radius);
  ctx.strokeStyle = "rgba(12,8,22,.85)";
  ctx.lineWidth = 1;
  ctx.stroke();
}

/** 边缘坐标：列 A–R（18 列）、行 1–13。专业感性价比最高的一笔。 */
export function drawLabels(ctx, tiles) {
  ctx.save();
  ctx.fillStyle = "#c1ad8b";
  ctx.font = "700 10px ui-monospace, SFMono-Regular, Menlo, monospace";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  for (let c = 0; c < COLS; c++) {
    const t = tiles.find((x) => x.row === 0 && x.col === c);
    if (t) {
      ctx.fillText(String.fromCharCode(65 + c), t.cx, LABEL + 5);
      ctx.fillText(String.fromCharCode(65 + c), t.cx, CANVAS_H - LABEL - 4);
    }
  }
  ctx.textAlign = "right";
  for (let r = 0; r < ROWS; r++) {
    const t = tiles.find((x) => x.row === r && x.col === 0);
    if (t) ctx.fillText(String(r + 1), PAD - 4, t.cy);
  }
  ctx.restore();
}

/** 可移动落点：暗青填充 + 中心小三角（比整格亮色更克制清楚）。 */
export function drawMoveHint(ctx, t) {
  hexPath(ctx, t.cx, t.cy, R - 3);
  ctx.fillStyle = "rgba(70,200,180,.16)";
  ctx.fill();
  ctx.strokeStyle = "rgba(110,230,205,.55)";
  ctx.lineWidth = 1.4;
  ctx.stroke();
  const s = 4.2;
  ctx.beginPath();
  ctx.moveTo(t.cx, t.cy - s);
  ctx.lineTo(t.cx + s * 0.9, t.cy + s * 0.7);
  ctx.lineTo(t.cx - s * 0.9, t.cy + s * 0.7);
  ctx.closePath();
  ctx.fillStyle = "rgba(150,245,220,.80)";
  ctx.fill();
}

/** 攻击范围：45° 斜线阴影填充（漫画味），不用实心红。 */
export function drawAttackZone(ctx, t) {
  ctx.save();
  hexPath(ctx, t.cx, t.cy, R - 3);
  ctx.clip();
  ctx.fillStyle = "rgba(210,50,70,.10)";
  ctx.fillRect(t.cx - R, t.cy - R, R * 2, R * 2);
  ctx.strokeStyle = "rgba(255,70,90,.34)";
  ctx.lineWidth = 1.6;
  ctx.beginPath();
  for (let i = -3; i <= 3; i++) {
    const o = i * 11;
    ctx.moveTo(t.cx - R + o, t.cy - R);
    ctx.lineTo(t.cx + R + o, t.cy + R);
  }
  ctx.stroke();
  ctx.restore();
  hexPath(ctx, t.cx, t.cy, R - 3);
  ctx.strokeStyle = "rgba(230,60,80,.45)";
  ctx.lineWidth = 1.2;
  ctx.stroke();
}

/** 选中：金环 + 旋转虚线（t 为秒，由主循环驱动）。 */
export function drawSelected(ctx, t, time) {
  ctx.save();
  hexPath(ctx, t.cx, t.cy, R - 2);
  ctx.strokeStyle = "#E8C24A";
  ctx.lineWidth = 2.4;
  ctx.setLineDash([7, 5]);
  ctx.lineDashOffset = -(time * 22) % 12;
  ctx.stroke();
  ctx.restore();
}

/** 可攻击目标：红环 + 呼吸脉动。
 *  ★ 2026-10-09：加了 `color` 形参（缺省仍是原来的红）——东方仗助「修复」的**治疗友军**那一圈
 *    要用绿色区分（见 render.js 的 `view.fixable`），别的调用一个字都不用改。 */
export function drawTargetRing(ctx, t, time, color = '255,45,65') {
  const pulse = 0.62 + 0.38 * Math.sin(time * 5.2);
  ctx.save();
  hexPath(ctx, t.cx, t.cy, R - 1.5);
  ctx.strokeStyle = `rgba(${color},${0.45 + 0.5 * pulse})`;
  ctx.lineWidth = 2.6 + pulse * 1.4;
  ctx.stroke();
  ctx.restore();
}
