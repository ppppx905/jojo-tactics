/**
 * ★★ 2026-10-04 用户要求②（任务二）：**霍尔·霍斯（皇帝）的选人描述重写短，并且清掉裸露的 markdown**。
 *
 * 用户报的问题：`CHARACTER_ART.emperor.brief` 太长（143 字），**而且露着 markdown 星号**——
 * 界面上会原样显示成 `**不单独占棋子**`（见 `hud.js` 的 `draft-bio`，那段文字是**直接插进 HTML** 的，
 * 连 `esc()` 都没过，所以星号一点都不会被吃掉）。
 *
 * 这一份守三件事：
 *   ① **全量清扫**：`CHARACTER_ART` 里**每一条** `brief` / `type` / `quote` 都不含 `**`（也不含其它
 *      markdown 记号）——玩家看到的是纯文本；
 *   ② `emperor.brief` 重写成**和其它角色同量级**的短文案（2～3 句、≤ 90 字、落在既有 brief 的长度区间里），
 *      并且真的说清了"他是谁 ＋ 射程 5 的枪手 ＋ 两个技能"；
 *   ③ 改短的只是文案：`user` / `stand` / `roman` / `type` / `quote` / `accent` 这些**素材键与字段一个都没动**
 *      （素材检查 `tools/check-assets.mjs` 靠它们找图）。
 *
 * ⚠️ 只读 `CHARACTER_ART`，不碰任何素材文件、也不碰引擎。
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { CHARACTER_ART } from '../src/ui/assets.js';
import { FIGHTERS, playableFighters } from '../src/core/game.js';
import { plain } from '../src/ui/hud.js';

/** 任何 markdown 记号都不该出现在玩家看到的纯文本字段里。 */
const MARKDOWN = /(\*\*|__|`|~~|\[[^\]]*\]\([^)]*\))/;

const entries = Object.entries(CHARACTER_ART);
/** 三个纯文本字段：选人页的简介 / 定位标签 / 台词。 */
const TEXT_FIELDS = ['brief', 'type', 'quote'];

// ===================== ① 全量清扫：不许有 markdown =====================

test('① ★ CHARACTER_ART 里所有 brief / type / quote 都不含 markdown 记号（逐角色遍历）', () => {
  for (const [key, art] of entries) {
    for (const field of TEXT_FIELDS) {
      const text = art[field];
      if (text === undefined || text === null) continue;
      assert.equal(typeof text, 'string', `${key}.${field} 要是字符串`);
      assert.equal(MARKDOWN.test(text), false,
        `★ ${key}.${field} 里有 markdown 记号（玩家看到的是纯文本，会原样显示）：${text}`);
      assert.equal(text.includes('**'), false, `★ ${key}.${field} 里不许有 **`);
    }
  }
  // 反证：这个正则真的抓得住用户报的那两种写法（不是写了个永远为 false 的判据）
  assert.equal(MARKDOWN.test('这里**加粗**一下'), true);
  assert.equal(MARKDOWN.test('还**自带 2 点穿甲**——'), true);
  assert.equal(MARKDOWN.test('替身「皇帝」就是他那把大号左轮。'), false);
});

test('① 用户点名的那两处确实清掉了：皇帝与 J·凯尔的 brief（只删星号／重写，不含 `**`）', () => {
  assert.equal(CHARACTER_ART.emperor.brief.includes('**'), false, '★ 皇帝那条不再露星号');
  assert.equal(CHARACTER_ART.geil.brief.includes('**'), false, '★ J·凯尔那条（自带 2 点穿甲）也不再有星号');
  // geil 那条是**只删星号**：措辞与数值一字未动（把删掉的四个星号加回去就该与原文一字不差）
  assert.ok(CHARACTER_ART.geil.brief.includes('还自带 2 点穿甲'), '★ 星号删掉之后那句话照旧读得通');
});

test('① 界面那一段文字是纯文本：`plain()` 不会吃掉 `**`（所以字段里必须自己写干净）', () => {
  // ⚠️ 这是"为什么要清扫"的证据：`plain()` 只剥 HTML 标签，`esc()` 只做转义，都不认识 markdown。
  assert.equal(plain('**不单独占棋子**'), '**不单独占棋子**', '★ 星号会被原样显示出来');
  assert.equal(plain('<b>加粗</b>'), '加粗', '（它剥的是 HTML 标签）');
});

// ===================== ② 皇帝的 brief：短、同量级、说得清 =====================

test('② emperor.brief 重写短了：2～3 句、≤ 90 字，落在既有角色的长度区间里', () => {
  const brief = CHARACTER_ART.emperor.brief;
  const sentences = brief.split('。').filter(part => part.trim()).length;
  assert.ok(sentences >= 2 && sentences <= 3, `★ 2～3 句（实际 ${sentences} 句）：${brief}`);
  assert.ok(brief.length <= 90, `★ 与既有角色同量级：≤ 90 字（实际 ${brief.length} 字）`);
  // 参照物：其它**可选角色**那几条 brief 的长度区间（boss 那几条更长，不算参照）
  const others = playableFighters().filter(f => f.key !== 'emperor').map(f => CHARACTER_ART[f.key].brief);
  assert.ok(others.length >= 5, '（前提）可选角色不止一个');
  assert.ok(brief.length >= Math.min(...others.map(t => t.length)),
    `★ 别比最短那条还短（最短 ${Math.min(...others.map(t => t.length))} 字）`);
  assert.ok(brief.length <= Math.max(...others.map(t => t.length)),
    `★ 也别超过最长那条（最长 ${Math.max(...others.map(t => t.length))} 字）`);
  // 用户原来的那一条是 143 字：确实短下来了（用旧原文当反例，别让它悄悄长回去）
  const OLD = '替身「皇帝」就是他那把大号左轮——**不单独占棋子**，由他本人开枪（射程 5、攻击 7）。他自己还有两手：「瞄准」让他接下来两次攻击无视你的防御，「皇帝」则锁住一个单位、一回合后照样落下来。他钉在远处放枪、不肯近身，所以这一战真正的麻烦是：你追镜子里那个的时候，背后一直有把枪对着你。';
  assert.equal(OLD.length, 143, '（留档）旧文案 143 字');
  assert.ok(brief.length < OLD.length, '★ 必须比旧文案短');
});

test('② emperor.brief 说清了"他是谁 ＋ 射程 5 的枪手 ＋ 两个技能"', () => {
  const brief = CHARACTER_ART.emperor.brief;
  // 他是谁 / 枪手定位：替身就是那把枪，由本人开枪
  assert.ok(brief.includes('皇帝'), '要提到替身「皇帝」');
  assert.match(brief, /左轮|枪/, '★ 要说清他就是个枪手（替身就是那把枪）');
  assert.match(brief, /射程 5/, '★ 射程 5 是这一条的定位数字');
  // 技能一：瞄准 ＝ 接下来两次无视防御
  assert.ok(brief.includes('瞄准'), '要提到「瞄准」');
  assert.match(brief, /无视防御/, '★「瞄准」＝ 接下来两次攻击无视防御');
  // 技能二：皇帝 ＝ 锁定一个单位、一回合后 10 点伤害
  assert.match(brief, /锁定/, '★「皇帝」＝ 锁定一个单位');
  assert.match(brief, /10 点/, '★ 一回合后 10 点伤害');
  assert.match(brief, /一回合后|一回合之后/, '★ 要写清那 10 点是"一回合之后"才落下来的');
  // 不带 markdown 的换行符/制表符之类的排版记号
  assert.equal(/[\n\t]/.test(brief), false, 'brief 是单行纯文本，别塞换行');
});

// ===================== ③ 只改文案：素材键与字段一个都没动 =====================

test('③ 重写 brief 没有碰素材：字段与键照旧（check-assets 靠它们找图）', () => {
  const art = CHARACTER_ART.emperor;
  assert.deepEqual(Object.keys(art).sort(), ['accent', 'brief', 'quote', 'roman', 'stand', 'type', 'user'],
    '★ 字段集合没变');
  assert.equal(art.user, 'hol_horse', '本体立绘键照旧');
  assert.equal(art.stand, null, '单单位没有替身那一份');
  assert.equal(art.roman, 'HOL HORSE');
  assert.equal(art.type, '远程 · 外圈枪手', '★ 定位标签照旧（选人页头部直接显示它）');
  assert.equal(art.quote, '安心吧，我不会打偏的。');
  assert.equal(art.accent, '#c8a24a');
  // 每一位角色的 key 都是 registry 里的合法键（素材检查按它找图）
  for (const [key, entry] of entries) assert.equal(FIGHTERS[key].key, key, `${key} 是合法角色键`);
});
