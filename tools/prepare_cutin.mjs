/**
 * 把一张「3:2 大招插画」原画处理成游戏用的 WebP 过场插画（默认 762×506）。
 * 与 assets/out/cutins/ 里既有四枚素材同规格——那四枚来自四格拼版
 * （tools/prepare_art.py：thumbnail(768,512) 后再按 gutter=3 裁边，得到 762×506，
 *  质量 91 / method 6），这里对“单张整图”做同样规格的输出，方便逐个角色补图。
 *
 * 用法：node tools/prepare_cutin.mjs <输入图> <输出.webp> [宽=762] [高=506]
 * 例：  node tools/prepare_cutin.mjs assets/src/cutins-polnareff-v1.png assets/out/cutins/polnareff.webp
 */
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
  console.error('用法: node tools/prepare_cutin.mjs <输入图> <输出.webp> [宽=762] [高=506]');
  process.exit(2);
}
if (!existsSync(input)) { console.error('找不到输入图：' + input); process.exit(2); }
const W = parseInt(wArg || '762', 10), H = parseInt(hArg || '506', 10);

const before = await sharp(input).metadata();

// 插画是不透明的完整画面（不抠底），只做等比铺满 + 轻微居中裁切，保持主体不被拉变形
await sharp(input)
  .resize(W, H, { fit: 'cover', position: 'right' })   // 主体按提示词约定在右侧，优先保住右边
  .webp({ quality: 91, method: 6 })
  .toFile(output);

const meta = await sharp(output).metadata();
console.log(`输入：${input}  ${before.width}×${before.height} ${before.format}`);
console.log(`输出：${output}`);
console.log(`规格：${meta.width}×${meta.height} ${meta.format}  与既有 cutins 一致=${meta.width === 762 && meta.height === 506}`);
