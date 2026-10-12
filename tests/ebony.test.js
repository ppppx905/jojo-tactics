/**
 * 剧情 boss「黑檀之魔」（第六章）：**憎恨值**。
 *
 * 机制来自用户正文的规矩：「越是恨它，它就越有力气」「局面反转靠的不是力气，
 * 而是他把那股狠劲暂时收了回去……等对方认定他已经放弃，靠到足够近」。
 * 于是"打它 = 喂它"：打得越猛 → 它攻击力越高；玩家整整一个回合不打它，憎恨才会 −1。
 *
 * 数值口径（用户 2026-09-27 定的，**改之前先问**）：
 *   共享生命 40（先 45，后按用户要求"对方生命减少5点"）、**连携距离 4**、**替身射程 2**、替身防御加成 2；
 *   本体移动 3 不普攻、替身移动 4 攻击 7；
 *   憎恨上限 4、每命中 +1、每点攻击力 +1；**这一关先不做技能**。
 *   ⚠️ 本体德沃**可以被攻击**（用户 2026-09-27 要求删掉"打不到本体"的机制），
 *      但**打本体同样憎恨 +1**——否则集火本体就能完全绕过这一关的核心机制。
 *   ⚠️ 「憎恨到 3 就躲进暗处、打不到它」这套（`hideAt` / `ebonyHidden()`）**已被用户要求删除**，
 *      现在场上没有"打不到"的敌人，憎恨只负责给它加攻击力。
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { Game, RULE, FIGHTERS, STORY_CHAPTERS, EBONY, skillSetFor, playableFighters, isBoss } from '../src/core/game.js';
import { hexDist } from '../src/core/hex.js';
import { chooseAI, playAIAction } from '../src/core/ai.js';
import { CHARACTER_ART, artKeys, portrait, cutin } from '../src/ui/assets.js';
import { SPRITES } from '../src/ui/render.js';
import { tileDescription } from '../src/ui/hud.js';
import { storyRoadmap } from '../src/ui/story.js';

function seeded(seed = 21) { return () => ((seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0) / 4294967296); }
const chapter6 = STORY_CHAPTERS[5];
/** 第六章的对局（玩家波鲁纳雷夫 对 德沃/黑檀之魔）。 */
function fixture(seed = 21) {
  const game = new Game({ random: seeded(seed) });
  game.start(chapter6.player, chapter6.enemy, 'ai', { story: chapter6.id });
  game.s.terrain = {};
  return game;
}
const doll = game => game.unit('p2-stand');
const master = game => game.unit('p2-user');

test('黑檀之魔数值：40/2、连携 4、替身射程 2、攻击 7；本体不普攻；这一关先不做技能', () => {
  const f = FIGHTERS.ebony;
  assert.equal(f.boss, true, '要带 boss 标记，否则会跑进选人界面');
  assert.equal(f.hp, 40, '★ 用户 2026-09-27：「对方生命减少5点」（45 → 40）');
  assert.equal(f.def, 2);
  assert.equal(f.distLimit, 4, '★ 用户定的连携距离 4');
  assert.equal(f.standDefBonus, 2);
  assert.equal(f.user.name, '德沃');
  assert.equal(f.user.move, 3, '本体移动 3、不普攻');
  assert.equal(f.user.dmg || 0, 0, '本体没有攻击');
  assert.equal(f.stand.name, '黑檀之魔');
  assert.equal(f.stand.move, 4);
  assert.equal(f.stand.dmg, 7);
  assert.equal(f.stand.range, 2, '★ 用户定的替身射程 2');
  assert.deepEqual(skillSetFor('ebony'), [], '★ 这一关先不做技能');

  assert.equal(isBoss('ebony'), true);
  const playable = playableFighters().map(item => item.key);
  assert.equal(playable.includes('ebony'), false, '★ boss 不能被玩家选中');
  // ⚠️ 2026-10-03 第三条用户拍板：第八章的**皇帝（`emperor`）改成了 PvP 可选角色**（撤掉 boss:true），
  //    所以可选角色由 7 名变 **8 名**（'ebony 不在列表里'那条一个字没动）。
  assert.equal(playable.length, 9, '可选角色现在是 9 名（皇帝 + 东方仗助）');

  // ★ 素材已补齐（2026-09-30）：立绘改用官方替身卡片里的那具人偶重画，
  //   肖像与大招插画也照同一份参考补上了 → **不再挂 artOptional**，正常参与素材缺失检查。
  assert.deepEqual(artKeys(CHARACTER_ART.ebony), ['devo', 'ebony_devil']);
  assert.notEqual(CHARACTER_ART.ebony.artOptional, true, '★ 四件套齐了，不该再挂 artOptional（挂了 check-assets 就一直报"待补"）');
  assert.equal(portrait('ebony'), 'assets/out/portraits/ebony.webp');
  assert.equal(cutin('ebony'), 'assets/out/cutins/ebony.webp');
  for (const key of artKeys(CHARACTER_ART.ebony)) {
    assert.ok(existsSync(new URL(`../assets/out/standees/${key}.webp`, import.meta.url)), `${key} 的立绘要在`);
  }
});

test('★ 打它 = 喂它：每打中人偶一次憎恨 +1，它攻击力跟着 +1', () => {
  const game = fixture();
  const me = game.unit('p1-stand'), foe = doll(game);
  Object.assign(me, { row: foe.row, col: foe.col - 1 });
  assert.equal(game.hatredLevel(), 0, '开局憎恨 0');
  assert.equal(game.preview(foe, me).attack, FIGHTERS.ebony.stand.dmg, '开局它的攻击力就是基础值');

  for (let hit = 1; hit <= EBONY.hatredMax; hit++) {
    game.damage(foe, 1, { side: 'p1', source: '测试' });
    assert.equal(game.hatredLevel(), hit, `第 ${hit} 次命中 → 憎恨 ${hit}`);
    assert.equal(game.preview(foe, me).attack, FIGHTERS.ebony.stand.dmg + hit * EBONY.hatredAtkBonus,
      `★ 憎恨 ${hit} → 它攻击力 +${hit}`);
  }
  // 憎恨有上限
  for (let i = 0; i < 5; i++) game.damage(foe, 1, { side: 'p1', source: '测试' });
  assert.equal(game.hatredLevel(), EBONY.hatredMax, '★ 憎恨到上限就不再涨');
  assert.equal(game.preview(foe, me).attack, FIGHTERS.ebony.stand.dmg + EBONY.hatredMax * EBONY.hatredAtkBonus);
});

test('★ 憎恨再高也**没有"打不到"这种状态**（用户要求删掉"躲进暗处"机制）', () => {
  const game = fixture();
  const me = game.unit('p1-stand'), foe = doll(game);
  Object.assign(me, { row: foe.row, col: foe.col - 1 });   // 贴到它旁边，确保不是因为射程
  assert.ok(hexDist(game.tile(me), game.tile(foe)) <= me.range, '先确认在射程内');

  // 把憎恨喂满（原来是"憎恨 ≥ 3 就躲起来打不到"，现在这条规则整个删了）
  while (game.hatredLevel() < EBONY.hatredMax) game.damage(foe, 0, { side: 'p1', source: '测试' });
  assert.equal(game.hatredLevel(), EBONY.hatredMax, '憎恨已经满了');
  assert.equal(game.ebonyHidden, undefined, '★ ebonyHidden() 这个接口已经删掉');
  assert.equal(game.attackReason(me, foe), '', '★ 憎恨满了一样能打它（不再有"躲进暗处"）');
  game.s.ap.p1 = 3;
  assert.equal(game.attack(me, foe), true, '满憎恨时这一击应该成立');
});

test('★ 玩家整整一个回合不打它，憎恨才会 −1（停手能把它压下去）', () => {
  const game = fixture();
  const me = game.unit('p1-stand'), foe = doll(game);
  Object.assign(me, { row: foe.row, col: foe.col - 1 });
  while (game.hatredLevel() < EBONY.hatredMax) game.damage(foe, 0, { side: 'p1', source: '测试' });
  assert.ok(game.preview(foe, me).attack > FIGHTERS.ebony.stand.dmg, '憎恨满的时候它打得更痛');

  // ⚠️ 要走**两个完整轮**：第一个玩家回合开始时，"本回合打过它"的记录还在（不打折），
  //    到第二个玩家回合开始时才是"上一回合真的没打" → 这时才 −1。
  game.endTurn(); game.endTurn();
  assert.equal(game.hatredLevel(), EBONY.hatredMax, '打完它的那一个玩家回合，憎恨不掉');
  game.endTurn(); game.endTurn();
  assert.equal(game.hatredLevel(), EBONY.hatredMax - EBONY.hatredDecay, '★ 空手过一个回合 → −1');
  assert.equal(game.preview(foe, me).attack, FIGHTERS.ebony.stand.dmg + (EBONY.hatredMax - EBONY.hatredDecay) * EBONY.hatredAtkBonus,
    '★ 它跟着变软一点');
});

test('★ 玩家回合结束时结算：这一回合打到了它，憎恨就不掉', () => {
  const game = fixture();
  const foe = doll(game);
  game.damage(foe, 1, { side: 'p1', source: '测试' });
  assert.equal(game.hatredLevel(), 1);
  game.decayHatred();                                      // 模拟"这一回合打过"
  assert.equal(game.hatredLevel(), 1, '★ 打过就不掉');
  game.decayHatred();                                      // 下一回合没打
  assert.equal(game.hatredLevel(), 0, '★ 没打才掉');
  game.decayHatred();
  assert.equal(game.hatredLevel(), 0, '最低是 0，不会变成负数');
});

test('★ 本体德沃可以被打（用户要求删掉"打不到本体"的机制），但打他同样算喂它', () => {
  const game = fixture();
  const me = game.unit('p1-stand'), boss = master(game);
  Object.assign(me, { row: boss.row, col: boss.col - 1 });
  assert.equal(game.attackReason(me, boss), '', '★ 本体不再是"打不到"的目标');
  assert.equal(game.shipGuarded(boss), false, '这不是拆船那一关的钢壁规则');
  // 真打一下：要扣血、要算一次普通攻击，而且**憎恨照样 +1**
  game.s.ap.p1 = 3;
  assert.equal(game.attack(me, boss), true, '★ 这一击应该成立');
  assert.ok(game.s.hp.p2 < FIGHTERS.ebony.hp, '被打中就要掉共享生命');
  assert.equal(game.hatredLevel(), 1, '★ 打本体也算"打中对方一次"→ 憎恨 +1（否则集火他就绕开了这一关的机制）');
  // 本体不吃替身那 +2 防御 → 打他比打人偶更疼（这是允许打他的意义）
  const game2 = fixture();
  const me2 = game2.unit('p1-stand');
  Object.assign(me2, { row: master(game2).row, col: master(game2).col - 1 });
  const onUser = game2.preview(me2, master(game2)).damage;
  Object.assign(me2, { row: doll(game2).row, col: doll(game2).col - 1 });
  const onDoll = game2.preview(me2, doll(game2)).damage;
  assert.ok(onUser > onDoll, `★ 打本体(${onUser}) 应该比打人偶(${onDoll}) 更疼`);
});

test('★ 憎恨满了之后，人偶和本体都还是能打（已经没有"打不到"的目标了）', () => {
  const game = fixture();
  const me = game.unit('p1-stand'), foe = doll(game);
  while (game.hatredLevel() < EBONY.hatredMax) game.damage(foe, 0, { side: 'p1', source: '测试' });
  Object.assign(me, { row: foe.row, col: foe.col - 1 });
  assert.equal(game.attackReason(me, foe), '', '★ 人偶照样能打（"躲进暗处"已删）');
  const boss = master(game);
  Object.assign(me, { row: boss.row, col: boss.col - 1 });
  assert.equal(game.attackReason(me, boss), '', '★ 本体也能打');
});

test('★★ 憎恨第一次叠满时放一次大招插画，之后（含掉下去再涨回来）都不再重复放', () => {
  // 用户 2026-09-30 要求：「让他被动叠满时触发大招的画面」——而且**只放第一次**。
  const events = [];
  const game = new Game({ random: seeded(7), onEvent: event => events.push(event) });
  game.start(chapter6.player, chapter6.enemy, 'ai', { story: chapter6.id });
  game.s.terrain = {};
  const foe = doll(game);
  const cutins = () => events.filter(event => event.type === 'cutin');

  // ① 差一点就满：不该放
  while (game.hatredLevel() < EBONY.hatredMax - 1) game.damage(foe, 0, { side: 'p1', source: '测试' });
  assert.equal(game.hatredLevel(), EBONY.hatredMax - 1);
  assert.equal(cutins().length, 0, `憎恨只有 ${game.hatredLevel()}/${EBONY.hatredMax} 时不该放大招画面`);

  // ② 叠满 → 正正好放一次
  game.damage(foe, 0, { side: 'p1', source: '测试' });
  assert.equal(game.hatredLevel(), EBONY.hatredMax, '憎恨满了');
  assert.equal(cutins().length, 1, '★ 第一次叠满要放大招画面');
  const event = cutins()[0];
  assert.equal(event.side, 'p2', '是 boss 那一侧放的');
  assert.equal(event.fighter, 'ebony', '★ 画面要用这个角色的大招插画（cutins/ebony.webp）');
  assert.equal(event.label, EBONY.cutinLabel, '画面中间那行字');
  assert.equal(event.cry, EBONY.cutinCry, '画面上的喊词');
  assert.equal(event.label, '憎恨 · 满');
  assert.equal(event.cry, 'エボニーデビル', '喊词用官方卡片上的替身名，不自己编');
  assert.ok(existsSync(new URL(`../assets/out/cutins/${event.fighter}.webp`, import.meta.url)),
    '★ 这一幕真的要有图，否则只会闪一个空框');

  // ③ 已经满了之后继续命中：不该再放
  for (let i = 0; i < 3; i++) game.damage(foe, 0, { side: 'p1', source: '测试' });
  assert.equal(game.hatredLevel(), EBONY.hatredMax, '憎恨到上限就不再涨');
  assert.equal(cutins().length, 1, '★ 已经满了之后不再重复放大招画面');

  // ④ 掉下去、再涨回来：仍然不重复放（"只放第一次"）
  //    ⚠️ 要走两个完整轮：第一个玩家回合开始时"本回合打过它"的记录还在。
  game.endTurn(); game.endTurn();
  game.endTurn(); game.endTurn();
  assert.ok(game.hatredLevel() < EBONY.hatredMax, `憎恨应该掉下来了（现在 ${game.hatredLevel()}）`);
  while (game.hatredLevel() < EBONY.hatredMax) game.damage(foe, 0, { side: 'p1', source: '测试' });
  assert.equal(cutins().length, 1, '★ 掉下去又涨回来也不重复放——只有第一次满才有画面');

  // ⑤ 不是这一关的对局永远不会有这种画面
  const plainEvents = [];
  const plain = new Game({ random: seeded(8), onEvent: event => plainEvents.push(event) });
  plain.start('jotaro', 'dio');
  plain.damage(plain.unit('p2-stand'), 2, { side: 'p1', source: '测试' });
  assert.equal(plainEvents.filter(e => e.type === 'cutin').length, 0, '普通对局不会被牵连');

  // ⑥ 界面那侧必须真的有接线（静态断言，防止"事件发了但没人接"）
  const main = readFileSync(new URL('../src/main.js', import.meta.url), 'utf8');
  assert.match(main, /event\.type === 'cutin'/, '★ main.js 要处理 cutin 事件');
  assert.match(main, /SKILLS\[event\.skill\]\?\.name/,
    '★ showCutin 必须能处理"没有 skill 字段"的事件——写成 SKILLS[event.skill].name 会抛错、把整个大招画面吃掉');
});

test('第六章数据：读→打→读，波鲁纳雷夫半血觉醒「不屈」，机制旗标打开', () => {
  assert.equal(chapter6.id, 'chapter-6');
  assert.equal(chapter6.label, '第六章');
  assert.equal(chapter6.player, 'polnareff', '★ 这一战玩家是波鲁纳雷夫');
  assert.equal(chapter6.enemy, 'ebony');
  assert.equal(chapter6.hatred, true, '★ 这面旗决定引擎要不要启用憎恨值');
  assert.deepEqual(chapter6.scenes.map(scene => scene.kind), ['read', 'battle', 'read']);
  assert.equal(chapter6.scenes[0].readId, 'devil', '⚠️ 故事弧的 id 是 devil（不是 ebony）——写错就读不到正文');
  assert.equal(chapter6.scenes[0].upto, 2, '前 2 段读完才开打');
  assert.equal(chapter6.scenes[2].from, 2, '第 3 段开头是"局面反转"，必须留在战斗之后');
  // ★★ 2026-10-04 用户要求①（任务一）：第六章的觉醒名「把狠劲收回去」→ **「不屈」**。
  //    ⚠️ 这一句是那次改名**直接推翻**的断言（原来写的是「把狠劲收回去」），本条测试的标题也跟着改了；
  //    其余一个字没动（技能不换、机制旗标、开场憎恨 0 这些都照旧在断言里）。
  assert.equal(chapter6.swaps.polnareff.rage.name, '不屈');
  assert.equal(chapter6.swaps.polnareff.skills, undefined, '★ 不换技能（这一关只加觉醒）');

  const game = fixture();
  assert.deepEqual(game.skills('p1'), skillSetFor('polnareff'), '玩家还是他那套技能');
  assert.equal(game.s.hatred, 0, '开局憎恨 0');
  assert.equal(game.ebonyRule(), EBONY);

  // 不是这一关的对局不该被影响
  const plain = new Game({ random: seeded() });
  plain.start('jotaro', 'dio');
  assert.equal(plain.ebonyRule(), null);
  assert.equal(plain.hatredLevel(), 0);
  assert.equal(plain.decayHatred(), undefined);
  assert.equal(plain.hatredAtkBonus(plain.unit('p2-stand')), 0);
});

test('第六章在章节列表里是第六章、第 20–22 话，覆盖「黑檀之魔」那一弧', () => {
  const rows = storyRoadmap();
  assert.equal(rows[5].chapterId, 'chapter-6');
  assert.equal(rows[5].label, '第六章');
  assert.match(rows[5].range, /^第 20–22 话$/);
  assert.equal(rows.filter(row => row.title === '黑檀之魔' && !row.playable).length, 0,
    '「黑檀之魔」已被第六章覆盖，不该再单列一条"未开放"');
});

test('第六章的关卡机制说明与四句台词都写齐了', () => {
  assert.ok(chapter6.specialRules?.length >= 4, '机制多，要逐条写清');
  for (const keyword of ['憎恨', '可以打', '打本体也算', '冷静']) {
    assert.ok(chapter6.specialRules.some(t => t.includes(keyword)), `机制说明里应包含「${keyword}」`);
  }
  // ★ 用户 2026-09-27 删掉了"躲进暗处"机制，说明里**不能再提"打不到它"**，
  //   否则玩家会照着一份过期的规则打（找了半天也等不到它探头）。
  assert.equal(chapter6.specialRules.some(t => /躲进|缩进|打不到/.test(t)), false,
    '★ 机制说明里不能再有"躲进暗处 / 打不到"那套说法');
  assert.ok(chapter6.specialRules.some(t => t.includes('德沃') && t.includes('可以打')),
    '机制说明里要写清「本体德沃也可以打」');
  for (const key of ['start', 'turn2', 'half', 'death']) {
    const line = chapter6.barks?.[key];
    assert.ok(line?.who && line?.text, `缺 ${key} 台词`);
    assert.equal(line.key, 'polnareff', `${key} 的说话人应该是波鲁纳雷夫`);
    assert.equal(line.text.includes('把狠劲'), false, '★ 台词不能抢战后正文的觉悟');
  }
});

test('第六章能真的开打：AI 能把这局打完（不会卡死）', () => {
  for (const seed of [7919, 15838, 23757, 31676]) {
    const game = new Game({ random: seeded(seed), onEvent: () => {} });
    game.start(chapter6.player, chapter6.enemy, 'ai', { story: chapter6.id });
    let guard = 0;
    while (game.s.phase === 'battle' && guard++ < 600) {
      if (!playAIAction(game, chooseAI(game))) game.endTurn();
      assert.ok(game.s.ap[game.s.turn] >= 0, '行动点不能为负');
    }
    assert.ok(guard < 600, `★ seed ${seed} 的这局没打完（走了 ${guard} 步）`);
    assert.equal(game.s.phase, 'result', `seed ${seed} 应分出胜负`);
    assert.ok(['p1', 'p2'].includes(game.s.winner));
  }
});

test('切换关卡不会互相串规则：拆船与憎恨各自只在那一关生效', () => {
  const ship = new Game({ random: seeded(2) });
  ship.start('jotaro', 'forever', 'ai', { story: 'chapter-5' });
  assert.equal(ship.shipRule() !== null, true, '第五章有拆船规则');
  assert.equal(ship.ebonyRule(), null, '第五章没有憎恨值');

  const ebony = fixture();
  assert.equal(ebony.ebonyRule(), EBONY, '第六章有憎恨值');
  assert.equal(ebony.shipRule(), null, '第六章没有拆船规则');
  assert.equal(ebony.shipParts('p2').length, 0, '第六章没有船体要害');
  assert.equal(ebony.moveRange(ebony.unit('p1-stand')), ebony.unit('p1-stand').move, '憎恨不会改移动距离');
});
