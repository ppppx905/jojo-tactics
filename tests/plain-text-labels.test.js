/**
 * 界面文案的「纯文本」口径（2026-10-04 用户要求）。
 *
 * 由来（两处小修补，都是**玩家真的看得见**的问题）：
 *   ① **绿宝石的技能说明里写着一对裸星号**（`（**贴着一根就有，不叠加**；…）`）。
 *      而 `desc` 在界面上是**纯文本**——main.js 的 tooltip 走 `esc(plain(spec.desc))`，
 *      `plain()` 只剥 HTML 标签、**不吃 markdown**，所以玩家看到的就是字面的两个星号。
 *      用户已经为此投诉过一次（rules.js 里那句「所以这里不要写 `**加粗**`」的注释就是那次留下的）。
 *   ② 第六章（暗处的人偶）有一幕的 `note` 还写着旧措辞「战斗之后 · 把狠劲收回去」，
 *      会原样显示成「CHAPTER 06 · 战斗之后 · 把狠劲收回去」；而那一章波鲁纳雷夫的半血觉醒名
 *      2026-10-04 已经改成「不屈」（见 `tests/polnareff-rage-name.test.js`），标签于是前后不一致。
 *
 * 这个文件把两条口径钉死：
 *   ① **`SKILLS.*.desc` 一律纯文本**：不许有 `**`，也不许有 `<b>`／`</b>`／`<strong>`／`<em>`／`<i>`；
 *      再往上一层**全树遍历**一遍，任何会原样显示的字段（含各章觉醒的 `rage.desc`——
 *      它在 hud.js 里是直接插进 HTML 的）都不许有残留；
 *   ② **第六章那一幕的 note 与「不屈」一致**，而且幕的 `readId` / `from` / `upto` / 顺序一个字都没动。
 *
 * ⚠️⚠️ 唯一的例外是 `specialRules`：那一类**本来就渲染成粗体**
 *    （hud.js 里那行 `rule.replace(...)` 把成对的星号替换成 `<b>…</b>` 标签；战报里 main.js 则把星号直接剥掉）。
 *    所以它里面的 `**` 是对的、**不许动**，本文件也**刻意跳过**它。
 *
 * ⚠️ 只读数据与渲染，不动任何引擎逻辑、也不改任何数值。
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import * as rules from '../src/core/rules.js';
import { storySceneAt } from '../src/ui/story.js';

const { SKILLS, STORY_CHAPTERS } = rules;

/** rules.js 的源码（静态检查用：照项目既有的写法直接读文件）。 */
const RULES_SRC = fs.readFileSync(new URL('../src/core/rules.js', import.meta.url), 'utf8');
/** main.js：技能说明的那条渲染路径就在里面（tooltip）。 */
const MAIN_SRC = fs.readFileSync(new URL('../src/main.js', import.meta.url), 'utf8');
/** hud.js：`specialRules` 唯一把 `**` 变成 `<b>` 的地方。 */
const HUD_SRC = fs.readFileSync(new URL('../src/ui/hud.js', import.meta.url), 'utf8');

/**
 * 会**原样**显示给玩家的残留：markdown 星号 ＋ HTML 行内标签。
 * （`plain()` 剥标签、不吃 markdown，所以这两类在纯文本字段里都是 bug。）
 */
const RESIDUE = /\*\*|<\/?(?:b|strong|em|i)>/;

/** 改名前那一章的幕标签措辞（留档：用来断言"旧措辞一个都不剩"）。 */
const OLD_NOTE_WORDING = '把狠劲收回去';

/** 改成的那一个幕标签（用户点名的措辞）。 */
const NEW_NOTE = '战斗之后 · 不屈';

// ===================== ① SKILLS.*.desc 必须是纯文本 =====================

test('★ 所有 SKILLS.*.desc 都是纯文本：不含 **、也不含 <b> 之类的标签（逐条遍历）', () => {
  const entries = Object.entries(SKILLS);
  assert.ok(entries.length >= 28, `技能应该有一批（现在 ${entries.length} 条）`);
  const offenders = [];
  for (const [key, skill] of entries) {
    assert.equal(typeof skill.desc, 'string', `SKILLS.${key} 要写明 desc`);
    if (RESIDUE.test(skill.desc)) offenders.push(`SKILLS.${key}.desc → ${skill.desc}`);
  }
  assert.deepEqual(offenders, [],
    '★ 技能说明在界面上是纯文本（tooltip 走 esc(plain(...))）：不许出现会原样显示的星号或标签');
});

test('★ 绿宝石技能说明：那一对裸星号已经清掉，措辞自然，其余文字一个字都没动', () => {
  const desc = SKILLS.emerald.desc;
  assert.equal(typeof desc, 'string', '绿宝石要有说明');
  assert.equal(desc.includes('**'), false, '★ desc 里不许再有裸星号');
  // 用户点名的那一句（`，` 一并改成更自然的 `、`）
  assert.ok(desc.includes('（贴着一根就有、不叠加；2v2 时队友贴着你的柱子也算）'),
    `★ 星号那一段要改成自然的中文（现在：${desc}）`);
  assert.equal(desc.includes('**贴着一根就有'), false, '旧写法一个都不剩');
  // 其余文字逐字未动（只换了那一处措辞）：掐头去尾各比一段
  assert.ok(desc.startsWith('消耗1行动点，在绿色法皇3格内的空格生成一根绿宝石柱（生命10、最多3根）。'), '前缀未动');
  assert.ok(desc.endsWith('柱子可被攻击打碎（打碎不会让花京院方掉血，也不构成获胜条件）。'), '后缀未动');
  // 数值口径照旧（这一轮只动文字，一个数都没碰）
  assert.equal(SKILLS.emerald.pillarHp, 10, '柱子血量仍是 10');
  assert.equal(SKILLS.emerald.cap, 3, '柱子最多仍是 3 根');
});

// ===================== ② 静态检查 + 全树遍历 =====================

test('★ 静态检查：rules.js 里所有 desc 字面量都不含 **／<b>（含各章觉醒说明）', () => {
  // 单引号 / 双引号 / 反引号三种写法都收（当前一律是单引号，留着防以后换写法漏检）
  const literals = [...RULES_SRC.matchAll(/\bdesc:\s*(['"`])([^'"`]*)\1/g)].map(m => m[2]);
  assert.ok(literals.length >= Object.keys(SKILLS).length,
    `每条技能都该有一个 desc 字面量（找到 ${literals.length} 个 / 技能 ${Object.keys(SKILLS).length} 条）`);
  const offenders = literals.filter(text => RESIDUE.test(text));
  assert.deepEqual(offenders, [], '★ desc 字面量里不许有会原样显示的星号或标签');
});

test('★ 全树遍历：纯文本字段里没有别的残留（specialRules 例外，它本来就渲染成粗体）', () => {
  const offenders = [];
  const walk = (value, path) => {
    if (typeof value === 'string') {
      if (RESIDUE.test(value)) offenders.push(`${path} → ${value}`);
      return;
    }
    if (Array.isArray(value)) { value.forEach((item, i) => walk(item, `${path}[${i}]`)); return; }
    if (value && typeof value === 'object') {
      for (const [key, item] of Object.entries(value)) walk(item, `${path}.${key}`);
    }
  };
  for (const [name, value] of Object.entries(rules)) walk(value, name);
  // ⚠️ `specialRules` 是**唯一**允许出现 `**` 的地方（hud 会把它替换成 <b>），所以按路径放过它。
  const plainOnly = offenders.filter(line => !/specialRules/.test(line));
  assert.deepEqual(plainOnly, [], '★ 除 specialRules 之外，任何字段都不许有会原样显示的星号或标签');
  // 对照组：specialRules 里**确实**还在用 `**`（证明上面那条过滤不是把检查整个放空了）
  assert.ok(offenders.some(line => /specialRules/.test(line)), 'specialRules 仍按老路子用 ** 表示粗体');
});

test('★ 接线：技能说明走纯文本、specialRules 才吃 **（两条路各走各的）', () => {
  // 技能说明：tooltip 里 `esc(plain(spec.desc))`——只剥标签，不吃 markdown
  assert.ok(MAIN_SRC.includes('esc(plain(spec.desc))'),
    '★ 技能说明仍是 esc(plain(...)) 那条路（所以 desc 必须是纯文本）');
  // specialRules：唯一把 `**` 渲染成 <b> 的地方——**不许改**
  assert.ok(HUD_SRC.includes("rule.replace(/\\*\\*(.+?)\\*\\*/g, '<b>$1</b>')"),
    '★ specialRules 的 ** → <b> 渲染照旧（那类文案本来就是粗体）');
});

// ===================== ③ 第六章的幕标签 =====================

test('★ 第六章那一幕的 note ＝「战斗之后 · 不屈」（与半血觉醒名一致，其余字段一个字都没动）', () => {
  const chapter = STORY_CHAPTERS.find(c => c.id === 'chapter-6');
  assert.ok(chapter, '第六章还在');
  assert.equal(chapter.scenes.length, 3, '第六章仍是三幕：读 → 打 → 读');
  const [before, battle, after] = chapter.scenes;
  // 幕的结构逐字未动（这一轮只改了 `after.note` 这一串文字）
  assert.deepEqual({ ...before }, { kind: 'read', readId: 'devil', upto: 2, note: '旅馆里的伏击' },
    '第一幕（战斗前）未动');
  assert.equal(battle.kind, 'battle', '第二幕仍是战斗');
  assert.equal(battle.note, '波鲁纳雷夫 对 黑檀之魔', '战斗幕的标签未动');
  assert.equal(after.kind, 'read', '第三幕仍是读剧情');
  assert.equal(after.readId, 'devil', '★ readId 仍是 devil');
  assert.equal(after.from, 2, '★ from 仍是 2');
  assert.equal('upto' in after, false, '战后那一幕照旧只写 from（没有 upto）');
  // ★ 新措辞
  assert.equal(after.note, NEW_NOTE, '★ 幕标签改成与「不屈」一致的措辞');
  // 名字真的取自那一章的半血觉醒名（以后觉醒名再改，这条会一起盯住）
  assert.equal(after.note, `战斗之后 · ${chapter.swaps.polnareff.rage.name}`,
    '★ 标签里的名字要与波鲁纳雷夫的半血觉醒名一致');
  assert.equal(chapter.swaps.polnareff.rage.name, '不屈', '觉醒名就是「不屈」');
  // 界面上拼出来的那一行：hud.js 是 `${chapter.eyebrow} · ${view.note}`
  const view = storySceneAt(chapter, 2);
  assert.equal(view.note, NEW_NOTE, 'storySceneAt 交给界面的 note 就是新措辞');
  assert.equal(`${chapter.eyebrow} · ${view.note}`, 'CHAPTER 06 · 战斗之后 · 不屈',
    '★ 玩家看到的那一行');
});

test('★ 旧措辞「把狠劲收回去」逐章逐幕一个都不剩', () => {
  for (const chapter of STORY_CHAPTERS) {
    for (const [i, scene] of (chapter.scenes || []).entries()) {
      assert.equal(String(scene.note || '').includes(OLD_NOTE_WORDING), false,
        `★ ${chapter.id} 第 ${i + 1} 幕的标签还留着旧措辞：${scene.note}`);
    }
    assert.equal(JSON.stringify(chapter).includes(OLD_NOTE_WORDING), false,
      `★ ${chapter.id} 的数据里还留着旧措辞`);
  }
});
