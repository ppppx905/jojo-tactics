/**
 * ★★ 替身「吊死者」加强三条（2026-10-03 用户拍板，**数值不许改**）。
 *
 *   ① **攻击范围 2 → 3**（`FIGHTERS.geil.stand.range`）；
 *   ② **自带 2 点穿甲**（`FIGHTERS.geil.stand.armorPierce: 2`）：它打人时**目标防御按 −2 算（下限 0）**，
 *      草丛／邻石（岩石）／宝石柱那些**地形与对象加成照旧叠加**——穿甲只削"防御"那一个数，
 *      **不是** `pierce`（真实伤害）那条"防御全部归零"的通道；别的角色一律不受影响；
 *   ③ **落点＝未封的反光点 ∪ 未被占用的岩石格**（用户原话"可以在所有场景建筑内存在"，
 *      口径确认为**岩石**这类障碍格）：封镜机制不变、被占用（单位或柱子）的格子照旧落不了、
 *      **开局它仍然站在一个反光点上**。
 *
 * ⚠️ 这一份是**这三条的回归**；反光点本身的既有回归在 `tests/mirrors.test.js`
 *    （那里被这三条**直接推翻**的几处断言已按新口径改过，其余一字未动）。
 * ⚠️ 界面口径：`attack()` 直接用 `preview()` 算出来的 `pv.damage`，所以"瞄准时显示的伤害"与
 *    "实际结算"必然一致——第二条用例把这个等式钉死（改了 preview 忘了改结算会立刻红）。
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { Game, FIGHTERS, STORY_CHAPTERS, MIRRORS, skillSetFor } from '../src/core/game.js';
import { hexDist, tileKey, CANVAS_W, CANVAS_H } from '../src/core/hex.js';
import { chooseAI, playAIAction } from '../src/core/ai.js';
import { BoardVisual } from '../src/ui/render.js';
import { tileDescription, hoverPreview } from '../src/ui/hud.js';
import { CHARACTER_ART } from '../src/ui/assets.js';

function seeded(seed = 13) { return () => ((seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0) / 4294967296); }
const chapter8 = STORY_CHAPTERS.find(c => c.id === 'chapter-8');
/** 阶段 2（波鲁纳雷夫 ＋ 电脑控制的花京院 对 吊死者）——按阵容认，不写死下标。 */
const phase2 = chapter8.scenes.find(scene => scene.kind === 'battle' && scene.lineup?.enemy === 'geil');
/** 反光点只在阶段 2 生效，所以夹具开的就是这一场（反光点已撒好、吊死者已站在点上）。 */
function fixture(seed = 13) {
  const game = new Game({ random: seeded(seed) });
  game.setRoster({ p1b: phase2.lineup.ally, story: true, scene: phase2 });
  game.start(phase2.lineup.player, phase2.lineup.enemy, 'ai', { story: chapter8.id });
  return game;
}
const slots = game => ({
  ghost: game.s.units.find(u => u.slot === 'p2' && u.kind === 'stand'),
  owner: game.s.units.find(u => u.slot === 'p2' && u.kind === 'user'),
  foe: game.s.units.find(u => u.slot === 'p1' && u.kind === 'stand'),
  ally: game.s.units.find(u => u.slot === 'p1b' && u.kind === 'stand'),
});
const keys = tiles => tiles.map(tileKey).sort();
const rockTiles = game => game.tiles.filter(t => game.isRock(t));
/**
 * **它这一局的全部合法落点**——按用户拍板的口径**独立重算**一遍（不调用引擎里那个判据，
 * 否则等于拿实现证明实现）：未封的反光点 ∪ 未被占用的岩石格，且不含自己脚下那一格。
 */
const landingSpots = (game, ghost) => game.tiles.filter(t => {
  if (tileKey(t) === tileKey(game.tile(ghost))) return false;
  if (game.occupant(t)) return false;
  const m = game.mirrorAt(t);
  return (!!m && !m.sealed) || game.isRock(t);
});
/** 把某个单位直接摆到某格上（测试里的常规手法，与 mirrors.test.js 一致）。 */
const place = (u, t) => { Object.assign(u, { row: t.row, col: t.col }); return u; };
/** 一根假宝石柱（结构照 game.js 里真柱子那一份，只为"占着这一格"）。 */
function pillarOn(game, side, t) {
  const p = { id: `pillar-test-${t.row}-${t.col}`, kind: 'pillar', name: '绿宝石柱', side, slot: side, row: t.row, col: t.col, hp: 10, maxHp: 10 };
  game.s.pillars.push(p); return p;
}
/** 在一格上造出「草丛 + 邻石」：防御 2（本体基础）+ 3（草丛）+ 1（邻石）= 6。 */
function bushByRock(game, t) {
  game.s.terrain[tileKey(t)] = 'bush';
  const n = game.near(t).find(x => !game.occupant(x) && !game.pillarAt(x) && !game.mirrorAt(x)
    && !game.s.terrain[tileKey(x)]);
  if (n) game.s.terrain[tileKey(n)] = 'rock';
  return t;
}
/** 离 `from` 正好 `steps` 格、空着、也没地形的一块"干净"格子。 */
const cleanAt = (game, from, steps) => game.tiles.find(t =>
  hexDist(t, from) === steps && !game.occupant(t) && !game.pillarAt(t) && !game.mirrorAt(t)
  && !game.s.terrain[tileKey(t)]);

// ===================== ① 射程 3 =====================

test('① 射程：吊死者的 `range` 是 3，3 格内打得到、4 格外够不着', () => {
  assert.equal(FIGHTERS.geil.stand.range, 3, '★ 用户 2026-10-03 拍板：攻击范围 2 → 3');
  assert.equal(FIGHTERS.geil.user.range, 1, '本体照旧只有 1 格（要贴身）');
  const game = fixture();
  const { ghost } = slots(game);
  game.s.turn = 'p2';
  // 目标摆到正好 3 格外（本体不吃替身防御加成，防御数一眼可见）
  const target = cleanAt(game, game.tile(ghost), 3);
  assert.ok(target, '棋盘上要有一格离它 3 格的干净空地');
  const p1User = game.s.units.find(u => u.slot === 'p1' && u.kind === 'user');
  place(p1User, target);
  assert.equal(hexDist(game.tile(ghost), game.tile(p1User)), 3);
  assert.equal(game.attackReason(ghost, p1User), '', '★ 3 格内必须打得到（旧射程 2 拒的就是这一步）');
  // 4 格：超出射程，理由里要报出射程 3
  const far = cleanAt(game, game.tile(ghost), 4);
  if (far) {
    place(p1User, far);
    assert.match(game.attackReason(ghost, p1User), /射程 · 最远 3 格/, '4 格外必须够不着，且理由报的是新射程');
    assert.equal(game.attack(ghost, p1User), false, '够不着的一击要被拒');
    assert.equal(game.s.ap.p2, 3, '被拒的攻击不扣行动点');
  }
  // 界面：单位卡上「攻击 / 射程」读的就是 u.range，所以 8 / 3 会自己跟上
  const hud = fs.readFileSync(new URL('../src/ui/hud.js', import.meta.url), 'utf8');
  assert.match(hud, /game\.unitAttack\(u\)\} \/ \$\{u\.range\}/, '单位卡照旧读 u.range（别再手写一个 2）');
});

// ===================== ② 穿甲 2 =====================

test('② 穿甲 2：高防目标（草丛＋邻石）对照——伤害正好多 2、地形加成照旧、别的角色照旧', () => {
  const game = fixture();
  const { ghost, owner } = slots(game);
  game.s.turn = 'p2';
  // 目标＝波鲁纳雷夫**本体**（没有替身那 +2），脚下草丛、旁边一块岩石 → 防御 2 + 3 + 1 = 6
  const p1User = game.s.units.find(u => u.slot === 'p1' && u.kind === 'user');
  const spot = cleanAt(game, game.tile(ghost), 3);
  assert.ok(spot, '棋盘上要有一格离它 3 格的干净空地');
  // ⚠️ 2026-10-05：这里原来写的是 `bushByRock(game, place(p1User, spot))` —— `place()` 返回的是**单位**，
  //   而 `bushByRock` 内部要拿它去 `game.near()`（只认格子），于是那个"邻石"其实一直没铺上；
  //   旧棋盘上这一格旁边**碰巧**长着一块自然岩石，防御才凑够 6。放大棋盘后随机地形换了位置，
  //   这个 fixture 的漏洞才露出来。改成先把棋子摆上去、再把**格子**交给 helper（断言的数字一个字没动）。
  place(p1User, spot);
  bushByRock(game, spot);
  assert.equal(game.defense(p1User).total, 6, '目标防御＝基础 2 + 草丛 3 + 邻石 1');

  const pierced = game.preview(ghost, p1User);
  // 对照：**同一个出手者、同一击**，只是把那个数据字段拿掉（别的角色身上本来就没有它）
  const plain = game.preview({ ...ghost, armorPierce: 0 }, p1User);
  assert.equal(pierced.attack, plain.attack, '攻击力不变——被削的是防御，不是伤害加成');
  assert.equal(plain.defense.total, 6, '没有穿甲时，防御照旧 6');
  assert.equal(pierced.defense.total, 4, '★ 带穿甲：防御 6 → 4（正好 −2）');
  // ★ 关键口径：**只削"防御"那一个数**，草丛与邻石那两项原封不动地留在上面
  assert.equal(pierced.defense.bush, 3, '★ 草丛 +3 照旧叠加');
  assert.equal(pierced.defense.rock, 1, '★ 邻石 +1 照旧叠加');
  assert.equal(pierced.defense.base, 2, '基础防御那一项也照旧参与计算（穿甲只是在总防御上再 −2）');
  assert.equal(pierced.damage, plain.damage + 2, '★ 伤害正好比不穿甲时多 2');
  assert.equal(pierced.defense.pierce, 2, '预览里带出"穿甲 −2"，界面据此把话说清楚');
  assert.equal(plain.defense.pierce, undefined, '没有这个字段的出手方，预览一个字节都不多');
  // ★ 别的角色打**同一个目标**：照旧算满防御。
  //   同一局里最干净的对照就是**它的本体 J·凯尔**（同一个角色、同一个目标，只是那枚棋子不带字段）——
  //   顺便也就证明了"穿甲长在替身那枚棋子数据上，不是长在角色上"。
  assert.equal(game.preview(owner, p1User).defense.total, game.defense(p1User).total, '★ J·凯尔本体打同一目标：防御照旧 6');
  assert.equal(game.preview(owner, p1User).defense.pierce, undefined, '本体身上没有穿甲');
  assert.equal(game.preview(owner, p1User).damage, Math.max(1, game.preview(owner, p1User).attack - 6), '本体的伤害照旧按满防御算');
  // 战斗里真的这么结算：掉的血＝预览里那个数
  game.s.ap.p2 = 3;
  const hp0 = game.s.hp.p1;
  assert.equal(game.attack(ghost, p1User), true);
  assert.equal(hp0 - game.s.hp.p1, pierced.damage, '★ 实际掉血＝预览伤害（多出来的这 2 点是穿甲带来的）');
  assert.equal(pierced.damage, game.preview(ghost, p1User).damage, '打完再算一次，数字不变');
});

test('② 下限 0：防御会被削到 0 为止，伤害绝不会超过攻击力（不会出现负防御）', () => {
  const game = fixture();
  const { ghost, owner } = slots(game);
  game.s.turn = 'p2';
  const p1User = game.s.units.find(u => u.slot === 'p1' && u.kind === 'user');
  place(p1User, cleanAt(game, game.tile(ghost), 3));
  // ① 先看没穿甲时的原样（邻格可能贴着岩石，所以不写死数字，一律以 defense() 为准）
  const raw = game.defense(p1User).total;
  assert.ok(raw >= 2, `目标的基础防御至少是 2（实际 ${raw}）`);
  const bare = game.preview(ghost, p1User);
  assert.equal(bare.defense.total, raw - 2, '★ 带穿甲：原样 −2');
  assert.equal(bare.damage, bare.attack - bare.defense.total, '伤害＝攻击力 −（削过之后的）防御');
  assert.ok(bare.damage <= bare.attack, '★ 伤害绝不会超过攻击力');
  // ② 连基础防御都削穿了（波鲁纳雷夫卸甲 → 基础防御归零）：0/1 − 2 也要停在 0
  game.s.armorOff.p1 = true;
  const lowRaw = game.defense(p1User).total;
  assert.ok(lowRaw < 2, `卸甲后防御只剩地形那些（实际 ${lowRaw}），穿甲一定会削穿`);
  const pierced = game.preview(ghost, p1User);
  assert.equal(pierced.defense.total, 0, '★ 削穿了也停在 0，不会变成负数');
  assert.equal(pierced.damage, pierced.attack - 0, '★ 防御归零时伤害正好＝攻击力，不会凭空多出来');
  assert.ok(pierced.defense.total >= 0 && pierced.damage <= pierced.attack, '下限与上限都不许被突破');
  // ③ 真实伤害（无视防御）那条通道照旧是"防御全部归零"，穿甲根本不参与
  game.s.armorOff.p1 = false;
  const story = game.s.story;
  game.s.story = { ...story, swaps: { kakyoin: { skills: [...skillSetFor('kakyoin'), 'hamon'] } } };
  const who = game.s.units.find(u => u.slot === 'p1b' && u.kind === 'user');
  assert.equal(game.preview(who, owner, 'hamon').defense.pierce, undefined,
    '真伤（hamon）走的是另一条通道：防御全归零，不会带出"穿甲"这个字段');
  game.s.story = story;
});

test('② 数据口径：全项目只有吊死者身上有这个字段（别的角色一个数都不动）', () => {
  const carriers = Object.values(FIGHTERS).flatMap(f => [f.user, f.stand]).filter(u => u?.armorPierce);
  assert.deepEqual(carriers.map(u => u.name), ['吊死者'], '★ 只有它带 armorPierce');
  assert.equal(FIGHTERS.geil.user.armorPierce, undefined, '本体 J·凯尔不带穿甲');
  assert.equal(FIGHTERS.geil.stand.armorPierce, 2, '数值就是用户拍板的 2');
  // 引擎侧的读法是 `?? 0`：随便开一局普通对战，防御计算与改动前逐值等价
  const free = new Game({ random: seeded(13) });
  free.start('jotaro', 'dio', 'ai');
  const mine = free.s.units.find(u => u.slot === 'p1' && u.kind === 'stand');
  for (const t of free.s.units.filter(u => u.slot === 'p2')) {
    assert.equal(free.preview(mine, t).defense.total, free.defense(t).total, '普通对局里防御照旧');
  }
  assert.equal(free.armorPierceOf(mine), 0, '没有字段时读出来是 0');
  assert.equal(free.armorPierceOf(null), 0, '空单位也不许抛错');
});

// ===================== ③ 落点：未封反光点 ∪ 空岩石 =====================

const SEEDS = [13, 7919, 9421, 20261003, 555];

test('③ 落点＝未封的反光点 ∪ 未被占用的岩石格（多种子），普通空地照旧一个都落不了', () => {
  for (const seed of SEEDS) {
    const game = fixture(seed);
    const { ghost } = slots(game);
    game.s.turn = 'p2';
    const expect = landingSpots(game, ghost);
    assert.ok(rockTiles(game).length > 0, `seed ${seed}：这局棋盘上该有岩石`);
    assert.ok(expect.length > 0, `seed ${seed}：它至少要有一个落点`);
    assert.deepEqual(keys(game.reachable(ghost)), keys(expect), `seed ${seed}：落点必须正好是"未封反光点 ∪ 空岩石"`);
    // 每一格都要真的走得过去，而不是"高亮能落、点了却报错"
    for (const t of expect) assert.equal(game.moveReason(ghost, t), '', `${tileKey(t)} 应该允许落下`);
    // 两类落点都得真的出现在名单里（免得"并集"其实只剩一半）
    const list = keys(game.reachable(ghost));
    for (const m of game.openMirrors()) {
      const t = game.at(m.row, m.col);
      if (tileKey(t) !== tileKey(game.tile(ghost))) assert.ok(list.includes(tileKey(t)), '未封的反光点要在落点里');
    }
    assert.ok(rockTiles(game).every(t => list.includes(tileKey(t))), '★ 没被占用的岩石格也都要在落点里');
    // 普通空地（不是反光点、不是岩石）照旧一个都落不了
    const plain = game.tiles.find(t => !game.occupant(t) && !game.mirrorAt(t) && !game.isRock(t)
      && !game.pillarAt(t) && !game.s.terrain[tileKey(t)]);
    assert.equal(game.reachable(ghost).some(t => tileKey(t) === tileKey(plain)), false, '普通空地不是它的落点');
    assert.notEqual(game.moveReason(ghost, plain), '', '普通空地要给出理由');
    assert.equal(game.move(ghost, plain), false, '普通空地的移动要被拒');
    assert.equal(game.s.ap.p2, 3, '被拒绝的移动不能扣行动点');
  }
});

test('③ 被封的反光点、被占用的岩石（单位或柱子）都落不了', () => {
  const game = fixture();
  const { ghost } = slots(game);
  game.s.turn = 'p2';
  // ① 封掉一个它没站着的反光点
  const sealed = game.openMirrors().find(m => !(m.row === ghost.row && m.col === ghost.col));
  const sealedTile = game.at(sealed.row, sealed.col);
  assert.equal(game.sealMirror(sealedTile, 'p1'), true);
  assert.equal(game.reachable(ghost).some(t => tileKey(t) === tileKey(sealedTile)), false, '★ 被封的点不再是落点');
  assert.notEqual(game.moveReason(ghost, sealedTile), '', '落上去要被拒');
  assert.equal(game.move(ghost, sealedTile), false);
  assert.equal(game.s.ap.p2, 3, '没扣行动点');
  // ② 空岩石照旧能落；一旦被**柱子**占着就落不了
  const rockA = rockTiles(game).find(t => game.moveReason(ghost, t) === '');
  assert.ok(rockA, '场上该有一块能落的空岩石');
  pillarOn(game, 'p1', rockA);
  assert.equal(game.reachable(ghost).some(t => tileKey(t) === tileKey(rockA)), false, '★ 柱子占着的岩石落不了');
  assert.match(game.moveReason(ghost, rockA), /占/, '理由要说清"被占着"');
  // ③ 被**单位**占着的岩石同样落不了
  const rockB = rockTiles(game).find(t => game.moveReason(ghost, t) === '');
  assert.ok(rockB, '还得有第二块空岩石');
  place(slots(game).foe, rockB);
  assert.equal(game.reachable(ghost).some(t => tileKey(t) === tileKey(rockB)), false, '★ 单位占着的岩石落不了');
  assert.notEqual(game.moveReason(ghost, rockB), '');
  // ④ 柱子／单位本身站的那一格也不会变成落点
  for (const t of game.tiles.filter(t => game.pillarAt(t))) {
    assert.equal(game.mirrorLanding(t), false, '柱子占着的格子不是落点');
  }
});

test('③ 开局它仍然站在一个反光点上（多种子），本体照常站位', () => {
  for (const seed of SEEDS) {
    const game = fixture(seed);
    const { ghost, owner } = slots(game);
    const mine = game.mirrorAt(game.tile(ghost));
    assert.ok(mine, `seed ${seed}：★ 开局必须站在反光点上（实际在 ${ghost.row},${ghost.col}）`);
    assert.equal(mine.sealed, false, '开局那个点当然是没封的');
    assert.equal(CHARACTER_ART.geil.stand, 'hanged_man', '（顺带）它还是那枚替身棋子');
    assert.equal(game.isRock(game.tile(ghost)), false, '★ 开局不站在岩石上：扩的是落点，不是开局站位');
    assert.equal(game.mirrorAt(game.tile(owner)), null, '本体照常站在常规位置上，不占反光点');
  }
});

// ===================== ④ 岩石上的它：能打、能跳 =====================

test('④ 岩石上的它：能被攻击（含剑刃），也能从岩石跳到反光点／另一块岩石', () => {
  const game = fixture();
  const { ghost, foe } = slots(game);
  game.s.turn = 'p2';
  const rocks = rockTiles(game).filter(t => game.moveReason(ghost, t) === '');
  assert.ok(rocks.length >= 2, '场上至少要有两块能落的空岩石');
  // 反光点 → 岩石
  assert.equal(game.move(ghost, rocks[0]), true, '★ 从反光点跳到岩石上');
  assert.equal(game.isRock(game.tile(ghost)), true);
  assert.equal(game.s.ap.p2, 2, '花 1 AP（无视距离）');
  // 岩石 → 另一块岩石
  game.s.ap.p2 = 3;
  const other = rocks.find(t => tileKey(t) !== tileKey(game.tile(ghost)));
  assert.equal(game.move(ghost, other), true, '★ 岩石 → 另一块岩石');
  assert.equal(game.isRock(game.tile(ghost)), true);
  // 岩石 → 反光点
  game.s.ap.p2 = 3;
  const back = game.openMirrors().map(m => game.at(m.row, m.col))
    .find(t => !game.occupant(t) && tileKey(t) !== tileKey(game.tile(ghost)));
  assert.ok(back, '场上该还有一个空着的反光点');
  assert.equal(game.move(ghost, back), true, '★ 岩石 → 反光点');
  assert.ok(game.mirrorAt(game.tile(ghost)), '又站回反光点上了');
  // 站回岩石上，验证它**挨打**：把银色战车贴到旁边
  game.s.ap.p2 = 3;
  const perch = rocks.find(t => game.moveReason(ghost, t) === '');
  assert.equal(game.move(ghost, perch), true);
  const spot = game.near(game.tile(ghost)).find(n => !game.occupant(n) && !game.isRock(n) && !game.pillarAt(n));
  assert.ok(spot, '脚边要有一格干净的空地摆对手');
  place(foe, spot);
  game.s.turn = 'p1';
  assert.equal(game.attackReason(foe, ghost), '', '★ 岩石上的它照样是合法目标');
  assert.ok(game.bladeTargets(foe).includes(ghost), '★ 剑刃也够得到它（"岩石挡路"挡的是推进，不是站在上面的单位）');
  const hp0 = game.s.hp.p2;
  assert.equal(game.attack(foe, ghost), true, '★ 站在岩石上照常挨打');
  assert.ok(game.s.hp.p2 < hp0, '这一下真的打出去了');
  // 石头上也照旧算它的防御（**地形加成与它自己那 1 点替身防御都在**，与改动前一致）
  assert.equal(game.defense(ghost).total, FIGHTERS.geil.def + FIGHTERS.geil.standDefBonus
    + (game.s.terrain[tileKey(game.tile(ghost))] === 'bush' ? 3 : 0), '岩石格上不额外给防御，也不额外扣');
});

test('④ 渲染：栖在岩石上的一帧画得完、有"立足标记"、save/restore 配平', () => {
  const render = fs.readFileSync(new URL('../src/ui/render.js', import.meta.url), 'utf8');
  assert.match(render, /drawPerch\(g, t, time\) \{/, '★ 岩石上的立足标记要有独立实现（照 drawMirror 的写法）');
  assert.match(render, /if \(this\.game\.mirrorWalker\?\.\(u\) && this\.game\.isRock\?\.\(this\.game\.tile\(u\)\)\) this\.drawPerch/,
    '★ 它站在岩石上时真的会调到（否则那一圈亮边永远不出现）');
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
    const { ghost } = slots(game);
    const visual = new BoardVisual(game);
    game.s.turn = 'p2';
    // 把它挪到一块岩石上，再画一整帧
    const rock = rockTiles(game).find(t => game.moveReason(ghost, t) === '');
    assert.equal(game.move(ghost, rock), true);
    game.select(ghost.id);
    const from = calls.length;
    assert.doesNotThrow(() => visual.render(game.actionView(), 0), '它站在岩石上的一帧不该抛错');
    const drawn = calls.slice(from);
    // 立足标记那两笔：椭圆亮边（ellipse）＋描边（stroke）——棋子画在它上面，所以不会被岩石糊住
    assert.ok(drawn.some(c => c.prop === 'ellipse'), '要先画那圈立足亮边');
    // 底图（地形，含岩石图）那一张是**整帧的第一笔**：地形在下、立足标记与棋子在上
    assert.equal(drawn[0]?.prop, 'drawImage', '第一笔是把底图（地形层）贴上来');
    assert.equal(drawn[0].args.length, 9, '底图那一次 drawImage 是 9 个参数（源图 → 画布）');
    const perchAt = drawn.findIndex(c => c.prop === 'ellipse');
    assert.ok(perchAt > 0, '立足标记要排在底图之后（压住岩石那几张图的碎边）');
    // ⚠️ 假 canvas 里立绘资源是空的（`outlined` 没有图），棋子那一笔会走 fillText 兜底，
    //    所以"棋子在标记之上"这件事**用源码顺序来钉**（同一个 units 循环里紧挨着排在它前面）：
    assert.match(render,
      /this\.drawPerch\(g, t, time\);\s*\n\s*this\.drawUnit\(g, t, u, view\.selected\?\.id === u\.id, time\);/,
      '★ 立足标记必须与棋子排在同一个循环里、紧挨着在它之前（棋子才压在标记之上）');
    const saves = drawn.filter(c => c.prop === 'save').length, restores = drawn.filter(c => c.prop === 'restore').length;
    assert.equal(saves, restores, 'save / restore 必须配平，否则后面的绘制会被裁切');
    // 单独调一次 drawPerch：不抛错、save/restore 也配平
    const before = calls.length;
    assert.doesNotThrow(() => visual.drawPerch(visual.ctx, game.tile(ghost), 0));
    const solo = calls.slice(before);
    assert.equal(solo.filter(c => c.prop === 'save').length, solo.filter(c => c.prop === 'restore').length, 'drawPerch 自己的 save/restore 要配平');
    assert.ok(solo.filter(c => c.prop === 'lineTo').length >= 2, '两道立足反光要画出来');
  } finally {
    if (previous === undefined) delete globalThis.document; else globalThis.document = previous;
    if (previousWindow === undefined) delete globalThis.window; else globalThis.window = previousWindow;
  }
});

// ===================== ⑤ AI 能打完 + 界面接线 =====================

test('⑤ 第八章阶段 2 的 AI 能自动打完（多种子，别死循环）：它只站在反光点或岩石上', () => {
  for (const seed of [...SEEDS, 7, 2024, 31415, 99991, 123456]) {
    const game = fixture(seed);
    const { ghost } = slots(game);
    let guard = 0;
    while (game.s.phase === 'battle' && guard++ < 1500) {
      const plan = chooseAI(game);
      if (!plan || !playAIAction(game, plan)) game.endTurn();
      const t = game.tile(ghost);
      assert.ok(game.mirrorAt(t) || game.isRock(t),
        `seed ${seed} 第 ${guard} 步：吊死者站在了既不是反光点也不是岩石的格子上（${t.row},${t.col}）`);
      assert.ok(!game.occupant({ row: -99, col: -99 }), '（占位：occupant 对越界格不抛错）');
    }
    assert.ok(guard < 1500, `★ seed ${seed} 的这局没打完（走了 ${guard} 步，说明它卡住了）`);
    assert.equal(game.s.phase, 'result', `seed ${seed} 要分出胜负`);
    assert.ok(['p1', 'p2'].includes(game.s.winner), '胜负落在某一队上');
  }
});

test('⑤ 界面接线：单位卡与格子说明都跟着改了（静态检查 + 运行时文案）', () => {
  // ① 格子说明：反光点改成"落点之一"，岩石格要写明"吊死者也能栖在这一格"
  const game = fixture();
  const { ghost } = slots(game);
  const mirrorTile = game.at(game.s.mirrors.find(m => !(m.row === ghost.row && m.col === ghost.col)).row,
    game.s.mirrors.find(m => !(m.row === ghost.row && m.col === ghost.col)).col);
  assert.match(tileDescription(game, mirrorTile), /反光点/, '反光点照旧要说清楚');
  assert.match(tileDescription(game, mirrorTile), /吊死者/, '……以及它是吊死者的落点');
  const rock = rockTiles(game)[0];
  assert.match(tileDescription(game, rock), /岩石/, '岩石格照旧报地形名');
  assert.match(tileDescription(game, rock), /吊死者也能栖在这一格/, '★ 岩石格要说明"它也能落在这里"');
  // 别的章节（没有反光点机制）不许冒出这一句
  const other = new Game({ random: seeded(13) });
  other.start('jotaro', 'dio', 'ai');
  assert.equal(tileDescription(other, rockTiles(other)[0]).includes('吊死者'), false, '别的模式不许提吊死者');
  // ② 瞄准预览：穿甲那 2 点要在界面上说清楚（否则玩家以为界面算错了）
  const p1User = game.s.units.find(u => u.slot === 'p1' && u.kind === 'user');
  place(p1User, game.near(game.tile(ghost)).find(n => !game.occupant(n) && !game.isRock(n)) || game.tile(ghost));
  game.s.turn = 'p2';
  game.select(ghost.id);
  game.chooseAction('attack');
  const view = hoverPreview(game, game.tile(p1User), p1User);
  assert.match(view.content, /穿甲 −2/, '★ 预览要写出"穿甲 −2"');
  assert.match(view.content, /damage-preview">−\d+</, '预览照旧给出伤害数字');
  // ③ hud 的静态接线：镜面跳跃那一栏、移动那一栏都别再写"只在反光点之间跳"
  const hud = fs.readFileSync(new URL('../src/ui/hud.js', import.meta.url), 'utf8');
  assert.match(hud, /镜面跳跃 · 无视距离（落点：反光点 \/ 岩石）/, '连携那一栏要写清两类落点');
  assert.match(hud, /在反光点与岩石之间跳（无视距离）/, '单位卡上"移动"那一栏的说明也要跟上');
  assert.match(hud, /armorPierceOf/, '单位卡要能显示"穿甲 N"');
  // ④ 角色说明与本章规则（文案一起改，别只改代码）
  assert.match(CHARACTER_ART.geil.brief, /3 格射程/, '★ 角色说明要写新的射程');
  assert.match(CHARACTER_ART.geil.brief, /2 点穿甲/, '★ 角色说明要写穿甲');
  assert.match(CHARACTER_ART.geil.brief, /岩石/, '★ 角色说明要写"岩石里也能待"');
  assert.equal(/它只走反光的地方/.test(CHARACTER_ART.geil.brief), false, '旧的"只走反光的地方"必须改掉');
  const rules = (phase2.specialRules || []).join('');
  for (const piece of ['反光点', '跳多远都行', '射程是 3 格', '2 点穿甲', '岩石', '−2']) {
    assert.match(rules, new RegExp(piece), `阶段 2 的本关规则缺"${piece}"`);
  }
  assert.equal(MIRRORS.name, '反光点', '（口径）界面上那三个字由数据给');
});
