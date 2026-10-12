/**
 * 第八章「皇帝与吊死者」第③步：**反光点（镜面格）＋ 吊死者在反光点之间跳**。
 *
 * 用户拍板的数值（`design/第八章设计草案.md`，**不许改**）：
 *   · 开局在**中场**撒 4 个反光点（不贴边、不重叠、不压特殊地形）；
 *   · 吊死者（`FIGHTERS.geil.stand.mirrorWalk`）**走不到普通空地**，花 1 AP 就能跳到
 *     **任意一个还没被封的反光点**（无视距离与阻挡）；
 *   · 开局它就已经站在一个反光点上；
 *   · **铺在某个反光点上的火焰＝那个点永久失效**；
 *   · 点被封到只剩它脚下那一个 → 它的走位余地几乎没了（★ 2026-10-03 起：落点还并上了空岩石，
 *     所以"无处可跳"这个状态要连岩石一起没有才会出现，见下面第七条用例），但照样能出手、
 *     能结束回合，不许卡死；
 *   · **只在带旗标的那一幕生效**：别的章节、别的幕、别的模式一个反光点都没有。
 *
 * ⚠️⚠️ 2026-10-03 用户改版（`design/第八章-两阶段改版.md`）：这一章改成**两阶段两场**，
 *   反光点**只在阶段 2**（波鲁纳雷夫 ＋ 电脑控制的花京院 对 吊死者）生效。所以这个文件里
 *   按改版改掉了三处：
 *     · 夹具从"整章"改成**阶段 2 那一幕**（`scene` 要一并登记给引擎）；
 *     · `chapter8.mirrors` → **`阶段 2 那一幕的 mirrors`**（章节级不许再挂这面旗）；
 *     · 新增"阶段 1 里一个反光点都没有、`s.mirrors` 是空数组"的断言。
 *   ⚠️ 已知空白（见 rules.js 里 MIRRORS 那段）：阶段 2 的两个人（波鲁纳雷夫、花京院）**都没有
 *      铺火的技能**（`flame` 是阿布德尔的），所以"用火封镜"实战里到不了。下面那一条封镜的
 *      回归用例因此**临时给花京院补上 flame**，守的是"火焰落在反光点上就把点封掉"这条链路本身。
 *
 * ⚠️ 这一章还有一步没做（别在这些测试里提前假设）：AI 友军优先烧镜面（第⑤步）；
 *    冷枪的回归在 `sniper.test.js`、章节入口与两阶段整体在 `emperor.test.js` /
 *    `chapter8-phases.test.js`。
 *
 * ★★ 2026-10-03 **用户第三次拍板**（"吊死者"加强三条：射程 3 / 自带 2 点穿甲 /
 *    **落点扩成「未封的反光点 ∪ 未被占用的岩石格」**）。第三条**直接推翻**了本文件里
 *    四处断言，按新口径改过（其余一字未动）：
 *      · 第三条用例（开局站位）：可落点数不再是 `MIRRORS.count − 1`，要并上"空岩石"；
 *      · 第四条用例（落点＝？）：并集两半都要在，且"四周糊上岩石"不再等于"围死"；
 *      · 第七条用例（点全封住）：封光反光点**不再**等于"无处可跳"——场上的空岩石照样能落，
 *        要先把岩石也去掉才是"无处可跳"这个状态；
 *      · AI 那条：它现在可能站在**岩石**上（不再只站反光点）。
 *    ⚠️ 这三条加强本身的回归在 `tests/hanged-man.test.js`；封镜（火焰把那一个点永久废掉）
 *      这一条**一个字没动**，照旧在这里守着。
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { Game, FIGHTERS, STORY_CHAPTERS, MIRRORS, skillSetFor } from '../src/core/game.js';
import { hexDist, tileKey, ROWS, COLS, CANVAS_W, CANVAS_H } from '../src/core/hex.js';
import { chooseAI, playAIAction } from '../src/core/ai.js';
import { BoardVisual } from '../src/ui/render.js';
import { tileDescription } from '../src/ui/hud.js';

function seeded(seed = 13) { return () => ((seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0) / 4294967296); }
const chapter8 = STORY_CHAPTERS.find(c => c.id === 'chapter-8');
/** 阶段 1（波波 单挑 皇帝）与阶段 2（波波 ＋ 花京院 对 吊死者）——按阵容认，不写死下标。 */
const phase1 = chapter8.scenes.find(scene => scene.kind === 'battle' && scene.lineup?.enemy === 'emperor');
const phase2 = chapter8.scenes.find(scene => scene.kind === 'battle' && scene.lineup?.enemy === 'geil');
/** 多种子跑：撒点是随机的，单跑一个种子证明不了"总是合法"。 */
const SEEDS = [13, 7919, 9421, 20261003];

/** ★ 反光点只在**阶段 2**生效，所以这份夹具开的是阶段 2 那一场（反光点已撒好、吊死者已站在点上）。 */
function fixture(seed = 13, events = null) {
  const game = new Game({ random: seeded(seed), onEvent: event => events?.push(event) });
  game.setRoster({ p1b: phase2.lineup.ally, story: true, scene: phase2 });
  game.start(phase2.lineup.player, phase2.lineup.enemy, 'ai', { story: chapter8.id });
  return game;
}
/** 吊死者＝敌方第一个角色位（p2）的那枚替身棋子；本体是 J·凯尔。 */
const ghostOf = game => game.s.units.find(u => u.slot === 'p2' && u.kind === 'stand');
const ownerOf = game => game.s.units.find(u => u.slot === 'p2' && u.kind === 'user');
const keys = tiles => tiles.map(tileKey).sort();
/** 找一格**空地**（没棋子、没柱子、没地形、没反光点）——用来做"普通格子"的对照。 */
const freeTile = (game, skip = () => false) => game.tiles.find(t =>
  !game.occupant(t) && !game.pillarAt(t) && !game.mirrorAt(t) && !game.s.terrain[tileKey(t)] && !skip(t));
/** 场上所有岩石格（`s.terrain === 'rock'` 的那些）。 */
const rockTiles = game => game.tiles.filter(t => game.isRock(t));
/**
 * ★ 2026-10-03 用户第三次拍板后的落点口径，**在这里独立重算一遍**
 *（不直接调引擎里那个判据，否则等于拿实现证明实现）：
 *   未封的反光点 ∪ 未被占用的岩石格，且不含它自己脚下那一格。
 */
const landingSpots = (game, ghost) => game.tiles.filter(t => {
  if (tileKey(t) === tileKey(game.tile(ghost))) return false;
  if (game.occupant(t)) return false;
  const m = game.mirrorAt(t);
  return (!!m && !m.sealed) || game.isRock(t);
});

test('★ 反光点数据：只有"阶段 2 那一幕"有这面旗，数值照用户拍板；"走反光点"是数据旗标，不按角色名写死', () => {
  assert.equal(phase2.mirrors, true, '★ 阶段 2 那一幕要打开 mirrors 旗（引擎据此启用反光点）');
  // ★★ 改版：旗标**只在幕上**。写回章节级就等于"只要在第八章就都生效"，阶段 1 会白撒 4 个点。
  assert.equal(chapter8.mirrors, undefined, '★ 章节级不许挂 mirrors');
  assert.notEqual(phase1.mirrors, true, '★ 阶段 1 里没有反光点');
  assert.equal(MIRRORS.count, 4, '用户定：开局 4 个');
  assert.equal(MIRRORS.name, '反光点', '界面上的叫法由数据提供，别在多处手写');
  for (const chapter of STORY_CHAPTERS) {
    if (chapter.id !== 'chapter-8') assert.notEqual(chapter.mirrors, true, `${chapter.id} 不该有反光点旗标`);
  }
  // 旗标挂在**棋子数据**上（引擎里没有任何一处按 'geil' / '吊死者' 这种名字判断）
  assert.equal(FIGHTERS.geil.stand.mirrorWalk, true, '★ 只有吊死者带 mirrorWalk');
  assert.ok(!FIGHTERS.geil.user.mirrorWalk, '本体 J·凯尔照常走地面');
  const walkers = Object.values(FIGHTERS).flatMap(f => [f.user, f.stand]).filter(u => u?.mirrorWalk);
  assert.deepEqual(walkers.map(u => u.name), ['吊死者'], '全项目只有它一个走反光点');
});

test('★ 开局在棋盘中场撒下 4 个反光点：不贴边、不重叠、不压特殊地形／柱子／棋子', () => {
  for (const seed of SEEDS) {
    const game = fixture(seed);
    const mirrors = game.s.mirrors, ghost = ghostOf(game);
    assert.equal(game.mirrorRule(), MIRRORS, `seed ${seed}：这一局该启用反光点规则`);
    assert.equal(mirrors.length, MIRRORS.count, `seed ${seed}：开局就该有 ${MIRRORS.count} 个反光点`);
    assert.equal(new Set(mirrors.map(m => `${m.row},${m.col}`)).size, mirrors.length, '反光点之间不能重叠');
    for (const m of mirrors) {
      const t = game.at(m.row, m.col), type = game.s.terrain[tileKey(t)];
      assert.ok(t, `${m.row},${m.col} 必须在棋盘内`);
      assert.ok(typeof m.id === 'string' && m.id.length > 0, '每个点都要有自己的 id');
      assert.equal(m.sealed, false, '开局都是亮的');
      assert.ok(m.row >= MIRRORS.margin && m.row <= ROWS - 1 - MIRRORS.margin, `不贴边 · 行 ${m.row}`);
      assert.ok(m.col >= MIRRORS.margin && m.col <= COLS - 1 - MIRRORS.margin, `不贴边 · 列 ${m.col}`);
      assert.equal(type, undefined, `不压特殊地形（这里压着 ${type}）`);
      assert.ok(!game.pillarAt(t), '不压柱子');
      const occ = game.occupant(t);
      assert.ok(!occ || occ === ghost, '除了开局的吊死者，格子上不能站着别人');
      // 撒在"中场"：每一条边都至少留出 margin 圈的余量（等价于上面两条不贴边）
      assert.ok(m.row <= ROWS - 1 - MIRRORS.margin && m.col <= COLS - 1 - MIRRORS.margin);
    }
    // 反光点**不进 s.terrain**（地形那套分支一个字没动）
    assert.deepEqual([...new Set(Object.values(game.s.terrain))].sort(), ['bush', 'hazard', 'heal', 'rock'],
      's.terrain 里只可能出现既有那四种地形');
  }
});

test('★ 吊死者开局就站在一个反光点上（不是常规的对称摆位），本体照常站位', () => {
  for (const seed of SEEDS) {
    const game = fixture(seed);
    const ghost = ghostOf(game), owner = ownerOf(game);
    assert.ok(ghost && owner, 'J·凯尔要有本体 + 替身两枚棋子');
    const mine = game.mirrorAt(game.tile(ghost));
    assert.ok(mine, `seed ${seed}：吊死者开局必须站在反光点上（实际在 ${ghost.row},${ghost.col}）`);
    assert.equal(mine.sealed, false, '开局那个点当然是没封的');
    // 本体按常规摆位：反光点不压棋子，所以它脚下一定不是反光点
    assert.equal(game.mirrorAt(game.tile(owner)), null, '本体照常站在常规位置上，不占反光点');
    // 开局就能用：站在点上时，其余的空点都是可落点
    // ★ 2026-10-03 改（用户第三次拍板）：落点并上了**未被占用的岩石格**，
    //   所以这里不再数 `MIRRORS.count − 1`，改成"未封反光点 ∪ 空岩石"的独立重算。
    assert.deepEqual(keys(game.reachable(ghost)), keys(landingSpots(game, ghost)),
      '除了自己脚下那一个，其余反光点＋空岩石都跳得到');
    assert.ok(rockTiles(game).length > 0, '这一局棋盘上该有岩石（不然并集那一半没被验到）');
  }
});

test('★ 它的落点＝没被封的反光点 ∪ 没被占用的岩石格（无视距离与阻挡），普通空地一个都落不了', () => {
  for (const seed of SEEDS) {
    const game = fixture(seed);
    const ghost = ghostOf(game);
    game.s.turn = 'p2';   // 轮到它这一方（moveReason 会拦"不是你的回合"）
    const home = game.tile(ghost);
    // ★ 2026-10-03 改（用户第三次拍板）：落点＝**未封的反光点 ∪ 未被占用的岩石格**。
    //   ⚠️ 独立重算一遍（见 landingSpots），不拿引擎的判据证明引擎自己。
    const open = landingSpots(game, ghost);
    const mirrorOnly = game.openMirrors().map(m => game.at(m.row, m.col))
      .filter(t => tileKey(t) !== tileKey(home));
    assert.deepEqual(keys(game.reachable(ghost)), keys(open), `seed ${seed}：落点必须正好是"未封反光点 ∪ 空岩石"`);
    // 并集的两半都要真的在（免得"并集"其实只剩一半）
    for (const t of mirrorOnly) assert.ok(keys(open).includes(tileKey(t)), '未封的反光点照旧都在落点里');
    for (const t of rockTiles(game)) assert.ok(keys(open).includes(tileKey(t)), '★ 没被占用的岩石格也都在落点里');
    // 每一格都要能真的走（moveReason 放行），而不是"高亮能走、点了却报错"
    for (const t of open) assert.equal(game.moveReason(ghost, t), '', `${tileKey(t)} 应该允许落下`);
    // 普通空地：一个都不行
    const plain = freeTile(game);
    assert.notEqual(game.moveReason(ghost, plain), '', '普通空地不是它的落点');
    assert.equal(game.move(ghost, plain), false, '普通空地的移动要被拒');
    assert.equal(game.s.ap.p2, 3, '被拒绝的移动不能扣行动点');
    // 无视阻挡：把四周（非镜面的邻格）全糊上岩石，**反光点那一批落点一个都不少**
    // （★ 2026-10-03：它现在也能落在空岩石上，所以"四周全糊岩石"反而会**多出**几个落点——
    //   这一条因此只判"原来那批一个都没丢"；"被占的格子落不了"另见下一条用例。）
    for (const n of game.near(game.tile(ghost))) if (!game.mirrorAt(n)) game.s.terrain[tileKey(n)] = 'rock';
    const after = keys(game.reachable(ghost));
    for (const t of mirrorOnly) assert.ok(after.includes(tileKey(t)), '被围死也照样能跳到任何一个反光点');
    assert.deepEqual(after, keys(landingSpots(game, ghost)), '糊完岩石之后，落点仍然是"反光点 ∪ 空岩石"');
  }
});

test('★ 跳到任意一个反光点：把点挪到移动力／连携距离都够不着的地方，它一样跳得过去', () => {
  const game = fixture();
  const ghost = ghostOf(game), owner = ownerOf(game), home = game.tile(ghost);
  // 挑一格"离它最远"的空地，把一个反光点挪过去（模拟撒点撒到棋盘另一头）
  const far = game.tiles.filter(t => !game.occupant(t) && !game.pillarAt(t) && !game.mirrorAt(t)
    && !game.s.terrain[tileKey(t)]).sort((a, b) => hexDist(b, home) - hexDist(a, home))[0];
  const mirror = game.openMirrors().find(m => !(m.row === ghost.row && m.col === ghost.col));
  Object.assign(mirror, { row: far.row, col: far.col });
  assert.ok(hexDist(far, home) > game.moveRange(ghost), '这个点必须远超它的移动力');
  assert.ok(hexDist(far, game.tile(owner)) > game.distLimit('p2'), '而且超出连携距离（用户定：任意一个反光点）');
  assert.ok(keys(game.reachable(ghost)).includes(tileKey(far)), '无视距离：它仍然在落点里');
  game.s.turn = 'p2';   // 轮到它这一方（moveReason 会拦"不是你的回合"）
  assert.equal(game.moveReason(ghost, far), '', '这一步必须被允许');
  assert.equal(game.move(ghost, far), true);
  assert.deepEqual([ghost.row, ghost.col], [far.row, far.col], '真的跳过去了');
  assert.equal(game.s.ap.p2, 2, '花 1 AP');
  // 跳过去之后落点里就不该再有"自己脚下这一格"
  assert.equal(game.reachable(ghost).some(t => tileKey(t) === tileKey(far)), false, '不会把自己脚下那格算成落点');
});

test('★ 火焰落在反光点上＝那个点永久失效；被封的点立刻不再是落点', () => {
  const events = [];
  const game = fixture(13, events);
  const ghost = ghostOf(game);
  // ★ 阶段 2 的两个人（波鲁纳雷夫、花京院）本来都**没有铺火的技能**（flame 是阿布德尔的），
  //   而"火焰落在反光点上就封点"这条链路接在 place() 的既有分支里，必须守住。
  //   所以这里**临时**给花京院补上 flame（只是给这一条用例用；实战里的空白见 rules.js 的 MIRRORS 注释）。
  game.s.story = { ...game.s.story, swaps: { kakyoin: { skills: [...skillSetFor('kakyoin'), 'flame'] } } };
  // 挑一个"吊死者没站着"的点（火焰不能铺在有棋子的格子上）
  const target = game.openMirrors().find(m => !(m.row === ghost.row && m.col === ghost.col));
  const tile = game.at(target.row, target.col);
  // 让花京院的替身（绿色法皇）挪到这个点旁边，然后走**既有的火焰技能**把它烧掉
  const flame = game.s.units.find(u => u.slot === 'p1b' && u.kind === 'stand');
  const spot = game.near(tile).find(n => !game.occupant(n) && !game.isRock(n) && !game.mirrorAt(n));
  Object.assign(flame, { row: spot.row, col: spot.col });
  game.s.turn = 'p1b';
  assert.equal(game.select(flame.id), true);
  assert.equal(game.beginSkill(flame, 'flame'), true, '火焰道路要能起手');
  assert.equal(game.place(flame, tile), true, '火焰要能铺在这个反光点上');
  assert.equal(target.sealed, true, '★ 点被永久封住');
  assert.equal(game.openMirrors().length, MIRRORS.count - 1, '剩 3 个');
  assert.equal(game.reachable(ghost).some(t => tileKey(t) === tileKey(tile)), false, '被封的点不再是落点');
  assert.notEqual(game.moveReason(ghost, tile), '', '落上去要被拒');
  // 报了一句状态（用户要求 emit('status')：'镜面被封住了 · 反光点还剩 N 个'）
  const said = events.filter(e => e.type === 'status').map(e => e.text).join('|');
  assert.match(said, /反光点被封住了/);
  assert.match(said, new RegExp(`${MIRRORS.count - 1}/${MIRRORS.count}`), '要报出还剩几个');
  // "永久"：火焰之后被清掉（涅槃）也不复原
  game.s.fire = [];
  assert.equal(target.sealed, true, '火焰没了，封也是永久的');
});

test('★ 反光点全被封住后它还能落到空岩石上；连岩石也没有了才无处可跳，但照样能出手、能结束回合', () => {
  // ⚠️ 只靠火焰**封不掉它正踩着的那一个点**（火焰不能铺在有棋子的格子上，见 placement），
  //    所以"4 个全封"这个状态是直接构造的：封镜只有 `sealMirror()` 一个入口，火焰走的也是它。
  const game = fixture();
  const ghost = ghostOf(game);
  for (const m of game.s.mirrors) game.sealMirror(game.at(m.row, m.col), 'p1b');
  assert.deepEqual(game.openMirrors(), [], '四个点全封住了');
  for (const m of game.s.mirrors) {
    assert.equal(game.move(ghost, game.at(m.row, m.col)), false, '连反光点本身也落不了（已经封了）');
  }
  assert.equal(game.s.ap.p2, 3, '被拒的移动不该扣行动点');
  // ★ 2026-10-03 改（用户第三次拍板）：封光反光点**不再**等于"无处可跳"——
  //   场上的空岩石照样是它的落点（这一条原来断言 `reachable === []`，被那次加强直接推翻）。
  assert.deepEqual(keys(game.reachable(ghost)), keys(landingSpots(game, ghost)), '落点只剩没被占用的岩石');
  assert.ok(rockTiles(game).length > 0, '这一局棋盘上确实有岩石，所以上面的并集不为空');
  // 把剩下的岩石也去掉（换成草丛）＝这一局才是真正的"无处可跳"
  for (const t of rockTiles(game)) game.s.terrain[tileKey(t)] = 'bush';
  assert.deepEqual(game.reachable(ghost), [], '没有反光点、也没有岩石＝无处可跳');
  // 照样能攻击：把银色战车挪到它旁边（它停在原地出手）
  game.s.turn = 'p2';
  const foe = game.s.units.find(u => u.slot === 'p1' && u.kind === 'stand');
  const next = game.near(game.tile(ghost)).find(n => !game.occupant(n) && !game.isRock(n) && !game.mirrorAt(n));
  Object.assign(foe, { row: next.row, col: next.col });
  const hp0 = game.s.hp.p1;
  assert.equal(game.attack(ghost, foe), true, '★ 站在被封的镜面上照样能出手');
  assert.ok(game.s.hp.p1 < hp0, '这一下真的打出去了');
  // 不会卡死：轮到这一方时 AI 照常出手或结束回合，回合能交出去
  let guard = 0;
  while (game.s.phase === 'battle' && game.s.turn === 'p2' && guard++ < 12) {
    const plan = chooseAI(game);
    assert.ok(plan, `第 ${guard} 步：AI 必须有决策（不能返回 null）`);
    if (!playAIAction(game, plan)) game.endTurn();
  }
  assert.ok(guard < 12, `★ 这一回合必须能走完（走了 ${guard} 步，说明卡住了）`);
  assert.notEqual(game.s.turn, 'p2', '回合要交得出去');
});

test('★ 别的章节、别的幕、别的模式完全没有反光点（老章节与自由对局都是空数组，规则也不生效）', () => {
  // ★★ 改版新增：**同一章的阶段 1 也没有**——旗标只写在阶段 2 那一幕上。
  const phase1Game = new Game({ random: seeded(13) });
  phase1Game.setRoster({ p1b: null, p2b: null, story: true, scene: phase1 });
  phase1Game.start(phase1.lineup.player, phase1.lineup.enemy, 'ai', { story: chapter8.id });
  assert.deepEqual(phase1Game.s.mirrors, [], '★ 阶段 1 一个反光点都没有（这就是"分幕声明旗标"的意义）');
  assert.equal(phase1Game.mirrorRule(), null, '★ 阶段 1 里反光点规则是关闭的');
  assert.equal(phase1Game.sniperRule() !== null, true, '（同一场上冷枪是开着的）');
  // 随便挑一章老剧情（第七章，1v1）
  const chapter7 = STORY_CHAPTERS.find(c => c.id === 'chapter-7');
  const game = new Game({ random: seeded(13) });
  assert.equal(game.mirrorRule(), null, '没开打之前没有这一章，也就没有规则');
  assert.deepEqual(game.s.mirrors, [], 'reset() 之后是空数组');
  game.start(chapter7.player, chapter7.enemy, 'ai', { story: chapter7.id });
  assert.deepEqual(game.s.mirrors, [], '★ 别的章节一个反光点都没有');
  assert.equal(game.mirrorRule(), null);
  assert.equal(game.generateMirrors(), 0, '不在那一幕：生成函数直接返回 0（不会偷偷撒点）');
  assert.equal(game.sealMirror(game.at(5, 5), 'p1b'), false, '不在那一幕：封镜是空操作');
  assert.equal(game.mirrorAt(game.at(5, 5)), null);
  // 自由对局（不是剧情模式）同样没有
  const free = new Game({ random: seeded(13) });
  free.start('jotaro', 'dio', 'ai');
  assert.deepEqual(free.s.mirrors, []);
  assert.equal(free.mirrorRule(), null);
  // "走反光点"的判定要求这一局真的有反光点：把带旗标的棋子放进没有反光点的对局里，
  // 它仍然按普通棋子走（不然它就成了一枚哪儿都去不了的死子，16 组配对的收敛不变式会崩）
  const flagBug = { ...FIGHTERS.geil.stand, id: 'x-stand', side: 'p2', slot: 'p2', kind: 'stand', row: 5, col: 9 };
  assert.equal(free.mirrorWalker(flagBug), false, '没有反光点的对局里，旗标不起作用');
  assert.equal(game.mirrorWalker(flagBug), false);
  assert.equal(phase1Game.mirrorWalker(flagBug), false, '★ 阶段 1 里"只在反光点之间跳"同样不生效');
});

test('★ 第八章照样能被 AI 自动打完（多种子）：吊死者只站在反光点或岩石上，不会卡死', () => {
  for (const seed of [...SEEDS, 555]) {
    const game = fixture(seed);
    const ghost = ghostOf(game);
    let guard = 0;
    while (game.s.phase === 'battle' && guard++ < 900) {
      const plan = chooseAI(game);
      if (!plan || !playAIAction(game, plan)) game.endTurn();
      // 它**永远只能站在反光点或岩石上**——AI 走的也是 reachable()，所以这条同时守着"AI 会自己跳"。
      // ★ 2026-10-03 改（用户第三次拍板）：落点并上"未被占用的岩石格"，所以岩石也算合法站位。
      const t = game.tile(ghost);
      assert.ok(game.mirrorAt(t) || game.isRock(t),
        `seed ${seed} 第 ${guard} 步：吊死者居然站在普通格子上（${t.row},${t.col}）`);
    }
    assert.ok(guard < 900, `★ seed ${seed} 的这局没打完（走了 ${guard} 步，说明它卡住了）`);
    assert.equal(game.s.phase, 'result', `seed ${seed} 要分出胜负`);
    assert.ok(['p1', 'p2'].includes(game.s.winner), '胜负落在某一队上');
  }
});

test('★ 渲染：未封／已封的反光点都能画完一整帧，标签与 save/restore 都配平', () => {
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
      set() { return true; },
    });
    const canvas = { width: CANVAS_W, height: CANVAS_H, style: {}, getContext: () => ctx, addEventListener() {}, getBoundingClientRect: () => ({ left: 0, top: 0, width: CANVAS_W, height: CANVAS_H }) };
    globalThis.document = {
      getElementById: id => (id === 'board' ? canvas : null),
      createElement: () => ({ width: 0, height: 0, style: {}, getContext: () => ctx }),
    };
    const game = fixture();
    const visual = new BoardVisual(game);
    game.s.turn = 'p2';
    game.select(ghostOf(game).id);          // 选中吊死者：还能顺带看"跳跃落点"的高亮
    assert.doesNotThrow(() => visual.render(game.actionView(), 0), '有反光点的一帧不该抛错');
    let labels = calls.filter(c => c.prop === 'fillText').map(c => c.args[0]);
    assert.ok(labels.includes('镜面'), '没封的点上要写着"镜面"');
    assert.equal(labels.includes('镜·封'), false, '还没封，不该出现"封"的标签');
    // 封一个点再画一帧：画法要换（暗的／裂的），而且仍然画得完
    // ⚠️ 挑**没有棋子站着**的点：标签在格子上有人时会被让开（那是棋子的名字与血条的位置，
    //    见 render.js 的 drawMirror），拿"吊死者脚下那一个"来断言会永远看不到字。
    const empty = game.openMirrors().find(m => !game.occupant(game.at(m.row, m.col)));
    game.sealMirror(game.at(empty.row, empty.col), 'p1b');
    const from = calls.length;
    assert.doesNotThrow(() => visual.render(game.actionView(), 16));
    labels = calls.slice(from).filter(c => c.prop === 'fillText').map(c => c.args[0]);
    assert.ok(labels.includes('镜·封'), '被封的点要画成另一个样子（暗的／裂的）');
    const saves = calls.filter(c => c.prop === 'save').length, restores = calls.filter(c => c.prop === 'restore').length;
    assert.equal(saves, restores, 'save / restore 必须配平，否则后面的绘制会被裁切');
  } finally {
    if (previous === undefined) delete globalThis.document; else globalThis.document = previous;
    if (previousWindow === undefined) delete globalThis.window; else globalThis.window = previousWindow;
  }
});

test('★ 界面接线：反光点的格子说明与状态标签都接上了（静态检查 + 运行时文案）', () => {
  const game = fixture();
  const tile = game.at(game.s.mirrors[0].row, game.s.mirrors[0].col);
  assert.match(tileDescription(game, tile), /反光点/, '鼠标停上去要能看出这是反光点');
  assert.match(tileDescription(game, tile), /吊死者/, '……以及它是吊死者的落点');
  game.sealMirror(tile, 'p1b');
  assert.match(tileDescription(game, tile), /封住/, '封住之后要说清楚"不再能落人"');
  // 状态标签与连携那一栏的接线（hud 用的是假 DOM 才跑得起来的模板，所以这里做静态检查）
  const hud = fs.readFileSync(new URL('../src/ui/hud.js', import.meta.url), 'utf8');
  assert.match(hud, /function mirrorTags\(game\)/, '状态标签要有独立的一处实现（照 shipProgressTags 的写法）');
  assert.match(hud, /\$\{rule\.name\}还剩 \$\{left\}\/\$\{total\}/, '★ 标签里要写"反光点还剩 N/4"');
  assert.match(hud, /game\.mirrorRule\?\.\(\) && teamOf\(slot\) === 'p2' \? mirrorTags\(game\)/, '标签要真的挂进状态栏');
  assert.match(hud, /无处可跳/, '★ 它没地方跳的那一刻必须点出来（那才是围杀的窗口）');
  assert.match(hud, /镜面跳跃/, '连携那一栏对"只在反光点之间跳"的棋子不能显示成"6/4 格"');
  // 本关规则：反光点这几条要写在**阶段 2 那一幕**上（改版后规则按幕走，章节级是空的）
  const rules = (phase2.specialRules || []).join('');
  for (const piece of ['反光点', '跳多远都行']) assert.match(rules, new RegExp(piece), `本关规则缺"${piece}"`);
  assert.equal((chapter8.specialRules || []).length, 0, '★ 章节级不再有 specialRules（规则按幕声明）');
});
