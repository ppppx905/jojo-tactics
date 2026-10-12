/**
 * 剧情模式第一章的规则回归：
 * 章节数据、承太郎的技能替换（没有时停）、以及「半血觉醒」永久 +3 攻击 / +1 AP。
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { Game, RULE, FIGHTERS, STORY_CHAPTERS } from '../src/core/game.js';
import { STORY, storySceneAt, storyBattleScene, storyRoadmap, cnNumber } from '../src/ui/story.js';

function seeded(seed = 11) { return () => ((seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0) / 4294967296); }
const LAYOUT = [['p1-user', 4, 4], ['p1-stand', 4, 5], ['p2-user', 4, 7], ['p2-stand', 4, 9]];
function fixture(options = {}) {
  const chapter = STORY_CHAPTERS[0];
  const game = new Game({ random: seeded() });
  game.start(options.player || chapter.player, options.enemy || chapter.enemy, 'ai', options.story === null ? {} : { story: chapter.id });
  game.s.terrain = {};
  for (const [id, row, col] of LAYOUT) Object.assign(game.unit(id), { row, col });
  return game;
}

test('剧情第一章数据：读 → 读 → 打 → 读，玩家操承太郎、电脑操花京院', () => {
  const chapter = STORY_CHAPTERS[0];
  assert.ok(chapter, '应存在第一章');
  assert.equal(chapter.player, 'jotaro', '玩家操控承太郎');
  assert.equal(chapter.enemy, 'kakyoin', '电脑操控花京院');
  assert.deepEqual(chapter.scenes.map(scene => scene.kind), ['read', 'read', 'battle', 'read'],
    '场景顺序应为：读第一章 → 读交手前 → 打一场 → 读战斗之后');
  const ids = new Set(STORY.map(item => item.id));
  for (const scene of chapter.scenes) {
    if (scene.kind === 'read') assert.ok(ids.has(scene.readId), `剧情档案里没有章节 ${scene.readId}`);
  }
});

test('剧情穿插：花京院「加入队伍」的段落必须留在战斗之后，不能开打前先剧透', () => {
  const chapter = STORY_CHAPTERS[0];
  const before = storySceneAt(chapter, 1);
  const after = storySceneAt(chapter, 3);
  assert.ok(before && after, '战斗前 / 战斗后两段都应能解析');
  assert.equal(before.paragraphs.some(text => text.includes('他加入了旅程')), false,
    '开打前的正文不能出现「加入队伍」');
  assert.equal(after.paragraphs.some(text => text.includes('他加入了旅程')), true,
    '「加入队伍」应放在战斗之后');

  // 拆开的两段拼起来正好是整章，不重不漏
  const whole = STORY.find(item => item.id === 'kakyoin').paragraphs;
  assert.deepEqual([...before.paragraphs, ...after.paragraphs], whole, '拆成两段后拼起来＝整章');

  // 按钮动作：开打前是「开始对决」，读完最后一段是「完成本章」（这才算通关解锁）
  assert.equal(before.button.action, 'battle');
  assert.equal(before.button.label, '开始对决');
  assert.equal(after.button.action, 'end');
  assert.equal(after.button.label, '完成本章');
  // 中间那一幕解析出来就是战斗
  assert.equal(storySceneAt(chapter, 2).isBattle, true);
  assert.equal(storySceneAt(chapter, 99), null, '越界应返回 null');
});

test('剧情模式章节列表：已完成的章节可进入，其余故事弧只显示标题', () => {
  const rows = storyRoadmap();
  const chapterCount = STORY_CHAPTERS.length;
  assert.equal(rows.length, STORY.length - 1,
    `条目数应为 ${STORY.length - 1}（覆盖全部 ${STORY.length} 个故事弧；第一章把前两个弧合成一行）`);
  assert.equal(chapterCount, 8, '当前应有八章：星尘的起点 / 客机上的刺客 / 香港的剑士 / 水下的规矩 / 钢铁的内部 / 暗处的人偶 / 披着同伴的脸 / 皇帝与吊死者');

  // 第一条：可进入，标题取自章节数据，话数区间把前两个弧合起来
  assert.equal(rows[0].playable, true, '第一章是可玩的章节');
  assert.equal(rows[0].kind, 'chapter');
  assert.equal(rows[0].label, '第一章');
  assert.equal(rows[0].chapterIndex, 0, '点它应跳到第 0 章');
  assert.match(rows[0].range, /^第 1–8 话$/, '第一章覆盖第 1–8 话（前两个故事弧）');

  // 第二条：灰塔那一章（剧情 boss）
  assert.equal(rows[1].playable, true, '第二章也是可玩的章节');
  assert.equal(rows[1].kind, 'chapter');
  assert.equal(rows[1].label, '第二章');
  assert.equal(rows[1].chapterId, 'chapter-2');
  assert.equal(rows[1].chapterIndex, 1, '点它应跳到第 1 章');
  assert.match(rows[1].range, /^第 9–10 话$/, '第二章是灰塔那一战（第 9–10 话）');

  // 第三条：香港的剑士（阿布德尔 对 波鲁纳雷夫，两人都是现有可选角色）
  assert.equal(rows[2].playable, true, '第三章也是可玩的章节');
  assert.equal(rows[2].kind, 'chapter');
  assert.equal(rows[2].label, '第三章');
  assert.equal(rows[2].chapterId, 'chapter-3');
  assert.equal(rows[2].chapterIndex, 2);
  assert.match(rows[2].range, /^第 11–13 话$/, '第三章是银色战车那一战（第 11–13 话）');

  // 第四条：水下的规矩（承太郎 对 暗蓝之月，战场是海面）
  assert.equal(rows[3].playable, true, '第四章也是可玩的章节');
  assert.equal(rows[3].kind, 'chapter');
  assert.equal(rows[3].label, '第四章');
  assert.equal(rows[3].chapterId, 'chapter-4');
  assert.equal(rows[3].chapterIndex, 3);
  assert.match(rows[3].range, /^第 14–16 话$/, '第四章是暗蓝之月那一战（第 14–16 话）');

  // 第五条：钢铁的内部（承太郎 对 力量，整艘船就是替身）
  assert.equal(rows[4].playable, true, '第五章也是可玩的章节');
  assert.equal(rows[4].kind, 'chapter');
  assert.equal(rows[4].label, '第五章');
  assert.equal(rows[4].chapterId, 'chapter-5');
  assert.equal(rows[4].chapterIndex, 4);
  assert.match(rows[4].range, /^第 17–19 话$/, '第五章是「力量」那一战（第 17–19 话）');

  // 第六条：暗处的人偶（波鲁纳雷夫 对 黑檀之魔，新加坡旅馆）
  assert.equal(rows[5].playable, true, '第六章也是可玩的章节');
  assert.equal(rows[5].kind, 'chapter');
  assert.equal(rows[5].label, '第六章');
  assert.equal(rows[5].chapterId, 'chapter-6');
  assert.equal(rows[5].chapterIndex, 5);
  assert.match(rows[5].range, /^第 20–22 话$/, '第六章是黑檀之魔那一战（第 20–22 话）');

  // 其余：还没做成章节的故事弧，只有标题、不允许点
  const locked = rows.slice(chapterCount);
  assert.equal(locked.every(row => row.playable === false), true, '未做成章节的条目都不可进入');
  assert.equal(locked.every(row => row.kind === 'arc'), true, '未做成章节的都是档案里的故事弧');
  const titles = new Set(STORY.map(item => item.title));
  for (const row of locked) {
    assert.ok(titles.has(row.title), `未做成章节的条目标题必须来自剧情档案：${row.title}`);
    assert.equal(row.chapterIndex, -1, '这些条目不应能跳转');
  }

  // 已经被章节覆盖的故事弧，不该再作为"未开放"条目重复出现
  for (const title of ['空条承太郎', '花京院典明', '灰塔', '银色战车', '暗蓝之月', '力量', '黑檀之魔']) {
    assert.equal(rows.some(row => row.title === title && !row.playable), false,
      `「${title}」已被章节覆盖，不该再单列一条未开放`);
  }

  // 编号连续（第一章 / 第二章 / …）
  assert.deepEqual(rows.map(row => row.label), rows.map((_, i) => `第${cnNumber(i + 1)}章`));
  assert.equal(cnNumber(1), '一');
  assert.equal(cnNumber(27), '二十七');
});

test('剧情模式：每一章的「战斗」后面都接得上剧情（或者是本章结尾）', () => {
  for (const chapter of STORY_CHAPTERS) {
    const battleAt = (chapter.scenes || []).findIndex(scene => scene.kind === 'battle');
    if (battleAt < 0) continue;
    const after = storySceneAt(chapter, battleAt + 1);
    assert.ok(after === null || !after.isBattle, `${chapter.id}：战斗后面不该紧跟又一场战斗`);
    if (after && !after.isBattle) {
      assert.ok(after.paragraphs.length > 0, `${chapter.id}：打完要接着有正文可读，不能空着`);
      // ⚠️ 一章两场时（第八章），战斗之后那一页正文的**后面还是战斗**，所以按钮是「开始对决」
      //    （action 'battle'）——不再只是 next / end 二选一。
      assert.ok(['next', 'end', 'battle'].includes(after.button.action), `${chapter.id}：战后那一幕要有可点的按钮`);
    }
  }
});

test('剧情战斗打赢后按钮是「继续」而不是「完成本章」（模拟玩家一路点下去）', () => {
  for (const chapter of STORY_CHAPTERS) {
    // 模拟玩家：从第一幕开始连着点「继续」，直到按钮变成「开始对决」
    let scene = 0, view = storySceneAt(chapter, 0), guard = 0;
    while (view && view.button.action === 'next' && guard++ < 50) { scene = view.nextIndex; view = storySceneAt(chapter, scene); }
    assert.equal(view.button.action, 'battle', `${chapter.id}：读完前面的正文应该能点「开始对决」`);

    // ★ 开打那一刻，引擎必须知道"战斗在第几幕"（main.js 的 startStoryMatch 就是干这个的）
    const battleAt = storyBattleScene(chapter);
    assert.ok(battleAt >= 0, `${chapter.id}：要能找到战斗所在幕次`);

    const after = storySceneAt(chapter, battleAt + 1);
    assert.ok(after && !after.isBattle, `${chapter.id}：★ 战斗后必须接得上正文`);
    assert.ok(after.paragraphs.length > 0, `${chapter.id}：战后正文不能是空的`);
    // ⚠️ 同上：第八章两场之间的正文那一页，它的后面就是第二场（按钮＝「开始对决」）。
    assert.ok(['next', 'end', 'battle'].includes(after.button.action), `${chapter.id}：战后那一幕要有可点的按钮`);

    // ★ 这条记录的就是曾经的 bug：不更新 storyRead.scene 的话，战后会算成"战斗自己"，
    //    按钮被误判成「完成本章」，玩家一按就被弹回章节列表、战后正文根本读不到。
    const stale = storySceneAt(chapter, scene + 1);
    assert.equal(stale.isBattle, true,
      `${chapter.id}：开打前 storyRead.scene 停在"战斗前那一幕"，直接用它会算成战斗自己——所以开打时必须改写它`);
  }
});

test('剧情第三章：玩家操阿布德尔打波鲁纳雷夫，半血觉醒「不再硬接剑锋」', () => {
  const chapter = STORY_CHAPTERS[2];
  assert.equal(chapter.id, 'chapter-3');
  assert.equal(chapter.player, 'avdol', '按原作是阿布德尔挡下波鲁纳雷夫');
  assert.equal(chapter.enemy, 'polnareff');
  assert.equal(chapter.title, '香港的剑士');
  assert.deepEqual(chapter.scenes.map(scene => scene.kind), ['read', 'battle', 'read']);
  assert.equal(chapter.arena, undefined, '这一章没指定场地，用默认深色底');

  // 战斗夹在正文中间：战况与结果（"剑士输了"）必须在战斗之后
  const before = storySceneAt(chapter, 0), after = storySceneAt(chapter, 2);
  assert.equal(after.paragraphs.some(text => text.includes('剑士输了')), true);
  assert.equal(before.paragraphs.some(text => text.includes('剑士输了')), false,
    '★ 开打前不能剧透战况与结果');
  const whole = STORY.find(item => item.id === 'chariot').paragraphs;
  assert.deepEqual([...before.paragraphs, ...after.paragraphs], whole, '拆成两段后拼起来＝整章');

  // 觉醒：阿布德尔 ≤ 半血 → 攻击 +3、每回合 +1 AP，且只触发一次、永久保留
  const g = new Game({ random: seeded() });
  g.start(chapter.player, chapter.enemy, 'ai', { story: chapter.id });
  assert.equal(g.storyAttack('p1'), 0, '开局没有加成');
  g.s.hp.p1 = FIGHTERS.avdol.hp / 2;
  g.checkStoryRage('p1');
  assert.equal(g.storyRage('p1'), true, '半血应觉醒');
  assert.equal(g.storyAttack('p1'), 3, '★ 攻击 +3');
  assert.equal(g.storyAP('p1'), 1, '★ 每回合 +1 AP');
  assert.equal(g.storyAttack('p2'), 0, '★ 敌方没有觉醒（用户选的是玩家侧）');
  // 回到满血也不会消失
  g.s.hp.p1 = FIGHTERS.avdol.hp;
  assert.equal(g.storyAttack('p1'), 3, '触发一次后永久保留');
  // 技能表没有被替换（这一章没写 skills，两个招牌技能都在）
  assert.deepEqual(g.skills('p1'), ['burn', 'flame', 'blaze']);
});

test('剧情模式：承太郎没有「时间停止」，也不会再弹出时停窗口提示', () => {
  const game = fixture();
  assert.deepEqual(game.skills('p1'), ['ora', 'star'], '剧情模式的承太郎只有欧拉欧拉与流星指刺');
  assert.equal(game.timeAvailable('p1'), false, '时停不可用');

  game.s.hp.p1 = 10;                 // 已经跌破一半
  game.s.turn = 'p1';
  game.checkTimeWindow();
  assert.equal(game.s.timeReady.p1, false, '不该开一个根本不存在的时停窗口');
  assert.equal(game.s.timeLocked.p1, false, '也不该把它标记成已错过');

  // 普通对局里承太郎仍然带时停
  const normal = fixture({ story: null });
  assert.deepEqual(normal.skills('p1'), ['ora', 'star', 'time']);
});

test('剧情模式：半血觉醒 —— 攻击 +3、每回合 +1 AP，且触发一次后永久保留', () => {
  const game = fixture();
  const stand = game.unit('p1-stand'), foe = game.unit('p2-stand');
  const before = game.preview(stand, foe);
  assert.equal(game.storyRage('p1'), false, '开局未觉醒');
  assert.equal(game.storyAttack('p1'), 0, '未觉醒时没有攻击加成');

  // 掉到半血以上还没事
  game.s.hp.p1 = FIGHTERS.jotaro.hp / 2 + 6;
  game.damage(game.unit('p1-user'), 1, { source: '测试' });
  assert.equal(game.storyRage('p1'), false, '还在半血以上，不觉醒');

  // 跌破一半 → 觉醒
  game.s.hp.p1 = FIGHTERS.jotaro.hp / 2 + 1;
  game.damage(game.unit('p1-user'), 5, { source: '测试' });
  assert.ok(game.s.hp.p1 <= FIGHTERS.jotaro.hp / 2, '共享生命已到一半以下');
  assert.equal(game.storyRage('p1'), true, '跌到半血即觉醒');
  assert.equal(game.storyAttack('p1'), 3, '攻击 +3');

  // 加成加在「攻击力」上，所以按攻击力结算的技能都吃得到
  assert.equal(game.preview(stand, foe).attack, stand.dmg + 3, '普攻攻击力 +3');
  assert.equal(game.preview(stand, foe, 'ora').attack, (stand.dmg + 3) * 2, '欧拉欧拉 = (攻击力+3) × 2');
  assert.equal(game.preview(stand, foe, 'star').attack, stand.dmg + 3, '流星指刺 +3');
  assert.ok(game.preview(stand, foe).damage > before.damage, '觉醒后同一击更疼');

  // 回血回到满血也不会失去加成（这就是「永久」的含义）
  game.heal('p1', 999, '测试');
  assert.equal(game.s.hp.p1, FIGHTERS.jotaro.hp, '已回满');
  assert.equal(game.storyRage('p1'), true, '觉醒是永久的');
  assert.equal(game.storyAttack('p1'), 3);
  assert.equal(game.preview(stand, foe).attack, stand.dmg + 3, '回血后加成仍在');

  // 下个己方回合多 1 AP
  game.endTurn(); game.endTurn();
  assert.equal(game.s.turn, 'p1', '轮回承太郎自己的回合');
  assert.equal(game.s.ap.p1, RULE.apPerTurn + 1, '觉醒后每回合 4 AP');
  assert.equal(game.s.turnAP.p1, RULE.apPerTurn + 1, 'AP 显示上限也要跟着');
});

test('剧情模式：规则只作用于本章改动的角色，对手完全不受影响', () => {
  const game = fixture();
  assert.equal(game.storySwaps('p2'), null, '花京院没有剧情改动');
  assert.equal(game.storyStatus('p2'), '');
  game.s.hp.p2 = 5;
  game.damage(game.unit('p1-stand'), 1, { source: '测试' });
  assert.equal(game.storyRage('p2'), false, '对手不会觉醒');
  game.endTurn(); game.endTurn();
  assert.equal(game.s.ap.p2, RULE.apPerTurn, '对手行动点不变');
});

test('普通对局完全不受剧情规则影响', () => {
  const game = fixture({ story: null });
  game.s.hp.p1 = 5;
  game.damage(game.unit('p2-stand'), 1, { source: '测试' });
  assert.equal(game.storyRage('p1'), false, '普通对局没有觉醒');
  assert.equal(game.storyAttack('p1'), 0);
  assert.equal(game.storyStatus('p1'), '');
  game.endTurn(); game.endTurn();
  assert.equal(game.s.ap.p1, RULE.apPerTurn, '行动点还是 3');
});
