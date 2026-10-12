/**
 * ★★ 角色被打倒 → **棋子离场、让出格子**（2026-10-04 用户报的 bug）。
 *
 * 用户原话：「双人对战死了会占位置」。现象：2v2 里一个角色被打倒之后，他那两枚棋子还留在棋盘上
 * （只是被画成压暗的"尸体"），于是**继续挡路**——别的棋子走不过去、也落不上去；1v1 时因为这一局
 * 立刻结束，看不出来。这是当初 2v2 上线时**记在案的取舍**（"尸体留在棋盘、仍挡路"），用户现在
 * 要求改掉：**该槽位共享生命归零 → 把他这一场的棋子从棋盘上移除**。
 *
 * 口径（实现见 `Game.removeFallenSlot`，调用点在 `damage()` 里、`checkEnd()` 之前）：
 *   · 只拿掉**这个槽位自己的**棋子（本体 ＋ 替身；单单位角色只有一枚）；
 *   · 对手的棋子、宝石柱、火焰、反光点、船体要害**一概不动**；
 *   · 让出格子之后，通行／落子／连携距离全都跟着对——判据本来就全读 `occupant()`；
 *   · **先移除、再判胜负**：1v1 判负时"该结束就结束"，结束的时机与结果一个字没变。
 *
 * 这个文件是**新增**的，不改任何既有断言（既有测试在改动后 370 条全绿）。
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { Game, FIGHTERS, STORY_CHAPTERS, MIRRORS } from '../src/core/game.js';
import { tileKey, hexDist } from '../src/core/hex.js';
import { chooseAI, playAIAction } from '../src/core/ai.js';

function seeded(seed = 42) { return () => ((seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0) / 4294967296); }
const chapter8 = STORY_CHAPTERS.find(c => c.id === 'chapter-8');
/** 阶段 2＝波鲁纳雷夫 ＋ 电脑友军花京院 对 J·凯尔 & 吊死者——**按阵容认**，不写死下标。 */
const phase2 = chapter8.scenes.find(scene => scene.kind === 'battle' && scene.lineup?.enemy === 'geil');
const phase1 = chapter8.scenes.find(scene => scene.kind === 'battle' && scene.lineup?.enemy === 'emperor');

/** 开一局 2v2（每方第二个角色由 roster 登记），地形清空，免得随机岩石挡住走位。 */
function duo(a = 'jotaro', b = 'dio', ab = 'kakyoin', bb = 'iggy') {
  const game = new Game({ random: seeded(2026) });
  game.setRoster({ p1b: ab, p2b: bb });
  game.start(a, b);
  game.s.terrain = {};
  return game;
}
/** 开阶段 2 那一场（反光点已撒好、吊死者已站在点上）。 */
function openPhase2(seed = 13) {
  const game = new Game({ random: seeded(seed) });
  game.setRoster({ p1b: phase2.lineup.ally, story: true, scene: phase2 });
  assert.equal(game.start(phase2.lineup.player, phase2.lineup.enemy, 'ai', { story: chapter8.id }), true);
  return game;
}
const unitOf = (game, slot, kind = null) => game.s.units.find(u => u.slot === slot && (!kind || u.kind === kind)) || null;
/** 一枚棋子现在站着的那一格（读完就丢，棋子被移除之后还要用它做断言）。 */
const keyOf = t => (t ? tileKey(t) : null);
const move = (game, unit, row, col) => { Object.assign(unit, { row, col }); return unit; };

/**
 * 2v2 里凑一个"打倒即让路"的场面：
 *   · `spot` 由 p1b 的替身占着（就是**要被让出来的那一格**）；
 *   · `a`＝p2 替身的起点（spot 的邻居）、`c`＝它的同伴（本体）站的地方；
 *   · `b`＝spot 的**正对面**那格（与 `a` 相距 2 格，而这两格**唯一**的公共邻居就是 spot）——
 *     所以"spot 被占着"时绕过去要 4 步，"spot 空出来"时直着 2 步就到。
 * 六边形邻居表的固定顺序见 hex.js 的 `neighbors`：下标 0 与 1 正好相对。
 */
function killScene() {
  const g = duo();
  const free = t => t && !g.occupant(t) && !g.pillarAt(t) && !g.isRock(t) && !g.s.terrain[tileKey(t)];
  for (const t of g.tiles) {
    if (t.row < 3 || t.row > 7 || t.col < 3 || t.col > 10) continue;   // 要一块"六个邻居都在盘内"的内场
    const nb = g.near(t);
    if (!free(t) || nb.length !== 6 || !free(nb[0]) || !free(nb[1]) || !free(nb[2])) continue;
    const victim = move(g, unitOf(g, 'p1b', 'stand'), t.row, t.col);
    const walker = move(g, unitOf(g, 'p2', 'stand'), nb[0].row, nb[0].col);
    move(g, unitOf(g, 'p2', 'user'), nb[2].row, nb[2].col);
    return { g, spot: t, a: nb[0], b: nb[1], c: nb[2], victim, walker };
  }
  throw new Error('找不到合适的内场空位（测试夹具问题）');
}
/** 走到某一格要几步（走不到就是 null）——读的是移动 BFS 的真实结果。 */
function stepsTo(game, unit, tile) {
  const path = game.paths(unit).get(tileKey(tile));
  return path ? path.length : null;
}

// ===================== ① 打倒 → 棋子从 s.units 消失、格子变空 =====================

test('① 2v2 里一个角色被打倒：他的棋子从 s.units 消失、原来那一格变空，队友与对手都不受影响', () => {
  const { g, spot, victim, walker } = killScene();
  const victimMateKey = keyOf(g.tile(unitOf(g, 'p1b', 'user')));
  const bystanders = g.s.units.filter(u => u.slot !== 'p1b').map(u => `${u.id}@${keyOf(g.tile(u))}`).sort();
  // 顺手放一根宝石柱 + 一格火焰：这次改动**不许碰到**它们
  const pTile = g.tiles.find(t => !g.occupant(t) && !g.isRock(t) && tileKey(t) !== tileKey(spot));
  const fTile = g.tiles.find(t => !g.occupant(t) && tileKey(t) !== tileKey(pTile) && tileKey(t) !== tileKey(spot));
  g.s.pillars.push({ id: 'pillar-test', kind: 'pillar', side: 'p1', slot: 'p1', name: '绿宝石柱',
    row: pTile.row, col: pTile.col, hp: 3, maxHp: 3 });
  g.s.fire.push({ side: 'p1', row: fTile.row, col: fTile.col });
  // （前提）开局：那一格确实被占着
  assert.equal(g.s.units.length, 8);
  assert.equal(g.occupant(spot), victim, '（前提）被打倒的替身就站在这一格上');

  g.s.turn = 'p2';
  g.damage(victim, 999, { side: 'p2', slot: 'p2', source: '测试' });

  assert.equal(g.s.hp.p1b, 0, '★ 该槽位的共享生命归零');
  assert.equal(g.slotAlive('p1b'), false);
  assert.equal(g.unit('p1b-stand'), null, '★ 他的替身棋子从 s.units 里消失了');
  assert.equal(g.unit('p1b-user'), null, '★ 本体棋子也一样（两枚一起离场）');
  assert.equal(g.s.units.some(u => u.slot === 'p1b'), false, '★ 这个槽位在棋盘上一枚棋子都不剩');
  assert.equal(g.occupant(spot), null, '★★ 原来被占的那一格变成空的（occupant 为 null）');
  const emptyTile = g.tiles.find(t => !g.occupant(t) && tileKey(t) !== tileKey(spot));
  assert.equal(g.occupant(emptyTile), null, '（空格也一律是 null，不是 undefined）');
  assert.equal(g.s.units.length, 6, '8 枚 − 2 枚');
  // 队友（同队另一个角色）与对手的棋子一枚都没动，位置也没动
  assert.deepEqual(g.s.units.map(u => `${u.id}@${keyOf(g.tile(u))}`).sort(), bystanders, '★ 别人的棋子与站位一字未改');
  assert.ok(g.unit('p1-stand') && g.unit('p1-user'), '同队活着的角色照旧在场上');
  assert.equal(g.s.hp.p1, FIGHTERS.jotaro.hp, '同队另一个角色的血一点没掉');
  // 宝石柱与火焰不归他管，一根/一格都不许动；这一局也没有反光点
  assert.equal(g.s.pillars.length, 1);
  assert.ok(g.pillarAt(pTile), '★ 宝石柱还在原处');
  assert.equal(g.s.fire.length, 1);
  assert.ok(g.fireAt(fTile), '★ 火焰还在原处');
  assert.deepEqual(g.s.mirrors, []);
  // 这一局还在继续（同队 p1 还站着），只是这个槽位出局
  assert.equal(g.s.phase, 'battle');
  assert.equal(g.checkEnd(), false, '★ 只倒了一个角色，这一局不该结束');
  assert.equal(g.nextSlot('p2'), 'p2b', '★ 出手顺序跳过倒下的槽位');
  // 报了一条 status（进战斗记录）＋ 一条 notice，口径与既有文案一致
  const line = g.s.log.filter(e => e.type === 'status').map(e => e.text).join(' | ');
  assert.match(line, /花京院 & 绿色法皇 倒下了/, '★ 战斗记录里有一条"倒下了"');
  assert.match(line, /让出了位置/, '★ 而且要说明"让出了位置"');
  assert.match(g.s.notice.text, /花京院 & 绿色法皇 倒下了 · 它让出了位置/, '★ 提示文案与用户给的例子同一口径');
  assert.equal(g.s.notice.level, 'warn');
  // 台词（bark）里不许掺进机制词：这次改动**只**发 status / notice
  assert.deepEqual(g.s.barks, {}, '★ 没有往台词里塞东西（台词有"零机制词"的硬规矩）');
});

test('① 正在被选中的棋子被移除时，选区一起清掉（界面不许盯着一枚不存在的棋子）', () => {
  const { g, victim } = killScene();
  g.s.turn = 'p1b';
  assert.equal(g.select('p1b-stand'), true, '（前提）他本来能选中');
  assert.equal(g.s.selectedId, 'p1b-stand');
  g.damage(victim, 999, { side: 'p2', slot: 'p2', source: '测试' });
  assert.equal(g.s.selectedId, null, '★ 选中被清掉');
  assert.equal(g.selected, null);
  assert.equal(g.s.pendingSkill, null);
});

// ===================== ② 让出来的格子能走进去、也能路过 =====================

test('② 打倒之后，别的棋子能**路过**那一格、也能**落**上去（reachable / paths / move 真的通了）', () => {
  const { g, spot, b, victim, walker } = killScene();
  g.s.turn = 'p2';
  // （前提）他挡在正中间的通道上：那两格之间唯一的公共邻居就是 spot，所以只能绕路
  assert.match(g.moveReason(walker, spot), /占据/, '★ 活着的时候当然落不上去');
  assert.notEqual(stepsTo(g, walker, b), 2, '★ 他挡着路：两步之内到不了正对面那格（只能绕）');

  g.damage(victim, 999, { side: 'p2', slot: 'p2', source: '测试' });

  assert.equal(g.occupant(spot), null);
  assert.equal(g.reachable(walker).some(t => tileKey(t) === tileKey(spot)), true, '★ 那一格进了"可落点"');
  assert.equal(stepsTo(g, walker, b), 2, '★ 现在直着两步就到');
  const path = g.paths(walker).get(tileKey(b));
  assert.equal(path.length, 2, '两步');
  assert.equal(tileKey(path[0]), tileKey(spot), '★★ 那条路**正好穿过**刚让出来的那一格（paths 不含起点）');
  assert.equal(tileKey(path.at(-1)), tileKey(b));
  // 真的走进去：move() 不只是"高亮说能落"
  assert.equal(g.moveReason(walker, spot), '', '★ 落点判据也放行了');
  assert.equal(g.move(walker, spot), true, '★ 实际移动成功');
  assert.equal(keyOf(g.tile(g.unit('p2-stand'))), tileKey(spot), '★ 棋子已经站在那一格上');
  assert.ok(g.s.ap.p2 < 3, '照常扣 1 点行动点');
});

// ===================== ③ 不能复活、选不中；判负口径照旧 =====================

test('③ 归零的角色不能复活、也选不中；判负仍然是"一队两个都倒"', () => {
  const { g, victim } = killScene();
  g.damage(victim, 999, { side: 'p2', slot: 'p2', source: '测试' });
  assert.equal(g.s.hp.p1b, 0);
  assert.equal(g.slotAlive('p1b'), false);
  // 选不中：棋子已经不在场上了
  assert.equal(g.select('p1b-user'), false, '★ 倒下的角色不能作为行动单位被选中');
  assert.match(g.s.notice.text, /请先选择己方单位/);
  assert.equal(g.selected, null);
  // 轮不到他：出手顺序里被跳过（一轮 4 个回合变成 3 个角色 ＋ 回到 P1①）
  const seen = [];
  for (let i = 0; i < 4; i++) { seen.push(g.s.turn); g.endTurn(); }
  assert.deepEqual(seen, ['p1', 'p2', 'p2b', 'p1'], '★ 一整轮里没有 p1b 的回合（他被跳过）');
  assert.equal(g.s.turn, 'p2', '一轮走完照常轮到下一个活着的槽位');
  // 不能复活：给他留一根宝石柱（每回合开始会回血的那条链路），走完一整轮血还是 0
  const pTile = g.tiles.find(t => !g.occupant(t) && !g.isRock(t));
  g.s.pillars.push({ id: 'pillar-p1b', kind: 'pillar', side: 'p1', slot: 'p1b', name: '绿宝石柱',
    row: pTile.row, col: pTile.col, hp: 3, maxHp: 3 });
  for (let i = 0; i < 4; i++) g.endTurn();
  assert.equal(g.s.hp.p1b, 0, '★★ 共享生命一直是 0：没有任何治疗链路能把他拉回来');
  assert.equal(g.s.units.some(u => u.slot === 'p1b'), false, '★ 棋子也不会自己回来');
  // 把治疗口子单独堵一遍：治疗量本身就该是 0（不是"回了又被扣掉"）
  assert.equal(g.healAmount('p1b', 20), 0, '★ 归零的角色"能回多少血"是 0');
  assert.equal(g.heal('p1b', 20, '测试治疗'), 0, '★ 硬治也是 0，血一动不动');
  assert.equal(g.s.hp.p1b, 0);
  // ★ 窄路：时停的额外回合会给"刚在自己回合里被打倒的那一位"再进一次 enterTurn
  //   （`endTurn()` 里那句 `enterTurn(previous)`）——那一趟的宝石柱续航/水下呼吸不能把他拉活
  g.enterTurn('p1b');
  assert.equal(g.s.hp.p1b, 0, '★★ 哪怕硬进他的回合（宝石柱还在），血也不会回到 1 以上');
  assert.equal(g.s.units.some(u => u.slot === 'p1b'), false, '★ 也不会凭空多出棋子');
  g.s.turn = 'p1';
  assert.equal(g.s.phase, 'battle');
  // 判负口径照旧：同队两个都倒下才结束
  assert.equal(g.s.hp.p1, FIGHTERS.jotaro.hp, '同队另一个角色活得好好的');
  assert.equal(g.checkEnd(), false, '★ 只倒了一个 → 不结束');
  g.damage(unitOf(g, 'p1', 'user'), 999, { side: 'p2', slot: 'p2', source: '测试' });
  assert.equal(g.checkEnd(), true, '★ 两个都倒下 → 判负');
  assert.equal(g.s.phase, 'result');
  assert.equal(g.s.winner, 'p2');
  assert.equal(g.s.resultReason, '共享生命归零');
  assert.equal(g.s.units.some(u => u.slot === 'p1'), false, '最后倒下的那个角色的棋子同样离场');
});

// ===================== ④ 1v1 判负：该结束就结束 =====================

test('④ 1v1 判负的行为与改动前一致：结束时机、胜者、结算理由逐值相同', () => {
  /**
   * 两个变体跑**同一份剧本**，唯一的差别是"把这次的改动整个关掉"：
   * `removeFallenSlot` 被替换成空操作 ＝ 改动前"尸体留在棋盘上"的老行为。
   * 于是这一条断言的就是"移除棋子这件事**没有动到 1v1 的收场**"。
   */
  const script = removal => {
    const game = new Game({ random: seeded(11) });
    if (!removal) game.removeFallenSlot = () => false;
    game.start('jotaro', 'dio', 'ai');
    game.s.terrain = {};
    game.s.hp.p2 = 3;                                 // 只差这一下就倒
    const blade = unitOf(game, 'p1', 'stand'), foe = unitOf(game, 'p2', 'user');
    const spot = game.near(game.tile(foe)).find(n => !game.occupant(n) && !game.isRock(n));
    move(game, blade, spot.row, spot.col);
    game.s.turn = 'p1';
    const fired = game.attack(blade, foe);
    return { fired, phaseAfterAttack: game.s.phase, winner: game.s.winner, reason: game.s.resultReason,
      hp: { ...game.s.hp }, turn: game.s.turn, turnNumber: game.s.turnNumber,
      checkEndAgain: game.checkEnd(), unitsLeft: game.s.units.map(u => u.id).sort() };
  };
  const withIt = script(true), withoutIt = script(false);
  assert.equal(withIt.fired, true, '这一下打得出去');
  assert.equal(withIt.phaseAfterAttack, 'result', '★ 攻击结算返回时这一局**已经结束**（与改动前同一条链路）');
  assert.deepEqual(
    { ...withIt, unitsLeft: null },
    { ...withoutIt, unitsLeft: null },
    '★★ 结束时机／胜者／结算理由／血量／回合数全部逐值一致——这次改动没有提前或延后终局');
  assert.equal(withIt.winner, 'p1');
  assert.equal(withIt.reason, '共享生命归零', '★ 1v1 的结算理由照旧');
  assert.equal(withIt.hp.p2, 0);
  assert.equal(withIt.checkEndAgain, true);
  // 唯一的差别就是"棋盘上还剩不剩那两枚尸体棋子"——正是这次要改的东西
  assert.equal(withoutIt.unitsLeft.some(id => id.startsWith('p2-')), true, '（旧行为）输了的那一方棋子还留在场上');
  assert.equal(withIt.unitsLeft.some(id => id.startsWith('p2-')), false, '★ 现在它们离场了');
  assert.deepEqual(withIt.unitsLeft, ['p1-stand', 'p1-user'], '赢的那一方一枚不少');

  // 反方向（P1 判负）同样照旧：该结束就结束，胜者与理由不变
  const lose = new Game({ random: seeded(12) });
  lose.start('jotaro', 'dio', 'ai');
  lose.s.terrain = {};
  lose.s.hp.p1 = 3;
  lose.s.turn = 'p2';
  const dioStand = unitOf(lose, 'p2', 'stand'), jotaroUser = unitOf(lose, 'p1', 'user');
  const spot = lose.near(lose.tile(jotaroUser)).find(n => !lose.occupant(n) && !lose.isRock(n));
  move(lose, dioStand, spot.row, spot.col);
  assert.equal(lose.attack(dioStand, jotaroUser), true);
  assert.equal(lose.s.phase, 'result');
  assert.equal(lose.s.winner, 'p2');
  assert.equal(lose.s.resultReason, '共享生命归零');
  assert.equal(lose.s.units.some(u => u.side === 'p1'), false, '输的那一方棋子离场');
});

// ===================== ⑤ 第八章阶段 2：吊死者栖着的反光点／岩石格让开 =====================

test('⑤ 第八章阶段 2：打倒 J·凯尔之后，吊死者栖着的**反光点**让开（多种子）', () => {
  for (const seed of [13, 7919, 9421, 20261003]) {
    const g = openPhase2(seed);
    const ghost = unitOf(g, 'p2', 'stand'), owner = unitOf(g, 'p2', 'user');
    assert.ok(ghost && owner, `seed ${seed}：J·凯尔与吊死者都在场上`);
    assert.equal(g.mirrorWalker(ghost), true, '（前提）吊死者是"只在反光点与岩石之间跳"的那种棋子');
    const perch = g.tile(ghost);
    const mirror = g.mirrorAt(perch);
    assert.ok(mirror && !mirror.sealed, `seed ${seed}：开局它就栖在一个还没被封的反光点上`);
    assert.equal(g.mirrorOpenFor(mirror), false, '（前提）被它占着 → 这个点现在不能落人');
    assert.equal(g.occupant(perch), ghost);
    const mirrorsBefore = g.s.mirrors.length;

    g.damage(owner, 999, { side: 'p1', slot: 'p1', source: '测试' });

    assert.equal(g.s.hp.p2, 0, `seed ${seed}：J·凯尔那一格归零`);
    assert.equal(g.s.units.some(u => u.slot === 'p2'), false, `seed ${seed}：★ J·凯尔与吊死者一起离场`);
    assert.equal(g.occupant(perch), null, `seed ${seed}：★★ 它原来栖着的那一格空出来了`);
    assert.equal(g.mirrorOpenFor(mirror), true, `seed ${seed}：★ 那个反光点重新可以落人`);
    assert.equal(g.mirrorLanding(perch), true, `seed ${seed}：★ 落点判据也放行（"高亮说能落"与"真的能落"一致）`);
    assert.equal(g.mirrorAt(perch).sealed, false, '★ 反光点本身没有被改动（没被封、没被删）');
    assert.equal(g.s.mirrors.length, mirrorsBefore, '★ 反光点的数量一个字没动');
    assert.equal(g.openMirrors().length, mirrorsBefore, '★ 也没有连坐别的点');
    // 同队的另一个角色（p1b＝电脑友军花京院）照旧在场上
    assert.ok(unitOf(g, 'p1b', 'stand') || unitOf(g, 'p1b', 'user'), '队友棋子不受影响');
    // 这一场照旧收尾：关键槽位倒了就判玩家胜（口径没变）
    assert.equal(g.checkEnd(), true);
    assert.equal(g.s.phase, 'result');
    assert.equal(g.s.winner, 'p1');
    assert.equal(g.s.resultReason, '共享生命归零');
  }
});

test('⑤ 阶段 2：它栖在**岩石**上时，那一块岩石格同样让开', () => {
  const g = openPhase2(13);
  const ghost = unitOf(g, 'p2', 'stand'), owner = unitOf(g, 'p2', 'user');
  const rock = g.tiles.find(t => g.isRock(t) && !g.occupant(t) && !g.pillarAt(t));
  assert.ok(rock, '（前提）场上要有一块没被占用的岩石');
  move(g, ghost, rock.row, rock.col);
  assert.equal(g.occupant(rock), ghost, '（前提）它现在栖在岩石上');
  assert.equal(g.mirrorLanding(rock), false, '（前提）被占着 → 这一格现在落不了人');
  g.damage(owner, 999, { side: 'p1', slot: 'p1', source: '测试' });
  assert.equal(g.occupant(rock), null, '★★ 岩石格也让出来了');
  assert.equal(g.mirrorLanding(rock), true, '★ 现在能落人了（未封的反光点 ∪ 未被占用的岩石）');
  assert.equal(g.isRock(rock), true, '★ 岩石本身还在（让开的是"占用"，不是把地形删了）');
  assert.equal(MIRRORS.name, '反光点', '（文案取自机制数据，界面侧不再手写一遍）');
});

// ===================== ⑥ 界面：不留鬼影 =====================

test('⑥ 界面：渲染按 s.units 走（移除即消失），"倒下压暗"那套画法已经不再走', () => {
  const render = fs.readFileSync(new URL('../src/ui/render.js', import.meta.url), 'utf8');
  // ① 棋子是逐枚照着 `state.units`（＝`s.units`）画的：不在那份表里就画不出来 → 不会留鬼影
  assert.match(render, /const positions = state\.units\.map\(/, '★ 那一帧画的就是 s.units 里的棋子');
  // ② 旧的"尸体压暗"两处（整枚 alpha .42 ＋ 收尾再盖一层灰罩）都随那条取舍一起删掉了
  assert.equal(/fallen/.test(render), false, '★ 不再有"倒下压暗"那条分支');
  assert.equal(render.includes('globalAlpha = .42'), false, '★ 压暗用的那个 alpha 也一起没了');
  assert.equal(render.includes("#1a1622"), false, '★ 那层灰罩的颜色也不再出现');
  // ③ 真打一局：这一帧取到的棋子表里根本没有已出局的那个角色
  const { g, victim } = killScene();
  g.damage(victim, 999, { side: 'p2', slot: 'p2', source: '测试' });
  const ids = g.s.units.map(u => u.id);
  assert.equal(ids.some(id => id.startsWith('p1b-')), false, '★ 这一帧里取不到他的棋子');
  assert.equal(ids.length, 6);
  // ④ 界面接线（静态检查）：正在"查看"的棋子一旦离场就立刻放下——否则会留一圈"查看中"的范围残影
  const main = fs.readFileSync(new URL('../src/main.js', import.meta.url), 'utf8');
  assert.match(main, /if \(inspecting && !game\.s\.units\.includes\(inspecting\)\) inspecting = null;/,
    '★ 查看目标离场后会被放下（与棋子一起消失，不留残影）');
});

// ===================== ⑥ 多种子自动对局：收敛、无异常、不变式始终成立 =====================

/** 场上任何一枚棋子都属于一个**还活着**的槽位——这次改动之后这是引擎级不变式。 */
function assertInvariants(game, tag) {
  for (const u of game.s.units) {
    assert.ok(game.slotAlive(u.slot), `${tag}：${u.id} 还在场上，可它所属的角色已经倒下了`);
  }
  for (const slot of game.s.slots) {
    assert.ok(Number.isFinite(game.s.hp[slot]) && game.s.hp[slot] >= 0 && game.s.hp[slot] <= game.fighter(slot).hp,
      `${tag}：${slot} 血量越界`);
  }
  const keys = [...game.s.units, ...game.s.pillars].map(u => tileKey(game.tile(u)));
  assert.equal(new Set(keys).size, keys.length, `${tag}：不能有两枚棋子/柱子叠在同一格`);
}

/** 交给 AI 打完（四个位子都直接由 AI 驱动，＝main.js 里那条循环在测试里的等价物）。 */
function playOut(game, limit, tag) {
  const fallen = new Set();
  let steps = 0;
  assertInvariants(game, `${tag} 开局`);
  while (game.s.phase === 'battle' && steps < limit) {
    const plan = chooseAI(game);
    if (!plan || !playAIAction(game, plan)) game.endTurn();
    steps++;
    assertInvariants(game, `${tag} 第 ${steps} 步`);
    for (const slot of game.s.slots) if (!game.slotAlive(slot)) fallen.add(slot);
  }
  assertInvariants(game, `${tag} 终局`);
  return { steps, fallen, done: game.s.phase === 'result', winner: game.s.winner };
}

test('⑥ 2v2 多种子全人机自动对局：能收敛、无异常，倒下的槽位在场上不留棋子', () => {
  for (const seed of [7, 2024, 99, 4242]) {
    const g = new Game({ random: seeded(seed) });
    g.setRoster({ p1b: 'kakyoin', p2b: 'iggy' });
    g.start('jotaro', 'dio');
    g.s.terrain = {};
    const run = playOut(g, 2000, `2v2 seed ${seed}`);
    assert.ok(run.steps < 2000, `seed ${seed}：全人机 2v2 没打完（${run.steps} 步）`);
    assert.equal(run.done, true, `seed ${seed}：要分出胜负`);
    assert.ok(['p1', 'p2'].includes(run.winner), `seed ${seed}：winner=${run.winner}`);
    // 2v2 只可能"一队两个角色都归零"才收场，所以这一局至少倒过两个角色
    assert.ok(run.fallen.size >= 2, `seed ${seed}：至少倒过两个角色（实际 ${run.fallen.size}）`);
    const loser = run.winner === 'p1' ? 'p2' : 'p1';
    for (const slot of g.teamSlots(loser)) {
      assert.equal(g.s.hp[slot], 0, `${slot} 也该归零`);
      assert.equal(g.s.units.some(u => u.slot === slot), false, `★ ${slot} 的棋子一枚都不剩`);
    }
    assert.equal(g.s.units.length, 8 - 2 * run.fallen.size, '场上棋子数＝8 − 倒下的角色数 ×2');
  }
});

test('⑥ 剧情第八章两场多种子全 AI 打完：阶段 1 的必败剧情与阶段 2 的收尾都照旧、都不崩', () => {
  // 阶段 1：波鲁纳雷夫 单挑 皇帝（必败剧情战，掉到半血就收场）
  for (const seed of [13, 7919]) {
    const g = new Game({ random: seeded(seed) });
    g.setRoster({ p1b: null, p2b: null, story: true, scene: phase1 });
    assert.equal(g.start(phase1.lineup.player, phase1.lineup.enemy, 'ai', { story: chapter8.id }), true);
    const run = playOut(g, 900, `阶段 1 seed ${seed}`);
    assert.ok(run.steps < 900, `阶段 1 seed ${seed}：没打完（${run.steps} 步）`);
    assert.equal(run.done, true, `阶段 1 seed ${seed}：要收得了尾`);
    assert.equal(run.winner, 'p2', '★ 阶段 1 照旧判玩家战败（必败剧情战）');
    assert.equal(g.s.storyLoss, true);
  }
  // 阶段 2：波鲁纳雷夫 ＋ 电脑友军花京院 对 J·凯尔 & 吊死者
  for (const seed of [13, 7919, 20261003]) {
    const g = openPhase2(seed);
    const run = playOut(g, 900, `阶段 2 seed ${seed}`);
    assert.ok(run.steps < 900, `阶段 2 seed ${seed}：没打完（${run.steps} 步）`);
    assert.equal(run.done, true, `阶段 2 seed ${seed}：要收得了尾`);
    assert.ok(['p1', 'p2'].includes(run.winner), `阶段 2 seed ${seed}：winner=${run.winner}`);
    // 不管谁赢，"归零的角色在场上没有棋子"这条不变式都已经在每一步里验过了
    if (run.winner === 'p1') {
      assert.equal(g.s.units.some(u => u.slot === 'p2'), false, `★ 打倒 J·凯尔之后他的棋子离场`);
    }
    for (const slot of g.s.slots) if (!g.slotAlive(slot)) {
      assert.equal(g.s.units.some(u => u.slot === slot), false, `★ ${slot} 归零 → 场上没有他的棋子`);
    }
  }
});
