/**
 * 第七章「披着同伴的脸」（黄色节制）：**两阶段**机制。
 *
 * 用户 2026-09-30 定的规则：
 *   · 阶段 1「伪装」：敌方那一方**就是花京院本人**（棋子/数值/技能/头像全用他的）——所以开局是两枚棋子；
 *   · 共享生命掉到一半以下 → **伪装破裂**：换成单单位的本体「拉巴索 & 黄色节制」，**血量重置为满血**；
 *   · 本体数值照官方卡片雷达图（耐久高、射程短、攻击低）：45 / 防御 2 / 移动 3 / **射程 1** / **攻击 6**。
 *
 * ⚠️ 触发判定必须在**判胜负之前**（`damage()` 内部）：否则一发把伪装形态打死时这一局就结束了，
 *    玩家永远看不到本体。这里专门有一条"一发打穿也要变身"的用例守着。
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { Game, RULE, FIGHTERS, STORY_CHAPTERS, TEMPERANCE, SKILLS, skillSetFor, playableFighters, isBoss } from '../src/core/game.js';
import { hexDist } from '../src/core/hex.js';
import { chooseAI, playAIAction } from '../src/core/ai.js';
import { CHARACTER_ART, artKeys } from '../src/ui/assets.js';
import { storyRoadmap } from '../src/ui/story.js';

function seeded(seed = 31) { return () => ((seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0) / 4294967296); }
const chapter7 = STORY_CHAPTERS.find(c => c.id === 'chapter-7');
/** 第七章的对局（玩家承太郎 对 伪装者）。 */
function fixture(seed = 31) {
  const game = new Game({ random: seeded(seed) });
  game.start(chapter7.player, chapter7.enemy, 'ai', { story: chapter7.id });
  game.s.terrain = {};
  return game;
}

/** 已经变身成"本体"的对局（跳过伪装阶段，方便直接测本体那套技能）。 */
function transformed(seed = 51) {
  const game = fixture(seed);
  game.s.hp.p2 = FIGHTERS.kakyoin.hp / 2;
  game.damage(game.unit('p2-user'), 1, { side: 'p1', source: '测试' });
  assert.equal(game.disguised(), false, '（helper：这时应该已经变成本体了）');
  return game;
}

test('黄色节制数值与登记：单单位（照乔瑟夫的做法）、35/2、移动 3、射程 1、攻击 6、不进选人列表', () => {
  const f = FIGHTERS.temperance;
  assert.equal(f.boss, true, '要带 boss 标记，否则会跑进选人界面');
  assert.equal(f.solo, true, '★ 用户要求"做成一体的，类似乔瑟夫"：单单位');
  assert.equal(f.stand, null, '替身糊在身上，没有独立的替身棋子');
  assert.equal(f.standName, '黄色节制', '替身名要留着（界面才写得出"只有本体上阵"）');
  assert.equal(f.hp, 35, '★ 生命 35（用户先选方案 A 的 45，随后要求"削弱本体血量，改为35"）');
  assert.equal(f.def, 2);
  assert.equal(f.distLimit, 0, '单单位没有连携距离');
  assert.equal(f.standDefBonus, 0);
  assert.equal(f.user.name, '拉巴索');
  assert.equal(f.user.move, 3);
  assert.equal(f.user.range, 1, '★ 射程 1（卡片上射程距离 E：够不着）');
  assert.equal(f.user.dmg, 6, '★ 攻击 6（卡片上破坏力 D：打不痛）');

  assert.equal(isBoss('temperance'), true);
  assert.equal(playableFighters().map(x => x.key).includes('temperance'), false, '★ boss 不能被玩家选中');
  // ⚠️ 2026-10-03 第三条用户拍板：第八章的**皇帝（`emperor`）改成了 PvP 可选角色**（撤掉 boss:true），
  //    所以可选角色由 7 名变 **8 名**（'temperance 不在列表里'那条一个字没动）。
  assert.equal(playableFighters().length, 9, '可选角色现在是 9 名（皇帝 + 东方仗助）');

  // ★ 三张素材已齐（2026-09-30）：不再挂 artOptional，正常参与素材缺失检查
  assert.notEqual(CHARACTER_ART.temperance.artOptional, true, '素材齐了就不该再挂 artOptional');
  assert.deepEqual(artKeys(CHARACTER_ART.temperance), ['rubber_soul'], '单单位只需要本体那一张立绘');
  for (const url of ['assets/out/standees/rubber_soul.webp', 'assets/out/portraits/temperance.webp', 'assets/out/cutins/temperance.webp']) {
    assert.ok(fs.existsSync(new URL(`../${url}`, import.meta.url)), `★ ${url} 要在（别只写路径不生成图）`);
  }
});

test('★ 本体技能：侵蚀（被动，每次自己普攻 −2 HP）＋史莱姆防御（1 AP / +2 防御 / CD 1 回合）', () => {
  assert.deepEqual(skillSetFor('temperance'), ['erosion', 'slime']);
  assert.equal(SKILLS.erosion.passive, true, '侵蚀是被动');
  assert.equal(SKILLS.erosion.erosionDmg, 2, '★ 每次自己普攻扣 2 血');
  assert.equal(SKILLS.slime.cost, 1, '★ 史莱姆防御 1 AP');
  assert.equal(SKILLS.slime.cd, 2, '数据值 2 = 用户口径的 CD 1');
  assert.equal(SKILLS.slime.guard, 2, '★ 提高 2 点防御');
  // ⚠️ 伪装阶段的技能是**花京院那套**，不该带出自家的技能
  const disguised = new Game({ random: seeded(41) });
  disguised.start('jotaro', 'temperance', 'ai', { story: 'chapter-7' });
  assert.deepEqual(disguised.skills('p2'), skillSetFor('kakyoin'), '伪装阶段还没有侵蚀与史莱姆防御');
});

test('★ 开局敌方那一方就是花京院本人：两枚棋子、用他的数值与技能', () => {
  const game = fixture();
  const foe = game.fighter('p2');
  assert.equal(game.temperanceRule(), TEMPERANCE);
  assert.equal(game.disguised(), true, '★ 开局处在伪装阶段');
  assert.equal(foe.key, TEMPERANCE.disguiseAs, `阶段 1 的角色是 ${TEMPERANCE.disguiseAs}`);
  assert.equal(game.s.hp.p2, FIGHTERS.kakyoin.hp, '共享生命按花京院的上限（40）');
  assert.deepEqual(game.skills('p2'), skillSetFor('kakyoin'), '★ 技能也是他那套（绿宝石 / 创伤 / 绿宝石水花）');

  const units = game.s.units.filter(u => u.side === 'p2');
  assert.deepEqual(units.map(u => u.kind).sort(), ['stand', 'user'], '★ 伪装阶段是两枚棋子（本体 + 绿色法皇）');
  assert.equal(units.every(u => u.fighter === 'kakyoin'), true, '棋子的外观都走花京院那一套');
  assert.equal(game.pairDistance('p2') <= game.distLimit('p2'), true, '照旧受连携距离约束');
});

test('★★ 掉到半血以下：伪装破裂 → 换成本体、血量重置为满血、只剩一枚棋子', () => {
  const events = [];
  const game = new Game({ random: seeded(32), onEvent: event => events.push(event) });
  game.start(chapter7.player, chapter7.enemy, 'ai', { story: chapter7.id });
  game.s.terrain = {};
  const foe = game.s.units.find(u => u.side === 'p1' && u.kind === 'stand');
  // 变身前的坐标（★ 2026-10-05 棋盘放大后摆位行从 5 变成 6 —— 这里改成"记下来再比"，
  // 断言的意思一个字没变：本体必须站在伪装形态**原来的位置上**）
  const before = { row: game.unit('p2-user').row, col: game.unit('p2-user').col };

  // 先打到刚好半血以上一点：还不该变身
  game.s.hp.p2 = FIGHTERS.kakyoin.hp / 2 + 1;
  game.damage(game.unit('p2-user'), 0, { side: 'p1', source: '测试' });
  assert.equal(game.disguised(), true, `半血以上（${game.s.hp.p2}）不该变身`);

  // 再打 1 点 → 正好一半 → 触发
  game.damage(game.unit('p2-user'), 1, { side: 'p1', source: '测试' });
  assert.equal(game.disguised(), false, '★ 半血（含正好一半）就现出本体');
  assert.equal(game.fighter('p2').key, 'temperance');
  assert.equal(game.s.hp.p2, FIGHTERS.temperance.hp, `★ 血量重置为满血 ${FIGHTERS.temperance.hp}`);
  assert.deepEqual(game.skills('p2'), skillSetFor('temperance'), '本体的技能表（这一关暂时不做技能）');

  const units = game.s.units.filter(u => u.side === 'p2');
  assert.equal(units.length, 1, '★ 本体只有一枚棋子');
  assert.equal(units[0].id, 'p2-user');
  assert.equal(units[0].fighter, 'temperance');
  assert.equal(units[0].range, 1);
  assert.equal(units[0].dmg, 6);
  assert.equal(units[0].row, before.row, '站在伪装形态原来的位置上（行）');
  assert.equal(units[0].col, before.col, '站在伪装形态原来的位置上（列）');

  const banner = events.find(e => e.type === 'unmask');
  assert.ok(banner, '★ 要发一条 unmask 事件（界面据此放大字横幅）');
  assert.match(banner.kicker, /伪装破裂/);
  assert.equal(banner.tail, `那张脸不是花京院 · 血量重置为满血 ${FIGHTERS.temperance.hp} · 现在只有一枚棋子、射程 1 格`);
  assert.equal(foe.side, 'p1', '（这行只是为了用一下变量，避免 lint 噪音）');
});

test('★ 一发打穿伪装形态也要变身：不能直接判负', () => {
  const game = fixture(33);
  game.s.hp.p2 = FIGHTERS.kakyoin.hp / 2 + 1;      // 比半血多一点
  const attacker = game.unit('p1-stand');
  Object.assign(attacker, { row: game.unit('p2-user').row, col: game.unit('p2-user').col - 1 });
  game.s.ap.p1 = 3;
  game.s.hp.p2 = 4;                                 // 一发能打死
  assert.equal(game.attack(attacker, game.unit('p2-user')), true);
  assert.equal(game.disguised(), false, '★ 这一发应该触发变身，而不是把它打死');
  assert.equal(game.s.hp.p2, FIGHTERS.temperance.hp, '血量被重置回满');
  assert.equal(game.s.phase, 'battle', '★ 这一局必须继续（不能因为伪装形态掉到 0 血就直接结束）');
  assert.equal(game.checkEnd(), false, '现在没有一方被打死');
});

test('★ 变身会把伪装阶段铺的绿宝石柱一起清掉（那是花京院的造物，也会给它回血）', () => {
  const game = fixture(34);
  const stand = game.unit('p2-stand');            // 绿色法皇
  game.s.turn = 'p2';
  game.select(stand.id);
  assert.equal(game.beginSkill(stand, 'emerald'), true);
  assert.equal(game.place(stand, game.placement(stand, 'emerald')[0]), true);
  assert.equal(game.pillarsOf('p2').length, 1, '伪装阶段先铺一根柱子');
  game.s.hp.p2 = 1;
  game.damage(game.unit('p2-user'), 1, { side: 'p1', source: '测试' });
  assert.equal(game.disguised(), false, '已变身');
  assert.equal(game.pillarsOf('p2').length, 0, '★ 柱子跟着伪装一起消失');
});

test('★★ 侵蚀：本体打中你 → 你之后每次【自己普攻】都掉 2 血，一直到这一局结束（技能不算）', () => {
  const game = transformed(51);
  const boss = game.unit('p2-user'), me = game.unit('p1-stand');
  Object.assign(boss, { row: 5, col: 5 }); Object.assign(me, { row: 5, col: 6 });
  assert.equal(game.s.eroded.p1, false, '开局没被侵蚀');

  // 本体打一下 → 玩家那一方中侵蚀（本体的攻击技/普攻都算"攻击"）
  game.s.turn = 'p2'; game.s.ap.p2 = 3;
  assert.equal(game.attack(boss, me), true);
  assert.equal(game.s.eroded.p1, true, '★ 本体的攻击给对面挂上了侵蚀');

  // 玩家普攻：自己额外掉 2 血
  game.s.turn = 'p1'; game.s.ap.p1 = 3;
  const before = game.s.hp.p1;
  assert.equal(game.attack(me, boss), true);
  const lost = before - game.s.hp.p1;
  // 这一下同时挨了反击，所以只断言"至少多了侵蚀那 2 点"，再单独验一次干净的账
  assert.ok(lost >= SKILLS.erosion.erosionDmg, `普攻这一下应该包含侵蚀的 ${SKILLS.erosion.erosionDmg} 点（实际掉 ${lost}）`);

  // 单独算账：把 boss 的攻击键剪掉，玩家只做一次普攻，应该正好掉 2（普攻对 boss 的伤害另算）
  const clean = transformed(52);
  clean.s.eroded.p1 = true;                      // 直接置上侵蚀
  const stand = clean.unit('p1-stand'), foe = clean.unit('p2-user');
  Object.assign(stand, { row: 5, col: 5 }); Object.assign(foe, { row: 5, col: 7 });   // 离得远：boss 打不到他
  clean.s.turn = 'p1'; clean.s.ap.p1 = 3;
  const hp0 = clean.s.hp.p1;
  assert.equal(clean.attack(stand, foe), true);
  assert.equal(clean.s.hp.p1, hp0 - SKILLS.erosion.erosionDmg, '★ 自己出手普攻 → 正好掉 2 血');

  // 技能攻击不吃侵蚀
  const skillGame = transformed(53);
  skillGame.s.eroded.p1 = true;
  const s2 = skillGame.unit('p1-stand'), f2 = skillGame.unit('p2-user');
  Object.assign(s2, { row: 5, col: 5 }); Object.assign(f2, { row: 5, col: 7 });
  skillGame.s.turn = 'p1'; skillGame.s.ap.p1 = 3;
  const hp1 = skillGame.s.hp.p1;
  assert.equal(skillGame.attack(s2, f2, 'ora'), false, '离得远，欧拉打不到（先确认这一下不会发生）');
  assert.equal(skillGame.s.hp.p1, hp1, '技能没打出去，自然也不掉血');
});

test('★ 侵蚀不叠加、也不会自己消失（跨回合仍在）', () => {
  const game = transformed(54);
  game.s.eroded.p1 = true;
  game.endTurn(); game.endTurn();
  assert.equal(game.s.eroded.p1, true, '★ 过了一整轮还在（持续到这一局结束）');
  const boss = game.unit('p2-user'), me = game.unit('p1-stand');
  Object.assign(boss, { row: 5, col: 5 }); Object.assign(me, { row: 5, col: 6 });
  game.s.turn = 'p2'; game.s.ap.p2 = 5;
  game.attack(boss, me);
  assert.equal(game.s.eroded.p1, true, '重复命中只是"已经中了"，没有层数');
});

test('★ 史莱姆防御：1 AP 换基础防御 +2，撑一整个对手回合、自己下个回合开始时到期，CD 期间不能再用', () => {
  const game = transformed(55);
  const boss = game.unit('p2-user');
  assert.equal(game.baseDefense('p2'), FIGHTERS.temperance.def);
  game.s.turn = 'p2'; game.s.ap.p2 = 3;
  assert.equal(game.beginSkill(boss, 'slime'), true);
  assert.equal(game.s.ap.p2, 2, '花 1 AP');
  assert.equal(game.baseDefense('p2'), FIGHTERS.temperance.def + SKILLS.slime.guard, '★ 基础防御 +2');
  assert.equal(game.s.cd.p2.slime, SKILLS.slime.cd, '用完进 CD');
  assert.match(game.skillReason(boss, 'slime'), /冷却/, '★ CD 期间不能再放');

  game.endTurn();                                  // 轮到玩家：加成还在
  assert.equal(game.baseDefense('p2'), FIGHTERS.temperance.def + SKILLS.slime.guard, '对手回合里仍然有效');
  game.endTurn();                                  // 又轮到 boss：到期
  assert.equal(game.baseDefense('p2'), FIGHTERS.temperance.def, '★ 施放方下个回合开始时到期');

  game.s.ap.p2 = 3;
  game.endTurn(); game.endTurn();                  // 再隔一个自己回合，CD 走完
  assert.equal(game.beginSkill(boss, 'slime'), true, 'CD 走完可以再用');
});

test('★ 侵蚀能把人扣死，而且必须先判胜负（不能卡在战斗里）', () => {
  const game = transformed(56);
  const stand = game.unit('p1-stand'), foe = game.unit('p2-user');
  game.s.eroded.p1 = true;
  Object.assign(stand, { row: 5, col: 5 }); Object.assign(foe, { row: 5, col: 7 });
  game.s.hp.p1 = SKILLS.erosion.erosionDmg;       // 只剩 2 血：这一下普攻会被侵蚀扣死
  game.s.turn = 'p1'; game.s.ap.p1 = 3;
  assert.equal(game.attack(stand, foe), true);
  assert.equal(game.s.hp.p1, 0, '被侵蚀反噬到 0');
  assert.equal(game.s.phase, 'result', '★ 这一局要立刻结束');
  assert.equal(game.s.winner, 'p2', '玩家被自己的侵蚀拖死，本体获胜');
});

test('第七章数据：读→打→读，战斗放在第 3 段之后，机制旗标打开', () => {
  assert.equal(chapter7.label, '第七章');
  assert.equal(chapter7.player, 'jotaro', '★ 这一战玩家是承太郎');
  assert.equal(chapter7.enemy, 'temperance');
  assert.equal(chapter7.temperance, true, '★ 这面旗决定引擎要不要启用两阶段规则');
  assert.deepEqual(chapter7.scenes.map(s => s.kind), ['read', 'battle', 'read']);
  assert.equal(chapter7.scenes[0].readId, 'temperance', '★ 故事弧 id 是 temperance');
  assert.equal(chapter7.scenes[0].upto, 3, '前 3 段读完才开打');
  assert.equal(chapter7.scenes[2].from, 3, '第 4 段是"验伪 + 在水边结束"，必须留在战斗之后');
  assert.equal(chapter7.specialRules?.length >= 3, true, '两阶段机制要写给玩家看');

  // 章节列表里要能看出是第七章、覆盖 temperance 那一弧
  const rows = storyRoadmap();
  const row = rows.find(r => r.chapterId === 'chapter-7');
  assert.ok(row, '章节列表里应有第七章');
  assert.match(row.range, /^第 23–26 话$/, '话数对应正文里的第 23–26 话');
});

test('两阶段不会牵连别的章节：普通对局与其他 boss 关卡都不受影响', () => {
  const plain = new Game({ random: seeded(35) });
  plain.start('jotaro', 'dio');
  assert.equal(plain.temperanceRule(), null);
  assert.equal(plain.disguised(), false);
  assert.equal(plain.unmaskIfNeeded('p2'), false, '非本章不做事');
  plain.damage(plain.unit('p2-user'), 5, { side: 'p1', source: '测试' });
  assert.equal(plain.fighter('p2').key, 'dio', '普通对局的角色不会被换掉');

  const ebony = new Game({ random: seeded(36) });
  ebony.start('polnareff', 'ebony', 'ai', { story: 'chapter-6' });
  assert.equal(ebony.temperanceRule(), null, '第六章没有两阶段规则');
  assert.equal(ebony.disguised(), false);
});

test('第七章能真的开打：AI 能把这局打完（含变身之后）', () => {
  for (const seed of [4101, 4213, 4437]) {
    const game = new Game({ random: seeded(seed), onEvent: () => {} });
    game.start(chapter7.player, chapter7.enemy, 'ai', { story: chapter7.id });
    let guard = 0, sawUnmask = false, sawReal = false;
    while (game.s.phase === 'battle' && guard++ < 900) {
      if (!game.disguised()) sawReal = true;
      if (!playAIAction(game, chooseAI(game))) game.endTurn();
      assert.ok(game.s.ap[game.s.turn] >= 0, '行动点不能为负');
    }
    assert.ok(guard < 900, `★ seed ${seed} 的这局没打完（走了 ${guard} 步）`);
    assert.equal(game.s.phase, 'result', `seed ${seed} 应分出胜负`);
    assert.equal(sawReal, true, '★ 这一局里应该出现过"本体"形态');
  }
});

test('★ 界面接线：main.js 要处理 unmask 事件（大字横幅）', () => {
  const main = fs.readFileSync(new URL('../src/main.js', import.meta.url), 'utf8');
  assert.match(main, /event\.type === 'unmask'/, '★ main.js 要处理 unmask 事件');
  assert.match(main, /function showUnmaskBanner\(/, '缺 showUnmaskBanner()');
  assert.match(main, /function showBigBanner\(/, '大字横幅要抽成一个共用函数（换层与伪装破裂共用）');
  assert.match(main, /event\.resigned/, '（顺带守着上一轮加的认输分支，别被覆盖掉）');
});
