/**
 * ★★ 东方仗助 & 疯狂钻石（2026-10-09 用户设计）。
 *
 * 用户给的规格（数值全部由他拍板，**不许 AI 私自改**）：
 *   · 血量 40 / 防御 2 / 连携 2 / 攻击 7 / 本体移动 3（不能普攻）/ 替身移动 4 / 替身射程 2 / 替身防御加成 2；
 *   · 被动「修复」：**普攻可以选友方**——治疗对方 "攻击力 − 2" 点生命；打敌人则**随机**削它
 *     攻击力／防御力／移速 中的一项 −1，**每个自己的回合只触发一次**，持续到下一个敌方回合结束；
 *   · 「重拳」：2 AP、射程 1、伤害＝当前攻击力 × 2、**计防御**、CD 1 回合（数据 `cd: 2`）；
 *   · 「重组」：射程 2、**含友方**都能选。模式 ①＝回滚 2 AP（**一局限用一次**，1/2/3 个自己回合前）；
 *     模式 ②＝1 AP、CD 1 回合：清状态，**扣血只对敌方生效**。
 *   · 用户拍板的两条限制：**不能治自己**（贴原著）、回滚**只升不降／不回位置／不复活**。
 *
 * 这一份按 ①–⑦ 逐条钉住（数据 → 被动 → 重拳 → 重组两个模式 → 界面/AI 接线 → 收敛）。
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { Game, FIGHTERS, SKILLS, skillSetFor, playableFighters } from '../src/core/game.js';
import { chooseAI, playAIAction } from '../src/core/ai.js';
import { hexDist } from '../src/core/hex.js';

function seeded(seed = 13) { return () => ((seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0) / 4294967296); }
const put = (u, row, col) => { Object.assign(u, { row, col }); return u; };
const aiSource = fs.readFileSync(new URL('../src/core/ai.js', import.meta.url), 'utf8');
const hudSource = fs.readFileSync(new URL('../src/ui/hud.js', import.meta.url), 'utf8');
const mainSource = fs.readFileSync(new URL('../src/main.js', import.meta.url), 'utf8');
const renderSource = fs.readFileSync(new URL('../src/ui/render.js', import.meta.url), 'utf8');

/** 开一局（地形清空，避免岩石/草丛把"够不够得着"搅浑）。 */
function start(a = 'josuke', b = 'polnareff', { seed = 13, roster = null, random = null } = {}) {
  const game = new Game({ random: random || seeded(seed) });
  if (roster) game.setRoster(roster);
  assert.equal(game.start(a, b, 'ai'), true, `${a}/${b} 要能开局`);
  game.s.terrain = {};
  return game;
}
/** 把 p1 的替身与 p2 的替身摆成"距离 d"。 */
function faceOff(game, d = 1) {
  const me = game.unit('p1-stand'), foe = game.unit('p2-stand');
  const user = game.unit('p1-user');
  put(me, 5, 5); put(user, 5, 4); put(foe, 5, 5 + d);
  if (game.unit('p2-user')) put(game.unit('p2-user'), 0, 0);
  game.s.turn = 'p1';
  return { me, foe };
}
/** 走完一整轮，回到 p1 的下个自己回合（用来测"到期"与留快照）。 */
function nextOwnTurn(game) {
  const slots = game.s.slots;
  for (let i = 0; i < slots.length; i++) game.endTurn();
  assert.equal(game.s.turn, 'p1', '（前提）回到了 p1 的回合');
}

/* ===================== ① 数据 ===================== */

test('① 数值与技能表：40/2、连携 2、替身防加 2、攻 7、本体移动 3（不能普攻）、替身移动 4 射程 2', () => {
  const f = FIGHTERS.josuke;
  assert.ok(f, '缺 FIGHTERS.josuke');
  assert.equal(f.hp, 40); assert.equal(f.def, 2);
  assert.equal(f.distLimit, 2); assert.equal(f.standDefBonus, 2);
  assert.equal(f.label, '东方仗助 & 疯狂钻石');
  assert.equal(f.boss, undefined, '★ 不是剧情 boss（要进选人列表）');
  assert.deepEqual([f.user.name, f.user.move, f.user.range, f.user.dmg], ['东方仗助', 3, undefined, undefined], '★ 本体不能普攻');
  assert.deepEqual([f.stand.name, f.stand.move, f.stand.range, f.stand.dmg], ['疯狂钻石', 4, 2, 7]);
  assert.deepEqual(skillSetFor('josuke'), ['fix', 'heavy', 'rebuild'], '★ 三格技能＝Q/W/E');
  // 技能数据（口径照 rules.js 顶部那段 CD 说明：数据值 ＝ 用户口径 + 1）
  assert.deepEqual([SKILLS.fix.passive, SKILLS.fix.mendMinus, SKILLS.fix.down], [true, 2, 1]);
  assert.deepEqual([SKILLS.heavy.cost, SKILLS.heavy.range, SKILLS.heavy.cd, SKILLS.heavy.mult], [2, 1, 2, 2], '★ 重拳 CD 1 回合 → 数据 2');
  assert.deepEqual([SKILLS.rebuild.cost, SKILLS.rebuild.range, SKILLS.rebuild.cd, SKILLS.rebuild.rewindCost, SKILLS.rebuild.rewindMax],
    [1, 2, 2, 2, 3], '★ 重组：清状态 1 AP/CD1（数据2）、回滚 2 AP、最多看 3 个回合前');
  // 选人列表：多了一个人（9 名）
  assert.equal(playableFighters().length, 9, '可选角色 9 名（皇帝 + 东方仗助）');
  assert.ok(playableFighters().map(x => x.key).includes('josuke'));
  // 说明文字必须**纯文本**（界面直接显示；`tests/plain-text-labels.test.js` 另有一份总检查）
  for (const key of ['fix', 'heavy', 'rebuild']) {
    assert.equal(SKILLS[key].desc.includes('**'), false, `${key} 的说明里不许有 markdown 星号`);
    assert.equal(/<[a-z]/i.test(SKILLS[key].desc), false, `${key} 的说明里不许有 HTML`);
  }
});

/* ===================== ② 被动「修复」 ===================== */

test('② 不能治自己：1v1 里没有可治疗的友军，点自己会被明确拒绝', () => {
  const game = start();
  const me = game.unit('p1-stand'), mine = game.unit('p1-user');
  assert.deepEqual(game.fixTargets(me), [], '★ 1v1 没有同队的第二个角色 → 一个能治的都没有');
  assert.equal(game.fixHeal(me), 5, '治疗量 ＝ 攻击力 7 − 2');
  assert.match(game.fixReason(me, mine), /治不了仗助自己/, '★ 点自己要有明确理由');
  assert.match(game.fixReason(me, game.unit('p2-stand')), /治疗友军/, '敌人不是「修复」的目标');
});

test('② 2v2 里能治队友：治疗量＝攻击力 − 2，且照既有治疗规则（不超上限、灼烧减疗）', () => {
  const game = start('josuke', 'kakyoin', { roster: { p1b: 'polnareff', p2b: 'dio' } });
  const me = game.unit('p1-stand'), ally = game.unit('p1b-stand');
  put(me, 5, 5); put(ally, 5, 7);
  put(game.unit('p1-user'), 5, 4); put(game.unit('p1b-user'), 5, 6);
  game.s.turn = 'p1'; game.s.hp.p1b = 20;
  assert.deepEqual([...new Set(game.fixTargets(me).map(u => u.slot))], ['p1b'], '队友的本体与替身都在射程里');
  const pv = game.preview(me, ally);
  assert.equal(pv.friendly, true, '★ 对友军的预览走"治疗"那一支');
  assert.deepEqual([pv.heal, pv.healActual, pv.damage], [5, 5, 0], '预览：回 5、不掉血');
  const ap0 = game.s.ap.p1;
  assert.equal(game.mend(me, ally), true);
  assert.equal(game.s.hp.p1b, 25, '★ 回 5 点血');
  assert.equal(game.s.ap.p1, ap0 - 1, '治疗花 1 AP（与普攻同价）');
  // 满血时白花（治疗量为 0）
  game.s.hp.p1b = FIGHTERS.polnareff.hp;
  game.s.ap.p1 = 3;
  game.mend(me, ally);
  assert.equal(game.s.hp.p1b, FIGHTERS.polnareff.hp, '满血不会溢出');
  // 灼烧减疗：ceil(5/2) = 3
  game.s.hp.p1b = 10; game.s.burn.p1b = 1; game.s.ap.p1 = 3;
  game.mend(me, ally);
  assert.equal(game.s.hp.p1b, 13, '★ 灼烧时治疗减半并向上取整');
});

test('② 削项：普攻命中敌人随机削一项 −1，落到三个唯一出口（攻击/防御/移速）上', () => {
  const game = start();
  const { me, foe } = faceOff(game, 1);
  const before = { atk: game.unitAttack(foe), def: game.baseDefense('p2'), move: game.moveRange(foe) };
  assert.equal(game.attack(me, foe), true);
  const down = game.s.fixDown.p2;
  assert.ok(down && down.by === 'p1', '★ 打中敌人会给它挂上削项');
  assert.ok(['atk', 'def', 'move'].includes(down.stat), `削的是三项之一（实际 ${down.stat}）`);
  const after = { atk: game.unitAttack(foe), def: game.baseDefense('p2'), move: game.moveRange(foe) };
  for (const stat of ['atk', 'def', 'move']) {
    assert.equal(after[stat], before[stat] - (down.stat === stat ? SKILLS.fix.down : 0),
      `★ ${stat} 只在被削时才 −1（卡片/预览/结算读的都是这三个出口）`);
  }
  // 每个自己的回合只触发一次
  game.s.ap.p1 = 3;
  game.attack(me, foe);
  assert.equal(game.s.fixUsed.p1, true, '★ 这一回合的名额已经用掉');
  assert.equal(game.applyFixDown(me, foe), null, '同一回合不会再削第二次');
});

test('② 削项只认普攻：技能不触发；打空也不触发；到期在"施放方下个自己回合开始"', () => {
  // 技能不触发：重拳打中，但身上没有削项
  const a = start();
  const fa = faceOff(a, 1);
  assert.equal(a.attack(fa.me, fa.foe, 'heavy'), true);
  assert.equal(a.s.fixDown.p2, null, '★ 重拳这类技能不触发削项');
  // 打空不触发（把随机源钉成"必定打空"）
  const b = start('josuke', 'polnareff', { random: () => 0 });
  const fb = faceOff(b, 1);
  fb.me.row = 5; fb.me.col = 5; fb.foe.row = 5; fb.foe.col = 6;
  b.s.sandBlind.p1 = 'p2';
  assert.equal(b.attack(fb.me, fb.foe), true);
  assert.equal(b.s.fixDown.p2, null, '★ 被扬沙打空的那一下不结算命中后效果');
  // 到期：施放方下个自己回合开始时清掉
  const c = start();
  const fc = faceOff(c, 1);
  c.attack(fc.me, fc.foe);
  assert.ok(c.s.fixDown.p2, '（前提）已经挂上');
  nextOwnTurn(c);
  assert.equal(c.s.fixDown.p2, null, '★ 施放方再次轮到自己时到期（＝"持续到下一个敌方回合结束"）');
  assert.equal(c.s.fixUsed.p1, false, '削项名额同时重置（每回合一次）');
});

/* ===================== ③ 重拳 ===================== */

test('③ 重拳：2 AP、贴身 1 格、伤害＝攻击力×2 计防御；CD 1 回合（下个自己回合不能放）', () => {
  const game = start();
  const { me, foe } = faceOff(game, 1);
  const pv = game.preview(me, foe, 'heavy');
  const def = game.defense(foe).total;
  assert.equal(pv.attack, 14, '★ 伤害基数 ＝ 攻击力 7 × 2');
  assert.equal(pv.damage, Math.max(1, 14 - def), '★ 按常规结算防御（不是真实伤害）');
  const ap0 = game.s.ap.p1, hp0 = game.s.hp.p2;
  assert.equal(game.attack(me, foe, 'heavy'), true);
  assert.equal(game.s.hp.p2, hp0 - pv.damage, '打出去的就是预览那个数');
  assert.equal(game.s.ap.p1, ap0 - SKILLS.heavy.cost, '消耗 2 AP');
  assert.equal(game.s.cd.p1.heavy, SKILLS.heavy.cd, '★ 进冷却（数据 2 ＝ 用户口径 CD 1 回合）');
  assert.match(game.skillReason(me, 'heavy'), /冷却/, '下个自己回合不能放');
  // ★ 口径：数据 `cd: 2` ＝ 用户说的「CD 1 回合」＝ **跳过下一个自己回合**，隔一个回合才恢复
  nextOwnTurn(game);
  assert.match(game.skillReason(me, 'heavy'), /冷却/, '★ 紧接着的那个自己回合仍然放不了');
  nextOwnTurn(game);
  assert.equal(game.skillReason(me, 'heavy'), '', '★ 隔了一个回合就恢复');
  // 射程只有 1
  const far = start();
  const ff = faceOff(far, 2);
  assert.match(far.attackReason(ff.me, ff.foe, 'heavy'), /超出射程/);
});

/* ===================== ④ 重组·清状态 ===================== */

test('④ 重组·清状态：对敌人＝清减益 ＋ 一发普攻伤害；对友军＝只清减益（不掉血）', () => {
  const game = start('josuke', 'kakyoin', { roster: { p1b: 'polnareff', p2b: 'dio' } });
  const me = game.unit('p1-stand'), ally = game.unit('p1b-stand'), foe = game.unit('p2-stand');
  put(me, 5, 5); put(ally, 5, 6); put(foe, 5, 7);
  put(game.unit('p1-user'), 5, 4); put(game.unit('p1b-user'), 5, 8);
  game.s.turn = 'p1'; game.s.ap.p1 = 3;
  // 给敌人挂一串减益
  game.s.burn.p2 = 2; game.s.drown.p2 = 2; game.s.eroded.p2 = true; game.s.sandBlind.p2 = 'p1';
  const hp0 = game.s.hp.p2;
  assert.equal(game.skillReason(me, 'rebuild'), '', '清状态模式可用（1 AP）');
  assert.equal(game.rebuildMend(me, foe), true);
  assert.deepEqual(game.debuffsOn('p2'), [], '★ 减益被清干净');
  assert.equal(game.s.hp.p2, hp0 - game.preview(me, foe).damage, '★ 对敌人额外扣一发普攻伤害');
  assert.equal(game.s.ap.p1, 2, '花 1 AP');
  assert.equal(game.s.cd.p1.rebuild, SKILLS.rebuild.cd, '进冷却');
  // 对友军：只清不减血
  game.s.vine['p1b-stand'] = true;
  const allyHp = game.s.hp.p1b = 20;
  game.s.cd.p1.rebuild = 0; game.s.ap.p1 = 3;
  assert.equal(game.rebuildMend(me, ally), true);
  assert.equal(game.s.hp.p1b, allyHp, '★ 友军不掉血（用户："扣血对敌方生效"）');
  assert.equal(game.debuffsOn('p1b').includes('藤蔓'), false, '藤蔓也被清掉');
});

/* ===================== ⑤ 重组·回滚 ===================== */

test('⑤ 回滚：一局限用一次；只升不降；不回位置；补回的量按差额记账', () => {
  const game = start();
  const { me } = faceOff(game, 1);
  nextOwnTurn(game); nextOwnTurn(game);     // 打出第三个自己的回合 → 有两条以上历史
  assert.deepEqual(game.rewindDepths('p1'), [1], '★ 只能回滚 1 个自己回合前（历史两条）');
  const at = { row: me.row, col: me.col };
  game.s.hp.p1 = 25;                        // 假装被打掉 15 血
  game.s.ap.p1 = 3;
  assert.equal(game.rewindReason(me, 'p1'), '', '（前提）可用');
  assert.equal(game.rewind(me, me, 1), true);
  assert.equal(game.s.hp.p1, 40, '★ 生命补回快照那一档（这里就是满血）');
  assert.equal(game.s.ap.p1, 1, '花 2 AP');
  assert.deepEqual({ row: me.row, col: me.col }, at, '★ 位置不动（不能当传送用）');
  assert.match(game.rewindReason(me, 'p1'), /本局已经回滚过一次/, '★ 一局限用一次');
  assert.equal(game.rewind(me, me, 1), false, '第二次会被拒');
});

test('⑤ 回滚"只升不降"：对满血的敌人使用什么都不会发生，而且不消耗那一局一次的名额', () => {
  const game = start();
  const { me, foe } = faceOff(game, 1);
  nextOwnTurn(game); nextOwnTurn(game);
  const hpBefore = game.s.hp.p2, ap0 = game.s.ap.p1 = 3;
  assert.equal(game.rewind(me, foe, 1), false, '★ 空回滚直接作废');
  assert.equal(game.s.hp.p2, hpBefore, '敌人的血一点没掉（只升不降）');
  assert.equal(game.s.ap.p1, ap0, '行动点没花');
  assert.equal(game.s.rebuildUsed.p1, false, '★ 名额没用掉');
  assert.equal(game.rewindReason(me, 'p1'), '', '仍然可用');
});

test('⑤ 回滚不复活已经倒下的角色', () => {
  const game = start();
  const { me } = faceOff(game, 1);
  nextOwnTurn(game); nextOwnTurn(game);
  game.s.ap.p1 = 3;
  // 把自己那一方打到 0 血（"倒下就是倒下"，回滚也不能把人拉回来）
  game.s.hp.p1 = 0;
  assert.equal(game.rewindReason(me, 'p1'), '', '（前提）名额与历史都还在');
  assert.equal(game.rewind(me, me, 1), false, '★ 已经倒下的角色不能被重组回来');
  assert.equal(game.s.hp.p1, 0, '血量保持 0');
  assert.equal(game.s.rebuildUsed.p1, false, '★ 这一次没生效，名额也没被用掉');
});

/* ===================== ⑥ 界面与 AI 接线 ===================== */

test('⑥ 界面：可治疗的友军进 `view.fixable`；「重组」进技能后先是"选模式"', () => {
  const game = start('josuke', 'kakyoin', { roster: { p1b: 'polnareff', p2b: 'dio' } });
  const me = game.unit('p1-stand'), ally = game.unit('p1b-stand');
  put(me, 5, 5); put(ally, 5, 7);
  put(game.unit('p1-user'), 5, 4); put(game.unit('p1b-user'), 5, 6);
  game.s.turn = 'p1'; game.select(me.id);
  const view = game.actionView();
  assert.deepEqual(view.fixable.map(u => u.id).sort(), ['p1b-stand', 'p1b-user'], '★ 绿环目标＝可治疗的友军');
  assert.equal(view.rebuild, null, '没进「重组」时不给模式选择器');
  assert.equal(game.beginSkill(me, 'rebuild'), true);
  assert.equal(game.s.pendingSkill, 'rebuild');
  assert.equal(game.s.rebuildMode, 'mend', '默认模式＝清状态（回滚要玩家显式点）');
  const picking = game.actionView();
  assert.equal(picking.rebuild.mode, 'mend');
  assert.equal(picking.rebuild.max, SKILLS.rebuild.rewindMax);
  // 静态接线：渲染绿环、按钮、模式赋值、AI 计划
  assert.match(renderSource, /view\.fixable/, '★ 渲染层要画治疗目标的绿环');
  assert.match(hudSource, /rebuildMendBtn/, '缺少"清状态"模式按钮');
  assert.match(hudSource, /rebuildRewindBtn/, '缺少"回滚 N 回合前"按钮');
  assert.match(mainSource, /rebuildRewindBtn[\s\S]*?rebuildMode = Number/, '★ 按钮要真的写进 rebuildMode');
  assert.match(aiSource, /type: 'mend'/, '★ AI 要会治友军');
  assert.match(aiSource, /type: 'rebuild'/, '★ AI 要会用重组');
});

test('⑥ AI 真的会用：治疗友军、重拳、重组都出现在实际对局里', () => {
  const seen = new Set();
  for (const seed of [13, 777, 4242]) {
    const game = new Game({ random: seeded(seed) });
    game.setRoster({ p1b: 'polnareff', p2b: 'kakyoin' });
    game.start('josuke', 'iggy', 'ai');
    let steps = 0;
    while (game.s.phase === 'battle' && steps < 400) {
      const plan = chooseAI(game);
      if (plan) seen.add(plan.skill || plan.type);
      if (!plan || !playAIAction(game, plan)) game.endTurn();
      steps++;
    }
    assert.equal(game.s.phase, 'result', `seed ${seed}：这一局要能收尾（走了 ${steps} 步）`);
  }
  for (const id of ['heavy', 'rebuild']) assert.ok(seen.has(id), `AI 没用过 ${id}（实际用到：${[...seen].join(', ')}）`);
});

test('⑥ 点棋盘的那条路：点友军＝治疗；进「重组」后点目标＝按当前模式执行（真人玩家的实际路径）', () => {
  const game = start('josuke', 'kakyoin', { roster: { p1b: 'polnareff', p2b: 'dio' } });
  const me = game.unit('p1-stand'), ally = game.unit('p1b-stand'), foe = game.unit('p2-stand');
  put(me, 5, 5); put(ally, 5, 7); put(foe, 5, 3);
  put(game.unit('p1-user'), 5, 4); put(game.unit('p1b-user'), 5, 6);
  game.s.turn = 'p1'; game.s.hp.p1b = 20;
  game.select(me.id);
  // ① 点友军棋子所在的那一格 → 治疗（不是"选中它"）
  assert.equal(game.actionAt(game.tile(ally)), true, '★ 普攻按钮下点友军＝治疗');
  assert.equal(game.s.hp.p1b, 25);
  // ② 「重组」：先选模式，再点敌人所在格 → 清状态 ＋ 扣一发普攻伤害
  game.s.ap.p1 = 3;
  assert.equal(game.beginSkill(me, 'rebuild'), true);
  game.s.rebuildMode = 'mend';
  const hp0 = game.s.hp.p2;
  assert.equal(game.actionAt(game.tile(foe)), true, '★ 进「重组」后点目标＝执行当前模式');
  assert.ok(game.s.hp.p2 < hp0, `敌人挨了一发（${hp0} → ${game.s.hp.p2}）`);
  assert.equal(game.s.pendingSkill, null, '执行完就收手了');
});

/* ===================== ⑦ 收敛冒烟 ===================== */

test('⑦ 收敛冒烟：仗助对多个角色、以及 2v2，多种子都能打完并分出胜负', () => {
  let worst = 0, worstTag = '';
  for (const seed of [13, 777, 20261009]) {
    for (const foe of ['jotaro', 'polnareff', 'iggy', 'kakyoin', 'emperor', 'josuke']) {
      for (const [a, b] of [['josuke', foe], [foe, 'josuke']]) {
        const game = new Game({ random: seeded(seed) });
        game.start(a, b, 'ai');
        let steps = 0;
        while (game.s.phase === 'battle' && steps < 400) {
          const plan = chooseAI(game);
          if (!plan || !playAIAction(game, plan)) game.endTurn();
          steps++;
        }
        assert.equal(game.s.phase, 'result', `★ ${a}/${b} seed ${seed}：走了 ${steps} 步还没打完`);
        assert.ok(['p1', 'p2'].includes(game.s.winner), `${a}/${b} 要分出胜负`);
        if (steps > worst) { worst = steps; worstTag = `${a}/${b} seed ${seed}`; }
      }
    }
  }
  assert.ok(worst < 200, `最慢的一局也不该贴近上限（${worstTag} ${worst} 步）`);
  console.log(`  ⑦ 收敛冒烟：36 局全部分出胜负，最慢 ${worstTag} ${worst} 步`);
});
