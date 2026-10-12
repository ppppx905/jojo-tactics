/**
 * 拍某一章的**战斗内台词**（对话框 + 左侧大招插画立绘）。
 * 默认第一章——用户 2026-09-27 就是拿"承太郎对花京院"那一段指出问题的。
 *
 * 用法：node tools/shot-dialog.mjs [章节下标=1] [地址]
 *       章节下标从 1 开始（1 = 第一章 星尘的起点）。
 */
import { chromium } from 'playwright';
import { mkdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const REVIEW = path.join(ROOT, 'design/review');
await mkdir(REVIEW, { recursive: true });
const index = Number(process.argv[2] || 1);
const url = process.argv[3] || 'http://127.0.0.1:8799/';
const pad = String(index).padStart(2, '0');
console.log(`检查：${url}  第 ${index} 章的第 ${index - 1} 号章节\n`);

const browser = await chromium.launch({ headless: true })
  .catch(() => chromium.launch({ headless: true, channel: 'msedge' }));
const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 2 });
const page = await context.newPage();
const failures = [];
page.on('response', res => { if (res.status() >= 400) failures.push(`${res.status()} ${res.url()}`); });
page.on('pageerror', e => failures.push('页面错误: ' + e.message));

await page.goto(`${url}?test=1&unlock=all&v=${Date.now()}`);
await page.waitForFunction(() => window.__jojoReady, null, { timeout: 40000 });
await page.click('[data-title-mode="story"]');
await page.waitForSelector(`[data-story-chapter="${index - 1}"]`, { timeout: 20000 });
await page.click(`[data-story-chapter="${index - 1}"]`);
for (let i = 0; i < 12; i++) {
  if ((await page.textContent('#storyStageNext')).includes('开始对决')) break;
  await page.click('#storyStageNext');
  await page.waitForTimeout(60);
}
await page.click('#storyStageNext');
await page.waitForFunction(() => window.__jojo.game.s.phase === 'battle', null, { timeout: 40000 });

// 依次拍四句台词：开局 / 第 2 回合 / 半血 / 击倒对手。
// ⚠️ 必须"**先等上一句播完 → 再触发 → 再等新的一句出现**"：台词是排队播的，
//    不等就触发下一句，后面几次拍到的还是同一句（第一版就这么错了）。
let lastText = '';
const shots = [];
const barkState = () => page.evaluate(() => {
  const node = document.getElementById('bark');
  const img = document.querySelector('#bark .bark-face');
  return {
    shown: !!(node && !node.hidden),
    who: (document.querySelector('#bark .bark-who') || document.querySelector('#bark .bark-narration') || {}).textContent || '',
    text: node ? node.textContent.replace(/\s+/g, ' ').trim() : '',
    face: img ? img.getAttribute('src') : '（无立绘）',
    faceLoaded: !!(img && img.naturalWidth > 0),
  };
});
async function waitIdle() {
  await page.waitForFunction(() => {
    const n = document.getElementById('bark');
    return !n || n.hidden;
  }, null, { timeout: 30000 }).catch(() => {});
}
async function shoot(label, trigger) {
  // 没有 trigger 的（开局那句）＝"现在就正在播的那一句"，不能先等它播完
  if (trigger) {
    await waitIdle();
    await page.evaluate(trigger);
  }
  const ok = await page.waitForFunction(prev => {
    const n = document.getElementById('bark');
    return n && !n.hidden && n.textContent.replace(/\s+/g, ' ').trim() !== prev;
  }, lastText, { timeout: 15000 }).then(() => true).catch(() => false);
  if (!ok) { console.log(`  ${label}：没有新台词（跳过）`); return; }
  await page.waitForTimeout(700);                    // 等淡入动画落定
  const info = await barkState();
  lastText = info.text;
  console.log(`  ${label}：${info.who} — ${info.text}`);
  console.log(`        立绘 = ${info.face}（已加载 = ${info.faceLoaded}）`);
  const file = path.join(REVIEW, `第${index}章台词-${label}.png`);
  await page.screenshot({ path: file });
  shots.push(path.basename(file));
}

await shoot('开局');
await shoot('第2回合', () => { const g = window.__jojo.game; g.endTurn(); g.endTurn(); });
await shoot('半血', () => {
  const g = window.__jojo.game;
  g.s.hp.p1 = Math.floor(g.fighter('p1').hp / 2);
  g.damage(g.unit('p1-user'), 1, { source: '验收' });
  g.checkEnd();
});
await shoot('击倒对手', () => {
  const g = window.__jojo.game;
  const foe = g.unit('p2-user') || g.unit('p2-stand');
  g.damage(foe, 999, { side: 'p1', source: '验收' });
  g.checkEnd();
});

await browser.close();
console.log('');
console.log(failures.length ? `✗ 有 ${[...new Set(failures)].length} 项问题：\n   ${[...new Set(failures)].join('\n   ')}` : '✓ 没有请求失败或页面报错');
console.log('截图 →', shots.join(', '));
