/**
 * ★★ 2026-10-04 用户要求①（任务一）：**把所有承太郎的半血觉醒名统一成「星尘的怒火」**。
 *
 * 现状（改之前）：`STORY_CHAPTERS` 里主角是承太郎的每一章各有一个 `swaps.jotaro.rage.name`，
 * 第七章（2026-10-03 那次补齐时）已经叫「星尘的怒火」，**其余章节还叫各自的老名字**：
 *   第二章「预判」／第四章「等待」／第五章「破口」（第一章一直是「星尘的怒火」）。
 * 用户要的是**全章一个名字**：界面上永远是「星尘的怒火 · 半血后觉醒」，
 * 觉醒后「星尘的怒火 · 攻击 +3 · 每回合 +1 AP」。
 *
 * 这一份用**逐章遍历**把它钉死（以后再加新章节，只要主角是承太郎，名字不对就红）：
 *   ① `rage.name` 全部是「星尘的怒火」，且**没有一个**还挂着老名字；
 *   ② `hpRatio` / `atk` / `ap` / `desc` **一个都没跟着动**（照旧值逐字比对——"只改名字"这条口径的证据）；
 *   ③ 界面文案：真的用假 DOM 跑一遍 `renderCards`，断言状态标签就是
 *      「星尘的怒火 · 半血后觉醒」→ 觉醒后「星尘的怒火 · 攻击 +3 · 每回合 +1 AP」。
 *
 * ⚠️ 只读数据与渲染，不动任何引擎逻辑。
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { Game, STORY_CHAPTERS } from '../src/core/game.js';

/**
 * 用户点名要统一的那一个名字（唯一真源）。别处要改名字时**先改这里**，
 * 这条测试会立刻指出哪些章节没跟上。
 */
const UNIFIED_RAGE_NAME = '星尘的怒火';

/** 改名字之前，各章承太郎觉醒名分别叫什么（留档：用来断言"老名字一个都不剩"）。 */
const OLD_RAGE_NAMES = {
  'chapter-1': '星尘的怒火',   // 第一章本来就是它（第七章当年就是照它统一的）
  'chapter-2': '预判',
  'chapter-4': '等待',
  'chapter-5': '破口',
  'chapter-7': '星尘的怒火',
};

/**
 * ★ 承太郎每一章觉醒的**数值与 desc 的原值**（＝"只许改名字"这条要求的回归基线）。
 * 这些值 2026-10-04 之前就是这样，改名字这一轮**一个都不许动**。
 * ⚠️ 只有无关键的名字换了；第五章 desc 里那句"先找破口"原本是照旧名字写的，
 *    跟着把那个词换掉（意思不变），所以这里是换过之后的那一句。
 */
const FROZEN = {
  'chapter-1': {
    hpRatio: 0.5, atk: 3, ap: 1,
    desc: '共享生命降到一半以下后永久获得：攻击力 +3、每个己方回合 +1 行动点。',
  },
  'chapter-2': {
    hpRatio: 0.5, atk: 3, ap: 1,
    desc: '共享生命降到一半以下后永久获得：攻击力 +3、每个己方回合 +1 行动点。盯住它必经的位置，等它自己撞上来。',
  },
  'chapter-4': {
    hpRatio: 0.5, atk: 3, ap: 1,
    desc: '共享生命降到一半以下后永久获得：攻击力 +3、每个己方回合 +1 行动点。水里没有他熟悉的规则，他能做的只有盯住对方必须靠近的那一刻。',
  },
  'chapter-5': {
    hpRatio: 0.5, atk: 3, ap: 1,
    desc: '共享生命降到一半以下后永久获得：攻击力 +3、每个己方回合 +1 行动点。再大的替身也是物质——先找到它的薄弱处，再谈出手。',
  },
  'chapter-7': {
    hpRatio: 0.5, atk: 3, ap: 1,
    desc: '共享生命降到一半以下后永久获得：攻击力 +3、每个己方回合 +1 行动点。顶着谁的脸不重要——先把这一下算清楚。',
  },
};

const jotaroChapters = () => STORY_CHAPTERS.filter(chapter => chapter.player === 'jotaro');

// ===================== ① 逐章遍历：名字统一 =====================

test('① 承太郎的每一章：半血觉醒名都是「星尘的怒火」（逐章遍历，防再漏）', () => {
  const chapters = jotaroChapters();
  assert.ok(chapters.length >= 5, `主角是承太郎的章节应该有一批（现在 ${chapters.length} 章）`);
  for (const chapter of chapters) {
    const rage = chapter.swaps?.jotaro?.rage;
    assert.ok(rage, `${chapter.id}：要写明半血觉醒`);
    assert.equal(rage.name, UNIFIED_RAGE_NAME, `★ ${chapter.id}：觉醒名必须统一成「${UNIFIED_RAGE_NAME}」`);
    // ★ 老名字一个都不许剩（用户原话："没有任何章节的承太郎还留着别的觉醒名"）
    for (const [id, old] of Object.entries(OLD_RAGE_NAMES)) {
      if (old === UNIFIED_RAGE_NAME) continue;
      assert.notEqual(rage.name, old, `★ ${chapter.id} 还挂着老名字「${old}」（${id} 的老名字）`);
    }
  }
  // 点名核对手册里那几章确实都在被遍历的名单里（免得 filter 写错、测试空转）
  assert.deepEqual(chapters.map(c => c.id), ['chapter-1', 'chapter-2', 'chapter-4', 'chapter-5', 'chapter-7'],
    '★ 主角是承太郎的是第 1、2、4、5、7 章（第 3 章是阿布德尔、第 6/8 章是波鲁纳雷夫）');
});

test('① 非承太郎章节的觉醒名照旧（这一轮只动承太郎，别人的名字一个字都不许碰）', () => {
  // 对照：第三章（阿布德尔）与第六章（波鲁纳雷夫）的名字各有出处，不该被"统一"顺手改掉
  assert.equal(STORY_CHAPTERS.find(c => c.id === 'chapter-3').swaps.avdol.rage.name, '不再硬接剑锋');
  // ★★ 2026-10-04 用户要求①（任务一）：第六章波鲁纳雷夫的觉醒名「把狠劲收回去」→ **「不屈」**。
  //    ⚠️ 这一句是那次改名**直接推翻**的断言（原来写的是「把狠劲收回去」，本次改成「不屈」）；
  //    除此之外这一条一个字没动——它守的还是"承太郎那几章没被顺手带跑"这件事。
  assert.equal(STORY_CHAPTERS.find(c => c.id === 'chapter-6').swaps.polnareff.rage.name, '不屈');
});

// ===================== ② 只改名字：数值与 desc 一个都没动 =====================

test('② 只改名字：每章承太郎的 hpRatio / atk / ap / desc 仍是原值（逐字比对）', () => {
  for (const [id, expected] of Object.entries(FROZEN)) {
    const chapter = STORY_CHAPTERS.find(c => c.id === id);
    assert.ok(chapter, `${id} 还在`);
    const rage = chapter.swaps.jotaro.rage;
    // 整个 rage 对象（把名字换成基线里的那个之后）必须与冻结值**逐字相同**
    assert.deepEqual({ ...rage, name: UNIFIED_RAGE_NAME },
      { ...expected, name: UNIFIED_RAGE_NAME }, `★ ${id}：除了名字，数值与 desc 一个字都不许动`);
    assert.equal(rage.hpRatio, expected.hpRatio, `${id}：hpRatio`);
    assert.equal(rage.atk, expected.atk, `${id}：atk`);
    assert.equal(rage.ap, expected.ap, `${id}：ap`);
    assert.equal(rage.desc, expected.desc, `${id}：desc`);
  }
  // 反证：基线表覆盖了所有承太郎章节（漏一章就等于那一章没人看着）
  assert.deepEqual(Object.keys(FROZEN).sort(), jotaroChapters().map(c => c.id).sort(),
    '每个承太郎章节都要在冻结基线里');
});

test('② 觉醒数值真的照旧生效：半血触发后攻击力 +3、每回合 +1 AP（逐章真跑引擎）', () => {
  for (const chapter of jotaroChapters()) {
    const rage = chapter.swaps.jotaro.rage;
    const game = new Game({ random: () => 0.5 });
    assert.equal(game.start(chapter.player, chapter.enemy, 'ai', { story: chapter.id }), true, `${chapter.id} 能开局`);
    game.s.hp.p1 = 1;                                       // 压到半血线以下
    assert.equal(game.checkStoryRage('p1'), true, `${chapter.id}：半血触发觉醒`);
    assert.equal(game.storyAttack('p1'), rage.atk, `${chapter.id}：攻击力 +3 照旧`);
    assert.equal(game.storyAP('p1'), rage.ap, `${chapter.id}：每回合 +1 AP 照旧`);
    // 觉醒播报里也是新名字（用户会看到的那一句）
    assert.match(`${rage.name}觉醒 · 攻击力 +${rage.atk}、每个己方回合 +${rage.ap} 行动点（永久）`,
      /^星尘的怒火觉醒/, `${chapter.id}：觉醒播报用的是统一后的名字`);
  }
});

// ===================== ③ 界面文案：状态标签 =====================

/** 最小假 DOM：照 tests/hud.test.js 那套（HUD 只用到这几个 API）。 */
function fakeDom() {
  const elements = new Map();
  const make = id => ({
    id, innerHTML: '', textContent: '', className: '', disabled: false, hidden: false, value: '', style: {},
    dataset: {}, attributes: {},
    classList: { toggle() {}, add() {}, remove() {}, contains: () => false },
    setAttribute(k, v) { this.attributes[k] = String(v); },
    getAttribute(k) { return this.attributes[k] ?? null; },
    hasAttribute(k) { return k in this.attributes; },
    removeAttribute(k) { delete this.attributes[k]; },
    addEventListener() {}, removeEventListener() {}, focus() {}, blur() {}, closest: () => null,
    querySelector: () => make(id + '-child'), querySelectorAll: () => [],
    insertAdjacentHTML(_, html) { this.innerHTML += html; },
    appendChild() {}, contains: () => true,
    getBoundingClientRect: () => ({ left: 0, top: 0, width: 100, height: 100, bottom: 100, right: 100 }),
  });
  const document = {
    getElementById: id => { if (!elements.has(id)) elements.set(id, make(id)); return elements.get(id); },
    querySelector: () => make('query'), querySelectorAll: () => [],
    createElement: () => make('created'),
    addEventListener() {}, removeEventListener() {},
    activeElement: null, body: make('body'),
  };
  return { document, get: id => document.getElementById(id) };
}

async function withDom(run) {
  const previous = globalThis.document;
  const dom = fakeDom();
  globalThis.document = dom.document;
  try { return await run(dom); } finally {
    if (previous === undefined) delete globalThis.document; else globalThis.document = previous;
  }
}

test('③ 界面标签：承太郎的觉醒标签读作「星尘的怒火 · 半血后觉醒」，觉醒后换成加成文案', async () => {
  await withDom(async dom => {
    const { renderCards } = await import('../src/ui/hud.js');
    for (const chapter of jotaroChapters()) {
      const game = new Game({ random: () => 0.5 });
      game.start(chapter.player, chapter.enemy, 'ai', { story: chapter.id });
      // 引擎那一层（状态标签的文字就是它给的）
      assert.equal(game.storyStatus('p1'), '星尘的怒火 · 半血后觉醒', `${chapter.id}：半血前的标签`);
      // 界面那一层：真的渲染一遍侧栏，标签要出现在 HTML 里
      renderCards(game, { humanTurn: true });
      assert.match(dom.get('sideP1').innerHTML, /class="status-tag[^"]*">星尘的怒火 · 半血后觉醒<\/span>/,
        `★ ${chapter.id}：界面上要显示成「星尘的怒火 · 半血后觉醒」`);
      // 觉醒之后换成加成文案（同一句口径：名字 + 两个数值）
      game.s.hp.p1 = 1;
      assert.equal(game.checkStoryRage('p1'), true);
      assert.equal(game.storyStatus('p1'), '星尘的怒火 · 攻击 +3 · 每回合 +1 AP', `${chapter.id}：觉醒后的标签`);
      renderCards(game, { humanTurn: true });
      assert.match(dom.get('sideP1').innerHTML, /星尘的怒火 · 攻击 \+3 · 每回合 \+1 AP/,
        `★ ${chapter.id}：觉醒后界面要换成「星尘的怒火 · 攻击 +3 · 每回合 +1 AP」`);
    }
  });
});

test('③ 对照：非承太郎章节的标签仍是自己的名字（没有被顺手统一）', async () => {
  await withDom(async dom => {
    const { renderCards } = await import('../src/ui/hud.js');
    const chapter = STORY_CHAPTERS.find(c => c.id === 'chapter-6');
    const game = new Game({ random: () => 0.5 });
    game.start(chapter.player, chapter.enemy, 'ai', { story: chapter.id });
    // ★★ 2026-10-04 用户要求①（任务一）：第六章的觉醒名改成 **「不屈」**（原「把狠劲收回去」）——
    //    界面上跟着显示成「不屈 · 半血后觉醒」。这是那次改名**直接推翻**的两句（本条＋下面那句正则），
    //    其余一个字没动：它守的还是"别的角色不该被写成承太郎的觉醒名"。
    assert.equal(game.storyStatus('p1'), '不屈 · 半血后觉醒', '波鲁纳雷夫那一章的名字改成「不屈」了');
    renderCards(game, { humanTurn: true });
    assert.match(dom.get('sideP1').innerHTML, /不屈 · 半血后觉醒/);
    assert.equal(dom.get('sideP1').innerHTML.includes('星尘的怒火'), false, '★ 别的角色不该被写成承太郎的觉醒名');
  });
});
