/**
 * ★★ 2026-10-04 用户要求①（任务一）：**第六章波鲁纳雷夫的半血觉醒名改成「不屈」**。
 *
 * 改之前那一章叫「把狠劲收回去」（`STORY_CHAPTERS` 里 `chapter-6` 的 `swaps.polnareff.rage.name`）。
 * 用户的要求是**只改名字**：`hpRatio` / `atk` / `ap` / `desc` 的**数值一个都不许动**
 * （desc 里本来也没写那个旧名字，所以措辞不用跟着改）。界面上会显示成
 * 「**不屈 · 半血后觉醒**」→觉醒后「不屈 · 攻击 +3 · 每回合 +1 AP」。
 *
 * 这一份用**逐章遍历**把它钉死：
 *   ① 第六章的觉醒名就是「不屈」，旧名字一个都不剩，而且**全项目只有这一章**挂着它；
 *   ② 对照：承太郎那几章仍然是「星尘的怒火」（不许被这一轮顺手带跑）；
 *   ③ 只改名字：`hpRatio` / `atk` / `ap` / `desc` 逐字未动（冻结基线），并且真跑引擎验一遍加成；
 *   ④ 界面那一层：`renderCards` 渲染出来的状态标签读作「不屈 · 半血后觉醒」。
 *
 * ⚠️ 只读数据与渲染，不动任何引擎逻辑。
 * ⚠️ 被这次改名**直接推翻**的既有断言只有四处（都按新名字改过、其余一字未动）：
 *    `tests/ebony.test.js`（标题 ＋ 一处 name）、`tests/jotaro-rage-name.test.js`（两处界面文案）。
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { Game, STORY_CHAPTERS } from '../src/core/game.js';

/** 用户点名要改成的那一个名字（唯一真源）。 */
const RAGE_NAME = '不屈';
/** 改名前那一章的名字（留档：用来断言"旧名字一个都不剩"）。 */
const OLD_NAME = '把狠劲收回去';

/**
 * ★ 第六章觉醒的**数值与 desc 的原值**（＝"只许改名字"这条要求的回归基线）。
 * 这些值 2026-10-04 之前就是这样，改名这一轮**一个都不许动**。
 */
const FROZEN = {
  hpRatio: 0.5, atk: 3, ap: 1,
  desc: '共享生命降到一半以下后永久获得：攻击力 +3、每个己方回合 +1 行动点。越想赢，越要先学会不动手——机会只来一次。',
};

const chapter6 = () => STORY_CHAPTERS.find(chapter => chapter.id === 'chapter-6');
const rageOf = chapter => chapter.swaps.polnareff.rage;

// ===================== ① 第六章的名字 =====================

test('① 第六章：波鲁纳雷夫的半血觉醒名就是「不屈」（旧名字一个都不剩）', () => {
  const rage = rageOf(chapter6());
  assert.ok(rage, 'chapter-6 要写明半血觉醒');
  assert.equal(rage.name, RAGE_NAME, '★ 觉醒名＝「不屈」');
  assert.notEqual(rage.name, OLD_NAME, '★ 旧名字「把狠劲收回去」不许再留');
  // 逐章遍历：**全项目只有这一章**挂着「不屈」，别的章节不该被顺手改（对照见下一条）
  const carriers = STORY_CHAPTERS.filter(chapter =>
    Object.values(chapter.swaps || {}).some(swap => swap?.rage?.name === RAGE_NAME));
  assert.deepEqual(carriers.map(chapter => chapter.id), ['chapter-6'], '★ 只有第六章叫「不屈」');
});

test('① 对照：承太郎那几章仍然是「星尘的怒火」（逐章遍历，谁都不许串名）', () => {
  const jotaroChapters = STORY_CHAPTERS.filter(chapter => chapter.player === 'jotaro');
  assert.ok(jotaroChapters.length >= 5, `主角是承太郎的章节应该有一批（现在 ${jotaroChapters.length} 章）`);
  for (const chapter of jotaroChapters) {
    assert.equal(chapter.swaps?.jotaro?.rage?.name, '星尘的怒火', `★ ${chapter.id}：承太郎那几章仍是「星尘的怒火」`);
  }
  // 别章的觉醒名也各是各的（这一轮只动第六章）
  assert.equal(STORY_CHAPTERS.find(c => c.id === 'chapter-3').swaps.avdol.rage.name, '不再硬接剑锋');
  assert.equal(rageOf(chapter6()).name, RAGE_NAME, '第六章换成「不屈」了');
  assert.equal(STORY_CHAPTERS.some(chapter =>
    Object.values(chapter.swaps || {}).some(swap => swap?.rage?.name === OLD_NAME)), false,
  '★ 全项目再也没有「把狠劲收回去」这个觉醒名');
});

// ===================== ② 只改名字：数值逐字未动 =====================

test('② 只改名字：hpRatio / atk / ap / desc 仍是原值（逐字比对）', () => {
  const rage = rageOf(chapter6());
  assert.deepEqual({ ...rage, name: RAGE_NAME }, { ...FROZEN, name: RAGE_NAME },
    '★ 除了名字，数值与 desc 一个字都不许动');
  assert.equal(rage.hpRatio, FROZEN.hpRatio, 'hpRatio');
  assert.equal(rage.atk, FROZEN.atk, 'atk');
  assert.equal(rage.ap, FROZEN.ap, 'ap');
  assert.equal(rage.desc, FROZEN.desc, 'desc');
  // desc 里不该残留旧名字（带旧名字的措辞会自相矛盾）
  assert.equal(rage.desc.includes(OLD_NAME), false, 'desc 里不许再出现旧名字');
});

test('② 觉醒数值真的照旧生效：半血触发后攻击力 +3、每回合 +1 AP（真跑引擎）', () => {
  const chapter = chapter6(), rage = rageOf(chapter);
  const game = new Game({ random: () => 0.5 });
  assert.equal(game.start(chapter.player, chapter.enemy, 'ai', { story: chapter.id }), true, '第六章能开局');
  game.s.hp.p1 = 1;                                        // 压到半血线以下
  assert.equal(game.checkStoryRage('p1'), true, '半血触发觉醒');
  assert.equal(game.storyAttack('p1'), rage.atk, '攻击力 +3 照旧');
  assert.equal(game.storyAP('p1'), rage.ap, '每回合 +1 AP 照旧');
  // 觉醒播报里也是新名字（玩家会看到的那一句）
  assert.match(`${rage.name}觉醒 · 攻击力 +${rage.atk}、每个己方回合 +${rage.ap} 行动点（永久）`,
    /^不屈觉醒/, '觉醒播报用的是改名后的那一句');
});

// ===================== ③ 界面标签 =====================

/** 最小假 DOM：照 tests/jotaro-rage-name.test.js 那套（HUD 只用到这几个 API）。 */
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

test('③ 界面：标签读作「不屈 · 半血后觉醒」，觉醒后换成加成文案', async () => {
  const previous = globalThis.document;
  const dom = fakeDom();
  globalThis.document = dom.document;
  try {
    const { renderCards } = await import('../src/ui/hud.js');
    const chapter = chapter6();
    const game = new Game({ random: () => 0.5 });
    game.start(chapter.player, chapter.enemy, 'ai', { story: chapter.id });
    // 引擎那一层（状态标签的文字就是它给的）
    assert.equal(game.storyStatus('p1'), '不屈 · 半血后觉醒', '半血前的标签');
    renderCards(game, { humanTurn: true });
    assert.match(dom.get('sideP1').innerHTML, /class="status-tag[^"]*">不屈 · 半血后觉醒<\/span>/,
      '★ 界面上要显示成「不屈 · 半血后觉醒」');
    // 觉醒之后换成加成文案（同一句口径：名字 + 两个数值）
    game.s.hp.p1 = 1;
    assert.equal(game.checkStoryRage('p1'), true);
    assert.equal(game.storyStatus('p1'), '不屈 · 攻击 +3 · 每回合 +1 AP', '觉醒后的标签');
    renderCards(game, { humanTurn: true });
    assert.match(dom.get('sideP1').innerHTML, /不屈 · 攻击 \+3 · 每回合 \+1 AP/,
      '★ 觉醒后界面要换成「不屈 · 攻击 +3 · 每回合 +1 AP」');
    assert.equal(dom.get('sideP1').innerHTML.includes(OLD_NAME), false, '★ 旧名字一个字都不许再出现在界面上');
  } finally {
    if (previous === undefined) delete globalThis.document; else globalThis.document = previous;
  }
});
