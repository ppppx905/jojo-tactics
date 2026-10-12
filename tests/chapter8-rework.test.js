/**
 * ★★ 第八章「皇帝与吊死者」——**2026-10-03 用户拍板的四条新要求**的回归（本次改版的最后一轮）。
 *
 * 四条要求（原文口径，数值一律不许改）：
 *   ① **第一阶段改成"和皇帝打完"**：不再"打到半血就结束"，**把他血打空才算赢**（正常胜负）。
 *      → 从阶段 1 那一幕上撤掉 `phaseWin`；**引擎里那套"打到半血即胜"的机制代码保留**，
 *        只是这一章不再用。他那些技能（瞄准／皇帝／自动冷枪）因此才有时间用出来。
 *   ② **皇帝（`emperor`）改成 PvP 可选角色**：`FIGHTERS.emperor` 去掉 `boss: true`，
 *      于是他会出现在选人列表里、真人也能亲手用他那两个技能；
 *      `geil`（J·凯尔）**仍然保持 `boss: true`、不进列表**（阶段 2 的敌人）。
 *   ③ **读/打顺序由用户授权我定**：读第 1–2 段 → 打皇帝 → **只读第 3 段** → 打吊死者 →
 *      读第 4–6 段。（收益：第 5 段的"封镜＋阿布德尔中弹"落在**两场之后**，不再提前泄露阶段 2。）
 *   ④ **台词全部改写成"剧情向"**：**一句游戏机制词都不许有**，只写人物与剧情；
 *      每幕仍然 4 句（start / turn2 / half / death），三条硬规矩照旧（尤其**不抢战后正文**）。
 *
 * ★★★ **2026-10-03 第四条用户要求（本次改版）**：**阶段 1 改成"注定打不过"的剧情战**——
 *    原作里阿布德尔替波鲁纳雷夫挡下那一枪而死，所以这一场玩家**赢不了**。它**推翻了上面 ① 里
 *    "把他血打空才算赢"那半句、也推翻了 ③ 的读取顺序**，这个文件里跟着改的只有四块：
 *      · `①` 两条：改成"打不死他（剧本保护到 1）＋ 波波半血触发 ＋ 判玩家战败 ＋ AI 也能走到触发点"；
 *      · `③` 两条：读取顺序改成 读 1–2 段 → 打皇帝 → 读 **3、5** 段 → 打吊死者 → 读 **4、6** 段
 *        （不连续的切法用 `scene.parts`，六段仍然各读一次）；
 *      · `⑤` 两条：阶段 1 的胜负口径与结算理由（不再和阶段 2 相同）。
 *    ② （皇帝是 PvP 可选角色）与 ④（台词口径）**一个字都没动**。
 *    必败剧情战本身的完整回归（幕级加成／剧本保护／触发点／剧情继续／演出零机制词）在
 *    `tests/chapter8-scripted-loss.test.js`。
 *
 * ⚠️ 这个文件是**新增**的：它不重复 `chapter8-phases.test.js`（一章两场／按幕阵容旗标／章节完成口径）、
 *    `sniper.test.js`（冷枪）、`mirrors.test.js`（反光点）、`emperor.test.js`（章节入口与数值）、
 *    `emperor-skills.test.js`（两个技能）的既有覆盖，只守这四条新要求。
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { Game, FIGHTERS, STORY_CHAPTERS, playableFighters, isBoss, skillSetFor } from '../src/core/game.js';
import { storySceneAt } from '../src/ui/story.js';
import { STORY } from '../src/ui/story.js';
import { chooseAI, playAIAction } from '../src/core/ai.js';
import { hexDist } from '../src/core/hex.js';

function seeded(seed = 13) { return () => ((seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0) / 4294967296); }
const SEEDS = [13, 7919, 9421, 20261003, 555];
const chapter8 = STORY_CHAPTERS.find(c => c.id === 'chapter-8');
/** 两幕战斗——**按阵容认**，不写死下标。 */
const phase1 = chapter8.scenes.find(scene => scene.kind === 'battle' && scene.lineup?.enemy === 'emperor');
const phase2 = chapter8.scenes.find(scene => scene.kind === 'battle' && scene.lineup?.enemy === 'geil');
const battleIndexes = chapter8.scenes.map((scene, index) => (scene.kind === 'battle' ? index : -1)).filter(i => i >= 0);
/** 故事弧 `emperor` 的 6 段正文（切片断言按它算，别手抄一遍文本）。 */
const PARAGRAPHS = STORY.find(item => item.id === 'emperor').paragraphs;

/** 按某一幕的阵容开一局（＝ main.js 里 startStoryMatch + startMatch 那一套的等价写法）。 */
function open(scene, { seed = 13, events = null } = {}) {
  const game = new Game({ random: seeded(seed), onEvent: event => events?.push(event) });
  game.setRoster({ p1b: scene.lineup.ally || null, p2b: scene.lineup.enemy2 || null, story: true, scene });
  assert.equal(game.start(scene.lineup.player, scene.lineup.enemy, 'ai', { story: chapter8.id }), true);
  return game;
}
const emperorUnit = game => game.s.units.find(u => u.slot === 'p2' && u.kind === 'user');
const bladeOf = game => game.s.units.find(u => u.slot === 'p1' && u.kind === 'stand');
/** 把某枚棋子挪到贴着目标的空地上（测试里造"够得着"的局面用）。 */
function standNextTo(game, unit, target) {
  const spot = game.near(game.tile(target)).find(n => !game.occupant(n) && !game.isRock(n));
  Object.assign(unit, { row: spot.row, col: spot.col });
  return unit;
}

// ===================== ① 阶段 1：注定打不过的剧情战 =====================

test('① 阶段 1 是"注定打不过"的剧情战：他打不死、波波掉到一半就触发、判玩家战败', () => {
  const events = [];
  const game = open(phase1, { events });
  assert.equal(game.phaseWinRule(), null, '★ 这一幕上没有"打到半血即胜"的数据（那是判玩家胜的一套）');
  const emperor = emperorUnit(game);
  const blade = standNextTo(game, bladeOf(game), emperor);
  game.s.turn = 'p1';

  // ① 打他：照常掉血（**但**有剧本保护，见下一条）
  const dmg = game.preview(blade, emperor).damage;
  assert.ok(dmg > 0, '他这一场打得伤');
  assert.equal(game.attack(blade, emperor), true);
  assert.equal(game.s.hp.p2, FIGHTERS.emperor.hp - dmg, '血照常掉');
  assert.equal(game.s.phase, 'battle', '打他不会结束这一场');

  // ② 剧本保护：打到底也是 1（他这一场不能被玩家杀死——否则会出现"把他打死了却还要演他救场"的矛盾）
  game.s.hp.p2 = 1;
  const own = game.s.units.find(u => u.slot === 'p1');
  game.damage(own, 1, { side: 'p2', slot: 'p2', source: '测试' });
  assert.equal(game.s.hp.p2, 1, '★ 血最低停在 1');
  game.s.turn = 'p1';
  assert.equal(game.attack(blade, emperor), true, '照常能出手');
  assert.equal(game.s.hp.p2, 1, '★ 打到底也还是 1：他打不死');
  assert.equal(game.s.phase, 'battle', '★ 这一场还在打');

  // ③ 触发点：**波波掉到一半**（含正好一半）→ 演出 → 这一场立刻结束、判玩家战败
  game.s.hp.p1 = 21;
  game.s.turn = 'p2';
  assert.equal(game.damage(own, 1, { side: 'p2', slot: 'p2', source: '测试' }), 1);
  assert.equal(game.s.hp.p1, 20, '（前提）正好一半也触发');
  assert.equal(game.storyLossDone(), true, '★ 触发剧情');
  assert.equal(game.s.phase, 'battle', '★ 判负交给 checkEnd()（伤害结算中途不提前终局）');
  assert.equal(game.checkEnd(), true);
  assert.equal(game.s.phase, 'result');
  assert.equal(game.s.winner, 'p2', '★★ 判的是**玩家战败**');
  assert.match(game.s.resultReason, /阿布德尔挡下了那一枪/, '★ 结算理由就是那场演出');
  assert.equal(game.s.hp.p2 >= 1, true, '★ 收场时他也没被打倒（剧本保护）');
  const banner = events.find(event => event.type === 'storyloss');
  assert.ok(banner, '★ 「大字横幅」那条演出事件要在');
  assert.equal(banner.kicker, '那一枪');
  assert.equal(banner.title, '阿布德尔挡下了它');
  assert.equal(events.some(event => event.type === 'phasewin'), false, '★ 不是 phaseWin 那一套');
});

test('① AI 自动打阶段 1：多种子都从"剧情触发"收场，他一次都没被打倒（多种子）', () => {
  for (const seed of SEEDS) {
    const events = [];
    const game = open(phase1, { seed, events });
    let guard = 0, lowest = Infinity;
    while (game.s.phase === 'battle' && guard++ < 900) {
      const plan = chooseAI(game);
      if (!plan || !playAIAction(game, plan)) game.endTurn();
      lowest = Math.min(lowest, game.s.hp.p2);
    }
    const tag = `阶段 1 seed ${seed}`;
    assert.ok(guard < 900, `★ ${tag}：这局没打完（走了 ${guard} 步）`);
    assert.equal(game.s.phase, 'result', `${tag}：要收场`);
    assert.equal(game.s.winner, 'p2', `★ ${tag}：必败剧情战——玩家赢不了`);
    assert.equal(game.storyLossDone(), true, `${tag}：★ 靠剧情触发收场（不是谁的血归零）`);
    assert.match(game.s.resultReason, /阿布德尔挡下了那一枪/, `${tag}：★ 结算是剧情那一条`);
    assert.ok(lowest >= 1, `${tag}：★ 全程他的血都没归零过（剧本保护）`);
    assert.ok(game.s.hp.p1 * 2 <= FIGHTERS.polnareff.hp, `${tag}：★ 触发时波波确实掉到了一半`);
    assert.equal(events.some(event => event.type === 'phasewin'), false, `${tag}：全程没有 phasewin`);
  }
  // 触发点确实被走到过（不是靠别的东西收场）
  const probe = open(phase1, { seed: 13 });
  probe.s.hp.p1 = FIGHTERS.polnareff.hp / 2;
  assert.equal(probe.checkEnd(), true, '★ 正好一半时 checkEnd() 就收场');
  assert.equal(probe.s.winner, 'p2');
});

test('① **引擎里那套"打到半血即胜"的机制代码原样保留**（只是这一章不再声明它）', () => {
  const game = open(phase1);
  for (const fn of ['phaseWinRule', 'phaseWinIfNeeded', 'phaseWinDone']) {
    assert.equal(typeof game[fn], 'function', `★ ${fn}() 必须还在（用户：机制代码保留）`);
  }
  // 临时给这一幕一份 phaseWin 数据：机制照旧跑（触发 → 夹血到 1 → 横幅 → checkEnd 判玩家胜）
  const events = [];
  const kept = new Game({ random: seeded(13), onEvent: event => events.push(event) });
  kept.setRoster({ p1b: null, p2b: null, story: true, scene: phase1 });
  kept.start(phase1.lineup.player, phase1.lineup.enemy, 'ai', { story: chapter8.id });
  kept.s.story = { ...kept.s.story, phaseWin: {
    slot: 'p2', hpRatio: 0.5, reason: '打到半血 · 这一场结束',
    banner: { kicker: '踢', title: '标题', tail: '尾巴' },
  } };
  const emperor = emperorUnit(kept);
  kept.s.hp.p2 = FIGHTERS.emperor.hp / 2;
  assert.equal(kept.phaseWinIfNeeded(emperor), true, '★ 声明了 phaseWin 就照旧触发');
  assert.equal(kept.s.hp.p2, 1, '★ 触发那一击照旧把血夹到 1');
  assert.equal(kept.phaseWinDone(), true);
  assert.equal(kept.checkEnd(), true);
  assert.equal(kept.s.winner, 'p1');
  assert.equal(kept.s.resultReason, '打到半血 · 这一场结束');
  const banner = events.find(event => event.type === 'phasewin');
  assert.ok(banner && banner.title === '标题' && banner.tail === '尾巴', '★ 演出横幅那条链路也在');
  // ⚠️ 但是：章节数据里**没有任何一幕**声明它了（第一章那一幕也没有）
  for (const scene of chapter8.scenes) assert.equal(scene.phaseWin, undefined, '★ 这一章不再用 phaseWin');
  // main.js 的 phasewin 横幅接线（静态检查）也照旧留着
  const main = fs.readFileSync(new URL('../src/main.js', import.meta.url), 'utf8');
  assert.match(main, /event\.type === 'phasewin'/, '★ 界面那条接线不该被删');
});

// ===================== ② 皇帝是 PvP 可选角色 =====================

test('② 皇帝进了选人列表：playableFighters() 有 emperor，而 geil 仍然没有', () => {
  const list = playableFighters().map(f => f.key);
  assert.equal(list.includes('emperor'), true, '★ 皇帝必须出现在选人列表里');
  assert.equal(list.includes('geil'), false, '★ J·凯尔仍然不进列表（阶段 2 的敌人）');
  assert.equal(FIGHTERS.emperor.boss, undefined, '★ 数据上照旧去掉 boss 标记');
  assert.equal(FIGHTERS.geil.boss, true, '★ geil 保持 boss: true');
  assert.equal(isBoss('emperor'), false);
  assert.equal(isBoss('geil'), true);
  assert.equal(list.length, 9, '可选角色 9 名（皇帝 + 东方仗助）');
  assert.equal(new Set(list).size, list.length, '列表里不该有重复');
});

test('② 真人能在自由对局里真的选中他、并亲手放出「瞄准」与「皇帝」', () => {
  // ⚠️⚠️ 2026-10-05 用户拍板加了第三个技能「暗枪」（`SKILLS.darkgun`）之后，下面**这两处数组被直接推翻**
  //    （技能表从两个变三个）。除这两个数组以外，本条其余断言一个字没动
  //    ——"真人能在自由对局里亲手放「瞄准」与「皇帝」"这件事照旧成立，也是这一条真正要守的东西。
  // ⚠️⚠️ 同一天用户又拍板第二条：**「皇帝」与「暗枪」换位置** → `['aim','darkgun','emperor']`
  //    （「皇帝」升到第三格，于是它跟着吃"第三技能播大招插画"那条规则）。同样只改这两个数组。
  const SKILL_SET = ['aim', 'darkgun', 'emperor'];
  assert.deepEqual(skillSetFor('emperor'), SKILL_SET, '他那三个技能就是这一份，顺序也是用户定的');
  const game = new Game({ random: seeded(13) });
  assert.equal(game.start('emperor', 'polnareff', 'ai'), true, '★ 自由对局里他能当 p1（真人亲手玩）');
  assert.equal(game.s.fighters.p1.key, 'emperor');
  assert.deepEqual(game.skills('p1'), SKILL_SET, '他那三个技能在场上真的挂上了');
  const gun = game.s.units.find(u => u.slot === 'p1' && u.kind === 'user');
  const foe = game.s.units.find(u => u.slot === 'p2' && u.kind === 'stand');
  // ★★ 2026-10-05 棋盘 14×11 → 18×13：开局的相对距离变远了（两人的使者间距 5 → 7 格），
  //    而「皇帝」的射程是 5 —— 于是**开局时他射程里一个敌人都没有**，`beginSkill` 会照章返回 false
  //    （那不是 bug，是 `skillReason` 里"射程内没有可锁定的敌人"那条）。这里把出手者摆到射程内再放技能，
  //    下面每一条断言（能选中、能放、锁定落到自己挑的那一枚上）一个字都没改。
  const inRange = game.tiles.find(t => hexDist(t, game.tile(foe)) === 4 && !game.occupant(t));
  Object.assign(gun, { row: inRange.row, col: inRange.col });
  game.select(gun.id);
  // ① 「瞄准」：1 AP、点了就生效
  assert.equal(game.beginSkill(gun, 'aim'), true, '★ 真人能亲手放「瞄准」');
  assert.equal(game.s.aimCharges.p1, 2, '接下来两次攻击无视防御');
  // ② 「皇帝」：自己选一个单位锁定（走 select → emperorLock 那条既有链路）
  game.select(gun.id);
  assert.equal(game.beginSkill(gun, 'emperor'), true, '★ 真人能亲手放「皇帝」');
  assert.equal(game.s.pendingSkill, 'emperor');
  assert.equal(game.emperorLock(foe), true);
  assert.ok(game.s.emperorMark.p2, '锁定落到他自己挑的那一个单位上');
  assert.equal(game.emperorMarks().length, 1);
});

test('② 皇帝也能当自由对局 2v2 的第二个角色（第二角色判定跟着放宽），geil 仍然不行', () => {
  assert.equal(Game.secondUsable('emperor'), true, '★ 他不再是剧情专属：可以当第二个角色');
  assert.equal(Game.secondUsable('geil'), false, '★ geil 依旧不许');
  const game = new Game({ random: seeded(13) });
  game.setRoster({ p1b: 'kakyoin', p2b: 'emperor' });
  assert.equal(game.start('jotaro', 'polnareff', 'hotseat'), true, '2v2 自由对局能开');
  assert.deepEqual(game.s.slots, ['p1', 'p1b', 'p2', 'p2b']);
  assert.equal(game.s.fighters.p2b.key, 'emperor');
  // 对照组：geil 当第二个角色照样被拒
  const bad = new Game({ random: seeded(13) });
  bad.setRoster({ p1b: 'kakyoin', p2b: 'geil' });
  assert.equal(bad.start('jotaro', 'polnareff', 'hotseat'), false, '★ 剧情 boss 仍然不能当第二个角色');
  assert.match(bad.s.notice?.text || '', /可选角色/);
});

test('② 选人界面上真的能点到他（假 DOM 跑一遍 renderDraft）', async () => {
  const previous = globalThis.document;
  const elements = new Map();
  const make = id => ({
    id, innerHTML: '', textContent: '', className: '', style: {}, dataset: {}, attributes: {},
    classList: { toggle() {}, add() {}, remove() {}, contains: () => false },
    setAttribute(k, v) { this.attributes[k] = String(v); }, getAttribute(k) { return this.attributes[k] ?? null; },
    hasAttribute(k) { return k in this.attributes; }, removeAttribute(k) { delete this.attributes[k]; },
    addEventListener() {}, removeEventListener() {}, focus() {}, blur() {}, closest: () => null,
    querySelector: () => make(`${id}-child`), querySelectorAll: () => [],
    insertAdjacentHTML(_, html) { this.innerHTML += html; },
    appendChild() {}, contains: () => true,
    getBoundingClientRect: () => ({ left: 0, top: 0, width: 100, height: 100, bottom: 100, right: 100 }),
  });
  globalThis.document = {
    getElementById: id => { if (!elements.has(id)) elements.set(id, make(id)); return elements.get(id); },
    querySelector: () => make('query'), querySelectorAll: () => [], createElement: () => make('created'),
    addEventListener() {}, removeEventListener() {}, activeElement: null, body: make('body'),
  };
  try {
    const { renderDraft } = await import('../src/ui/hud.js');
    renderDraft({ p1: 'jotaro', p2: 'dio', mode: 'ai' });
    const html = elements.get('draftP1').innerHTML;
    assert.match(html, /data-fighter="emperor"/, '★ 选人列表里要有皇帝那一格（用户要求：真人能亲手用）');
    assert.match(html, /data-fighter="iggy"/, '对照：正常角色照旧在列表里');
    assert.equal(html.includes('data-fighter="geil"'), false, '★ 剧情 boss 仍然不能出现在列表里');
    assert.equal(html.includes('data-fighter="gray_fly"'), false, '★ 别的剧情 boss 也不许出现');
    assert.match(elements.get('buildTag').textContent, /共 9 名角色/);
    // 选到他那一位时，页头的"定位标签"也不能再写着"剧情 boss"（那与"能选他"自相矛盾）
    renderDraft({ p1: 'emperor', p2: 'dio', mode: 'ai' });
    const head = elements.get('draftP1').innerHTML;
    assert.equal(/剧情 boss/.test(head), false, '★ 可选角色的定位标签不许再写"剧情 boss"');
    assert.match(head, /外圈枪手/, '他的定位照旧写"外圈枪手"');
  } finally {
    if (previous === undefined) delete globalThis.document; else globalThis.document = previous;
  }
});

// ===================== ③ 读 / 打顺序 =====================

test('③ 顺序＝读 1-2 段 → 打皇帝 → 读 3、5 段 → 打吊死者 → 读 4、6 段', () => {
  assert.deepEqual(chapter8.scenes.map(s => s.kind), ['read', 'battle', 'read', 'battle', 'read'],
    '★ 读 → 打 → 读 → 打 → 读');
  assert.equal(battleIndexes.length, 2);
  assert.deepEqual(phase1.lineup, { player: 'polnareff', enemy: 'emperor' }, '第一场是皇帝');
  assert.deepEqual(phase2.lineup, { player: 'polnareff', ally: 'kakyoin', enemy: 'geil' }, '第二场是吊死者');
  // 每一页读到的**段落**（★ 中间与战后都是**不连续的两段**，所以看解析视图里的 `parts`）
  const views = chapter8.scenes.map((_, index) => storySceneAt(chapter8, index));
  assert.deepEqual(views[0].parts, [[0, 2]], '★ 战前＝第 1–2 段');
  assert.deepEqual(views[2].parts, [[2, 3], [4, 5]], '★ 中间＝第 3 段 ＋ 第 5 段');
  assert.deepEqual(views[4].parts, [[3, 4], [5, 6]], '★ 战后＝第 4 段 ＋ 第 6 段');
  // 六段正文一段不漏、也不重复读（顺序是 1、2、3、5、4、6）
  const read = views.filter(v => !v.isBattle).flatMap(v => v.parts)
    .flatMap(([from, upto]) => [...Array(upto - from).keys()].map(i => from + i));
  assert.deepEqual([...read].sort((a, b) => a - b), [0, 1, 2, 3, 4, 5], '★ 六段正好各读一次');
  assert.deepEqual(read, [0, 1, 2, 4, 3, 5], '★ 读的顺序：1、2 → 3、5 → 4、6');
  // 页面的解析视图与数据一致
  assert.deepEqual(views[0].paragraphs, PARAGRAPHS.slice(0, 2));
  assert.deepEqual(views[2].paragraphs, [PARAGRAPHS[2], PARAGRAPHS[4]], '★ 中间那一页＝第 3 段 ＋ 第 5 段');
  assert.deepEqual(views[4].paragraphs, [PARAGRAPHS[3], PARAGRAPHS[5]], '★ 战后那一页＝第 4 段 ＋ 第 6 段');
  assert.equal(views[1].isBattle, true);
  assert.equal(views[3].isBattle, true);
  // 按钮：读到底＝「开始对决」，最后一页＝「完成本章」
  assert.deepEqual(views.map(v => v.button.action), ['battle', 'battle', 'battle', 'battle', 'end']);
});

test('③ ★ 阿布德尔倒下那一段（第 5 段）落在**两场之间**，而"敌人成对出现"的总结（第 4 段）落在战后', () => {
  const mid = storySceneAt(chapter8, 2);            // 中间那一页（第 3 段 ＋ 第 5 段）
  const after = storySceneAt(chapter8, 4);          // 战后那一页（第 4 段 ＋ 第 6 段）
  const midText = mid.paragraphs.join('');
  const afterText = after.paragraphs.join('');
  // 第 3 段＝复仇心与照看（正文原文里的关键词）
  assert.match(midText, /等这一天等了很久|阿布德尔明白这种心情/, '★ 中间读到"复仇心与照看"那一段');
  // ★★★ 2026-10-03 第四条用户拍板：**阿布德尔的死就发生在阶段 1 之后**，所以第 5 段（他替你挡下
  //    那一枪、皇帝逃走）跟着第 3 段挪到**两场之间**读——演出与正文紧接着，衔接得上。
  for (const piece of ['倒下了', '子弹还是命中了他']) {
    assert.equal(midText.includes(piece), true, `★ 中间那一页要读到"${piece}"（那是阶段 1 之后的事）`);
    assert.equal(afterText.includes(piece), false, `★ 战后那一页不必再重复"${piece}"（各段只读一次）`);
  }
  // 第 4 段（敌人成对出现的总结）留在战后
  assert.equal(midText.includes('敌人开始成对出现'), false, '★ 第 4 段留在战后（它是对两场的总结）');
  assert.equal(afterText.includes('敌人开始成对出现'), true);
  // 第 6 段（开枪的人逃了出去）也在战后
  assert.equal(midText.includes('逃了出去'), false, '★ 第 6 段留在战后');
  assert.equal(afterText.includes('逃了出去'), true);
  // ★ 战斗中的**台词**一个字都不许提前说这件事（该说的交给触发时那条横幅与紧接着的正文）
  const barks = Object.values(chapter8.barks).concat(Object.values(phase2.barks));
  for (const line of barks) {
    assert.equal(/阿布德尔/.test(line.text), false, `★ 台词里不许有阿布德尔：${line.text}`);
  }
});

// ===================== ④ 台词：一句机制词都没有 =====================

/**
 * ★★ 用户点名的机制词（2026-10-03 第四条）：**封镜 / 镜面 / 反光点 / 行动点 / 血量 / 技能 /
 *   回合 / 冷却**"之类"——所以这张表里是这个八个，加上同一类的近义写法与棋盘／数值术语。
 * ⚠️ 加词只往严里加：宁可让写台词的人换一种说法，也不许把机制说明搬进人物口中。
 */
const MECHANIC_WORDS = [
  // 用户点名的八个（含"之类"的同类写法）
  '封镜', '镜面', '镜中', '镜子', '反光点', '反光', '倒影',
  '行动点', '血量', '血条', '共享生命', '生命值', '半血',
  '技能', '回合', '冷却',
  // 同一类：棋盘／数值／战斗机制术语
  '射程', '瞄准', '锁定', '弹道', '冷枪', '真实伤害', '无视防御',
  '防御力', '攻击力', '机制', '规则', '格子', '棋盘', '棋子', '胜负', '结算',
  'AP', 'CD', 'HP',
];

test('④ 所有台词都是"剧情向"：用词表扫一遍每一句，一个机制词都不许有', () => {
  // 两份台词都要扫：章节级 `barks`（＝ BARKS['chapter-8']，阶段 1）＋ 阶段 2 那一幕的整份覆盖。
  const sets = [
    ['章节默认（= BARKS[\'chapter-8\']，阶段 1：波鲁纳雷夫 对 皇帝）', chapter8.barks],
    ['阶段 2（幕上整份覆盖：波鲁纳雷夫 & 花京院 对 吊死者）', phase2.barks],
  ];
  for (const [label, barks] of sets) {
    assert.deepEqual(Object.keys(barks).sort(), ['death', 'half', 'start', 'turn2'],
      `${label}：必须正好是 start / turn2 / half / death 四句`);
    for (const [key, line] of Object.entries(barks)) {
      assert.ok(line.who && line.text, `${label} 的 ${key}：要有 who 与 text`);
      assert.equal(typeof line.text, 'string');
      assert.ok(line.text.trim().length >= 4, `${label} 的 ${key}：台词不能是空的`);
      // ★ 核心断言：词表扫一遍，命中就报是哪个词
      const hit = MECHANIC_WORDS.filter(word => line.text.includes(word));
      assert.deepEqual(hit, [], `${label} 的 ${key} 里出现了机制词：${hit.join('、')} ——「${line.text}」`);
      // 机制词还有一类是"数字＋单位"（射程五格 / 10 点伤害 / 1 AP）：台词里不该出现战斗数值
      assert.equal(/\d/.test(line.text), false,
        `${label} 的 ${key} 里出现了数字（战斗数值不该写进台词）：「${line.text}」`);
    }
  }
  // 两份不是同一份（阶段 2 是整份覆盖）
  assert.notDeepEqual(Object.values(chapter8.barks).map(l => l.text),
    Object.values(phase2.barks).map(l => l.text));
});

test('④ 台词守住三条硬规矩：说话人对、口吻对、不抢战后正文', () => {
  const one = Object.values(chapter8.barks);
  const two = Object.values(phase2.barks);
  // ① 阶段 1 是波鲁纳雷夫单挑霍尔·霍斯：说话人只能是他俩（阿布德尔不在场）
  assert.deepEqual([...new Set(one.map(l => l.key))].sort(), ['emperor', 'polnareff'],
    '★ 阶段 1 只有波鲁纳雷夫与霍尔·霍斯开口');
  // 霍尔·霍斯是"自信、爱耍嘴皮子的佣兵"：他那句要有那股自信（用原文关键词钉住口径）
  const hh = one.find(l => l.key === 'emperor');
  assert.match(hh.text, /从来不打偏|别急/, '★ 佣兵那股油滑的自信要留在他的台词里');
  // 波鲁纳雷夫是"为妹妹复仇、又傲又不服输"的人
  assert.ok(one.some(l => /妹妹/.test(l.text)), '★ 波鲁纳雷夫的台词要落在"妹妹"这件仇上');
  // ② 阶段 2：花京院在场（阿布德尔已经不在），击倒那句是 J·凯尔
  assert.deepEqual([...new Set(two.map(l => l.key))].sort(), ['geil', 'kakyoin', 'polnareff'],
    '★ 阶段 2 的说话人是波鲁纳雷夫、花京院与 J·凯尔');
  assert.equal(two.find(l => l.key === 'geil').who, 'J·凯尔', '击倒那句要说清是谁在说');
  // ③ 三条硬规矩之一：**不抢战后正文**——阿布德尔中弹与"开枪的人逃了出去"一个字都不许有
  for (const line of [...one, ...two]) {
    for (const spoiled of ['阿布德尔', '挡下', '中弹', '逃了出去', '不在了']) {
      assert.equal(line.text.includes(spoiled), false,
        `★ 台词不许提前说战后正文的事："${spoiled}" ——「${line.text}」`);
    }
  }
  // ④ 说话人都取得到立绘（key 是角色 id，写错只会显示破图）
  for (const line of [...one, ...two]) {
    if (!line.key) continue;
    assert.ok(FIGHTERS[line.key], `台词 key=${line.key} 取不到角色数据`);
  }
  // ⑤ 章节级 `barks` 必须保留（tests/strength.test.js 有一条跨章结构断言要求每章 4 句）
  assert.ok(chapter8.barks, '★ 章节级 barks 不许删（幕上用整份覆盖的写法）');
});

test('④ 改写后的四句台词在这一章真的都播得出来（每幕仍然 4 句、各播一次）', () => {
  for (const [label, scene] of [['阶段 1', phase1], ['阶段 2', phase2]]) {
    const seen = [];
    const game = new Game({ random: seeded(13), onEvent: event => { if (event.type === 'bark') seen.push(event.key); } });
    game.setRoster({ p1b: scene.lineup.ally || null, p2b: scene.lineup.enemy2 || null, story: true, scene });
    assert.equal(game.start(scene.lineup.player, scene.lineup.enemy, 'ai', { story: chapter8.id }), true);
    assert.deepEqual(seen, ['start'], `${label}：开局播一句`);
    // 走完一轮回到 p1 的**第 2 个回合**
    for (let i = 0; i < game.s.slots.length; i++) game.endTurn();
    assert.equal(game.roundNumber(), 2, `${label}：（前提）这时是第 2 轮`);
    assert.deepEqual(seen, ['start', 'turn2'], `${label}：第 2 回合播一句`);
    // 半血：玩家共享生命首次 ≤ 一半
    const half = Math.floor(FIGHTERS.polnareff.hp / 2);
    game.s.hp.p1 = half + 1;
    game.damage(game.s.units.find(u => u.slot === 'p1'), 1, { source: '测试' });
    assert.equal(game.s.hp.p1, half);
    assert.ok(seen.includes('half'), `${label}：半血时播一句`);
    // 击倒对手：玩家打赢才有（这里直接收尾，与 tests/strength.test.js 同一套写法）
    game.endGame('p1', '测试');
    assert.ok(seen.includes('death'), `${label}：打赢时播"击倒对手"那一句`);
    assert.deepEqual([...seen].sort(), ['death', 'half', 'start', 'turn2'], `${label}：四句各播一次`);
    assert.equal(seen.length, 4, `${label}：不会重复播`);
  }
});

// ===================== ⑤ 两场 AI 都能自动打完 =====================
test('⑤ 两场 AI 都能自动打完（多种子、机制不串场、不许死循环）', () => {
  for (const [name, scene] of [['阶段 1 · 对皇帝', phase1], ['阶段 2 · 对吊死者', phase2]]) {
    for (const seed of SEEDS) {
      const events = [];
      const game = open(scene, { seed, events });
      let guard = 0;
      while (game.s.phase === 'battle' && guard++ < 900) {
        const plan = chooseAI(game);
        if (!plan || !playAIAction(game, plan)) game.endTurn();
        // 机制旗标不许串场：阶段 1 永远没有反光点，阶段 2 永远没有弹道
        if (scene.lineup.enemy === 'emperor') assert.deepEqual(game.s.mirrors, []);
        else assert.equal(game.s.shotAim, null);
      }
      const tag = `${name} seed ${seed}`;
      assert.ok(guard < 900, `★ ${tag}：这局没打完（走了 ${guard} 步，说明卡住了）`);
      assert.equal(game.s.phase, 'result', `${tag}：要分出胜负`);
      assert.ok(['p1', 'p2'].includes(game.s.winner), `${tag}：胜负落在某一队上`);
      // ★★★ 2026-10-03 第四条改版：阶段 1 是**必败剧情战**——玩家永远赢不了它，
      //    收场靠剧情触发，而且他全程不会被玩家打倒（剧本保护）。
      //    （旧写法在这里断言的是"判胜＝把他的血打空"，那条口径已经被推翻。）
      if (scene.lineup.enemy === 'emperor') {
        assert.equal(game.s.winner, 'p2', `★ ${tag}：必败剧情战——玩家赢不了`);
        assert.equal(game.s.storyLoss, true, `${tag}：★ 收场靠剧情触发`);
        assert.ok(game.s.hp.p2 >= 1, `${tag}：★ 他全程没被打倒（剧本保护到 1）`);
      }
      if (game.s.winner === 'p1' && scene.lineup.enemy === 'geil') {
        assert.ok(game.s.hp.p2 <= 0, `${tag}：打倒 J·凯尔才赢`);
      }
      assert.equal(events.some(event => event.type === 'phasewin'), false, `${tag}：不该有 phasewin 演出`);
    }
  }
});

test('⑤ 两场连起来跑一遍（打完皇帝接着打吊死者）都能收尾，各自的胜负口径各就各位', () => {
  const runOne = scene => {
    const game = open(scene, { seed: 4242 });
    let guard = 0;
    while (game.s.phase === 'battle' && guard++ < 900) {
      const plan = chooseAI(game);
      if (!plan || !playAIAction(game, plan)) game.endTurn();
    }
    assert.equal(game.s.phase, 'result', `${scene.lineup.enemy} 这一场要打完`);
    return game;
  };
  const first = runOne(phase1);
  const second = runOne(phase2);
  assert.ok(['p1', 'p2'].includes(first.s.winner) && ['p1', 'p2'].includes(second.s.winner));
  // ★★★ 2026-10-03 第四条改版：两场的结算理由**不再相同**——
  //   阶段 1 是必败剧情战（理由＝那场演出），阶段 2 仍然是"谁的血归零谁输"。
  assert.equal(first.s.winner, 'p2', '★ 阶段 1 判玩家战败');
  assert.match(first.s.resultReason, /阿布德尔挡下了那一枪/, '★ 阶段 1 的结算是剧情那一条');
  assert.equal(second.s.resultReason, '共享生命归零', '★ 阶段 2 走"谁的血归零谁输"那一套');
});
