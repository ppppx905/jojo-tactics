/**
 * 原子化切图（Node 版）—— 与 tools/slice.py 同源，但只依赖 sharp。
 *
 * 为什么需要它：`slice.py` 依赖 Pillow，而本机任何 Python 都没装 PIL（`py -0` 只有 3.13，没有 PIL）。
 * 项目里所有 Node 工具（prepare_standee / prepare_cutin / prepare_scene）都在用 sharp，所以这条路最稳。
 *
 * 只实现我们**实际用到**的能力（与 slice.py 的 grid 模式等价）：
 *   ① 抠掉纯色背景（默认洋红 RGB(255,0,255)，生图常用它当背景）
 *   ② 按 cols × rows 均分网格，每格向内缩 margin 像素（避开格子接缝）
 *   ③ 裁掉透明边 → 居中 → 四周留统一留白（pad）
 *   ④ 输出 `<label>@2x.png`（size×scale）与 `<label>@1x.png`（size）两套
 *
 * 用法：
 *   node tools/slice.mjs tools/sheets.json <条目名>
 *   node tools/slice.mjs tools/sheets.json terrain-plane
 *   node tools/slice.mjs tools/sheets.json            # 跑全部 grid 条目
 */
import { readFile, mkdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
let sharp;
try { sharp = require('sharp'); }
catch { sharp = require('C:/Users/poutrain/AppData/Local/npm-cache/_npx/1e7f6d9597241db0/node_modules/sharp'); }

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const [configPath = 'tools/sheets.json', only = null] = process.argv.slice(2);

const config = JSON.parse(await readFile(path.join(ROOT, configPath), 'utf8'));
const targets = (config.sheets || []).filter(entry => entry.mode !== 'items' && (!only || entry.name === only));
if (!targets.length) { console.error(`没有找到要切的条目：${only || '(全部)'}`); process.exit(2); }

/** 判定"是不是背景色"：三通道都接近 key 就当作背景。默认洋红。 */
const makeKeyTest = key => (r, g, b) => {
  const [kr, kg, kb] = key;
  return Math.abs(r - kr) <= 60 && Math.abs(g - kg) <= 60 && Math.abs(b - kb) <= 60;
};

for (const entry of targets) {
  const src = path.join(ROOT, entry.src);
  if (!existsSync(src)) { console.error(`✗ 找不到源图：${entry.src}`); continue; }
  const cols = entry.cols || 1, rows = entry.rows || 1;
  const margin = entry.margin || 0;
  const size = entry.size || 128, scale = entry.scale || 2;
  const pad = entry.pad ?? 0.08;
  const labels = entry.names || [];
  if (labels.length !== cols * rows) {
    console.error(`✗ ${entry.name}: names 数量 ${labels.length} 与 ${cols}×${rows} 不符`);
    process.exitCode = 1;
    continue;
  }

  const outDir = path.join(ROOT, entry.out || 'assets/out', entry.name);
  await mkdir(outDir, { recursive: true });

  const image = sharp(src).ensureAlpha();
  const meta = await image.metadata();
  const { data, info } = await image.raw().toBuffer({ resolveWithObject: true });
  const { width: W, height: H, channels: C } = info;

  console.log(`[${entry.name}] ${entry.src}  ${W}×${H}  ${cols}×${rows} 格  →  ${entry.out || 'assets/out'}/${entry.name}/`);

  // ① 先整张抠色（背景 → 透明），再逐格切，避免格子接缝处的色块漏掉
  const keyTest = entry.key ? makeKeyTest(entry.key.color || [255, 0, 255]) : null;
  let keyed = 0;
  for (let i = 0; i < W * H; i++) {
    const o = i * C;
    if (data[o + 3] === 0) continue;
    if (keyTest && keyTest(data[o], data[o + 1], data[o + 2])) { data[o + 3] = 0; keyed++; }
  }
  if (keyTest) console.log(`   抠掉背景像素 ${(keyed / (W * H) * 100).toFixed(1)}%`);

  const cellW = Math.floor(W / cols), cellH = Math.floor(H / rows);
  for (let index = 0; index < labels.length; index++) {
    const label = labels[index];
    const col = index % cols, row = Math.floor(index / cols);

    // ② 取这一格（向内缩 margin 像素）
    const left = col * cellW + margin, top = row * cellH + margin;
    const cw = cellW - margin * 2, ch = cellH - margin * 2;
    const cell = Buffer.alloc(cw * ch * 4);
    for (let y = 0; y < ch; y++) {
      for (let x = 0; x < cw; x++) {
        const s = ((top + y) * W + (left + x)) * C, d = (y * cw + x) * 4;
        cell[d] = data[s]; cell[d + 1] = data[s + 1]; cell[d + 2] = data[s + 2]; cell[d + 3] = data[s + 3];
      }
    }

    // ③ 裁掉透明边
    let minX = cw, minY = ch, maxX = -1, maxY = -1;
    for (let y = 0; y < ch; y++) for (let x = 0; x < cw; x++) {
      if (cell[(y * cw + x) * 4 + 3] < 8) continue;
      if (x < minX) minX = x; if (x > maxX) maxX = x;
      if (y < minY) minY = y; if (y > maxY) maxY = y;
    }
    if (maxX < 0) { console.warn(`   ⚠️ ${label} 这一格是空的，跳过`); continue; }
    const bw = maxX - minX + 1, bh = maxY - minY + 1;

    // ④ 缩放 + 居中 + 统一留白，输出 @2x / @1x
    const canvas = Math.round(size * scale);
    const inner = Math.max(1, Math.round(canvas * (1 - pad * 2)));
    const fit = Math.min(inner / bw, inner / bh);
    const tw = Math.max(1, Math.round(bw * fit)), th = Math.max(1, Math.round(bh * fit));
    const body = await sharp(cell, { raw: { width: cw, height: ch, channels: 4 } })
      .extract({ left: minX, top: minY, width: bw, height: bh })
      .resize(tw, th, { fit: 'fill', kernel: 'lanczos3' })
      .png().toBuffer();

    const composed = await sharp({ create: { width: canvas, height: canvas, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } } })
      .composite([{ input: body, left: Math.round((canvas - tw) / 2), top: Math.round((canvas - th) / 2) }])
      .png().toBuffer();

    await sharp(composed).toFile(path.join(outDir, `${label}@${scale}x.png`));
    await sharp(composed).resize(size, size, { fit: 'fill', kernel: 'lanczos3' }).png()
      .toFile(path.join(outDir, `${label}@1x.png`));
    console.log(`   ✓ ${label.padEnd(16)} ${canvas}×${canvas}（对象 ${bw}×${bh} → ${tw}×${th}）`);
  }
}
