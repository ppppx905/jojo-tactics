/**
 * 校验 index.html 的标签配对，并打印「玩法指南」全文，方便改完规则后核对文案。
 *
 * 用法：node tools/check-html.mjs
 *
 * 为什么需要它：指南写在 HTML 的一整行里，改文案时很容易多写或漏写一个 </div>，
 * 页面不会报错，但弹窗结构会静默错位（这个检查在改指南时抓到过一次）。
 */
import { readFileSync } from 'node:fs';

const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
const VOID = new Set(['meta', 'link', 'br', 'hr', 'img', 'input', 'source', 'track', 'wbr', 'col', 'area', 'base', 'embed', 'param']);
const stack = [];
const problems = [];
const tagRe = /<(\/?)([a-zA-Z][a-zA-Z0-9-]*)([^>]*?)(\/?)>/g;
let match;
while ((match = tagRe.exec(html))) {
  const [, closing, rawName, , selfClose] = match;
  const name = rawName.toLowerCase();
  if (VOID.has(name) || selfClose === '/') continue;
  const line = html.slice(0, match.index).split('\n').length;
  if (!closing) stack.push({ name, line });
  else {
    const top = stack.pop();
    if (!top || top.name !== name) {
      problems.push(`第 ${line} 行 </${name}> 与栈顶 ${top ? `<${top.name}>（第 ${top.line} 行）` : '空栈'} 不匹配`);
    }
  }
}
for (const left of stack) problems.push(`未闭合：<${left.name}>（第 ${left.line} 行）`);

const start = html.indexOf('id="helpDialog"');
const end = html.indexOf('id="settingsDialog"');
const help = start >= 0 && end > start ? html.slice(start, end) : '';
const articles = [...help.matchAll(/<article><b>([\s\S]*?)<\/b>([\s\S]*?)<\/article>/g)];
const strip = text => text.replace(/<[^>]*>/g, '').replace(/&amp;/g, '&').trim();

console.log(`  标签配对：${problems.length ? '✗\n    ' + problems.slice(0, 8).join('\n    ') : '✓ 全文件正确'}`);
console.log(`  玩法指南：${articles.length} 条\n`);
for (const [, title, body] of articles) {
  console.log(`  ■ ${strip(title)}`);
  for (const p of body.matchAll(/<p>([\s\S]*?)<\/p>/g)) console.log(`     ${strip(p[1])}`);
  console.log('');
}
const keys = [...help.matchAll(/<kbd>([^<]*)<\/kbd>\s*([^<]*)/g)].map(m => `${m[1]} ${strip(m[2])}`).join(' | ');
console.log(`  ⌨ ${keys}`);
process.exit(problems.length ? 1 : 0);
