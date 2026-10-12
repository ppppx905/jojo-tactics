/**
 * 第八章「皇帝与吊死者」第④步：**场边冷枪（霍尔·霍斯）＋ 开火前的弹道预告**。
 *
 * 用户拍板的规矩（`design/第八章设计草案.md`，**数值不许改**）：
 *   · **每 2 回合放一枪、净伤 6 点真实伤害（无视防御）**；**开火的前一回合在地面画出弹道与目标格**；
 *   · **目标格上没人在＝打空了**（那就是"躲开了"），只记一条日志、不掉血；
 *   · 数值写成 `SNIPER` 常量、机制旗标挂在数据上（`sniper`）——**别的章节、别的幕一律不受影响**。
 *
 * ⚠️⚠️ 2026-10-03 用户改版（`design/第八章-两阶段改版.md`）：这一章改成**两阶段两场**，
 *   冷枪**只在阶段 1**（波鲁纳雷夫 单挑 皇帝）生效。所以这个文件里按改版改掉了两类断言：
 *     · 夹具从"整章"改成**阶段 1 那一幕**（`scene` 要一并登记给引擎）；
 *     · **"皇帝打不死（`immune`）/ 钉在外圈（`pinned`）"两条整个取消了**——用户原话
 *       "撤掉 immune/pinned 在本章的作用"：单挑要能打伤他、能追他，所以他这一场会走位、
 *       也会掉血。
 *
 * ⚠️⚠️ **2026-10-03 第三条用户拍板**：阶段 1 的胜负口径从"打到半血即胜"改回
 *   **"把他的血打空才算赢"**（幕上的 `phaseWin` 撤掉了；引擎里那套机制代码**保留**）。
 *   所以这个文件里跟着改的只有**两条**：状态栏那条"打到半血就结束这一场"的标签断言，
 *   以及下面"AI 自动打完"里那条只在 `scene.phaseWin` 存在时才成立的死分支——
 *   冷枪这一套机制（每 2 回合、净伤 6、弹道预告、挪开就躲）一个字都没动。
 *
 * ⚠️ 反光点的回归在 `tests/mirrors.test.js`，章节入口与两阶段整体在 `emperor.test.js` /
 *    `chapter8-phases.test.js`；这一章还剩第⑤步没做（AI 友军优先烧镜面），别在这里提前假设。
 *
 * ⚠️⚠️⚠️ **2026-10-03 第四条用户拍板**（阶段 1 改成"注定打不过"的剧情战）又推翻了上面第三条的
 *    "打空血才算赢"，这个文件里跟着改的只有三处（冷枪机制一个字没动）：
 *      · "枪手能走位、也能被打伤"末尾那条 **"回合要交得出去"**：这一场现在**可能在 p2 的回合中途
 *        被剧情收掉**（波波掉到一半就结束），所以放宽成"要么回合交了出去、要么这一场已被剧情收场"；
 *      · "AI 自动打完"里那条 `winner === 'p1' && emperor` 的死分支：阶段 1 **永远赢不了**
 *        （他有剧本保护、打不倒），改成把新的不变量钉死（胜负必是 p2、`storyLoss`、血 ≥ 1）；
 *      · 状态栏那条 **"打倒 霍尔·霍斯 就赢"**：改成"这一场打不过 · 撑到剧情那一刻就结束"。
 *    必败剧情战的完整回归在 `tests/chapter8-scripted-loss.test.js`。
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { Game, FIGHTERS, STORY_CHAPTERS, SNIPER, otherSide } from '../src/core/game.js';
import { hexDist, tileKey, CANVAS_W, CANVAS_H } from '../src/core/hex.js';
import { chooseAI, playAIAction } from '../src/core/ai.js';
import { BoardVisual } from '../src/ui/render.js';
import { tileDescription } from '../src/ui/hud.js';

function seeded(seed = 13) { return () => ((seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0) / 4294967296); }
const chapter8 = STORY_CHAPTERS.find(c => c.id === 'chapter-8');
/** 阶段 1（波波 单挑 皇帝，带冷枪）与阶段 2（波波 ＋ 花京院 对 吊死者，带反光点）——按阵容认。 */
const phase1 = chapter8.scenes.find(scene => scene.kind === 'battle' && scene.lineup?.enemy === 'emperor');
const phase2 = chapter8.scenes.find(scene => scene.kind === 'battle' && scene.lineup?.enemy === 'geil');
/** 多种子跑：地形与反光点都是随机的，单跑一个种子证明不了"总是合法"。 */
const SEEDS = [13, 7919, 9421, 20261003];

/** ★ 冷枪只在**阶段 1**生效，所以这份夹具开的是阶段 1 那一场（1v1：波波 对 皇帝）。 */
function fixture(seed = 13, events = null) {
  const game = new Game({ random: seeded(seed), onEvent: event => events?.push(event) });
  game.setRoster({ p1b: null, p2b: null, story: true, scene: phase1 });
  game.start(phase1.lineup.player, phase1.lineup.enemy, 'ai', { story: chapter8.id });
  return game;
}
/** 枪手＝敌方那枚棋子（阶段 1 的 p2 就是霍尔·霍斯，单单位、只有本体）。 */
const gunnerOf = game => game.s.units.find(u => u.slot === 'p2');
/** 走完整整一轮（阶段 1 是 1v1，两个角色各交一次回合）——冷枪就是在这条链路的**轮末**结算的。 */
function playRound(game, rounds = 1) {
  for (let r = 0; r < rounds && game.s.phase === 'battle'; r++) {
    for (let i = 0; i < game.s.slots.length && game.s.phase === 'battle'; i++) game.endTurn();
  }
}
/** 找一格空地（没棋子、没柱子、没地形、没反光点）——用来做"挪开"的对照。 */
const freeTile = (game, skip = () => false) => game.tiles.find(t =>
  !game.occupant(t) && !game.pillarAt(t) && !game.mirrorAt(t) && !game.s.terrain[tileKey(t)] && !skip(t));
const said = events => events.filter(e => e.type === 'status' || e.type === 'hit').map(e => e.text).join('|');

test('★ 冷枪数据：只有"阶段 1 那一幕"有这面旗，数值照用户拍板；旗标挂在棋子数据上，不按角色名写死', () => {
  assert.equal(phase1.sniper, true, '★ 阶段 1 那一幕要打开 sniper 旗（引擎据此启用冷枪）');
  // ★★ 改版：旗标**只在幕上**。写回章节级就等于"只要在第八章就都生效"，阶段 2 会白画弹道。
  assert.equal(chapter8.sniper, undefined, '★ 章节级不许挂 sniper');
  assert.notEqual(phase2.sniper, true, '★ 阶段 2 里没有冷枪');
  assert.equal(SNIPER.interval, 2, '用户定：每 2 回合放一枪');
  assert.equal(SNIPER.dmg, 6, '用户定：净伤 6 点真实伤害（无视防御）');
  assert.ok(SNIPER.name, '界面上的叫法由数据提供');
  // 关键槽位：这一章的胜负口径仍然是"看 p2 那一格"（阶段 1 的 p2 就是他本人：打空他的血就赢）
  assert.equal(chapter8.keySlot, 'p2', '★ 关键槽位＝p2（通用写法，不写角色名）');
  for (const chapter of STORY_CHAPTERS) {
    if (chapter.id === 'chapter-8') continue;
    assert.notEqual(chapter.sniper, true, `${chapter.id} 不该有冷枪旗标`);
    assert.equal(chapter.keySlot, undefined, `${chapter.id} 不该有关键槽位`);
  }
  // 旗标挂在**棋子数据**上（引擎里没有任何一处按 'emperor' / '霍尔·霍斯' 这种名字判断）
  const gunner = FIGHTERS.emperor.user;
  assert.equal(gunner.sniper, true, '★ 只有他带 sniper');
  // ★★ 改版撤销的两条：单挑要能打伤他、能追他，所以"打不死"与"钉在外圈"都不再是旗标。
  assert.equal(gunner.immune, undefined, '★ 「打不死」已撤（阶段 1 里他能被打伤）');
  assert.equal(gunner.pinned, undefined, '★ 「钉在外圈」已撤（阶段 1 里他能走位）');
  assert.equal(gunner.move, 2, '⚠️ 移动数值一个字没改（改成 0 会让 tests 里那 16 组配对对战卡死）');
  const gunners = Object.values(FIGHTERS).flatMap(f => [f.user, f.stand]).filter(u => u?.sniper);
  assert.deepEqual(gunners.map(u => u.name), ['霍尔·霍斯'], '全项目只有他一个放冷枪');
  // 本关规则：冷枪那一条必须写在**阶段 1 那一幕**上，并写清"每 2 回合 / 伤害 6 / 弹道 / 挪开就能躲"
  const rules = (phase1.specialRules || []).join('');
  for (const piece of ['冷枪', '弹道', '6 点真实伤害', '挪开']) assert.match(rules, new RegExp(piece), `本关规则缺"${piece}"`);
  assert.equal(/打不死/.test(rules), false, '★ 他已经打得死了，"打不死"那句必须从规则里删掉');
  assert.equal((phase2.specialRules || []).join('').includes('冷枪'), false, '★ 阶段 2 的规则里不许提冷枪');
});

test('★ 阶段 1 的枪手既能走位、也能被打伤（打不死/钉在外圈两条已按用户要求撤掉）', () => {
  for (const seed of SEEDS) {
    const game = fixture(seed);
    const gunner = gunnerOf(game);
    assert.ok(gunner, '这一场要有枪手');
    assert.equal(gunner.kind, 'user', '他是单单位：只有本体一枚棋子');
    assert.equal(gunner.slot, 'p2', '阶段 1 里敌方就他一个（皇帝不单独占棋子）');
    // ★ 能走位：这一场他不再被钉住
    assert.equal(game.moveRange(gunner), gunner.move, `seed ${seed}：移动力＝角色数据里的 ${gunner.move}`);
    assert.ok(game.reachable(gunner).length > 0, `seed ${seed}：★ 他必须走得动（单挑要能追能打）`);
    // ★ 打伤他：伤害照常结算（旧写法是"任何伤害都结算为 0"）
    const before = game.s.hp.p2;
    const lost = game.damage(gunner, 5, { side: 'p1', slot: 'p1', source: '测试' });
    assert.equal(lost, 5, '★ 伤害照常结算（不再是 0）');
    assert.equal(game.s.hp.p2, before - 5, '血真的掉了');
    // 走位：把银色战车挪到他旁边，直接普攻也照样打得出伤害
    const blade = game.s.units.find(u => u.slot === 'p1' && u.kind === 'stand');
    const spot = game.near(game.tile(gunner)).find(n => !game.occupant(n) && !game.isRock(n));
    Object.assign(blade, { row: spot.row, col: spot.col });
    game.s.turn = 'p1';
    const pv = game.preview(blade, gunner);
    assert.ok(pv.damage > 0, '★ 预览必须是真实伤害（旧写法会报 −0）');
    const hp1 = game.s.hp.p2;
    assert.equal(game.attack(blade, gunner), true);
    assert.equal(game.s.hp.p2, hp1 - pv.damage, '这一下真的打出去了');
    // 不会卡死：轮到他的时候 AI 照常出手或结束回合
    game.s.turn = 'p2';
    let guard = 0;
    while (game.s.phase === 'battle' && game.s.turn === 'p2' && guard++ < 12) {
      const plan = chooseAI(game);
      assert.ok(plan, `第 ${guard} 步：AI 必须有决策（不能返回 null）`);
      if (!playAIAction(game, plan)) game.endTurn();
    }
    assert.ok(guard < 12, `★ 他的回合必须能走完（走了 ${guard} 步，说明卡住了）`);
    // ★★★ 2026-10-03 第四条改版：这一场是**必败剧情战**——他打出去的伤害会把波波压到一半，
    //    那一刻剧情演出直接收掉这一场（`phase === 'result'`）。所以"回合交出去了"这条要放宽成：
    //    **要么回合交了出去，要么这一场已经被剧情收掉了**（两者都算没卡住）。
    if (game.s.phase === 'battle') assert.notEqual(game.s.turn, 'p2', '回合要交得出去');
    else assert.equal(game.s.phase, 'result', '这一场要么继续打、要么被剧情收掉');
  }
});

test('★ 该瞄准的那一轮结束时记下目标格＝离枪手最近的玩家单位所在格，并报一句提示', () => {
  const events = [];
  const game = fixture(13, events);
  const gunner = gunnerOf(game), from = game.tile(gunner);
  assert.equal(game.roundNumber(), 1);
  assert.equal(game.s.shotAim, null, '开局没有弹道');
  assert.equal(game.s.shots, 0);
  playRound(game);
  assert.equal(game.roundNumber(), 2, '正好走完一轮');
  const aim = game.s.shotAim;
  assert.ok(aim, '★ 第 1 轮结束（(1−1) % 2 === 0）就该把弹道画出来');
  assert.equal(aim.round, 1, '记着"是哪一轮画的"');
  assert.equal(aim.shooterId, gunner.id, '记着是谁开的枪（渲染要靠它画虚线）');
  assert.equal(game.s.shots, 0, '这时候还没开火——预告在前、开火在后');
  // 目标格＝离枪手最近的、还活着的玩家单位所在格
  const foes = game.s.units.filter(u => u.side === 'p1' && game.slotAlive(u.slot));
  const nearest = Math.min(...foes.map(u => hexDist(game.tile(u), from)));
  const tile = game.at(aim.row, aim.col);
  assert.equal(hexDist(tile, from), nearest, '★ 必须挑最近的那个玩家单位');
  const onTile = game.s.units.filter(u => u.row === aim.row && u.col === aim.col);
  assert.equal(onTile.length, 1, '那一格上站着一个人');
  assert.equal(onTile[0].side, 'p1', '被瞄的必须是玩家单位');
  assert.equal(aim.name, onTile[0].name);
  // emit 了一句"瞄准中 · 下一回合开火"，而且落进了日志
  assert.match(said(events), /场边冷枪瞄准中/);
  assert.match(said(events), /下一回合开火/);
  assert.ok(game.s.log.some(e => /瞄准中/.test(e.text || '')), '这句提示要留在日志里');
});

test('★ 下一个回合结束开火：站在目标格上的单位挨 6 点真实伤害（无视防御）；没人就是打空、不掉血只记日志', () => {
  // ① 有人站着 → 真的掉血，数值＝净伤 6（2026-10-03 用户从"6 − 防御"改成真实伤害）
  const hit = fixture(13);
  playRound(hit);
  const aim = { ...hit.s.shotAim }, victim = hit.s.units.find(u => u.row === aim.row && u.col === aim.col);
  const defense = hit.defense(victim).total, hp0 = hit.s.hp[victim.slot];
  assert.ok(defense > 0, '（前提）这个目标平时是有防御的，才能证明这一枪无视了它');
  playRound(hit);
  assert.equal(hit.s.shots, 1, '这一轮结束开了枪');
  assert.equal(hit.s.shotAim, null, '★ 结算完必须把弹道清掉（否则界面上会留着一条假弹道）');
  assert.equal(hit.s.hp[victim.slot], hp0 - SNIPER.dmg,
    `★ 伤害必须是净伤 ${SNIPER.dmg} 点真实伤害：防御 ${defense} 一点都不减`);
  assert.ok(hit.s.log.some(e => e.type === 'hit' && /场边冷枪/.test(e.text || '')), '开火要写进日志');

  // ② 开火前挪开 → 打空：0 伤害，日志里留一句
  const events = [];
  const miss = fixture(13, events);
  playRound(miss);                                  // 第 1 轮：把弹道画在"离他最近的那个人"脚下
  const target = miss.s.shotAim;
  const runner = miss.s.units.find(u => u.row === target.row && u.col === target.col);
  const before = { ...miss.s.hp };
  const spot = freeTile(miss, t => t.row === target.row && t.col === target.col);
  Object.assign(runner, { row: spot.row, col: spot.col });   // ★ 挪开那一格
  playRound(miss);                                  // 第 2 轮：开火 → 格子上没人
  assert.equal(miss.s.shots, 1, '这一枪真的开了（而且只开了一枪）');
  assert.equal(miss.s.shotAim, null, '结算完照样要清掉弹道');
  assert.deepEqual({ ...miss.s.hp }, before, '★ 没站在那一格上＝打空了，一分血都不掉');
  assert.match(said(events), /打空了/, '★ 打空也要留一句日志');
  assert.ok(miss.s.log.some(e => /打空/.test(e.text || '')));
});

test('★ 边角：同队的棋子挪进目标格 → 这一枪照样按"打空"处理（不自伤、也不抛错）', () => {
  const game = fixture(13);
  playRound(game);
  const aim = game.s.shotAim;
  const runner = game.s.units.find(u => u.row === aim.row && u.col === aim.col);
  const away = freeTile(game, t => t.row === aim.row && t.col === aim.col);
  Object.assign(runner, { row: away.row, col: away.col });      // 被瞄的人挪开
  // 阶段 1 的敌方只有枪手自己一个（p2），所以"自己人站上去"就是他本人挪到那一格
  Object.assign(gunnerOf(game), { row: aim.row, col: aim.col });
  const before = { ...game.s.hp };
  assert.doesNotThrow(() => playRound(game), '这一枪不能抛错');
  assert.equal(game.s.shots, 1, '这一枪开了');
  assert.deepEqual({ ...game.s.hp }, before, '★ 自己人站在那儿＝打空：谁都不掉血');
  assert.equal(game.s.shotAim, null, '弹道照样清掉');
});

test('★ 别的章节、别的幕、别的模式完全没有冷枪：s.shotAim 永远是 null', () => {
  // ★★ 改版新增：**同一章的阶段 2 也没有**——旗标只写在阶段 1 那一幕上。
  const phase2Game = new Game({ random: seeded(13) });
  phase2Game.setRoster({ p1b: phase2.lineup.ally, story: true, scene: phase2 });
  phase2Game.start(phase2.lineup.player, phase2.lineup.enemy, 'ai', { story: chapter8.id });
  assert.equal(phase2Game.sniperRule(), null, '★ 阶段 2 里冷枪是关着的');
  assert.equal(phase2Game.sniperUnit(), null, '★ 那一场连"放冷枪的人"都不该有');
  for (let i = 0; i < 10; i++) phase2Game.endTurn();
  assert.equal(phase2Game.s.shotAim, null, '★ 阶段 2 一条弹道都没有（"只要在第八章就生效"是错的）');
  assert.equal(phase2Game.s.shots, 0);
  assert.equal(phase2Game.tickSniper(), false, '不在那一幕：结算函数是空操作');
  // 老剧情章节（1v1）
  const chapter7 = STORY_CHAPTERS.find(c => c.id === 'chapter-7');
  const old = new Game({ random: seeded(13) });
  assert.equal(old.sniperRule(), null, '没开打之前没有这一章，也就没有规则');
  assert.equal(old.s.shotAim, null);
  assert.equal(old.keySlot(), null);
  old.start(chapter7.player, chapter7.enemy, 'ai', { story: chapter7.id });
  for (let i = 0; i < 10; i++) old.endTurn();
  assert.equal(old.s.shotAim, null, '★ 别的章节一条弹道都没有');
  assert.equal(old.s.shots, 0);
  assert.equal(old.sniperRule(), null);
  assert.equal(old.tickSniper(), false, '不在那一幕：结算函数是空操作');
  assert.deepEqual(old.s.mirrors, [], '（反光点也同样只在阶段 2）');
  // 自由对局里的枪手：冷枪那面旗根本不存在，他就是一个普通的 boss
  const free = new Game({ random: seeded(13) });
  free.start('emperor', 'jotaro', 'ai');
  const gun = free.s.units.find(u => u.slot === 'p1');
  assert.equal(free.sniperRule(), null);
  assert.equal(free.sniperUnit(), null, '不在那一幕：连枪手都认不出来');
  assert.ok(free.reachable(gun).length > 0, '★ 他照常能走位');
  assert.equal(free.moveRange(gun), gun.move, '移动力照旧（＝2）');
  assert.equal(free.damage(gun, 5, { side: 'p2' }), 5, '★ 照常打得死');
  assert.equal(free.s.hp.p1, FIGHTERS.emperor.hp - 5);
  for (let i = 0; i < 10; i++) free.endTurn();
  assert.equal(free.s.shotAim, null, '自由对局永远没有弹道');
  assert.equal(free.s.shots, 0, '自由对局永远不开枪');
});

test('★ 第八章两场都能被 AI 自动打完（多种子）：冷枪不会把这一局拖死', () => {
  for (const scene of [phase1, phase2]) {
    for (const seed of [...SEEDS, 555]) {
      const game = new Game({ random: seeded(seed) });
      game.setRoster({ p1b: scene.lineup.ally || null, p2b: scene.lineup.enemy2 || null, story: true, scene });
      game.start(scene.lineup.player, scene.lineup.enemy, 'ai', { story: chapter8.id });
      let guard = 0;
      while (game.s.phase === 'battle' && guard++ < 900) {
        const plan = chooseAI(game);
        if (!plan || !playAIAction(game, plan)) game.endTurn();
      }
      const tag = `${scene.lineup.enemy} seed ${seed}`;
      assert.ok(guard < 900, `★ ${tag} 的这局没打完（走了 ${guard} 步，说明卡住了）`);
      assert.equal(game.s.phase, 'result', `${tag} 要分出胜负`);
      assert.ok(['p1', 'p2'].includes(game.s.winner), '胜负落在某一队上');
      // 阶段 2 才是"打倒 J·凯尔"；阶段 1 现在是**必败剧情战**——
      // ★★ 2026-10-03 第三条改版前这里是一条"他只被夹到 1 血"的分支（phaseWin 撤掉之后就不成立了）；
      // ★★★ 第四条又把这一场改成必败（`scene.storyLoss`），于是**玩家永远赢不了阶段 1**：
      //    他这一场有剧本保护（`hpFloor`），所以下面那条 `winner === 'p1'` 的分支根本走不到——
      //    这里改成把**新的不变量**钉死：阶段 1 的胜负只可能是 p2（剧情收场），而且他的血不会是 0。
      if (game.s.winner === 'p1' && scene.lineup.enemy === 'geil') {
        assert.ok(game.s.hp.p2 <= 0, '玩家赢＝J·凯尔被打倒');
      }
      if (scene.lineup.enemy === 'emperor') {
        assert.equal(game.s.winner, 'p2', '★ 阶段 1 是必败剧情战：玩家赢不了（旧断言"判胜时他的血是 0"已推翻）');
        assert.equal(game.s.storyLoss, true, '★ 收场靠的是剧情触发，不是谁的血归零');
        assert.ok(game.s.hp.p2 >= 1, '★ 剧本保护：他的血不会归零');
      }
      if (game.s.winner === 'p2') assert.equal(otherSide('p2'), 'p1', '（电脑赢＝玩家那一队被打光）');
    }
  }
});

test('★ 渲染：弹道虚线 + 准星能画完一整帧，而且准星压在棋子之上、底色压在棋子之下', () => {
  const previous = globalThis.document, previousWindow = globalThis.window;
  globalThis.window = { devicePixelRatio: 1, addEventListener() {}, removeEventListener() {} };
  try {
    const calls = [];
    const ctx = new Proxy({}, {
      get(_, prop) {
        if (prop === 'canvas') return { width: CANVAS_W, height: CANVAS_H };
        if (typeof prop === 'symbol') return undefined;
        return (...args) => {
          calls.push({ prop, args });
          if (prop === 'createLinearGradient' || prop === 'createRadialGradient') return { addColorStop() {} };
          if (prop === 'measureText') return { width: 10 };
          return undefined;
        };
      },
      set(_, prop, value) { calls.push({ prop: String(prop), args: [value], isSet: true }); return true; },
    });
    const canvas = { width: CANVAS_W, height: CANVAS_H, style: {}, getContext: () => ctx, addEventListener() {}, getBoundingClientRect: () => ({ left: 0, top: 0, width: CANVAS_W, height: CANVAS_H }) };
    globalThis.document = {
      getElementById: id => (id === 'board' ? canvas : null),
      createElement: () => ({ width: 0, height: 0, style: {}, getContext: () => ctx }),
    };
    const game = fixture(13);
    const visual = new BoardVisual(game);
    const gunner = gunnerOf(game);
    // 瞄一个**空格**（标签只在格子上没人时才写；有人时靠红圈／十字，见 drawSniperCrosshair）
    const empty = freeTile(game);
    game.s.shotAim = { row: empty.row, col: empty.col, round: 1, shooterId: gunner.id, slot: 'p2b', name: '空地' };
    assert.doesNotThrow(() => visual.render(game.actionView(), 0), '有弹道的一帧不该抛错');
    const labels = calls.filter(c => c.prop === 'fillText').map(c => c.args[0]);
    assert.ok(labels.includes('冷枪'), '被瞄的那一格要写上"冷枪"');
    // ① 弹道是虚线，而且从枪手连到目标格
    const dashed = calls.filter(c => c.prop === 'setLineDash' && c.args[0]?.length === 2);
    assert.ok(dashed.length >= 2, '弹道 + 准星都要用虚线');
    // ② 分层：地面那层红色警戒底色**在棋子之前**，准星（那个字）**在棋子之后**
    //    （测试环境里立绘图没加载，棋子走的是"主／替"那行兜底文字，所以用队伍标签定位棋子）
    const unitAt = calls.map((c, i) => (c.prop === 'fillText' && /^(P1|P2)(·2)? · (主|替)$/.test(String(c.args[0])) ? i : -1));
    const firstUnit = unitAt.find(i => i >= 0), lastUnit = unitAt.reduce((a, b) => Math.max(a, b), -1);
    const groundAt = calls.findIndex(c => c.prop === 'fillStyle' && c.args[0] === 'rgba(214,54,64,.22)');
    const crossAt = calls.findIndex(c => c.prop === 'fillText' && c.args[0] === '冷枪');
    assert.ok(groundAt >= 0 && firstUnit >= 0 && lastUnit > firstUnit, '弹道底色与棋子都要真的画出来');
    assert.ok(groundAt < firstUnit, '★ 警戒底色要压在棋子下面（不糊立绘）');
    assert.ok(crossAt > lastUnit, '★ 准星画在棋子之后（"谁被瞄着"一眼可见）');
    // ③ 有人站在目标格上时：不写标签（那是棋子的名字 + 血条的位置），但也不许抛错
    game.s.shotAim = { row: gunner.row, col: gunner.col, round: 1, shooterId: gunner.id, slot: 'p2b', name: gunner.name };
    game.touch();
    const from = calls.length;
    assert.doesNotThrow(() => visual.render(game.actionView(), 16));
    const second = calls.slice(from).filter(c => c.prop === 'fillText').map(c => c.args[0]);
    assert.equal(second.includes('冷枪'), false, '格子上有人时不写"冷枪"（那会糊住棋子的名字与血条）');
    const saves = calls.filter(c => c.prop === 'save').length, restores = calls.filter(c => c.prop === 'restore').length;
    assert.equal(saves, restores, 'save / restore 必须配平，否则后面的绘制会被裁切');
  } finally {
    if (previous === undefined) delete globalThis.document; else globalThis.document = previous;
    if (previousWindow === undefined) delete globalThis.window; else globalThis.window = previousWindow;
  }
});

test('★ 界面运行时：第八章的状态栏真的挂上了冷枪标签（用假 DOM 真调 renderCards）', async () => {
  const previous = globalThis.document;
  const elements = new Map();
  const make = id => ({
    id, innerHTML: '', textContent: '', className: '', style: {}, dataset: {}, attributes: {},
    classList: { toggle() {}, add() {}, remove() {}, contains: () => false },
    setAttribute(k, v) { this.attributes[k] = String(v); }, getAttribute(k) { return this.attributes[k] ?? null; },
    hasAttribute(k) { return k in this.attributes; }, removeAttribute(k) { delete this.attributes[k]; },
    addEventListener() {}, removeEventListener() {}, focus() {}, blur() {}, closest: () => null,
    querySelector: () => make(`${id}-child`), querySelectorAll: () => [],
    insertAdjacentHTML(_, html) { this.innerHTML += html; },
    appendChild() {}, contains: () => true, getBoundingClientRect: () => ({ left: 0, top: 0, width: 100, height: 100, bottom: 100, right: 100 }),
  });
  globalThis.document = {
    getElementById: id => { if (!elements.has(id)) elements.set(id, make(id)); return elements.get(id); },
    querySelector: () => make('query'), querySelectorAll: () => [], createElement: () => make('created'),
    addEventListener() {}, removeEventListener() {}, activeElement: null, body: make('body'),
  };
  try {
    const { renderCards } = await import('../src/ui/hud.js');
    const game = fixture(13);
    const p2 = () => elements.get('sideP2')?.innerHTML || '';
    renderCards(game, { humanTurn: true });
    assert.match(p2(), /场边冷枪/, '★ 枪手那一栏要挂上冷枪标签');
    assert.match(p2(), /再等 \d+ 个回合开火/, '还没瞄准时要报"再等 N 个回合"');
    // ★ 改版：他已经打得死、也会走位，所以"打不死 / 移动＝固定"两句都撤了。
    // ★★ 2026-10-03 第三条用户拍板：**这一场的胜负口径改回正常胜负——把他的血打空才算赢**。
    // ★★★ 同一天第四条又把它改成**必败剧情战**（`scene.storyLoss`）：他这一场有剧本保护、
    //    打不倒，波波掉到一半就收场。所以状态栏上挂的是"这一场打不过"，**不再**是"打倒他就赢"
    //    （那条口径已经被推翻：这一场根本赢不了）。
    assert.equal(/打不死/.test(p2()), false, '★ 旧说法必须消失（他已经能被打伤）');
    assert.equal(/固定/.test(p2()), false, '★ 旧说法必须消失（他会走位）');
    assert.equal(/打到共享生命的一半就结束这一场/.test(p2()), false, '★ 旧口径已经撤掉（那是 phaseWin 那一套）');
    assert.equal(/打倒 霍尔·霍斯 就赢/.test(p2()), false, '★ 这一场赢不了，不许再写"打倒他就赢"');
    assert.match(p2(), /这一场打不过/, '★ 要如实告诉玩家"这一场注定打不过"（剧情战）');
    assert.match(p2(), /不会被打倒/, '★ 也要写清他这一场打不倒（剧本保护）');
    playRound(game);
    renderCards(game, { humanTurn: true });
    assert.match(p2(), /场边冷枪瞄准中 · 下一回合开火/, '★ 瞄准中要报出"下一回合开火"');
    assert.match(p2(), /挪开/, '要让玩家知道"挪开那一格就躲开了"');
  } finally {
    if (previous === undefined) delete globalThis.document; else globalThis.document = previous;
  }
});

test('★ 界面接线：冷枪的状态标签与格子说明都接上了（静态检查 + 运行时文案）', () => {
  const game = fixture(13);
  const gunner = gunnerOf(game);
  // ★ 改版后枪手脚下那一格不再有特殊说法（"钉在这里、打不死"已经撤掉）——就是一块普通地面。
  const home = tileDescription(game, game.tile(gunner));
  assert.equal(/冷枪/.test(home), false, '没被瞄的格子不该提冷枪（他已经不钉在那儿放枪了）');
  assert.equal(/打不死/.test(home), false, '★ 旧说法必须消失');
  // 还没瞄准：普通格子照旧
  const plain = freeTile(game);
  assert.equal(/冷枪/.test(tileDescription(game, plain)), false, '没被瞄的格子不该胡说');
  // 瞄准之后：被瞄的那一格要说明"站这儿会挨枪、挪开就躲开了"
  playRound(game);
  const tile = game.at(game.s.shotAim.row, game.s.shotAim.col);
  const text = tileDescription(game, tile);
  assert.match(text, /冷枪/);
  assert.match(text, /弹道/);
  assert.match(text, /挪开/, '★ 必须告诉玩家"挪开就能躲"');
  assert.match(text, new RegExp(`${SNIPER.dmg} 点`), '伤害数字要写出来');
  // 状态标签：hud 用的是假 DOM 才跑得起来的模板，所以这里做静态检查（照 mirrors.test 的写法）
  const hud = fs.readFileSync(new URL('../src/ui/hud.js', import.meta.url), 'utf8');
  assert.match(hud, /function sniperTags\(game\)/, '状态标签要有独立的一处实现（照 mirrorTags 的写法）');
  assert.match(hud, /\$\{rule\.aimText\}/, '★ 瞄准中要用 SNIPER 里那句"下一回合开火"');
  assert.match(hud, /再等 \$\{left\} 个回合开火/, '★ 还没瞄的时候要报"再等 N 个回合"');
  assert.match(hud, /game\.sniperRule\?\.\(\) && game\.sniperUnit\?\.\(\)\?\.slot === slot \? sniperTags\(game\)/,
    '标签要真的挂进状态栏');
});
