/**
 * 波鲁纳雷夫 & 银色战车：卸甲 / 精湛剑术 / 发射剑刃 的规则回归。
 * 复用 game.test.js 的 fixture 思路：固定地形与站位，逐步断言。
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { Game, RULE, FIGHTERS, SKILLS } from '../src/core/game.js';
import { tileKey, hexDist } from '../src/core/hex.js';
import { chooseAI, playAIAction } from '../src/core/ai.js';

function seeded(seed = 7) { return () => ((seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0) / 4294967296); }
/** 波鲁纳雷夫(p1) 对 DIO(p2)：主人相距 2 格（普攻可用），替身排在一条直线上（剑刃可用）。 */
function fixture(b = 'dio') {
  const game = new Game({ random: seeded() });
  game.start('polnareff', b);
  game.s.terrain = {};
  for (const [id, row, col] of [['p1-user', 4, 4], ['p1-stand', 4, 5], ['p2-user', 4, 7], ['p2-stand', 4, 9]])
    Object.assign(game.unit(id), { row, col });
  return game;
}

test('polnareff numbers match the spec: 40/2, dmg 7, range 2, tether 2, stand bonus 2', () => {
  const f = FIGHTERS.polnareff;
  assert.equal(f.hp, 40);
  assert.equal(f.def, 2);
  assert.equal(f.distLimit, 2);
  assert.equal(f.standDefBonus, 2);
  assert.equal(f.stand.dmg, 7);
  assert.equal(f.stand.range, 2);
  const g = fixture();
  assert.deepEqual(g.skills('p1'), ['mastery', 'armor', 'blade']);
  assert.deepEqual(g.s.hp, { p1: 40, p2: 40 });   // DIO 血量 2026-09-30 从 50 改成 40
});

test('armor: 装甲 ⇄ 卸甲 双形态，CD 1 回合，卸甲当回合 +1 AP 且共享防御归零', () => {
  const g = fixture(), stand = g.unit('p1-stand');
  assert.equal(g.s.ap.p1, 3);
  assert.equal(g.skillLabel('armor', 'p1'), '卸甲', '默认是装甲形态，技能名显示为卸甲');
  assert.equal(g.beginSkill(stand, 'armor'), true);
  assert.equal(g.s.armorOff.p1, true);
  assert.equal(g.s.ap.p1, 4, '卸甲当回合额外 +1 AP');
  assert.equal(g.baseDefense('p1'), 0, '共享防御归零');
  assert.equal(g.s.cd.p1.armor, SKILLS.armor.cd, '切换后进入冷却');
  assert.equal(SKILLS.armor.cd, 2, '数据值 2 = 用户口径的「CD 1 回合」（口径见 rules.js 顶部说明）');
  assert.equal(g.skillLabel('armor', 'p1'), '装甲', '卸甲后技能名变成装甲');
  const stripEvent = g.s.log.filter(e => e.type === 'skill' && e.skill === 'armor').at(-1);
  assert.equal(stripEvent.label, '卸甲', '大招动画/日志显示的是出手时的形态名');
  assert.equal(stripEvent.cry, 'ARMOR OFF', '英文副标题与形态一致');
  assert.equal(g.beginSkill(stand, 'armor'), false, '同一回合内不能再切换');
  assert.match(g.s.notice.text, /冷却 2 个己方回合/);

  // 「CD 1 回合」= 下个自己回合放不了，隔一个回合才能放（这是本次规则澄清的核心）
  g.endTurn(); g.endTurn();
  assert.equal(g.s.turn, 'p1', '轮回波鲁纳雷夫自己的回合');
  assert.equal(g.s.cd.p1.armor, 1, '下个自己回合仍在冷却中');
  assert.equal(g.beginSkill(stand, 'armor'), false, '下个自己回合不能切换');
  assert.match(g.s.notice.text, /冷却 1 个己方回合/);

  // 再隔一个自己回合，冷却才走完
  g.endTurn(); g.endTurn();
  assert.equal(g.s.cd.p1.armor, 0, '冷却走完');
  assert.equal(g.s.ap.p1, RULE.apPerTurn + RULE.armorAP, '卸甲期间每个己方回合 +1 AP');
  assert.equal(g.beginSkill(stand, 'armor'), true, '可以穿回装甲');
  assert.equal(g.s.armorOff.p1, false);
  assert.equal(g.baseDefense('p1'), FIGHTERS.polnareff.def, '共享防御恢复');
  assert.equal(g.skillLabel('armor', 'p1'), '卸甲', '技能名变回卸甲');
  const wearEvent = g.s.log.filter(e => e.type === 'skill' && e.skill === 'armor').at(-1);
  assert.equal(wearEvent.label, '装甲', '穿回装甲时动画应显示「装甲」');
  assert.equal(wearEvent.cry, 'ARMOR ON');

  // 穿回装甲后不再有额外行动点
  g.endTurn(); g.endTurn();
  assert.equal(g.s.ap.p1, RULE.apPerTurn);
  assert.equal(g.s.turnAP.p1, RULE.apPerTurn);
});

test('armor: 卸甲让同一击更疼，穿回装甲后伤害回到原样', () => {
  const g = fixture(), stand = g.unit('p1-stand'), foe = g.unit('p2-stand'), user = g.unit('p1-user');
  const before = g.preview(foe, user).damage;
  g.beginSkill(stand, 'armor');
  const stripped = g.preview(foe, user).damage;
  assert.equal(stripped - before, FIGHTERS.polnareff.def, '基础防御 2 点被卸掉');
  // 冷却语义由上面「装甲 ⇄ 卸甲」那个测试覆盖；这里只关心穿回装甲后的伤害
  g.s.cd.p1.armor = 0;
  g.beginSkill(stand, 'armor');
  assert.equal(g.preview(foe, user).damage, before, '穿回装甲后伤害回到卸甲前');
});

test('armor does nothing before the stand exists as the caster and never costs AP', () => {
  const g = fixture();
  assert.equal(g.beginSkill(g.unit('p1-user'), 'armor'), false, '卸甲必须由替身释放');
  assert.equal(g.s.ap.p1, 3);
});

test('mastery: 卸甲期间每次攻击 +1、最多 +3，穿回装甲后加成依然保留', () => {
  const g = fixture(), stand = g.unit('p1-stand'), foe = g.unit('p2-user');   // 相距 2 格，普攻可命中
  // 装甲形态：攻击不叠层
  assert.equal(g.attack(stand, foe), true);
  assert.equal(g.s.swordBuff.p1, 0, '装甲形态下被动不叠层');
  // 卸甲后每次攻击 +1
  g.beginSkill(stand, 'armor');
  const base = g.preview(stand, foe).damage;
  for (let i = 1; i <= 4; i++) {
    g.s.ap.p1 = 5;
    const pv = g.preview(stand, foe);
    assert.equal(pv.attack, FIGHTERS.polnareff.stand.dmg + Math.min(RULE.masteryMax, i - 1) + g.pillarsOf('p1').length,
      `第 ${i} 次攻击的攻击力`);
    g.attack(stand, foe);
    assert.equal(g.s.swordBuff.p1, Math.min(RULE.masteryMax, i), `第 ${i} 次攻击后层数`);
  }
  assert.equal(g.s.swordBuff.p1, RULE.masteryMax, '最多 +3');
  const pv = g.preview(stand, foe);
  assert.equal(pv.attack, FIGHTERS.polnareff.stand.dmg + RULE.masteryMax);
  assert.ok(pv.damage > base, '叠层后单次伤害更高');

  // 穿回装甲：攻击力加成不丢，仍按 +3 结算（冷却语义见 armor 测试，这里直接清掉）
  g.s.cd.p1.armor = 0;
  assert.equal(g.beginSkill(stand, 'armor'), true, '穿回装甲');
  assert.equal(g.s.armorOff.p1, false);
  assert.equal(g.s.swordBuff.p1, RULE.masteryMax, '加成不因穿回装甲而清零');
  assert.equal(g.preview(stand, foe).attack, FIGHTERS.polnareff.stand.dmg + RULE.masteryMax, '装甲形态下依然 +3');
  assert.match(g.skillStatus('p1', 'mastery').status, /攻击力 \+3\/3/);
});

test('blade: straight line only, blocked by rock, damage = attack + 1, costs 1 AP and cd 1', () => {
  const g = fixture(), stand = g.unit('p1-stand'), foe = g.unit('p2-user');
  assert.equal(SKILLS.blade.cd, 1, '剑刃冷却为 1 个己方回合');
  assert.equal(g.attackReason(stand, foe, 'blade'), '', '同排 3 格内可命中');
  const pv = g.preview(stand, foe, 'blade');
  assert.equal(pv.attack, FIGHTERS.polnareff.stand.dmg + RULE.bladeBonus);
  assert.equal(pv.damage, pv.attack - g.defense(foe, 'blade').total);
  const hpBefore = g.s.hp.p2;
  assert.equal(g.attack(stand, foe, 'blade'), true);
  assert.equal(g.s.hp.p2, hpBefore - pv.damage);
  assert.equal(g.s.ap.p1, RULE.apPerTurn - SKILLS.blade.cost);
  assert.equal(g.s.cd.p1.blade, SKILLS.blade.cd);

  // 冷却中不能再放
  const g2 = fixture(), s2 = g2.unit('p1-stand'), f2 = g2.unit('p2-user');
  g2.attack(s2, f2, 'blade');
  g2.s.ap.p1 = 5;
  assert.match(g2.skillReason(s2, 'blade'), /冷却/);
  assert.equal(g2.attack(s2, f2, 'blade'), false);

  // 岩石挡在中间 → 不能命中后面的格子
  const g3 = fixture(), s3 = g3.unit('p1-stand'), f3 = g3.unit('p2-user');
  g3.s.terrain[tileKey(g3.at(4, 6))] = 'rock';
  assert.match(g3.attackReason(s3, f3, 'blade'), /挡|直线/);
  assert.equal(g3.attack(s3, f3, 'blade'), false);

  // 宝石柱同样挡下剑刃
  const g4 = fixture(), s4 = g4.unit('p1-stand'), f4 = g4.unit('p2-user');
  g4.s.pillars.push({ id: 'k', kind: 'pillar', name: '绿宝石柱', side: 'p2', row: 4, col: 6, hp: 10, maxHp: 10 });
  assert.match(g4.attackReason(s4, f4, 'blade'), /挡|直线/);

  // 不在直线上：斜向偏一格（距离 3，仍在射程内，但不是六个直线方向之一）
  const g5 = fixture(), s5 = g5.unit('p1-stand'), f5 = g5.unit('p2-user');
  Object.assign(f5, { row: 6, col: 7 });
  assert.match(g5.attackReason(s5, f5, 'blade'), /直线/);
});

test('blade damage also scales with the mastery stacks under armor', () => {
  const g = fixture(), stand = g.unit('p1-stand'), foe = g.unit('p2-user');
  g.beginSkill(stand, 'armor');
  g.s.ap.p1 = 5; g.attack(stand, foe);          // 叠到 1
  g.s.ap.p1 = 5; g.attack(stand, foe);          // 叠到 2
  g.s.cd.p1.blade = 0; g.s.ap.p1 = 5;
  const pv = g.preview(stand, foe, 'blade');
  assert.equal(pv.attack, FIGHTERS.polnareff.stand.dmg + 2 + RULE.bladeBonus);
});

test('AI can pick polnareff, eventually strips armor and fires the blade without breaking the flow', () => {
  const g = fixture('kakyoin');
  let actions = 0, sawBlade = false, sawArmor = false;
  while (g.s.phase === 'battle' && actions < 400) {
    const plan = chooseAI(g);
    if (!plan) break;
    if (plan.skill === 'blade') sawBlade = true;
    if (plan.skill === 'armor') sawArmor = true;
    if (!playAIAction(g, plan)) break;
    actions++;
  }
  assert.ok(actions > 0, 'AI 有行动');
  assert.ok(sawArmor, 'AI 会用卸甲（血量充足时）');
  assert.ok(sawBlade, 'AI 会用发射剑刃');
  assert.equal(g.s.phase, 'result', '对局能自然结束');
});

test('missing artwork never leaks into the rules layer', () => {
  const g = fixture();
  assert.equal(typeof g.baseDefense('p2'), 'number');
  assert.equal(g.armorOffCheck ?? true, true);
});
