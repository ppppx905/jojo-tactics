/**
 * 时停的两种口径（2026-09-15 修 bug 时立的规矩）：
 *   · 承太郎（timeRule 'window'）：血量首次 ≤50% 的那一个回合内可用，**错过即永久失效**。
 *   · DIO（timeRule 'hp'）      ：血量掉到 ≤50% 就**永久解锁**，之后不限回合、随时可放。
 *
 * 修的是什么 bug：DIO 原来用的是「实时比较当前血量」，而他整套打法就是吸血回血——
 * 一旦吸回半血以上，时停按钮又变灰，等于凭空多出一个"窗口期"，与技能说明
 * 「不限回合、可一直留到后面的回合再放」矛盾。现在改成解锁锁存（timeUnlocked）。
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { Game, RULE, FIGHTERS, STORY_CHAPTERS, SKILLS, skillSetFor } from '../src/core/game.js';
import { hexDist } from '../src/core/hex.js';

function seeded(seed = 7) { return () => ((seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0) / 4294967296); }
/** 伊奇测试里同款：固定站位、清掉地形，避免随机地形影响判定。 */
function fixture(p1 = 'jotaro', p2 = 'dio') {
  const game = new Game({ random: seeded() });
  game.start(p1, p2);
  game.s.terrain = {};
  return game;
}
const half = key => FIGHTERS[key].hp / 2;

test('DIO 半血解锁后永久可用：吸血回满血也不再变灰（这是修的 bug）', () => {
  const g = fixture('jotaro', 'dio');
  const dioHalf = half('dio');
  assert.equal(dioHalf, FIGHTERS.dio.hp / 2, 'DIO 的半血线跟着数据走（2026-09-30 血量 50 → 40，半血线 25 → 20）');

  g.s.hp.p2 = 26;
  assert.equal(g.timeAvailable('p2'), false, '半血以上：不能用');
  g.endTurn();                                  // 轮到 DIO，checkTimeWindow 在这里跑

  g.s.hp.p2 = dioHalf;                          // 正好一半
  g.endTurn(); g.endTurn();                     // 再轮一圈，让 DIO 的回合开始
  assert.equal(g.s.timeUnlocked.p2, true, '掉到一半就应该被解锁');
  assert.equal(g.timeAvailable('p2'), true, '解锁后可用');

  g.s.hp.p2 = 30;                               // 吸一口血回到半血以上
  assert.equal(g.timeAvailable('p2'), true, '★ 回到半血以上也必须还能用（旧代码这里会变 false）');
  g.s.hp.p2 = FIGHTERS.dio.hp;                  // 直接回满
  assert.equal(g.timeAvailable('p2'), true, '★ 回满血也必须还能用');
});

test('★ 飞刀（DIO 新技能）：伤害＝自身攻击力；时停的额外回合里不占冷却（伤害不变）', () => {
  // 用户 2026-09-30 的新技能：cd 一回合、1 AP、射程 3、伤害＝自身攻击力；
  // 「在时停期间可无 cd 释放」——用户明确选的是**时停给的额外回合**那一段。
  // ⚠️ 他先要过"伤害加 1"，随后又改口「时停期间飞刀伤害不变」，所以这里断言的是**伤害不变**。
  assert.equal(SKILLS.knife.stopBonus, undefined, '★ 那个 +1 已经被用户取消，别再把它加回来');
  const g = fixture('dio', 'avdol');
  const stand = g.unit('p1-stand'), user = g.unit('p1-user'), foe = g.unit('p2-user');
  assert.equal(SKILLS.knife.cost, 1, '1 AP');
  assert.equal(SKILLS.knife.cd, 2, '数据值 2 = 用户口径的 CD 1');
  assert.equal(SKILLS.knife.range, 3, '射程 3');
  assert.equal(SKILLS.knife.by, 'any', '★ 本体与替身都能扔（用户选的"两个都能扔"）');
  assert.deepEqual(g.skills('p1'), ['drain', 'knife', 'time'],
    '★ DIO 技能栏是 3 个：吸血 / 飞刀 / 时停（「吸血鬼」被动已并进时停的说明，不再单独占一格）');

  // 站位：本体与替身都在目标的 3 格内
  Object.assign(foe, { row: 5, col: 7 });
  Object.assign(stand, { row: 5, col: 4 });
  Object.assign(user, { row: 5, col: 5 });
  assert.equal(hexDist(g.tile(stand), g.tile(foe)), 3, '正好在射程 3 内');

  // 「自身攻击力」两边必须一样：本体自己没有 dmg，用该方替身的攻击力兜底
  assert.equal(g.preview(stand, foe, 'knife').attack, FIGHTERS.dio.stand.dmg, '替身扔：伤害＝自身攻击力 8');
  assert.equal(g.preview(user, foe, 'knife').attack, FIGHTERS.dio.stand.dmg,
    '★ 本体扔也是 8（不兜底的话本体扔出去会是 0 伤）');

  // 常回合：本体真能扔出去，用完进 CD、第二把扔不出去
  g.s.ap.p1 = 3;
  assert.ok(g.attack(user, foe, 'knife'), '本体可以扔');
  assert.equal(g.s.cd.p1.knife, 2, '用完全进 CD');
  assert.match(g.attackReason(stand, foe, 'knife'), /冷却/, '常回合里第二把扔不出去');

  // ── 时停给的额外回合：不占冷却（换一局，让冷却从干净状态开始）
  const t = fixture('dio', 'avdol');
  const tStand = t.unit('p1-stand'), tUser = t.unit('p1-user'), tFoe = t.unit('p2-user');
  Object.assign(tFoe, { row: 5, col: 7 }); Object.assign(tStand, { row: 5, col: 4 }); Object.assign(tUser, { row: 5, col: 5 });

  t.s.hp.p1 = half('dio');                      // 半血解锁时停
  t.endTurn(); t.endTurn();                     // 转一圈回到 DIO，checkTimeWindow 解锁
  assert.equal(t.timeAvailable('p1'), true, '半血解锁时停');
  assert.equal(t.s.cd.p1.knife || 0, 0, '这时飞刀冷却本来是好的');

  // 关键：**发动时停之前先扔一把**，这样额外回合开始时冷却还剩 1（否则 CD 正好走完、测不出例外）
  t.s.ap.p1 = 3;
  assert.ok(t.attack(tStand, tFoe, 'knife'), '发动前先扔一把');
  assert.equal(t.s.cd.p1.knife, 2, '进 CD');
  assert.ok(t.beginSkill(tStand, 'time'), '发动时停');
  t.endTurn();
  assert.equal(t.s.turn, 'p1', '对手回合被跳过，回合还给 DIO');
  assert.equal(t.timeExtraTurn('p1'), true, '★ 这一回合就是"时停的额外回合"');
  assert.ok(t.s.cd.p1.knife > 0, `CD 还剩 ${t.s.cd.p1.knife}（正常回合里本来扔不了）`);
  assert.equal(t.attackReason(tStand, tFoe, 'knife'), '', '★ 额外回合里飞刀无视冷却');
  assert.equal(t.preview(tStand, tFoe, 'knife').attack, FIGHTERS.dio.stand.dmg,
    '★ 额外回合里**伤害不变**（用户 2026-09-30 取消了"伤害 +1"）');
  assert.ok(t.attack(tStand, tFoe, 'knife'), '额外回合第一把');
  assert.ok(t.attack(tStand, tFoe, 'knife'), '★ AP 够就能连续扔（这就是"时停里撒飞刀"）');

  // 额外回合结束 → 旗标清掉，飞刀回到正常冷却限制
  t.endTurn();
  assert.equal(t.timeExtraTurn('p1'), false, '额外回合结束后旗标要清掉');
  assert.ok(t.s.cd.p1.knife > 0, 'CD 还在（额外回合不重置冷却，只是那一回合不受它限制）');
});

test('DIO 满血开局时没有时停；解锁前技能原因提示是"半血解锁"', () => {
  const g = fixture('jotaro', 'dio');
  assert.equal(g.s.timeUnlocked.p2, false);
  assert.equal(g.timeAvailable('p2'), false);
  g.endTurn();                                  // 轮到 DIO
  assert.match(g.skillReason(g.unit('p2-stand'), 'time'), /50%|解锁/, '说明要讲清楚解锁条件');
});

test('DIO 发动时停：跳过对方整个回合、自己连动，且一局只能用一次', () => {
  const g = fixture('jotaro', 'dio');
  g.s.hp.p2 = 20;
  g.endTurn();                                  // 轮到 DIO
  const stand = g.unit('p2-stand');
  assert.equal(g.timeAvailable('p2'), true);
  assert.ok(g.beginSkill(stand, 'time'), '时停应当能发动');
  assert.equal(g.s.skipSide, 'p1', '要跳过的应该是承太郎');
  assert.equal(g.s.timeUsed.p2, true);
  assert.equal(g.s.ap.p2, RULE.apPerTurn, '时停不消耗行动点');

  g.endTurn();
  assert.equal(g.s.turn, 'p2', '★ 跳过对方后仍然是 DIO 的回合（连动）');
  assert.equal(g.s.ap.p1, 0, '被跳过的一方行动点归零');
  assert.equal(g.s.skipSide, null, '跳过已经结算完');
  // 一局只有一次：原因要在 DIO 自己的回合里查（对手回合时 actorReason 会先拦下来）
  assert.equal(g.timeAvailable('p2'), false, '一局只有一次');
  assert.match(g.skillReason(stand, 'time'), /本局已使用/);

  g.endTurn();
  assert.equal(g.s.turn, 'p1', '再结束一次才轮到承太郎');
});

test('DIO 被吸血鬼强化后：时停带来的连动回合多 1 行动点', () => {
  const g = fixture('jotaro', 'dio');
  g.s.hp.p2 = 20;
  g.s.vampCharged.p2 = true;                    // 吸血累计 >10 的强化状态
  g.endTurn();
  assert.ok(g.beginSkill(g.unit('p2-stand'), 'time'));
  g.endTurn();
  assert.equal(g.s.turn, 'p2', '连动');
  assert.equal(g.s.ap.p2, RULE.apPerTurn + 1, '强化后应该是 4 AP');
});

test('回归：承太郎的时停仍是一次性窗口，错过就永久失效', () => {
  const g = fixture('jotaro', 'dio');
  g.s.hp.p1 = half('jotaro') - 1;               // 掉到半血以下
  g.checkTimeWindow();
  assert.equal(g.s.timeReady.p1, true, '窗口开启');
  assert.equal(g.timeAvailable('p1'), true, '窗口内可以用');
  assert.equal(g.s.timeUnlocked.p1, false, '承太郎不该走 DIO 的解锁锁存');

  g.endTurn(); g.endTurn();                     // 过掉一个自己的回合
  assert.equal(g.s.timeReady.p1, false, '窗口只持续一个回合');
  assert.equal(g.timeAvailable('p1'), false, '★ 错过就失效');
  assert.match(g.skillReason(g.unit('p1-stand'), 'time'), /窗口已错过/);
  // 就算回到满血再掉下来，也不会重开窗口
  g.s.hp.p1 = FIGHTERS.jotaro.hp; g.checkTimeWindow();
  g.s.hp.p1 = 5; g.checkTimeWindow();
  assert.equal(g.timeAvailable('p1'), false, '窗口一辈子只开一次');
});

test('剧情模式的承太郎没有时停：不会开窗口，也不会冒出解锁提示', () => {
  const chapter = STORY_CHAPTERS[0];
  const g = new Game({ random: seeded() });
  g.start(chapter.player, chapter.enemy, 'ai', { story: chapter.id });
  g.s.terrain = {};
  assert.equal(skillSetFor('jotaro').includes('time'), true, '普通承太郎本来是有时停的');
  assert.equal(g.skills('p1').includes('time'), false, '剧情模式这场要把它拿掉（玩家固定是 p1）');
  g.s.hp.p1 = 5;
  g.checkTimeWindow();
  assert.equal(g.s.timeReady.p1, false, '不该开一个根本不存在的窗口');
  assert.equal(g.s.timeUnlocked.p1, false, '也不该误开 DIO 的解锁');
});
