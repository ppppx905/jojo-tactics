/**
 * 乔瑟夫·乔斯达（单单位角色）的规则回归：
 * 只有本体、能普攻、藤蔓缠绕（移动 −1 / 花 1 AP 挣脱）、
 * 波纹疾走（6 点真实伤害，对被缠目标 +3）、被动「你的下一句话是」（预判 +1 AP）。
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { Game, RULE, FIGHTERS, SKILLS } from '../src/core/game.js';
import { hexDist } from '../src/core/hex.js';
import { chooseAI, playAIAction } from '../src/core/ai.js';

function seeded(seed = 11) { return () => ((seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0) / 4294967296); }
/** 乔瑟夫(p1) 对 DIO(p2)：本体相距 2 格（普攻可打），地形清空。 */
function fixture(b = 'dio') {
  const game = new Game({ random: seeded() });
  game.start('joseph', b);
  game.s.terrain = {};
  Object.assign(game.unit('p1-user'), { row: 4, col: 4 });
  Object.assign(game.unit('p2-user'), { row: 4, col: 7 });
  Object.assign(game.unit('p2-stand'), { row: 4, col: 9 });
  return game;
}

test('乔瑟夫数值：40/2、本体攻 7 射程 3、只有本体没有替身', () => {
  const f = FIGHTERS.joseph;
  assert.equal(f.hp, 40);
  assert.equal(f.def, 2);
  assert.equal(f.user.dmg, 7);
  assert.equal(f.user.range, 3);
  assert.equal(f.user.move, 3);
  assert.equal(f.stand, null, '没有替身');
  const g = fixture();
  assert.deepEqual(g.skills('p1'), ['nextline', 'vine', 'hamon']);
  assert.equal(g.s.units.filter(u => u.side === 'p1').length, 1, '只生成一个单位');
  assert.equal(g.unit('p1-stand'), null);
  assert.equal(g.s.units.filter(u => u.side === 'p2').length, 2, '对手仍是两人');
  assert.equal(g.pairDistance('p1'), 0, '单单位没有连携距离');
  assert.equal(g.baseDefense('p1'), 2);
});

test('本体拥有 3 格普攻，超出射程就打不到', () => {
  const g = fixture(), me = g.unit('p1-user'), foe = g.unit('p2-user');
  assert.equal(g.attackReason(me, foe), '', '相距 3 格可普攻');
  Object.assign(foe, { row: 4, col: 8 });
  assert.equal(hexDist(g.tile(me), g.tile(foe)), 4);
  assert.match(g.attackReason(me, foe), /射程/);
  Object.assign(foe, { row: 4, col: 7 });
  assert.ok(g.attack(me, foe));
  assert.equal(g.s.hp.p2, FIGHTERS.dio.hp - Math.max(1, 7 - g.defense(foe).total));
});

test('藤蔓缠绕：1 AP / CD 1，移动 −1，同一目标不能重复缠', () => {
  const g = fixture(), me = g.unit('p1-user'), foe = g.unit('p2-stand');
  Object.assign(foe, { row: 4, col: 6 });
  g.select(me.id);
  assert.equal(SKILLS.vine.cost, 1);
  assert.equal(SKILLS.vine.cd, 1);
  assert.equal(g.vineReason(me, foe), '');
  assert.equal(g.moveRange(foe), 4);
  assert.equal(g.vine(foe), true);
  assert.equal(g.vined(foe), true);
  assert.equal(g.moveRange(foe), 3, '移动距离 −1');
  assert.equal(g.reachable(foe).some(t => hexDist(g.tile(foe), t) > 3), false, '实际可达格也不超过 3');
  assert.equal(g.s.ap.p1, 2, '消耗 1 AP');
  assert.equal(g.s.cd.p1.vine, 1, '进入 CD 1');
  // 同一目标不能重复缠、冷却中不能再放、不能缠己方、不能缠宝石柱
  assert.match(g.vineReason(me, foe), /已经被藤蔓/);
  const other = g.unit('p2-user'); Object.assign(other, { row: 4, col: 5 });
  assert.match(g.vineReason(me, other), /冷却/);
  assert.match(g.vineReason(me, me), /己方/);
  g.s.cd.p1.vine = 0;
  g.s.pillars.push({ id: 'k', kind: 'pillar', name: '绿宝石柱', side: 'p2', row: 4, col: 6, hp: 10, maxHp: 10 });
  assert.match(g.vineReason(me, g.s.pillars[0]), /单位/);
});

test('挣脱：花 1 AP、无冷却，移动距离恢复', () => {
  const g = fixture(), me = g.unit('p1-user'), foe = g.unit('p2-stand');
  Object.assign(foe, { row: 4, col: 6 });
  g.select(me.id); g.vine(foe);
  g.s.turn = 'p2'; g.s.ap.p2 = 3; g.select(foe.id);
  assert.equal(RULE.vineBreakAP, 1);
  assert.equal(g.breakReason(foe), '');
  assert.equal(g.breakFree(foe), true);
  assert.equal(g.vined(foe), false);
  assert.equal(g.moveRange(foe), 4, '恢复原本移动距离');
  assert.equal(g.s.ap.p2, 2, '消耗 1 AP');
  assert.equal(g.breakReason(foe), '这个单位没有被藤蔓缠住。');
  // 行动点不足时不能挣脱
  g.s.ap.p2 = 0; g.s.vine[foe.id] = true;
  assert.match(g.breakReason(foe), /行动点不足/);
  assert.equal(g.breakFree(foe), false);
});

test('波纹疾走：6 点真实伤害（无视防御），被缠绕时 +3，只能打单位', () => {
  const g = fixture(), me = g.unit('p1-user'), foe = g.unit('p2-stand');
  Object.assign(foe, { row: 4, col: 6 });
  // 给目标堆满防御：草丛 +3、邻石 +1、柱子 +1、替身加成 +2 —— 真实伤害应当全部无视
  g.s.terrain['4,6'] = 'bush';
  g.s.terrain['4,7'] = 'rock';
  g.s.pillars.push({ id: 'k', kind: 'pillar', name: '绿宝石柱', side: 'p2', row: 5, col: 6, hp: 10, maxHp: 10 });
  const stacked = g.defense(foe).total;
  assert.ok(stacked >= 6, `目标防御应有堆叠，实际 ${stacked}`);
  const plain = g.preview(me, foe, 'hamon');
  assert.equal(plain.defense.total, 0, '波纹无视一切防御');
  assert.equal(plain.damage, SKILLS.hamon.base, '基础 6 点');
  assert.equal(SKILLS.hamon.cost, 2);
  assert.equal(SKILLS.hamon.cd, 2);
  // 被藤蔓缠住 → +3
  g.s.cd.p1.vine = 0; g.s.ap.p1 = 5; g.select(me.id); g.vine(foe);
  const boosted = g.preview(me, foe, 'hamon');
  assert.equal(boosted.damage, SKILLS.hamon.base + SKILLS.hamon.bonus, '被缠绕时 9 点');
  const before = g.s.hp.p2;
  assert.ok(g.attack(me, foe, 'hamon'));
  assert.equal(before - g.s.hp.p2, SKILLS.hamon.base + SKILLS.hamon.bonus, '真实伤害如实结算');
  assert.equal(g.s.cd.p1.hamon, 2);
  // 不能打宝石柱（先清掉冷却，确保测的是目标限制而不是 CD）
  g.s.cd.p1.hamon = 0; g.s.ap.p1 = 5;
  assert.match(g.attackReason(me, g.s.pillars[0], 'hamon'), /宝石柱/);
});

test('你的下一句话是：同一单位对同一目标连续两次同种行动 → 下回合 +1 AP', () => {
  const g = fixture('jotaro'), me = g.unit('p1-user'), foe = g.unit('p2-stand');
  Object.assign(foe, { row: 4, col: 6 });   // 敌方替身贴着乔瑟夫，方便连续普攻
  g.endTurn();                               // 轮到 p2
  assert.equal(g.s.turn, 'p2');
  assert.ok(g.attack(foe, me), '第一次普攻');
  assert.equal(g.s.extraAP.p1, false, '第一次不触发');
  g.s.ap.p2 = 3; g.endTurn(); g.endTurn();   // 回到 p2 的下一回合
  assert.equal(g.s.turn, 'p2');
  assert.ok(g.attack(foe, me), '第二次同种行动');
  assert.equal(g.s.extraAP.p1, true, '预判成功，下回合 +1 AP');
  g.endTurn();
  assert.equal(g.s.turn, 'p1');
  assert.equal(g.s.ap.p1, RULE.apPerTurn + 1, '预判带来的额外行动点');
  assert.equal(g.s.turnAP.p1, RULE.apPerTurn + 1);
  // 换成不同行动就不触发
  const g2 = fixture('jotaro'), me2 = g2.unit('p1-user'), foe2 = g2.unit('p2-stand');
  Object.assign(foe2, { row: 4, col: 6 });
  g2.endTurn();
  g2.attack(foe2, me2, 'star');
  g2.s.ap.p2 = 3; g2.endTurn(); g2.endTurn();
  g2.attack(foe2, me2);                       // 换了行动种类
  assert.equal(g2.s.extraAP.p1, false, '行动种类不同不触发');
});

test('AI 可以正常使用乔瑟夫（含藤蔓与波纹）且不会破坏流程', () => {
  const g = new Game({ random: seeded(5) });
  g.start('jotaro', 'joseph');
  let actions = 0, sawVine = false, sawHamon = false;
  while (g.s.phase === 'battle' && actions < 220) {
    const plan = chooseAI(g);
    if (!plan) break;
    if (plan.type === 'vine') sawVine = true;
    if (plan.skill === 'hamon') sawHamon = true;
    if (!playAIAction(g, plan)) break;
    actions++;
  }
  assert.ok(actions > 5, 'AI 应该真的走了很多步');
  assert.ok(sawVine || sawHamon, 'AI 应该至少用过藤蔓或波纹');
  assert.equal(g.s.phase, 'result', '对局应当正常收束');
});

test('瞄准高亮：选藤蔓/波纹后合法目标必须出现在可选中列表里', () => {
  const g = fixture(), me = g.unit('p1-user'), foe = g.unit('p2-stand');
  Object.assign(foe, { row: 4, col: 6 });
  g.s.pillars.push({ id: 'k', kind: 'pillar', name: '绿宝石柱', side: 'p2', row: 5, col: 6, hp: 10, maxHp: 10 });
  // 藤蔓：敌人应该在列表里，宝石柱不应该
  g.select(me.id);
  assert.ok(g.beginSkill(me, 'vine'));
  const vineTargets = g.actionView().attackable;
  assert.ok(vineTargets.includes(foe), '藤蔓的合法目标必须被高亮');
  assert.equal(vineTargets.some(t => t.kind === 'pillar'), false, '宝石柱不该被当成藤蔓目标');
  g.cancel();
  // 波纹：同样只列单位
  assert.ok(g.beginSkill(me, 'hamon'));
  const hamonTargets = g.actionView().attackable;
  assert.ok(hamonTargets.includes(foe), '波纹的合法目标必须被高亮');
  assert.equal(hamonTargets.some(t => t.kind === 'pillar'), false, '宝石柱不该被当成波纹目标');
  g.cancel();
});

test('完整操作序列：选中 → 点技能 → 点敌人，行动点在点敌人那一刻结算', () => {
  const g = fixture(), me = g.unit('p1-user'), foe = g.unit('p2-stand');
  Object.assign(foe, { row: 4, col: 6 });
  g.select(me.id);
  assert.equal(g.beginSkill(me, 'vine'), true);
  assert.equal(g.s.ap.p1, 3, '选中技能时还不扣（要先选目标）');
  assert.equal(g.s.pendingSkill, 'vine');
  assert.equal(g.actionAt(g.tile(foe)), true, '点敌人即结算');
  assert.equal(g.s.ap.p1, 3 - SKILLS.vine.cost, '点敌人那一刻扣 1 AP');
  assert.equal(g.s.pendingSkill, null, '结算后结束瞄准');
  assert.equal(g.vined(foe), true);
  // 波纹同理：2 AP 在点敌人的那一刻扣除
  g.s.cd.p1.hamon = 0; g.s.ap.p1 = 5;
  g.select(me.id);
  assert.ok(g.beginSkill(me, 'hamon'));
  assert.equal(g.s.ap.p1, 5, '瞄准阶段不扣');
  assert.equal(g.actionAt(g.tile(foe)), true);
  assert.equal(g.s.ap.p1, 5 - SKILLS.hamon.cost, '点敌人那一刻扣 2 AP');
});

test('缺少美术素材不会影响规则层（单单位角色也不会去找替身立绘）', async () => {
  const { artKeys, CHARACTER_ART } = await import('../src/ui/assets.js');
  assert.deepEqual(artKeys(CHARACTER_ART.joseph), ['joseph'], '单单位角色只加载本体立绘');
  assert.deepEqual(artKeys(CHARACTER_ART.jotaro), ['jotaro', 'star_platinum']);
});
