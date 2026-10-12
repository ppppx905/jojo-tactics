/**
 * ★★ 第八章「皇帝与吊死者」的**两阶段改版**（2026-10-03 用户拍板）。
 *
 * 规格文档：`design/第八章-两阶段改版.md`（它**覆盖** `第八章设计草案.md` 里"单场战斗／三人同场"
 * 那部分；数值与两条机制的出处仍看草案）。这一章从"一场"改成"两场"：
 *
 *   ① 战前正文（第 1–2 段）→ ② **阶段 1：波鲁纳雷夫 单挑 皇帝**（阿布德尔不上场、皇帝可被打伤、
 *      **把他的血打空才算赢**、场边冷枪在这一场生效）
 *   → ③ 中间正文（**只读第 3 段**：波鲁纳雷夫的复仇心与阿布德尔的照看）→ ④ **阶段 2：波鲁纳雷夫 ＋
 *      电脑控制的花京院 对 吊死者**（反光点在这一场生效、打倒 J·凯尔即胜）→ ⑤ 战后正文（第 4–6 段）。
 *
 * ⚠️⚠️ **2026-10-03 第三条用户拍板**（这个文件里被它直接推翻的断言）：
 *   · 阶段 1 的胜负口径：**半血 → 打空血**（幕上的 `phaseWin` 撤掉了，引擎里那套机制代码**保留**）；
 *   · 幕数：`['read','battle','read','read','battle','read']` → `['read','battle','read','battle','read']`
 *     （中间只读第 3 段，第 4–6 段整体挪到两场之后）。
 *   其余（一章两场、按幕阵容与旗标、章节完成的口径）一个字都没动。
 *
 * ⚠️⚠️⚠️ **2026-10-03 第四条用户拍板**（阶段 1 改成"注定打不过"的剧情战）又推翻了上面第一条的
 *   **一半**，这个文件里跟着改的只有四处（其余一个字没动）：
 *   · `② 阶段 1` 整条：从"打空血才判胜"改成 **"打不死他（剧本保护到 1）＋ 波波半血触发 ＋ 判玩家战败"**；
 *   · `⑥ 引擎侧`：阶段 1 的收尾理由不再是"共享生命归零"，而是**那条剧情演出**；
 *   · `⑥ 章节完成`：战后那一页从"第 4–6 段"改成 **`parts: [[3,4],[5,6]]`**（第 4 段 ＋ 第 6 段）；
 *   · `① 一章两场` 里那段"段落区间"的算法改用 `parts`（不连续的切法 `from`/`upto` 表达不了）。
 *   幕数、按幕阵容与旗标、章节完成的口径**都没变**。必败剧情战的完整回归在
 *   `tests/chapter8-scripted-loss.test.js`。
 *
 * 这个文件守的是"两阶段"这件事本身（引擎的一章多场、按幕声明阵容与旗标、章节完成的口径）；
 * 两条机制各自的细节回归在 `mirrors.test.js` / `sniper.test.js`，章节入口与 boss 数值在
 * `emperor.test.js`。
 *
 * ⚠️ 这个文件是**新增**的，不改任何既有断言。
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { Game, FIGHTERS, STORY_CHAPTERS, SNIPER } from '../src/core/game.js';
import { storySceneAt, storyBattleScene } from '../src/ui/story.js';
import { chooseAI, playAIAction } from '../src/core/ai.js';

function seeded(seed = 13) { return () => ((seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0) / 4294967296); }
const chapter8 = STORY_CHAPTERS.find(c => c.id === 'chapter-8');
/** 两幕战斗（阶段 1 / 阶段 2）——**按阵容认**，不写死下标。 */
const phase1 = chapter8.scenes.find(scene => scene.kind === 'battle' && scene.lineup?.enemy === 'emperor');
const phase2 = chapter8.scenes.find(scene => scene.kind === 'battle' && scene.lineup?.enemy === 'geil');
const battleIndexes = chapter8.scenes.map((scene, index) => (scene.kind === 'battle' ? index : -1)).filter(i => i >= 0);

/** 按某一幕的阵容开一局（＝ main.js 里 startStoryMatch + startMatch 那一套的等价写法）。 */
function open(scene, { seed = 13, events = null } = {}) {
  const game = new Game({ random: seeded(seed), onEvent: event => events?.push(event) });
  game.setRoster({ p1b: scene.lineup.ally || null, p2b: scene.lineup.enemy2 || null, story: true, scene });
  assert.equal(game.start(scene.lineup.player, scene.lineup.enemy, 'ai', { story: chapter8.id }), true);
  return game;
}
const emperorUnit = game => game.s.units.find(u => u.slot === 'p2' && u.kind === 'user');
const ghostOf = game => game.s.units.find(u => u.slot === 'p2' && u.kind === 'stand');
const bladeOf = game => game.s.units.find(u => u.slot === 'p1' && u.kind === 'stand');
/** 把某枚棋子挪到贴着目标的空地上（测试里造"够得着"的局面用）。 */
function standNextTo(game, unit, target) {
  const spot = game.near(game.tile(target)).find(n => !game.occupant(n) && !game.isRock(n));
  Object.assign(unit, { row: spot.row, col: spot.col });
  return unit;
}

// ===================== ① 一章两场 =====================

test('① 一章里能连打两场：两个 battle 幕、各自阵容不同、中间夹着正文', () => {
  assert.equal(battleIndexes.length, 2, '★ scenes 里要允许出现两个 {kind:"battle"}');
  const [first, second] = battleIndexes;
  assert.notDeepEqual(phase1.lineup, phase2.lineup, '★ 两场的阵容必须不一样（各带自己的）');
  // 两场之间**夹着正文**（不是连打两场）
  const between = chapter8.scenes.slice(first + 1, second);
  assert.ok(between.length >= 1, '★ 两场之间要有正文');
  assert.ok(between.every(scene => scene.kind === 'read'), '★ 两场之间夹的必须是"读正文"');
  assert.equal(chapter8.scenes[second + 1].kind, 'read', '第二场之后还要有正文（战后）');
  // 读正文的幕用的都是同一个故事弧，且段落**不重复读**（切法见规格文档第四节）
  // ⚠️ 2026-10-03 第四条改版：中间／战后两页读的段落**不连续**（第 3 段＋第 5 段 / 第 4 段＋第 6 段），
  //    所以切法写成了 `parts`（半开区间数组）。这里改用 `parts`（老写法 `from`/`upto` 仍然兼容）。
  const slicesOf = scene => scene.parts || [[scene.from || 0, scene.upto == null ? 6 : scene.upto]];
  const ranges = chapter8.scenes.filter(s => s.kind === 'read').flatMap(slicesOf);
  for (const [from, upto] of ranges) assert.ok(from < upto, `段落区间必须非空：[${from},${upto})`);
  assert.equal(ranges[0][0], 0, '战前从第 1 段开始');
  assert.equal(ranges.at(-1)[1], 6, '战后读到第 6 段结束');
});

test('① storyBattleScene() 算的是"下一场还没打完的那一场"，不再假设一章只有一场', () => {
  const [first, second] = battleIndexes;
  assert.equal(storyBattleScene(chapter8), first, '从头算就是第一场');
  assert.equal(storyBattleScene(chapter8, 0), first);
  assert.equal(storyBattleScene(chapter8, first), first, '光标停在第一场时，算出来的还是它');
  assert.equal(storyBattleScene(chapter8, first + 1), second,
    '★ 第一场打完之后（光标走到中间正文）必须指向**第二场**——旧写法永远指回第一场');
  assert.equal(storyBattleScene(chapter8, second), second, '光标已经在第二场上，还是它');
  assert.equal(storyBattleScene(chapter8, second + 1), -1, '两场都过去了：没有下一场了');
  // 一章只有一场的老章节：口径与改动前完全一样
  for (const chapter of STORY_CHAPTERS) {
    if (chapter.id === 'chapter-8') continue;
    const at = chapter.scenes.findIndex(scene => scene.kind === 'battle');
    assert.equal(storyBattleScene(chapter), at, `${chapter.id}：一章一场时结果不变`);
    assert.equal(storyBattleScene(chapter, at), at);
    assert.equal(storyBattleScene(chapter, at + 1), -1);
  }
});

test('① 剧情页每一幕都能算出"这一场该用谁、按什么规则打"（战前页写第一场、中间页写第二场）', () => {
  const [first, second] = battleIndexes;
  // 战前那一页（第 0 幕）写的是**即将上场**的第一场阵容
  const before = storySceneAt(chapter8, 0);
  assert.deepEqual(before.lineup, phase1.lineup, '★ 战前页写的是阶段 1 的阵容（1v1、没有友军）');
  assert.deepEqual(before.specialRules, phase1.specialRules, '★ 战前页只列阶段 1 的规则（不提前剧透第二场）');
  // 中间那几页写的是**第二场**的阵容与规则
  for (let i = first + 1; i < second; i++) {
    const mid = storySceneAt(chapter8, i);
    assert.equal(mid.isBattle, false);
    assert.deepEqual(mid.lineup, phase2.lineup, `第 ${i} 幕：★ 中间页写的是阶段 2 的阵容（多一个电脑友军）`);
    assert.deepEqual(mid.specialRules, phase2.specialRules, `第 ${i} 幕：★ 中间页列的是阶段 2 的规则`);
  }
  // 战斗幕自己那份
  assert.deepEqual(storySceneAt(chapter8, first).lineup, phase1.lineup);
  assert.deepEqual(storySceneAt(chapter8, second).lineup, phase2.lineup);
  assert.equal(storySceneAt(chapter8, first).isBattle, true);
  // 按钮：读到"后面就是战斗"那一页＝开始对决；中间那一页后面也直接是第二场
  assert.equal(storySceneAt(chapter8, first - 1).button.action, 'battle');
  assert.equal(storySceneAt(chapter8, second - 1).button.action, 'battle');
  assert.equal(storySceneAt(chapter8, first + 1).button.action, 'battle',
    '★ 中间只剩第 3 段那一页，它后面就是阶段 2：按钮是「开始对决」');
  assert.equal(storySceneAt(chapter8, chapter8.scenes.length - 1).button.action, 'end');
  // 一章只有一场的老章节：lineup 退回章节自己的 player/enemy（界面文案与改动前一致）
  const chapter7 = STORY_CHAPTERS.find(c => c.id === 'chapter-7');
  assert.deepEqual(storySceneAt(chapter7, 0).lineup, { player: chapter7.player, enemy: chapter7.enemy });
});

test('① 两场是两局全新的对局：前一场的状态不会带进后一场', () => {
  const one = open(phase1);
  one.s.hp.p2 = 7;                       // 把皇帝打残
  one.s.hp.p1 = 3;
  one.s.mirrors.push({ id: 'x', row: 1, col: 1, sealed: true });   // 塞一个假反光点
  const two = open(phase2);              // 第二场重新开局
  assert.equal(two.s.hp.p2, FIGHTERS.geil.hp, '★ 第二场的血是**新的一局**（不是上一场剩下的）');
  assert.equal(two.s.hp.p1, FIGHTERS.polnareff.hp);
  assert.equal(two.phaseWinDone(), false, '上一场触发过的演出不带过来');
  assert.equal(two.s.mirrors.every(m => !m.sealed), true, '反光点是这一场新撒的，全是亮的');
  assert.equal(two.s.shots, 0, '冷枪计数也是新的');
});

// ===================== ② 阶段 1 =====================

test('② 阶段 1：皇帝能被追能被打伤（旧的两条限制撤掉了）', () => {
  const game = open(phase1);
  assert.deepEqual(game.s.slots, ['p1', 'p2'], '★ 阿布德尔不上场：这一场就是 1v1');
  assert.equal(game.s.units.length, 3, '波鲁纳雷夫 2 枚 + 霍尔·霍斯 1 枚');
  const emperor = emperorUnit(game);
  assert.equal(game.moveRange(emperor), FIGHTERS.emperor.user.move, '★ 他走得动（不再被钉在外圈）');
  assert.ok(game.reachable(emperor).length > 0);
  // 打伤：普攻照常掉血，预览也是真实数字
  const blade = standNextTo(game, bladeOf(game), emperor);
  game.s.turn = 'p1';
  const pv = game.preview(blade, emperor);
  assert.ok(pv.damage > 0, '★ 他打得伤（旧写法是"任何伤害都结算为 0"）');
  const hp0 = game.s.hp.p2;
  assert.equal(game.attack(blade, emperor), true);
  assert.equal(game.s.hp.p2, hp0 - pv.damage, '血真的掉了');
  assert.equal(game.s.phase, 'battle', '掉血照常，这一场继续');
});

test('② 阶段 1：**注定打不过的剧情战**——他打不死、波波半血就收场、判玩家战败（旧口径已推翻）', () => {
  const events = [];
  const game = open(phase1, { events });
  // ★★★ 2026-10-03 第四条用户拍板（推翻上面那条"打到半血即胜"、也推翻第三条的"打空血才算赢"）：
  //    这一场是原作里**阿布德尔替波鲁纳雷夫挡下那一枪而死**的那一战，玩家**赢不了**。
  assert.equal(game.phaseWinRule(), null, '★ 阶段 1 仍然不声明 phaseWin（那是"判玩家胜"的一套）');
  assert.ok(game.storyLossRule(), '★ 阶段 1 声明的是 storyLoss（必败剧情战）');
  const emperor = emperorUnit(game);
  const blade = standNextTo(game, bladeOf(game), emperor);
  game.s.turn = 'p1';
  const dmg = game.preview(blade, emperor).damage;
  assert.ok(dmg > 0);
  // ① 把他打到**正好一半**：他这一场**不吃**这一套（剧本保护只归波波那一侧），血照常掉
  game.s.hp.p2 = 20;                              // 共享生命 40 的一半
  assert.equal(game.attack(blade, emperor), true);
  assert.equal(game.s.hp.p2, 20 - dmg, '血照常掉（他这一场打得伤）');
  assert.equal(game.s.phase, 'battle', '★ 打他不会让这一场结束');
  assert.equal(game.s.winner, null);
  assert.equal(game.checkEnd(), false);
  // ② 打到 1 血：**打不死**（剧本保护），这一场照常继续
  game.s.hp.p2 = 1;
  assert.equal(game.checkEnd(), false, '★ 只剩 1 血也不算赢——他这一场打不倒');
  assert.equal(game.s.phase, 'battle');
  assert.equal(game.phaseWinDone(), false);
  // ③ ★ 触发点是**波波掉到一半**：那一刻这一场立刻结束，而且判的是**玩家战败**
  game.s.hp.p1 = 21;
  game.s.turn = 'p2';
  const own = game.s.units.find(u => u.slot === 'p1');
  assert.equal(game.damage(own, 1, { side: 'p2', slot: 'p2', source: '测试' }), 1);
  assert.equal(game.s.hp.p1, 20, '波波掉到正好一半');
  assert.equal(game.s.storyLoss, true, '★ 触发剧情（含"正好一半"）');
  assert.equal(game.checkEnd(), true, '★ 这一场立刻结束');
  assert.equal(game.s.phase, 'result');
  assert.equal(game.s.winner, 'p2', '★★ 判的是**玩家战败**（不是 phaseWin 那套判胜）');
  assert.match(game.s.resultReason, /阿布德尔挡下了那一枪/, '★ 结算理由就是那场演出');
  const banner = events.find(event => event.type === 'storyloss');
  assert.ok(banner, '★ 要有「大字横幅」那一条演出事件');
  assert.equal(banner.title, '阿布德尔挡下了它');
  // ★ 剧情必须能继续：结算理由不是"重打"，界面侧给的是「继续」（见 chapter8-rework 的接线断言）

  // ④ 边界：他被打到 1 血之后**再也掉不下去**（打到底也是 1）
  const edge = open(phase1);
  const em2 = emperorUnit(edge);
  edge.s.hp.p2 = 1;
  edge.damage(em2, 99, { side: 'p1', slot: 'p1', source: '测试' });
  assert.equal(edge.s.hp.p2, 1, '★ 剧本保护：血最低停在 1');
  assert.equal(edge.s.phase, 'battle', '这一场照常继续');

  // ⑤ ★ 引擎里那套"打到半血即胜"的机制**仍然在**（只是这一章不再用）：临时给它一份数据就能照旧跑
  const kept = open(phase1);
  kept.s.story = { ...kept.s.story, phaseWin: { slot: 'p2', hpRatio: 0.5, reason: '打到半血 · 这一场结束' } };
  assert.equal(kept.phaseWinRule().slot, 'p2', '★ 机制代码没删：声明了 phaseWin 就照旧生效');
  kept.s.hp.p2 = 20;
  assert.equal(kept.phaseWinIfNeeded(emperorUnit(kept)), true, '★ 半血触发演出（机制本身完好）');
  assert.equal(kept.s.hp.p2, 1, '触发那一击照旧把他的血夹到 1');
  assert.equal(kept.phaseWinDone(), true);
});

test('② 阶段 1：冷枪在这一场生效（而且只是这一场）', () => {
  const game = open(phase1);
  assert.equal(game.sniperRule(), SNIPER, '★ 阶段 1 带冷枪');
  assert.equal(game.sniperUnit().slot, 'p2', '枪手就是霍尔·霍斯');
  assert.deepEqual(game.s.mirrors, [], '★ 阶段 1 没有反光点');
  assert.equal(game.s.shotAim, null, '开局还没画弹道');
  for (let i = 0; i < game.s.slots.length; i++) game.endTurn();   // 走完一轮
  assert.ok(game.s.shotAim, '★ 第 1 轮结束就该把弹道画出来');
  assert.equal(game.s.shotAim.shooterId, game.sniperUnit().id);
});

// ===================== ③ 阶段 2 =====================

test('③ 阶段 2：花京院是**电脑控制的友军**（章节写死的席位，允许 2 打 1）', () => {
  const game = open(phase2);
  assert.deepEqual(game.s.slots, ['p1', 'p1b', 'p2'], '★ 玩家两个角色位、敌方一个');
  assert.deepEqual(game.s.control, { p1: 'human', p1b: 'ai', p2: 'ai' },
    '★ 花京院归电脑管，玩家只管波鲁纳雷夫');
  assert.equal(game.isAI('p1b'), true);
  assert.equal(game.teamHasHuman('p1b'), true, '（同一个队里有真人：轮到电脑友军时本队仍然认得"有人在玩"）');
  assert.equal(game.fighters !== undefined, false, '（角色数据挂在 s 上，不挂在 game 上）');
  assert.equal(game.s.fighters.p1b.key, 'kakyoin');
  assert.equal(game.s.hp.p1b, FIGHTERS.kakyoin.hp);
  assert.equal(game.s.units.filter(u => u.slot === 'p1b').length, 2, '花京院有本体 + 绿色法皇两枚');
  assert.equal(game.s.units.filter(u => u.slot === 'p2').length, 2, 'J·凯尔 & 吊死者同样是两枚');
  // AI 只操作自己那一个角色
  game.s.turn = 'p1b';
  const ap = { ...game.s.ap };
  const plan = chooseAI(game);
  assert.ok(plan, '电脑友军必须有决策');
  playAIAction(game, plan);
  assert.ok(game.s.ap.p1b <= ap.p1b - 1, '花京院花掉了自己的行动点');
  assert.equal(game.s.ap.p1, ap.p1, '★ AI 不碰玩家那一个角色');
});

test('③ 阶段 2：反光点生效（吊死者只站在反光点上），而且只是这一场', () => {
  const game = open(phase2);
  assert.equal(game.mirrorRule() !== null, true, '★ 阶段 2 带反光点');
  assert.equal(game.s.mirrors.length, 4, '开局撒 4 个');
  const ghost = ghostOf(game);
  assert.ok(game.mirrorAt(game.tile(ghost)), '★ 吊死者开局就站在一个反光点上');
  assert.equal(game.sniperRule(), null, '★ 阶段 2 没有冷枪');
  assert.equal(game.sniperUnit(), null, '这一场连"放冷枪的人"都不该有');
  // 它落不了普通格子
  game.s.turn = 'p2';
  const plain = game.tiles.find(t => !game.occupant(t) && !game.mirrorAt(t) && !game.isRock(t) && !game.pillarAt(t));
  assert.notEqual(game.moveReason(ghost, plain), '', '普通格子不是它的落点');
  assert.equal(game.moveReason(ghost, plain).includes('反光点'), true, '理由要说清"只能落在反光点上"');
});

test('③ 阶段 2：打倒 J·凯尔即胜（关键槽位口径不变）', () => {
  const game = open(phase2);
  const owner = game.s.units.find(u => u.slot === 'p2' && u.kind === 'user');
  assert.equal(game.keySlot(), 'p2', '这一章的胜负看 p2 那一格');
  assert.equal(game.phaseWinRule(), null, '★ 阶段 2 没有"打到半血即胜"那套（那是阶段 1 的）');
  const blade = standNextTo(game, bladeOf(game), owner);
  game.s.turn = 'p1';
  game.s.hp.p2 = 1;
  assert.equal(game.attack(blade, owner), true);
  assert.equal(game.s.hp.p2, 0, 'J·凯尔被打倒');
  assert.equal(game.s.phase, 'result');
  assert.equal(game.s.winner, 'p1');
  assert.equal(game.s.resultReason.includes('共享生命归零'), true, '★ 这一场的口径是"把血打空"');
});

// ===================== ④ AI 能自己打完两场 =====================

test('④ 两场各自的 AI 都能自动打完（多种子，不许死循环）', () => {
  for (const [name, scene] of [['阶段 1', phase1], ['阶段 2', phase2]]) {
    for (const seed of [13, 7919, 9421, 20261003, 555]) {
      const game = open(scene, { seed });
      let guard = 0;
      while (game.s.phase === 'battle' && guard++ < 900) {
        const plan = chooseAI(game);
        if (!plan || !playAIAction(game, plan)) game.endTurn();
        // 机制旗标在整局里不许"串场"：阶段 1 永远没有反光点，阶段 2 永远没有弹道
        if (scene.lineup.enemy === 'emperor') assert.deepEqual(game.s.mirrors, []);
        else assert.equal(game.s.shotAim, null);
      }
      const tag = `${name} seed ${seed}`;
      assert.ok(guard < 900, `★ ${tag}：这局没打完（走了 ${guard} 步，说明卡住了）`);
      assert.equal(game.s.phase, 'result', `${tag}：要分出胜负`);
      assert.ok(['p1', 'p2'].includes(game.s.winner), `${tag}：胜负落在某一队上`);
      if (game.s.winner === 'p1' && scene.lineup.enemy === 'emperor') {
        assert.equal(game.s.hp.p2, 0, `★ ${tag}：阶段 1 是正常胜负——判胜时他的血是**被打空**的`);
      }
    }
  }
});

test('④ 两场连起来跑（模拟"打完第一场接着打第二场"）也不会卡死', () => {
  const runOne = scene => {
    const game = open(scene, { seed: 4242 });
    let guard = 0;
    while (game.s.phase === 'battle' && guard++ < 900) {
      const plan = chooseAI(game);
      if (!plan || !playAIAction(game, plan)) game.endTurn();
    }
    assert.equal(game.s.phase, 'result', `${scene.lineup.enemy} 这一场要打完`);
    return game.s.winner;
  };
  const first = runOne(phase1);
  const second = runOne(phase2);
  assert.ok(['p1', 'p2'].includes(first) && ['p1', 'p2'].includes(second), '两场都能收尾');
});

// ===================== ⑤ 别的章节不受影响 =====================

test('⑤ 别的章节完全不受影响：仍然是一章一场，s.mirrors 与 s.shotAim 都为空', () => {
  for (const chapter of STORY_CHAPTERS) {
    const battles = (chapter.scenes || []).filter(scene => scene.kind === 'battle').length;
    if (chapter.id === 'chapter-8') assert.equal(battles, 2, '★ 只有第八章是一章两场');
    else assert.equal(battles, 1, `${chapter.id} 仍然是一章一场`);
    if (chapter.id === 'chapter-8') continue;
    assert.equal(chapter.mirrors, undefined, `${chapter.id} 不该有反光点旗标`);
    assert.equal(chapter.sniper, undefined, `${chapter.id} 不该有冷枪旗标`);
    assert.equal(chapter.scenes.every(scene => !scene.lineup), true, `${chapter.id} 不该有按幕阵容`);
  }
  // 真开一局：老章节的 s.mirrors 永远是空数组、s.shotAim 永远是 null
  const chapter7 = STORY_CHAPTERS.find(c => c.id === 'chapter-7');
  const old = new Game({ random: seeded(13) });
  assert.equal(old.start(chapter7.player, chapter7.enemy, 'ai', { story: chapter7.id }), true);
  assert.deepEqual(old.s.slots, ['p1', 'p2']);
  for (let i = 0; i < 12; i++) old.endTurn();
  assert.deepEqual(old.s.mirrors, [], '★ 别的章节一个反光点都没有');
  assert.equal(old.s.shotAim, null, '★ 别的章节一条弹道都没有');
  assert.equal(old.s.shots, 0);
  assert.equal(old.mirrorRule(), null);
  assert.equal(old.sniperRule(), null);
  assert.equal(old.phaseWinRule(), null, '★ "打到半血即胜"是章节数据，别的章节没有');
  // 自由对局（不是剧情模式）同样干净
  const free = new Game({ random: seeded(13) });
  free.start('polnareff', 'emperor', 'ai');
  for (let i = 0; i < 12; i++) free.endTurn();
  assert.deepEqual(free.s.mirrors, []);
  assert.equal(free.s.shotAim, null);
  assert.equal(free.s.story, null, '自由对局没有章节数据，机制一律不生效');
});

test('⑤ 剧情模式的"按幕阵容"不影响自由对局的 2v2 老规矩（仍然绝不做 2 打 1）', () => {
  const half = new Game({ random: seeded(13) });
  half.setRoster({ p1b: 'kakyoin', p2b: null });        // ⚠️ 没有 story:true
  assert.equal(half.start('jotaro', 'dio'), false, '★ 自由对局只给一边＝直接拒绝开局');
  assert.match(half.s.notice.text, /2v2/);
  assert.deepEqual(half.s.slots, ['p1', 'p2']);
  // 而章节写死的席位允许只给一边（阶段 2 正是如此）
  const authored = new Game({ random: seeded(13) });
  authored.setRoster({ p1b: phase2.lineup.ally, p2b: null, story: true, scene: phase2 });
  assert.equal(authored.start(phase2.lineup.player, phase2.lineup.enemy, 'ai', { story: chapter8.id }), true);
  assert.deepEqual(authored.s.slots, ['p1', 'p1b', 'p2']);
});

// ===================== ⑥ 章节完成的口径 =====================

test('⑥ 章节完成＝两场都打完 + 最后一段正文也读完（走到最后一页才是"完成本章"）', () => {
  // 一幕一幕往下走：只有**最后那一幕**给的是"完成本章 / end"
  const walk = [];
  let index = 0, view = storySceneAt(chapter8, index), guard = 0;
  while (view && guard++ < 50) {
    walk.push({ index, kind: view.isBattle ? 'battle' : 'read', action: view.button.action });
    if (view.nextIndex < 0) break;
    index = view.nextIndex;
    view = storySceneAt(chapter8, index);
  }
  assert.equal(guard < 50, true, '不能在这里绕圈');
  // ★★ 2026-10-03 第三条用户拍板：中间**只读第 3 段**（原来还有一页第 5 段），
  //    所以幕数由 6 变 5：读 → 打 → 读 → 打 → 读。
  //    ★★★ 第四条把中间改成**第 3 段 ＋ 第 5 段**、战后改成**第 4 段 ＋ 第 6 段**——幕数仍是 5。
  assert.deepEqual(walk.map(step => step.kind), ['read', 'battle', 'read', 'battle', 'read'],
    '★ 读 → 打 → 读 → 打 → 读');
  assert.deepEqual(walk.map(step => step.action), ['battle', 'battle', 'battle', 'battle', 'end'],
    '★ 只有走完两场、读完最后一段，按钮才是"完成本章"（读到"后面就是战斗"的那一页给的是"开始对决"）');
  assert.equal(walk.filter(step => step.action === 'end').length, 1, '★ "完成本章"全程只出现一次');

  // 打完第一场时，下一幕是**中间正文**（不是"完成本章"）；这是旧写法会算错的地方
  const [first, second] = battleIndexes;
  const afterFirst = storySceneAt(chapter8, first + 1);
  assert.equal(afterFirst.isBattle, false, '★ 第一场之后是正文（不是直接结束章节）');
  assert.equal(afterFirst.button.action, 'battle',
    '★ 中间那一页的后面就是第二场，所以按钮是「开始对决」');
  const afterSecond = storySceneAt(chapter8, second + 1);
  assert.equal(afterSecond.isBattle, false, '第二场之后是战后正文');
  assert.equal(afterSecond.button.action, 'end',
    '★ 战后正文就是最后一页：它的按钮才是"完成本章"（打完第二场只到这一页，还没算通关）');
  assert.equal(afterSecond.nextIndex, -1, '最后一页没有下一幕');
  assert.equal(afterSecond.button.label, '完成本章');
  // 第二场本身要能开打（结算页点「下一场」→ showStoryStage(第二场) → 开打）
  assert.equal(storySceneAt(chapter8, second).isBattle, true);
  // 战后那一页读的是**第 4 段 ＋ 第 6 段**
  // ★★★ 2026-10-03 第四条用户拍板：第 5 段（封镜逼现身＋阿布德尔中弹）挪到**两场之间**去了
  //    （阿布德尔的死就发生在阶段 1 之后），战后改成第 4 段（"敌人开始成对出现"的总结）＋第 6 段。
  const last = chapter8.scenes.at(-1);
  assert.equal(last.kind, 'read');
  assert.deepEqual(last.parts, [[3, 4], [5, 6]], '★ 战后＝第 4 段 ＋ 第 6 段（不连续，用 parts 写）');
  assert.equal(last.from, undefined, '★ 不连续的切法不用 from/upto');
  assert.equal(storySceneAt(chapter8, chapter8.scenes.length - 1).paragraphs.length, 2,
    '★ 战后一页读第 4、6 两段（第 5 段已经在两场之间读过了）');
});

test('⑥ 引擎侧：两场各能独立收尾（第一场是必败剧情战、第二场打倒对手才算通关）', () => {
  // ★★★ 2026-10-03 第四条用户拍板：第一场改成了**必败剧情战**——旧断言"把他的血打空才判胜"
  //    （连同更早的 phaseWin 那一条）都已被推翻。这一场唯一的收场方式是**波波掉到一半**
  //    → 演出 → 判玩家战败；而"这一局"只是"这一场"结束，剧情照常往下走。
  const one = open(phase1);
  const emperor = emperorUnit(one);
  const blade = standNextTo(one, bladeOf(one), emperor);
  one.s.turn = 'p1';
  one.s.hp.p2 = 1;
  assert.equal(one.attack(blade, emperor), true, '打得伤他');
  assert.equal(one.s.hp.p2, 1, '★ 剧本保护：打到底也是 1（旧写法是"打空算赢"）');
  assert.equal(one.s.phase, 'battle', '打他不会结束这一场');
  one.s.hp.p1 = 20;                                // 波波正好一半
  assert.equal(one.checkEnd(), true, '★ 触发剧情：这一场立刻结束');
  assert.equal(one.s.winner, 'p2', '★ 判玩家战败');
  assert.equal(one.phaseWinDone(), false, '★ 阶段 1 没有"打到半血即胜"那套（那是判胜的一套）');
  assert.equal(one.storyLossDone(), true);
  // 第二场：J·凯尔倒下才是这一章的"打倒对手"
  const two = open(phase2);
  const owner = two.s.units.find(u => u.slot === 'p2' && u.kind === 'user');
  const blade2 = standNextTo(two, bladeOf(two), owner);
  two.s.turn = 'p1';
  two.s.hp.p2 = 1;
  assert.equal(two.attack(blade2, owner), true);
  assert.equal(two.s.winner, 'p1');
  assert.equal(two.s.hp.p2, 0);
  // ★★ 第三条改版把阶段 1 改回"正常胜负"时，两场的结算理由是**同一条**；第四条之后**不是了**：
  //    第一场是剧情演出那一条，第二场仍然是"谁的血归零谁输"。
  assert.match(one.s.resultReason, /阿布德尔挡下了那一枪/, '★ 阶段 1 的结算是**剧情**那一条');
  assert.equal(two.s.resultReason, '共享生命归零', '★ 阶段 2 走"谁的血归零谁输"那一套');
});

test('⑥ 每一场的台词与在场的人对得上（阶段 2 里没有阿布德尔）', () => {
  const one = open(phase1);
  const two = open(phase2);
  const speakers = game => Object.values(game.s.story.barks).map(line => line.key || '旁白');
  assert.notDeepEqual(speakers(one), speakers(two), '★ 两场的台词不是同一份');
  // 阶段 1 里不能出现阿布德尔（他不上场）
  assert.equal(one.s.units.some(u => u.fighter === 'avdol'), false);
  assert.equal(speakers(one).includes('avdol'), false, '★ 阶段 1 的台词里不许有阿布德尔');
  // 阶段 2 里也没有他（他已经在上一场倒下了），说话的是电脑友军花京院
  assert.equal(two.s.units.some(u => u.fighter === 'avdol'), false);
  assert.equal(speakers(two).includes('avdol'), false, '★ 阶段 2 的台词里同样不许有阿布德尔');
  assert.ok(speakers(two).includes('kakyoin'), '★ 阶段 2 的台词里要有花京院（电脑友军）');
  assert.ok(speakers(two).includes('geil'), '★ 也要有 J·凯尔（击倒对手那一句）');
  // 台词立绘要取得到（写错 key 只会显示破图，不会报错）
  for (const line of [...Object.values(one.s.story.barks), ...Object.values(two.s.story.barks)]) {
    if (!line.key) continue;
    assert.ok(FIGHTERS[line.key], `台词 key=${line.key} 取不到角色数据`);
  }
});

test('⑥ 分幕的机制旗标真的并进了 s.story（引擎读的是"当前这一幕"，不是"第八章"）', () => {
  const one = open(phase1);
  const two = open(phase2);
  assert.equal(one.s.story.id, 'chapter-8', '两场的 s.story 都记得自己是第八章');
  assert.equal(one.s.story.sniper, true);
  assert.equal(one.s.story.mirrors, undefined);
  assert.equal(two.s.story.mirrors, true);
  assert.equal(two.s.story.sniper, undefined);
  assert.deepEqual(one.s.story.lineup, phase1.lineup);
  assert.deepEqual(two.s.story.lineup, phase2.lineup);
  // ⚠️ 引擎**不能**改动 STORY_CHAPTERS 里的原始数据（那是共享的章节表）
  assert.equal(chapter8.sniper, undefined);
  assert.equal(chapter8.mirrors, undefined);
  assert.notEqual(one.s.story, chapter8, '并进 s.story 的是一份拷贝，不是章节对象本身');
});

// ===================== 接线：界面（假 DOM） =====================

test('③（接线）阶段 2 的 3 个角色位能在状态栏里正常画出来（P1 两行 / P2 一行）', async () => {
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
    const { renderCards } = await import('../src/ui/hud.js');
    const game = open(phase2);
    game.s.turn = 'p1b';                       // 轮到电脑友军：两边的"行动中"要高亮正确
    assert.doesNotThrow(() => renderCards(game, { humanTurn: false }), '3 个角色位的一帧不该抛错');
    const p1 = elements.get('sideP1').innerHTML, p2 = elements.get('sideP2').innerHTML;
    assert.equal((p1.match(/data-row="/g) || []).length, 2, '★ P1 两个角色＝两行');
    assert.equal((p2.match(/data-row="/g) || []).length, 1, '★ P2 只有一个角色＝一行（2 打 1 也要画得出来）');
    assert.match(p1, /花京院/, '电脑友军要出现在 P1 那一栏');
    assert.match(p1, /COMPUTER/, '友军标成电脑操作');
    assert.match(p1, /PLAYER \+ COMPUTER/, '一整队＝玩家 + 电脑');
    assert.match(p2, /J·凯尔/, '敌方那一行是 J·凯尔');
    // 阶段 1（1v1）走的是旧版式，一个字都不该变
    const one = open(phase1);
    assert.doesNotThrow(() => renderCards(one, { humanTurn: true }), '阶段 1 的一帧不该抛错');
    assert.equal((elements.get('sideP2').innerHTML.match(/data-row="/g) || []).length, 0,
      '1v1 仍然是单角色面板（不走两行那一套）');

    // 剧情页：中间那两页写的是**第二场**的阵容与规则（不写错人、也不提前列第一场的规则）
    const { renderStoryStage } = await import('../src/ui/hud.js');
    renderStoryStage(chapter8, storySceneAt(chapter8, battleIndexes[0] + 1));
    const rulesHtml = elements.get('storyStageRules').innerHTML;
    assert.match(rulesHtml, /花京院/, '★ 中间那页的"你操控 / 电脑操控"要写清多了一个电脑友军');
    assert.match(rulesHtml, /反光点/, '★ 中间那页列的是第二场的规则');
    assert.equal(/冷枪/.test(rulesHtml), false, '★ 中间那页不该再列第一场的冷枪规则');
    // 紧挨着第二场那一页（按钮＝「开始对决」）才写"接下来你操控谁"
    renderStoryStage(chapter8, storySceneAt(chapter8, battleIndexes[1] - 1));
    assert.match(elements.get('storyStageHint').textContent, /花京院/, '★ 那一句提示也要按幕写（多一个电脑友军）');
    assert.match(elements.get('storyStageHint').textContent, /电脑控制/, '要说清友军由电脑控制');
    // 战前那一页写的是第一场（没有友军）
    renderStoryStage(chapter8, storySceneAt(chapter8, 0));
    const firstRules = elements.get('storyStageRules').innerHTML;
    assert.equal(/电脑控制的友军/.test(firstRules), false,
      '★ 战前那页写的是阶段 1（没有友军），不许出现"电脑控制的友军"那一句');
    assert.match(firstRules, /霍尔·霍斯/, '战前那页的对手是霍尔·霍斯');
  } finally {
    if (previous === undefined) delete globalThis.document; else globalThis.document = previous;
  }
});

// ===================== 接线：main.js 的读剧情流程 =====================

test('①②（接线）按 main.js 的顺序走一遍：读正文 → 开打第一场 → 读中间 → 开打第二场 → 读战后', () => {
  // 这一段是 main.js 里 showStoryStage / storyLineup / startStoryMatch / startMatch 那几行的等价复刻
  // （那几行要跑真 DOM，测试里拉不起来；它们的**写法**在下面那一条静态检查里守）。
  const chapter = chapter8;
  let scene = 0;
  const opened = [];
  /** ＝ main.js 的 `startStoryMatch()` + `startMatch()`：先挪光标，再按那一幕的阵容开一局。 */
  const startStoryMatch = () => {
    const battleAt = storyBattleScene(chapter) >= 0 ? storyBattleScene(chapter, scene) : -1;
    if (battleAt >= 0) scene = battleAt;
    // ⚠️ 登记给引擎的是**原始的幕对象**（不是 storySceneAt 的解析视图）——机制旗标长在它上面
    const raw = (chapter.scenes || [])[scene] || null;
    const view = storySceneAt(chapter, scene);
    const lineup = { player: chapter.player, enemy: chapter.enemy, ...(view?.lineup || {}) };
    const game = new Game({ random: seeded(13) });
    game.setRoster({ p1b: lineup.ally || null, p2b: lineup.enemy2 || null, story: true, scene: raw });
    assert.equal(game.start(lineup.player, lineup.enemy, 'ai', { story: chapter.id }), true);
    opened.push({ scene, slots: game.s.slots, sniper: game.sniperRule() !== null, mirrors: game.s.mirrors.length });
    return game;
  };

  // 第 0 幕（战前正文）→ 点「开始对决」
  const first = storySceneAt(chapter, scene);
  assert.equal(first.button.action, 'battle');
  scene = first.nextIndex;                                  // main.js：storyView.nextIndex
  startStoryMatch();
  assert.equal(scene, battleIndexes[0], '★ 光标落在第一场战斗那一幕上');
  // 打赢第一场 → 结算页的「继续 / 下一场」走 storySceneAt(scene + 1)
  let after = storySceneAt(chapter, scene + 1);
  assert.equal(after.isBattle, false);
  scene = after.index;
  // 中间正文**只有一页**（第 3 段）——它后面直接就是第二场
  const mid = storySceneAt(chapter, scene);
  assert.equal(mid.isBattle, false);
  assert.equal(mid.button.action, 'battle', '★ 读到"后面就是第二场"那一页，按钮是「开始对决」');
  scene = mid.nextIndex;
  assert.equal(scene, battleIndexes[1], '★ 这一页的下一幕就是第二场');
  startStoryMatch();
  assert.equal(scene, battleIndexes[1], '★ 第二次开打时光标落在**第二场**（不是被改回第一场）');
  after = storySceneAt(chapter, scene + 1);
  assert.equal(after.button.action, 'end', '★ 打完第二场才是最后一页「完成本章」');

  // 两场开出来的局面确实不一样
  assert.equal(opened.length, 2);
  assert.deepEqual(opened[0].slots, ['p1', 'p2'], '第一场：1v1');
  assert.deepEqual(opened[1].slots, ['p1', 'p1b', 'p2'], '第二场：＋电脑友军（2 打 1）');
  assert.deepEqual(opened.map(o => [o.sniper, o.mirrors]), [[true, 0], [false, 4]],
    '★ 冷枪只在第一场、反光点只在第二场');
});

test('①②（接线）main.js 里"一章多场"的四处接线都在（静态检查）', () => {
  const main = fs.readFileSync(new URL('../src/main.js', import.meta.url), 'utf8');
  // ① 开打前把光标挪到**那一场战斗**上：`storyBattleScene(chapter, storyRead.scene)`
  //    （⚠️ 前半段 `storyBattleScene(chapter)` 的写法被 tests/title-screen.test.js 的正则钉着，必须留着）
  assert.match(main, /const battleAt = storyBattleScene\(chapter\) >= 0 \? storyBattleScene\(chapter, storyRead\.scene\) : -1/,
    '★ 两场战斗的章节要算"下一场还没打完的"，不能永远指回第一场');
  assert.match(main, /if \(battleAt >= 0\) storyRead\.scene = battleAt/);
  // ② 登记给引擎的是**原始的幕对象**（不是 storySceneAt 的解析视图——那样会把机制旗标丢掉）
  assert.match(main, /const storyScene = storyChapter \? \(storyChapter\.scenes \|\| \[\]\)\[storyRead\.scene\] \|\| null : null/,
    '★ 交给引擎的 scene 必须是原始幕对象（sniper/mirrors/phaseWin/barks 都长在它上面）');
  assert.match(main, /scene: storyScene,/, 'setRoster 要把这一场属于哪一幕登记进去');
  // ③ 阵容按幕取（lineup）
  assert.match(main, /function storyLineup\(\)/, '缺少"这一场的阵容"的单一来源');
  assert.match(main, /const lineup = storyChapter \? storyLineup\(\) : null/);
  assert.match(main, /p1b: storyChapter \? \(lineup\.ally \|\| null\)/);
  // ④ 结算页：下一幕**还是战斗**时按钮叫「下一场」，不能误判成"完成本章"
  assert.match(main, /if \(after\?\.isBattle\) retry\.textContent = '下一场'/,
    '★ 第八章打完阶段 1 之后要能接着开第二场');
  assert.match(main, /showStoryStage\(chapterIndex, after\.index\)/);
  assert.match(main, /const after = s\.story \? storySceneAt\(s\.story, storyRead\.scene \+ 1\) : null/,
    '（这一行被 title-screen.test.js 的正则钉着）');
  // ⑤ 读剧情那一页点「开始对决」时先把光标挪到战斗那一幕
  assert.match(main, /if \(storyView\.nextIndex >= 0\) storyRead\.scene = storyView\.nextIndex/);
  // ⑥ 演出横幅：phasewin 事件走"伪装破裂"那条大字横幅
  assert.match(main, /event\.type === 'phasewin'/, '★ 打到半血的演出要有界面接线');
  assert.match(main, /showUnmaskBanner\(\{ kicker: event\.kicker, title: event\.title, tail: event\.tail \}\)/);
  // ⑦ 「关卡机制」按**当前这一幕**的规则显示（只有阶段 1 有冷枪、只有阶段 2 有反光点）
  assert.match(main, /rulesBtn\.hidden = chapterSpecialRules\(\)\.length === 0/);
  assert.match(main, /storySceneAt\(chapter, storyRead\.scene\)\?\.specialRules/, '缺少"按幕取规则"');
});
