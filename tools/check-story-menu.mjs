/**
 * 诊断：剧情模式章节列表到底显示了什么。
 *
 * 分别看三种进度下的列表——① 全新玩家（什么都没通关）② 通关第一章 ③ 全部通关，
 * 把每一行的「第几章 / 标题 / 话数 / 能不能点」打印出来，并存一张截图。
 *
 * 用法：node tools/check-story-menu.mjs [地址]     默认线上 https://ppppx905.github.io/jojo/
 */
import { chromium } from 'playwright';
import { mkdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const REVIEW = path.join(ROOT, 'design/review');
await mkdir(REVIEW, { recursive: true });
const url = process.argv[2] || 'https://ppppx905.github.io/jojo/';
console.log(`检查：${url}\n`);

const browser = await chromium.launch({ headless: true })
  .catch(() => chromium.launch({ headless: true, channel: 'msedge' }));

const scenarios = [
  { name: '全新玩家（没通关任何一章）', cleared: [] },
  { name: '通关第一章', cleared: ['chapter-1'] },
  { name: '全部通关', cleared: ['chapter-1', 'chapter-2', 'chapter-3', 'chapter-4'] },
];

for (const scenario of scenarios) {
  const context = await browser.newContext({ viewport: { width: 1440, height: 1800 }, deviceScaleFactor: 1 });
  await context.addInitScript(cleared => {
    localStorage.setItem('stardust.story', JSON.stringify({ cleared }));
  }, scenario.cleared);
  const page = await context.newPage();
  await page.goto(`${url}?test=1&v=${Date.now()}`);
  await page.waitForFunction(() => window.__jojoReady, null, { timeout: 40000 });
  await page.click('[data-title-mode="story"]');
  await page.waitForSelector('#storyChapters li', { timeout: 20000 });

  const rows = await page.evaluate(() => [...document.querySelectorAll('#storyChapters li')].map(li => {
    const button = li.querySelector('button[data-story-chapter]');
    return {
      clickable: !!button,
      index: button ? button.dataset.storyChapter : null,
      text: li.textContent.replace(/\s+/g, ' ').trim().slice(0, 60),
      locked: li.textContent.includes('未解锁'),
    };
  }));
  const open = rows.filter(r => r.clickable);
  console.log(`【${scenario.name}】可点进的章节 ${open.length} 个，列表共 ${rows.length} 行`);
  for (const r of rows.slice(0, 8)) {
    console.log(`   ${r.clickable ? '可进入' : '不可进入'} | ${r.text}`);
  }
  if (rows.length > 8) console.log(`   ……后面还有 ${rows.length - 8} 行`);
  if (scenario.cleared.length === 0) {
    await page.screenshot({ path: path.join(REVIEW, '线上剧情章节列表-全新玩家.png'), fullPage: false });
    console.log('   截图：design/review/线上剧情章节列表-全新玩家.png');
  }
  console.log('');
  await context.close();
}

await browser.close();
