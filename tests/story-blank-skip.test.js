/**
 * ★★ 2026-10-04 用户要求②（任务二）：**剧情正文页上点空白处＝点那一页的「继续」**。
 *
 * 由来（用户实测）：跳过那套判定当时只认**战斗界面**（`skipGate` 要求"正在战斗 + `#app` 可见"），
 * 所以剧情模式读小说那几页（`#storyStage` / `#storyStageBody` 那一套）点空白**没反应**。
 *
 * 这一份定四件事：
 *   ③ **判定与分派**（真调 `skipStoryBlank` + `isBlankClick`，最小假 DOM 按 index.html 搭出剧情页）：
 *      点正文空白处 → 调一次 `advance`；`advance` 就是 `#storyStageNext` 的 onclick，
 *      所以"点空白"与"点继续"两条路走的是**同一个函数**（＝推进 / 翻页 / 开打 / 完成本章都一致）。
 *   ④ **有主的点击照旧**：继续 / 返回标题按钮、按钮里的图标、对话框、卡片一律**不算空白**，
 *      `advance` 一次都不许被调；将来若真有"要玩家做选择"的一页，它也绝不会被空白点击确认。
 *   ⑤ **战斗里那三条通道一个字都没改**：台词（再点接下一句）/ 大字横幅（收起）/ 提示（收起），
 *      并且 `skipGate` 仍然**只认战斗界面**——这一条是**另一条独立闸门**，没有把它顶掉。
 *   另外守住"别的界面不受影响"：标题页 / 大厅 / 战斗 / 结算页（`#storyStage` 不在台面上）
 *   以及任何弹窗开着的时候，点哪儿都不跳。
 *
 * ⚠️ 假 DOM 只实现 `closest` / `contains`（`ui/skip.js` 只用得到这两个），
 *    `closest` 的支持范围＝SKIP_OWNED 里出现的那几类选择器（标签名 / `#id` / `[attr]` / `[attr="值"]`）。
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { SKIP_OWNED, SKIP_ORDER, createSkipper, isBlankClick, skipGate, skipStoryBlank } from '../src/ui/skip.js';
import { Game } from '../src/core/game.js';

const main = fs.readFileSync(new URL('../src/main.js', import.meta.url), 'utf8');
const html = fs.readFileSync(new URL('../index.html', import.meta.url), 'utf8');

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

/**
 * 按 index.html 搭一个剧情正文页：`#storyStage > header / .story-stage-main > article#storyStageBody / footer#storyStageNext`。
 * 结构与真页面一一对应，所以"哪一点算空白"在真假 DOM 上是同一套判定。
 */
function storyStageDom() {
  const stage = el('section', { id: 'storyStage' });
  const top = stage.append(el('header', { class: 'story-stage-top' }));
  const back = top.append(el('button', { id: 'storyBack' }));
  const label = top.append(el('span', { id: 'storyStageLabel' }));
  const main = stage.append(el('div', { class: 'story-stage-main' }));
  const script = main.append(el('article', { class: 'story-script' }));
  const eyebrow = script.append(el('p', { class: 'eyebrow', id: 'storyStageEyebrow' }));
  const heading = script.append(el('h2', { id: 'storyStageTitle' }));
  const body = script.append(el('div', { id: 'storyStageBody' }));
  const para = body.append(el('p'));                       // 正文那一段（点它就是"点空白处"）
  const rules = main.append(el('aside', { class: 'story-rules' }));
  const foot = stage.append(el('footer', { class: 'story-stage-foot' }));
  const hint = foot.append(el('span', { id: 'storyStageHint' }));
  const next = foot.append(el('button', { id: 'storyStageNext' }));   // 「继续 ▸」
  const arrow = next.append(el('span'));                   // 按钮里面那个小三角
  // 弹窗挂在页面顶层（不在 #storyStage 里），和一个"长在剧情页里的弹窗"各来一个
  const dialog = el('dialog', { id: 'resultDialog' });
  const innerDialog = stage.append(el('div', { role: 'dialog', id: 'storyChoice' }));
  return { stage, back, label, main, script, eyebrow, heading, body, para, rules, foot, hint, next, arrow, dialog, innerDialog };
}

/** 一条"继续"走完的状态机：真按钮与空白点击都调它，用来证明两条路效果一致。 */
function advanceRecorder() {
  const calls = [];
  const advance = () => { calls.push('advance'); };
  return { calls, advance };
}

// ===================== ③ 判定与分派：点空白 ＝ 点「继续」 =====================

test('③ 剧情正文页：点空白处＝调一次「继续」；与点按钮走的是同一个函数', () => {
  const dom = storyStageDom();
  const { calls, advance } = advanceRecorder();
  // 真页面里就是这个赋值：`$('storyStageNext').onclick = storyAdvance;`
  dom.next.onclick = advance;
  const click = (target, extra = {}) => skipStoryBlank({
    stageHidden: false, modalOpen: false, target, root: dom.stage, advance: dom.next.onclick, ...extra,
  });

  // 正文段落 / 页面留白 / 页眉 / 页脚 / 规则栏 / 标题：都算"点空白处" → 推进一步
  for (const [spot, why] of [[dom.para, '正文那一段'], [dom.body, '正文容器'], [dom.stage, '剧情页本身'],
    [dom.main, '中间那一栏'], [dom.script, '正文卡片'], [dom.foot, '页脚空白'], [dom.rules, '规则栏'],
    [dom.hint, '提示文字'], [dom.eyebrow, '眉题'], [dom.heading, '这一页的标题'], [dom.label, '章节名']]) {
    const before = calls.length;
    assert.equal(click(spot), true, `★ ${why}（${spot.tag}）应该算"点空白处"`);
    assert.equal(calls.length, before + 1, `★ ${why}：正好推进一次`);
  }
  // 「点空白」与「点继续」用的是同一个函数对象 → 效果逐值一致（推进 / 翻页 / 开打 / 完成本章）
  assert.equal(click(dom.para), true);
  const afterBlank = calls.length;
  dom.next.onclick();                                   // 玩家真的去点那颗按钮
  assert.equal(calls.length, afterBlank + 1, '★ 点按钮也是推进一次——两条路一模一样');
  assert.equal(dom.next.onclick, advance, '★ 空白点击用的必须就是按钮那一个 onclick（不是另写一套）');
  assert.equal(skipStoryBlank(), false, '什么都不给时判否（缺省一律不跳）');
});

test('③ 分派：`advance` 缺省时判否——绝不自己乱走一步（将来"要玩家选择"的页就靠这条）', () => {
  const dom = storyStageDom();
  assert.equal(skipStoryBlank({ stageHidden: false, target: dom.para, root: dom.stage }), false,
    '★ 没给 advance 时不许动（宁可不跳，也别猜）');
  assert.equal(skipStoryBlank({ stageHidden: false, target: dom.para, root: dom.stage, advance: null }), false);
  assert.equal(skipStoryBlank({ stageHidden: false, target: dom.para, root: dom.stage, advance: 'not a function' }), false);
  // 判定本身（纯函数）也要一致：点正文空白的返回值与 advance 在不在无关
  assert.equal(isBlankClick(dom.para, dom.stage), true);
});

// ===================== ④ 有主的点击照旧 / 别的界面不受影响 =====================

test('④ 剧情页上的按钮 / 对话框 / 卡片照旧走原逻辑（不被当成"空白"）', () => {
  const dom = storyStageDom();
  const { calls, advance } = advanceRecorder();
  dom.next.onclick = advance;
  const click = (target, extra = {}) => skipStoryBlank({
    stageHidden: false, modalOpen: false, target, root: dom.stage, advance, ...extra,
  });

  for (const [spot, why] of [[dom.next, '「继续」按钮本身'], [dom.arrow, '按钮里面的小三角'],
    [dom.back, '「返回标题」按钮'], [dom.innerDialog, '长在剧情页里的对话框']]) {
    assert.equal(click(spot), false, `★ ${why}：不算空白，照旧走它自己的分支`);
  }
  // 弹窗挂在**页面顶层**（不在 #storyStage 里）：压根不算这个 root 里的点击
  assert.equal(click(dom.dialog), false, '★ 结算弹窗不是剧情页里的空白');
  assert.equal(isBlankClick(dom.next, dom.stage), false);
  // ★ 有弹窗开着（结算 / 认输与重开确认框 / 菜单 / 规则）：点哪儿都不跳
  assert.equal(click(dom.para, { modalOpen: true }), false, '★ 弹窗开着时点空白也不跳（玩家必须去点按钮）');
  assert.equal(calls.length, 0, '★ 上面这些一次都不许调 advance —— 空白点击不能替玩家做选择、也不能抢按钮的活');
});

test('④ 别的界面照旧：标题页 / 章节列表 / 大厅 / 战斗 / 结算页点空白都不跳', () => {
  const dom = storyStageDom();
  const { calls, advance } = advanceRecorder();
  // `#storyStage` 不在台面上（showScreen 会给它挂 hidden）＝ 上面那些界面
  for (const why of ['标题页', '章节列表', '选人页 / 大厅', '战斗界面', '结算页']) {
    assert.equal(skipStoryBlank({ stageHidden: true, target: dom.para, root: dom.stage, advance }), false,
      `★ ${why}：点空白不跳`);
  }
  // `#storyStage` 元素根本不存在时（＝不在剧情页）也必须判否——`hidden` 读不到就是"不在台面上"
  assert.equal(skipStoryBlank({ stageHidden: undefined, target: dom.para, root: null, advance }), false);
  assert.equal(calls.length, 0, '★ 别的界面一次都不许被推到');
  // 真页面里那两条闸门（弹窗 / 结算页）也照旧存在
  assert.match(main, /const modalOpen = \(\) => !!document\.querySelector\('dialog\[open\]'\)/);
  assert.match(html, /<dialog id="resultDialog"[^>]*>/, '结算页必须是 dialog');
  assert.match(html, /<dialog id="confirmDialog"[^>]*>/, '认输 / 重开的确认框必须是 dialog');
});

test('④ 接线（静态）：剧情页那条闸门挂在既有的全局点击处理里，且按钮分派一个字没改、跳过不许提前 return', () => {
  const start = main.indexOf("document.addEventListener('click', event => {");
  const handler = main.slice(start, main.indexOf("const button = event.target.closest('button');"));
  assert.ok(start > 0 && handler.length, 'main.js 里要有那个全局点击处理');
  // 判定接在既有处理里：剧情页在台面上 + 没弹窗 + 点在空白处 + 分派给「继续」
  assert.match(handler, /skipStoryBlank\(\{/, '★ 剧情页那条判定要接在既有的全局点击处理里');
  for (const line of ["stageHidden: $('storyStage')?.hidden !== false", 'modalOpen: modalOpen()',
    'target: event.target', "root: $('storyStage')", 'advance: storyAdvance,']) {
    assert.ok(handler.includes(line), `判定里缺 ${line}`);
  }
  // ★ 空白点击调的必须是**按钮那一个同名函数**（两处都写 `storyAdvance`），不是另写一套逻辑
  assert.match(main, /const storyNext = \$\(\'storyStageNext\'\);\s*\n\s*if \(storyNext\) storyNext\.onclick = storyAdvance;/,
    '★ 「继续」按钮的 onclick 必须就是 storyAdvance');
  assert.match(main, /function storyAdvance\(\) \{[\s\S]*?startStoryMatch\(\);[\s\S]*?showStoryStage\(storyRead\.chapter, storyView\.nextIndex\);[\s\S]*?markStoryCleared\(chapter\.id\); showStoryMenu\(\);/,
    '★ storyAdvance 里三种动作（开打 / 翻页 / 完成本章）都要在');
  assert.equal(/storyStageNext'\)\.onclick = \(\) =>/.test(main), false, '旧的匿名回调该被 storyAdvance 取代');
  // 原来的按钮分派：**一个字都没改**，而且跳过**不会 return 掉它**
  assert.match(main, /const button = event\.target\.closest\('button'\);\s*\n\s*if \(!button\) return;/,
    '★ 按钮分派的第一行必须原样留着');
  assert.equal(/skipStoryBlank\(\{[\s\S]{0,400}?\}\);\s*\n\s*return /.test(handler), false,
    '★ 剧情页跳过之后不许提前 return（会吃掉下面按钮分派那些分支）');
  assert.equal(/skipPresentation\(\);\s*\n\s*return/.test(handler), false, '（战斗那条也一样）');
});

// ===================== ⑤ 战斗内那三条通道：行为一个字都没改 =====================

test('⑤ 战斗三条通道照旧：台词再点接下一句 / 横幅收起 / 提示收起，且只收一样', () => {
  assert.deepEqual(SKIP_ORDER, ['bark', 'banner', 'notice'], '优先顺序没变');
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
  assert.equal(current, '第二句', '★ 点一下只收这一条，队列没清空');
  assert.equal(banner.show, true);
  assert.equal(notice, '移动完成，剩余 2 AP');
  assert.equal(skip(), 'bark');
  assert.equal(current, '第三句', '★ 再点接下一句');
  assert.equal(skip(), 'bark');
  assert.equal(skip(), 'banner', '台词没了才收横幅');
  assert.equal(banner.show, false);
  assert.equal(skip(), 'notice', '再一下收提示');
  assert.equal(notice, null);
  assert.equal(skip(), null, '什么都没在播时什么都不做');
  assert.deepEqual(calls, ['bark:第一句', 'bark:第二句', 'bark:第三句', 'banner', 'notice']);
});

test('⑤ 战斗那条闸门没有被顶掉：`skipGate` 仍然只认战斗界面（剧情页那一条是另一条独立闸门）', () => {
  const app = el('main', { id: 'app' });
  const blank = app.append(el('div'));
  const ok = extra => skipGate({ inBattle: true, appHidden: false, modalOpen: false, target: blank, root: app, ...extra });
  assert.equal(ok({}), true, '战斗界面 + 没弹窗 + 点在空白处 ＝ 跳（一个字都没改）');
  assert.equal(ok({ modalOpen: true }), false, '★ 结算弹窗 / 确认框开着时照旧不跳');
  assert.equal(ok({ inBattle: false }), false, '★ `skipGate` 仍然只认战斗界面（剧情页不归它管，归 skipStoryBlank）');
  // 剧情页那一条**不是** skipGate 的替代品：两个函数是分开的，调用处也分开
  assert.notEqual(skipStoryBlank, skipGate);
  assert.equal(/skipStoryBlank\(/.test(main) && /if \(skipGate\(\{/.test(main), true, '两条闸门各自都在 main.js 里');
  // 台词那条与"自己播完"共用收尾、横幅清计时器、提示走引擎——这三条照旧（既有 7 条测试也钉着）
  const skipper = main.slice(main.indexOf('const skipPresentation = createSkipper({'), main.indexOf('function showTurnBanner'));
  for (const channel of ['bark:', 'banner:', 'notice:']) assert.ok(skipper.includes(channel), `缺通道 ${channel}`);
  assert.match(skipper, /finishBarkLine\(\);/, '★ 台词那条与"它自己播完"共用同一条收尾逻辑');
  assert.match(skipper, /clearTimeout\(stageBannerTimer\); stageBannerTimer = null;/);
  assert.match(skipper, /game\.dismissNotice\(\)/);
  // 键盘照旧一个键都不抢（Space 仍然是结束回合）
  const keydown = main.slice(main.indexOf("document.addEventListener('keydown', event => {"),
    main.indexOf("window.addEventListener('online', updateConnection)"));
  assert.ok(keydown.includes("event.code === 'Space'"), '（切片要真的圈住那个键盘处理）');
  assert.equal(/skipStoryBlank|skipGate|skipPresentation/.test(keydown), false, '★ 键盘那条路上不许出现"跳过"');
});

test('⑤ 提示通道本身照旧：dismissNotice 不影响对局数值', () => {
  const game = new Game({ random: () => 0.5 });
  game.start('jotaro', 'dio', 'ai');
  const before = { hp: { ...game.s.hp }, ap: { ...game.s.ap }, log: game.s.log.length, revision: game.revision };
  assert.equal(game.dismissNotice(), true, '开局那条提示能收掉');
  assert.equal(game.dismissNotice(), false, '本来就没有提示时返回 false');
  assert.deepEqual(game.s.hp, before.hp);
  assert.deepEqual(game.s.ap, before.ap);
  assert.equal(game.s.log.length, before.log);
  assert.equal(game.revision, before.revision);
});

// ===================== 白名单没被动过（补一条总量核对） =====================

test('SKIP_OWNED 照旧包含"有主"的那几类（剧情页那条闸门复用了它，没有偷偷放宽）', () => {
  const owned = SKIP_OWNED.split(',').map(s => s.trim());
  for (const must of ['button', 'a[href]', 'input', 'canvas', 'dialog', '[role="dialog"]',
    '[data-story-page]', '[data-story-jump]', '#bark', '#stageBanner', '#cutin']) {
    assert.ok(owned.includes(must), `SKIP_OWNED 里必须有 ${must}`);
  }
  assert.equal(owned.includes('section'), false, '★ 剧情页那个 <section> 本身要留成"空白"（点它就是继续）');
});
