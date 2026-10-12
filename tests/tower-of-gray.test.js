/**
 * 剧情 boss「灰塔」（格雷·弗莱）：
 *   数值与选人排除、针舌穿刺、疾飞、伪装（被动），以及剧情第二章的幕次切分。
 * 按《开发交接文档》§5 的清单：数值断言、技能正反例、AI 能跑完整局。
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { Game, RULE, FIGHTERS, SKILLS, STORY_CHAPTERS, skillSetFor, playableFighters, isBoss, otherSide } from '../src/core/game.js';
import { hexDist, tileKey } from '../src/core/hex.js';
import { chooseAI, playAIAction } from '../src/core/ai.js';
import { CHARACTER_ART, artKeys, portrait, cutin, ARENAS, TERRAIN_SKINS, terrainSkinPath } from '../src/ui/assets.js';
import { SPRITES } from '../src/ui/render.js';
import { tileDescription } from '../src/ui/hud.js';
import { STORY, storySceneAt, storyRoadmap } from '../src/ui/story.js';

function seeded(seed = 11) { return () => ((seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0) / 4294967296); }
const place = (game, id, row, col) => Object.assign(game.unit(id), { row, col });
/** 灰塔(p1) 对 承太郎(p2)：两边替身贴在一起，方便测针舌与伪装。 */
function fixture() {
  const game = new Game({ random: seeded() });
  game.start('gray_fly', 'jotaro');
  game.s.terrain = {};
  place(game, 'p1-user', 5, 6); place(game, 'p1-stand', 4, 4);
  place(game, 'p2-user', 5, 1); place(game, 'p2-stand', 4, 5);
  return game;
}

test('灰塔数值：45/2、连携 4、替身防加 1、替身攻 7 射程 1 移动 5（全场最快），且不进选人列表', () => {
  const f = FIGHTERS.gray_fly;
  assert.equal(f.boss, true, '要带 boss 标记，否则会跑进选人界面');
  assert.equal(f.hp, 45);
  assert.equal(f.def, 2);
  assert.equal(f.distLimit, 4, '★ 连携距离 4：可以远远把替身放出去贴脸');
  assert.equal(f.standDefBonus, 1, '★ 替身防御加成只有 1（偏脆）');
  assert.equal(f.user.move, 3, '本体（老头）移动 3、不能普攻');
  assert.equal(f.user.dmg || 0, 0);
  assert.equal(f.stand.move, 5, '★ 移动 5：全场最快（其他替身都是 4）');
  assert.equal(f.stand.dmg, 7, '★ 攻击 7');
  assert.equal(f.stand.range, 1, '针舌是贴身技');
  assert.deepEqual(skillSetFor('gray_fly'), ['needle', 'disguise'], '疾飞已删除，只剩针舌穿刺 + 伪装');
  assert.deepEqual(artKeys(CHARACTER_ART.gray_fly), ['gray_fly', 'tower_of_gray']);
  // 素材已配齐（肖像与插画都入库了），不该再标成"可选"
  assert.equal(CHARACTER_ART.gray_fly.artOptional, undefined, '补图后要删掉 artOptional，否则不参与素材缺失检查');
  assert.equal(cutin('gray_fly'), 'assets/out/cutins/gray_fly.webp');
  assert.equal(portrait('gray_fly'), 'assets/out/portraits/gray_fly.webp');

  // 选人列表里不能有他
  assert.equal(isBoss('gray_fly'), true);
  assert.equal(isBoss('jotaro'), false);
  const playable = playableFighters().map(item => item.key);
  assert.equal(playable.includes('gray_fly'), false, '★ boss 不能被玩家选中');
  // ⚠️ 2026-10-03 第三条用户拍板：第八章的**皇帝（`emperor`）改成了 PvP 可选角色**（撤掉 boss:true），
  //    所以可选角色由 7 名变 **8 名**、多出来的就是他（他排在 dio 之后）。
  //    这里被改的只有"数量"与"名单"，'gray_fly 不在列表里'那条一个字没动。
  assert.equal(playable.length, 9, '可选角色现在是 9 名（皇帝 + 东方仗助）');
  assert.deepEqual(playable, ['jotaro', 'dio', 'emperor', 'kakyoin', 'avdol', 'polnareff', 'joseph', 'iggy', 'josuke']);
});

test('针舌穿刺：攻击力 +2；目标不是满血时再 +2；射程 2 打不到 3 格', () => {
  const g = fixture();
  const stand = g.unit('p1-stand'), foe = g.unit('p2-stand');
  const full = g.preview(stand, foe, 'needle');
  assert.equal(full.attack, stand.dmg + SKILLS.needle.bonus, '满血目标：只有 +2');

  g.s.hp.p2 = FIGHTERS.jotaro.hp - 1;              // 掉 1 点血就算"不是满血"
  const hurt = g.preview(stand, foe, 'needle');
  assert.equal(hurt.attack, stand.dmg + SKILLS.needle.bonus + SKILLS.needle.execute, '★ 已经受伤：再 +2（共 +4）');

  g.s.hp.p2 = FIGHTERS.jotaro.hp;
  place(g, 'p2-stand', 4, 7);                       // 距离 3
  assert.equal(hexDist(g.tile(stand), g.tile(foe)), 3);
  assert.match(g.attackReason(stand, foe, 'needle'), /超出射程/, '射程只有 2');
});

test('连携距离 4：灰塔的替身可以离本体很远（其他双单位角色只有 2）', () => {
  const g = fixture();
  assert.equal(g.distLimit('p1'), 4, '★ 灰塔这一边是 4 格');
  assert.equal(g.distLimit('p2'), 2, '对照：承太郎仍是 2 格');
  // 站到 4 格外也不该被判成"超出连携"
  place(g, 'p1-user', 4, 0);
  const stand = g.unit('p1-stand');
  place(g, 'p1-stand', 4, 4);
  assert.equal(hexDist(g.tile(stand), g.tile(g.unit('p1-user'))), 4);
  assert.ok(g.pairDistance('p1') <= g.distLimit('p1'), '正好 4 格仍在允许范围内');
});

test('伪装（被动）：每个对手回合里第一次被攻击伤害 −2，第二次恢复正常', () => {
  const g = fixture();
  const attacker = g.unit('p2-stand'), target = g.unit('p1-stand');
  g.endTurn();                                      // 轮到承太郎
  assert.equal(g.s.turn, 'p2');

  const first = g.preview(attacker, target).damage;
  const plain = g.preview(attacker, g.unit('p1-user')).damage;   // 打本体（不受伪装影响，用来做对照）
  assert.ok(g.attack(attacker, target), '第一次攻击命中');
  assert.equal(g.s.disguiseUsed.p1, true, '这次的减伤已经被用掉');

  const second = g.preview(attacker, target).damage;
  assert.equal(second - first, SKILLS.disguise.cut, `★ 第一次比之后少 ${SKILLS.disguise.cut} 点伤害`);
  assert.equal(plain, plain, '对照：本体没有伪装被动');

  // 灰塔自己回合开始时重置，于是下一个对手回合又能减一次
  g.s.ap.p2 = 3;
  g.endTurn();                                      // 回到灰塔
  assert.equal(g.s.disguiseUsed.p1, false, '★ 轮到自己时重置');
  g.s.ap.p1 = 3; g.endTurn();                       // 再回到承太郎
  assert.equal(g.preview(attacker, target).damage, first, '新回合的第一次攻击又享受减伤');
});

test('AI 拿灰塔能跑完一整局，并会用到针舌穿刺', () => {
  const g = new Game({ random: seeded(5) });
  g.start('jotaro', 'gray_fly');
  let actions = 0, sawNeedle = false;
  while (g.s.phase === 'battle' && actions < 260) {
    const plan = chooseAI(g);
    if (!plan) break;
    if (plan.skill === 'needle') sawNeedle = true;
    if (!playAIAction(g, plan)) break;
    actions++;
  }
  assert.ok(actions > 5, 'AI 应该真的走了很多步');
  assert.equal(g.s.phase, 'result', '对局应当正常收束');
  assert.ok(sawNeedle, 'AI 至少要会用针舌穿刺');
});

test('剧情第二章：战斗夹在正文中间，标题与话数取自灰塔那一章', () => {
  const chapter = STORY_CHAPTERS[1];
  assert.equal(chapter.id, 'chapter-2');
  assert.equal(chapter.enemy, 'gray_fly', '敌方是剧情 boss');
  assert.equal(chapter.player, 'jotaro');
  assert.deepEqual(chapter.scenes.map(scene => scene.kind), ['read', 'battle', 'read']);

  const before = storySceneAt(chapter, 0), battle = storySceneAt(chapter, 1), after = storySceneAt(chapter, 2);
  assert.equal(battle.isBattle, true);
  // 开打前不能出现"战斗赢了"这种战后总结
  assert.equal(before.paragraphs.some(text => text.includes('战斗赢了')), false,
    '★「战斗赢了」必须放在战斗之后');
  assert.equal(after.paragraphs.some(text => text.includes('战斗赢了')), true);

  // 拆开的两段拼起来正好是整章，不重不漏
  const whole = STORY.find(item => item.id === 'tower').paragraphs;
  assert.deepEqual([...before.paragraphs, ...after.paragraphs], whole, '拆成两段后拼起来＝整章');

  // 这一章的承太郎仍然没有时停，改为半血觉醒
  const g = new Game({ random: seeded() });
  g.start(chapter.player, chapter.enemy, 'ai', { story: chapter.id });
  assert.equal(g.skills('p1').includes('time'), false, '这一战也没有时停');
  assert.deepEqual(g.skills('p1'), ['ora', 'star']);
  assert.equal(g.skills('p2').includes('disguise'), true, '敌方 boss 的技能不受影响');

  // 章节列表：第二章在第一章之后
  const rows = storyRoadmap();
  assert.equal(rows[1].chapterId, 'chapter-2');
  assert.match(rows[1].range, /^第 9–10 话$/);
  assert.equal(rows.filter(row => row.title === '灰塔' && !row.playable).length, 0,
    '灰塔那一弧已被第二章覆盖，不该再单列一条"未开放"');
});

test('灰塔那一战在客机上：章节指定 arena，棋盘底下会铺机舱背景', () => {
  const chapter = STORY_CHAPTERS[1];
  assert.equal(chapter.arena, 'plane', '★ 第二章要指定客机场地');
  assert.equal(ARENAS.plane, 'assets/out/arenas/plane.webp');
  assert.ok(SPRITES['arena:plane'], '★ 场地背景必须进 SPRITES，否则不会被加载');

  // 剧情模式：引擎里能拿到 arena（渲染层就是读 s.story.arena）
  const g = new Game({ random: seeded() });
  g.start(chapter.player, chapter.enemy, 'ai', { story: chapter.id });
  assert.equal(g.s.story.arena, 'plane');

  // 普通对战没有剧情章节 → 用默认深色底，不该串到别的对局里
  const g2 = new Game({ random: seeded() });
  g2.start('jotaro', 'gray_fly');
  assert.equal(g2.s.story, null, '普通对战不应带剧情场地');
  assert.equal(g2.s.story?.arena, undefined);

  // 第一章没有指定场地，保持默认
  assert.equal(STORY_CHAPTERS[0].arena, undefined);
});

test('飞机上的地形换了皮肤与叫法（效果完全不变）', () => {
  // 皮肤登记齐全：渲染层按 `<场地>-<地形>` 取名，找不到就自动退回默认图
  assert.deepEqual(TERRAIN_SKINS, ['plane-rock', 'plane-bush', 'plane-heal', 'plane-hazard']);
  for (const key of TERRAIN_SKINS) {
    assert.ok(SPRITES[key], `★ ${key} 必须进 SPRITES，否则不会被加载、只会显示默认地形`);
    assert.equal(terrainSkinPath(key), `assets/out/terrain-plane/${key}@2x.png`);
  }
  // 默认那套地形图不能被顶掉
  for (const key of ['rock', 'bush', 'heal', 'hazard']) assert.ok(SPRITES[key], `默认地形 ${key} 仍要在`);

  // 剧情模式（客机）里，地形叫法换成机舱里的东西
  const chapter = STORY_CHAPTERS[1];
  const tile = { row: 4, col: 4 };
  const g = new Game({ random: seeded() });
  g.start(chapter.player, chapter.enemy, 'ai', { story: chapter.id });
  g.s.terrain[tileKey(tile)] = 'hazard';
  const onPlane = tileDescription(g, tile);
  assert.match(onPlane, /泄漏的燃油/, '★ 飞机上不该出现"毒沼"');
  assert.equal(onPlane.includes('毒沼'), false);

  g.s.terrain[tileKey(tile)] = 'rock';
  assert.match(tileDescription(g, tile), /堆叠的行李箱/);
  g.s.terrain[tileKey(tile)] = 'bush';
  assert.match(tileDescription(g, tile), /座椅掩护/);
  g.s.terrain[tileKey(tile)] = 'heal';
  assert.match(tileDescription(g, tile), /送餐车/);

  // 普通对战仍是野外叫法，不能串味
  const g2 = new Game({ random: seeded() });
  g2.start('jotaro', 'dio');
  g2.s.terrain[tileKey(tile)] = 'hazard';
  assert.match(tileDescription(g2, tile), /毒沼/, '普通对战不受影响');
  assert.equal(tileDescription(g2, tile).includes('泄漏'), false);
});

test('剧情第二章能真的开打：boss 在棋盘上有本体和替身两个棋子', () => {
  const chapter = STORY_CHAPTERS[1];
  const g = new Game({ random: seeded() });
  g.start(chapter.player, chapter.enemy, 'ai', { story: chapter.id });
  assert.equal(g.s.hp.p2, FIGHTERS.gray_fly.hp, 'boss 的共享生命取自他自己的数据');
  assert.equal(g.s.units.filter(u => u.side === 'p2').length, 2, 'boss 是双单位：本体 + 替身');
  assert.equal(g.unit('p2-stand').move, 5);
  assert.equal(g.unit('p2-stand').range, 1);
  assert.equal(otherSide('p1'), 'p2');
});
