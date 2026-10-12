/** Actual Chromium input, layouts, combat and screenshots. Starts a loopback-only server. */
import { chromium } from 'playwright';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { CANVAS_W, CANVAS_H, ROWS, COLS } from '../src/core/hex.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const output = path.join(root, 'design/review');
await mkdir(output, { recursive: true });
const mime = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.png': 'image/png', '.webp': 'image/webp', '.woff2': 'font/woff2', '.json': 'application/json' };
const server = createServer(async (req, res) => {
  try {
    const url = new URL(req.url, 'http://localhost');
    const pathname = decodeURIComponent(url.pathname === '/' ? '/index.html' : url.pathname);
    const file = path.resolve(root, `.${pathname}`);
    if (!file.startsWith(root + path.sep) || pathname.split('/').some(p => p.startsWith('.'))) throw Error('Invalid path');
    const body = await readFile(file);
    res.writeHead(200, { 'Content-Type': mime[path.extname(file)] || 'application/octet-stream', 'Cache-Control': 'max-age=300' });
    res.end(body);
  } catch { res.writeHead(404); res.end('Not found'); }
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const base = `http://127.0.0.1:${server.address().port}`;
// 优先用 Playwright 自带的 Chromium；本机没装时退回系统自带的 Edge（channel: 'msedge'），
// 这样在任何 Windows 机器上都能跑这份验收测试。
const browser = await chromium.launch({ headless: true })
  .catch(() => chromium.launch({ headless: true, channel: 'msedge' }));
const results = [], errors = [];
let currentPage;
const check = (name, details = {}) => { results.push({ name, ...details }); console.log(`✓ ${name}`); };
async function makePage(viewport = { width: 1366, height: 768 }, dpr = 1) {
  const context = await browser.newContext({ viewport, deviceScaleFactor: dpr });
  const page = await context.newPage();
  page.on('pageerror', error => errors.push(`${page.url()}\n${error.stack}`));
  page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
  currentPage = page;
  return page;
}
async function load(page, suffix = '?auto=1&test=1') {
  await page.goto(base + '/' + suffix);
  await page.waitForFunction(() => window.__jojoReady);
  if (suffix.includes('auto')) await page.waitForFunction(() => document.getElementById('board').getBoundingClientRect().width > 0 && window.__jojo.game.s.phase === 'battle');
}
async function state(page) { return page.evaluate(() => JSON.parse(JSON.stringify(window.__jojo.game.s))); }
async function ready(page) { await page.waitForFunction(() => !window.__jojo.busy); }
async function point(page, row, col) {
  return page.evaluate(({ row, col, width, height }) => {
    const t = window.__jojo.game.at(row, col), rect = document.getElementById('board').getBoundingClientRect();
    return { x: rect.left + t.cx * rect.width / width, y: rect.top + t.cy * rect.height / height };
  }, { row, col, width: CANVAS_W, height: CANVAS_H });
}
async function clickTile(page, row, col) { const p = await point(page, row, col); await page.mouse.click(p.x, p.y); }
async function scrollToTile(page, row, col) {
  await page.evaluate(({ row, col, width, height }) => {
    const tile = window.__jojo.game.at(row, col), well = document.getElementById('boardWell');
    const board = document.getElementById('board').getBoundingClientRect(), clip = well.getBoundingClientRect();
    well.scrollBy({ left: board.left + tile.cx * board.width / width - clip.left - well.clientWidth / 2,
      top: board.top + tile.cy * board.height / height - clip.top - well.clientHeight / 2, behavior: 'instant' });
  }, { row, col, width: CANVAS_W, height: CANVAS_H });
}
async function verifyEveryTile(page, label, scroll = false) {
  await page.evaluate(() => {
    const g = window.__jojo.game;
    window.__geometry = { units: g.s.units, action: g.actionAt };
    g.s.units = []; g.clearSelection(); g.touch();
    g.actionAt = function (tile) { window.__clicked = `${tile.row},${tile.col}`; return window.__geometry.action.call(this, tile); };
  });
  for (let row = 0; row < ROWS; row++) for (let col = 0; col < COLS; col++) {
    if (scroll) await scrollToTile(page, row, col);
    await clickTile(page, row, col);
    const got = await page.evaluate(() => ({ clicked: window.__clicked, hover: `${window.__jojo.hover?.row},${window.__jojo.hover?.col}` }));
    assert.equal(got.clicked, `${row},${col}`, `click ${label}`);
    assert.equal(got.hover, `${row},${col}`, `hover ${label}`);
  }
  await page.evaluate(() => {
    const g = window.__jojo.game;
    g.s.units = window.__geometry.units; g.actionAt = window.__geometry.action; g.select('p1-stand');
    delete window.__geometry; delete window.__clicked;
  });
}
async function clickUnit(page, id) {
  const u = (await state(page)).units.find(u => u.id === id);
  await clickTile(page, u.row, u.col);
}
async function clickExplanation(page, selector) {
  // aria-disabled is intentionally focusable/clickable to explain the rejection.
  // Playwright's locator.click waits for aria-enabled, so use an actual pointer.
  const rect = await page.locator(selector).boundingBox();
  assert.ok(rect);
  await page.mouse.click(rect.x + rect.width / 2, rect.y + rect.height / 2);
}
async function combatFixture(page, { hp, ap } = {}) {
  await ready(page);
  await page.evaluate(({ hp, ap }) => {
    const g = window.__jojo.game;
    g.s.terrain = {}; g.s.pillars = []; g.s.fire = []; g.clearSelection();
    for (const [id, row, col] of [['p1-user', 5, 3], ['p1-stand', 5, 4], ['p2-user', 5, 6], ['p2-stand', 5, 5]]) Object.assign(g.unit(id), { row, col });
    if (hp) Object.assign(g.s.hp, hp);
    if (ap) Object.assign(g.s.ap, ap);
    g.checkTimeWindow(); g.touch();
  }, { hp, ap });
  await page.waitForTimeout(35);
}
async function confirmEnd(page) {
  await ready(page); await page.locator('#btnEnd').click();
  if (await page.locator('#confirmDialog').isVisible()) await page.locator('#cfOk').click();
}
async function layoutEvidence(page) {
  return page.evaluate(() => {
    const board = document.getElementById('board').getBoundingClientRect(), app = document.getElementById('app').getBoundingClientRect();
    const bays = [...document.querySelectorAll('.fighter-bay')].map(el => ({ ...el.getBoundingClientRect().toJSON(), scroll: el.scrollHeight, client: el.clientHeight }));
    const images = [...document.images].filter(img => img.offsetParent !== null).map(img => ({ src: img.getAttribute('src'), loaded: img.complete && img.naturalWidth > 0 }));
    return { board: board.toJSON(), app: app.toJSON(), bays, images, overflowX: document.documentElement.scrollWidth - innerWidth,
      overflowY: document.documentElement.scrollHeight - innerHeight, dpr: devicePixelRatio, backing: { width: document.getElementById('board').width, height: document.getElementById('board').height } };
  });
}

try {
  // Screen coordinates go through real pointer events; the rules receive each visible cell.
  if (!process.argv.includes('--skip-geometry')) for (const [width, height, dpr] of [[1920, 1080, 1], [1366, 768, 1], [1920, 1080, 2], [1366, 768, 2]]) {
    const page = await makePage({ width, height }, dpr);
    await load(page); await page.waitForTimeout(80);
    const before = await layoutEvidence(page);
    assert.ok(Math.abs(before.board.x + before.board.width / 2 - (before.app.x + before.app.width / 2)) < 1);
    assert.ok(Math.abs(before.bays[0].width - before.bays[1].width) < .5);
    assert.ok(before.overflowX <= 1 && before.overflowY <= 1);
    assert.ok(before.bays.every(b => b.scroll <= b.client + 1));
    assert.ok(before.images.every(i => i.loaded));
    await clickUnit(page, 'p1-stand');
    const after = await layoutEvidence(page);
    assert.equal((await state(page)).selectedId, 'p1-stand');
    assert.ok(Math.abs(before.board.x - after.board.x) < .1 && Math.abs(before.board.width - after.board.width) < .1);
    await verifyEveryTile(page, `${width} DPR${dpr}`);
    await page.mouse.move(20, 20); await page.waitForTimeout(80);
    if (dpr === 1) await page.screenshot({ path: path.join(output, width === 1920 ? 'battle-desktop.png' : 'battle-laptop.png') });
    check(`${width}×${height} / DPR ${dpr}: ${ROWS * COLS} real clicks and hovers, stable centered layout`, { layout: before });
    await page.context().close();
  }

  const page = await makePage();
  await load(page, '?test=1');
  await page.locator('[data-draft-side="p1"][data-fighter="avdol"]').click();
  await page.locator('[data-draft-side="p2"][data-fighter="kakyoin"]').click();
  await page.screenshot({ path: path.join(output, 'selection.png'), fullPage: true });
  const lobbySize = await page.evaluate(() => ({ height: document.documentElement.scrollHeight, width: document.documentElement.scrollWidth, innerWidth, innerHeight }));
  assert.ok(lobbySize.width <= lobbySize.innerWidth + 1);
  assert.ok(lobbySize.height <= lobbySize.innerHeight + 1, 'desktop selection fits viewport');
  await page.locator('#startBtn').click();
  assert.equal((await state(page)).fighters.p1.key, 'avdol'); assert.equal((await state(page)).fighters.p2.key, 'kakyoin');
  assert.equal((await state(page)).selectedId, null);
  await clickUnit(page, 'p1-user');
  const target = await page.evaluate(() => { const g = window.__jojo.game; return g.reachable(g.selected).find(t => !g.s.terrain[`${t.row},${t.col}`]); });
  await clickTile(page, target.row, target.col); await ready(page);
  assert.equal((await state(page)).ap.p1, 2);
  await page.locator('#btnEnd').click(); await page.locator('#cfCancel').click(); assert.equal((await state(page)).turn, 'p1');
  await confirmEnd(page); assert.equal((await state(page)).turn, 'p2');
  await clickUnit(page, 'p2-stand'); assert.equal((await state(page)).selectedId, 'p2-stand');
  check('selection, real movement, remaining-AP confirmation and both players taking turns');

  const beforeReset = (await state(page)).units;
  await page.locator('#menuBtn').click(); await page.locator('#restartBtn').click(); await page.locator('#cfCancel').click();
  assert.deepEqual((await state(page)).units, beforeReset);
  await page.locator('#menuBtn').click(); await page.locator('#restartBtn').click(); await page.locator('#cfOk').click();
  assert.equal((await state(page)).phase, 'select'); assert.equal((await state(page)).selectedId, null); assert.deepEqual((await state(page)).ap, { p1: 0, p2: 0 });
  assert.ok(await page.locator('#lobby').isVisible());
  await page.locator('#startBtn').click(); assert.deepEqual((await state(page)).hp, { p1: 45, p2: 40 });
  check('reset is confirmed, clears state and returns to a working selection screen');

  await load(page, '?auto=1&test=1&vs=jotaro,dio'); await combatFixture(page);
  await clickUnit(page, 'p1-stand');
  let pt = await point(page, 5, 5); await page.mouse.move(pt.x, pt.y);
  await page.waitForFunction(() => document.getElementById('targetPreview').textContent.includes('−4'));
  await clickTile(page, 5, 5); assert.equal((await state(page)).hp.p2, 46);
  await page.waitForFunction(() => document.querySelector('[data-hp="p2"]').textContent.includes('46'));
  await clickUnit(page, 'p1-stand'); await page.locator('[data-command="ora"]').click();
  await page.mouse.move(pt.x, pt.y);
  await page.waitForFunction(() => document.getElementById('targetPreview').textContent.includes('−12'));
  await page.screenshot({ path: path.join(output, 'damage-preview.png') });
  await clickTile(page, 5, 5); assert.equal((await state(page)).hp.p2, 34); assert.equal((await state(page)).ap.p1, 0);
  await page.waitForTimeout(180); assert.ok(await page.locator('#cutin').isVisible());
  await page.screenshot({ path: path.join(output, 'skill-ora.png') });
  await ready(page); await clickUnit(page, 'p1-stand');
  assert.equal((await state(page)).selectedId, 'p1-stand');
  assert.equal(await page.locator('[data-command="ora"]').getAttribute('aria-disabled'), 'true');
  assert.match(await page.locator('[data-command="ora"]').textContent(), /CD 2/);
  check('ordinary/skill damage previews, shared HP, cooldown labels, hit feedback and actual ORA illustration');

  await page.evaluate(() => { const g = window.__jojo.game; g.s.hp.p1 = 20; g.checkTimeWindow(); g.touch(); });
  await page.waitForFunction(() => document.querySelector('[data-command="time"]').getAttribute('aria-disabled') === 'false');
  await page.locator('[data-command="time"]').click(); assert.equal((await state(page)).ap.p1, 0);
  assert.equal((await state(page)).timeUsed.p1, true); await ready(page);
  await page.locator('#btnEnd').click(); assert.equal((await state(page)).turn, 'p1'); assert.equal((await state(page)).turnNumber, 3);
  assert.equal((await state(page)).ap.p1, 3);
  check('zero-AP time stop and automatically skipped opponent turn');

  await page.evaluate(() => { const g = window.__jojo.game; g.s.hp.p2 = 1; g.s.ap.p1 = 3; g.touch(); });
  await clickUnit(page, 'p1-stand'); await clickTile(page, 5, 5);
  await page.waitForSelector('#resultDialog[open]'); assert.match(await page.locator('#resultReason').textContent(), /共享生命归零/);
  await page.screenshot({ path: path.join(output, 'result.png') });
  await page.locator('#rematchBtn').click(); assert.deepEqual((await state(page)).hp, { p1: 40, p2: 50 }); assert.equal((await state(page)).log.length, 1);
  await page.locator('#menuBtn').click(); await page.locator('#resignBtn').click(); await page.locator('#cfOk').click();
  await page.waitForSelector('#resultDialog[open]'); assert.match(await page.locator('#resultReason').textContent(), /主动认输/);
  await page.locator('#newMatchBtn').click(); assert.equal((await state(page)).phase, 'select');
  check('lethal result, rematch, confirmed resignation and accurate result reason');

  await load(page, '?auto=1&test=1&vs=kakyoin,jotaro'); await combatFixture(page);
  await clickUnit(page, 'p1-stand'); await page.locator('[data-command="emerald"]').click();
  await clickTile(page, 0, 13); assert.equal((await state(page)).pendingSkill, 'emerald'); assert.equal((await state(page)).ap.p1, 3);
  await page.mouse.move(12, 12); await page.waitForTimeout(40);
  assert.match(await page.locator('#info').textContent(), /无法放置/); assert.equal(await page.locator('#info').getAttribute('class'), 'warn');
  const place = await page.evaluate(() => { const g = window.__jojo.game; return g.placement(g.selected)[0]; });
  await clickTile(page, place.row, place.col); assert.equal((await state(page)).pillars.length, 1); assert.equal((await state(page)).ap.p1, 1);
  await page.evaluate(() => { const g = window.__jojo.game; g.s.ap.p1 = 3; g.touch(); });
  await clickUnit(page, 'p1-stand'); await page.locator('[data-command="splash"]').click();
  await clickTile(page, 5, 6); assert.equal((await state(page)).hp.p2, 33);
  await page.waitForTimeout(180); await page.screenshot({ path: path.join(output, 'skill-splash.png') }); await ready(page);
  check('placement warnings persist on hover, emerald pillar and splash use real UI actions');

  await load(page, '?auto=1&test=1&vs=avdol,dio'); await combatFixture(page, { ap: { p1: 2 } });
  await clickUnit(page, 'p1-stand'); await page.locator('[data-command="flame"]').click();
  const flame1 = await page.evaluate(() => { const g = window.__jojo.game; return g.placement(g.selected)[0]; });
  assert.equal((await state(page)).ap.p1, 2);
  await clickTile(page, flame1.row, flame1.col); assert.equal((await state(page)).ap.p1, 0);
  await page.waitForTimeout(180); await page.screenshot({ path: path.join(output, 'skill-flame.png') }); await ready(page);
  const flame2 = await page.evaluate(() => { const g = window.__jojo.game; return g.placement(g.selected)[0]; });
  await clickTile(page, flame2.row, flame2.col);
  assert.equal((await state(page)).fire.length, 2); assert.equal((await state(page)).pendingSkill, 'flame');
  await page.locator('#finishFlameBtn').click(); assert.equal((await state(page)).pendingSkill, null); assert.equal((await state(page)).fire.length, 2);
  await page.evaluate(() => { const g = window.__jojo.game; g.s.ap.p1 = 1; g.s.hp.p1 = 35; g.touch(); });
  await clickUnit(page, 'p1-stand'); await page.locator('[data-command="blaze"]').click();
  assert.equal((await state(page)).hp.p1, 39); assert.equal((await state(page)).fire.length, 0); assert.equal((await state(page)).blazeUsed.p1, true); await ready(page);
  check('flame continuation at zero AP, explicit finish and once-only blaze healing');

  await load(page, '?auto=1&test=1&vs=dio,jotaro'); await combatFixture(page, { hp: { p1: 35 } });
  await page.evaluate(() => { const g = window.__jojo.game; Object.assign(g.unit('p1-user'), { row: 5, col: 4 }); Object.assign(g.unit('p1-stand'), { row: 5, col: 3 }); g.s.burn.p1 = 1; g.touch(); });
  await clickUnit(page, 'p1-stand'); await clickExplanation(page, '[data-command="drain"]'); assert.match((await state(page)).notice.text, /使者/);
  await clickUnit(page, 'p1-user'); await page.locator('[data-command="drain"]').click();
  pt = await point(page, 5, 6); await page.mouse.move(pt.x, pt.y);
  await page.waitForFunction(() => document.getElementById('targetPreview').textContent.includes('吸血 +2'));
  await clickTile(page, 5, 6); assert.equal((await state(page)).hp.p1, 37); assert.equal((await state(page)).hp.p2, 36);
  await page.evaluate(() => { const g = window.__jojo.game; g.s.hp.p1 = 25; g.s.ap.p1 = 1; g.touch(); });
  await clickUnit(page, 'p1-stand'); await page.locator('[data-command="time"]').click();
  await page.waitForTimeout(180); await page.screenshot({ path: path.join(output, 'skill-time.png') }); await ready(page);
  check('DIO caster restriction, burn-adjusted drain preview and THE WORLD illustration');

  await load(page, '?auto=1&test=1&mode=ai');
  await confirmEnd(page); assert.equal((await state(page)).turn, 'p2');
  await page.waitForFunction(() => document.getElementById('btnEnd').disabled);
  assert.ok(await page.locator('#btnEnd').isDisabled());
  await page.locator('#menuBtn').click(); const paused = await state(page);
  await page.waitForTimeout(950); assert.deepEqual((await state(page)).ap, paused.ap); assert.deepEqual((await state(page)).units, paused.units);
  await page.keyboard.press('Escape');
  await page.waitForFunction(() => window.__jojo.game.s.turn === 'p1', { timeout: 16000 });
  await confirmEnd(page); await page.locator('#menuBtn').click(); await page.locator('#restartBtn').click(); await page.locator('#cfOk').click();
  await page.waitForTimeout(1000); assert.equal((await state(page)).phase, 'select'); assert.equal((await state(page)).units.length, 0);
  check('AI completes a real turn, pauses for a modal and cannot mutate a reset match');

  await load(page); await page.locator('#settingsBtn').click();
  await page.locator('#motionSetting').check(); await page.locator('#contrastSetting').check(); await page.locator('#soundSetting').uncheck();
  await page.keyboard.press('Escape');
  assert.deepEqual(await page.evaluate(() => window.__jojo.preferences), { sound: false, reducedMotion: true, highContrast: true });
  await page.reload(); await page.waitForFunction(() => window.__jojoReady);
  assert.equal(await page.locator('#muteBtn').getAttribute('aria-pressed'), 'true');
  assert.ok(await page.locator('body').evaluate(el => el.classList.contains('high-contrast')));
  await page.keyboard.press('2'); assert.equal((await state(page)).selectedId, 'p1-stand');
  await page.keyboard.press('q'); assert.equal((await state(page)).pendingSkill, 'ora');
  await page.keyboard.press('Escape'); assert.equal((await state(page)).pendingSkill, null);
  await page.keyboard.press('Escape'); assert.equal((await state(page)).selectedId, null);
  await page.locator('#board').focus(); await page.keyboard.press('Home');
  assert.equal(await page.evaluate(() => `${window.__jojo.hover.row},${window.__jojo.hover.col}`), '0,0');
  await page.keyboard.press('ArrowRight'); assert.equal(await page.evaluate(() => window.__jojo.hover.col), 1);
  await page.locator('.toolbar [data-help]').click();
  for (let i = 0; i < 6; i++) await page.keyboard.press('Tab');
  assert.ok(await page.evaluate(() => document.getElementById('helpDialog').contains(document.activeElement)));
  await page.keyboard.press('Escape'); assert.ok(!(await page.locator('#helpDialog').isVisible()));
  check('keyboard actions, cancellation, native focus trap and persisted sound/motion/contrast settings');

  await page.context().setOffline(true);
  await page.waitForFunction(() => !document.getElementById('connection').hidden);
  await page.keyboard.press('1');
  const offlineTile = await page.evaluate(() => { const g = window.__jojo.game; return g.reachable(g.selected)[0]; });
  await clickTile(page, offlineTile.row, offlineTile.col); assert.equal((await state(page)).ap.p1, 2);
  await page.context().setOffline(false); await page.waitForFunction(() => document.getElementById('connection').hidden);
  check('offline status is explicit and loaded local gameplay continues without a server connection');

  // Deliberately fail a boot dependency in an isolated context, then retry the real page.
  // Only that exact network failure is expected; other errors still fail this check.
  const retryContext = await browser.newContext({ viewport: { width: 1366, height: 768 } });
  const retryPage = await retryContext.newPage(), retryErrors = [];
  currentPage = retryPage;
  const failedModule = `${base}/src/core/game.js`;
  let abortedModules = 0;
  retryPage.on('pageerror', error => retryErrors.push(error.stack));
  retryPage.on('console', message => {
    if (message.type() === 'error' && !(message.location().url === failedModule && message.text().includes('net::ERR_FAILED'))) retryErrors.push(message.text());
  });
  retryPage.on('requestfailed', request => {
    if (request.url() === failedModule) abortedModules++;
    else retryErrors.push(`${request.url()}: ${request.failure()?.errorText}`);
  });
  await retryPage.route('**/src/core/game.js', route => route.abort('failed'));
  await retryPage.goto(base + '/?test=1');
  await retryPage.locator('#bootRetry').waitFor({ state: 'visible', timeout: 18000 });
  assert.ok(abortedModules > 0);
  assert.match(await retryPage.locator('#bootText').textContent(), /加载未完成/);
  assert.equal(await retryPage.evaluate(() => !!window.__jojoReady), false);
  await retryPage.screenshot({ path: path.join(output, 'loading-error.png') });
  await retryPage.unroute('**/src/core/game.js');
  await Promise.all([retryPage.waitForNavigation(), retryPage.locator('#bootRetry').click()]);
  await retryPage.waitForFunction(() => window.__jojoReady);
  assert.ok(await retryPage.locator('#lobby').isVisible());
  assert.ok(!(await retryPage.locator('#boot').isVisible()));
  assert.deepEqual(retryErrors, []);
  check('failed boot dependency shows a retry action, and retry restores the selection screen', { expectedModuleFailures: abortedModules });
  await retryContext.close();

  for (const [width, height] of [[390, 844], [768, 1024]]) {
    const mobile = await makePage({ width, height }, 2);
    await load(mobile);
    const evidence = await layoutEvidence(mobile);
    assert.ok(evidence.overflowX <= 1 && evidence.overflowY <= 1, 'no page-wide overflow');
    assert.ok(evidence.bays.every(b => b.scroll <= b.client + 1), 'compact HP cards do not overflow');
    await clickUnit(mobile, 'p1-user'); assert.equal((await state(mobile)).selectedId, 'p1-user');
    const standShortcut = mobile.locator('.actor-shortcuts [data-unit="p1-stand"]');
    await standShortcut.focus(); await mobile.keyboard.press('Enter');
    await mobile.waitForFunction(() => window.__jojo.game.s.selectedId === 'p1-stand' &&
      document.activeElement?.matches('.actor-shortcuts [data-unit="p1-stand"][aria-pressed="true"]'));
    await verifyEveryTile(mobile, `${width}×${height} scrolled DPR2`, true);
    const selected = (await state(mobile)).units.find(u => u.id === 'p1-stand');
    await scrollToTile(mobile, selected.row, selected.col);
    await mobile.mouse.move(20, 20); await mobile.waitForTimeout(80);
    await mobile.screenshot({ path: path.join(output, width === 390 ? 'battle-mobile.png' : 'battle-tablet.png'), fullPage: true });
    check(`${width}×${height}: compact cards, restored shortcut focus, ${ROWS * COLS} real clicks and hovers after scrolling`, { layout: evidence });
    await mobile.context().close();
  }

  // Measure sustained selected-board rendering and verify static terrain isn't repainted each frame.
  await page.context().clearCookies();
  currentPage = page;
  await page.evaluate(() => localStorage.clear()); await load(page, '?auto=1&demo=1&test=1');
  const perf = await page.evaluate(async () => {
    const v = window.__jojo.visual, before = v.baseDrawCount, timings = [];
    let previous = performance.now();
    await new Promise(resolve => { let n = 0; function frame(now) { if (n++ > 4) timings.push(now - previous); previous = now; if (n < 90) requestAnimationFrame(frame); else resolve(); } requestAnimationFrame(frame); });
    timings.sort((a, b) => a - b);
    return { medianMs: timings[Math.floor(timings.length / 2)], p95Ms: timings[Math.floor(timings.length * .95)], baseRedraws: v.baseDrawCount - before,
      dpr: v.pixelRatio, backingPixels: v.canvas.width * v.canvas.height, draws: v.drawCount };
  });
  assert.equal(perf.baseRedraws, 0); assert.ok(perf.dpr <= 2); assert.ok(perf.p95Ms < 50, `rendering stalls: ${JSON.stringify(perf)}`);
  check('static-layer caching, capped backing resolution and measured animation pacing', { performance: perf });
  assert.deepEqual(errors, [], 'browser runtime and resource errors');
  await writeFile(path.join(output, 'browser-report.json'), JSON.stringify({ generatedAt: new Date().toISOString(), scope: process.argv.includes('--skip-geometry') ? 'flow-only' : 'complete', browser: browser.version(), results, errors }, null, 2) + '\n');
  console.log(`\n${results.length} browser checks passed; screenshots and report: design/review/`);
} catch (error) {
  if (currentPage && !currentPage.isClosed()) await currentPage.screenshot({ path: path.join(output, 'failure.png'), fullPage: true }).catch(() => {});
  await writeFile(path.join(output, 'browser-report.json'), JSON.stringify({ generatedAt: new Date().toISOString(), results, errors, failure: error.stack }, null, 2) + '\n');
  throw error;
} finally {
  await browser.close();
  await new Promise(resolve => server.close(resolve));
}
