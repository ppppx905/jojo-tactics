/**
 * 把模块化的游戏打包成一个「双击就能玩」的单文件 HTML。
 *
 * 为什么需要它：浏览器禁止从 file:// 加载 ES 模块（CORS 限制），
 * 所以原版必须跑一个本地服务器；把模块合并内联后就没有这个限制。
 *
 * 用法：node tools/bundle-standalone.mjs
 * 产物：jojo战棋-单文件版.html（放在项目根目录，仍需同目录的 assets/ 文件夹）
 */
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { dirname, resolve, relative, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const ENTRY = 'src/main.js';
const OUT = join(ROOT, 'jojo战棋-单文件版.html');
const norm = p => p.split('\\').join('/');

/* ---------- 1. 解析模块依赖图（全部是相对路径，无 fetch、无 import.meta） ---------- */
const modules = new Map();                       // 项目相对路径 -> 源码
function load(rel) {
  if (modules.has(rel)) return;
  const abs = join(ROOT, rel);
  if (!existsSync(abs)) throw new Error('找不到模块：' + rel);
  const src = readFileSync(abs, 'utf8');
  modules.set(rel, src);
  for (const m of src.matchAll(/^\s*import\s+(?:\{[^}]*\}|\*\s+as\s+\w+)\s+from\s+'([^']+)'/gm)) {
    load(norm(relative(ROOT, resolve(dirname(abs), m[1]))));
  }
}
load(ENTRY);

/* ---------- 2. 拓扑排序：被依赖的模块先执行 ---------- */
const order = [];
const seen = new Set();
function visit(rel) {
  if (seen.has(rel)) return;
  seen.add(rel);
  const src = modules.get(rel);
  for (const m of src.matchAll(/^\s*import\s+(?:\{[^}]*\}|\*\s+as\s+\w+)\s+from\s+'([^']+)'/gm)) {
    visit(norm(relative(ROOT, resolve(dirname(join(ROOT, rel)), m[1]))));
  }
  order.push(rel);
}
visit(ENTRY);

/* ---------- 3. 转换：去掉 import/export 语法，改成作用域隔离 + 导出表 ---------- */
function transform(rel, src) {
  const exported = new Set();
  let code = src;

  // import { a, b } from './x.js';  →  从导出表解构
  code = code.replace(/^\s*import\s+\{([^}]*)\}\s+from\s+'([^']+)';?[ \t]*$/gm, (_, names, spec) => {
    const dep = norm(relative(ROOT, resolve(dirname(join(ROOT, rel)), spec)));
    return `const {${names.trim()}} = __mods[${JSON.stringify(dep)}];`;
  });
  // import * as ns from './x.js';
  code = code.replace(/^\s*import\s+\*\s+as\s+(\w+)\s+from\s+'([^']+)';?[ \t]*$/gm, (_, ns, spec) => {
    const dep = norm(relative(ROOT, resolve(dirname(join(ROOT, rel)), spec)));
    return `const ${ns} = __mods[${JSON.stringify(dep)}];`;
  });
  // export { a, b };  →  记录后删除（这些名字已在作用域里）
  code = code.replace(/^\s*export\s*\{([^}]*)\}\s*;?[ \t]*$/gm, (_, names) => {
    names.split(',').map(s => s.trim()).filter(Boolean).forEach(n => exported.add(n.replace(/\s+as\s+.*$/, '').trim()));
    return '';
  });
  // export const/let/var/function/class/async function  →  去掉 export 前缀并记录名字
  code = code.replace(/^(\s*)export\s+(async\s+function|function|class|const|let|var)\s+([A-Za-z_$][\w$]*)/gm,
    (_, indent, kw, name) => { exported.add(name); return `${indent}${kw} ${name}`; });

  return { code, exported: [...exported] };
}

const parts = [];
for (const rel of order) {
  const { code, exported } = transform(rel, modules.get(rel));
  parts.push(`// ===== ${rel} =====\n__mods[${JSON.stringify(rel)}] = (function(){\n${code}\nreturn {${exported.join(', ')}};\n})();`);
}
const bundle = `"use strict";\nconst __mods = {};\n${parts.join('\n\n')}\n`;

/* ---------- 4. CSS + 字体内联 ---------- */
const cssFiles = ['src/ui/tokens.css', 'src/ui/layout.css'];
let css = cssFiles.map(f => readFileSync(join(ROOT, f), 'utf8')).join('\n');
const fontPath = join(ROOT, 'assets/fonts/smiley-subset.woff2');
let fontNote = '字体未内联（找不到 smiley-subset.woff2）';
if (existsSync(fontPath)) {
  const b64 = readFileSync(fontPath).toString('base64');
  const before = css;
  css = css.replace(/url\((["']?)[^"')]*smiley-subset\.woff2\1\)/g, `url("data:font/woff2;base64,${b64}")`);
  fontNote = css !== before ? `字体已内联（${Math.round(b64.length / 1024)} KB base64）` : '字体引用未找到，未替换';
}

/* ---------- 5. 组装 HTML ---------- */
let html = readFileSync(join(ROOT, 'index.html'), 'utf8');
html = html.replace(/\s*<link rel="preload"[^>]*smiley-subset[^>]*>/i, '');
html = html.replace(/\s*<link rel="stylesheet" href="src\/ui\/[^"]+">/gi, '');
html = html.replace('</head>', `<style>\n${css}\n</style>\n</head>`);
html = html.replace(/\s*<script type="module" src="src\/main\.js"><\/script>/i, `\n<script>\n${bundle}</script>`);

writeFileSync(OUT, html, 'utf8');

/* ---------- 6. 自检 ---------- */
const leftovers = {
  '遗留 import 语句': (bundle.match(/^\s*import\s/gm) || []).length,
  '遗留 export 语句': (bundle.match(/^\s*export\s/gm) || []).length,
  'fetch 调用': (bundle.match(/fetch\s*\(/g) || []).length,
  'import.meta': (bundle.match(/import\.meta/g) || []).length,
  '仍是 module 脚本': /<script type="module"/.test(html) ? 1 : 0,
  '仍是外链样式': /<link rel="stylesheet"/.test(html) ? 1 : 0,
};
console.log('打包完成：', OUT);
console.log('模块数量：', order.length, '→', order.join(', '));
console.log(fontNote);
console.log('自检：', Object.entries(leftovers).map(([k, v]) => `${k}=${v}`).join('  '));
console.log('体积：', Math.round(Buffer.byteLength(html, 'utf8') / 1024), 'KB');
