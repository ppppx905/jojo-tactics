/**
 * ★★ 霍尔·霍斯 & 皇帝（第八章阶段 1 的枪手）——**2026-10-03 用户拍板的"重做"**。
 *
 * 用户原话（数值全部由他定，**不许改**）：
 *   · **射程 4 → 5**（`FIGHTERS.emperor.user.range`）；
 *   · 新技能「瞄准」：**1 AP / CD 1 回合**（数据 `cd: 2`，口径见 rules.js 顶部）——
 *     **接下来两次"他造成的攻击"无视对手防御**（＝那两次走既有的 `pierce` 口径：
 *     基础防御、草丛、岩石、宝石柱一律不算）。**按次数记账**，每消耗一次减一，用光就没了；
 *     **只对他自己的攻击生效**，同队别人一点都沾不上。
 *   · 新技能「皇帝」：**1 AP / CD 1 回合 / 射程 5**，自己选一个**单位**为目标——
 *     **一回合之后**那个单位受到 **10 点伤害**（**按常规结算防御**，不是真实伤害）。
 *     锁的是"那个单位"（跟它走到哪没关系）；结算时目标已经倒下 → **静默跳过**。
 *   · 原有的「场边冷枪」（每 2 回合自动一枪、净伤 6 真实伤害、弹道预告、挪开能躲）**原样保留**，
 *     用户明确说"两者都留"——所以本文件里也有一条专门守它没被改坏。
 *
 * ⚠️ 这个文件是**新增**的，不改任何既有断言（既有文件里只有 `emperor.test.js` 那条
 *    "射程 4" 被这次重做直接推翻，已按新数值改掉，见那边的注释）。
 *    冷枪的完整回归仍在 `tests/sniper.test.js`，两阶段整体在 `tests/chapter8-phases.test.js`。
 *
 * ⚠️⚠️⚠️ **2026-10-03 第四条用户拍板**（阶段 1 改成"注定打不过"的剧情战）：这个文件里被它
 *    **直接推翻**的只有 ⑤ 里那一条 **"每一局他都该开「瞄准」"**——两件事同时成立：
 *      ① 这一场现在只剩 2–3 轮就收场（波波掉到一半就结束），他总共只出手四五次；
 *      ② 这一场给他**攻击 +4**（11 打 2 防的波波），AI 那套账里"先花一枪瞄准"已经是**亏的**
 *         （两次无视防御只换回 +4 左右，却先赔掉一次 9 点的机会）。
 *    所以那一句改成：**「皇帝」每局照旧用**（额外一记、躲不掉）＋ 用一处**摆好的局面**把
 *    "值得瞄的时候 AI 照样先瞄"钉死（机制是活的，不是坏了）。其余九条一个字没动。
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { Game, FIGHTERS, SKILLS, SNIPER, STORY_CHAPTERS, skillSetFor } from '../src/core/game.js';
import { hexDist, tileKey, CANVAS_W, CANVAS_H } from '../src/core/hex.js';
import { chooseAI, playAIAction } from '../src/core/ai.js';
import { BoardVisual } from '../src/ui/render.js';
import { tileDescription } from '../src/ui/hud.js';

function seeded(seed = 13) { return () => ((seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0) / 4294967296); }
const chapter8 = STORY_CHAPTERS.find(c => c.id === 'chapter-8');
/** 阶段 1（波鲁纳雷夫 单挑 皇帝）——**按阵容认**，不写死下标。 */
const phase1 = chapter8.scenes.find(scene => scene.kind === 'battle' && scene.lineup?.enemy === 'emperor');
const SEEDS = [13, 7919, 9421, 20261003, 555];

/**
 * 自由对局夹具：**p1＝皇帝、p2＝波鲁纳雷夫**（这样两个技能的持有者永远在 p1，写起来最直白）。
 * ⚠️ 开局后**清空地形**、再把棋子摆到固定格子上：草丛（+3）／邻石（+1）会把"防御有多少"
 *    这个对照量搅乱，而这一整份测试全靠"防御到底算不算"来判断。
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
/** 走完整整一轮（1v1 两个槽位各交一次回合）——延迟伤害的结算是挂在**轮末**的。 */
function playRound(game, rounds = 1) {
  for (let r = 0; r < rounds && game.s.phase === 'battle'; r++) {
    for (let i = 0; i < game.s.slots.length && game.s.phase === 'battle'; i++) game.endTurn();
  }
}
/** 找一个"离 `from` 正好 `dist` 格"的空地（测试里造射程边界用）。 */
const spotAt = (game, from, dist) => game.tiles.find(t =>
  hexDist(t, from) === dist && !game.occupant(t) && !game.isRock(t) && !game.pillarAt(t));
/** 按某一幕的阵容开一局（＝ main.js 里 startStoryMatch + startMatch 那一套的等价写法）。 */
function openStage(scene, { seed = 13, events = null } = {}) {
  const game = new Game({ random: seeded(seed), onEvent: event => events?.push(event) });
  game.setRoster({ p1b: scene.lineup.ally || null, p2b: scene.lineup.enemy2 || null, story: true, scene });
  assert.equal(game.start(scene.lineup.player, scene.lineup.enemy, 'ai', { story: chapter8.id }), true);
  return game;
}
const hitTexts = (events, word) => events.filter(e => e.type === 'hit' && new RegExp(word).test(e.text || '')).map(e => e.text);

// ===================== ① 射程与技能表 =====================

test('① 射程确实是 5（数据、棋子、普攻与「皇帝」的射程判定三处一致）', () => {
  assert.equal(FIGHTERS.emperor.user.range, 5, '★ 用户拍板：射程 4 → 5（数值不许改）');
  assert.deepEqual([FIGHTERS.emperor.user.move, FIGHTERS.emperor.user.dmg], [2, 7], '移动 2 与攻击 7 一个字没动');
  assert.equal(FIGHTERS.emperor.user.sniper, true, '★ 冷枪旗标照旧（两者都留）');
  // ⚠️⚠️ 2026-10-05 用户拍板加了第三个技能「暗枪」（`SKILLS.darkgun`）之后，**这一条被直接推翻**：
  //    他的技能表从两个变三个。除这个数组以外，本条别的断言一个字都没动；
  //    「暗枪」自己的条目与判据在 `tests/darkgun.test.js` ①。
  // ⚠️⚠️ 同一天用户又拍板第二条：**「皇帝」与「暗枪」换位置**（`['aim','emperor','darkgun']`
  //    → `['aim','darkgun','emperor']`），于是「皇帝」成了他的第三个技能（会播大招插画）。
  //    再次只改这一个数组，其余断言照旧；机制与数值一个字没动。
  assert.deepEqual(skillSetFor('emperor'), ['aim', 'darkgun', 'emperor'], '★ 他的技能表就是这三个，顺序也是用户定的');
  assert.equal(SKILLS.emperor.range, 5, '「皇帝」的射程同为用户定的 5');
  const { game, emperor, stand } = fixture();
  assert.equal(emperor.range, 5, '棋子上的射程取自角色数据');
  // 普攻：第 5 格打得到、第 6 格打不到
  Object.assign(emperor, spotAt(game, game.tile(stand), 5));
  assert.equal(game.attackReason(emperor, stand), '', '距离 5：够得着');
  assert.equal(game.emperorReason(emperor, stand), '', '距离 5：也锁得住');
  assert.equal(game.preview(emperor, stand).damage > 0, true);
  Object.assign(emperor, spotAt(game, game.tile(stand), 6));
  assert.match(game.attackReason(emperor, stand), /射程/, '距离 6：普攻够不着');
  assert.match(game.emperorReason(emperor, stand), /射程/, '距离 6：「皇帝」也锁不上');
});

// ===================== ② 瞄准 =====================

test('② 「瞄准」：花 1 AP、进 CD，接下来两次攻击无视防御，第三次恢复原样', () => {
  const events = [];
  const { game, emperor, stand } = fixture({ gap: 4, events });
  // 对照量：目标本来就有一层明确可算的防御（基础 2 + 替身加成 2）
  const defense = game.defense(stand).total;
  assert.ok(defense >= 3, `（前提）这个目标平时有 ${defense} 点防御，才看得出"无视"`);
  const plain = game.preview(emperor, stand);
  assert.equal(plain.defense.total, defense, '没瞄准的时候照常算防御');
  assert.equal(plain.damage, Math.max(1, game.unitAttack(emperor) - defense));

  // ① 施放：1 AP、进 CD（用户口径的 CD 1 回合＝数据里的 cd: 2）、账上记 2 次
  assert.equal(game.beginSkill(emperor, 'aim'), true, '瞄准不需要选目标，点了就生效');
  assert.equal(SKILLS.aim.cost, 1);
  assert.equal(SKILLS.aim.cd, 2, '★ 用户说的「CD 1 回合」落到数据里就是 cd: 2（见 rules.js 顶部口径）');
  assert.equal(game.s.ap.p1, 2, '花掉 1 AP');
  assert.equal(game.s.cd.p1.aim, SKILLS.aim.cd, '进冷却');
  assert.equal(game.s.aimCharges.p1, SKILLS.aim.charges, '★ 按次数记账：先记满 2 次');
  assert.equal(SKILLS.aim.charges, 2, '用户定：接下来两次攻击无视防御');

  // ② 第一枪：预览里防御归零，实际扣满额
  const pierced = game.preview(emperor, stand);
  assert.equal(pierced.defense.total, 0, '★ 瞄准期间预览的防御必须是 0（基础／替身／地形／柱子全不算）');
  assert.equal(pierced.damage, game.unitAttack(emperor), '★ 扣满额');
  const hp0 = game.s.hp.p2;
  assert.equal(game.attack(emperor, stand), true);
  assert.equal(game.s.hp.p2, hp0 - pierced.damage, '这一枪真的无视了防御');
  assert.equal(game.s.aimCharges.p1, 1, '用掉一次');
  assert.equal(game.s.cd.p1.aim, SKILLS.aim.cd, '打人不影响冷却计数');

  // ③ 第二枪照样无视防御（次数还剩 1）
  game.s.ap.p1 = 3;
  assert.equal(game.preview(emperor, stand).defense.total, 0);
  const hp1 = game.s.hp.p2;
  assert.equal(game.attack(emperor, stand), true);
  assert.equal(game.s.hp.p2, hp1 - pierced.damage, '第二次照样扣满额');
  assert.equal(game.s.aimCharges.p1, 0, '★ 两次用光就没了');

  // ④ 第三次恢复原样：照常结算防御
  game.s.ap.p1 = 3;
  const back = game.preview(emperor, stand);
  assert.equal(back.defense.total, defense, '★ 次数用光后防御照常算');
  assert.ok(back.damage < pierced.damage, '★ 伤害确实回到了"减去防御"那个数');
  const hp2 = game.s.hp.p2;
  assert.equal(game.attack(emperor, stand), true);
  assert.equal(game.s.hp.p2, hp2 - back.damage);

  // ⑤ 日志要能看出"这一击无视了防御 / 还剩几次"
  const said = events.map(e => e.text || '').join('|');
  assert.match(said, /瞄准/);
  assert.match(said, /这一击无视对手防御（还剩 1 次）/, '★ 每消耗一次都要报出来');
  assert.match(said, /瞄准已用完/, '用光也要说一声');

  // ⑥ 打空不消耗次数：被扬沙迷眼的那一击不算"打出去"
  const blind = fixture({ gap: 4 });
  blind.game.beginSkill(blind.emperor, 'aim');
  blind.game.s.sandBlind.p1 = 'p2';                  // 强制：他这一击打空
  const blindGame = blind.game;
  blindGame.random = () => 0;                        // random 恒为 0 → 必定落进"打空"分支
  blindGame.s.ap.p1 = 3;
  const blindHp = blindGame.s.hp.p2;
  assert.equal(blindGame.attack(blind.emperor, blind.stand), true);
  assert.equal(blindGame.s.hp.p2, blindHp, '（前提）这一击打空了');
  assert.equal(blindGame.s.aimCharges.p1, 2, '★ 打空不算一次，次数照旧');
});

// ===================== ③ 皇帝 =====================

test('③ 「皇帝」：花 1 AP、进 CD、射程 5 内锁一个单位 → 一回合后 10 点伤害（计防御）', () => {
  const events = [];
  const { game, emperor, stand } = fixture({ gap: 4, events });
  assert.equal(game.s.emperorMark.p2, null, '开局没有锁定');
  const defense = game.defense(stand).total;
  assert.ok(defense > 0, `（前提）目标有 ${defense} 点防御，"按常规结算防御"才看得出来`);

  // ① 施放：1 AP、进 CD、锁定记在**目标槽位**上
  assert.equal(game.select(emperor.id), true);
  assert.equal(game.beginSkill(emperor, 'emperor'), true);
  assert.equal(game.s.pendingSkill, 'emperor', '这是个"自己选一个单位"的技能');
  // ★ 界面上就是"点那枚棋子"：main.js 的棋盘点击走的正是 `actionAt`（真人玩家那条路）
  const empty = { row: emperor.row, col: emperor.col + 1 };
  assert.equal(game.actionAt(game.at(empty.row, empty.col)), false, '点了空格：给一句提示、不扣 AP');
  assert.equal(game.s.ap.p1, 3, '选错目标不消耗行动点');
  assert.equal(game.s.pendingSkill, 'emperor', '也没退出瞄准状态（可以直接再点一次）');
  assert.equal(game.actionAt(game.tile(stand)), true, '★ 点中那枚棋子＝锁定它');
  assert.equal(SKILLS.emperor.cost, 1);
  assert.equal(game.s.ap.p1, 2, '花掉 1 AP');
  assert.equal(game.s.cd.p1.emperor, SKILLS.emperor.cd, '进冷却（数据 cd:2 ＝ 用户口径 CD 1 回合）');
  const mark = game.s.emperorMark.p2;
  assert.ok(mark, '★ 锁定记在目标槽位上');
  assert.equal(mark.unitId, stand.id, '★ 锁的是"那个单位"，不是格子');
  assert.equal(mark.round, 1, '记着"是哪一轮锁的"（结算口径靠它）');
  assert.equal(game.s.pendingSkill, null, '选完目标就收手');
  assert.equal(game.emperorMarks().length, 1, '界面/渲染读的那份清单也拿得到');
  assert.match(events.map(e => e.text || '').join('|'), /皇帝锁定中/, '要报一句"锁定中"');

  // ①′ 目标挪开也躲不掉（锁的是单位，不是格子）
  Object.assign(stand, spotAt(game, game.tile(emperor), 6));
  assert.ok(hexDist(game.tile(stand), game.tile(emperor)) > SKILLS.emperor.range, '（前提）它已经跑到射程外了');

  // ② 施放那一轮结束**不算**：走完一轮，血一点没掉
  const hp0 = game.s.hp.p2;
  playRound(game);
  assert.equal(game.s.hp.p2, hp0, '★ "一回合之后"＝**下一轮**结束才结算，施放那一轮不算');
  assert.ok(game.s.emperorMark.p2, '锁定还挂着');

  // ③ 再走完一轮 → 结算：10 点减去**结算那一刻**的防御
  const expected = Math.max(1, SKILLS.emperor.dmg - game.defense(stand).total);
  playRound(game);
  assert.equal(game.s.hp.p2, hp0 - expected, `★ 一回合后受到 ${SKILLS.emperor.dmg} 点**减去防御**＝${expected}`);
  assert.ok(expected < SKILLS.emperor.dmg, '★ 它不是真实伤害：防御真的减掉了');
  assert.equal(game.s.emperorMark.p2, null, '★ 结算完要把锁定清掉（否则界面会留着一条假弹道）');
  assert.equal(game.emperorMarks().length, 0);
  assert.deepEqual(hitTexts(events, '皇帝'), [`皇帝 → ${stand.name} · −${expected} HP`], '开火只结算一次、写进日志');
});

test('③ 边界：「皇帝」只能锁单位（宝石柱不行／自己人不行／倒下的不行），目标提前倒下则静默跳过', () => {
  const { game, emperor, stand, user } = fixture({ gap: 4 });
  // ① 目标合法性
  game.s.pillars.push({ id: 'test-pillar', kind: 'pillar', side: 'p2', name: '绿宝石柱', row: user.row, col: user.col, hp: 10, maxHp: 10 });
  const pillar = game.s.pillars.at(-1);
  assert.match(game.emperorReason(emperor, pillar), /宝石柱/, '★ 宝石柱不是"单位"');
  assert.match(game.emperorReason(emperor, emperor), /己方/, '不能锁自己人');
  game.s.hp.p2 = 0;
  assert.match(game.emperorReason(emperor, stand), /倒下/, '已经倒下的角色不能锁');
  game.s.hp.p2 = FIGHTERS.polnareff.hp;
  assert.equal(game.emperorReason(emperor, stand), '', '合法目标：通过');
  assert.match(game.emperorReason(emperor, null), /选择/, '没点目标时给一句提示，而不是抛错');

  // ② 目标在结算前倒下 → 静默跳过（不扣血、不留日志）
  //    ⚠️ 1v1 里"被锁的那一方倒下"这一局就直接结束了，所以这里用**2v2**（一方两个角色）：
  //       倒下的只是被锁的那一个角色、这一局还在打——正是"静默跳过"要覆盖的那种局面。
  const silent = new Game({ random: seeded(13) });
  silent.setRoster({ p1b: 'polnareff', p2b: 'kakyoin' });
  assert.equal(silent.start('emperor', 'dio', 'ai'), true);
  silent.s.terrain = {};
  const gun = silent.s.units.find(u => u.slot === 'p1' && u.kind === 'user');
  const locked = silent.s.units.find(u => u.slot === 'p2' && u.kind === 'user');
  Object.assign(gun, { row: 5, col: 2 });
  Object.assign(locked, { row: 5, col: 5 });
  silent.s.turn = 'p1';
  silent.s.ap.p1 = 3;
  assert.equal(silent.select(gun.id), true);
  assert.equal(silent.beginSkill(gun, 'emperor'), true);
  assert.equal(silent.emperorLock(locked), true);
  silent.s.hp.p2 = 0;                       // 结算之前，被锁的那个角色先倒了（同队还有人活着）
  const events = [];
  silent.onEvent = event => events.push(event);
  const before = silent.s.log.length;
  for (let i = 0; i < 12 && silent.s.phase === 'battle'; i++) silent.endTurn();
  assert.equal(silent.s.emperorMark.p2, null, '锁定照样清掉');
  assert.equal(silent.s.hp.p2, 0, '★ 不会把血扣成负数、也不会重复结算');
  const after = silent.s.log.slice(before);
  assert.equal(after.some(e => e.type === 'hit'), false, '★ 静默：一条命中日志都不留');
  assert.equal(events.some(e => e.type === 'hit'), false);
  assert.equal(silent.s.phase, 'battle', '（前提）这一局还在打：倒的只是两个角色里的一个');
});

test('③ CD 与重复施放的口径：下个自己回合放不了，隔一个回合才能再放；重复锁定只留最后一次', () => {
  const { game, emperor, user, stand } = fixture({ gap: 4 });
  game.select(emperor.id);
  assert.equal(game.beginSkill(emperor, 'emperor'), true);
  assert.equal(game.emperorLock(stand), true);
  assert.equal(game.skillReason(emperor, 'emperor'), '冷却 2 个己方回合', '★ 用完之后立刻进冷却');
  assert.equal(game.beginSkill(emperor, 'emperor'), false, '冷却期间放不了（会留一条提示）');
  game.s.ap.p1 = 3;
  playRound(game);                                        // 他的**下一个**自己回合：cd 2 → 1
  assert.equal(game.s.cd.p1.emperor, 1);
  assert.equal(game.skillReason(emperor, 'emperor'), '冷却 1 个己方回合', '★ 隔的那个回合还是放不了');
  game.s.ap.p1 = 3;
  playRound(game);                                        // 再隔一个回合：cd → 0
  assert.equal(game.s.cd.p1.emperor, 0);
  assert.equal(game.skillReason(emperor, 'emperor'), '', '★ 隔一个回合后就能再放');

  // 重复施放：同一个目标槽位只留最后一次（刷新），绝不叠成两次伤害
  game.s.ap.p1 = 3;
  game.select(emperor.id);
  assert.equal(game.beginSkill(emperor, 'emperor'), true);
  assert.equal(game.emperorLock(user), true, '这次改锁本体');
  assert.equal(game.s.emperorMark.p2.unitId, user.id, '★ 换成了本体');
  assert.equal(game.emperorMarks().length, 1, '★ 一个槽位只有一条锁定（不会叠两条）');
  const events = [];
  game.onEvent = event => events.push(event);
  const hp0 = game.s.hp.p2;
  playRound(game);                                        // 锁定的那一轮：不算
  const expected = Math.max(1, SKILLS.emperor.dmg - game.defense(user).total);
  playRound(game);                                        // 一回合之后：结算
  assert.equal(game.s.hp.p2, hp0 - expected, '★ 只结算一次（重复施放不会双倍）');
  assert.equal(hitTexts(events, '皇帝').length, 1);
});

test('③ 与「瞄准」互不干扰：皇帝那一下**不吃**瞄准的无视防御，也不消耗次数', () => {
  const { game, emperor, stand } = fixture({ gap: 4 });
  game.beginSkill(emperor, 'aim');                        // 先开着瞄（还剩 2 次）
  assert.equal(game.s.aimCharges.p1, 2);
  game.select(emperor.id);
  game.beginSkill(emperor, 'emperor');
  assert.equal(game.emperorLock(stand), true);
  const defense = game.defense(stand).total;
  assert.equal(game.s.aimCharges.p1, 2, '★ 锁定不是"攻击"，不消耗瞄准的次数');
  assert.equal(game.preview(emperor, stand, 'emperor').defense.total, defense,
    '★ 即使正开着瞄准，「皇帝」的预览也照常算防御（用户定：皇帝按常规结算防御）');
  const hp0 = game.s.hp.p2;
  playRound(game, 2);
  assert.equal(game.s.hp.p2, hp0 - Math.max(1, SKILLS.emperor.dmg - defense), '落下来的伤害照样减防御');
  assert.equal(game.s.aimCharges.p1, 2, '结算那一下也不消耗次数');
});

// ===================== ④ 冷枪照旧 =====================

test('④ 场边冷枪照旧：每 2 回合开一枪、净伤 6 真实伤害，两个新技能一根汗毛都没动它', () => {
  const events = [];
  const game = openStage(phase1, { events });
  assert.equal(game.sniperRule(), SNIPER, '★ 冷枪仍然只在阶段 1 生效');
  assert.equal(game.s.units.find(u => u.slot === 'p2').range, 5, '（顺便）他的射程已经是 5 了');
  assert.equal(game.s.shotAim, null);
  game.s.aimCharges.p2 = 2;                               // 人为让他"开着瞄准"，看冷枪会不会动这个账
  playRound(game);
  const aim = game.s.shotAim;
  assert.ok(aim, '★ 第 1 轮结束照旧把弹道画出来');
  const victim = game.s.units.find(u => u.row === aim.row && u.col === aim.col);
  const defense = game.defense(victim).total;
  const hp0 = game.s.hp[victim.slot];
  playRound(game);
  assert.equal(game.s.shots, 1, '第 2 轮结束开火');
  assert.equal(game.s.shotAim, null, '弹道清掉');
  assert.equal(game.s.hp[victim.slot], hp0 - SNIPER.dmg, `★ 净伤 ${SNIPER.dmg} 点真实伤害：防御 ${defense} 一点都不减`);
  assert.equal(game.s.aimCharges.p2, 2, '★ 冷枪不消耗「瞄准」的次数（两条路互不影响）');
  assert.ok(events.some(e => e.type === 'hit' && /场边冷枪/.test(e.text || '')));
});

// ===================== ⑤ 阶段 1 的 AI =====================

test('⑤ 阶段 1 里 AI 真的会用这两个技能，而且这一场能打完（多种子、不许卡死）', () => {
  const usage = [];
  for (const seed of SEEDS) {
    const events = [];
    const game = openStage(phase1, { seed, events });
    let guard = 0;
    while (game.s.phase === 'battle' && guard++ < 900) {
      const plan = chooseAI(game);
      if (!plan || !playAIAction(game, plan)) game.endTurn();
    }
    const tag = `seed ${seed}`;
    assert.ok(guard < 900, `★ ${tag}：这一场没打完（走了 ${guard} 步，说明 AI 卡住了）`);
    assert.equal(game.s.phase, 'result', `${tag}：要分出胜负`);
    assert.ok(['p1', 'p2'].includes(game.s.winner), `${tag}：胜负落在某一队上`);
    const skills = events.filter(e => e.type === 'skill').map(e => e.skill);
    usage.push({ seed, aim: skills.includes('aim'), emperor: skills.includes('emperor'),
      aimTimes: skills.filter(k => k === 'aim').length, emperorTimes: skills.filter(k => k === 'emperor').length,
      // 记账自洽：瞄准已经用掉的次数 + 还剩的次数 ≤ 每次施放的 2 次（不会凭空多出来）
      charges: game.s.aimCharges.p2, marks: game.emperorMarks().length });
  }
  // ★★★ 2026-10-03 第四条改版（这一条断言被它**直接推翻**）：阶段 1 现在是**必败剧情战**——
  //   波波掉到一半就收场，这一场只剩 2–3 轮、他总共只出手四五次；再加上这一场给他**攻击 +4**
  //   （11 攻打 2 防的波波，"先瞄一枪"在 AI 那套账里已经是**亏的**：花掉一次 9 点的机会只换回 +4）。
  //   所以"每一局都必须开「瞄准」"不再成立——**机制没坏，是 AI 算得对**：改成
  //     · 「皇帝」（额外一记、躲不掉）每一局都照旧用；
  //     · 「瞄准」在**值得瞄的局面**里照样会被 AI 选中（下面那一段用摆好的局面钉死）。
  assert.equal(usage.every(u => u.emperor), true, `★ 每一局他都该用「皇帝」锁定（实际：${usage.map(u => u.emperor)}）`);
  assert.equal(usage.every(u => u.charges <= 2 * u.aimTimes), true, '瞄准的次数绝不会超过"施放次数 × 2"');
  assert.equal(usage.every(u => u.marks <= 1), true, '一个目标槽位最多一条锁定');
  // 「瞄准」这一条：摆一个**值得瞄**的局面（波波的替身就在射程里、防御 4 点厚）——
  // 这时 AI 必须把它排在最前面（分数 16 + 4×8 = 48，压过普攻那一档）。
  const probe = openStage(phase1, { seed: 13 });
  probe.s.turn = 'p2';
  const gunner = probe.s.units.find(u => u.slot === 'p2');
  // ★★ 2026-10-05 棋盘 14×11 → 18×13 之后，这一场开局两人相距 **7 格**（旧棋盘 5 格），
  //    而他的射程是 5 —— 开局摆不出"射程里有个厚目标"这个前提。这里照旧**把局面摆出来**
  //    （原意就是"波波的替身在他射程里、防御够厚"），下面几条断言一个字都没改。
  const aimTarget = probe.s.units.find(u => u.slot === 'p1' && u.kind === 'stand');
  const inRange = probe.tiles.find(t => hexDist(t, probe.tile(aimTarget)) === 4 && !probe.occupant(t));
  Object.assign(gunner, { row: inRange.row, col: inRange.col });
  const thickest = Math.max(...probe.targets(gunner, gunner.range)
    .filter(t => t.kind !== 'pillar' && !probe.attackReason(gunner, t))
    .map(t => probe.defense(t).total));
  assert.ok(thickest >= 4, `（前提）射程里要有够厚的目标才值得瞄（实际 ${thickest}）`);
  const aimPlan = chooseAI(probe);
  assert.equal(aimPlan?.skill, 'aim', '★ 值得瞄的时候 AI 会先开「瞄准」（机制在 AI 手里是活的）');
  assert.equal(playAIAction(probe, aimPlan), true);
  assert.equal(probe.s.aimCharges.p2, 2, '开了就是两次「无视防御」');
});

// ===================== ⑥ 别的角色不受影响 =====================

test('⑥ 别的角色完全不受影响：没有 aimCharges / 锁定 / 无视防御的意外串场', () => {
  for (const fighter of Object.values(FIGHTERS)) {
    if (fighter.key === 'emperor') continue;
    assert.equal(skillSetFor(fighter.key).includes('aim'), false, `${fighter.key} 不该有「瞄准」`);
    assert.equal(skillSetFor(fighter.key).includes('emperor'), false, `${fighter.key} 不该有「皇帝」`);
  }
  for (const [a, b] of [['jotaro', 'dio'], ['iggy', 'gray_fly'], ['joseph', 'polnareff']]) {
    const game = new Game({ random: seeded(13) });
    assert.equal(game.start(a, b, 'ai'), true);
    assert.deepEqual(game.s.aimCharges, { p1: 0, p2: 0 }, `${a} vs ${b}：账本是空的`);
    assert.deepEqual(game.s.emperorMark, { p1: null, p2: null });
    assert.equal(game.emperorMarks().length, 0);
    const mine = game.s.units.find(u => u.slot === 'p1' && u.kind === (FIGHTERS[a].stand ? 'stand' : 'user'));
    assert.equal(game.skillReason(mine, 'aim'), '该技能不属于当前角色。');
    assert.equal(game.skillReason(mine, 'emperor'), '该技能不属于当前角色。');
    // 他们打人照常算防御（"无视防御"只长在皇帝那个槽位的那两次攻击上）
    for (const foe of game.s.units.filter(u => u.slot === 'p2')) {
      const pv = game.preview(mine, foe);
      assert.equal(pv.defense.total, game.defense(foe).total, `${a} 打 ${foe.name}：防御照常算`);
    }
    for (let i = 0; i < 8; i++) game.endTurn();           // 跑几轮也不会冒出锁定
    assert.equal(game.emperorMarks().length, 0);
    assert.deepEqual(game.s.aimCharges, { p1: 0, p2: 0 });
  }
  // 2v2（第八章阶段 2 那种三个槽位）：同队另一个角色的账本同样是干净的
  const phase2 = chapter8.scenes.find(scene => scene.kind === 'battle' && scene.lineup?.enemy === 'geil');
  const two = openStage(phase2);
  assert.deepEqual(two.s.aimCharges, { p1: 0, p1b: 0, p2: 0 });
  assert.deepEqual(two.s.emperorMark, { p1: null, p1b: null, p2: null });
  two.s.turn = 'p1b';                                     // 轮到电脑友军时问它：技能不属于它
  assert.equal(two.skillReason(two.s.units.find(u => u.slot === 'p1b'), 'aim'), '该技能不属于当前角色。');
  two.s.turn = 'p1';
  // 皇帝在 2v2 里也只影响自己那一个槽位：给 p2 记上次数，p1/p1b 的预览照样算防御
  two.s.aimCharges.p2 = 2;
  const p1Unit = two.s.units.find(u => u.slot === 'p1' && u.kind === 'stand');
  const p2Unit = two.s.units.find(u => u.slot === 'p2' && u.kind === 'user');
  Object.assign(p1Unit, { row: p2Unit.row, col: p2Unit.col - 1 });
  assert.equal(two.preview(p1Unit, p2Unit).defense.total, two.defense(p2Unit).total, '★ 别的角色照常算防御');
});

// ===================== ⑦ 界面接线 =====================

test('⑦ 界面接线：状态标签、格子说明与棋盘上的「皇帝」准星都挂上了', async () => {
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
    const { renderCards } = await import('../src/ui/hud.js');
    const { game, emperor, stand } = fixture({ gap: 4 });
    // ① 「瞄准」剩下的次数：挂在他自己那一栏（用户要的是"界面能看出来"）
    game.beginSkill(emperor, 'aim');
    renderCards(game, { humanTurn: false });
    assert.match(elements.get('sideP1').innerHTML, /瞄准 · 剩余 2 次无视防御/, '★ 剩余次数要写出来');
    game.s.ap.p1 = 3;
    game.attack(emperor, stand);
    renderCards(game, { humanTurn: false });
    assert.match(elements.get('sideP1').innerHTML, /瞄准 · 剩余 1 次无视防御/, '★ 用掉一次就跟着变');
    // ② 「皇帝」锁定：挂在**被锁定那一方**的栏上
    game.s.ap.p1 = 3;
    game.select(emperor.id);
    game.beginSkill(emperor, 'emperor');
    game.emperorLock(stand);
    renderCards(game, { humanTurn: false });
    const p2Html = elements.get('sideP2').innerHTML;
    assert.match(p2Html, /「皇帝」锁定中/, '★ 被锁定的一方要看到锁定标签');
    assert.match(p2Html, /一回合后受到 \d+ 点伤害（计防御 · 躲不掉）/, '★ 写清是延迟伤害、计防御、躲不掉');
    // ③ 格子说明：鼠标停在被锁定的那一格就要读出"这里被皇帝锁着"
    const text = tileDescription(game, game.tile(stand));
    assert.match(text, /皇帝/);
    assert.match(text, /一回合后受到 \d+ 点伤害/);
    assert.match(text, /挪开也躲不掉/, '★ 与冷枪"挪开就躲开"的说法必须分得清楚');
    assert.match(text, /计防御/);
    // ④ 棋盘：从枪手到被锁定单位的弹道虚线 + 「皇帝」准星（排在棋子之后）
    const visual = new BoardVisual(game);
    assert.doesNotThrow(() => visual.render(game.actionView(), 0), '有锁定的一帧不该抛错');
    const labels = calls.filter(c => c.prop === 'fillText').map(c => c.args[0]);
    assert.ok(labels.includes('皇帝'), '★ 被锁定的那一格要写上「皇帝」（锁的是一定有人的格子，所以这两个字始终要写）');
    const dashed = calls.filter(c => c.prop === 'setLineDash' && c.args[0]?.length === 2);
    assert.ok(dashed.length >= 2, '弹道与准星都要用虚线');
    const groundAt = calls.findIndex(c => c.prop === 'fillStyle' && c.args[0] === 'rgba(200,162,74,.26)');
    const unitAt = calls.map((c, i) => (c.prop === 'fillText' && /^(P1|P2)(·2)? · (主|替)$/.test(String(c.args[0])) ? i : -1));
    const firstUnit = unitAt.find(i => i >= 0), lastUnit = unitAt.reduce((a, b) => Math.max(a, b), -1);
    const crossAt = calls.findIndex(c => c.prop === 'strokeStyle' && /^rgba\(240,196,96/.test(String(c.args[0])));
    assert.ok(groundAt >= 0 && firstUnit >= 0, '警戒底色与棋子都要真的画出来');
    assert.ok(groundAt < firstUnit, '★ 金色警戒底色压在棋子下面（不糊立绘）');
    assert.ok(crossAt > lastUnit, '★ 准星画在棋子之后（"谁被锁着"一眼可见）');
    // 准星那两个字的位置：格子上有人时挪到左上角，别压住棋子下缘的名字与血条
    const nameAt = calls.findIndex(c => c.prop === 'fillText' && /^(P1|P2)(·2)? · (主|替)$/.test(String(c.args[0])));
    const emperorCall = calls.find(c => c.prop === 'fillText' && c.args[0] === '皇帝');
    assert.ok(emperorCall.args[2] < calls[nameAt].args[2] - 10, '★「皇帝」两个字在棋子名字牌**上方**（不糊名字与血条）');
    const saves = calls.filter(c => c.prop === 'save').length, restores = calls.filter(c => c.prop === 'restore').length;
    assert.equal(saves, restores, 'save / restore 必须配平');
    // ⑤ 静态检查：技能按钮/说明接的是数据，不在 hud 里手写数值
    const hud = fs.readFileSync(new URL('../src/ui/hud.js', import.meta.url), 'utf8');
    assert.match(hud, /function emperorTags\(game, slot\)/, '状态标签要有独立的一处实现（照 sniperTags 的写法）');
    assert.match(hud, /\$\{emperorTags\(game, slot\)\}/, '标签要真的挂进状态栏');
    assert.match(hud, /game\.emperorMarks\?\.\(\)/, '格子说明要读引擎那份锁定清单');
    const render = fs.readFileSync(new URL('../src/ui/render.js', import.meta.url), 'utf8');
    assert.match(render, /drawEmperorAim\(/, '弹道虚线要有独立的一处实现（照 drawSniperAim）');
    assert.match(render, /drawEmperorCrosshair\(/, '准星要有独立的一处实现（照 drawSniperCrosshair）');
  } finally {
    if (previous === undefined) delete globalThis.document; else globalThis.document = previous;
    if (previousWindow === undefined) delete globalThis.window; else globalThis.window = previousWindow;
  }
});
