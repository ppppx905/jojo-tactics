/**
 * 伊奇 & 愚者：数值、潜沙（换位 + 防御 +1）、扬沙（普攻打空）、沙之爪（攻击力 +3 / 半血再 +2）。
 * 按《开发交接文档》§5 的清单：数值断言、技能正反例、AI 能跑完整局。
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { Game, RULE, FIGHTERS, SKILLS, skillSetFor } from '../src/core/game.js';
import { hexDist } from '../src/core/hex.js';
import { chooseAI, playAIAction } from '../src/core/ai.js';
import { CHARACTER_ART, artKeys, portrait, cutin } from '../src/ui/assets.js';

function seeded(seed = 9) { return () => ((seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0) / 4294967296); }
const place = (game, id, row, col) => Object.assign(game.unit(id), { row, col });
/** 伊奇(p1) 对 DIO(p2)：愚者与 DIO 本体相隔 2 格（正好在扬沙射程内）。 */
function fixture(foe = 'dio') {
  const game = new Game({ random: seeded() });
  game.start('iggy', foe);
  game.s.terrain = {};
  place(game, 'p1-user', 4, 2); place(game, 'p1-stand', 4, 4);
  place(game, 'p2-user', 4, 6); place(game, 'p2-stand', 4, 8);
  return game;
}

test('伊奇数值：40/2、连携 3、替身防御加成 2、伊奇移动 4、替身攻 7 射程 2 移动 4', () => {
  const f = FIGHTERS.iggy;
  assert.equal(f.hp, 40);
  assert.equal(f.def, 2);
  assert.equal(f.distLimit, 3, '★ 用户 2026-09-30：连携距离 2 → 3');
  assert.equal(f.standDefBonus, 2);
  assert.equal(f.user.move, 4, '★ 用户 2026-09-30：伊奇移动 3 → 4');
  assert.equal(f.user.dmg || 0, 0, '使者不能普攻');
  assert.equal(f.stand.move, 4);
  assert.equal(f.stand.dmg, 7);
  assert.equal(f.stand.range, 2);
  assert.equal(!!f.solo, false, '伊奇是双单位角色');
  assert.deepEqual(skillSetFor('iggy'), ['dive', 'sandblast', 'claw']);
  assert.deepEqual(artKeys(CHARACTER_ART.iggy), ['iggy', 'the_fool'], '两套棋子立绘都要登记');
  assert.equal(cutin('iggy'), 'assets/out/cutins/iggy.webp');
  assert.equal(portrait('iggy'), 'assets/out/portraits/iggy.webp');
});

test('技能成本与冷却口径：潜沙不耗行动点、扬沙 CD 2、沙之爪每回合限 1 次', () => {
  assert.equal(SKILLS.dive.cost, 0, '★ 用户 2026-09-30：潜沙（换位）不消耗行动点');
  assert.equal(SKILLS.dive.cd, 2, '数据值 2 = 用户口径的 CD 1');
  assert.equal(SKILLS.sandblast.cost, 1);
  assert.equal(SKILLS.sandblast.cd, 3, '数据值 3 = 用户口径的 CD 2');
  assert.equal(SKILLS.sandblast.range, 2, '射程 2（用户 2026-09-12 从 3 改小）');
  assert.equal(SKILLS.sandblast.miss, 0.3, '30% 打空');
  assert.equal(SKILLS.sandblast.dmg, 3, '★ 用户 2026-09-30：扬沙追加 3 点真实伤害');
  assert.equal(SKILLS.claw.cost, 1);
  assert.equal(SKILLS.claw.cd, 1, '数据值 1 = 每回合限 1 次');
  assert.equal(SKILLS.claw.range, 1);
  assert.equal(SKILLS.claw.bonus, 3);
  assert.equal(SKILLS.claw.execute, 2);
});

test('潜沙：伊奇与愚者互换位置、基础防御 +1，对手回合仍在、自己下个回合开始结束', () => {
  const g = fixture();
  const user = g.unit('p1-user'), stand = g.unit('p1-stand');
  const userAt = { row: user.row, col: user.col }, standAt = { row: stand.row, col: stand.col };
  assert.equal(g.s.ap.p1, 3);
  assert.ok(g.beginSkill(user, 'dive'), '伊奇本人也能放（by: any）');
  assert.deepEqual({ row: user.row, col: user.col }, standAt, '伊奇站到了愚者原来的位置');
  assert.deepEqual({ row: stand.row, col: stand.col }, userAt, '愚者站到了伊奇原来的位置');
  assert.equal(g.s.ap.p1, 3, '★ 不消耗行动点（用户 2026-09-30 的改动）');
  assert.equal(g.s.cd.p1.dive, SKILLS.dive.cd);
  assert.equal(g.baseDefense('p1'), FIGHTERS.iggy.def + SKILLS.dive.guard, '基础防御 +1');

  g.endTurn();
  assert.equal(g.s.turn, 'p2');
  assert.equal(g.baseDefense('p1'), FIGHTERS.iggy.def + SKILLS.dive.guard, '对手回合里加成还在');

  g.endTurn();
  assert.equal(g.s.turn, 'p1');
  assert.equal(g.baseDefense('p1'), FIGHTERS.iggy.def, '自己下个回合开始时加成结束');

  // 用户口径的 CD 1：下个自己回合放不了，隔一个回合才能放
  assert.equal(g.beginSkill(stand, 'dive'), false, '下个自己回合不能再放');
  g.endTurn(); g.endTurn();
  assert.equal(g.beginSkill(stand, 'dive'), true, '隔一个回合可以再放');
});

test('扬沙：给射程内敌人挂「普攻 30% 打空」，打到人会失败、自己人不能打', () => {
  const g = fixture();
  const stand = g.unit('p1-stand'), foe = g.unit('p2-user');
  assert.equal(hexDist(g.tile(stand), g.tile(foe)), 2, '目标正好在 2 格内');

  g.select(stand.id);
  assert.ok(g.sandblast(foe), '扬沙命中');
  assert.equal(g.s.sandBlind.p2, 'p1', '记录施放方，便于到期清理');
  assert.equal(g.s.ap.p1, 2, '花费 1 AP');
  assert.equal(g.s.cd.p1.sandblast, SKILLS.sandblast.cd);
  assert.match(g.sandblastReason(stand, foe), /已经被沙迷住|冷却/, '同一目标不能重复挂');

  // 反例：不能对自己人扬沙、超出射程打不到（射程 2，3 格外就不行）
  const g2 = fixture();
  const s2 = g2.unit('p1-stand');
  g2.select(s2.id);
  assert.match(g2.sandblastReason(s2, g2.unit('p1-user')), /己方/, '不能对己方单位扬沙');
  place(g2, 'p2-user', 4, 7);
  assert.equal(hexDist(g2.tile(s2), g2.tile(g2.unit('p2-user'))), 3);
  assert.match(g2.sandblastReason(s2, g2.unit('p2-user')), /超出射程/, '3 格已超出射程 2');
});

test('★ 扬沙带 3 点真实伤害：无视防御、debuff 照旧，能直接打死人（必须自己判胜负）', () => {
  // 用户 2026-09-30：「扬沙带3点真实伤害」
  const g = fixture();
  const stand = g.unit('p1-stand'), foe = g.unit('p2-user');
  g.select(stand.id);

  const pv = g.preview(stand, foe, 'sandblast');
  assert.equal(pv.damage, 3, '★ 预览就是 3 点真伤（瞄准时界面显示的就是它）');
  assert.equal(pv.defense.total, 0, '★ 真实伤害无视一切防御（目标基础防御 2 不算进去）');
  assert.equal(g.preview(stand, foe, null).defense.total, FIGHTERS.dio.def,
    '对照组：同一目标用普攻会被防御挡掉一部分，说明扬沙确实绕过了它');

  const hpBefore = g.s.hp.p2;
  assert.ok(g.sandblast(foe), '扬沙命中');
  assert.equal(g.s.hp.p2, hpBefore - 3, '★ 目标掉了正好 3 点血');
  assert.equal(g.s.sandBlind.p2, 'p1', '「普攻 30% 打空」的 debuff 照旧挂上');

  // ⚠️ `damage()` 只扣血、不判胜负：扬沙现在能打死人，所以它必须自己补一次 checkEnd()
  const g2 = fixture();
  const s2 = g2.unit('p1-stand'), f2 = g2.unit('p2-user');
  g2.s.hp.p2 = 3;
  g2.select(s2.id);
  assert.ok(g2.sandblast(f2), '这一下足以打死');
  assert.equal(g2.s.hp.p2, 0);
  assert.equal(g2.s.phase, 'result', '★ 扬沙打死人也要结束这一局（否则会卡死在战斗里）');
  assert.equal(g2.s.winner, 'p1');
  assert.equal(g2.s.resultReason, '共享生命归零');
});

test('扬沙：中招的一方普攻会打空（不结算伤害、但照样算一次行动）；技能不受影响', () => {
  const g = fixture();
  // 先给 DIO 一方挂上流沙
  g.select(g.unit('p1-stand').id);
  assert.ok(g.sandblast(g.unit('p2-user')));
  g.endTurn();
  assert.equal(g.s.turn, 'p2');

  const attacker = g.unit('p2-stand'), target = g.unit('p1-user');
  place(g, 'p2-user', 5, 4); place(g, 'p2-stand', 4, 3);      // 贴身
  const hpBefore = g.s.hp.p1, apBefore = g.s.ap.p2;
  g.random = () => 0.05;                                       // 一定小于 0.3 → 必打空
  assert.ok(g.attack(attacker, target));
  assert.equal(g.s.hp.p1, hpBefore, '打空不结算伤害');
  assert.equal(g.s.ap.p2, apBefore - RULE.attackCost, '打空也算一次行动，AP 照扣');
  assert.ok(g.s.log.some(e => (e.text || '').includes('打空')), '日志里要有打空提示');

  // 技能不受影响：预览里只有「普攻」带 miss，带技能时 miss 归零
  assert.equal(g.preview(attacker, target).miss, SKILLS.sandblast.miss, '普攻带着 30% 打空');
  assert.equal(g.preview(attacker, target, 'drain').miss, 0, '技能不受扬沙影响');

  // 到期：施放方下个回合开始时，眼里的沙被清掉
  g.endTurn();
  assert.equal(g.s.turn, 'p1', '轮回施放方');
  assert.equal(g.s.sandBlind.p2, null, '施放方下个回合开始时沙被清掉');
  assert.equal(g.preview(attacker, target).miss, 0, '恢复后再预览就没有打空概率了');
});

test('沙之爪：攻击力 +3；目标共享生命低于一半再 +2；正好一半不触发；可以打宝石柱但柱子不吃半血加成', () => {
  const g = fixture();
  const stand = g.unit('p1-stand'), foe = g.unit('p2-user');
  place(g, 'p1-user', 4, 5); place(g, 'p1-stand', 4, 6); place(g, 'p2-user', 4, 7);
  assert.equal(hexDist(g.tile(stand), g.tile(foe)), 1, '贴身 1 格');

  assert.equal(g.preview(stand, foe, 'claw').attack, stand.dmg + SKILLS.claw.bonus, '满血目标：攻击力 +3');
  g.s.hp.p2 = Math.floor(FIGHTERS.dio.hp / 2) - 1;
  assert.equal(g.preview(stand, foe, 'claw').attack,
    stand.dmg + SKILLS.claw.bonus + SKILLS.claw.execute, '半血以下再 +2');
  g.s.hp.p2 = FIGHTERS.dio.hp / 2;
  assert.equal(g.preview(stand, foe, 'claw').attack, stand.dmg + SKILLS.claw.bonus, '正好一半不触发');

  // 射程 1：隔一格打不到
  place(g, 'p2-user', 4, 8);
  assert.match(g.attackReason(stand, foe, 'claw'), /超出射程/);
  // 宝石柱可以作为目标（用户 2026-09-12 改）：只吃 +3，不吃「目标半血再 +2」
  const pillar = { id: 'k', kind: 'pillar', name: '绿宝石柱', side: 'p2', row: 4, col: 7, hp: 10, maxHp: 10 };
  g.s.pillars.push(pillar);
  assert.equal(g.attackReason(stand, pillar, 'claw'), '', '沙之爪可以打宝石柱');
  assert.equal(g.preview(stand, pillar, 'claw').attack, stand.dmg + SKILLS.claw.bonus, '打柱子只有 +3');
  pillar.hp = 3;
  assert.equal(g.preview(stand, pillar, 'claw').attack, stand.dmg + SKILLS.claw.bonus, '柱子残血也不触发半血 +2');
  // 每回合限 1 次
  place(g, 'p2-user', 4, 7);
  g.s.ap.p1 = 3;
  assert.ok(g.attack(stand, foe, 'claw'));
  assert.match(g.skillReason(stand, 'claw'), /冷却/, '同一回合不能再放');
});

test('AI 拿伊奇能跑完一整局，并会用到潜沙或扬沙', () => {
  const g = new Game({ random: seeded(5) });
  g.start('jotaro', 'iggy');
  let actions = 0, sawDive = false, sawBlast = false, sawClaw = false;
  while (g.s.phase === 'battle' && actions < 260) {
    const plan = chooseAI(g);
    if (!plan) break;
    if (plan.skill === 'dive') sawDive = true;
    if (plan.type === 'sandblast') sawBlast = true;
    if (plan.skill === 'claw') sawClaw = true;
    if (!playAIAction(g, plan)) break;
    actions++;
  }
  assert.ok(actions > 5, 'AI 应该真的走了很多步');
  assert.equal(g.s.phase, 'result', '对局应当正常收束');
  assert.ok(sawClaw || sawBlast || sawDive, 'AI 至少要会用伊奇的一个技能');
});
