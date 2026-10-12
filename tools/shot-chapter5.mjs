/**
 * 给第五章「力量」拍验收图：打开线上/本地的游戏 → 解锁到第五章 → 开打 →
 * 截图（船体要害、钢壁、被护着的猩猩、拆完一个之后的场地推进）。
 *
 * 用法：node tools/shot-chapter5.mjs [地址]      默认线上 https://ppppx905.github.io/jojo/
 *       node tools/shot-chapter5.mjs http://127.0.0.1:8799/
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
const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 2 });
// ★ 用试玩开关进第五章（`?unlock=all`）——**和用户实际试玩走的是同一条路**，
//   所以这个脚本同时也是"开关真的有用"的端到端验证。不写 localStorage，进度不受影响。
const page = await context.newPage();
const failures = [];
page.on('response', res => { if (res.status() >= 400) failures.push(`${res.status()} ${res.url()}`); });
page.on('pageerror', e => failures.push('页面错误: ' + e.message));

await page.goto(`${url}?test=1&unlock=all&v=${Date.now()}`);
await page.waitForFunction(() => window.__jojoReady, null, { timeout: 40000 });
await page.click('[data-title-mode="story"]');
await page.waitForSelector('[data-story-chapter="4"]', { timeout: 20000 });
const trial = await page.textContent('#storyChapters');
console.log('  章节列表是否标出试玩模式 =', /试玩模式/.test(trial));
await page.screenshot({ path: path.join(REVIEW, '第五章-试玩全解锁章节列表.png') });
await page.click('[data-story-chapter="4"]');
for (let i = 0; i < 12; i++) {
  if ((await page.textContent('#storyStageNext')).includes('开始对决')) break;
  await page.click('#storyStageNext');
  await page.waitForTimeout(60);
}
await page.screenshot({ path: path.join(REVIEW, '第五章-剧情页.png') });
await page.click('#storyStageNext');
await page.waitForFunction(() => window.__jojo.game.s.phase === 'battle', null, { timeout: 40000 });
await page.waitForTimeout(900);

const state = await page.evaluate(() => {
  const g = window.__jojo.game;
  const visual = window.__jojo.visual;
  return {
    arena: g.arenaKey(),
    parts: g.shipParts('p2').map(p => `${p.name}(${p.hp})`),
    walls: Object.values(g.s.terrain).filter(t => t === 'rock').length,
    // 诊断：渲染器到底有没有拿到这张背景图
    arenaImage: !!visual.arenas?.get('ship-deck'),
    arenaKeys: visual.arenas ? [...visual.arenas.keys()] : '（没有 arenas 字段）',
    spriteKeys: [...visual.sprites.keys()].filter(k => k.startsWith('arena:')),
  };
});
console.log('  渲染器里的场地图 =', state.arenaKeys, '| ship-deck 已加载 =', state.arenaImage);
console.log('  SPRITES 里的场地键 =', state.spriteKeys.join(', '));
console.log('  场地 =', state.arena);
console.log('  船体要害 =', state.parts.join(' / '));
console.log('  钢壁格数 =', state.walls);
await page.screenshot({ path: path.join(REVIEW, '第五章-船舱开局.png') });

// ★ 拍一张"带立绘"的台词：开局那句是承太郎说的，对话框左侧应该出现他的棋子立绘。
//   机制提示那条（没有立绘）先播，所以要等它过去。
await page.waitForFunction(() => {
  const n = document.getElementById('bark');
  return n && !n.hidden && n.textContent.includes('整艘船都在动');
}, null, { timeout: 30000 });
const withFace = await page.evaluate(() => {
  const img = document.querySelector('#bark .bark-face');
  return { who: (document.querySelector('#bark .bark-who') || {}).textContent || '', src: img ? img.getAttribute('src') : '（没有立绘）', loaded: !!(img && img.naturalWidth > 0) };
});
console.log('  带立绘的台词：说话人 =', withFace.who, '| 立绘 =', withFace.src, '| 已加载 =', withFace.loaded);
await page.waitForTimeout(700);            // 等淡入动画落定再截图，别拍到半透明的那一帧
await page.screenshot({ path: path.join(REVIEW, '第五章-台词立绘.png') });

// ★ 第一阶段：把承太郎的替身挪到"当前那个要害"旁边，真打它一下（要触发换层横幅）
await page.evaluate(() => {
  const g = window.__jojo.game;
  const part = g.shipParts('p2')[0];
  const stand = g.unit('p1-stand'), user = g.unit('p1-user');
  stand.row = part.row; stand.col = part.col + 1;
  user.row = part.row + 1; user.col = part.col + 1;
  g.select(stand.id);
  g.touch();
});
await page.waitForTimeout(700);
await page.screenshot({ path: path.join(REVIEW, '第五章-瞄准船体要害.png') });

// 拆掉当前要害 → 场地推进一层 + 换层横幅 + 棋盘冲击
const after = await page.evaluate(() => {
  const g = window.__jojo.game;
  const part = g.shipParts('p2')[0];
  g.damage(part, 999, { side: 'p1', source: '验收' });
  g.touch();
  return { arena: g.arenaKey(), name: g.arenaName(), left: g.shipParts('p2').length,
    next: (g.shipParts('p2')[0] || {}).name, bonus: g.shipBreakBonus('p1'), hp: g.s.hp.p2 };
});
await page.waitForTimeout(500);
console.log('  拆掉第 1 个要害：场地 =', after.arena, '=', after.name, '| 下一个 =', after.next, '| 伤害加成 +' + after.bonus);
await page.screenshot({ path: path.join(REVIEW, '第五章-换层横幅-走廊.png') });

// 拆掉第二个 → 锅炉舱
const engine = await page.evaluate(() => {
  const g = window.__jojo.game;
  g.damage(g.shipParts('p2')[0], 999, { side: 'p1', source: '验收' });
  g.touch();
  return { arena: g.arenaKey(), name: g.arenaName(), left: g.shipParts('p2').length, bonus: g.shipBreakBonus('p1') };
});
await page.waitForTimeout(500);
console.log('  拆掉第 2 个要害：场地 =', engine.arena, '=', engine.name, '| 剩余 =', engine.left, '| 伤害加成 +' + engine.bonus);
await page.screenshot({ path: path.join(REVIEW, '第五章-锅炉舱.png') });

// 拆掉最后一个 → 猩猩登场（满血 40）
const exposed = await page.evaluate(() => {
  const g = window.__jojo.game;
  while (g.shipParts('p2').length) g.damage(g.shipParts('p2')[0], 999, { side: 'p1', source: '验收' });
  const boss = g.unit('p2-user'), stand = g.unit('p1-stand');
  if (boss && stand) { stand.row = boss.row; stand.col = boss.col - 1; g.select(stand.id); }
  g.touch();
  return { arena: g.arenaKey(), name: g.arenaName(), boss: !!boss, hp: g.s.hp.p2,
    reason: boss ? (g.attackReason(stand, boss) || '（可以打了）') : '（猩猩没登场）' };
});
await page.waitForTimeout(500);
console.log('  拆完最后一个：场地 =', exposed.arena, '=', exposed.name, '| 猩猩登场 =', exposed.boss, '| 他的血 =', exposed.hp, '| 攻击他 =', exposed.reason);
await page.screenshot({ path: path.join(REVIEW, '第五章-猩猩登场.png') });

const board = await page.$('#board');
await board.screenshot({ path: path.join(REVIEW, '第五章-棋盘放大.png') });

// ★ 验证"击倒对手的台词不能被结算弹窗盖住"（用户报过："结算出现得太早，还没看清结束对话"）：
//   打死猩猩 1 秒后，台词应该在播、而弹窗**还没**弹；等台词播完弹窗才出来。
//   先等台词队列播空，这样测的才是"击倒那句"的等待行为，而不是排在它前面的几句。
await page.waitForFunction(() => {
  const n = document.getElementById('bark');
  return !n || n.hidden;
}, null, { timeout: 30000 });
await page.evaluate(() => {
  const g = window.__jojo.game;
  g.damage(g.unit('p2-user'), 999, { side: 'p1', source: '验收' });
  // ⚠️ damage() 只扣血、**不判胜负**（这是引擎的既有约定：由 attack / endTurn 等调用方判）。
  //    脚本直接调 damage 时必须自己补一次 checkEnd()，否则这一局根本不会结束。
  g.checkEnd();
});
await page.waitForTimeout(1000);
const mid = await page.evaluate(() => {
  const n = document.getElementById('bark');
  return {
    phase: window.__jojo.game.s.phase,
    bark: n && !n.hidden ? n.textContent.trim().replace(/\s+/g, ' ').slice(0, 46) : '',
    dialog: !!document.querySelector('dialog[open]'),
  };
});
console.log('  打死猩猩 1 秒后：局面 =', mid.phase, '| 台词 =', mid.bark ? `「${mid.bark}」` : '（没有）', '| 结算弹窗已弹出 =', mid.dialog);
await page.screenshot({ path: path.join(REVIEW, '第五章-击倒台词.png') });

await page.waitForFunction(() => !!document.querySelector('dialog[open]'), null, { timeout: 20000 });
const settled = await page.evaluate(() => {
  const n = document.getElementById('bark');
  return { dialog: !!document.querySelector('dialog[open]'), barkShown: !!(n && !n.hidden) };
});
console.log('  等到弹窗出来：结算弹窗 =', settled.dialog, '| 台词条已收起 =', settled.barkShown ? '否' : '是');
await page.screenshot({ path: path.join(REVIEW, '第五章-结算.png') });

await browser.close();
console.log('');
console.log(failures.length ? `✗ 有 ${[...new Set(failures)].length} 项问题：\n   ${[...new Set(failures)].join('\n   ')}` : '✓ 没有请求失败或页面报错');
console.log('截图 → design/review/第五章-*.png');
