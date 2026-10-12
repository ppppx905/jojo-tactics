/**
 * 程序化特效层。
 * 设计原则（用户已定）：能在代码里做出 80% 效果的，一律不用 PNG。
 * 这里负责：网点纸 / 速度线 / 放射爆线 / 纸纹兜底。
 * 全部「生成一次 → 缓存」，绝不在每帧重建路径。
 */

const cache = new Map();

function offscreen(w, h) {
  const c = document.createElement("canvas");
  c.width = w;
  c.height = h;
  return c;
}

/* ------------------------------------------------------------ 网点纸 */
/**
 * 漫画网点：45° 排布的圆点。生成一次，之后只做 drawImage。
 * @returns {HTMLCanvasElement} 可平铺的小块
 */
export function halftonePattern(size = 8, dotR = 1.35, color = "rgba(255,255,255,.10)") {
  const key = `ht:${size}:${dotR}:${color}`;
  if (cache.has(key)) return cache.get(key);

  const c = offscreen(size, size);
  const g = c.getContext("2d");
  g.fillStyle = color;
  // 两个偏移点，保证 45° 平铺后无缝
  const pts = [
    [size * 0.25, size * 0.25],
    [size * 0.75, size * 0.75],
  ];
  for (const [x, y] of pts) {
    g.beginPath();
    g.arc(x, y, dotR, 0, Math.PI * 2);
    g.fill();
  }
  cache.set(key, c);
  return c;
}

/* ------------------------------------------------------------ 速度线 */
/**
 * 放射速度线（爆线）。生成一次后当作贴图用，进场时做缩放/旋转即可。
 */
export function speedLines(size = 512, count = 90, inner = 0.14) {
  const key = `sl:${size}:${count}:${inner}`;
  if (cache.has(key)) return cache.get(key);

  const c = offscreen(size, size);
  const g = c.getContext("2d");
  const cx = size / 2;
  const cy = size / 2;
  const r0 = size * inner;
  const r1 = size * 0.78;

  let seed = 20240911;
  const rnd = () => {
    seed = (seed * 1103515245 + 12345) & 0x7fffffff;
    return seed / 0x7fffffff;
  };

  g.lineCap = "butt";
  for (let i = 0; i < count; i++) {
    const a = (i / count) * Math.PI * 2 + rnd() * 0.05;
    const w = 0.6 + rnd() * 3.4;
    const start = r0 * (0.85 + rnd() * 0.5);
    const end = r1 * (0.7 + rnd() * 0.35);
    g.strokeStyle = `rgba(255,255,255,${0.05 + rnd() * 0.20})`;
    g.lineWidth = w;
    g.beginPath();
    g.moveTo(cx + Math.cos(a) * start, cy + Math.sin(a) * start);
    g.lineTo(cx + Math.cos(a) * end, cy + Math.sin(a) * end);
    g.stroke();
  }
  // 中心压暗，让主体不被线干扰
  const rad = g.createRadialGradient(cx, cy, r0 * 0.2, cx, cy, r0 * 1.5);
  rad.addColorStop(0, "rgba(10,8,16,.95)");
  rad.addColorStop(1, "rgba(10,8,16,0)");
  g.fillStyle = rad;
  g.fillRect(0, 0, size, size);

  cache.set(key, c);
  return c;
}

/**
 * 横向速度线：一条条的平行线，用于 cut-in 入场扫过。
 */
export function streakLines(w = 512, h = 128, count = 26) {
  const key = `st:${w}:${h}:${count}`;
  if (cache.has(key)) return cache.get(key);

  const c = offscreen(w, h);
  const g = c.getContext("2d");
  let seed = 777;
  const rnd = () => {
    seed = (seed * 1103515245 + 12345) & 0x7fffffff;
    return seed / 0x7fffffff;
  };
  for (let i = 0; i < count; i++) {
    const y = rnd() * h;
    const th = 0.5 + rnd() * 2.4;
    const x0 = rnd() * w * 0.4;
    const len = w * (0.4 + rnd() * 0.6);
    const grad = g.createLinearGradient(x0, 0, x0 + len, 0);
    grad.addColorStop(0, "rgba(255,255,255,0)");
    grad.addColorStop(0.45, `rgba(255,255,255,${0.10 + rnd() * 0.35})`);
    grad.addColorStop(1, "rgba(255,255,255,0)");
    g.fillStyle = grad;
    g.fillRect(x0, y, len, th);
  }
  cache.set(key, c);
  return c;
}

/* ------------------------------------------------------------ 纸纹兜底 */
/**
 * 程序化纸纹。若 assets/out/texture/paper@2x.png 不存在，用这个顶上——
 * 保证界面永远有质感，不被素材阻塞。
 */
export function noiseTile(size = 128, strength = 20) {
  const key = `nz:${size}:${strength}`;
  if (cache.has(key)) return cache.get(key);

  const c = offscreen(size, size);
  const g = c.getContext("2d");
  const img = g.createImageData(size, size);
  let seed = 4242;
  const rnd = () => {
    seed = (seed * 1103515245 + 12345) & 0x7fffffff;
    return seed / 0x7fffffff;
  };
  for (let i = 0; i < size * size; i++) {
    const v = 128 + (rnd() - 0.5) * strength * 2;
    img.data[i * 4] = v;
    img.data[i * 4 + 1] = v;
    img.data[i * 4 + 2] = v;
    img.data[i * 4 + 3] = 255;
  }
  g.putImageData(img, 0, 0);
  cache.set(key, c);
  return c;
}

/* ------------------------------------------------------------ 斜线阴影 */
/**
 * 45° 斜线阴影 pattern。用于攻击范围、CD 蒙版（canvas 侧）。
 */
export function hatchPattern(color = "rgba(255,70,90,.34)", gap = 9, width = 1.6) {
  const key = `ha:${color}:${gap}:${width}`;
  if (cache.has(key)) return cache.get(key);

  const c = offscreen(gap, gap);
  const g = c.getContext("2d");
  g.strokeStyle = color;
  g.lineWidth = width;
  g.beginPath();
  g.moveTo(-gap, gap);
  g.lineTo(gap, -gap);
  g.moveTo(0, gap * 2);
  g.lineTo(gap * 2, 0);
  g.stroke();
  cache.set(key, c);
  return c;
}

/* ------------------------------------------------------------ 六边形光晕 */
/** 棋子 / 宝石柱底部的光晕。 */
export function glowSprite(size = 128, color = "rgba(140,60,200,.9)") {
  const key = `gl:${size}:${color}`;
  if (cache.has(key)) return cache.get(key);

  const c = offscreen(size, size);
  const g = c.getContext("2d");
  const rad = g.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  rad.addColorStop(0, color);
  rad.addColorStop(0.45, color.replace(/[\d.]+\)$/, "0.28)"));
  rad.addColorStop(1, "rgba(0,0,0,0)");
  g.fillStyle = rad;
  g.fillRect(0, 0, size, size);
  cache.set(key, c);
  return c;
}

export function clearFxCache() {
  cache.clear();
}
