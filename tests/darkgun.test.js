/**
 * ★★ 「暗枪」——霍尔·霍斯的**第三个**技能（2026-10-05 用户拍板）。
 *
 * 用户原话：「霍尔的场外冷枪也加上，作为 pvp 技能：『暗枪』不消耗 ap，每回合会标记地图上的
 * 两个位置（攻击范围内），在对方回合结束时对范围内敌人造成 8 点伤害」。
 * 随后明确的两点（这一份测试就是照这两条钉的）：
 *   · **8 点按常规结算防御**（**不是**真实伤害）；
 *   · **两个位置由操控者手动选**（像既有技能「皇帝」那样点目标）。
 *
 * 落地口径（数值全部由用户定，**不许改**，见 rules.js 的 `SKILLS.darkgun`）：
 *   · `cost: 0`＝不消耗 AP；`cd: 1`＝项目惯例里的「每回合一次」（同一回合内只放一次）；
 *   · `by: 'user'`＝本体释放；`range: 5`＝可标记范围＝他自己的攻击射程；
 *   · `marks: 2`＝一次使用连着点两格（不能重复、都要在射程内，走既有「火焰道路」那套多格流程）；
 *   · 结算时机＝**对手回合结束时**；踩在标记格上的**敌方**单位各受 `dmg` 点（`dmg: 8`）；
 *   · 结算完**标记清空**；标记期间对手看得见、能躲；只打敌方、标到自己人脚下不伤自己人。
 *
 * ⚠️⚠️ 第八章那套**自动「场边冷枪」一个字都没动**（幕上的 `sniper` 旗标机制：每 2 回合、
 *    净伤 6 真实伤害、弹道预告）。用户明确要求"两者都留"——所以 ④ 里有一条专门守它没被改坏，
 *    完整回归仍在 `tests/sniper.test.js`。
 *
 * ⚠️ 本文件是**新增**的。被这一条用户拍板**直接推翻**的既有断言只有两处（都已按新口径改过并注明理由）：
 *    `tests/emperor-skills.test.js` ① 与 `tests/chapter8-rework.test.js` ② 里那两个
 *    `skillSetFor('emperor')` 数组（两个技能 → 三个技能）。其余既有文件一个字没动。
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { Game, FIGHTERS, SKILLS, SNIPER, STORY_CHAPTERS, skillSetFor } from '../src/core/game.js';
import { hexDist, tileKey, R, CANVAS_W, CANVAS_H } from '../src/core/hex.js';
import { chooseAI, playAIAction } from '../src/core/ai.js';
import { BoardVisual } from '../src/ui/render.js';
import { renderCards, tileDescription } from '../src/ui/hud.js';
import { icon } from '../src/ui/icons.js';

function seeded(seed = 13) { return () => ((seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0) / 4294967296); }
const chapter8 = STORY_CHAPTERS.find(c => c.id === 'chapter-8');
/** 阶段 1（波鲁纳雷夫 单挑 皇帝）——**按阵容认**，不写死下标。 */
const phase1 = chapter8.scenes.find(scene => scene.kind === 'battle' && scene.lineup?.enemy === 'emperor');
const SEEDS = [13, 7919, 9421, 20261005, 555];

/**
 * 自由对局夹具：**p1＝皇帝、p2＝波鲁纳雷夫**（这样技能的持有者永远在 p1、敌人永远在 p2，写起来最直白）。
 * ⚠️ 开局后**清空地形**、再把棋子摆到固定格子上：草丛（+3）／邻石（+1）会把"防御有多少"这个对照量
 *    搅乱，而这一整份测试大半都靠"防御到底算不算"来判断。
 */
function fixture({ seed = 13, gap = 4, events = null } = {}) {
  const game = new Game({ random: seeded(seed), onEvent: event => events?.push(event) });
  assert.equal(game.start('emperor', 'polnareff', 'ai'), true);
  game.s.terrain = {};
  const emperor = game.s.units.find(u => u.slot === 'p1' && u.kind === 'user');
  const user = game.s.units.find(u => u.slot === 'p2' && u.kind === 'user');
  const stand = game.s.units.find(u => u.slot === 'p2' && u.kind === 'stand');
  Object.assign(emperor, { row: 5, col: 2 });
  Object.assign(user, { row: 5, col: 2 + gap });
  Object.assign(stand, { row: 3, col: 2 + gap });
  game.s.turn = 'p1';
  game.s.ap.p1 = 3;
  return { game, emperor, user, stand };
}
/** 找一个"离 `from` 正好 `dist` 格"、没被棋子／柱子占着的格子（测试里造射程边界用）。 */
const spotAt = (game, from, dist, used = []) => game.tiles.find(t => hexDist(t, from) === dist
  && !used.some(x => tileKey(x) === tileKey(t)) && !game.occupant(t) && !game.pillarAt(t));
/** 把一枚棋子挪到某一格上（测试里摆局面用；引擎的 `move()` 会受 AP／路径限制，不该拿来摆局）。 */
function place(unit, tile) { Object.assign(unit, { row: tile.row, col: tile.col }); return unit; }
/** 走完整整一轮（1v1 两个槽位各交一次回合）。 */
function playRound(game, rounds = 1) {
  for (let r = 0; r < rounds && game.s.phase === 'battle'; r++) {
    for (let i = 0; i < game.s.slots.length && game.s.phase === 'battle'; i++) game.endTurn();
  }
}
/** 按某一幕的阵容开一局（＝ main.js 里 startStoryMatch + startMatch 那一套的等价写法）。 */
function openStage(scene, { seed = 13, events = null } = {}) {
  const game = new Game({ random: seeded(seed), onEvent: event => events?.push(event) });
  game.setRoster({ p1b: scene.lineup.ally || null, p2b: scene.lineup.enemy2 || null, story: true, scene });
  assert.equal(game.start(scene.lineup.player, scene.lineup.enemy, 'ai', { story: chapter8.id }), true);
  return game;
}
/** 真人从"选中他"到"埋好两格"的完整动作（与 main.js 点击链路逐段对应）。 */
function bury(game, unit, tiles) {
  assert.equal(game.select(unit.id), true, '先选中他');
  assert.equal(game.beginSkill(unit, 'darkgun'), true, '再点「暗枪」');
  for (const t of tiles) assert.equal(game.darkgunMark(unit, t), true, `埋 ${tileKey(t)}`);
}

// ===================== ① 技能数据 =====================

test('① 技能数据：不消耗 AP、每回合一次、本体释放；在他自己的技能表里、图标不撞脸、desc 是纯文本', () => {
  const sk = SKILLS.darkgun;
  assert.ok(sk, '★ `SKILLS.darkgun` 必须存在（技能表里查得到）');
  assert.equal(sk.name, '暗枪');
  assert.equal(sk.cost, 0, '★ 用户拍板：不消耗行动点');
  assert.equal(sk.cd, 1, '★ 项目惯例里的「每回合一次」＝数据 cd: 1（同一回合内只放一次）');
  assert.equal(sk.by, 'user', '本体释放（他是单单位角色，照 aim／emperor 的写法）');
  assert.equal(sk.dmg, 8, '★ 用户定的 8 点，不许改');
  assert.equal(sk.marks, 2, '★ 一次使用标记两个位置');
  assert.equal(sk.range, FIGHTERS.emperor.user.range, '★ 可标记范围＝他自己的攻击射程（两处必须一致）');
  assert.equal(sk.range, 5, '（顺便）射程现在就是 5');
  // 技能表：顺序由用户定。⚠️ 2026-10-05 第二条拍板**「皇帝」与「暗枪」换位置**之后，
  // 「暗枪」是第二个、「皇帝」是第三个（下面两处数组被直接推翻，其余断言一个字没改）。
  assert.deepEqual(skillSetFor('emperor'), ['aim', 'darkgun', 'emperor'], '★ 他的技能表就是这三个，顺序也是用户定的');
  assert.equal(skillSetFor('emperor').includes('darkgun'), true, '★ 在技能表里');
  // 别的角色一个都不该有它
  for (const fighter of Object.values(FIGHTERS)) {
    if (fighter.key === 'emperor') continue;
    assert.equal(skillSetFor(fighter.key).includes('darkgun'), false, `${fighter.key} 不该有「暗枪」`);
  }
  // 图标：没有条目时 icon() 会退回星形（与「流星指刺」撞脸），所以必须补一个自己的
  assert.notEqual(icon('darkgun'), icon('star'), '★ 暗枪的图标不能是星形兜底（会与「流星指刺」撞脸）');
  assert.notEqual(icon('darkgun'), icon('emperor'), '也不能与「皇帝」撞脸');
  // desc：纯文本（tooltip 走 esc(plain(...))，星号与标签会被原样显示给玩家），且该说的都说清
  assert.equal(typeof sk.desc, 'string', '要写明 desc');
  assert.equal(/\*\*|<\/?(?:b|strong|em|i)>/.test(sk.desc), false, '★ desc 在界面上是纯文本：不许有星号或 HTML 标签');
  for (const [word, why] of [['不消耗行动点', '0 AP'], ['每回合限 1 次', '每回合一次'], ['两个格子', '一次两格'],
    ['8 点伤害', '伤害'], ['按常规结算防御', '不是真实伤害'], ['对手回合结束时', '结算时机'],
    ['结算完标记清空', '结算后清空'], ['只打敌方单位', '只打敌人']]) {
    assert.match(sk.desc, new RegExp(word), `★ desc 要写清「${why}」`);
  }
  // 场上：技能真的挂在他身上、状态栏读得出来、别的角色用不了
  const { game, emperor } = fixture();
  assert.deepEqual(game.skills('p1'), ['aim', 'darkgun', 'emperor']);
  const status = game.skillStatus('p1', 'darkgun');
  assert.equal(status.cost, 0);
  assert.equal(status.enabled, true);
  assert.match(status.status, /不消耗行动点/);
  const foe = game.s.units.find(u => u.slot === 'p2' && u.kind === 'stand');
  // ⚠️ 得先把回合交给他，否则 `actorReason` 会先报"现在是对手的回合"，看不到"技能不属于他"那一层
  game.s.turn = 'p2';
  assert.equal(game.skillReason(foe, 'darkgun'), '该技能不属于当前角色。');
  assert.equal(game.skillStatus('p2', 'darkgun').enabled, false, '界面上的按钮也是灰的');
  assert.equal(game.skillReason(emperor, 'darkgun'), '现在是对手的回合。', '（对照）轮不到他时是另一条理由');
  game.s.turn = 'p1';
  // 开局账本是空的（没有 darkgun 技能的对局里这两项永远是空的）
  assert.deepEqual(game.s.darkMarks, []);
  assert.deepEqual(game.s.darkPlaced, []);
});

// ===================== ② 手动标记两格 =====================

test('② 手动标记两格：两格都成、不能重复、超射程不收、本回合不能再标（Esc 可提前收手）', () => {
  const { game, emperor } = fixture();
  const me = game.tile(emperor);
  const far = spotAt(game, me, SKILLS.darkgun.range + 1);
  const empty = game.darkgunTiles(emperor).filter(t => !game.occupant(t));
  assert.ok(far, '（前提）棋盘上要有射程外的格子');
  assert.ok(empty.length >= 3, `（前提）射程内要有空着的格子（实际 ${empty.length}）`);
  // 判据先行：界面高亮／格子说明／AI 选格／真人点击读的都是这一份
  assert.equal(game.darkgunReason(emperor, empty[0]), '', '射程内的空格：可标');
  assert.match(game.darkgunTileReason(emperor, far), /射程/, '★ 超出射程不接受');
  assert.equal(game.darkgunReason(emperor, game.tile(emperor)), '', '脚下的那一格（距离 0）也在射程内');

  // 真人：先选他、再点「暗枪」（走 select → beginSkill 这条既有链路），**不花 AP**
  assert.equal(game.select(emperor.id), true);
  assert.equal(game.beginSkill(emperor, 'darkgun'), true);
  assert.equal(game.s.pendingSkill, 'darkgun');
  assert.equal(game.s.ap.p1, 3, '★ cost 0：连"开技能"都不花行动点');
  assert.equal(game.s.darkMarks.length, 0, '还没落子：场上一条标记都没有');

  // 射程外：不收，而且**这一手不会被吃掉**（照火焰那套：首格才结账）
  assert.equal(game.darkgunMark(emperor, far), false);
  assert.match(game.s.notice.text, /射程/);
  assert.equal(game.s.pendingSkill, 'darkgun', '点了非法格子不该把这一手取消掉');
  assert.equal(game.s.darkMarks.length, 0);
  assert.equal(game.s.stats.p1.skills, 0, '非法的一格不算施放');

  // 第一格：落地就进 CD（cost 0 → 一分 AP 都不扣）
  assert.equal(game.darkgunMark(emperor, empty[0]), true);
  assert.equal(game.s.darkMarks.length, 1);
  assert.equal(game.s.ap.p1, 3, '★ 标完一格照样不花 AP');
  assert.equal(game.s.cd.p1.darkgun, SKILLS.darkgun.cd, '第一格落地就进冷却');
  assert.equal(game.s.stats.p1.skills, 1, '两格算**一手**：施放次数只记一次');

  // 不能重复：同一格再点一次不收
  assert.equal(game.darkgunMark(emperor, empty[0]), false);
  assert.match(game.s.notice.text, /已经标过/);
  assert.equal(game.s.darkMarks.length, 1);

  // 第二格：**不会被"刚刚才进的冷却"顶掉**（第二格只查"这一格能不能标"，照 place() 那套）
  assert.equal(game.darkgunMark(emperor, empty[1]), true, '★ 第二格照样埋得下');
  assert.equal(game.s.darkMarks.length, 2, '★ 一次使用＝两个位置');
  assert.equal(game.s.pendingSkill, null, '埋满两格自动收手');
  assert.equal(game.s.stats.p1.skills, 1, '两格仍然只算一次施放');
  assert.equal(game.s.ap.p1, 3, '一整手下来 AP 一点没动');

  // 本回合不能再标（cd: 1＝同一回合内只放一次）
  assert.match(game.skillReason(emperor, 'darkgun'), /冷却/);
  assert.equal(game.skillStatus('p1', 'darkgun').enabled, false);
  assert.equal(game.beginSkill(emperor, 'darkgun'), false, '本回合第二次开不出来');

  // 走完一轮：标记在**对手回合结束时**结算掉（详见 ③），同时冷却也走完
  playRound(game, 1);
  assert.equal(game.s.turn, 'p1');
  assert.equal(game.s.darkMarks.length, 0, '轮末结算完标记清空');
  assert.equal(game.skillReason(emperor, 'darkgun'), '', '★ 每回合一次：下一轮又能埋');

  // 提前收手（Esc）：只埋一格也**照旧生效**，不会被撤销（与火焰那套口径一致）
  assert.equal(game.beginSkill(emperor, 'darkgun'), true);
  const lone = game.darkgunTiles(emperor).filter(t => !game.occupant(t))[0];
  assert.equal(game.darkgunMark(emperor, lone), true);
  assert.equal(game.s.darkPlaced.length, 1, '「这一手点过哪几格」的记账');
  assert.equal(game.cancel(), true, 'Esc 提前收手');
  assert.equal(game.s.pendingSkill, null);
  assert.equal(game.s.darkMarks.length, 1, '★ 已经埋下的标记不会撤销');
  assert.equal(game.s.darkPlaced.length, 0, '但"这一手"的记账清掉了（它不是场上的标记）');
  // 收手之后别的技能／移动照常（不会被"请先埋好第二个位置"那条闸拦住）
  assert.equal(game.beginSkill(emperor, 'emperor'), true, '别的技能照常能开');
  assert.equal(game.cancel(), true);
});

// ===================== ③ 对手回合结束时结算 =====================

test('③ 对手回合结束时结算：踩标记格的敌方单位受 8 − 防御，没人踩＝0，结算后清空，不伤自己人', () => {
  const events = [];
  const { game, emperor, stand } = fixture({ events });
  const me = game.tile(emperor);
  // 摆一个"敌人就站在射程内某一格上"的局面
  const prey = game.darkgunTiles(emperor).find(t => hexDist(t, me) === 3 && !game.occupant(t));
  assert.ok(prey, '（前提）射程内要有一格空位放敌人');
  place(stand, prey);

  // 口径先行：这一枪**按常规结算防御**（与预览同一把尺子）
  const pv = game.preview(emperor, stand, 'darkgun');
  const defense = game.defense(stand).total;
  assert.equal(pv.defense.total, defense, '★ 防御照常算（不是真实伤害通道）');
  assert.equal(pv.damage, Math.max(1, SKILLS.darkgun.dmg - defense), `★ 8 − 防御 ${defense} = ${pv.damage}`);
  assert.ok(pv.damage < SKILLS.darkgun.dmg, '（前提）目标有防御，才看得出"计防御"');
  assert.equal(game.darkgunDamage(stand), pv.damage, '★ 实际结算用的那个数必须与预览一致（不然就是骗玩家）');

  // 埋两格：第一格＝敌人当前所在格，第二格＝**自己脚下**（专门验"不伤自己人"）
  const mine = game.tile(emperor);
  bury(game, emperor, [prey, mine]);
  assert.equal(game.darkgunMarks().length, 2, '两条标记都挂在场上（渲染／状态栏／格子说明共用这一份）');
  const marked = game.darkgunMarks().map(m => tileKey(m.tile));
  assert.equal(marked.includes(tileKey(prey)), true, '★ 敌人脚下那一格真的被标上了');
  assert.equal(marked.includes(tileKey(mine)), true);

  // ① 埋枪方**自己**回合结束：枪不落地（用户原话是"在对方回合结束时"）
  const hpP2 = game.s.hp.p2, hpP1 = game.s.hp.p1;
  assert.equal(game.endTurn(), true, 'p1 交回合');
  assert.equal(game.s.hp.p2, hpP2, '★ 埋枪方自己回合结束时，枪不落地');
  assert.equal(game.s.hp.p1, hpP1);
  assert.equal(game.darkgunMarks().length, 2, '标记还留在场上——对手在自己的回合里看得见、能躲');

  // ② 对手回合结束：落地。踩在标记格上的敌方单位挨 8 − 防御；标到自己脚下的那一格一颗血都不掉
  assert.equal(game.s.turn, 'p2');
  assert.equal(game.endTurn(), true, 'p2 交回合（＝对手回合结束）');
  assert.equal(game.s.hp.p2, hpP2 - pv.damage, '★ 踩在标记格上的敌方单位受了 8 − 防御');
  assert.equal(game.s.hp.p1, hpP1, '★ 标到自己人脚下不会伤到自己人');
  assert.equal(game.darkgunMarks().length, 0, '★ 结算完标记清空');
  assert.ok(events.some(e => e.type === 'hit' && /暗枪/.test(e.text || '')), '结算要有一条战报');
  assert.ok(events.some(e => e.type === 'status' && /埋空/.test(e.text || '')),
    '自己人那一格记成"埋空"（只打敌方单位）');

  // ③ 没人踩＝0 伤害（标记照样清空）
  assert.equal(game.s.turn, 'p1');
  const empties = game.darkgunTiles(emperor).filter(t => !game.occupant(t));
  assert.ok(empties.length >= 2, '（前提）还有空格可标');
  bury(game, emperor, [empties[0], empties[1]]);
  assert.equal(game.darkgunMarks().length, 2);
  const hpBefore = game.s.hp.p2, hpP1Before = game.s.hp.p1;
  playRound(game, 1);                                        // p1 交回合 → p2 交回合（枪在这一刻落地）
  assert.equal(game.s.hp.p2, hpBefore, '★ 没人踩＝0 伤害');
  assert.equal(game.s.hp.p1, hpP1Before);
  assert.equal(game.darkgunMarks().length, 0, '空枪也照样把标记清空');
});

// ===================== ④ 与既有机制互不干扰 =====================

test('④ 互不干扰：自动冷枪照旧、「瞄准」的穿透次数不被暗枪吃掉、「皇帝」锁定与暗枪各算各的', () => {
  // 甲）第八章自动「场边冷枪」一个字都没动：每 2 回合开一枪、净伤 6 真实伤害；
  //     同一局里再挂上「暗枪」也不影响它（两条路各算各的账）
  const events = [];
  const game = openStage(phase1, { events });
  assert.equal(game.sniperRule(), SNIPER, '★ 冷枪仍然只在阶段 1 生效');
  assert.equal(game.s.shotAim, null);
  const gunner = game.s.units.find(u => u.slot === 'p2');
  assert.equal(gunner.sniper, true, '（前提）这一局的枪手就是他');
  playRound(game);                                            // 第 1 轮结束：把弹道画出来
  const aim = game.s.shotAim;
  assert.ok(aim, '★ 第 1 轮结束照旧把弹道画出来');
  const victim = game.s.units.find(u => u.row === aim.row && u.col === aim.col);
  const sniperHp = game.s.hp[victim.slot];
  // 冷枪还挂着的时候，让他亲手埋一手「暗枪」（两格都挑空格，别跟冷枪的账搅在一起）
  game.s.turn = 'p2';
  game.s.ap.p2 = 3;
  const spare = game.darkgunTiles(gunner).filter(t => !game.occupant(t)).slice(0, 2);
  assert.equal(spare.length, 2, '（前提）射程内有两个空格可埋');
  bury(game, gunner, spare);
  assert.equal(game.darkgunMarks().length, 2, '暗枪埋好了，冷枪的弹道还挂着');
  assert.ok(game.s.shotAim, '★ 埋暗枪不动冷枪的弹道');
  playRound(game);                                            // 第 2 轮结束：冷枪开火
  assert.equal(game.s.shots, 1, '★ 第 2 轮结束照旧开火');
  assert.equal(game.s.shotAim, null, '弹道清掉');
  assert.equal(game.s.hp[victim.slot], sniperHp - SNIPER.dmg,
    `★ 净伤 ${SNIPER.dmg} 点真实伤害：防御一点都不减（自动冷枪没被改坏）`);
  assert.ok(events.some(e => e.type === 'hit' && /场边冷枪/.test(e.text || '')));

  // 乙）「瞄准」的穿透次数不被暗枪消耗，暗枪也不吃它的无视防御（用户定：8 点按常规结算防御）
  const probe = fixture({ gap: 4 });
  assert.equal(probe.game.beginSkill(probe.emperor, 'aim'), true);
  assert.equal(probe.game.s.aimCharges.p1, SKILLS.aim.charges);
  const target = probe.stand;
  const def = probe.game.defense(target).total;
  assert.equal(probe.game.preview(probe.emperor, target).defense.total, 0, '（前提）瞄准开着：普攻预览防御归零');
  assert.equal(probe.game.preview(probe.emperor, target, 'darkgun').defense.total, def,
    '★ 即使正开着瞄准，暗枪的预览也照常算防御');
  bury(probe.game, probe.emperor, [probe.game.tile(target), spotAt(probe.game, probe.game.tile(probe.emperor), 1)]);
  assert.equal(probe.game.s.aimCharges.p1, SKILLS.aim.charges, '★ 埋暗枪不消耗「瞄准」的次数');
  const hp0 = probe.game.s.hp.p2;
  playRound(probe.game, 1);                                   // p1 交回合 → p2 交回合（枪在这一刻落地）
  assert.equal(probe.game.s.hp.p2, hp0 - Math.max(1, SKILLS.darkgun.dmg - def), '★ 暗枪照常减防御');
  assert.equal(probe.game.s.aimCharges.p1, SKILLS.aim.charges, '★ 结算那一下也不消耗次数');

  // 丙）「皇帝」锁定与暗枪各算各的：两本账、两次伤害，互不顶替
  const both = fixture();
  assert.equal(both.game.select(both.emperor.id), true);
  assert.equal(both.game.beginSkill(both.emperor, 'emperor'), true);
  assert.equal(both.game.emperorLock(both.stand), true, '「皇帝」锁定一个单位');
  const locked = both.game.tile(both.stand);
  const other = spotAt(both.game, both.game.tile(both.emperor), 2, [locked]);
  place(both.user, other);
  both.game.select(both.emperor.id);
  assert.equal(both.game.beginSkill(both.emperor, 'darkgun'), true);
  assert.equal(both.game.darkgunMark(both.emperor, other), true, '暗枪标另一格（他脚下）');
  assert.equal(both.game.darkgunMark(both.emperor, spotAt(both.game, both.game.tile(both.emperor), 1, [locked, other])), true);
  assert.equal(both.game.emperorMarks().length, 1, '★ 「皇帝」的锁定只有一条');
  assert.equal(both.game.darkgunMarks().length, 2, '★ 暗枪的标记是另外两条');
  const lockDmg = both.game.emperorDamage(both.stand);
  const gunDmg = both.game.preview(both.emperor, both.user, 'darkgun').damage;
  const hp = both.game.s.hp.p2;
  playRound(both.game, 2);                                    // 一回合之后「皇帝」才落；暗枪在对手回合末落
  assert.equal(both.game.s.hp.p2, hp - lockDmg - gunDmg, '★ 两枪分别结算、各扣各的（谁也不顶替谁）');
  assert.equal(both.game.emperorMarks().length, 0);
  assert.equal(both.game.darkgunMarks().length, 0);
});

// ===================== ⑤ AI =====================

test('⑤ AI 会用：第一格挑敌方棋子当前所在格＋另一个有意义的目标格；没敌人／本回合已用过就放弃', () => {
  /**
   * 摆好的局面（照 `tests/emperor-skills.test.js` ⑤ 那套写法）：
   * ⚠️ 先把「瞄准」与「皇帝」两条**挡掉**（`cd` 设成 1＝本回合刚用过），
   *    否则它们按 48 / (10−防御)×4+8 分压在最上面——那不是这一条要测的东西。
   */
  const prep = () => {
    const f = fixture({ gap: 4 });
    f.game.s.cd.p1.aim = 1;
    f.game.s.cd.p1.emperor = 1;
    return f;
  };

  // 甲）射程里**只有一个**敌人：第一格＝他脚下，第二格＝紧挨着他的那一格（他下一步最容易踩上去的地方）
  const one = prep();
  const far = spotAt(one.game, one.game.tile(one.emperor), SKILLS.darkgun.range + 1);
  place(one.user, far);                                       // 把本体挪到射程外，只留替身在射程里
  assert.equal(hexDist(one.game.tile(one.emperor), one.game.tile(one.stand)) <= SKILLS.darkgun.range, true, '（前提）替身在射程里');
  const planOne = chooseAI(one.game);
  assert.equal(planOne?.type, 'darkgun', `★ 这一手它该挑「暗枪」（实际 ${planOne?.type}）`);
  assert.equal(planOne.tiles.length, SKILLS.darkgun.marks, '★ 一次埋两个位置');
  assert.equal(tileKey(planOne.tiles[0]), tileKey(one.game.tile(one.stand)), '★ 第一格＝敌方棋子当前所在的那一格');
  assert.equal(hexDist(planOne.tiles[0], planOne.tiles[1]), 1, '★ 第二格紧挨着目标（他前进方向的那一格，就是"另一个有意义的目标格"）');
  assert.equal(new Set(planOne.tiles.map(tileKey)).size, 2, '两个位置不能重复');
  for (const t of planOne.tiles) assert.equal(one.game.darkgunTileReason(one.emperor, t), '', '两个位置都在射程内、也没被标过');

  // 真的演出来：走的是与真人同一条路（beginSkill → darkgunMark）
  assert.equal(playAIAction(one.game, planOne), true);
  assert.equal(one.game.s.darkMarks.length, 2, 'AI 埋的标记与真人埋的是同一份账');
  assert.equal(one.game.s.cd.p1.darkgun, SKILLS.darkgun.cd, '照常进冷却');
  assert.equal(one.game.darkgunMarks().some(m => m.row === one.stand.row && m.col === one.stand.col), true);
  assert.equal(one.game.s.pendingSkill, null, '埋满两格自动收手（不会把这一手挂在半空中）');
  // 本回合已经用过 → 这一条不再生成（也不会拿着 0 AP 反复埋）
  assert.match(one.game.skillReason(one.emperor, 'darkgun'), /冷却/);
  assert.notEqual(chooseAI(one.game)?.type, 'darkgun');

  // 乙）射程里**有两个**敌人：人手一处（两条标记各落在一个人脚下）
  const two = prep();
  const planTwo = chooseAI(two.game);
  assert.equal(planTwo?.type, 'darkgun');
  const foeTiles = [tileKey(two.game.tile(two.user)), tileKey(two.game.tile(two.stand))];
  assert.deepEqual(planTwo.tiles.map(tileKey).sort(), foeTiles.slice().sort(), '★ 两个敌人各标一格');

  // 丙）射程里**没有敌人** → 正确放弃（空地上提前埋不是 AI 的活）
  const none = prep();
  const outside = none.game.tiles.filter(t => hexDist(t, none.game.tile(none.emperor)) > SKILLS.darkgun.range && !none.game.occupant(t));
  place(none.stand, outside[0]);
  place(none.user, outside[1]);
  assert.equal(none.game.darkgunTiles(none.emperor).length > 0, true, '（前提）射程内还有格子可标');
  assert.equal(none.game.skillReason(none.emperor, 'darkgun'), '', '（前提）技能本身可用（不是被冷却挡住）');
  assert.notEqual(chooseAI(none.game)?.type, 'darkgun', '★ 射程里没有敌人 → 不埋空枪');

  // 丁）本回合已经用过 → 正确放弃
  const used = prep();
  used.game.s.cd.p1.darkgun = SKILLS.darkgun.cd;
  assert.match(used.game.skillReason(used.emperor, 'darkgun'), /冷却/);
  assert.notEqual(chooseAI(used.game)?.type, 'darkgun', '★ 本回合已用过 → 不再生成这一条');

  // 戊）多种子自动对局：能收敛出胜负（不卡死），而且电脑真的会用「暗枪」
  const fired = [];
  for (const seed of SEEDS) {
    const events = [];
    const game = new Game({ random: seeded(seed), onEvent: event => events.push(event) });
    assert.equal(game.start('emperor', 'polnareff', 'ai'), true);
    let guard = 0;
    while (game.s.phase === 'battle' && guard++ < 900) {
      const plan = chooseAI(game);
      if (!plan || !playAIAction(game, plan)) game.endTurn();
    }
    assert.ok(guard < 900, `★ seed ${seed}：这一场没打完（走了 ${guard} 步，说明 AI 卡住了）`);
    assert.equal(game.s.phase, 'result', `seed ${seed}：要分出胜负`);
    assert.ok(['p1', 'p2'].includes(game.s.winner), `seed ${seed}：胜负落在某一队上`);
    assert.equal(game.s.pendingSkill, null, `seed ${seed}：收场时不该留着埋到一半的暗枪`);
    fired.push(events.filter(e => e.type === 'skill' && e.skill === 'darkgun').length);
  }
  assert.equal(fired.every(n => n > 0), true, `★ 每一局电脑都会用「暗枪」（实际每局施放次数：${fired}）`);
});

// ===================== ⑥ 界面接线 =====================

test('⑥ 界面接线：状态标签 / 格子说明 / 棋盘上的紫色标记都与另两种预告分得开', async () => {
  const previous = globalThis.document, previousWindow = globalThis.window;
  const elements = new Map();
  const make = id => ({
    id, innerHTML: '', textContent: '', className: '', style: {}, dataset: {}, attributes: {},
    classList: { toggle() {}, add() {}, remove() {}, contains: () => false },
    setAttribute(k, v) { this.attributes[k] = String(v); }, getAttribute(k) { return this.attributes[k] ?? null; },
    hasAttribute(k) { return k in this.attributes; }, removeAttribute(k) { delete this.attributes[k]; },
    addEventListener() {}, removeEventListener() {}, focus() {}, blur() {}, closest: () => null,
    querySelector: () => make(`${id}-child`), querySelectorAll: () => [],
    insertAdjacentHTML(_, html) { this.innerHTML += html; },
    appendChild() {}, contains: () => true,
    getBoundingClientRect: () => ({ left: 0, top: 0, width: 100, height: 100, bottom: 100, right: 100 }),
  });
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
  globalThis.window = { devicePixelRatio: 1, addEventListener() {}, removeEventListener() {} };
  globalThis.document = {
    getElementById: id => { if (id === 'board') return canvas; if (!elements.has(id)) elements.set(id, make(id)); return elements.get(id); },
    querySelector: () => make('query'), querySelectorAll: () => [],
    createElement: () => ({ width: 0, height: 0, style: {}, getContext: () => ctx }),
    addEventListener() {}, removeEventListener() {}, activeElement: null, body: make('body'),
  };
  try {
    const { game, emperor, user, stand } = fixture();
    const me = game.tile(emperor);
    const tiles = game.darkgunTiles(emperor);
    const onEnemy = tiles.find(t => tileKey(t) === tileKey(game.tile(stand)));
    const empty = tiles.find(t => !game.occupant(t) && hexDist(t, me) === 2);
    assert.ok(onEnemy && empty, '（前提）要有"敌人站着的那一格"与"空格"各一');
    bury(game, emperor, [onEnemy, empty]);

    // ① 状态标签：埋枪方一栏写"标了几格 + 何时结算多少"；对面那一栏也要看得见（用户要的"能躲"）
    renderCards(game, { humanTurn: false });
    const p1Html = elements.get('sideP1').innerHTML;
    assert.match(p1Html, /暗枪已标记 2 格 · 对手回合结束时结算 8 点（计防御）/, '★ 埋枪方要一眼看出标了几格、何时结算');
    const p2Html = elements.get('sideP2').innerHTML;
    assert.match(p2Html, /对方的暗枪正指着这里的 2 格/, '★ 被指着的一方也要看得见');
    assert.match(p2Html, /回合结束时踩在上面受 8 点伤害（计防御/, '★ 数值取自数据');
    assert.match(p2Html, /挪开那一步就走掉了/, '★ 与「皇帝」的"挪开也躲不掉"说法必须分得清');

    // ② 格子说明：鼠标停在被标记的格子上要读出"这一格被埋了枪"
    const text = tileDescription(game, onEnemy);
    assert.match(text, /暗枪标记着这一格/, '★ 格子说明要能看出这一格被标记');
    assert.match(text, /对手回合结束时站在格上的敌方单位受到 8 点伤害/);
    assert.match(text, /计防御/);
    assert.match(text, /走开就没事/, '★ 与冷枪的"挪开就躲开"、皇帝的"挪开也躲不掉"三套说法各写各的');
    assert.equal(/挪开也躲不掉/.test(text), false);
    const plainText = tileDescription(game, empty);
    assert.match(plainText, /暗枪标记着这一格/, '空格上也要读得出来（它标的就是格子）');

    // ③ 棋盘：**暗紫**的地面层排在棋子之前、准星排在棋子之后；颜色与冷枪／皇帝都不撞
    const visual = new BoardVisual(game);
    assert.doesNotThrow(() => visual.render(game.actionView(), 0), '有暗枪标记的一帧不该抛错');
    const groundAt = calls.findIndex(c => c.prop === 'fillStyle' && c.args[0] === 'rgba(122,74,196,.28)');
    assert.ok(groundAt >= 0, '★ 被标记的格子要有自己的地面底色');
    const ringAt = calls.reduce((last, c, i) => (c.prop === 'strokeStyle' && /^rgba\(168,112,244/.test(String(c.args[0])) ? i : last), -1);
    assert.ok(ringAt >= 0, '★ 准星那一圈也要画出来');
    const unitAt = calls.map((c, i) => (c.prop === 'fillText' && /^(P1|P2)(·2)? · (主|替)$/.test(String(c.args[0])) ? i : -1));
    const firstUnit = unitAt.find(i => i >= 0), lastUnit = unitAt.reduce((a, b) => Math.max(a, b), -1);
    assert.ok(firstUnit >= 0, '棋子名字要画出来（对照用）');
    assert.ok(groundAt < firstUnit, '★ 暗紫底色压在棋子下面（不糊立绘）');
    assert.ok(ringAt > lastUnit, '★ 准星画在棋子之后（"哪一格埋着枪"一眼可见）');
    // ⚠️ 地面那一层（暗紫底色 + 落位点）也在棋子之前——两处用的是同一个色系，
    //    所以上面那条特意取**最后一次**出现的位置（准星那一层）。
    const labels = calls.filter(c => c.prop === 'fillText' && c.args[0] === '暗枪');
    assert.equal(labels.length, 2, '★ 两个被标记的格子各写一行「暗枪」');
    // 三套预告的底色互不相同（用户要求：一眼分得开）
    const grounds = ['rgba(214,54,64,.22)', 'rgba(200,162,74,.26)', 'rgba(122,74,196,.28)'];
    assert.equal(new Set(grounds).size, 3);
    assert.equal(grounds.includes('rgba(122,74,196,.28)'), true);
    const saves = calls.filter(c => c.prop === 'save').length, restores = calls.filter(c => c.prop === 'restore').length;
    assert.equal(saves, restores, 'save / restore 必须配平');
    // 有人站着的那一格：两个字挪到**右上角**（那一格下方是名字与血条、左上角留给「皇帝」）；
    // 没人站着的那一格：写在格子下缘 **+44**（冷枪那行在 +26、皇帝在 +35，三行错开才读得清）
    const onEnemyLabel = calls.find(c => c.prop === 'fillText' && c.args[0] === '暗枪'
      && Math.abs(c.args[1] - (onEnemy.cx + R - 11)) < .01);
    const emptyLabel = calls.find(c => c.prop === 'fillText' && c.args[0] === '暗枪' && Math.abs(c.args[1] - empty.cx) < .01);
    assert.ok(onEnemyLabel, '★ 有人站着的那一格：两个字挪到右上角（避开下面的名字牌）');
    assert.ok(onEnemyLabel.args[2] < onEnemy.cy, '★ 在棋子名字与血条**上方**（不糊立绘）');
    assert.ok(emptyLabel, '★ 空格上写在格子下缘');
    assert.equal(emptyLabel.args[2], empty.cy + 44, '与冷枪（+26）／皇帝（+35）那两行错开');

    // ④ 静态检查：三处接线各有一份实现，且都读引擎那份数据（不在界面里手写数值）
    const hud = fs.readFileSync(new URL('../src/ui/hud.js', import.meta.url), 'utf8');
    assert.match(hud, /function darkgunTags\(game, slot\)/, '状态标签要有独立的一处实现（照 emperorTags 的写法）');
    assert.match(hud, /\$\{darkgunTags\(game, slot\)\}/, '标签要真的挂进状态栏');
    assert.match(hud, /game\.darkgunMarks\?\.\(\)/, '格子说明要读引擎那份标记清单');
    assert.match(hud, /entry\.row === tile\.row && entry\.col === tile\.col/, '⚠️ 取值形状别照抄 emperorMarks（那一份是 entry.mark.row）');
    const render = fs.readFileSync(new URL('../src/ui/render.js', import.meta.url), 'utf8');
    assert.match(render, /drawDarkgunAim\(/, '地面那一层要有独立的一处实现（照 drawSniperAim／drawEmperorAim）');
    assert.match(render, /drawDarkgunCrosshair\(/, '准星要有独立的一处实现（照 drawSniperCrosshair）');
    assert.match(render, /drawDarkgunAim\(g, entry\.tile, time\)/, '标记清单要真的进渲染主循环');
    assert.match(render, /drawDarkgunCrosshair\(g, entry\.tile, time\)/, '准星也要真的进渲染主循环');
  } finally {
    if (previous === undefined) delete globalThis.document; else globalThis.document = previous;
    if (previousWindow === undefined) delete globalThis.window; else globalThis.window = previousWindow;
  }
});
