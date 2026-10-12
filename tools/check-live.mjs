/**
 * 实时校验：用真实浏览器打开「正在运行的」游戏服务器，数一数选人界面到底有几个角色、
 * 每张头像有没有真正加载出来。用来回答"我看到的到底是不是最新版"。
 *
 * 用法：node tools/check-live.mjs [地址]        默认 http://127.0.0.1:8799/
 */
import { chromium } from 'playwright';

const url = process.argv[2] || 'http://127.0.0.1:8799/';

let browser;
try { browser = await chromium.launch({ headless: true }); }
catch { browser = await chromium.launch({ headless: true, channel: 'msedge' }); }

const context = await browser.newContext({ viewport: { width: 1500, height: 950 } });
const page = await context.newPage();
const problems = [];
page.on('pageerror', error => problems.push('脚本错误: ' + error.message));
page.on('requestfailed', request => problems.push('请求失败: ' + request.url()));

console.log(`正在检查：${url}`);
await page.goto(url, { waitUntil: 'load' });
await page.waitForSelector('#lobby:not([hidden])', { timeout: 20000 });

const info = await page.evaluate(() => {
  const cards = [...document.querySelectorAll('#draftP1 .draft-pick')];
  const start = document.getElementById('startBtn').getBoundingClientRect();
  return {
    names: cards.map(card => card.querySelector('.draft-pick-name').textContent.trim()),
    portraits: cards.map(card => {
      const img = card.querySelector('img');
      return { src: img.getAttribute('src'), loaded: img.naturalWidth > 0 };
    }),
    skills: [...document.querySelectorAll('#draftP1 .draft-skills span')].map(s => s.textContent.trim()),
    startVisible: start.bottom <= window.innerHeight + 1,
  };
});

console.log(`  选人界面角色（${info.names.length} 个）：${info.names.join('、')}`);
console.log(`  头像加载成功：${info.portraits.filter(p => p.loaded).length}/${info.portraits.length}`);
console.log(`  当前选中角色的技能：${info.skills.join(' / ')}`);
console.log(`  「进入战场」按钮在屏幕内：${info.startVisible}`);

const wanted = '波鲁纳雷夫';
const ok = info.names.includes(wanted) && info.portraits.every(p => p.loaded) && problems.length === 0;
console.log('');
console.log(ok
  ? `结论：这个地址提供的是最新版，${wanted}在选人界面里 ✓`
  : `结论：存在问题 ✗${info.names.includes(wanted) ? '' : `（没有找到${wanted}）`}`);
for (const p of problems) console.log('  ' + p);

await browser.close();
process.exit(ok ? 0 : 1);
