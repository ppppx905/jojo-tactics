/**
 * ★★ 2026-10-03 用户要求①：**在战斗界面点空白处＝跳过正在播的对话与提示**。
 *
 * 这一份定四件事（前两件是运行时真跑，后两件是接线静态检查）：
 *   ① **判定**：点空白处才算"空白"——按钮 / 棋子 / 棋盘格 / 对话框 / 弹窗一律不算
 *      （`isBlankClick`，用最小假 DOM 真调）；
 *   ② **闸门**：结算弹窗 / 认输与重开的确认框 / 剧情阅读页里要做选择的地方**一律不跳**
 *      （`skipGate`，逐条钉住）；
 *   ③ **分派**：点一下只收一样（台词 → 大字横幅 → 提示），**台词再点才接下一句**（不是一次全清）；
 *   ④ **接线**：这三条挂在 main.js 既有的全局点击处理里，且**动都没动**原来的按钮 / 棋盘分支；
 *      键盘一个键都不抢（Space 仍然是结束回合）。
 *
 * ⚠️ 假 DOM 只实现 `closest` / `contains` 两个方法（`ui/skip.js` 只用得到这两个），
 *    `closest` 的支持范围＝SKIP_OWNED 里出现的那几类选择器（标签名 / `[attr]` / `[attr="值"]`）。
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { Game } from '../src/core/game.js';
import { SKIP_OWNED, SKIP_ORDER, isBlankClick, skipGate, createSkipper } from '../src/ui/skip.js';

const main = fs.readFileSync(new URL('../src/main.js', import.meta.url), 'utf8');
const html = fs.readFileSync(new URL('../index.html', import.meta.url), 'utf8');
const css = fs.readFileSync(new URL('../src/ui/layout.css', import.meta.url), 'utf8');
function seeded(seed = 13) { return () => ((seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0) / 4294967296); }

// ===================== 最小假 DOM =====================

/** 只匹配 SKIP_OWNED 里出现的那几类：`button` / `a[href]` / `[data-unit]` / `[role="dialog"]` / `#bark`。 */
function matches(el, selector) {
  return selector.split(',').map(part => part.trim()).filter(Boolean).some(token => {
    const [, tag, id, key, value] = token.match(/^([a-z0-9]*)(?:#([\w-]+))?(?:\[([\w-]+)(?:="([^"]*)")?\])?$/i) || [];
    if (!tag && !id && !key) return false;
    if (tag && el.tag !== tag.toLowerCase()) return false;
    if (id && el.attrs.id !== id) return false;
    if (!key) return true;
    if (!(key in el.attrs)) return false;
    return value === undefined || String(el.attrs[key]) === value;
  });
}
/** 一个假元素：`append` 建父子关系，`closest` 往自己与祖先上找，`contains` 往子孙里找。 */
function el(tag, attrs = {}) {
  const node = {
    tag: tag.toLowerCase(), attrs, parent: null, children: [],
    closest(selector) { for (let n = node; n; n = n.parent) if (matches(n, selector)) return n; return null; },
    contains(other) { for (let n = other; n; n = n.parent) if (n === node) return true; return false; },
    append(child) { child.parent = node; node.children.push(child); return child; },
  };
  return node;
}

// ===================== ① 判定：什么算"空白" =====================

test('① 判定：只有"没主"的地方才算空白——按钮 / 棋子 / 棋盘格 / 对话框 / 弹窗一律不算', () => {
  // 结构照 index.html：`#app > .arena > #boardWell > canvas#board`，两翼是角色卡，弹窗挂在顶层
  const app = el('main', { id: 'app' });
  const arena = app.append(el('section', { class: 'arena' }));
  const well = arena.append(el('div', { id: 'boardWell' }));
  const canvas = well.append(el('canvas', { id: 'board' }));
  const banner = well.append(el('div', { id: 'stageBanner' }));
  const bark = well.append(el('div', { id: 'bark' }));
  const blank = arena.append(el('div', { class: 'some-gap' }));
  const bay = app.append(el('aside', { class: 'fighter-bay' }));
  const card = bay.append(el('button', { 'data-unit': 'p1-stand' }));
  const cardArt = card.append(el('img'));                      // 按钮里面的小图：也要算"按钮的"
  const skillBtn = bay.append(el('button', { 'data-inspect-skill': 'ora' }));
  const dialog = app.append(el('dialog', { id: 'resultDialog' }));
  const dialogBtn = dialog.append(el('button', { id: 'rematchBtn' }));
  const outside = el('body');                                  // 不在 #app 里（页面背景）

  // 算"空白"的：.arena / #app 自己、两翼的空隙、任何没主的 div
  for (const spot of [app, arena, blank, well]) {
    assert.equal(isBlankClick(spot, app), true, `${spot.tag}#${spot.attrs.id || ''} 应该算空白`);
  }
  // 算"有主"的：棋盘、按钮（含它里面的图）、棋子卡、技能钮、弹窗与它的按钮、页面背景
  for (const [spot, why] of [[canvas, '棋盘格各有各的语义（选择 / 移动 / 攻击）'],
    [card, '棋子卡'], [cardArt, '按钮里面的东西'], [skillBtn, '技能钮'],
    [dialog, '结算弹窗'], [dialogBtn, '结算弹窗里的按钮'], [outside, '不在 #app 里'],
    [banner, '大字横幅本身'], [bark, '台词框']]) {
    assert.equal(isBlankClick(spot, app), false, `${why} 不该被当成"空白"`);
  }
  // 不在 root 里 / 拿不到 closest / 空值：一律判否（宁可不跳，也别猜）
  assert.equal(isBlankClick(blank, null), false);
  assert.equal(isBlankClick(null, app), false);
  assert.equal(isBlankClick({}, app), false, '不是元素（没有 closest）时判否');
  // 白名单里那三条最要紧的必须在内（漏掉任何一条就等于抢了别人的点击语义）
  for (const must of ['canvas', 'button', 'dialog']) {
    assert.ok(SKIP_OWNED.split(',').map(s => s.trim()).includes(must), `SKIP_OWNED 里必须有 ${must}`);
  }
});

// ===================== ② 闸门：什么时候一律不跳 =====================

test('② 闸门：结算弹窗 / 确认框 / 剧情阅读页 一律不跳；战斗里的空白处才跳', () => {
  const app = el('main', { id: 'app' });
  const blank = app.append(el('div'));
  const ok = extra => skipGate({ inBattle: true, appHidden: false, modalOpen: false, target: blank, root: app, ...extra });
  assert.equal(ok({}), true, '战斗界面 + 没弹窗 + 点在空白处 ＝ 跳');
  // 三种"不许跳"：弹窗开着（结算 / 认输与重开的确认框 / 菜单 / 规则）、不在战斗界面（剧情阅读页、
  // 选人页、标题页、章节列表）、#app 根本没显示
  assert.equal(ok({ modalOpen: true }), false, '★ 结算弹窗（或确认框）开着时一律不跳');
  assert.equal(ok({ inBattle: false }), false, '★ 剧情阅读页里要玩家做选择的地方不跳');
  assert.equal(ok({ appHidden: true }), false, '不在战斗界面时也不跳');
  // 点在"有主"的东西上：即便在战斗里也不算空白
  const card = app.append(el('button', { 'data-unit': 'p1-user' }));
  const canvas = app.append(el('canvas', { id: 'board' }));
  assert.equal(ok({ target: card }), false, '★ 点棋子 / 按钮时不跳（照旧走它自己的分支）');
  assert.equal(ok({ target: canvas }), false, '★ 点棋盘格时不跳');
  assert.equal(skipGate(), false, '什么都不给时判否（缺省一律不跳）');
  // 结算页与确认框在真页面里就是 dialog —— 这两条一起守住"不会被跳过"
  assert.match(html, /<dialog id="resultDialog"[^>]*>/, '结算页必须是 dialog');
  assert.match(html, /<dialog id="confirmDialog"[^>]*>/, '认输 / 重开的确认框必须是 dialog');
  assert.match(main, /const modalOpen = \(\) => !!document\.querySelector\('dialog\[open\]'\)/);
});

// ===================== ③ 分派：点一下只收一样 =====================

test('③ 分派：点一下收一样（台词 → 横幅 → 提示），台词**再点才接下一句**、不是一次全清', () => {
  assert.deepEqual(SKIP_ORDER, ['bark', 'banner', 'notice'], '优先顺序：台词 → 大字横幅 → 提示');
  // 一个极小的"正在播什么"的状态机：台词是队列，横幅挂着，提示是那行字
  const queue = ['第一句', '第二句', '第三句'];
  let current = queue.shift();
  const banner = { show: true };
  let notice = '移动完成，剩余 2 AP';
  const calls = [];
  const skip = createSkipper({
    bark: () => { if (!current) return false; calls.push(`bark:${current}`); current = queue.shift() || null; return true; },
    banner: () => { if (!banner.show) return false; calls.push('banner'); banner.show = false; return true; },
    notice: () => { if (!notice) return false; calls.push('notice'); notice = null; return true; },
  });

  assert.equal(skip(), 'bark');
  assert.equal(current, '第二句', '★ 点一下只是"这条跳过了"，**队列没有清空**');
  assert.equal(banner.show, true, '同时挂着的大字横幅这一下不动它');
  assert.equal(notice, '移动完成，剩余 2 AP', '提示也还在');
  assert.equal(skip(), 'bark');
  assert.equal(current, '第三句', '★ 再点继续下一条');
  assert.equal(skip(), 'bark');
  assert.equal(current, null, '★ 最后一条收掉后队列空了');
  assert.equal(skip(), 'banner', '台词没了 → 这一下收大字横幅');
  assert.equal(banner.show, false);
  assert.equal(skip(), 'notice', '再一下 → 收提示');
  assert.equal(notice, null);
  assert.equal(skip(), null, '★ 什么都没在播时什么都不做（不报错、不乱清）');
  assert.deepEqual(calls, ['bark:第一句', 'bark:第二句', 'bark:第三句', 'banner', 'notice']);

  // 通道缺省（main.js 可以只注入关心的那几条）与"没收掉就不停手"这两条口径
  assert.equal(createSkipper({})() , null, '一条通道都没有时返回 null');
  const onlyNotice = createSkipper({ notice: () => { notice = null; return true; } });
  assert.equal(onlyNotice(), 'notice', '只挂了提示时也能跳');
  const never = createSkipper({ bark: () => false, notice: () => { notice = null; return true; } });
  assert.equal(never(), 'notice', '前面那条说"我没收掉"时继续往下问');
});

// ===================== ④ 接线：三条通道与原来的分支 =====================

test('④ 接线（静态）：跳过只挂在既有的全局点击处理里，且按钮 / 棋盘那几条分支一个字没改', () => {
  const start = main.indexOf("document.addEventListener('click', event => {");
  const handler = main.slice(start, main.indexOf("const button = event.target.closest('button');"));
  assert.ok(start > 0 && handler.length, 'main.js 里要有那个全局点击处理');
  // 判定接在既有处理里：进战斗 + #app 在台面上 + 没有弹窗 + 点在空白处
  assert.match(handler, /if \(skipGate\(\{/, '★ 点空白处那条判定要接在既有的全局点击处理里');
  for (const line of ["inBattle: game.s.phase === 'battle'", 'appHidden: !!$(\'app\')?.hidden',
    'modalOpen: modalOpen()', 'target: event.target', 'root: $(\'app\')']) {
    assert.ok(handler.includes(line), `判定里缺 ${line}`);
  }
  assert.match(handler, /\}\)\) skipPresentation\(\);/, '★ 判定通过才调跳过');
  // 原来的按钮分派：**一个字都没改**，而且跳过**不会 return 掉它**
  assert.match(main, /const button = event\.target\.closest\('button'\);\s*\n\s*if \(!button\) return;/,
    '★ 按钮分派的第一行必须原样留着');
  assert.match(main, /else if \(button\.dataset\.command\) commandClick\(button\.dataset\.command, button\);/,
    '★ 技能/移动/攻击按钮照旧走 commandClick');
  assert.match(main, /else if \(button\.dataset\.unit\) selectFromCard\(button\.dataset\.unit\);/,
    '★ 棋子卡照旧走 selectFromCard');
  assert.equal(/skipPresentation\(\);\s*\n\s*return/.test(handler), false, '跳过之后不许提前 return（会吃掉按钮分支）');
  // 棋盘自己的点击语义照旧（那条处理在 board 上，不在 document 上）
  assert.match(main, /board\.addEventListener\('click', event => \{[\s\S]*?game\.actionAt\(t\);/, '★ 棋盘点击语义一字未动');
  // 键盘不受影响：Space 仍然是"结束回合"，且**键盘那条路上根本没有"跳过"这回事**
  assert.match(main, /event\.code === 'Space' && !event\.target\.closest\('button'\)\) \{ event\.preventDefault\(\); requestEndTurn\(\); \}/,
    '★ Space 仍然是结束回合');
  const keydown = main.slice(main.indexOf("document.addEventListener('keydown', event => {"),
    main.indexOf("window.addEventListener('online', updateConnection)"));
  assert.ok(keydown.includes("event.code === 'Space'"), '（切片要真的圈住那个键盘处理）');
  assert.equal(/skipGate|skipPresentation/.test(keydown), false,
    '★ 键盘那条路上不许出现"跳过"——按键一点都不抢');
});

test('④ 接线（静态）：三条通道各自把计时器清掉，台词那条与"自己播完"共用收尾', () => {
  const start = main.indexOf('const skipPresentation = createSkipper({');
  const skipper = main.slice(start, main.indexOf('function showTurnBanner'));
  assert.ok(start > 0, 'main.js 里要有 skipPresentation');
  for (const channel of ['bark:', 'banner:', 'notice:']) assert.ok(skipper.includes(channel), `缺通道 ${channel}`);
  assert.match(skipper, /finishBarkLine\(\);/, '★ 台词那条要与"它自己播完"共用同一条收尾逻辑');
  assert.match(skipper, /clearTimeout\(stageBannerTimer\); stageBannerTimer = null;/,
    '★ 大字横幅那条要清掉自己的 2.6 秒计时器（不然过一秒又冒出来）');
  assert.match(skipper, /game\.dismissNotice\(\)/, '★ 提示那条走引擎的 dismissNotice');
  // 收尾逻辑本身：计时器清掉 + 收起框 + 接下一句 / 放结算
  const finish = main.slice(main.indexOf('function finishBarkLine()'), main.indexOf('function finishBarkLine()') + 700);
  assert.match(finish, /clearTimeout\(barkTimer\); barkTimer = null;/, '★ 必须清计时器');
  assert.match(finish, /if \(barkQueue\.length\) \{ pumpBarkQueue\(\); return; \}/, '★ 有下一句就接着播');
  assert.match(finish, /pendingResult/, '★ 队列空了仍然要把等着的结算放出来');
  // 台词自己播完也走同一个收尾（否则"跳过"与"播完"会走岔）
  assert.match(main, /barkTimer = setTimeout\(finishBarkLine, ms\);/, '★ 计时器到点也要走 finishBarkLine');
  // 被推翻的那条老写法（内联匿名回调）不该还在
  assert.equal(/barkTimer = setTimeout\(\(\) => \{/.test(main), false, '旧的匿名回调已被 finishBarkLine 取代');
});

test('④ 提示语：界面上有一句很小的「点空白处跳过」，且不是教学页', () => {
  assert.match(html, /<span class="skip-hint"[^>]*>点空白处跳过演出<\/span>/, '棋盘图例里要有一句');
  assert.match(main, /<span class="skip-hint">点空白处跳过<\/span>/, '★ 台词框里也要挂一句');
  assert.match(css, /\.skip-hint \{/, '缺 .skip-hint 的样式');
  assert.match(css, /\.board-legend > \.skip-hint \{ margin-top: 0; \}/, '图例里那一行要跟其它图例同排');
  // 只是"一句提示"：别把它做成弹窗 / 大段教程
  assert.equal(/dialog[^>]*skip/i.test(html), false, '不该给它做一个弹窗');
});

// ===================== 提示（notice）本身：收掉它不改变对局 =====================

test('提示：dismissNotice 收掉那行提示，且对局任何数值都不动', () => {
  const game = new Game({ random: seeded(13) });
  game.start('jotaro', 'dio', 'ai');
  assert.equal(game.s.notice?.text, '选择己方使者或替身，开始行动。', '开局就有一条提示（可被收掉的那种）');
  const before = { hp: { ...game.s.hp }, ap: { ...game.s.ap }, log: game.s.log.length, revision: game.revision };
  assert.equal(game.dismissNotice(), true);
  assert.equal(game.s.notice, null, '★ 提示收起来了');
  assert.equal(game.dismissNotice(), false, '★ 本来就没有提示时返回 false（界面据此什么都不做）');
  assert.deepEqual(game.s.hp, before.hp);
  assert.deepEqual(game.s.ap, before.ap);
  assert.equal(game.s.log.length, before.log, '★ 收掉一条提示不该进战斗记录');
  assert.equal(game.revision, before.revision, '★ 也不该让 revision 动（纯呈现状态，不是对局状态）');
  // 收掉之后照旧能有新提示盖上来
  game.notice('移动完成，剩余 2 AP。');
  assert.equal(game.s.notice?.text, '移动完成，剩余 2 AP。');
  assert.equal(game.s.notice?.level, 'hint');
  assert.equal(game.dismissNotice(), true);
  game.fail('行动点不足，请结束回合；时间停止不消耗行动点。');
  assert.equal(game.s.notice?.level, 'warn', '（fail 那种警告提示也照样能收掉）');
  assert.equal(game.dismissNotice(), true);
  assert.equal(game.s.notice, null);
});
