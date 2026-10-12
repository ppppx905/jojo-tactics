/**
 * 用户 2026-10-05 两条要求的回归（本文件是它们唯一的用例）：
 *
 *   ① **每个角色的「第三个技能」都要播大招插画**——
 *      main.js 里那条判定从"写死的技能白名单"改成「**白名单 ∪ 该角色技能表里的第三个技能**」：
 *        · "第三个技能"按**当前出手位子实际生效的技能表**算（`game.skills(槽位)`），**不写死角色名**；
 *        · 不足三个技能的角色（只有 2 个技能的 boss、没有技能的 boss）＝**没有第三技能**，不报错；
 *        · 原有白名单条目**一个都没删**；
 *        · 剧情模式的技能替换（`swaps.<角色>.skills`）会让表变短或换内容，判定跟着生效的那份表走。
 *   ② 霍尔·霍斯「皇帝」⇄「暗枪」换位置：`skillSetFor('emperor')` 从
 *      `['aim','emperor','darkgun']` 变成 **`['aim','darkgun','emperor']`** ——
 *      于是「皇帝」成了他的第三个技能，自然吃到①那条规则；两个技能的机制与数值一个字都没动。
 *
 * 怎么验的：**不是只做源码正则**。这里装一套假 DOM，把 `src/main.js` 真的 import 进来，
 * 用引擎摆好的技能表驱动**真实的 `onEvent`**，再看 `#cutin` 那个节点有没有真的播
 * （`hidden === false` ＋ `.play` ＋ 背景图指向该角色的 `cutins/<key>.webp`）。
 * 假 DOM 只实现 HUD/演出用到的那几个 API（与 `tests/hud.test.js`、`tests/control.test.js` 同一套思路）。
 */
import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { FIGHTERS, SKILLS, STORY_CHAPTERS, skillSetFor, playableFighters, isBoss } from '../src/core/game.js';
import { CHARACTER_ART, cutin } from '../src/ui/assets.js';
import { thirdSkillOf, isThirdSkill } from '../src/ui/cutin.js';

const MAIN_SRC = fs.readFileSync(new URL('../src/main.js', import.meta.url), 'utf8');
const HUD_SRC = fs.readFileSync(new URL('../src/ui/hud.js', import.meta.url), 'utf8');

/** 那条判定的**源码片段**（与 `tests/chapter7-presentation.test.js` 取的是同一个 400 字窗口）。 */
const GATE = MAIN_SRC.slice(MAIN_SRC.indexOf('showCutin(event)') - 400, MAIN_SRC.indexOf('showCutin(event)'));
/** 白名单＝从上面那段里读出来的技能 id（main.js 是它的**唯一**一份，这里只是把它读出来核对）。 */
const WHITELIST = [...GATE.matchAll(/'([a-z_]+)'/g)].map(match => match[1]);

// ===================== 假 DOM（只跑事件接线，不跑整套初始化） =====================
const nodes = new Map();
function makeNode(id) {
  const classes = new Set();
  return {
    id, innerHTML: '', textContent: '', className: '', hidden: false, disabled: false, value: '',
    dataset: {}, attributes: {}, style: {}, offsetWidth: 0,
    classList: {
      add: (...names) => { for (const name of names) classes.add(name); },
      remove: (...names) => { for (const name of names) classes.delete(name); },
      toggle(name, on) { const want = on === undefined ? !classes.has(name) : !!on; if (want) classes.add(name); else classes.delete(name); return want; },
      contains: name => classes.has(name),
    },
    setAttribute(name, value) { this.attributes[name] = String(value); },
    getAttribute(name) { return this.attributes[name] ?? null; },
    hasAttribute(name) { return name in this.attributes; },
    removeAttribute(name) { delete this.attributes[name]; },
    addEventListener() {}, removeEventListener() {}, focus() {}, blur() {}, closest: () => null,
    querySelector: () => makeNode(`${id}-child`), querySelectorAll: () => [],
    insertAdjacentHTML(_, html) { this.innerHTML += html; },
    appendChild() {}, contains: () => true,
    getBoundingClientRect: () => ({ left: 0, top: 0, width: 100, height: 100, bottom: 100, right: 100 }),
  };
}
const node = id => { if (!nodes.has(id)) nodes.set(id, makeNode(id)); return nodes.get(id); };

const GLOBALS = ['document', 'window', 'matchMedia', 'location', 'localStorage', 'requestAnimationFrame', 'cancelAnimationFrame', 'ResizeObserver', 'Image'];
const saved = new Map(GLOBALS.map(name => [name, globalThis[name]]));
globalThis.document = {
  // ⚠️ `board` **故意**不给 2d 上下文：boot() 会在 `new BoardVisual(game)` 那一步失败、被它自己的
  //    try/catch 吞掉 —— 于是"假 DOM 里只跑事件接线"，也不会留下任何计时器
  //    （`loadSprites` 那 12 秒兜底、台词队列的计时器压根不会开始）。
  getElementById: id => node(id),
  querySelector: () => makeNode('query'), querySelectorAll: () => [], createElement: () => makeNode('created'),
  addEventListener() {}, removeEventListener() {}, activeElement: null, body: makeNode('body'),
};
globalThis.window = { devicePixelRatio: 1, addEventListener() {}, removeEventListener() {} };
globalThis.matchMedia = () => ({ matches: false, addEventListener() {}, addListener() {} });
globalThis.location = { search: '', protocol: 'http:' };
globalThis.localStorage = { getItem: () => null, setItem() {}, removeItem() {} };
globalThis.requestAnimationFrame = () => 1;
globalThis.cancelAnimationFrame = () => {};
globalThis.ResizeObserver = class { observe() {} disconnect() {} };
globalThis.Image = class { set src(value) { this._src = value; } get src() { return this._src; } };
// 本文件跑完就把全局还回去（假 DOM 只在上面那几个用例里需要）
after(() => { for (const [name, value] of saved) { if (value === undefined) delete globalThis[name]; else globalThis[name] = value; } });

const realConsoleError = console.error;
console.error = () => {};                       // boot() 那一步故意失败，别把栈打印到测试输出里
let main;
try { main = await import('../src/main.js'); } finally { console.error = realConsoleError; }
const { game, onEvent } = main;

// ===================== 驱动真实事件接线的三个小工具 =====================

/** 把引擎摆成"某角色在 p1 出手"的样子，返回他**场上实际生效**的技能表。
 *  ⚠️ 不调 `game.start()`：那条路会发出一堆台词/回合横幅事件、还留下计时器，这里只要技能表。 */
function mount(key, story = null) {
  game.s.fighters = { p1: FIGHTERS[key], p2: FIGHTERS.dio };
  game.s.story = story;
  return game.skills('p1');
}
function resetCutin() {
  const cut = node('cutin');
  cut.hidden = true; cut.innerHTML = ''; cut.style.backgroundImage = '';
  cut.classList.remove('play');
}
/** 真的放一次技能事件，返回"画面上有没有播"。判定与断言都在同一个 tick 里，不受自动收起的计时器影响。 */
function cast(key, skill, extra = {}) {
  resetCutin();
  onEvent({ type: 'skill', side: 'p1', fighter: key, skill, ...extra });
  const cut = node('cutin');
  return { played: !cut.hidden && cut.classList.contains('play'), cut };
}

// ===================== ① 遍历：每个角色的第三个技能都会播 =====================

test('① 遍历全部角色：第三个技能都会播大招插画；不足三个技能的角色不报错', () => {
  const withThird = [], withoutThird = [], nonWhitelisted = [];
  const roster = [...playableFighters().map(fighter => fighter.key), ...Object.keys(FIGHTERS).filter(isBoss)];

  for (const key of roster) {
    const skills = mount(key);
    assert.deepEqual(skills, skillSetFor(key), `${key}：没有剧情替换时，场上挂的就是他原本那份技能表`);
    const third = thirdSkillOf(skills);

    if (!third) {
      // ★ 不足三个技能的角色：＝没有第三技能。判定给 null，事件照扔过来也不许抛错。
      withoutThird.push(key);
      for (const skill of [...skills, 'time', 'claw', undefined]) {
        let result = null;
        assert.doesNotThrow(() => { result = cast(key, skill); }, `${key} 放 ${skill} 不该抛错`);
        // 没有第三技能时，"播不播"**完全由白名单决定**（白名单里那些照旧会播）
        assert.equal(result.played, WHITELIST.includes(skill), `${key} 的 ${skill}：只剩白名单那一支`);
      }
      continue;
    }

    withThird.push(key);
    if (!WHITELIST.includes(third)) nonWhitelisted.push(third);
    assert.equal(isThirdSkill(skills, third), true, `${key} 的第三个技能要认得出来`);
    assert.equal(isThirdSkill(skills, skills[1]), false, `${key} 的第二个技能不该被当成第三个`);
    const { played, cut } = cast(key, third, { label: SKILLS[third]?.name });
    assert.equal(played, true, `★ ${key} 的第三个技能（${third}）要播大招插画`);
    assert.equal(cut.style.backgroundImage, `url("${cutin(key)}")`, `★ 画的要是他自己那张 cutins/${key}.webp`);
    assert.match(cut.innerHTML, /P1 \/ STAND ABILITY/, '画面上的阵营行照旧');
    if (SKILLS[third]) assert.match(cut.innerHTML, new RegExp(SKILLS[third].name), '中间那行是技能名');
  }

  assert.equal(withThird.length, 10, `有第三技能的角色共 ${withThird.length} 个（9 个可选角色 + 暗蓝之月）`);
  assert.deepEqual(withoutThird.sort(), ['ebony', 'forever', 'geil', 'gray_fly', 'temperance'],
    '★ 不足三个技能的角色：两个技能的两个、一个技能都没有的三个 —— 一律按"没有第三技能"处理');
  assert.deepEqual([...new Set(nonWhitelisted)].sort(), ['aquatic', 'claw', 'emperor', 'rebuild'],
    '★ 不在白名单里的第三技能：靠"该角色实际的第三个技能"那条规则照样会播');
  assert.equal(playableFighters().every(fighter => thirdSkillOf(skillSetFor(fighter.key)) !== null), true,
    '★ 全部可选角色都有第三个技能（所以每个人都会播）');
});

test('① 负对照：不是第三技能、也不在白名单里的技能不会播', () => {
  const cases = [['kakyoin', 'emerald'], ['kakyoin', 'trauma'], ['jotaro', 'star'], ['dio', 'drain'],
    ['iggy', 'dive'], ['iggy', 'sandblast'], ['emperor', 'aim'], ['emperor', 'darkgun'],
    ['gray_fly', 'needle'], ['gray_fly', 'disguise'], ['temperance', 'erosion']];
  for (const [key, skill] of cases) {
    mount(key);
    assert.equal(WHITELIST.includes(skill), false, `（前提）${skill} 不在白名单里`);
    assert.equal(isThirdSkill(game.skills('p1'), skill), false, `（前提）${skill} 不是 ${key} 的第三个技能`);
    assert.equal(cast(key, skill).played, false, `★ ${key} 的 ${skill} 不该播`);
  }
});

test('① 技能事件缺 side 时不会把判定错算到别的位子上（兜底，不抛错）', () => {
  mount('emperor');
  resetCutin();
  assert.doesNotThrow(() => onEvent({ type: 'skill', skill: 'emperor', fighter: 'emperor' }));
  assert.equal(node('cutin').hidden, true, '★ 没有 side 就不去查技能表（更不能当成 P2 的表）');
});

// ===================== ② 白名单一个都没删、照旧会播 =====================

test('② 原有白名单原样保留，而且照旧会播（含双形态的 label）', () => {
  assert.deepEqual(WHITELIST, ['ora', 'time', 'splash', 'flame', 'blaze', 'blade', 'armor', 'vine', 'hamon', 'drag', 'sucker', 'slime'],
    '★ 白名单条目一个都没删（用户没要求取消任何一个）');
  assert.match(GATE, /isThirdSkill\(event\.side \? game\.skills\(event\.side\) : \[\], event\.skill\)/,
    '★ 判定要按**当前出手位子的技能表**算（game.skills(slot) 那条口径）');
  assert.equal(/['"](?:jotaro|dio|emperor|iggy|kakyoin)['"]/.test(GATE), false, '★ 判定里不许写死角色名');

  // 挑代表性的几个真放一次：它们都不是"第三个技能"，走的纯是白名单那一支
  for (const [key, skill] of [['jotaro', 'ora'], ['avdol', 'flame'], ['temperance', 'slime'], ['joseph', 'vine']]) {
    mount(key);
    assert.notEqual(thirdSkillOf(game.skills('p1')), skill, `（前提）${skill} 不是 ${key} 的第三个技能`);
    const { played, cut } = cast(key, skill);
    assert.equal(played, true, `★ 白名单里的 ${skill} 照旧会播`);
    assert.equal(cut.style.backgroundImage, `url("${cutin(key)}")`);
  }

  // 双形态技能（装甲／卸甲）：事件里带 label / cry 就照显示——这一条通道没动
  mount('polnareff');
  const { cut } = cast('polnareff', 'armor', { label: '卸甲', cry: 'ARMOR OFF' });
  assert.match(cut.innerHTML, /卸甲/);
  assert.match(cut.innerHTML, /ARMOR OFF/);

  // 不带 skill 字段的 `cutin` 事件（第六章「憎恨」第一次叠满）照旧能播
  resetCutin();
  onEvent({ type: 'cutin', side: 'p2', fighter: 'ebony', label: '黑檀之魔', cry: 'MENACING' });
  assert.equal(node('cutin').hidden, false, '★ 另一条插画通道（cutin 事件）没被牵连');
});

// ===================== ③ 霍尔的技能顺序 + 键位 =====================

test('③ 霍尔：「皇帝」与「暗枪」换位置 → 第三技能＝皇帝＝会播 cutin，Q/W/E 不错位', () => {
  assert.deepEqual(skillSetFor('emperor'), ['aim', 'darkgun', 'emperor'],
    '★ 用户 2026-10-05 第二条：「暗枪」第二个、「皇帝」第三个');
  assert.equal(thirdSkillOf(skillSetFor('emperor')), 'emperor', '★ 于是「皇帝」正好是第三个技能');

  const skills = mount('emperor');
  assert.deepEqual(skills, ['aim', 'darkgun', 'emperor'], '场上挂的就是这一份，顺序一致');
  assert.equal(isThirdSkill(skills, 'emperor'), true, '★「皇帝」＝第三个技能 → 会播');
  assert.equal(isThirdSkill(skills, 'darkgun'), false, '第二个技能不再被"第三技能"那条命中');

  const { played, cut } = cast('emperor', 'emperor', { label: SKILLS.emperor.name, cry: 'EMPEROR' });
  assert.equal(played, true, '★「皇帝」现在会播大招插画');
  assert.equal(cut.style.backgroundImage, `url("${cutin('emperor')}")`);
  assert.match(cut.innerHTML, /皇帝/);
  assert.match(cut.innerHTML, /EMPEROR/);

  // 键位：界面是按**技能表下标**取键的，两个技能只是互换，所以第三格仍然落在 E 上——没错位
  const qwe = ['Q', 'W', 'E'];
  assert.equal(qwe[skills.indexOf('aim')], 'Q', '第一个技能＝Q');
  assert.equal(qwe[skills.indexOf('darkgun')], 'W', '★「暗枪」现在是 W');
  assert.equal(qwe[skills.indexOf('emperor')], 'E', '★「皇帝」现在是 E');
  assert.equal(qwe[skills.indexOf(thirdSkillOf(skills))], 'E', '第三技能＝E 这一条没变');

  // 自查（静态）：两处键盘映射都在，都是"同一份三字母、按技能表下标取"
  const keyLines = MAIN_SRC.split('\n').filter(line => /\['q', 'w', 'e'\]/.test(line));
  assert.equal(keyLines.length, 2, 'main.js 里那份键盘映射就是"判键 + 取技能"两行，不散在别处');
  assert.match(keyLines[1], /game\.skills\(game\.s\.turn\)\[\['q', 'w', 'e'\]\.indexOf\(/, '★ 键盘按 game.skills(当前位子) 取键');
  assert.equal((HUD_SRC.match(/\['Q', 'W', 'E'\]/g) || []).length, 1, 'hud.js 里那份按钮角标也只有一处');
  assert.match(HUD_SRC, /key: \['Q', 'W', 'E'\]\[index\]/, '★ 按钮角标按技能表下标取');

  // 自查（静态）：技能栏顺序、tooltip、CD 全按技能表来，hud 里没有别处写死顺序
  assert.match(HUD_SRC, /<div class="bay-skills">\$\{game\.skills\(slot\)\.map\(/, '信息栏的技能按钮按 game.skills(slot) 生成');
  assert.match(HUD_SRC, /game\.skills\(side\)\.forEach\(\(key, index\) =>/, '底部指令栏按 game.skills(side) 生成（index 只用来配 Q/W/E）');
  assert.equal(/\[\s*'aim'\s*,\s*'emperor'/.test(HUD_SRC), false, 'hud 里不许出现写死的技能顺序');
  assert.equal(/\[\s*'emperor'\s*,\s*'darkgun'/.test(HUD_SRC), false, 'hud 里不许出现写死的技能顺序');
});

// ===================== ④ 剧情 swaps：判定跟着实际生效的表走 =====================

test('④ 剧情 swaps 改技能表时，第三技能的判定跟着**实际生效**的那份表走', () => {
  // 甲）真实数据：第四章的承太郎被删掉了「时停」（只剩两个技能）→ 他就没有第三技能了
  const chapter4 = STORY_CHAPTERS.find(chapter => chapter.id === 'chapter-4');
  let skills = mount('jotaro', { swaps: { jotaro: { skills: chapter4.swaps.jotaro.skills } } });
  assert.deepEqual(skills, ['ora', 'star'], '第四章的承太郎就是这两个技能');
  assert.equal(thirdSkillOf(skills), null, '★ 表变短＝没有第三技能（不报错）');
  assert.equal(isThirdSkill(skills, 'time'), false, '★「时停」不再是他的第三技能');
  assert.equal(cast('jotaro', 'time').played, true, '（它照旧会播，但走的是白名单那一支）');
  assert.equal(cast('jotaro', 'star').played, false, '第二个技能不在白名单里 → 不播');

  // 乙）换内容：把一个**白名单里没有**的技能换到第三格 → 会播；换回去就不播
  skills = mount('jotaro', { swaps: { jotaro: { skills: ['ora', 'star', 'claw'] } } });
  assert.equal(thirdSkillOf(skills), 'claw');
  assert.equal(WHITELIST.includes('claw'), false, '（前提）沙之爪本来不在白名单里');
  assert.equal(cast('jotaro', 'claw').played, true, '★ 判定跟着生效的表走：换到第三格就会播');
  mount('jotaro');                                   // 去掉剧情替换 → 回到 ora / star / time
  assert.equal(cast('jotaro', 'claw').played, false, '★ 表换回去之后同一招不播（不是"谁都能播"）');

  // 丙）变短＋错位：伊奇的沙之爪本来是第三技能，剧情把它挪到第二格 → 不再播
  mount('iggy');
  assert.equal(cast('iggy', 'claw').played, true, '（原样）沙之爪＝第三技能 → 会播');
  skills = mount('iggy', { swaps: { iggy: { skills: ['dive', 'claw'] } } });
  assert.equal(thirdSkillOf(skills), null, '★ 只剩两个技能');
  assert.equal(cast('iggy', 'claw').played, false, '★ 挪到第二格就不再播');

  // 丁）表变长：第四格不会顶掉第三个（照 `tests/hanged-man.test.js` 那套数据形状）
  skills = mount('kakyoin', { swaps: { kakyoin: { skills: [...skillSetFor('kakyoin'), 'hamon'] } } });
  assert.deepEqual(skills, ['emerald', 'trauma', 'splash', 'hamon'], '多了一个「波纹疾走」');
  assert.equal(thirdSkillOf(skills), 'splash', '第三个仍然是绿宝石水花');
  assert.equal(isThirdSkill(skills, 'hamon'), false, '★ 第四个技能不算"第三个"');
  assert.equal(cast('kakyoin', 'hamon').played, true, '（它会播，但走的是白名单那一支）');
  // 换成第四个是"白名单外"的技能时看得更清楚：它照样不该播
  skills = mount('kakyoin', { swaps: { kakyoin: { skills: ['emerald', 'trauma', 'splash', 'claw'] } } });
  assert.equal(thirdSkillOf(skills), 'splash');
  assert.equal(cast('kakyoin', 'claw').played, false, '★ 只有**第三个**位置算，第四个白名单外技能不播');
});

// ===================== ⑤ 霍尔的机制与数值逐值未变 =====================

test('⑤ 霍尔两个技能的机制与数值逐值未变（本次只换了顺序）', () => {
  // 「所有数值字段」整份比对：既挡住改值，也挡住偷偷加字段
  const numeric = skill => Object.fromEntries(Object.entries(skill).filter(([, value]) => typeof value === 'number'));
  assert.deepEqual(numeric(SKILLS.emperor), { cost: 1, cd: 2, range: 5, dmg: 10, delayRounds: 1 }, '★「皇帝」的全部数值字段');
  assert.deepEqual(numeric(SKILLS.darkgun), { cost: 0, cd: 1, range: 5, dmg: 8, marks: 2 }, '★「暗枪」的全部数值字段');
  // 用户点名的三个数：0 AP / 8 点 / 2 格 —— 再单独钉一遍
  assert.equal(SKILLS.darkgun.cost, 0, '★「暗枪」不消耗行动点');
  assert.equal(SKILLS.darkgun.dmg, 8, '★「暗枪」8 点');
  assert.equal(SKILLS.darkgun.marks, 2, '★「暗枪」一次标 2 格');
  assert.equal(SKILLS.emperor.dmg, 10, '★「皇帝」10 点');
  assert.equal(SKILLS.emperor.range, 5, '★「皇帝」射程 5');

  // 名字、图标、释放方、被动标记也照旧
  assert.deepEqual([SKILLS.emperor.name, SKILLS.emperor.emoji, SKILLS.emperor.by], ['皇帝', '🔫', 'user']);
  assert.deepEqual([SKILLS.darkgun.name, SKILLS.darkgun.emoji, SKILLS.darkgun.by], ['暗枪', '🌑', 'user']);
  assert.equal(SKILLS.emperor.passive, undefined);
  assert.equal(SKILLS.darkgun.passive, undefined);

  // 他本人的数值：40 血 / 基础防御 1 / 移动 2 / 攻击 7 / 射程 5 / 单单位，冷枪与走位棋标照旧
  // ⚠️ 2026-10-05 用户拍板「基础防御 2 → 1」把下面那个 2 直接推翻了（只动这一个数，其余照旧）。
  assert.deepEqual(
    [FIGHTERS.emperor.hp, FIGHTERS.emperor.def, FIGHTERS.emperor.distLimit, FIGHTERS.emperor.standDefBonus, FIGHTERS.emperor.solo, FIGHTERS.emperor.stand],
    [40, 1, 0, 0, true, null], '★ 他的基础数值与"单单位"都没动（防御是 2026-10-05 拍板的 1）');
  assert.deepEqual(
    [FIGHTERS.emperor.user.move, FIGHTERS.emperor.user.range, FIGHTERS.emperor.user.dmg, FIGHTERS.emperor.user.sniper, FIGHTERS.emperor.user.kite],
    [2, 5, 7, true, true], '★ 移动 2 / 射程 5 / 攻击 7、冷枪与走位棋标照旧');
  // 技能表的**内容**没变（只是顺序）
  assert.deepEqual([...skillSetFor('emperor')].sort(), ['aim', 'darkgun', 'emperor'], '还是这三个技能');
});

// ===================== 顺带：没有专属插画素材的角色不会崩 =====================

test('① 没有专属插画素材的角色不会崩（artOptional 那套机制原样保留）', () => {
  // 甲）参数层面：给一个**根本不在角色表里**的键（＝图还没画的 boss），照样只写 URL、不抛错
  mount('jotaro');
  const { played, cut } = cast('jotaro', 'ora', { fighter: 'unpainted_boss' });
  assert.equal(played, true, '★ 素材缺不缺都不影响"播"这件事（浏览器画不出来而已，不会崩）');
  assert.equal(cut.style.backgroundImage, 'url("assets/out/cutins/unpainted_boss.webp")');

  // 乙）机制层面：main.js 仍在按 artOptional 过滤"素材缺失"警告（别把它删了）
  assert.match(MAIN_SRC, /filter\(key => !CHARACTER_ART\[key\]\.artOptional\)/, '★ 缺失警告仍按 artOptional 过滤');
  assert.match(MAIN_SRC, /image\.onerror = \(\) => \{ artMissing\.push\(url\); resolve\(\); \}/, '加载失败只记一笔、不抛错');

  // 丙）插画 URL 就是"结算与动画共用"的那一张
  for (const key of Object.keys(CHARACTER_ART)) assert.equal(cutin(key), `assets/out/cutins/${key}.webp`, `${key} 的插画路径`);
});
