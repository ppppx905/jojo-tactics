/**
 * 临时验收脚本（不进正式流程）：在真正的 Chromium 里打开第四章，把棋子摆到水里、
 * 挂上【溺水】，然后把棋盘截图存到 design/review/，用来肉眼确认画面。
 *
 * 用法：node tools/shot-chapter4.mjs
 */
import { chromium } from 'playwright';
import { createServer } from 'node:http';
import { readFile, mkdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const output = path.join(root, 'design/review');
await mkdir(output, { recursive: true });
const mime = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.png': 'image/png', '.webp': 'image/webp', '.woff2': 'font/woff2', '.json': 'application/json' };
const server = createServer(async (req, res) => {
  try {
    const url = new URL(req.url, 'http://localhost');
    const pathname = decodeURIComponent(url.pathname === '/' ? '/index.html' : url.pathname);
    const file = path.resolve(root, `.${pathname}`);
    if (!file.startsWith(root + path.sep)) throw Error('Invalid path');
    const body = await readFile(file);
    res.writeHead(200, { 'Content-Type': mime[path.extname(file)] || 'application/octet-stream', 'Cache-Control': 'no-store' });
    res.end(body);
  } catch { res.writeHead(404); res.end('Not found'); }
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const base = `http://127.0.0.1:${server.address().port}`;

const browser = await chromium.launch({ headless: true })
  .catch(() => chromium.launch({ headless: true, channel: 'msedge' }));
// deviceScaleFactor 2：棋盘单独截图时等于放大两倍，方便肉眼看清状态标记与水波
const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 2 });
const page = await context.newPage();
page.on('pageerror', error => console.log('页面错误:', error.message));
page.on('console', message => { if (message.type() === 'error') console.log('控制台错误:', message.text()); });

// 先解锁到第四章：进度存在 localStorage 里，所以要在打开页面之前写好
await context.addInitScript(() => {
  localStorage.setItem('stardust.story', JSON.stringify({ cleared: ['chapter-1', 'chapter-2', 'chapter-3'] }));
});
await page.goto(base + '/?test=1');
await page.waitForFunction(() => window.__jojoReady);

await page.click('[data-title-mode="story"]');
await page.waitForSelector('[data-story-chapter="3"]');
const label = await page.textContent('[data-story-chapter="3"]');
console.log('章节按钮:', label.replace(/\s+/g, ' ').trim());

await page.click('[data-story-chapter="3"]');
// 一路点「继续」，直到按钮变成「开始对决」
for (let i = 0; i < 12; i++) {
  const text = (await page.textContent('#storyStageNext')).trim();
  if (text.includes('开始对决')) break;
  await page.click('#storyStageNext');
  await page.waitForTimeout(60);
}
console.log('按钮:', (await page.textContent('#storyStageNext')).trim());
await page.waitForTimeout(200);
await page.screenshot({ path: path.join(output, '第四章-剧情页-待确认.png') });

await page.click('#storyStageNext');
await page.waitForFunction(() => window.__jojo.game.s.phase === 'battle', null, { timeout: 20000 });
await page.waitForTimeout(900);
console.log('战场已就绪，场地 =', await page.evaluate(() => window.__jojo.game.s.story.arena));

await page.screenshot({ path: path.join(output, '第四章-海面战场-开局.png') });

// 把双方摆到水里 + 给玩家挂上溺水，看水波、青色边框和「溺」标记
await page.evaluate(() => {
  const g = window.__jojo.game;
  const put = (id, row, col) => { const u = g.unit(id); u.row = row; u.col = col; };
  put('p1-stand', 2, 3); put('p1-user', 2, 5);
  put('p2-stand', 4, 11); put('p2-user', 3, 10);
  g.s.drown.p1 = 2;
  g.s.turn = 'p1';
  g.select('p1-stand');
  g.touch();
});
await page.waitForTimeout(700);
await page.screenshot({ path: path.join(output, '第四章-水中棋子与溺水-待确认.png') });
// 棋盘单独放大一张：这张用来肉眼检查"状态标记有没有被六边形裁掉"（陷阱 24）
const boardShot = await page.$('#board');
await boardShot.screenshot({ path: path.join(output, '第四章-棋盘放大-水中标记.png') });

// 选中替身时的「目标预览」：把暗蓝之月挪到射程内，看拖入水下的提示
await page.evaluate(() => {
  const g = window.__jojo.game;
  const u = g.unit('p2-stand');
  u.row = 2; u.col = 6;
  g.s.turn = 'p2'; g.s.ap.p2 = 3;
  g.select('p2-stand');
  g.beginSkill(g.unit('p2-stand'), 'drag');
  g.touch();
});
await page.waitForTimeout(500);
await page.screenshot({ path: path.join(output, '第四章-拖入水下瞄准-待确认.png') });

// 甲板特写 + 甲板上的格子提示
await page.evaluate(() => {
  const g = window.__jojo.game;
  const put = (id, row, col) => { const u = g.unit(id); u.row = row; u.col = col; };
  put('p1-stand', 5, 6); put('p1-user', 5, 5);
  put('p2-stand', 4, 8); put('p2-user', 5, 9);
  g.select(null); g.s.pendingSkill = null; g.s.turn = 'p1'; g.touch();
});
await page.waitForTimeout(600);
const board = await page.$('#board');
await board.screenshot({ path: path.join(output, '第四章-木甲板特写-待确认.png') });

console.log('截图完成 → design/review/第四章-*.png');
await browser.close();
server.close();
