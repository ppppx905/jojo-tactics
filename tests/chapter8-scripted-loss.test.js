/**
 * ★★★ 第八章阶段 1「必败剧情战」的回归（2026-10-03 用户第四条要求，**这一版的核心改版**）。
 *
 * 用户原话的口径（数值一律不许改）：原作里**阿布德尔替波鲁纳雷夫挡下那一枪而死**，
 * 所以「波波 vs 皇帝」这一场**玩家赢不了**。三样东西都是**幕级数据**（不改 `FIGHTERS` 的基础数值）：
 *   · `scene.buff`     ＝本场加成：他**攻击 +4、防御 +2** → 这一场是 **7→11、1→3**
 *                        （⚠️ 2026-10-05 用户把他**基础防御 2 → 1** 之后，这一场从 4 变成 **3**；
 *                        幕上那份加成本身照旧是 `def: 2`，变的是基数）；
 *   · `scene.hpFloor`  ＝剧本保护：他本场**不会被玩家杀死**，血最低停在 1
 *                        （不然会出现"把他打死了却还要演他救场"的矛盾）；
 *   · `scene.storyLoss`＝触发点：**波鲁纳雷夫掉到半血以下（≤ 50%，含正好一半）**时演出 →
 *                        这一场**立刻结束、判玩家战败**，但**剧情照常往下走**（不是"重打这一场"）。
 *
 * 演出沿用既有的"大字横幅 ＋ 结算弹窗理由"那套：那一枪 → 阿布德尔扑上来挡下、倒下 → 皇帝趁乱撤退。
 * 读取顺序（用户第四条授权我定）：战前 1、2 段 → 打皇帝 → 中间 3、5 段 → 打吊死者 → 战后 4、6 段。
 *
 * ⚠️ 这个文件是**新增**的：它按验收标准 ①–⑥ 逐条守这次改版，不重复
 *    `chapter8-phases.test.js`（一章两场／按幕阵容旗标）、`emperor.test.js`（章节入口与数值）、
 *    `sniper.test.js`（冷枪）、`emperor-skills.test.js`（两个技能）、`mirrors.test.js`（反光点）。
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { Game, FIGHTERS, STORY_CHAPTERS } from '../src/core/game.js';
import { storySceneAt } from '../src/ui/story.js';
import { STORY } from '../src/ui/story.js';
import { chooseAI, playAIAction } from '../src/core/ai.js';

function seeded(seed = 13) { return () => ((seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0) / 4294967296); }
const SEEDS = [13, 7919, 9421, 20261003, 555, 4242, 1, 2, 3];
const chapter8 = STORY_CHAPTERS.find(c => c.id === 'chapter-8');
/** 两幕战斗——**按阵容认**，不写死下标。 */
const phase1 = chapter8.scenes.find(scene => scene.kind === 'battle' && scene.lineup?.enemy === 'emperor');
const phase2 = chapter8.scenes.find(scene => scene.kind === 'battle' && scene.lineup?.enemy === 'geil');
const PHASE1_AT = chapter8.scenes.indexOf(phase1);
const PARAGRAPHS = STORY.find(item => item.id === 'emperor').paragraphs;

/** 按某一幕的阵容开一局（＝ main.js 里 startStoryMatch + startMatch 那一套的等价写法）。 */
function open(scene, { seed = 13, events = null } = {}) {
  const game = new Game({ random: seeded(seed), onEvent: event => events?.push(event) });
  game.setRoster({ p1b: scene.lineup.ally || null, p2b: scene.lineup.enemy2 || null, story: true, scene });
  assert.equal(game.start(scene.lineup.player, scene.lineup.enemy, 'ai', { story: chapter8.id }), true);
  return game;
}
const emperorUnit = game => game.s.units.find(u => u.slot === 'p2' && u.kind === 'user');
const ownUnit = game => game.s.units.find(u => u.slot === 'p1' && u.kind === 'user');
/** 走完一整局（两边都交给 AI 代打）。 */
function autoPlay(game, cap = 900) {
  let guard = 0;
  while (game.s.phase === 'battle' && guard++ < cap) {
    const plan = chooseAI(game);
    if (!plan || !playAIAction(game, plan)) game.endTurn();
  }
  assert.ok(guard < cap, `这一局没打完（走了 ${guard} 步）`);
  return guard;
}
const mainSource = () => fs.readFileSync(new URL('../src/main.js', import.meta.url), 'utf8');

// ===================== ① 本场加成 vs 基础数值 =====================

test('① 本场加成生效：他这一场攻击 11／防御 3，而基础数据一个字没动', () => {
  // 先记下基础数据（这条断言就是"幕级加成不许污染 FIGHTERS"的那把尺）
  const base = { hp: FIGHTERS.emperor.hp, def: FIGHTERS.emperor.def, dmg: FIGHTERS.emperor.user.dmg };
  assert.deepEqual(base, { hp: 40, def: 1, dmg: 7 }, '（前提）基础数值照用户拍板：血 40 / 防 1 / 攻 7');

  const game = open(phase1);
  const emperor = emperorUnit(game);
  // ① 这一场：攻击 7 → **11**、防御 1 → **3**
  assert.equal(game.s.fighters.p2.user.dmg, 11, '★ 本场他的普攻攻击力是 11（7 + 4）');
  assert.equal(game.baseDefense('p2'), 3, '★ 本场他的基础防御是 3（1 + 2）');
  assert.equal(game.unitAttack(emperor), 11, '★ 界面上读到的那份也一样是 11（棋子自己的 dmg）');
  assert.equal(game.defense(emperor).total >= 3, true, '★ 结算口径里他的防御至少是 3（地形加成另算）');
  // 打出去真的按 11 算：波波本体防御 2 → 净伤 9
  const victim = ownUnit(game);
  assert.equal(game.preview(emperor, victim).attack, 11, '★ 预览里的攻击力就是 11');
  assert.equal(game.s.fighters.p2.hp, 40, '血量不在加成里（用户只说攻 +4、防 +2）');
  assert.deepEqual([emperor.move, emperor.range], [FIGHTERS.emperor.user.move, FIGHTERS.emperor.user.range],
    '★ 移动与射程照旧（其余不动）');
  // ② 幕级：加成只长在**这一幕**上，而且是一份拷贝（原始数据不是同一个对象）
  assert.notEqual(game.s.fighters.p2, FIGHTERS.emperor, '★ 并进 s.fighters 的是一份拷贝');
  assert.deepEqual(phase1.buff, { slot: 'p2', atk: 4, def: 2 }, '★ 加成是幕级数据（scene.buff）');
  assert.equal(phase2.buff, undefined, '★ 阶段 2 没有加成');
  assert.deepEqual({ hp: FIGHTERS.emperor.hp, def: FIGHTERS.emperor.def, dmg: FIGHTERS.emperor.user.dmg }, base,
    '★★ 跑完这一场之后，FIGHTERS 里的基础数值**一个字都没动**');

  // ③ 自由对局里他还是原本的强度：7／1
  const free = new Game({ random: seeded(13) });
  assert.equal(free.start('polnareff', 'emperor', 'ai'), true);
  assert.equal(free.s.fighters.p2.user.dmg, 7, '★★ 自由对局里他还是攻击 7');
  assert.equal(free.baseDefense('p2'), 1, '★★ 自由对局里他的基础防御是 1（2026-10-05 拍板 2 → 1）');
  assert.equal(free.unitAttack(free.s.units.find(u => u.slot === 'p2')), 7);
  assert.equal(free.buff, undefined, '自由对局没有幕级加成');
  // 而且自由对局里他**打得死**（剧本保护没有跟出来）
  const hisUnit = free.s.units.find(u => u.slot === 'p2');
  free.s.hp.p2 = 1;
  free.damage(hisUnit, 99, { side: 'p1', slot: 'p1', source: '测试' });
  assert.equal(free.s.hp.p2, 0, '★ 自由对局里没有剧本保护');
});

test('① 加成走的是"通用写法"：换一个槽位／换一个角色也照样生效（不按角色名硬编码）', () => {
  const game = open(phase1);
  // 临时把加成挪到 p1 上（用一份同样的数据）——引擎不该只认 emperor
  game.s.story = { ...game.s.story, buff: { slot: 'p1', atk: 3, def: 1 } };
  game.s.fighters.p1 = FIGHTERS.polnareff;                     // 复原成原始数据再套一次
  const buffed = game.applySceneBuff('p1');
  assert.equal(buffed.def, FIGHTERS.polnareff.def + 1, '★ 防御加成照着数据走');
  assert.equal(buffed.stand.dmg, FIGHTERS.polnareff.stand.dmg + 3, '★ 双单位角色的替身也吃同一份额外加成');
  assert.equal(buffed.user.dmg, FIGHTERS.polnareff.user.dmg, '★ 本来没有普攻的使者**不会**被加成凭空造出一个普攻');
  assert.equal(FIGHTERS.polnareff.stand.dmg, 7, '★ 原始数据依旧不动');
  assert.equal(FIGHTERS.polnareff.def, 2);
  // 没声明的槽位不动
  assert.equal(game.applySceneBuff('p1b'), null);
  assert.equal(game.sceneBuff('p2b'), null);
  // 数组写法（一场给多个槽位）也认
  game.s.story = { ...game.s.story, buff: [{ slot: 'p2', atk: 1 }, { slot: 'p1', def: 2 }] };
  assert.deepEqual(game.sceneBuff('p1'), { slot: 'p1', def: 2 });
  assert.equal(game.sceneBuff('p2b'), null);
});

// ===================== ② 剧本保护：他不会被玩家杀死 =====================

test('② 剧本保护：他这一场的血最低停在 1，打到底也是 1', () => {
  const game = open(phase1);
  const emperor = emperorUnit(game);
  assert.equal(game.hpFloor('p2'), 1, '★ 这一场 p2 的血下限是 1');
  // ① 直接打 99 点：血停在 1（而不是 0）
  assert.equal(game.damage(emperor, 99, { side: 'p1', slot: 'p1', source: '测试' }), FIGHTERS.emperor.hp - 1,
    '★ 报出来的掉血量是"打掉的那些"（不会报 −99）');
  assert.equal(game.s.hp.p2, 1, '★ 血最低停在 1');
  assert.equal(game.s.phase, 'battle', '这一场照常继续');
  // ② 打到只剩 1 血之后：普攻真的打得出去、但掉不了血（预览里的"血 → 血"就是 1 → 1）
  game.s.hp.p2 = 1;
  const blade = game.s.units.find(u => u.slot === 'p1' && u.kind === 'stand');
  const spot = game.near(game.tile(emperor)).find(n => !game.occupant(n) && !game.isRock(n));
  Object.assign(blade, { row: spot.row, col: spot.col });
  game.s.turn = 'p1';
  const pv = game.preview(blade, emperor);
  assert.equal(pv.hp, 1);
  assert.equal(pv.hpAfter, 1, '★ 预览里这一下掉不了血（血量停在 1）');
  assert.equal(pv.dealt, 0, '★ 实际掉血是 0');
  assert.equal(pv.lethal, false, '★ 不是致命一击');
  assert.equal(pv.wins, false, '★ 打不死他');
  // ⚠️ `damage` 仍是"按攻击力算出来的那个数"（它要喂给吸血等既有链路，不许被夹小）
  assert.equal(pv.damage, Math.max(1, game.unitAttack(blade) - pv.defense.total));
  assert.equal(game.attack(blade, emperor), true, '照常能出手');
  assert.equal(game.s.hp.p2, 1, '★ 打到底也还是 1');
  assert.equal(game.s.phase, 'battle');
  // ③ 别的幕／别的模式没有这道保护
  const two = open(phase2);
  assert.equal(two.hpFloor('p2'), null, '★ 阶段 2 没有剧本保护');
  two.s.hp.p2 = 1;
  two.damage(two.s.units.find(u => u.slot === 'p2' && u.kind === 'user'), 99, { side: 'p1', slot: 'p1', source: '测试' });
  assert.equal(two.s.hp.p2, 0, '★ 阶段 2 照常能被打倒');
  const free = new Game({ random: seeded(13) });
  free.start('polnareff', 'emperor', 'ai');
  assert.equal(free.hpFloor('p2'), null, '自由对局没有血下限');
});

// ===================== ③ 触发点：半血 → 立刻收场、判玩家战败、剧情继续 =====================

test('③ 波波掉到半血（含正好一半）→ 这一场立刻结束、判玩家战败', () => {
  const events = [];
  const game = open(phase1, { events });
  const own = ownUnit(game);
  // ① 差一点（21）：什么都不该发生
  game.s.hp.p1 = 21;
  game.damage(own, 0, { side: 'p2', slot: 'p2', source: '测试' });
  assert.equal(game.storyLossDone(), false, '★ 高于一半不触发');
  assert.equal(game.checkEnd(), false, '★ 这一场继续打');
  assert.equal(game.s.phase, 'battle');
  // ② **正好一半**（20）：立刻触发演出 + 判负
  game.s.hp.p1 = 21;
  assert.equal(game.damage(own, 1, { side: 'p2', slot: 'p2', source: '测试' }), 1);
  assert.equal(game.s.hp.p1, 20, '（前提）正好是一半');
  assert.equal(game.storyLossDone(), true, '★ 正好一半也触发（口径与全局"半血"一致）');
  assert.equal(game.s.phase, 'battle', '★ 伤害结算中途不提前终局（判负交给 checkEnd）');
  assert.equal(game.checkEnd(), true);
  assert.equal(game.s.phase, 'result', '★ 立刻结束这一场');
  assert.equal(game.s.winner, 'p2', '★★ 判的是玩家**战败**');
  assert.equal(game.s.resultReason, phase1.storyLoss.reason, '★ 结算理由就是那条演出文案');
  assert.equal(game.s.storyLoss, true, '旗标落在对局状态上（界面用它决定按钮）');
  // ③ 掉到一半**以下**同样触发（另一个对局，一次打掉更多）
  const deep = open(phase1, { seed: 7919 });
  deep.s.hp.p1 = 25;
  deep.damage(ownUnit(deep), 20, { side: 'p2', slot: 'p2', source: '测试' });
  assert.equal(deep.s.hp.p1, 5, '（前提）掉到一半以下');
  assert.equal(deep.storyLossDone(), true, '★ 半血以下也触发');
  assert.equal(deep.checkEnd(), true);
  assert.equal(deep.s.winner, 'p2');
  // ④ 演出永远只触发一次、只播一条横幅
  assert.equal(deep.storyLossIfNeeded(), false, '已经触发过就不再触发');
  game.storyLossIfNeeded();
  assert.equal(events.filter(event => event.type === 'storyloss').length, 1, '★ 一条横幅，不重复播');
});

test('③ ★ 判负之后**剧情能继续**：下一幕是正文（不是重打这一场）', () => {
  // ① 引擎侧：这一场只是"这一场"结束——数据里它后面接着的是**正文那一页**
  const after = storySceneAt(chapter8, PHASE1_AT + 1);
  assert.equal(after.isBattle, false, '★ 阶段 1 之后是正文（中间那页）');
  assert.equal(after.button.action, 'battle', '★ 那页的按钮是「开始对决」＝接着打阶段 2（不是收摊、更不是重打）');
  assert.deepEqual(after.parts, [[2, 3], [4, 5]], '★ 那一页读的正是第 3、5 段');
  // ② 一步一步走下去能走到「完成本章」（剧情整条链路是通的）
  const walk = [];
  let index = 0, view = storySceneAt(chapter8, index), guard = 0;
  while (view && guard++ < 50) {
    walk.push(view.button.action);
    if (view.nextIndex < 0) break;
    index = view.nextIndex;
    view = storySceneAt(chapter8, index);
  }
  assert.deepEqual(walk, ['battle', 'battle', 'battle', 'battle', 'end'], '★ 两场打完读到最后一页才是"完成本章"');
  // ③ 界面侧（静态检查）：结算页把 `s.storyLoss` 与"打赢了"**走同一条路**——
  //    按钮是「继续 / 下一场」、收起「返回标题」，绝不落到下面那条"再战一场"上。
  const main = mainSource();
  assert.match(main, /const storyForward = winner === 'p1' \|\| !!s\.storyLoss;/,
    '★ 必败剧情战要和"打赢了"共用同一条"剧情继续"的路');
  assert.match(main, /if \(chapterIndex >= 0 && storyForward\) \{/);
  const forwardAt = main.indexOf('if (chapterIndex >= 0 && storyForward) {');
  const retryAt = main.indexOf("retry.textContent = '再战一场'");
  assert.ok(forwardAt >= 0 && retryAt > forwardAt, '★ "再战一场"必须在剧情继续那条路的**后面**（够不着它）');
  const branch = main.slice(forwardAt, retryAt);
  assert.match(branch, /showLeave\(false\)/, '★ 这一场输了也不给「返回标题」——只留一个继续推进剧情的按钮');
  assert.match(branch, /showStoryStage\(chapterIndex, after\.index\)/, '★ 点「继续」接着演下一幕正文');
  assert.match(branch, /retry\.textContent = after && !after\.isBattle \? '继续' : '完成本章';/);
  // ④ 那条演出在界面上真的有一条接线（与「伪装破裂」共用大字横幅）
  assert.match(main, /event\.type === 'storyloss'/, '★ 缺少这条演出的界面接线');
  const at = main.indexOf("event.type === 'storyloss'");
  assert.match(main.slice(at, at + 600), /showUnmaskBanner\(\{ kicker: event\.kicker, title: event\.title, tail: event\.tail \}\)/,
    '★ 演出走的就是那套"大字横幅"');
  // ⑤ 结算弹窗的标题也要按剧情口径（不然会写着"P2 胜利"，与"剧情到此为止"自相矛盾）
  assert.match(main, /s\.storyLoss[\s\S]{0,120}剧情 · /, '★ 结算标题按 `s.storyLoss` 换成剧情口径');
});

// ===================== ④ 演出文案：横幅出现、零机制词 =====================

/**
 * ★ 用户点名的机制词（与 `chapter8-rework.test.js` 同一张表：**只许往严里加**）。
 * 这次多守一样东西：**演出文案**（横幅三行 ＋ 结算理由）也一律不许出现它们。
 */
const MECHANIC_WORDS = [
  '封镜', '镜面', '镜中', '镜子', '反光点', '反光', '倒影',
  '行动点', '血量', '血条', '共享生命', '生命值', '半血',
  '技能', '回合', '冷却',
  '射程', '瞄准', '锁定', '弹道', '冷枪', '真实伤害', '无视防御',
  '防御力', '攻击力', '机制', '规则', '格子', '棋盘', '棋子', '胜负', '结算',
  'AP', 'CD', 'HP',
];

test('④ 演出横幅与结算理由都在，而且一个机制词、一个数字都没有', () => {
  const events = [];
  const game = open(phase1, { events });
  game.s.hp.p1 = FIGHTERS.polnareff.hp / 2;
  assert.equal(game.checkEnd(), true);
  const banner = events.find(event => event.type === 'storyloss');
  assert.ok(banner, '★ 演出横幅必须出现');
  // 三行字都在（＝那条横幅的固定版式）
  assert.ok(banner.kicker && banner.title && banner.tail, '★ 横幅的三行字都要有');
  assert.match(banner.title, /阿布德尔挡下了它/, '★ 三个节拍之一：阿布德尔扑上来替他挡下');
  assert.match(banner.tail, /他倒下了/, '★ 三个节拍之二：阿布德尔倒下了');
  assert.match(banner.tail, /趁乱撤走/, '★ 三个节拍之三：皇帝趁乱撤退');
  // 词表扫一遍（横幅的三行 + 引擎那条日志 + 结算理由 + 引擎那条提示）
  const lines = [
    ['横幅 kicker', banner.kicker], ['横幅 title', banner.title], ['横幅 tail', banner.tail],
    ['演出日志', banner.text], ['结算理由', game.s.resultReason],
    ['演出提示', phase1.storyLoss.notice],
  ];
  for (const [label, text] of lines) {
    assert.ok(text, `${label} 不能是空的`);
    const hit = MECHANIC_WORDS.filter(word => text.includes(word));
    assert.deepEqual(hit, [], `${label} 里出现了机制词：${hit.join('、')} ——「${text}」`);
    assert.equal(/\d/.test(text), false, `${label} 里出现了数字（战斗数值不该写进演出）：「${text}」`);
  }
  // ⚠️ 也别把这几个"剧情向"的关键词写成机制说明：演出是**叙事**，不是规则提示
  assert.equal(/回合|结算|胜负/.test(banner.title + banner.tail), false, '演出文案要像旁白，不像规则提示');
});

test('④ 阶段 1 的台词照旧"剧情向、零机制词"，而且不提前剧透阿布德尔挡枪', () => {
  const barks = chapter8.barks;
  for (const [key, line] of Object.entries(barks)) {
    const hit = MECHANIC_WORDS.filter(word => line.text.includes(word));
    assert.deepEqual(hit, [], `台词 ${key} 里出现了机制词：${hit.join('、')} ——「${line.text}」`);
    assert.equal(/\d/.test(line.text), false, `台词 ${key} 里出现了数字：「${line.text}」`);
    // ★ 用户点名：**不许提前说阿布德尔会来救他／会中弹**
    for (const spoiled of ['阿布德尔', '挡下', '中弹', '扑上来', '救', '逃了出去', '不在了']) {
      assert.equal(line.text.includes(spoiled), false, `★ 台词不许剧透"${spoiled}" ——「${line.text}」`);
    }
  }
  // 说话人还是那两位（阿布德尔不在场）
  assert.deepEqual([...new Set(Object.values(barks).map(l => l.key))].sort(), ['emperor', 'polnareff']);
  // ★ 这一场是"打不过"的：波波那几句要写出被压制的味道（用原文关键词钉住口径）
  const mine = Object.values(barks).filter(l => l.key === 'polnareff');
  assert.ok(mine.length >= 2, '（前提）波波要开口');
  assert.ok(mine.some(l => /撑不住/.test(l.text)), '★ 要写出"撑不住了"那种被压制的味道');
  assert.ok(mine.some(l => /妹妹/.test(l.text)), '★ 也要留住"为妹妹复仇"这件仇');
  // 佣兵那股油滑的自信照旧
  assert.match(barks.turn2.text, /从来不打偏|别急/);
});

test('④ 半血那句台词与演出是同一条链路：先播台词、紧接着才是横幅（都只播一次）', () => {
  const events = [];
  const game = open(phase1, { events });
  const seen = events.length;              // 开局那条 bark('start') 不算
  game.s.hp.p1 = 21;                       // 还差一点到一半
  game.damage(ownUnit(game), 2, { side: 'p2', slot: 'p2', source: '测试' });
  assert.equal(game.s.hp.p1, 19, '（前提）这一下把波波打到一半以下');
  game.checkEnd();
  const kinds = events.slice(seen).filter(event => ['bark', 'storyloss'].includes(event.type)).map(event => event.type);
  assert.deepEqual(kinds, ['bark', 'storyloss'], '★ 先台词、后横幅（顺序反了玩家会读不到台词）');
  assert.equal(events.slice(seen).find(event => event.type === 'bark').key, 'half', '★ 播的是"半血"那一句');
});

// ===================== ⑤ 文章顺序（六段各一次） =====================

test('⑤ 顺序＝读 1-2 段 → 打皇帝 → 读 3、5 段 → 打吊死者 → 读 4、6 段', () => {
  assert.deepEqual(chapter8.scenes.map(scene => scene.kind), ['read', 'battle', 'read', 'battle', 'read'],
    '★ 读 → 打 → 读 → 打 → 读');
  assert.equal(chapter8.scenes[PHASE1_AT].lineup.enemy, 'emperor', '★ 中间那场是打皇帝');
  assert.equal(chapter8.scenes[PHASE1_AT + 2].lineup.enemy, 'geil', '★ 最后一页前面那场是打吊死者');
  const views = chapter8.scenes.map((_, index) => storySceneAt(chapter8, index));
  // 每一页读到的**段落**：战前 1–2、中间 3＋5、战后 4＋6
  assert.deepEqual(views[0].parts, [[0, 2]], '★ 战前＝第 1、2 段');
  assert.deepEqual(views[2].parts, [[2, 3], [4, 5]], '★ 中间＝第 3 段 ＋ 第 5 段');
  assert.deepEqual(views[4].parts, [[3, 4], [5, 6]], '★ 战后＝第 4 段 ＋ 第 6 段');
  assert.deepEqual(views[0].paragraphs, PARAGRAPHS.slice(0, 2));
  assert.deepEqual(views[2].paragraphs, [PARAGRAPHS[2], PARAGRAPHS[4]], '★ 中间那页就是第 3、5 段（原文）');
  assert.deepEqual(views[4].paragraphs, [PARAGRAPHS[3], PARAGRAPHS[5]], '★ 战后那页就是第 4、6 段（原文）');
  // 六段**各读一次**（不漏、也不重复）
  const read = views.filter(view => !view.isBattle).flatMap(view => view.parts)
    .flatMap(([from, upto]) => [...Array(upto - from).keys()].map(i => from + i));
  assert.deepEqual([...read].sort((a, b) => a - b), [0, 1, 2, 3, 4, 5], '★ 第 1–6 段一段不漏');
  assert.deepEqual(read, [0, 1, 2, 4, 3, 5], '★ 读的先后：1、2 → 3、5 → 4、6');
  // 阿布德尔的死（第 5 段）在**阶段 1 之后**、阶段 2 之前；"敌人成对出现"（第 4 段）在战后
  assert.ok(views[2].paragraphs.join('').includes('倒下了'), '★ 第 5 段落在两场之间（阿布德尔的死紧随其后）');
  assert.ok(views[4].paragraphs.join('').includes('敌人开始成对出现'), '★ 第 4 段落在战后（对两场的总结）');
  // 按钮：每一页都推进得下去，最后一页才是「完成本章」
  assert.deepEqual(views.map(view => view.button.action), ['battle', 'battle', 'battle', 'battle', 'end']);
  // ⚠️ 老章节（一个 parts 都没写）的解析**逐值不变**
  const chapter7 = STORY_CHAPTERS.find(c => c.id === 'chapter-7');
  const source7 = STORY.find(item => item.id === chapter7.scenes[0].readId).paragraphs;
  const legacy = storySceneAt(chapter7, 0);
  assert.deepEqual(legacy.paragraphs, source7.slice(0, 3), '★ 没用 parts 的老章节照旧按 from/upto 切');
  assert.deepEqual(legacy.paragraphs, source7.slice(chapter7.scenes[0].from || 0, chapter7.scenes[0].upto));
  assert.deepEqual(legacy.parts, [[0, 3]], '★ 老写法在解析视图里等价成一条区间');
});

// ===================== ⑥ 两场 AI 都能自动收尾 =====================

test('⑥ 阶段 1（必败）：多种子下 AI 代打都能走到触发点、判玩家战败、他一次没被打倒', () => {
  for (const seed of SEEDS) {
    const events = [];
    const game = open(phase1, { seed, events });
    let lowest = Infinity, ownLowest = Infinity;
    let guard = 0;
    while (game.s.phase === 'battle' && guard++ < 900) {
      const plan = chooseAI(game);
      if (!plan || !playAIAction(game, plan)) game.endTurn();
      lowest = Math.min(lowest, game.s.hp.p2);
      ownLowest = Math.min(ownLowest, game.s.hp.p1);
    }
    const tag = `阶段 1 seed ${seed}`;
    assert.ok(guard < 900, `★ ${tag}：没走到触发点（走了 ${guard} 步，说明卡住了）`);
    assert.equal(game.s.phase, 'result', `${tag}：这一场要收场`);
    assert.equal(game.s.winner, 'p2', `★ ${tag}：必败剧情战——玩家赢不了`);
    assert.equal(game.storyLossDone(), true, `${tag}：★ 收场靠的是剧情触发`);
    assert.match(game.s.resultReason, /阿布德尔挡下了那一枪/, `${tag}：★ 结算理由是那条演出`);
    assert.ok(game.s.hp.p1 * 2 <= FIGHTERS.polnareff.hp, `${tag}：触发时波波确实掉到了一半`);
    assert.ok(ownLowest > 0, `${tag}：他不会被打到 0（触发先于被打光）`);
    assert.ok(lowest >= 1, `${tag}：★ 皇帝全程没被打倒（剧本保护）`);
    assert.equal(events.filter(event => event.type === 'storyloss').length, 1, `${tag}：演出只播一次`);
    assert.equal(events.some(event => event.type === 'phasewin'), false, `${tag}：不该有 phasewin`);
    assert.equal(game.keySlot(), 'p2', '关键槽位口径照旧（阶段 2 还要用它）');
  }
});

test('⑥ 阶段 2 照旧能被 AI 自动打完（必败那一场没有把这一章带坏）', () => {
  for (const seed of SEEDS) {
    const game = open(phase2, { seed });
    autoPlay(game);
    const tag = `阶段 2 seed ${seed}`;
    assert.equal(game.s.phase, 'result', `${tag}：要分出胜负`);
    assert.ok(['p1', 'p2'].includes(game.s.winner), `${tag}：胜负落在某一队上`);
    assert.equal(game.storyLossDone(), false, `${tag}：★ 必败剧情战只属于阶段 1，不许串场`);
    assert.equal(game.s.storyLoss, false);
    if (game.s.winner === 'p1') assert.ok(game.s.hp.p2 <= 0, `${tag}：打倒 J·凯尔才赢`);
  }
});

test('⑥ 两场连着跑（打完必败的皇帝接着打吊死者）都不卡死', () => {
  const first = open(phase1, { seed: 4242 });
  autoPlay(first);
  assert.equal(first.s.winner, 'p2');
  const second = open(phase2, { seed: 4242 });
  // 两场是两局**全新的对局**：开第二场时它是满血开局（上一场打掉的、触发的都不带过来）
  assert.equal(second.s.hp.p2, FIGHTERS.geil.hp, '第二场是新的一局（血量是满的）');
  assert.equal(second.storyLossDone(), false, '★ 上一场的剧情旗标不带过来');
  assert.equal(second.s.winner, null);
  autoPlay(second);
  assert.equal(second.s.phase, 'result');
  assert.equal(second.storyLossDone(), false, '★ 必败剧情战只属于阶段 1');
});
