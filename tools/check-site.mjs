/**
 * 上传前后的验收：把要发布的那一份当成真的网站跑一遍。
 *
 * **两种模式**：
 *   1) 本地拷贝（默认）：以博客仓库的 `source/` 为根起静态服务器，按线上地址的形状（`/jojo/`）打开，
 *      在**推送之前**就能发现素材路径写错、文件没拷全之类的问题。
 *   2) 线上地址：直接给一个 http(s) 地址，检查**已经发出去的那份**是不是真的更新了。
 *
 * 两种模式都检查：
 *   · 游戏能在 `/jojo/` 这种子路径下启动（`window.__jojoReady`）
 *   · **没有任何请求失败**（404/500）——素材路径写错时开发版可能看不出来，换到子路径才会暴露
 *   · 剧情第四章能真的开打、场地是海面
 *   · boss 肖像真的显示出来了（naturalWidth > 0）
 *   · 截图存档到 design/review/
 *
 * 用法：
 *   node tools/check-site.mjs                              # 检查博客仓库里的本地拷贝
 *   node tools/check-site.mjs "D:/别的/博客仓库"             # 指定博客仓库
 *   node tools/check-site.mjs https://ppppx905.github.io/jojo/   # 检查线上
 */
import { chromium } from 'playwright';
import { createServer } from 'node:http';
import { readFile, mkdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const REVIEW = path.join(ROOT, 'design/review');
await mkdir(REVIEW, { recursive: true });

const live = args.find(a => /^https?:/i.test(a));
const BLOG = path.resolve(args.find(a => !a.startsWith('--') && !/^https?:/i.test(a)) || 'D:/我的下载/hexo/blog');
const SITE_ROOT = path.join(BLOG, 'source');
const PREFIX = '/jojo/';

let server = null, base = '', label = '';
if (live) {
  base = live.replace(/\/?$/, '/');
  label = `线上地址：${base}`;
} else {
  if (!existsSync(path.join(SITE_ROOT, 'jojo/index.html'))) {
    console.error(`网站仓库里没有 jojo/index.html：${SITE_ROOT}`);
    process.exit(1);
  }
  const mime = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.png': 'image/png', '.webp': 'image/webp', '.woff2': 'font/woff2', '.json': 'application/json', '.m4a': 'audio/mp4', '.svg': 'image/svg+xml' };
  server = createServer(async (req, res) => {
    try {
      const url = new URL(req.url, 'http://localhost');
      let pathname = decodeURIComponent(url.pathname);
      if (pathname.endsWith('/')) pathname += 'index.html';
      const file = path.resolve(SITE_ROOT, `.${pathname}`);
      if (!file.startsWith(SITE_ROOT + path.sep)) throw Error('Invalid path');
      const body = await readFile(file);
      res.writeHead(200, { 'Content-Type': mime[path.extname(file)] || 'application/octet-stream', 'Cache-Control': 'no-store' });
      res.end(body);
    } catch { res.writeHead(404); res.end('Not found'); }
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  base = `http://127.0.0.1:${server.address().port}/jojo/`;
  label = `本地拷贝：${base}（根目录＝${SITE_ROOT}）`;
}
console.log(`验收对象：${label}\n`);

const browser = await chromium.launch({ headless: true })
  .catch(() => chromium.launch({ headless: true, channel: 'msedge' }));
const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 });
await context.addInitScript(() => {
  localStorage.setItem('stardust.story', JSON.stringify({ cleared: ['chapter-1', 'chapter-2', 'chapter-3'] }));
});
const page = await context.newPage();
const failures = [], errors = [];
page.on('response', res => { if (res.status() >= 400) failures.push(`${res.status()} ${res.url()}`); });
page.on('requestfailed', req => failures.push(`FAILED ${req.url()} (${req.failure()?.errorText})`));
page.on('pageerror', error => errors.push(error.message));

const checks = [];
const step = (ok, text) => { console.log(`${ok ? '✓' : '✗'} ${text}`); checks.push({ ok, text }); };

// 加个随机查询串，绕开 GitHub Pages 的 HTML 缓存
await page.goto(`${base}?test=1&v=${Date.now()}`);
await page.waitForFunction(() => window.__jojoReady, null, { timeout: 40000 });
step(true, '游戏能启动');

// 走一遍真实玩家路径：剧情模式 → 第四章 → 开始对决
await page.click('[data-title-mode="story"]');
await page.waitForSelector('[data-story-chapter="3"]');
await page.click('[data-story-chapter="3"]');
for (let i = 0; i < 12; i++) {
  if ((await page.textContent('#storyStageNext')).includes('开始对决')) break;
  await page.click('#storyStageNext');
  await page.waitForTimeout(60);
}
await page.click('#storyStageNext');
await page.waitForFunction(() => window.__jojo.game.s.phase === 'battle', null, { timeout: 40000 });
const arena = await page.evaluate(() => window.__jojo.game.s.story.arena);
step(arena === 'sea', `第四章能开打，场地 = ${arena}`);

// 让双方摆到水里、挂上溺水，确认水波/标记那套也正常
await page.evaluate(() => {
  const g = window.__jojo.game;
  const put = (id, row, col) => { const u = g.unit(id); u.row = row; u.col = col; };
  put('p1-stand', 2, 3); put('p1-user', 2, 5);
  put('p2-stand', 4, 11); put('p2-user', 3, 10);
  g.s.drown.p1 = 2; g.s.turn = 'p1'; g.select('p1-stand'); g.touch();
});
await page.waitForTimeout(1000);
const shot = path.join(REVIEW, live ? '线上验收-第四章海面.png' : '网站版验收-第四章海面.png');
await page.screenshot({ path: shot });
step(true, `截图已存 ${path.relative(ROOT, shot)}`);

// boss 的肖像**真的显示出来了**：文件 404 或路径写错时 naturalWidth 会是 0。
// 右侧信息栏里 p1 在前、p2（boss）在后，所以取第 2 张。
const art = await page.evaluate(() => [...document.querySelectorAll('.bay-portrait img')]
  .map(img => ({ src: img.getAttribute('src'), w: img.naturalWidth, h: img.naturalHeight })));
if (art.length >= 2) step(art[1].w > 0, `boss 肖像已加载：${art[1].src}（${art[1].w}×${art[1].h}）`);
else step(false, `右侧信息栏只找到 ${art.length} 张肖像图`);
if (art[0]) step(art[0].w > 0, `玩家肖像已加载：${art[0].src}`);

// 选人界面：七名可选角色、头像全部加载（漏一张就说明素材没拷全）
await page.evaluate(() => { document.querySelectorAll('dialog[open] [data-close]').forEach(b => b.click()); });
const roster = await page.evaluate(() => {
  const cards = [...document.querySelectorAll('#draftP1 .draft-pick')];
  return { names: cards.map(c => c.querySelector('.draft-pick-name')?.textContent.trim()), loaded: cards.filter(c => c.querySelector('img')?.naturalWidth > 0).length, total: cards.length };
});
if (roster.total) step(roster.loaded === roster.total, `选人界面 ${roster.total} 名角色、头像加载 ${roster.loaded}/${roster.total}`);

await browser.close();
if (server) server.close();

console.log('');
const uniqueFailures = [...new Set(failures)];
if (uniqueFailures.length) {
  console.log(`✗ 请求失败 ${uniqueFailures.length} 项：`);
  for (const f of uniqueFailures.slice(0, 20)) console.log(`   ${f}`);
}
const uniqueErrors = [...new Set(errors)];
if (uniqueErrors.length) {
  console.log(`✗ 页面报错 ${uniqueErrors.length} 条：`);
  for (const e of uniqueErrors.slice(0, 10)) console.log(`   ${e}`);
}
const failedChecks = checks.filter(c => !c.ok);
if (failedChecks.length) {
  console.log(`✗ 检查未通过 ${failedChecks.length} 项：`);
  for (const c of failedChecks) console.log(`   ${c.text}`);
}
if (!uniqueFailures.length && !uniqueErrors.length && !failedChecks.length) {
  console.log('✓ 全部通过：启动正常、第四章可玩、素材零失败');
} else process.exit(1);

