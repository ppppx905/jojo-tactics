/**
 * HUD 回归：行动点显示必须在「结算行动的那一刻」就刷新，不能等玩家再点一次角色。
 *
 * 复现方式：用最小假 DOM 真调 renderCards / renderActions，
 * 走完「选中 → 点技能 → 点敌人」的完整序列，逐步检查 #apDisplay 的文本。
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { Game, SKILLS } from '../src/core/game.js';

/** 最小假 DOM：只实现 HUD 用到的那几个 API。 */
function fakeDom() {
  const elements = new Map();
  const make = id => {
    const el = {
      id, innerHTML: '', textContent: '', className: '', disabled: false, hidden: false, value: '', style: {},
      dataset: {}, attributes: {},
      classList: { toggle() {}, add() {}, remove() {}, contains: () => false },
      setAttribute(k, v) { this.attributes[k] = String(v); },
      getAttribute(k) { return this.attributes[k] ?? null; },
      hasAttribute(k) { return k in this.attributes; },
      removeAttribute(k) { delete this.attributes[k]; },
      addEventListener() {}, removeEventListener() {}, focus() {}, blur() {}, closest: () => null,
      querySelector: () => make(id + '-child'),
      querySelectorAll: () => [],
      insertAdjacentHTML(_, html) { this.innerHTML += html; },
      appendChild() {}, contains: () => true, getBoundingClientRect: () => ({ left: 0, top: 0, width: 100, height: 100, bottom: 100, right: 100 }),
    };
    return el;
  };
  const document = {
    getElementById: id => { if (!elements.has(id)) elements.set(id, make(id)); return elements.get(id); },
    querySelector: () => make('query'),
    querySelectorAll: () => [],
    createElement: () => make('created'),
    addEventListener() {}, removeEventListener() {},
    activeElement: null, body: make('body'),
  };
  return { document, elements, get: id => document.getElementById(id) };
}

async function withDom(run) {
  const previous = globalThis.document;
  const dom = fakeDom();
  globalThis.document = dom.document;
  try { return await run(dom); } finally {
    if (previous === undefined) delete globalThis.document; else globalThis.document = previous;
  }
}

/** 从 #apDisplay 的 HTML 里取出「剩余 / 总数」。 */
const apText = el => [...el.innerHTML.matchAll(/>(\d+)<small> \/ (\d+)</g)].map(m => `${m[1]}/${m[2]}`).pop();

test('乔瑟夫放完技能后，行动点显示当场就要更新（不需要再点一次角色）', async () => {
  await withDom(async dom => {
    const { renderCards, renderActions } = await import('../src/ui/hud.js');
    const game = new Game({ random: () => .5 });
    game.start('joseph', 'jotaro');
    game.s.terrain = {};
    const me = game.unit('p1-user'), foe = game.unit('p2-stand');
    Object.assign(me, { row: 4, col: 4 });
    Object.assign(foe, { row: 4, col: 6 });

    const paint = () => { renderCards(game, { humanTurn: true }); renderActions(game, { humanTurn: true, busy: false }); };

    paint();
    assert.equal(apText(dom.get('apDisplay')), '3/3', '开局行动点');

    game.select(me.id); paint();
    assert.equal(game.beginSkill(me, 'vine'), true); paint();
    assert.equal(apText(dom.get('apDisplay')), '3/3', '瞄准阶段不扣');

    // 点敌人：这一刻 AP 从 3 变 2，界面必须立刻反映
    assert.equal(game.actionAt(game.tile(foe)), true);
    paint();
    assert.equal(game.s.ap.p1, 3 - SKILLS.vine.cost, '规则层已扣 1 AP');
    assert.equal(apText(dom.get('apDisplay')), '2/3', '界面必须立刻显示 2/3，而不是停留在 3/3');

    // 波纹：5 → 3（连上限一起改，模拟"卸甲"之类会改变行动点总量的情况）
    game.s.cd.p1.hamon = 0; game.s.ap.p1 = 5; game.s.turnAP.p1 = 5; paint();
    game.select(me.id); assert.ok(game.beginSkill(me, 'hamon')); paint();
    assert.equal(apText(dom.get('apDisplay')), '5/5', '瞄准阶段不扣');
    assert.ok(game.actionAt(game.tile(foe)));
    paint();
    assert.equal(apText(dom.get('apDisplay')), '3/5', '点敌人那一刻立刻变成 3/5');
  });
});

test('对照：其他角色（波鲁纳雷夫）同样在结算那一刻刷新', async () => {
  await withDom(async dom => {
    const { renderCards, renderActions } = await import('../src/ui/hud.js');
    const game = new Game({ random: () => .5 });
    game.start('polnareff', 'dio');
    game.s.terrain = {};
    const stand = game.unit('p1-stand'), foe = game.unit('p2-user');
    Object.assign(stand, { row: 4, col: 4 });
    Object.assign(foe, { row: 4, col: 5 });
    const paint = () => { renderCards(game, { humanTurn: true }); renderActions(game, { humanTurn: true, busy: false }); };
    game.select(stand.id); paint();
    assert.equal(apText(dom.get('apDisplay')), '3/3');
    assert.ok(game.attack(stand, foe));
    paint();
    assert.equal(apText(dom.get('apDisplay')), '2/3');
  });
});

/** 取出选人界面里「标题 + 替身名」那一段（不能整个 innerHTML 去搜，角色列表的 aria-label 里也带替身名）。 */
const draftHeading = html => html.match(/<div class="draft-detail-heading">(.*?)<\/div>/s)?.[1] ?? '';

test('选人界面：乔瑟夫是单单位角色，但他有替身「隐者之紫」，不能写成"无替身"', async () => {
  await withDom(async dom => {
    const { renderDraft } = await import('../src/ui/hud.js');
    const { FIGHTERS } = await import('../src/core/game.js');

    renderDraft({ p1: 'joseph', p2: 'jotaro', mode: 'ai' });
    const heading = draftHeading(dom.get('draftP1').innerHTML);
    assert.match(heading, /隐者之紫/, '要把他的替身名写出来（技能 vine 的喊声就是 HERMIT PURPLE）');
    assert.ok(!heading.includes('无替身'), '★ 绝不能标成"无替身"');
    assert.match(heading, /只有本体/, '同时要说明这场没有替身棋子');

    // 数据的两个字段必须同时存在：standName 有名字、stand 仍然是 null（没有棋子）
    assert.equal(FIGHTERS.joseph.standName, '隐者之紫');
    assert.equal(FIGHTERS.joseph.stand, null, 'stand 仍为 null：他确实没有替身棋子');

    // 对照：真正双单位的角色不受影响
    renderDraft({ p1: 'iggy', p2: 'jotaro', mode: 'ai' });
    assert.match(draftHeading(dom.get('draftP1').innerHTML), /愚者/);
  });
});

test('选人界面：单单位角色的行动提示不能写"先选择替身"', async () => {
  await withDom(async dom => {
    const { renderActions } = await import('../src/ui/hud.js');
    const game = new Game({ random: () => .5 });
    game.start('joseph', 'jotaro');
    game.s.terrain = {};
    renderActions(game, { humanTurn: true, busy: false });
    // 没选中任何单位时，普攻按钮的提示要是中性的（按钮渲染在 #skillbar 里）
    const bar = dom.get('skillbar').innerHTML;
    assert.ok(bar.includes('先选择单位'), '提示应对所有角色通用');
    assert.ok(!bar.includes('先选择替身'), '乔瑟夫没有替身可选');
  });
});

test('选人界面：剧情 boss（灰塔）不出现在角色列表里，角色数量也不含他', async () => {
  await withDom(async dom => {
    const { renderDraft } = await import('../src/ui/hud.js');
    renderDraft({ p1: 'jotaro', p2: 'dio', mode: 'ai' });
    const html = dom.get('draftP1').innerHTML;
    assert.equal(html.includes('data-fighter="gray_fly"'), false, '★ boss 不能被选中');
    assert.match(html, /data-fighter="iggy"/, '对照：正常角色要在列表里');
    // ⚠️ 2026-10-03 第三条用户拍板：第八章的**皇帝（emperor）改成了 PvP 可选角色**，
    //    所以"可选角色"由 7 名变 8 名（灰塔仍然不在列表里，上面那条断言没动）。
    assert.match(dom.get('buildTag').textContent, /共 9 名角色/, '★ 角色数量提示不该把 boss 算进去（现在是 9 名：多了皇帝与东方仗助）');
  });
});

test('试玩开关（?unlock=all）：章节列表全解锁且明确标出"试玩模式"', async () => {
  await withDom(async dom => {
    const { renderStoryMenu } = await import('../src/ui/hud.js');
    const { storyRoadmap } = await import('../src/ui/story.js');
    const { STORY_CHAPTERS } = await import('../src/core/game.js');
    const rows = storyRoadmap();
    const openChapters = () => [...dom.get('storyChapters').innerHTML.matchAll(/data-story-chapter="(\d+)"/g)].map(m => Number(m[1]));

    // 试玩模式：已做好的章节全部可点（未做的故事弧仍然不可点）
    renderStoryMenu(rows, { cleared: STORY_CHAPTERS.map(c => c.id), trialAll: true });
    assert.deepEqual(openChapters(), STORY_CHAPTERS.map((_, i) => i), '★ 试玩模式下每章都能直接进');
    assert.match(dom.get('storyChapters').innerHTML, /story-trial/);
    assert.match(dom.get('storyChapters').innerHTML, /试玩模式 · 全解锁/,
      '★ 必须显眼标出这是试玩模式，否则会以为解锁规则坏了');

    // 关掉开关就回到正常规则
    renderStoryMenu(rows, { cleared: [], trialAll: false });
    assert.deepEqual(openChapters(), [0], '关掉之后只有第一章能进');
    assert.doesNotMatch(dom.get('storyChapters').innerHTML, /story-trial/);
  });
});

test('剧情章节列表：第一章永远能进，第二章要等第一章通关后才解锁', async () => {
  await withDom(async dom => {
    const { renderStoryMenu } = await import('../src/ui/hud.js');
    const { storyRoadmap } = await import('../src/ui/story.js');
    const rows = storyRoadmap();
    const openChapters = () => [...dom.get('storyChapters').innerHTML.matchAll(/data-story-chapter="(\d+)"/g)].map(m => Number(m[1]));

    // 什么都没通关：只有第一章能点
    renderStoryMenu(rows, { cleared: [] });
    assert.deepEqual(openChapters(), [0], '★ 没通关第一章之前，第二章不该能点');

    // 通关第一章：第二章解锁
    renderStoryMenu(rows, { cleared: ['chapter-1'] });
    assert.deepEqual(openChapters(), [0, 1], '★ 通关第一章后第二章解锁');

    // 通关第二章：解开的是**第三章**；而第二章自己不会因为"自己已通关"就解开
    //（旧规则只看"这一章自己通关了"，会让每一章都永远打不开——见文档陷阱 21）
    renderStoryMenu(rows, { cleared: ['chapter-2'] });
    assert.deepEqual(openChapters(), [0, 2], '★ 通关第二章解开第三章；第二章自己仍要等第一章');

    // 通关第三章：解开的是**第四章**；第三章自己仍要等第二章
    renderStoryMenu(rows, { cleared: ['chapter-3'] });
    assert.deepEqual(openChapters(), [0, 3], '★ 通关第三章解开第四章；第三章自己仍要等第二章');

    // 通关第四章：解开的是**第五章**；第四章自己仍要等第三章
    renderStoryMenu(rows, { cleared: ['chapter-4'] });
    assert.deepEqual(openChapters(), [0, 4], '★ 通关第四章解开第五章；第四章自己仍要等第三章');

    // 通关第五章：解开的是**第六章**；第五章自己仍要等第四章
    renderStoryMenu(rows, { cleared: ['chapter-5'] });
    assert.deepEqual(openChapters(), [0, 5], '★ 通关第五章解开第六章；第五章自己仍要等第四章');

    // 通关第六章：解开的是**第七章**；第六章自己仍要等第五章
    renderStoryMenu(rows, { cleared: ['chapter-6'] });
    assert.deepEqual(openChapters(), [0, 6], '★ 通关第六章解开第七章；第六章自己仍要等第五章');

    // 通关第七章：解开的是**第八章**（第八章是现在最后一章）
    renderStoryMenu(rows, { cleared: ['chapter-7'] });
    assert.deepEqual(openChapters(), [0, 7], '★ 通关第七章解开第八章；第七章自己仍要等第六章');

    // 只标记最后一章"已通关"：不该凭空解开它自己
    renderStoryMenu(rows, { cleared: ['chapter-8'] });
    assert.deepEqual(openChapters(), [0], '★ 最后一章自己的标记不能解开它自己');
  });
});
