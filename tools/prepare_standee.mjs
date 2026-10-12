/**
 * 把一张「纯蓝底全身立姿」原画处理成游戏用的 192×288 透明 WebP 棋子立绘。
 * 与 assets/out/standees/ 里既有的八枚素材同规格：人物贴底、水平居中。
 *
 * 用法：node tools/prepare_standee.mjs <输入图> <输出.webp> [宽=192] [高=288]
 * 例：  node tools/prepare_standee.mjs assets/src/polnareff-v2.png assets/out/standees/polnareff.webp
 */
// sharp 没装进这个项目（npm ci 不包含它），所以先从本地找：项目内 → 系统 npx 缓存
import { createRequire } from 'node:module';
import { existsSync } from 'node:fs';
const require = createRequire(import.meta.url);
let sharp;
try { sharp = require('sharp'); }
catch {
  sharp = require('C:/Users/poutrain/AppData/Local/npm-cache/_npx/1e7f6d9597241db0/node_modules/sharp');
}

const [input, output, wArg, hArg] = process.argv.slice(2);
if (!input || !output) {
  console.error('用法: node tools/prepare_standee.mjs <输入图> <输出.webp> [宽=192] [高=288]');
  process.exit(2);
}
if (!existsSync(input)) { console.error('找不到输入图：' + input); process.exit(2); }
const W = parseInt(wArg || '192', 10), H = parseInt(hArg || '288', 10);

/* 1. 抠背景：优先沿用原图 alpha，否则按「背景色距离」抠图 */
const img = sharp(input).ensureAlpha();
const { width, height } = await img.metadata();
const { data } = await img.raw().toBuffer({ resolveWithObject: true });

// 图片模型有时直接给「透明底 PNG」而不是纯色底。这种情况下如果再走抠图，
// 反而会把透明的背景填成不透明（实测：透明输入会被判成 alpha≈255），所以先探一下：
// 四条边上大部分像素已经是透明的，就直接沿用它的 alpha。
let borderTransparent = 0, borderTotal = 0;
for (let x = 0; x < width; x++) for (const y of [0, height - 1]) {
  borderTotal++; if (data[(y * width + x) * 4 + 3] < 32) borderTransparent++;
}
for (let y = 0; y < height; y++) for (const x of [0, width - 1]) {
  borderTotal++; if (data[(y * width + x) * 4 + 3] < 32) borderTransparent++;
}
const alreadyTransparent = borderTotal > 0 && borderTransparent / borderTotal > 0.5;

/**
 * ★★ 背景色从「四角」量出来，再按**颜色距离**抠——2026-09-30 改的，别再改回"蓝度高就算背景"。
 *
 * 为什么要改：旧规则是"蓝度（b − max(r,g)）≥ 35 就当背景"，本来只针对纯蓝底。
 * 但德沃那张立绘**裤子是蓝紫色**（实测 rgb≈(45,32,86)、蓝度只有 28–45），
 * 于是裤子被判成"背景边缘"，被扣成半透明、还被"去蓝边"把蓝色洗掉——立绘里裤子变成灰白色。
 * 同样的坑交接文档 §6 也记过：第五章船体零件是冷灰蓝的钢，**蓝幕会把零件自己抠掉**，当时只能改用洋红幕。
 *
 * 新规则：采样四角得到背景色 bgKey，然后按"到 bgKey 的最大通道差"判定：
 *   · d ≤ 50        → 全透明（背景）
 *   · 50 < d ≤ 130  → 边缘过渡（按比例给 alpha，并沿 bgKey 反混合去掉溢色）
 *   · d > 130       → 保留（人物本体，哪怕它本身是蓝色的）
 * 四角颜色不一致（差值 > 60，说明背景是渐变/有多余元素）时**退回旧的蓝度规则**，避免抠不干净。
 */
const TOL_SOLID = 50, TOL_EDGE = 130;
const cornerAvg = (cx, cy) => {
  let r = 0, g = 0, b = 0, n = 0;
  for (let y = cy - 3; y <= cy + 3; y++) for (let x = cx - 3; x <= cx + 3; x++) {
    if (x < 0 || y < 0 || x >= width || y >= height) continue;
    const o = (y * width + x) * 4;
    r += data[o]; g += data[o + 1]; b += data[o + 2]; n++;
  }
  return [r / n, g / n, b / n];
};
const corners = [cornerAvg(3, 3), cornerAvg(width - 4, 3), cornerAvg(3, height - 4), cornerAvg(width - 4, height - 4)];
const bgKey = [0, 1, 2].map(c => corners.reduce((s, p) => s + p[c], 0) / corners.length);
const spread = Math.max(...[0, 1, 2].map(c => Math.max(...corners.map(p => p[c])) - Math.min(...corners.map(p => p[c]))));
const uniformBg = spread <= 60;

const out = Buffer.alloc(width * height * 4);
let keyed = 0;
for (let i = 0; i < width * height; i++) {
  const o = i * 4, r = data[o], g = data[o + 1], b = data[o + 2];
  let a = 255;
  if (alreadyTransparent) {
    a = data[o + 3];                                              // 原图就是透明底，直接沿用
  } else if (uniformBg) {
    const d = Math.max(Math.abs(r - bgKey[0]), Math.abs(g - bgKey[1]), Math.abs(b - bgKey[2]));
    if (d <= TOL_SOLID) { a = 0; keyed++; }
    else if (d <= TOL_EDGE) a = Math.round(255 * (d - TOL_SOLID) / (TOL_EDGE - TOL_SOLID));
  } else {
    const blueness = b - Math.max(r, g);                          // 兜底：渐变蓝底用旧规则
    if (blueness >= 90) { a = 0; keyed++; }
    else if (blueness >= 35) a = Math.round(255 * (1 - (blueness - 35) / 55));
  }
  let rr = r, gg = g, bb = b;
  if (!alreadyTransparent && a > 0 && a < 255) {                  // 去溢色：沿背景色反混合
    const k = a / 255, bg = uniformBg ? bgKey : [0, 0, 255];
    rr = Math.min(255, Math.max(0, Math.round((r - bg[0] * (1 - k)) / k)));
    gg = Math.min(255, Math.max(0, Math.round((g - bg[1] * (1 - k)) / k)));
    bb = Math.min(255, Math.max(0, Math.round((b - bg[2] * (1 - k)) / k)));
  }
  out[o] = rr; out[o + 1] = gg; out[o + 2] = bb; out[o + 3] = a;
}
const cut = sharp(out, { raw: { width, height, channels: 4 } }).trim({ threshold: 6 });
const trimmed = await cut.png().toBuffer({ resolveWithObject: true });

/* 2. 缩放到目标高度并贴底居中 */
const scale = Math.min(W / trimmed.info.width, H / trimmed.info.height);
const tw = Math.max(1, Math.round(trimmed.info.width * scale));
const th = Math.max(1, Math.round(trimmed.info.height * scale));
const body = await sharp(trimmed.data).resize(tw, th, { fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 } }).png().toBuffer();

await sharp({ create: { width: W, height: H, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } } })
  .composite([{ input: body, left: Math.round((W - tw) / 2), top: H - th }])   // 脚底贴底边
  .webp({ quality: 90, alphaQuality: 100 })
  .toFile(output);

const meta = await sharp(output).metadata();
const alpha = (await sharp(output).stats()).channels[3];
console.log(alreadyTransparent
  ? `输入已是透明底（边缘 ${(borderTransparent / borderTotal * 100).toFixed(0)}% 透明）→ 直接沿用原图 alpha`
  : uniformBg
    ? `抠掉背景像素：${(keyed / (width * height) * 100).toFixed(1)}%　（背景色 rgb(${bgKey.map(v => v.toFixed(0)).join(',')})，按颜色距离抠）`
    : `抠掉蓝底像素：${(keyed / (width * height) * 100).toFixed(1)}%　（四角色差 ${spread.toFixed(0)} → 背景不纯，退回蓝度规则）`);
console.log(`裁边后尺寸：${trimmed.info.width}×${trimmed.info.height} → 缩放 ${tw}×${th}（贴底居中）`);
console.log(`输出：${output}`);
console.log(`规格：${meta.width}×${meta.height} ${meta.format}  透明=${alpha.min === 0}  alpha 均值=${alpha.mean.toFixed(1)}`);
