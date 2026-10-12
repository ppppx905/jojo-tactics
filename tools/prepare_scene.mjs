/**
 * 把一张「场景 / 背景原画」处理成游戏用的 WebP（等比缩放，不裁切、不改画幅）。
 * 与 prepare_standee.mjs、prepare_cutin.mjs 同一套约定；背景不做抠图，保留完整画面。
 *
 * 用法：node tools/prepare_scene.mjs <输入图> <输出.webp> [最大宽度=1920] [质量=82]
 * 例：  node tools/prepare_scene.mjs assets/src/lobby/title-bg.png assets/out/lobby/title-bg.webp 1920 82
 */
// sharp 没装进这个项目（npm ci 不包含它），所以先从本地找：项目内 → 系统 npx 缓存
import { createRequire } from 'node:module';
import { existsSync, statSync } from 'node:fs';
const require = createRequire(import.meta.url);
let sharp;
try { sharp = require('sharp'); }
catch {
  sharp = require('C:/Users/poutrain/AppData/Local/npm-cache/_npx/1e7f6d9597241db0/node_modules/sharp');
}

const [input, output, wArg, qArg] = process.argv.slice(2);
if (!input || !output) {
  console.error('用法: node tools/prepare_scene.mjs <输入图> <输出.webp> [最大宽度=1920] [质量=82]');
  process.exit(2);
}
if (!existsSync(input)) { console.error('找不到输入图：' + input); process.exit(2); }
const MAX_W = parseInt(wArg || '1920', 10);
const QUALITY = parseInt(qArg || '82', 10);

const meta = await sharp(input).metadata();
const targetWidth = Math.min(MAX_W, meta.width);
const info = await sharp(input)
  .resize({ width: targetWidth, withoutEnlargement: true })
  .webp({ quality: QUALITY, effort: 5 })
  .toFile(output);

const kb = n => Math.round(n / 1024) + ' KB';
console.log(`输入: ${input}  ${meta.width}×${meta.height}  ${kb(statSync(input).size)}`);
console.log(`输出: ${output}  ${info.width}×${info.height}  ${kb(info.size)}  (WebP q${QUALITY})`);
console.log(`体积: ${(statSync(input).size / info.size).toFixed(1)}× 缩小`);
