/**
 * 剧情 boss「力量」（第五章）：**整艘船就是替身**。
 *
 * 这一关的规则不靠技能，全靠场地——boss 是单棋子的猩猩，替他出手的是这艘船：
 *   · 场上 3 个「船体要害」护着他，拆完之前打不到他本人
 *   · 每回合棋盘自己变形（钢壁出现/移开），但**绝不能把单位困死**
 *   · 每拆掉一个要害，战场就往船里推进一层（中途换场地）
 *
 * ⚠️ 本章数值目前是**草案**（用户 2026-09-26 要求"先别定数值，先把机制做出来"），
 *    所以下面的断言只钉**机制**（数量、倍率关系、阶段顺序、不困死、不污染章节数据），
 *    尽量少写死具体数字；真要调数值时只改 rules.js 的 STRENGTH。
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { Game, RULE, FIGHTERS, STORY_CHAPTERS, STRENGTH, skillSetFor, playableFighters, isBoss } from '../src/core/game.js';
import { hexDist, tileKey, ROWS, COLS } from '../src/core/hex.js';
import { chooseAI, playAIAction } from '../src/core/ai.js';
import { CHARACTER_ART, artKeys, ARENAS, PENDING_ARENAS, portrait, cutin, PART_SPRITES } from '../src/ui/assets.js';
import { SPRITES } from '../src/ui/render.js';
import { tileDescription } from '../src/ui/hud.js';
import { storyRoadmap } from '../src/ui/story.js';

function seeded(seed = 13) { return () => ((seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0) / 4294967296); }
const chapter5 = STORY_CHAPTERS[4];
/** 第五章的对局（开战流程走完整的 start()，所以要害与初始钢壁都已铺好）。 */
function fixture(seed = 13) {
  const game = new Game({ random: seeded(seed) });
  game.start(chapter5.player, chapter5.enemy, 'ai', { story: chapter5.id });
  return game;
}
const partCount = rule => rule.parts.length;

test('猩猩是单棋子 boss：替身「力量」没有棋子，因为整艘船就是它', () => {
  const f = FIGHTERS.forever;
  assert.equal(f.boss, true, '要带 boss 标记，否则会跑进选人界面');
  assert.equal(f.solo, true, '★ 单棋子 boss（第二个 solo 角色，第一个是乔瑟夫）');
  assert.equal(f.stand, null, '★ 替身不给棋子——它由整张棋盘来当');
  assert.equal(f.standName, '力量', '但必须记住替身名，界面才不能写成"无替身"');
  assert.equal(f.user.name, '猩猩');
  assert.ok(f.user.dmg > 0 && f.user.range > 0, '单棋子角色必须自己带普攻（否则这一关没人能打）');
  assert.deepEqual(skillSetFor('forever'), [], '这一关不加技能：机制全在场地和物件上');

  assert.equal(isBoss('forever'), true);
  const playable = playableFighters().map(item => item.key);
  assert.equal(playable.includes('forever'), false, '★ boss 不能被玩家选中');
  // ⚠️ 2026-10-03 第三条用户拍板：第八章的**皇帝（`emperor`）改成了 PvP 可选角色**（撤掉 boss:true），
  //    所以可选角色由 7 名变 **8 名**（'forever 不在列表里'那条一个字没动）。
  assert.equal(playable.length, 9, '可选角色现在是 9 名（皇帝 + 东方仗助）');

  // 只需要 3 张图（本体立绘 + 肖像 + 插画）：没有替身立绘那一份。三张都已就位。
  assert.deepEqual(artKeys(CHARACTER_ART.forever), ['forever']);
  assert.equal(CHARACTER_ART.forever.artOptional, undefined, '★ 图都画好了，不该再挂 artOptional');
  assert.equal(portrait('forever'), 'assets/out/portraits/forever.webp');
  assert.equal(cutin('forever'), 'assets/out/cutins/forever.webp');
});

test('★ 船体要害有自己的棋子图：四个钢制部件都登记齐、进 SPRITES、与 STRENGTH.parts 对得上', () => {
  const keys = Object.keys(PART_SPRITES);
  assert.deepEqual(keys.sort(), ['part-boiler', 'part-column', 'part-valve', 'part-winch'], '四个部件的键名');
  for (const key of keys) {
    assert.ok(SPRITES[key], `★ ${key} 必须进 SPRITES，否则棋子不会被加载、只能退回代码画的钢块`);
    assert.ok(existsSync(new URL(`../${PART_SPRITES[key]}`, import.meta.url)), `${key} 的图片要真的存在`);
  }
  // 三个要害各自的 key 都要能查到图（查不到就会退回代码画的钢块）
  for (const def of STRENGTH.parts) {
    assert.ok(PART_SPRITES[def.key], `要害「${def.name}」的 key=${def.key} 必须能在 PART_SPRITES 里查到`);
  }
  // 开战时那个要害身上要带着 key（渲染层按它取图）
  const game = fixture();
  assert.equal(game.shipParts('p2')[0].partKey, STRENGTH.parts[0].key, '要害实例要带上 partKey');
});

test('开战：一次只出现一个要害（固定在角落）、猩猩不在场、船体耐久满值 40', () => {
  const game = fixture();
  const parts = game.shipParts('p2');
  assert.equal(parts.length, 1, '★ 用户 2026-09-27：要害**依次出现**，一次只有一个');
  assert.equal(game.s.shipPartIndex, 0, '开局是第 0 个要害');
  const first = parts[0];
  assert.equal(first.side, 'p2', '要害属于 boss 那一方');
  assert.equal(first.part, true, '要害要带 part 标记（拆掉时才会推进场地）');
  assert.equal(first.name, STRENGTH.parts[0].name);
  assert.equal(first.hp, STRENGTH.partHp, '★ 要害血量取自 STRENGTH（用户定的 20）');
  assert.equal(first.maxHp, STRENGTH.partHp);
  // ★ 无防御：`defense()` 对柱子一律返回 0，用户要的"无防御"是现成的
  assert.equal(game.defense(first).total, 0, '★ 要害无防御');
  // 固定在角落（离棋盘四角最多 1 格）
  const corner = (r, c) => (r <= 1 || r >= ROWS - 2) && (c <= 1 || c >= COLS - 2);
  for (const def of STRENGTH.parts) {
    assert.ok(corner(def.row, def.col), `要害「${def.name}」应固定在角落，现在是 (${def.row},${def.col})`);
  }

  // ★ 猩猩开局**不在棋盘上**
  assert.equal(game.s.units.filter(u => u.side === 'p2').length, 0, '★ 猩猩要拆完最后一个要害才登场');
  assert.equal(game.s.hp.p2, FIGHTERS.forever.hp, '船体耐久开局是满的');
  assert.equal(FIGHTERS.forever.hp, 40, '★ 用户定的猩猩血量 40');

  // ★ 开局第一回合就扣了"船体挤压"的血
  assert.equal(game.s.hp.p1, FIGHTERS.jotaro.hp - STRENGTH.drainPerTurn,
    `★ 开局就该扣 ${STRENGTH.drainPerTurn} 点（用户要求"开局时每回合扣 2 血"）`);

  // 初始钢壁：至少立了一部分，而且都在指定的隔板位上
  const slots = new Set(STRENGTH.bulwarkSlots.map(s => `${s.row},${s.col}`));
  const walls = game.tiles.filter(t => game.isRock(t));
  assert.ok(walls.length > 0, '开战就该有几面钢壁，第一眼就看得出走廊很窄');
  for (const wall of walls) {
    assert.ok(slots.has(`${wall.row},${wall.col}`), `钢壁只能出现在隔板位上，这里是 (${wall.row},${wall.col})`);
  }
  // 船舱内部不该长出草丛/毒沼/恢复点
  const others = Object.values(game.s.terrain).filter(t => t !== 'rock');
  assert.deepEqual(others, [], '★ 船舱里不撒野外地形（generateTerrain 在 ship 关卡直接返回）');

  assert.equal(game.arenaKey(), STRENGTH.arenas[0], '开战在第一层');
  assert.equal(game.arenaName(), STRENGTH.arenaNames[STRENGTH.arenas[0]], '层名走 STRENGTH.arenaNames');
  assert.equal(game.healthLabel('p2'), '船体耐久', '★ boss 的血条叫「船体耐久」');
  assert.equal(game.healthLabel('p1'), '共享生命', '玩家那边照旧');
  // 键名要登记（否则背景会静默变回默认深色底）；图要么已经画好、要么列在待补清单里
  for (const key of STRENGTH.arenas) {
    assert.ok(SPRITES[`arena:${key}`], `★ ${key} 要登记进 SPRITES，否则不会被加载`);
    assert.ok(existsSync(new URL(`../${ARENAS[key]}`, import.meta.url)), `${key} 的背景图应该已经画好了`);
  }
});

test('★ 三个要害依次出现在固定角落：拆掉一个才出下一个', () => {
  const game = fixture();
  const seen = [];
  for (let i = 0; i < STRENGTH.parts.length; i++) {
    const parts = game.shipParts('p2');
    assert.equal(parts.length, 1, `第 ${i + 1} 步场上应该只有一个要害`);
    const part = parts[0];
    const def = STRENGTH.parts[i];
    seen.push({ name: part.name, row: part.row, col: part.col });
    assert.equal(part.name, def.name, `第 ${i + 1} 个应该是「${def.name}」`);
    assert.equal(part.row, def.row);
    assert.equal(part.col, def.col, '位置固定在 STRENGTH.parts 里写好的角落');
    game.damage(part, 999, { side: 'p1', source: '测试' });
  }
  assert.deepEqual(seen, STRENGTH.parts.map(p => ({ name: p.name, row: p.row, col: p.col })), '顺序与数据一致');
  assert.equal(game.shipParts('p2').length, 0, '拆完最后一个就没了');
  assert.equal(game.s.shipPartIndex, STRENGTH.parts.length - 1);
});

test('★ 拆要害不加伤害：承太郎全程固定 8（用户 2026-09-27 定的）', () => {
  // ⚠️ 这条是"用户改主意"的回归：最早要求过"每拆一个要害伤害 +1"，后来又改回"基础攻击 8、不要成长"。
  //    机制代码（shipBreakBonus / unitAttack）都还在，`STRENGTH.breakBonus` 改回 1 就能恢复。
  assert.equal(STRENGTH.breakBonus, 0, '★ 拆要害不加伤害（改回 1 才会恢复成长）');
  const game = fixture();
  const me = game.unit('p1-stand');
  const base = FIGHTERS.jotaro.stand.dmg;
  assert.equal(base, 8, '★ 承太郎（白金之星）的基础攻击就是 8');
  assert.equal(game.unitAttack(me), base, '开局就是 8');
  for (let i = 0; i < STRENGTH.parts.length; i++) {
    const target = game.shipParts('p2')[0];
    assert.equal(game.preview(me, target).attack, base, `拆了 ${i} 个之后仍然是 ${base}`);
    game.damage(target, 999, { side: 'p1', source: '测试' });
    assert.equal(game.unitAttack(me), base, `拆掉第 ${i + 1} 个之后卡片仍然是 ${base}`);
    assert.equal(game.shipBreakBonus('p1'), 0, '拆船不再给攻击加成');
  }
  // 半血觉醒（+3）仍然生效——那是这一关本来就有的设计，不受这次改动影响
  const raging = fixture();
  const stand = raging.unit('p1-stand');
  raging.s.hp.p1 = Math.floor(FIGHTERS.jotaro.hp / 2);
  raging.checkStoryRage('p1');
  assert.equal(raging.unitAttack(stand), base + raging.storyAttack('p1'), '★ 觉醒 +3 照旧生效');
});

test('★ 拆完最后一个要害，猩猩才登场，而且是满血 40', () => {
  const game = fixture();
  assert.equal(game.unit('p2-user'), null, '开局没有猩猩');
  for (let i = 0; i < STRENGTH.parts.length; i++) {
    const part = game.shipParts('p2')[0];
    if (i < STRENGTH.parts.length - 1) {
      game.damage(part, 999, { side: 'p1', source: '测试' });
      assert.equal(game.unit('p2-user'), null, `还剩要害时猩猩不该出现（第 ${i + 1} 个刚拆完）`);
      continue;
    }
    game.damage(part, 999, { side: 'p1', source: '测试' });
  }
  const boss = game.unit('p2-user');
  assert.ok(boss, '★ 拆完最后一个要害猩猩就该登场');
  assert.equal(boss.name, '猩猩');
  assert.deepEqual({ row: boss.row, col: boss.col }, STRENGTH.bossSpawn, '从数据里写好的位置登场');
  assert.equal(game.s.hp.p2, 40, '★ 登场时是满血 40');
  assert.equal(game.s.hp.p2, FIGHTERS.forever.hp);
  assert.equal(game.arenaKey(), STRENGTH.arenas[STRENGTH.arenas.length - 1], '同时推进到最后一层');
});

test('棋盘变形不会盖住单位、柱子，也不动别的地形', () => {
  const game = fixture();
  const isWall = t => game.isRock(t);
  const emptySlots = STRENGTH.bulwarkSlots.map(s => game.at(s.row, s.col)).filter(t => !isWall(t));
  assert.ok(emptySlots.length >= 2, '至少要留两个没立钢壁的隔板位，好把东西摆上去试');

  // ① 单位站在一个空的隔板位上 → 之后任何一次变形都不能在它脚下立钢壁
  const unit = game.unit('p1-user');
  Object.assign(unit, { row: emptySlots[0].row, col: emptySlots[0].col });
  // ② 要害摆到另一个空的隔板位上 → 同样不能被盖住
  const part = game.shipParts('p2')[0];
  Object.assign(part, { row: emptySlots[1].row, col: emptySlots[1].col });

  for (let i = 0; i < 20; i++) game.tickBulwarks();
  assert.equal(isWall(game.tile(unit)), false, '★ 不能在单位脚下立钢壁');
  assert.equal(isWall(game.tile(part)), false, '★ 不能在要害脚下立钢壁');
  assert.ok(game.s.units.includes(unit) && game.shipParts('p2').includes(part), '两个都还在场上');

  // ③ 别的地形（比如恢复点）也不能被变形吃掉：只在「钢壁 ⇄ 空地」之间翻转
  const game2 = fixture(77);
  const slot = STRENGTH.bulwarkSlots.find(s => !game2.isRock(game2.at(s.row, s.col)));
  const key = tileKey(game2.at(slot.row, slot.col));
  game2.s.terrain[key] = 'heal';
  for (let i = 0; i < 20; i++) game2.tickBulwarks();
  assert.equal(game2.s.terrain[key], 'heal', '★ 不是钢壁也不是空地的格子不该被变形碰到');
});

test('猩猩不在场时没有"被钢壁护着"的目标；登场后护卫规则随之解除', () => {
  const game = fixture();
  const me = game.unit('p1-stand');
  // 第一阶段场上根本没有 p2 单位，所以打不到他是因为"他还没出现"，不需要靠护卫规则兜
  assert.equal(game.unit('p2-user'), null, '第一阶段猩猩不在场');

  // 护卫规则本身仍然有效（防御性地留着）：手动把他放上来，要害还在 → 打不到
  const boss = game.spawnShipBoss();
  assert.ok(boss, '强行让他登场（模拟"万一"的路径）');
  Object.assign(me, { row: boss.row, col: boss.col - 1 });
  assert.ok(hexDist(game.tile(me), game.tile(boss)) <= me.range, '先确认在射程内');
  const reason = game.attackReason(me, boss);
  assert.match(reason, /钢壁护着/, '★ 要害没拆完时他仍应被护着');
  assert.match(reason, new RegExp(String(game.shipParts('p2').length)), '理由里要写还剩几个要害');
  assert.equal(game.attack(me, boss), false, '被护着时攻击要被拒绝');
  assert.equal(game.s.hp.p2, FIGHTERS.forever.hp, '被拒绝的攻击不该扣血');

  // 拆完全部要害 → 可以打
  while (game.shipParts('p2').length) game.damage(game.shipParts('p2')[0], 999, { side: 'p1', source: '测试' });
  assert.equal(game.shipParts('p2').length, 0);
  assert.equal(game.shipGuarded(boss), false);
  assert.doesNotMatch(game.attackReason(me, boss) || '', /钢壁护着/, '★ 要害全拆后不再被护着');
});

test('拆要害不会预扣猩猩的血（他在拆完之后才登场，登场即满血）', () => {
  // ⚠️ 这条是回归：一开始 `breakScale` 是 1.5，"拆结构比打人有效"会把船体耐久一起扣，
  //    于是三个要害顺手削掉他 30 点血、一登场只剩 10 —— 与用户要的"血量 40"不符。
  assert.equal(STRENGTH.breakScale, 1, '★ 拆要害不该再给倍率（改之前先看这条注释）');
  const game = fixture();
  const part = game.shipParts('p2')[0];
  const hp0 = game.s.hp.p2;
  const hit = 4;
  game.damage(part, hit, { side: 'p1', source: '测试' });
  assert.equal(part.hp, STRENGTH.partHp - hit, '要害自己按实际伤害掉血');
  assert.equal(game.s.hp.p2, hp0, '★ 打要害不该动"船体耐久"（猩猩还没登场）');

  while (game.shipParts('p2').length) game.damage(game.shipParts('p2')[0], 999, { side: 'p1', source: '测试' });
  assert.equal(game.s.hp.p2, FIGHTERS.forever.hp, '★ 三个要害全拆完，他登场时仍是满血 40');
});

test('每拆掉一个要害就往船里推进一层，四层的顺序与 STRENGTH.arenas 一致', () => {
  const game = fixture();
  const seen = [game.arenaKey()];
  while (game.shipParts('p2').length) {
    game.damage(game.shipParts('p2')[0], 99, { side: 'p1', source: '测试' });
    seen.push(game.arenaKey());
  }
  assert.deepEqual(seen, STRENGTH.arenas,
    '★ 场地要按「还没拆 → 拆 1 → 拆 2 → 全拆」逐层推进，且正好等于登记的那四层');
  for (const key of STRENGTH.arenas) {
    assert.ok(ARENAS[key], `场地 ${key} 必须登记在 ARENAS 里，否则背景会静默变回默认深色底`);
  }
  assert.equal(game.s.partsBroken, partCount(STRENGTH));
});

test('★ 中途换场地不能污染章节数据（否则下一局一开场就在破损船舱里）', () => {
  const game = fixture();
  while (game.shipParts('p2').length) game.damage(game.shipParts('p2')[0], 99, { side: 'p1', source: '测试' });
  assert.equal(game.arenaKey(), STRENGTH.arenas[STRENGTH.arenas.length - 1], '这一局推到最后一层');

  // 章节对象是模块级的共享对象：直接改它就会污染之后每一局
  assert.equal(chapter5.arena, STRENGTH.arenas[0], '★ STORY_CHAPTERS 里的 arena 必须纹丝不动');

  const fresh = fixture(99);
  assert.equal(fresh.arenaKey(), STRENGTH.arenas[0], '★ 新开一局要回到第一层');
  assert.equal(fresh.s.partsBroken, 0, '已拆数量也要归零');
});

test('棋盘变形：只在隔板位上翻、每回合数量固定、绝不会把单位困死', () => {
  const game = fixture();
  const slots = STRENGTH.bulwarkSlots.map(s => `${s.row},${s.col}`);
  const freeNeighbours = u => game.near(game.tile(u))
    .filter(n => !game.isRock(n) && !game.pillarAt(n) && !game.occupant(n)).length;
  const isWall = t => game.isRock(t);

  let flips = 0;
  for (let turn = 0; turn < 40; turn++) {
    flips += game.tickBulwarks();
    // 变形之后：每个单位都必须还有路可走
    for (const u of game.s.units) {
      assert.ok(freeNeighbours(u) > 0,
        `★ 第 ${turn} 回合变形后 ${u.name} 被围死了（( ${u.row},${u.col} )）`);
    }
    // 钢壁只出现在隔板位上
    for (const t of game.tiles) {
      if (!isWall(t)) continue;
      assert.ok(slots.includes(`${t.row},${t.col}`), `钢壁跑到隔板位之外了：( ${t.row},${t.col} )`);
    }
    // 不许长出别的野外地形
    for (const type of Object.values(game.s.terrain)) assert.equal(type, 'rock');
  }
  assert.ok(flips > 0, '40 个回合里总得动过几次，否则玩家看不出"船是活的"');
  assert.ok(flips <= 40 * STRENGTH.flipPerTurn, '每回合最多翻 flipPerTurn 格');
});

test('★ 第一阶段本体不出手：藏在船里操纵整艘船，拆完要害才现身', () => {
  const game = fixture();
  game.s.turn = 'p2';
  game.s.ap.p2 = RULE.apPerTurn;

  // ★ 第一阶段他**根本不在棋盘上**，所以"他不出手"是靠"没有棋子"实现的
  assert.equal(game.unit('p2-user'), null, '第一阶段场上没有猩猩，自然不会有任何行动');
  assert.equal(game.s.units.filter(u => u.side === 'p2').length, 0);

  // 护卫规则作为**防御性保险**仍然在：万一有别的路径把他提前放上来，他也不能动
  const boss = game.spawnShipBoss();
  assert.match(game.actorReason(boss), /藏在船里/, '要害没拆完时，即使他在场上也不该能行动');
  assert.equal(game.select(boss.id), false, '选不中');
  assert.match(game.s.notice.text, /钢壁|藏/, '要给出原因，不能静静地点不动');
  const before = { row: boss.row, col: boss.col };
  assert.equal(game.move(boss, game.tiles.find(t => !game.occupant(t) && !game.isRock(t))), false, '不能移动');
  assert.equal(boss.row, before.row);
  assert.equal(game.attack(boss, game.unit('p1-user')), false, '不能攻击');

  // 拆完全部要害 → 立刻解禁
  while (game.shipParts('p2').length) game.damage(game.shipParts('p2')[0], 999, { side: 'p1', source: '测试' });
  assert.equal(game.actorReason(boss), '', '要害全拆后他要能行动');
  assert.equal(game.select(boss.id), true, '拆完就能选中了');
});

test('★ 棋盘变形不会让玩家动弹不得（变形后仍要有合法行动）', () => {
  const game = fixture();
  for (let turn = 0; turn < 40; turn++) {
    game.tickBulwarks();
    assert.ok(game.stillPlayable(), `第 ${turn} 回合变形后玩家一个合法行动都没有了`);
  }
  while (game.shipParts('p2').length) game.damage(game.shipParts('p2')[0], 99, { side: 'p1', source: '测试' });
  for (let turn = 0; turn < 40; turn++) {
    game.tickBulwarks();
    assert.ok(game.stillPlayable(), `要害拆完后第 ${turn} 回合仍然要有合法行动`);
  }
});

test('★★ 这一关不会卡死：多种子都要在合理步数内分出胜负', () => {
  // 这是踩过的真实死局：AI 选走位时**只把敌人棋子当目标**，不知道要去拆要害，
  // 于是双方每回合空过——20 局里有 9 局卡在 900 步上限打不完。
  // 修法是把"还没拆的船体要害"并进走位目标（见 ai.js）。这条测试守着它。
  for (const seed of [7919, 15838, 23757, 31676, 39595, 47514, 55433, 63352]) {
    const game = new Game({ random: seeded(seed) });
    game.start(chapter5.player, chapter5.enemy, 'ai', { story: chapter5.id });
    let guard = 0;
    while (game.s.phase === 'battle' && guard++ < 400) {
      if (!playAIAction(game, chooseAI(game))) game.endTurn();
    }
    assert.ok(guard < 400, `★ seed ${seed} 的这局没打完（走了 ${guard} 步，说明又空过回合了）`);
    assert.equal(game.s.phase, 'result', `seed ${seed} 应分出胜负`);
    assert.equal(game.s.partsBroken, STRENGTH.parts.length,
      `seed ${seed}：三个要害应该都能被拆掉，实际只拆了 ${game.s.partsBroken} 个`);
  }
});

test('★ 要害的反击目前是关掉的（用户这轮只保留了"每回合扣 2 血"）', () => {
  // ⚠️ 想恢复就把 STRENGTH.partDmg 改回 3；`tickParts()` 的逻辑一直留着。
  assert.equal(STRENGTH.partDmg, 0, '⚠️ 用户 2026-09-27 的规则里只提到"每回合扣 2 血"，所以反击先关掉');
  const game = fixture();
  const part = game.shipParts('p2')[0];
  const me = game.unit('p1-stand');
  Object.assign(me, { row: part.row, col: part.col - 1 });
  const hp0 = game.s.hp.p1;
  assert.equal(game.tickParts(), 0, '反击关掉时不该有命中');
  assert.equal(game.s.hp.p1, hp0, '站在要害旁边也不会掉血');
});

test('柱子紧邻己方单位时给他 +1 防御（既有规则，与"力量"这一关无关）', () => {
  const game = fixture();
  const boss = game.spawnShipBoss();
  const alone = game.defense(boss).total;
  // 手动摆一根柱子在他旁边（用哪一方的柱子都行：pillarDef 数的是"己方"柱子，所以用 p2 的）
  game.s.pillars.push({ id: 'test-pillar', kind: 'pillar', side: 'p2', name: '测试柱',
    row: boss.row, col: boss.col - 1, hp: 5, maxHp: 5 });
  assert.equal(game.defense(boss).total, alone + 1, '紧邻己方柱子 +1 防御');
});

test('第五章数据：读→打→读，承太郎没有时停、半血觉醒「星尘的怒火」', () => {
  assert.equal(STORY_CHAPTERS.length, 8, '现在一共八章（第八章「皇帝与吊死者」已加入）');
  assert.equal(chapter5.id, 'chapter-5');
  assert.equal(chapter5.player, 'jotaro');
  assert.equal(chapter5.enemy, 'forever');
  assert.equal(chapter5.ship, true, '★ 这面旗决定引擎要不要启用拆船规则');
  assert.deepEqual(chapter5.scenes.map(scene => scene.kind), ['read', 'battle', 'read']);
  assert.equal(chapter5.scenes[0].readId, 'strength');
  assert.equal(chapter5.scenes[0].upto, 2, '前 2 段读完才开打');
  assert.equal(chapter5.scenes[2].from, 2, '第 3 段开头是转折与结果，必须留在战斗之后');

  assert.deepEqual(chapter5.swaps.jotaro.skills, ['ora', 'star']);
  assert.equal(chapter5.swaps.jotaro.skills.includes('time'), false, '★ 时停要留到最后打 DIO');
  // ★ 2026-10-04 用户要求：承太郎的觉醒名全章统一成「星尘的怒火」（这一章原来叫「破口」）
  assert.equal(chapter5.swaps.jotaro.rage.name, '星尘的怒火');

  const game = fixture();
  assert.deepEqual(game.skills('p1'), ['ora', 'star']);
  assert.equal(game.s.units.filter(u => u.side === 'p2').length, 0, '★ 开局猩猩不在场（拆完才登场）');
  assert.equal(game.s.hp.p2, FIGHTERS.forever.hp, '但船体耐久已经按他的血量摆好了');
  // 这一关玩家侧只有本体 + 替身两个棋子，跟别的对局一样
  assert.equal(game.s.units.filter(u => u.side === 'p1').length, 2);
  assert.equal(game.healthLabel('p2'), '船体耐久');

  // 不是这一关的对局不该被影响
  const plain = new Game({ random: seeded() });
  plain.start('jotaro', 'dio');
  assert.equal(plain.shipRule(), null);
  assert.equal(plain.shipParts('p2').length, 0);
  assert.equal(plain.s.arenaOverride, null);
  assert.equal(plain.healthLabel('p2'), '共享生命');
  assert.equal(plain.tickBulwarks(), 0);
  assert.equal(plain.tickParts(), 0);
  assert.equal(plain.setupShip(), false);
});

test('★ 拆要害的代价：第 1 个移动 −1、第 2 个再叠行动点 −1、第 3 个全部恢复且不再持续掉血', () => {
  const game = fixture();
  const stand = game.unit('p1-stand');
  const baseMove = stand.move;
  assert.deepEqual(game.shipPenalty('p1'), { move: 0, ap: 0 }, '开局没有惩罚');
  assert.equal(game.moveRange(stand), baseMove, '开局移动距离是满的');

  // 拆掉第 1 个 → 移动 −1
  game.damage(game.shipParts('p2')[0], 999, { side: 'p1', source: '测试' });
  assert.equal(game.shipPenalty('p1').move, 1, '★ 拆掉第 1 个 → 移动 −1');
  assert.equal(game.moveRange(stand), baseMove - 1, '★ 移动距离要真的变短');
  // 高亮可达范围也得跟着变短（moveRange 是唯一出口）
  const longest1 = () => Math.max(0, ...[...game.paths(stand).values()].map(p => p.length));
  assert.equal(longest1(), baseMove - 1, '★ 高亮范围不能还显示 4 格');

  // 拆掉第 2 个 → 再叠行动点 −1（移动的惩罚还在）
  game.damage(game.shipParts('p2')[0], 999, { side: 'p1', source: '测试' });
  assert.deepEqual(game.shipPenalty('p1'), { move: 1, ap: 1 }, '★ 拆掉第 2 个 → 行动点 −1（移动仍 −1）');
  game.endTurn(); game.endTurn();                       // 绕回玩家回合，看进回合时给几点 AP
  assert.equal(game.s.ap.p1, RULE.apPerTurn - 1, `★ 行动点应是 ${RULE.apPerTurn - 1}`);
  assert.equal(game.moveRange(stand), baseMove - 1, '移动仍然 −1');

  // 拆掉第 3 个 → 全部恢复、且不再持续掉血
  game.damage(game.shipParts('p2')[0], 999, { side: 'p1', source: '测试' });
  assert.deepEqual(game.shipPenalty('p1'), { move: 0, ap: 0 }, '★ 全部拆完 → 惩罚解除');
  assert.equal(game.moveRange(stand), baseMove, '★ 移动距离恢复');
  const hp0 = game.s.hp.p1;
  game.endTurn(); game.endTurn();                       // 再绕一圈
  assert.equal(game.s.ap.p1, RULE.apPerTurn, '★ 行动点恢复为满');
  assert.equal(game.s.hp.p1, hp0, '★ 全拆完之后不再受船体挤压的持续伤害');
  // 对照：没拆完的时候是会掉的
  const early = fixture();
  const hpEarly = early.s.hp.p1;
  early.endTurn(); early.endTurn();
  assert.equal(hpEarly - early.s.hp.p1, STRENGTH.drainPerTurn, '对照：没拆完时每回合照扣 2 点');
});

test('★ 棋子卡片上的攻击数值必须与 preview() 的普攻口径一致（含觉醒）', () => {
  const game = fixture();
  const me = game.unit('p1-stand');
  const check = label => {
    const target = game.shipParts('p2')[0] || game.unit('p2-user');
    assert.equal(game.unitAttack(me), game.preview(me, target).attack,
      `★ ${label}：卡片写 ${game.unitAttack(me)}，但打出去是 ${game.preview(me, target).attack}——两处必须一致`);
  };
  check('开局（基础 8）');
  assert.equal(game.unitAttack(me), FIGHTERS.jotaro.stand.dmg, '开局就是数据里的基础攻击力');
  // 拆要害不再加伤害，但每拆一次都要重新确认"卡片 == 打出去"
  for (let i = 0; i < STRENGTH.parts.length; i++) {
    game.damage(game.shipParts('p2')[0], 999, { side: 'p1', source: '测试' });
    assert.equal(game.unitAttack(me), FIGHTERS.jotaro.stand.dmg, `拆了 ${i + 1} 个之后仍是基础值`);
    check(`拆了 ${i + 1} 个之后`);
  }
  // 半血觉醒（+3）也要算进卡片里——以前卡片漏了这一项，才会出现"卡片 8、打出去 11"
  const raging = fixture();
  const stand = raging.unit('p1-stand');
  raging.s.hp.p1 = Math.floor(FIGHTERS.jotaro.hp / 2);
  raging.checkStoryRage('p1');
  const foe = raging.unit('p2-user') || raging.spawnShipBoss();
  assert.equal(raging.unitAttack(stand), FIGHTERS.jotaro.stand.dmg + raging.storyAttack('p1'),
    '★ 觉醒加成也要算进卡片');
  assert.equal(raging.unitAttack(stand), raging.preview(stand, foe).attack, '觉醒后两处仍要一致');
});

test('第五章在章节列表里是第五章、第 17–19 话，覆盖「力量」那一弧', () => {
  const rows = storyRoadmap();
  assert.equal(rows[4].chapterId, 'chapter-5');
  assert.equal(rows[4].label, '第五章');
  assert.match(rows[4].range, /^第 17–19 话$/);
  assert.equal(rows.filter(row => row.title === '力量' && !row.playable).length, 0,
    '「力量」已被第五章覆盖，不该再单列一条"未开放"');
});

test('★ 战斗内台词：五章各有 4 句，四个触发点各播一次、不会重复', () => {  // 内容层面：每一章都写齐了 开局 / 第 2 回合 / 半血 / 击倒对手 四句
  for (const chapter of STORY_CHAPTERS) {
    for (const key of ['start', 'turn2', 'half', 'death']) {
      const line = chapter.barks?.[key];
      assert.ok(line, `${chapter.id} 缺 ${key} 台词`);
      assert.ok(line.who && line.text, `${chapter.id} 的 ${key} 台词要有 who 与 text`);
    }
  }

  // 触发层面：按战斗的推进顺序各播一次
  const seen = [];
  const game = new Game({ random: seeded(3), onEvent: e => { if (e.type === 'bark') seen.push(e.key); } });
  game.start(chapter5.player, chapter5.enemy, 'ai', { story: chapter5.id });
  assert.deepEqual(seen, ['start'], '开局播一次');

  game.endTurn();                                   // → p2（第 1 轮）
  assert.deepEqual(seen, ['start'], '第 1 轮里不该有第 2 回合的台词');
  game.endTurn();                                   // → p1 自己的第 2 个回合（ROUND 02）
  assert.equal(game.roundNumber(), 2, '这时界面显示 ROUND 02');
  assert.deepEqual(seen, ['start', 'turn2'], '★ 第 2 回合开始播一次');

  // 半血：玩家共享生命首次 ≤ 一半
  const half = Math.floor(FIGHTERS.jotaro.hp / 2);
  game.s.hp.p1 = half + 1;
  game.damage(game.unit('p1-user'), 1, { source: '测试' });
  assert.equal(game.s.hp.p1, half, '正好一半也算半血（与全局口径一致）');
  assert.ok(seen.includes('half'), '★ 半血时播一次');

  // 同一句不会重复播
  const before = seen.length;
  game.damage(game.unit('p1-user'), 1, { source: '测试' });
  assert.equal(seen.length, before, '半血台词只播一次');

  // 击倒对手：玩家打赢才有
  game.endGame('p1', '测试');
  assert.ok(seen.includes('death'), '★ 打赢时播"击倒对手"的台词');
  assert.equal(seen.filter(k => k === 'death').length, 1, '只播一次');
  // 输了不播"击倒对手"的台词（那是敌人倒下时才说的，玩家输了播会很怪）
  const lost = [];
  const g2 = new Game({ random: seeded(4), onEvent: e => { if (e.type === 'bark') lost.push(e.key); } });
  g2.start(chapter5.player, chapter5.enemy, 'ai', { story: chapter5.id });
  g2.endGame('p2', '测试');
  assert.equal(lost.includes('death'), false, '★ 玩家战败时不播"击倒对手"的台词');

  // 普通对局（没有剧情章节）不该有任何台词
  const plain = [];
  const g3 = new Game({ random: seeded(5), onEvent: e => { if (e.type === 'bark') plain.push(e.key); } });
  g3.start('jotaro', 'dio');
  g3.endGame('p1', '测试');
  assert.deepEqual(plain, [], '普通对局没有台词');
});

test('★ 每句台词的说话人都有立绘可显示（旁白可以没有）', () => {
  // 对话框左侧要显示说话人的棋子立绘；`key` 就是角色 id，渲染时走 assets.js 的 piece()。
  // 写错 id（比如把人名当成 key）不会报错、只会显示一张破图，所以这里逐个查一遍。
  for (const chapter of STORY_CHAPTERS) {
    for (const kind of ['start', 'turn2', 'half', 'death']) {
      const line = chapter.barks[kind];
      if (!line.key) {
        assert.equal(line.who, '旁白', `只有旁白可以不写 key（${chapter.id} 的 ${kind} 是「${line.who}」）`);
        continue;
      }
      const art = CHARACTER_ART[line.key];
      assert.ok(art, `${chapter.id} 的 ${kind}：key=${line.key} 不在 CHARACTER_ART 里`);
      assert.ok(existsSync(new URL(`../assets/out/standees/${art.user}.webp`, import.meta.url)),
        `${chapter.id} 的 ${kind}：「${line.who}」的立绘 assets/out/standees/${art.user}.webp 不存在`);
    }
  }
});

test('★★ "击倒对手"的台词必须排在 `result` 事件之前（否则结算弹窗会盖住它）', () => {
  // 用户 2026-09-27 报的："结算出现得太早，还没看清结束对话"。
  // 界面收到 `result` 时会先看"台词还在不在播"——在播就把弹窗挂起来等；
  // 先发 result 再播台词的话，它会以为没台词、0.5 秒后就弹窗（弹窗是顶层，一定盖住台词条）。
  const order = [];
  const game = new Game({ random: seeded(9), onEvent: e => {
    if (e.type === 'bark') order.push(`bark:${e.key}`);
    else if (e.type === 'result') order.push('result');
  } });
  game.start(chapter5.player, chapter5.enemy, 'ai', { story: chapter5.id });
  game.endGame('p1', '测试');
  assert.deepEqual(order, ['bark:start', 'bark:death', 'result'],
    '★ 必须先播"击倒对手"的台词，再发结算事件');

  // 同一件事再做一层源码守卫：genie 事件与 bark 的相对顺序别被谁无意中改回去
  // ⚠️ 定位要用 `endGame(winner, reason`（**不要带右括号**）：函数签名后来加了可选参数
  //    （`endGame(winner, reason, { resigned } = {})`，认输要用），带右括号会 indexOf 到 -1、
  //    slice(-1) 拿到最后一个字符，两个 indexOf 一起变成 -1——报出来的错会很像"两句被删了"。
  const src = readFileSync(new URL('../src/core/game.js', import.meta.url), 'utf8');
  const body = src.slice(src.indexOf('endGame(winner, reason'));
  const barkAt = body.indexOf("bark('death')"), resultAt = body.indexOf("emit('result'");
  assert.ok(barkAt >= 0 && resultAt >= 0, 'endGame 里两句都还在');
  assert.ok(barkAt < resultAt, '★ 源码里 `bark(\'death\')` 必须写在 `emit(\'result\'` 之前');
});

test('★ 第 4、5 关的特殊机制说明写齐了（战斗前在「本关规则」里列出）', () => {
  const c4 = STORY_CHAPTERS[3], c5 = STORY_CHAPTERS[4];
  assert.ok(c4.specialRules?.length >= 2, '第四章要说明"水里移动 −1"这类规则');
  assert.ok(c4.specialRules.some(t => /移动\s*−1|移动 -1/.test(t)), '第四章要写清水里的移动惩罚');
  assert.ok(c5.specialRules?.length >= 4, '第五章机制多，要逐条写清');
  for (const keyword of ['整艘船', '依次', '扣 2 点', '恢复', '推进']) {
    assert.ok(c5.specialRules.some(t => t.includes(keyword)), `第五章的机制说明里应包含「${keyword}」`);
  }
  // 前三章没有特殊机制，不该凭空长出一个空块
  for (const chapter of STORY_CHAPTERS.slice(0, 3)) {
    assert.equal(chapter.specialRules, undefined, `${chapter.id} 没有特殊机制`);
  }
});

test('要害在格子提示里说清楚是什么、还剩多少血', () => {
  const game = fixture();
  const part = game.shipParts('p2')[0];
  const text = tileDescription(game, game.at(part.row, part.col));
  assert.match(text, new RegExp(part.name), '要写要害的名字');
  assert.match(text, /船体要害/, '要标明这是船体要害');
  assert.match(text, new RegExp(`${STRENGTH.partHp}`), '要能看出还剩多少血');
  // 钢壁的叫法也是船上的说法，不是"岩石"
  const wall = game.tiles.find(t => game.isRock(t));
  assert.match(tileDescription(game, wall), /船体钢壁/);
  assert.equal(tileDescription(game, wall).includes('岩石'), false, '船舱里不该出现"岩石"');
});

test('第五章能真的开打：AI 能把这一局打完（不会卡死）', () => {
  const game = new Game({ random: seeded(5) });
  game.start(chapter5.player, chapter5.enemy, 'ai', { story: chapter5.id });
  let guard = 0;
  while (game.s.phase === 'battle' && guard++ < 900) {
    const side = game.s.turn;
    if (!playAIAction(game, chooseAI(game))) game.endTurn();
    assert.ok(game.s.ap[side] >= 0, '行动点不能为负');
    assert.ok(game.s.hp[side] >= 0, '血量不能为负');
  }
  assert.ok(guard < 900, '★ 这一局必须在合理步数内结束');
  assert.equal(game.s.phase, 'result');
  assert.ok(['p1', 'p2'].includes(game.s.winner));
});

test('四层船舱背景：键名登记齐全，图要么画好了、要么挂在待补清单里（不会静默少一张）', () => {
  for (const key of STRENGTH.arenas) {
    assert.ok(ARENAS[key], `★ ${key} 必须登记在 ARENAS 里，否则背景会静默变回默认深色底`);
    const drawn = existsSync(new URL(`../${ARENAS[key]}`, import.meta.url));
    assert.ok(drawn || PENDING_ARENAS.has(key),
      `★ ${key} 既没有图、又不在待补清单里 —— 这种"两边都没有"的状态最危险（没人会记得补它）`);
    // 画好的就不该再挂在待补清单里（否则 check-assets 一直显示"待补"）
    assert.equal(drawn && PENDING_ARENAS.has(key), false, `${key} 的图已经有了，应该从 PENDING_ARENAS 删掉`);
  }
});
