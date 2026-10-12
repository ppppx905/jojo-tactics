/**
 * 素材体检：核对「代码里会去加载的图片」在 assets/out 里是否真的存在。
 * 代码里少一张图不会崩，只会在控制台打印 Artwork unavailable 并退化成占位图形，
 * 所以加角色或替换素材后用这个脚本确认一遍，避免带着缺口上线。
 *
 * 用法：node tools/check-assets.mjs
 */
import { existsSync, statSync } from 'node:fs';
import { CHARACTER_ART, ARENAS, PENDING_ARENAS, TERRAIN_SKINS, terrainSkinPath, PART_SPRITES } from '../src/ui/assets.js';

const ROOT = new URL('..', import.meta.url);
const at = p => new URL(p, ROOT);

const wanted = [];
/** 剧情 boss 的肖像／插画可以先不做（artOptional）：肖像只用在选人界面而 boss 不进列表，
 *  插画只用在结算画面。这类素材单独列出来提示，但**不算缺失**，否则主界面会一直弹警告。 */
const optional = [];
// 每名角色：本体立绘（单单位角色没有替身那一份）、替身立绘、肖像、技能插画
for (const [key, art] of Object.entries(CHARACTER_ART)) {
  // artOptional 的完整含义是「这个角色的图还没画」：**立绘也一样可以缺**，
  // 否则第一个还没画立绘的 boss 一加进来，素材检查就会报缺失（猩猩就是这样）。
  if (art.artOptional) {
    optional.push([`${key} 本体立绘`, `assets/out/standees/${art.user}.webp`]);
  } else {
    wanted.push([`${key} 本体立绘`, `assets/out/standees/${art.user}.webp`]);
  }
  // ★ 2026-10-09 修：**替身立绘也要跟着 artOptional 走**。上面那段注释一直写着"立绘也一样可以缺"，
  //   但这一行原来无条件进 `wanted`，于是"图还没画"的角色（东方仗助）会报**缺失**而不是"待补（可选）"，
  //   `check-assets` 直接 exit 1。口径现在与本体立绘完全一致：带 artOptional 就都是可选。
  if (art.stand) (art.artOptional ? optional : wanted).push([`${key} 替身立绘`, `assets/out/standees/${art.stand}.webp`]);
  if (art.artOptional) {
    optional.push([`${key} 选人肖像`, `assets/out/portraits/${key}.webp`]);
    optional.push([`${key} 技能插画`, `assets/out/cutins/${key}.webp`]);
  } else {
    wanted.push([`${key} 选人肖像`, `assets/out/portraits/${key}.webp`]);
    wanted.push([`${key} 技能插画`, `assets/out/cutins/${key}.webp`]);
  }
}
// 地形
for (const t of ['rock', 'bush', 'heal', 'hazard']) wanted.push([`地形 ${t}`, `assets/out/terrain/${t}@2x.png`]);
// 战斗场地背景（剧情章节指定，例如灰塔那一战的客机机舱、力量那一关的四层船舱）
for (const [key, url] of Object.entries(ARENAS)) {
  if (PENDING_ARENAS.has(key)) optional.push([`场地 ${key}`, url]);
  else wanted.push([`场地 ${key}`, url]);
}
// 场地专属地形皮肤（飞机机舱版：行李箱堆/座椅掩护/送餐车/泄漏的燃油）
for (const key of TERRAIN_SKINS) wanted.push([`地形皮肤 ${key}`, terrainSkinPath(key)]);
// 第五章「力量」的船体要害棋子（锅炉／承重柱／绞盘／阀门）
for (const [key, url] of Object.entries(PART_SPRITES)) wanted.push([`船体要害 ${key}`, url]);

let missing = 0, total = 0;
for (const [label, rel] of wanted) {
  total++;
  const file = at(rel);
  if (!existsSync(file)) { console.log(`  ✗ 缺失  ${label.padEnd(18)} ${rel}`); missing++; continue; }
  const kb = Math.round(statSync(file).size / 1024);
  console.log(`  ✓ ${String(kb + ' KB').padStart(7)}  ${label.padEnd(18)} ${rel}`);
}
// 可选素材：有就报大小，没有只提示一句，不影响结论
for (const [label, rel] of optional) {
  const file = at(rel);
  if (existsSync(file)) console.log(`  ✓ ${String(Math.round(statSync(file).size / 1024) + ' KB').padStart(7)}  ${label.padEnd(18)} ${rel}`);
  else console.log(`  · 待补（可选）  ${label.padEnd(18)} ${rel}`);
}
console.log(`\n角色数：${Object.keys(CHARACTER_ART).length}   素材引用：${total} 项   缺失：${missing} 项   可选待补：${optional.length} 项`);
console.log(missing === 0 ? '结论：素材齐全，不会出现占位图形 ✓' : '结论：仍有缺口 ✗');
process.exit(missing === 0 ? 0 : 1);
