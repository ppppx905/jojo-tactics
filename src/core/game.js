import { makeTiles, buildIndex, neighbors, hexDist, tileKey, tileLabel, ROWS, COLS, mirrorCol, MID_ROW } from './hex.js';
import { RULE, FIGHTERS, SKILLS, STORY_CHAPTERS, STRENGTH, EBONY, TEMPERANCE, MIRRORS, SNIPER, MAPS, DEFAULT_MAP_ID, resolveMapId, mapList, deckRectOf, skillSetFor, playableFighters, isBoss, SEA_DECK, ITEM_TYPES, ITEM_RULE, resolveItemRule } from './rules.js';

/** 剑刃的六个直线方向（轴向 q/r 增量）。 */
const BLADE_DIRS = [[1, 0], [-1, 0], [0, 1], [0, -1], [1, -1], [-1, 1]];

/**
 * ★★ 开局站位表——**摆放规则只在这一处**。
 *
 * 坐标系统（18 列 × 13 行，2026-10-05 放大后）：
 *   · **摆放行**：棋盘**正中的那一行** ＝ `DEPLOY_ROW`（13 行 → 第 6 行；旧 11 行时是第 5 行，由 ROWS 算出来，别手写）；
 *   · **镜像列**：P2 的列**一律**由 P1 的列算出来 —— `mirrorCol(列) = COLS - 1 - 列`（18 列时就是 **17 − 列**）。
 *     ⚠️ 改动前这里把 P2 的列手写了一遍（14 列时代是 `13 − 列`）；放大到 18 列之后手写必错，
 *        所以现在只写 P1 一侧，P2 一侧由 `mirrorCol()` 推导 —— 两边永远严格镜像。
 *
 * | 局面 | P1 第一枚 / 第二枚（使者 / 替身） | 对应列 | P2（由镜像列算出） |
 * |------|-----------------------------------|--------|--------------------|
 * | 1v1          | 3 / 5 | 3、5     | 14 / 12 |
 * | 2v2 第一个角色 | 5 / 7 | 5、7     | 12 / 10 |
 * | 2v2 第二个角色 | 1 / 3 | 1、3     | 16 / 14 |
 *
 * 四条硬约束（改这张表之前先确认它们还成立）：
 *   ① 每枚棋子都要落在**合法且不重叠**的格子上（行固定 `DEPLOY_ROW`，列见上表）；
 *   ② **双方严格镜像**：`P2 列 === mirrorCol(P1 列)`，而且行相同（`tests/board-size.test.js` 逐枚核对）；
 *   ③ 每个角色自己的两枚棋子距离 ≤ 该角色的 `distLimit`（同排隔 2 列 = 距离 2，最紧的承太郎/DIO 也是 2），
 *      所以每一对都必须**恰好隔 2 列**；
 *   ④ 1v1 的四枚棋子要落在**合理的相对位置**：离左右边各 3 列（不挤边缘）、
 *      使者朝外、替身朝内（替身更靠中线），两名使者之间隔 11 列（不贴脸，约 3 个移动回合接敌）。
 */
const DEPLOY = {
  solo: { user: 3, stand: 5 },
  pair: { user: 5, stand: 7 },
  outer: { user: 1, stand: 3 },
};

/** 摆放行 ＝ 棋盘**正中的那一行**（13 行 → 6；11 行 → 5）。由 ROWS 算，别写死。 */
const DEPLOY_ROW = MID_ROW;

/**
 * ★★ 野外地形的**面积换算基准**：**按棋盘面积给足**（2026-10-05 棋盘 14×11 → 18×13 时定的口径）。
 *
 * 由来：岩石/草丛/恢复点/毒沼原本是按 14×11 = **154 格**配的（6 / 4 / 2 / 2）。
 * 棋盘放大到 18×13 = **234 格**后，如果数量不变，密度就掉了 1/3——地形变成稀稀拉拉的摆设。
 * 所以数量**只按面积等比放大**（比值 234/154 ≈ 1.52，四舍五入取整）：
 *   岩石 9 / 草丛 6 / 恢复点 3 / 毒沼 3（合计 21 块，旧棋盘是 14 块）。
 *
 * ⚠️ 三条别改错：
 *   ① **只放大数量，判据一个字没动**——仍然"不与任何单位的出生点相邻（`hexDist > 1`）"、
 *      仍然从所有合法空格里随机挑（见 `generateTerrain()`）；船体关卡照旧一块都不撒；
 *   ② 地形**效果**（岩石阻挡通行/相邻 +1 防、草丛 +3 防、恢复 +10、毒沼 −3）一个数都没动；
 *   ③ 写成"基线 × 面积比"的算式而不是把 9/6/3/3 写死：以后棋盘再变，改 COLS/ROWS 就够。
 *
 * ★★ 2026-10-05 加地图体系：**那份"基线"从这里的常量搬进了地图数据**
 *    （`rules.js` 的 `MAPS.default.terrain` ＝ `{ rock: 6, bush: 4, heal: 2, hazard: 2 }`，
 *     一个数都没变），因为每张地图各有各的元素与数量。留在 game.js 的只有这个**换算基准**——
 *    它是"棋盘有多大"的属性，不是"哪张地图"的属性。
 */
const TERRAIN_BASE_AREA = 154;

/**
 * 道具加成表的"空值"：**永远是同一个冻结对象**，读不出东西时返回它，
 * 于是调用方（`moveRange` / `baseDefense` / `damageBonus` / `distLimit`）不用到处写 `?.` 与 `|| 0`。
 */
const NO_ITEM_BUFF = Object.freeze({ atk: 0, def: 0, move: 0, dist: 0 });

/**
 * 算出一个槽位的某一枚棋子该站在哪。
 * 单单位角色（乔瑟夫）没有替身棋子，让他直接站在**原本替身的位置**（离中线更近一些）。
 */
function deploySpot(slot, fighter, kind, twoSided = false) {
  const team = teamOf(slot);
  const line = !twoSided ? DEPLOY.solo : (slotIndex(slot) ? DEPLOY.outer : DEPLOY.pair);
  const column = (kind === 'user' && !fighter.stand) ? 'stand' : kind;
  const p1Col = line[column];
  return { row: DEPLOY_ROW, col: team === 'p1' ? p1Col : mirrorCol(p1Col) };
}

export { RULE, FIGHTERS, SKILLS, STORY_CHAPTERS, STRENGTH, EBONY, TEMPERANCE, MIRRORS, SNIPER, MAPS, DEFAULT_MAP_ID, resolveMapId, mapList, deckRectOf, SEA_DECK, skillSetFor, playableFighters, isBoss, ITEM_TYPES, ITEM_RULE, resolveItemRule };

/**
 * ★★ 2v2（PvP 双人同屏）——**槽位（slot）**模型：
 *
 * 一方不再是"一个角色"，而是 **1 个或 2 个角色**，每个角色各占 2 枚棋子（本体 + 替身）。
 * 每个角色有一个**槽位名**：第一个角色沿用旧的 `'p1'` / `'p2'`，第二个角色是 `'p1b'` / `'p2b'`。
 * 所以：
 *   · 1v1（默认）＝ `s.slots = ['p1', 'p2']`——**旧的 `s.hp.p1`、`s.turn === 'p2'`、
 *     七章剧情、181 条测试全部一个字都不用改**；
 *   · 2v2 ＝ `s.slots = ['p1', 'p1b', 'p2', 'p2b']`。
 *
 * 棋子对象上：`side` 仍然是**队别**（渲染配色、瞄准、AI 都在用它），
 * 另外新增 `slot` 表示"它属于哪个角色"；**血量 / 行动点 / 冷却 / 灼烧…一律按 `slot` 记账**。
 * `s.turn` 也从"队别"变成了**槽位**（出手顺序见 `turnOrder()`）。
 *
 * ★★ 人机／真人是**逐槽位**的（`s.control`，见 `start()` 与 `isAI()`）：
 * 一方不再整体"是电脑"或"是玩家"——`s.control[槽位]` 才是唯一口径，
 * 所以"人机对战"与"双人同屏"其实是同一个模式，只是每个位子的 control 不同。
 */

/** 某个槽位属于哪一队。**队别只在这一处推导**，别在几十个地方手写前缀判断。 */
export const teamOf = slot => (String(slot).startsWith('p1') ? 'p1' : 'p2');
/** 槽位的序号（0 = 第一个角色，1 = 第二个角色）；界面拿它显示"第几个角色"。 */
export const slotIndex = slot => (String(slot).endsWith('b') ? 1 : 0);
/** 槽位在**文字**里的叫法：`'p1'` → `'P1'`（1v1 与改动前完全一样），`'p1b'` → `'P1·2'`。
 *  日志、状态提示、回合横幅都用它，2v2 里才看得出"是哪个角色在动"。 */
export const slotName = slot => {
  const team = teamOf(slot).toUpperCase();
  return slotIndex(slot) ? `${team}·2` : team;
};
/** 槽位的记账键：`'p1' ↔ 'p2'`。可以传槽位（`'p1b'` → `'p2'`）也可以传队别。 */
export const otherSide = side => (teamOf(side) === 'p1' ? 'p2' : 'p1');

/** Rules and authoritative state. No DOM, timers, audio or drawing in this module. */
export class Game {
  constructor({ random = Math.random, onEvent = () => {} } = {}) {
    this.random = random;
    this.onEvent = onEvent;
    this.tiles = makeTiles();
    this.index = buildIndex(this.tiles);
    this.revision = 0;
    this.epoch = 0;
    /** 这一局的第二对角色（2v2 用，见 setRoster）；null ＝ 1v1。 */
    this.roster = null;
    /** ★ 每个角色槽位由谁控制（见 setRoster 与 `s.control`）；null ＝ 按 mode 推断默认值。 */
    this.control = null;
    /** ★★ 这一场属于哪一幕（见 setRoster 的 `scene`）；null ＝ 老口径（s.story 就是章节对象）。 */
    this.storyScene = null;
    /** ★★ 自由对局在大厅里选的**地图**（见 setMap）；null ＝ 没选（用 default）。 */
    this.requestedMap = null;
    this.reset();
  }

  /**
   * ★★ 登记这一局的**第二对角色**与**每个位子由谁控制**（大厅选好人之后、`start()` 之前调用一次）。
   *
   * 为什么不加参数？`start(p1, p2, mode, options)` 的调用点
   * （main.js 里那一行 `game.start(draft.p1, draft.p2, draft.mode, { story: draft.story })`）
   * 被 tests/title-screen.test.js 用正则钉住了，所以第二个角色与控制表走这里登记，而不是改签名。
   * 登记的内容在 `start()` 里校验：必须是**可选角色**（boss 不行）、而且**两边都要给**——
   * 只给一边会被拒（绝不做"2 打 1"这种半成品）。`start()` 用完之后会把它清掉（席位只对那一局有效）。
   *
   * ★ `control` 是**按槽位**的控制表（`{ p1: 'human' | 'ai', p2: ..., p1b: ..., p2b: ... }`）：
   *   · 只有参战的槽位有键，`start()` 里按 `s.slots` 收敛一次，界面拿到的表与槽位表永远一致；
   *   · **不登记就用兼容默认值**：`mode === 'ai'` 时 P2 侧是人机、P1 侧是真人（＝改动前的口径），
   *     否则两边都是真人。所以旧调用点（不传 control）行为一个字都不变；
   *   · 剧情模式**忽略**它：剧情永远是"玩家真人 / 敌方人机"（见 start()）。
   *
   * ★★ 2026-10-03（第八章改两阶段）：`scene` 是**这一场战斗所属的那一幕**（`chapter.scenes[i]`）。
   *   一章里有两场战斗时，两场的阵容（`lineup`）与机制旗标（`sniper` / `mirrors` / `phaseWin` /
   *   `specialRules` / `barks`，以及第四条新加的 `buff` / `hpFloor` / `storyLoss`）都写在**幕**上，
   *   所以 start() 会把它并进 `s.story`。
   *   ⚠️ 没传 `scene` 时 `s.story` 就是章节对象本身（与改动前逐值相同，老七章一字不变）。
   */
  setRoster(roster = null) {
    const hasSecond = !!(roster && (roster.p1b || roster.p2b));
    this.roster = hasSecond ? { p1b: roster.p1b || null, p2b: roster.p2b || null } : null;
    this.control = roster?.control ? { ...roster.control } : null;
    // ★ 剧情章节**自己写死的**席位（2026-10-03 为第八章「两个敌人 + 电脑友军」加的）：
    //   自由对局的席位由玩家选，所以第二个角色必须是可选角色（不能是剧情 boss）；
    //   而章节自己写的席位是作者定的，**允许用 boss**，控制表也可以缺省（引擎给默认值）。
    this.authoredRoster = hasSecond && roster?.story === true;
    /** ★ 这一场属于哪一幕（只有剧情模式会传；见 start() 里对 s.story 的合并）。 */
    this.storyScene = roster?.scene || null;
    return this;
  }
  /**
   * ★★ 2026-10-05 用户拍板：**登记自由对局要用的地图**（大厅选好地图之后、`start()` 之前调一次）。
   *
   * 为什么和 `setRoster()` 一样不加参数？`start(p1, p2, mode, options)` 的调用点
   * （main.js 里那一行）被 tests/title-screen.test.js 的正则钉住了，所以地图也走"登记"这条路。
   *
   * 三条口径：
   *   ① 认不出的地图名**不抛错**：`resolveMapId()` 把它收敛成 `default`（大厅与网址参数都靠它兜底）；
   *   ② 登记的内容**只在自由对局生效**——剧情章节自带地图（`STORY_CHAPTERS[].map`），
   *      所以剧情模式下登记值被忽略（第四章不会因为玩家在大厅点过别的图而换掉海面）；
   *   ③ 登记值在 `start()` 里消耗掉（地图只对那一局有效），与 roster / control 同一套写法。
   */
  setMap(mapId = null) {
    this.requestedMap = mapId == null ? null : resolveMapId(mapId);
    return this;
  }
  /** 这一局用的**地图数据**（`MAPS` 里的一项）。永远有值——认不出的键在 start() 里已经退回 default。 */
  map() { return MAPS[this.s.mapId] || MAPS[DEFAULT_MAP_ID]; }
  /** 这一局用的地图键（渲染层的静态层缓存键也读它，见 ui/render.js 的 baseStateKey）。 */
  mapId() { return this.s.mapId || DEFAULT_MAP_ID; }
  /** 某个角色名能不能当"第二个角色"（存在、且不是剧情 boss）——自由对局用。 */
  static secondUsable(key) { return !!key && !!FIGHTERS[key] && !FIGHTERS[key].boss; }
  /** 按来源挑"能不能当第二个角色"的判据：章节写死的席位只要求角色存在。 */
  secondUsableHere() { return this.authoredRoster ? (key => !!key && !!FIGHTERS[key]) : Game.secondUsable; }
  /**
   * 这一局的槽位表。
   * · **自由对局**：必须两边都有合法的第二人才做 2v2，否则就是 1v1 的两个槽位
   *   （"配置不完整就直接拒绝开局"的校验在 `start()` 里，这里只负责把槽位表算出来）。
   * · ★★ **章节自己写死的席位**（`authoredRoster`）按"哪一边有第二人"逐个加槽位——
   *   第八章阶段 2 就是这种局面：玩家侧两个角色（波鲁纳雷夫 ＋ 电脑友军花京院）、
   *   敌方只有 J·凯尔一个。槽位因此是 `['p1', 'p1b', 'p2']`（**2 打 1**）。
   *   ⚠️ 自由对局那条"绝不 2 打 1"的老规矩一个字都没变（`authoredRoster === false` 时走上面那条）。
   */
  slotsFor(roster = this.roster) {
    const usable = this.secondUsableHere();
    if (this.authoredRoster) {
      const slots = ['p1'];
      if (usable(roster?.p1b)) slots.push('p1b');
      slots.push('p2');
      if (usable(roster?.p2b)) slots.push('p2b');
      return slots;
    }
    return usable(roster?.p1b) && usable(roster?.p2b) ? ['p1', 'p1b', 'p2', 'p2b'] : ['p1', 'p2'];
  }
  /** 这一局是不是 2v2（一方两个角色）。界面用它决定要不要显示两行角色信息。 */
  twoSided() { return this.s.slots.length > 2; }
  /** 某一队的全部槽位（顺序＝第一个角色、第二个角色）。 */
  teamSlots(team) { return this.s.slots.filter(slot => teamOf(slot) === team); }
  /**
   * 出手顺序：**交错**——P1 第一个角色 → P2 第一个角色 → P1 第二个角色 → P2 第二个角色。
   * 1v1 时就是 `['p1', 'p2']`（与改动前完全一致）。
   */
  turnOrder() {
    const teams = ['p1', 'p2'].map(team => this.teamSlots(team));
    const depth = Math.max(...teams.map(list => list.length));
    const order = [];
    for (let i = 0; i < depth; i++) for (const list of teams) if (list[i]) order.push(list[i]);
    return order;
  }
  /** 这个槽位还站着吗（血量 > 0）。 */
  slotAlive(slot) { return (this.s.hp[slot] ?? 0) > 0; }
  /**
   * ★★ 这个槽位由谁控制：`'human'`（等真人操作）或 `'ai'`（自己行动）。
   * 不传参数就是**当前行动的那个位子**——界面里所有"该不该等玩家点按钮"的判断都走它，
   * 不要再写"mode === 'ai' 且 turn === 'p2'"那种按整方判断的老写法（2v2 里会错一半）。
   * 表还没建好（重置后、开局前）时一律当真人：那时没有任何 AI 在跑。
   */
  controlOf(slot = this.s.turn) { return this.s.control?.[slot] === 'ai' ? 'ai' : 'human'; }
  /** 这个位子是不是人机（`controlOf` 的布尔写法，界面与驱动循环用起来更顺手）。 */
  isAI(slot = this.s.turn) { return this.controlOf(slot) === 'ai'; }
  /** 这一局里有没有人机位（＝兼容字段 `s.mode === 'ai'`）。 */
  hasAI() { return this.s.slots.some(slot => this.isAI(slot)); }
  /** 是不是四个位子全是人机（＝挂着看两边自己打完的"观战"）。 */
  allAI() { return this.s.slots.length > 0 && this.s.slots.every(slot => this.isAI(slot)); }
  /** ★ 这个位子所在的**那一队**里有没有真人（2026-10-03 用户定：认输按队算，不按当前位子算）。
   *  于是"P1①真人 + P1②人机"时，轮到人机的 P1② 也照样能替本队认输；四个位子全人机时谁都认不了。 */
  teamHasHuman(slot = this.s.turn) {
    const team = teamOf(slot);
    return this.s.slots.some(s => teamOf(s) === team && !this.isAI(s));
  }
  /**
   * 下一个出手的槽位：按交错顺序往下走，**跳过已经倒下的角色**。
   * 1v1 时永远等价于 `otherSide(当前方)`。
   */
  nextSlot(from = this.s.turn) {
    const order = this.turnOrder();
    const at = Math.max(0, order.indexOf(from));
    for (let step = 1; step <= order.length; step++) {
      const slot = order[(at + step) % order.length];
      if (this.slotAlive(slot)) return slot;
    }
    return from;
  }

  // ================= 角色被打倒：棋子离场、**让出格子** =================
  /**
   * ★★ 角色被打倒（该槽位**共享生命归零**）→ 把他这一场的棋子从棋盘上**移除**，让出格子。
   *
   * 2026-10-04 用户报的 bug（原话）：「双人对战死了会占位置」——2v2 里一个角色被打倒之后，
   * 他那两枚棋子还留在棋盘上（只是被画成压暗的"尸体"），于是**继续挡路**：别的棋子走不过去、
   * 也落不上去。1v1 时因为这一局立刻结束，看不出来。
   * ⚠️ 这正是当初 2v2 上线时**记在案的取舍**（"尸体留在棋盘、仍挡路"），用户现在要求改掉——
   *    所以这里是**替换**那套取舍，不是又加一层新机制。
   *
   * 写法照第七章 `unmaskIfNeeded` 那一套（过滤 `s.units` ＋ 必要的状态清理 ＋ 事件 ＋ `touch()`），
   * **不另立一套并行的状态**：
   *   · **只拿掉这一个槽位自己的棋子**（本体与替身；单单位角色只有一枚）——对手的棋子、宝石柱、
   *     火焰、反光点、船体要害**一概不动**（柱子／火焰／要害各有各的归属）；
   *   · 通行与落点的判据本来就全读 `occupant()`（＝`s.units` ＋ `s.pillars`），所以"移除即让路"
   *     **不需要改任何**移动／路径阻挡／连携距离／射程代码——那几处自然跟着对；
   *   · ★ 第八章「反光点」那一幕也一样：吊死者栖着的**反光点／岩石格**在这一刻就空出来
   *     （`mirrorOpenFor()` / `mirrorLanding()` 读的正是 `occupant()`）；
   *   · 正在选中／瞄准的如果就是被拿掉的那一枚，选区一起清掉（免得界面盯着一枚不存在的棋子）；
   *   · 报一条 `status`（进战斗记录）＋ 一条 `notice`，**不写进台词**（台词有"零机制词"的硬规矩）。
   *
   * ⚠️ 调用时机见 `damage()`：**先移除、再判胜负**（在调用方的 `checkEnd()` 之前）。
   *   于是"两个都倒下才判负"的既有口径一个字没变；1v1 判负时也只是"结束前先腾了格子"，
   *   **结束的时机与结果照旧**（既不提前也不延后）。
   */
  removeFallenSlot(slot) {
    const s = this.s;
    if (s.phase !== 'battle' || !slot || this.slotAlive(slot)) return false;
    const gone = s.units.filter(u => u.slot === slot);
    if (!gone.length) return false;
    s.units = s.units.filter(u => u.slot !== slot);
    if (s.selectedId && gone.some(u => u.id === s.selectedId)) this.clearSelection();
    // 文案口径与 `unmaskIfNeeded` 那条同一取法：`label` 是"XX & YY"（单单位角色就是"XX"）
    const who = this.fighter(slot)?.label || gone[0].name;
    this.emit('status', { side: slot, slot, text: `${who} 倒下了 · 棋子离场，让出了位置` });
    this.notice(`${who} 倒下了 · 它让出了位置。`, 'warn');
    this.touch();
    return true;
  }

  reset() {
    this.epoch++;
    // ★ 1v1 → ['p1','p2']；2v2 → ['p1','p1b','p2','p2b']。
    //   `pair()` 在这里按槽位建对象，于是 1v1 下 `s.hp` 依旧是 `{ p1, p2 }`，旧代码与旧测试全都不动。
    const slots = this.slotsFor();
    const pair = value => Object.fromEntries(slots.map(slot => [slot, typeof value === 'function' ? value() : value]));
    this.s = {
      slots,
      phase: 'select', mode: 'hotseat', turn: 'p1', turnNumber: 1,
      // ★★ 这一局用的是哪张**地图**（`MAPS` 的键，见 rules.js 的地图注册表）。
      //   `start()` 里解算一次（剧情＝章节自带的 `map`，自由对局＝大厅登记的 `setMap`，
      //   都没有就是 default），之后整局只读它：地形撒法、背景画、水域与甲板
      //   （`deckRect()` / `isWaterTile()` / `moveRange()`）全部由这一个键推出来——
      //   **地图差异只在这一处收敛**，别在别处写 if。
      //   reset() 之后是 default，所以"还没开局"时一切判据都退化成"没有特色地形"的普通陆战。
      mapId: DEFAULT_MAP_ID,
      // ★★ 每个槽位由谁控制：`{ p1: 'human' | 'ai', … }`，**只有参战的槽位有键**。
      //   由 start() 按 setRoster 登记的控制表（或 mode 的兼容默认值）填好；
      //   凡是"这个位子该不该自动行动"的判断都读它（`isAI()`），不要再按整方判断。
      control: {},
      units: [], fighters: {}, hp: pair(0), ap: pair(0), turnAP: pair(RULE.apPerTurn),
      terrain: {}, bushTimer: {}, pillars: [], fire: [], cd: pair(() => ({})),
      // ★★ 2026-10-05 用户拍板：**可拾取的道具**（地形交互的第二层，数值见 rules.js 的 ITEM_TYPES）。
      //   又是**一层独立状态**，同样不塞进 `s.terrain`（地形那一套有岩石／草丛／恢复点／毒沼的既有分支）：
      //     · `items`＝场上还没被捡走的道具，每项 `{ id, type, name, row, col, turn }`；
      //     · `itemBuffs`＝**按角色槽位**记的永久加成 `{ atk, def, move, dist }`——一个角色捡到，
      //       他的本体与替身一起吃到（与项目既有的"按 slot 记账"一致）；不是全局、也不是按队。
      //       ⚠️ 「时间」那件**不进这张表**：它是"当场 +1 行动点"，身上没有可常驻的加成。
      items: [], itemBuffs: pair(() => ({ ...NO_ITEM_BUFF })),
      // ★★ 第八章「反光点」（用户 2026-10-03 定）：每项 `{ id, row, col, sealed }`。
      //   ⚠️ **不塞进 `s.terrain`**——地形那一套有岩石／草丛／恢复点／毒沼的既有分支，
      //      混进去会牵连一堆与本章无关的判定。反光点是"只在带 `mirrors` 旗的章节里才有"的独立一层，
      //      别的章节、别的模式一直是空数组（见 Game.generateMirrors）。
      mirrors: [],
      // ★★ 第八章「场边冷枪」（用户 2026-10-04 拍板）：**又是一层独立状态**，同样不塞进
      //   `s.terrain`／`s.mirrors`（那两个各自有既有分支，混进去会牵连无关判定）。
      //   · `shotAim`＝**已经画在地面上的弹道**：`null`，或
      //     `{ row, col, round, shooterId, slot, name }`（目标格 + 是哪一轮画的 + 谁开的枪）；
      //   · `shotRound`＝上一次结算过冷枪的**轮**（2v2 一轮有 4 个回合，用它将"每轮只算一次"钉死）；
      //   · `shots`＝这一局已经打出几枪（日志/界面用）。
      //   ⚠️ 别的章节、别的模式没有 `sniper` 旗：`shotAim` 永远是 null（见 Game.sniperRule）。
      shotAim: null, shotRound: 0, shots: 0,
      // ★★ 霍尔·霍斯（皇帝）的两个新技能（用户 2026-10-03 拍板，数值见 SKILLS.aim / SKILLS.emperor）：
      //   又是一层**独立状态**，同样不塞进 `s.terrain`／`s.mirrors`／`s.shotAim`（那三个各有既有分支）：
      //   · `aimCharges[槽位]`＝「瞄准」还剩几次"无视防御"（他打出去一次攻击减一，用光就没了）。
      //     **按槽位记账**，所以只有放了瞄准的那个角色吃得到（同队别人一点都沾不上）。
      //   · `emperorMark[目标槽位]`＝「皇帝」锁定的那个单位：`{ by, unitId, round, name }`，
      //     一回合后的**轮末**结算（与冷枪同一条 `endTurn` 链路，见 Game.tickEmperor）。
      aimCharges: pair(0), emperorMark: pair(null),
      // ★★ 「暗枪」（2026-10-05 用户拍板）：又是一层**独立状态**，同样不塞进上面那几层
      //   （`s.terrain`／`s.mirrors`／`s.shotAim` 各有自己的既有分支，混进去会牵连无关判定）：
      //   · `darkMarks`＝场上**已经埋好的**标记格，每项 `{ by, side, row, col, round, name }`
      //     （`by`＝埋它的槽位、`side`＝它属于哪一队）。它是"埋在地上的枪"，不是"锁住某个单位"——
      //     与「皇帝」的 `emperorMark`（锁单位、挪开也躲不掉）正好相反：**挪开那一格就躲开了**。
      //   · `darkPlaced`＝**这一手**已经点掉的格子（与 `flamePlaced` 同一套写法：满 `marks` 格
      //     或按 Esc 就收手）。它只用来数"这一手点了几格"，不是场上状态。
      //   ⚠️ 别的角色、别的模式里这两项永远是空的（没有 `darkgun` 技能就没人往里写）。
      darkMarks: [], darkPlaced: [],
      // ★★ 「打到半血即胜」（章节数据声明，见 Game.phaseWinIfNeeded）：
      //   `phaseWin`＝这一场的演出有没有已经触发过（触发一次就结束这一场，只会是 true）。
      //   ⚠️ 2026-10-03 之后第八章不再声明它了（阶段 1 改回"打空血才算赢"），机制本身保留。
      phaseWin: false,
      // ★★ **必败剧情战**（章节数据 `scene.storyLoss`，见 Game.storyLossIfNeeded）：
      //   `storyLoss`＝"剧情到此为止"这一下有没有已经触发过（触发即这一场结束，只会是 true）。
      //   ⚠️ 与 `phaseWin` 是**两条独立的路**：phaseWin 判玩家**胜**、storyLoss 判玩家**败**，
      //      但两场演出共用同一套表现（大字横幅 ＋ 结算弹窗理由）。别的章节/别的模式永远是 false。
      storyLoss: false,
      burn: pair(0), traumaCut: pair(0), traumaUsed: pair(false),
      drainHeal: pair(0), vampCharged: pair(false), extraAP: pair(false),
      armorOff: pair(false), swordBuff: pair(0),
      // 伊奇：sandGuard＝潜沙给的基础防御 +1（持续一回合）；sandBlind[side]＝该方被扬沙迷眼（存的是施放方，便于到期清理）
      sandGuard: pair(false), sandBlind: pair(null),
      // 剧情 boss 灰塔：disguiseUsed＝伪装被动本回合是否已经用掉（在每个对手回合里只生效一次）
      disguiseUsed: pair(false),
      // 剧情 boss 暗蓝之月：drown[side]＝该方剩余的「溺水」回合数（每个回合结束掉真实伤害，**不减速**）
      drown: pair(0),
      // 剧情 boss 力量（第五章）：船体要害＝敌方侧、可被拆的物件（复用柱子的数据结构）；
      // partsBroken＝已拆掉几个（用来推进场地阶段）；arenaOverride＝中途换场地时的覆盖值
      // ⚠️ 换场地**不能直接改 s.story.arena**——s.story 是 STORY_CHAPTERS 里的那个对象本身，
      //    改它会污染之后所有对局（下一局一开场就在破损船舱里）。所以另存一个覆盖字段。
      partsBroken: 0, arenaOverride: null, shipSide: null, shipPartIndex: 0,
      // 第六章「黑檀之魔」的憎恨值：hatred＝当前点数；hatredHit＝**玩家本回合有没有打到人偶**
      // （玩家回合开始时用它判断要不要掉憎恨，然后清零）；
      // hatredCutin＝这一局**第一次**叠满的大招插画有没有放过了（只放第一次）
      hatred: 0, hatredHit: false, hatredCutin: false,
      // 战斗内台词：这一局已经播过哪几句（每章 4 句，见 rules.js 的 BARKS）
      barks: {},
      timeReady: pair(false), timeUsed: pair(false), timeLocked: pair(false),
      // DIO 专用：血量首次 ≤50% 就永久解锁时停（不是每回合实时判定，见 checkTimeWindow）
      timeUnlocked: pair(false),
      blazeUsed: pair(false), skipSide: null,
      // ★ 时停给的**额外回合**标记（2026-09-30 为 DIO 的「飞刀」加的）：
      //   `skipSide` 只覆盖"按下时停的那个回合"，被跳过的对手回合一到就被清掉了；
      //   而"时间停住"真正的那一段其实是**紧接而来的那个额外回合**（用户明确选的就是这一段）。
      //   这个旗标在「跳过对手回合、把回合还给施放方」时置位，在他那次额外回合结束时清掉。
      timeExtra: pair(false),
      // 乔瑟夫相关：vine 按「单位」记录藤蔓，repeat 记录每个单位上一次的行动签名供预判用
      vine: {}, repeat: {}, predicted: pair(0),
      // 剧情模式：story 存本章的规则（含 swaps），rage 记录哪一方已经觉醒
      // ★ 第七章「黄色节制」：eroded＝这一方中了【侵蚀】（每次自己普攻掉 2 血，一局内不会消失）；
      //   slimeGuard＝这一方正在吃「史莱姆防御」的基础防御 +2（施放方下次轮到自己时到期）
      eroded: pair(false), slimeGuard: pair(false),
      // ★★ 东方仗助 & 疯狂钻石（2026-10-09 用户设计）——**又是一层独立状态**，同样不塞进上面那几层：
      //   · `fixDown[槽位]`＝被「修复」削掉的那一项：`{ by: 施放方槽位, stat: 'atk'|'def'|'move' }`，
      //     **施放方下个自己回合开始时到期**（＝用户要的"持续到下一个敌方回合结束"）；
      //   · `fixUsed[槽位]`＝施放方**这一回合**是否已经挂过一次（每回合只触发一次），回合开始重置；
      //   · `fixRestore[槽位]`＝「重组·回滚」补回来的差额 `{ atk, def, move }`（**只升不降**，
      //     所以它只会往上加；一局只能用一次回滚，因此不存在叠加）。
      //   · `snap[槽位]`＝每个自己回合开始时留的数值快照数组（`{ round, hp, atk, def, move }`，只留最近几条），
      //     回滚就是拿它当"那时的数值"。⚠️ 快照按**角色槽位**记，所以共享生命是一起补回来的。
      //   · `rebuildUsed[槽位]`＝「重组·回滚」本局是否已经用过（一局一次）。
      fixDown: pair(null), fixUsed: pair(false), fixRestore: pair(() => ({ atk: 0, def: 0, move: 0 })),
      snap: pair(() => []), rebuildUsed: pair(false), rebuildMode: null, rebuildTarget: null,
      story: null, rage: pair(false),
      selectedId: null, pendingSkill: null, flamePlaced: [], action: 'move',
      winner: null, resultReason: '', notice: null, log: [],
      stats: pair(() => ({ damage: 0, healed: 0, moves: 0, skills: 0 })),
    };
    this.touch();
  }

  start(p1, p2, mode = 'hotseat', options = {}) {
    if (!FIGHTERS[p1] || !FIGHTERS[p2]) return this.fail('请选择双方角色。');
    // ★ 席位来源有讲究（2026-10-03 第八章「两个敌人 + 电脑友军」）：
    //   · 自由对局的席位由**玩家选**（`setRoster`，`authoredRoster === false`）；
    //   · 剧情章节的席位由**章节写死**（`setRoster({..., story: true})`）——
    //     它允许用剧情 boss 当第二个角色，而且是**两边各两个**（第八章正是如此）；
    //   · 剧情模式里没登记过"章节席位"的席位表一律忽略（老七章仍然是 1v1）。
    const wanted = (options.story && !this.authoredRoster) ? null : this.roster;
    if (wanted) {
      // 自由对局：第二个角色必须是**可选角色**（剧情 boss 不能上场）；章节席位只要能取到数据。
      const usable = this.secondUsableHere();
      for (const key of [wanted.p1b, wanted.p2b]) {
        if (key && !usable(key)) {
          return this.fail(this.authoredRoster ? '剧情席位里的角色不存在。' : '第二个角色必须是可选角色（剧情 boss 不能上场）。');
        }
      }
      // ★★ 2026-10-03：**自由对局**仍然要求"两边各出一个角色"（绝不做 2 打 1 那种半成品）；
      //    而**章节自己写死的席位**允许只给一边——第八章阶段 2 就是"玩家两个角色对敌方一个"，
      //    这是作者按剧情定的局面，不是玩家能配出来的（见 slotsFor）。
      if (!this.authoredRoster && (!wanted.p1b || !wanted.p2b)) {
        return this.fail('两个角色位（2v2）需要双方各出一个角色。');
      }
    }
    const roster = wanted ? { p1b: wanted.p1b, p2b: wanted.p2b } : null;
    const picks = { p1: [p1, roster?.p1b || null], p2: [p2, roster?.p2b || null] };
    // 同一队里也不许两个一样的角色（跨队重复是允许的）。
    if (roster) for (const team of ['p1', 'p2']) {
      if (new Set(picks[team]).size !== picks[team].length) return this.fail('同一队里不能选两个相同的角色。');
    }
    this.roster = roster;
    this.reset();
    const s = this.s;
    s.phase = 'battle';
    // ★★ 控制表：**按槽位**决定这个位子是真人还是人机。
    //   · 剧情模式**忽略**登记：玩家真人 / 敌方人机（章节数据里 player→p1、enemy→p2）；
    //   · 自由对局用 setRoster 登记的表；没登记的槽位退回兼容默认值——
    //     `mode === 'ai'` 时 P2 侧人机（＝改动前"人机对战"的口径），否则真人。
    // ★ 控制表的采信范围（2026-10-03）：
    //   · 自由对局：用 `setRoster` 登记的表；
    //   · **老章节**（席位不是章节写死的）：一律忽略登记表，永远是"玩家真人 / 敌方人机"；
    //   · **章节自己写死席位的**（第八章这种）：才采信登记表，缺省时用下面的剧情默认值。
    const given = this.authoredRoster ? this.control : (options.story ? null : this.control);
    s.control = {};
    for (const slot of s.slots) {
      const want = given?.[slot];
      s.control[slot] = want === 'ai' || want === 'human' ? want
        // 剧情模式（含"章节自己写的两个角色位"）：**玩家侧第一个位子真人、其余全部人机**——
        // 于是电脑友军（`p1b`）自动归电脑管，敌方两个位子也都是电脑。
        : (options.story ? (slot === 'p1' ? 'human' : 'ai')
          : (mode === 'ai' && teamOf(slot) === 'p2' ? 'ai' : 'human'));
    }
    // `mode` 作为**兼容字段**保留，含义变成"这一局里有没有 AI 位"：
    // 只要有一个位子是人机就是 'ai'（旧界面/旧测试读它判断文案），全真人就是 'hotseat'。
    s.mode = s.slots.some(slot => s.control[slot] === 'ai') ? 'ai' : 'hotseat';
    // 剧情模式：把本章的规则（技能替换 + 觉醒加成）挂进对局状态
    s.story = STORY_CHAPTERS.find(chapter => chapter.id === options.story) || null;
    // ★★ 2026-10-03：**一章两场**（第八章两阶段）——这一场属于哪一幕，机制旗标（`sniper` /
    //   `mirrors` / `phaseWin` / `specialRules` / `barks`）与阵容（`lineup`，由调用方先读出来）
    //   就写在哪一幕上。所以这里把**幕**并进 `s.story`：
    //   `s.story.mirrors` 读的就是"当前这一场有没有反光点"，而不是"是不是第八章"。
    //   ★★ 2026-10-03 第四条新增的三样**幕级数据**走的也是这条路：
    //      `s.story.buff`（本场加成）/ `s.story.hpFloor`（剧本保护）/ `s.story.storyLoss`（必败剧情战）。
    //   ⚠️ 没传 `scene`（老七章、自由对局）时 `s.story` 仍**是** STORY_CHAPTERS 里那个对象本身，
    //      与改动前逐值相同；传了就复制一份再合并，绝不改动 STORY_CHAPTERS 里的原始数据。
    if (s.story && this.storyScene) s.story = { ...s.story, ...this.storyScene };
    // ★★ 2026-10-05 加地图体系：**这一局用哪张地图，只在这里解算一次**（之后只读 `s.mapId`）。
    //   解算顺序（两条路互不干扰，所以"在大厅点过浅滩水路"绝不会污染剧情关）：
    //     · **剧情模式**：用章节自己声明的 `map`（第四章＝`shallows`）；章节没写就是 `default`。
    //       ⚠️ 剧情模式**忽略**大厅登记的地图——章节的战场是作者定的，不该被大厅选择带跑
    //         （否则"在选人页点了浅滩、再去打第二章"会得到一张水上的客机）。
    //     · **自由对局 / 其它**：用大厅登记的地图（`setMap`）；没登记就是 `default`。
    //   `resolveMapId()` 兜底：认不出的键（打错的网址参数、旧存档）一律退回 `default`，绝不抛错。
    s.mapId = resolveMapId(options.story ? (s.story?.map || null) : this.requestedMap);
    // ★ 第七章「披着同伴的脸」：**开局敌方那一方就是花京院本人**——
    //   直接把 s.fighters.p2 换成花京院，于是棋子（本体 + 绿色法皇两枚）、数值、技能、头像
    //   全都自动是花京院的，界面不用另写一套"伪装形态"。掉到半血以下再换回本体（见 unmaskIfNeeded）。
    const disguised = s.story?.temperance === true;
    // ★ 逐**槽位**放角色：1v1 时槽位就是 p1 / p2（与改动前完全一致）；
    //   2v2（含第八章阶段 2 的 2 打 1）时每个槽位各一个角色，数值全部取自各自那份 FIGHTERS 数据。
    s.fighters = {};
    for (const slot of s.slots) {
      const team = teamOf(slot), key = picks[team][slotIndex(slot)];
      s.fighters[slot] = (disguised && team === 'p2') ? FIGHTERS[TEMPERANCE.disguiseAs] : FIGHTERS[key];
      // ★★ 幕级加成（`scene.buff`，用户 2026-10-03 第四条）：第八章阶段 1 那一场霍尔·霍斯**攻击 +4、
      //   防御 +2** → 7→11、**1→3**（2026-10-05 他的基础防御从 2 降到 1，所以这一场是 3 不是 4；
      //   幕上那份加成数据照旧是 `def: 2`）。⚠️ 加成写在**幕**上、并进的是 `s.fighters` 里**这份拷贝**——
      //   `FIGHTERS.emperor` 的原始数据一个字都没动，所以自由对局里他是 7／1（见 applySceneBuff）。
      this.applySceneBuff(slot);
    }
    // 「力量」那一关：猩猩**开局不在场上**，拆完最后一个船体要害才登场（见 STRENGTH.bossSpawn）。
    // 别的章节照旧在开局就摆好双方棋子。
    // ⚠️ 这一关是 1v1 剧情，槽位只有 p1 / p2；这里按"队别"判断，P1 的第二个角色也照常上场。
    const shipOpening = s.story?.ship === true;
    const twoSided = s.slots.length > 2;
    for (const slot of s.slots) {
      if (shipOpening && teamOf(slot) === 'p2') continue;
      const f = s.fighters[slot];
      s.hp[slot] = f.hp;
      s.ap[slot] = RULE.apPerTurn;
      for (const kind of (f.stand ? ['user', 'stand'] : ['user'])) {
        // 站位规则集中在 deploySpot()：不重叠、不出界、双方镜像对称。
        const spot = deploySpot(slot, f, kind, twoSided);
        s.units.push({ ...f[kind], id: `${slot}-${kind}`, side: teamOf(slot), slot, kind, fighter: f.key,
          row: spot.row, col: spot.col, dmg: f[kind].dmg || 0, range: f[kind].range || 0 });
      }
    }
    // ⚠️ 血量与行动点要**每个槽位都设**：上面被跳过的槽位（「力量」那一关的 boss）也得有值
    for (const slot of s.slots) {
      const f = s.fighters[slot];
      if (!s.hp[slot]) s.hp[slot] = f.hp;
      s.ap[slot] = s.ap[slot] || RULE.apPerTurn;
    }
    this.generateTerrain();
    this.setupShip();
    // ★ 第八章「反光点」：**必须排在 generateTerrain() 之后**——
    //   ① 反光点不能压特殊地形，得等地形先撒完才知道哪些格子是空的；
    //   ② 挑完点还要把"只走反光点"的那枚棋子（吊死者）挪到一个点上去（开局它就站在镜面上）。
    //   ⚠️ 只在"当前这一幕带 mirrors 旗"时才会撒点（第八章阶段 2）；阶段 1 里它是空数组。
    this.generateMirrors();
    // ★★ 2026-10-05 用户拍板：**开局摆 N 个可拾取道具**（用户定：2 个，种类随机，见 `spawnItems`）。
    //   ⚠️ **必须排在 `generateTerrain()` 与 `generateMirrors()` 之后**——判据里要"不压地形、
    //      不与柱子/反光点/棋子重叠"，得等那些东西都摆完才知道哪些格子是空的。
    //   ⚠️ 随机数消耗排在最后，所以**地形那一段的随机序列一个字都没动**（见 tests/maps.test.js ①）。
    this.spawnItems(this.itemRule()?.opening ?? 0);
    // 「力量」那一关：代价从**开局第一回合**就开始了（用户要求"开局时每回合扣 2 血"）。
    // 第一回合是 reset() 里直接设成 p1 的，不会走 enterTurn，所以这里补一次。
    if (this.shipRule()) this.drainShipToll('p1');
    this.emit('start', { text: `${FIGHTERS[p1].label} 对阵 ${FIGHTERS[p2].label}`, side: 'p1' });
    // 开局台词放在最后播：这样界面能先把"关卡机制"的提示排进队列（见 main.js 的台词队列）
    this.bark('start');
    this.notice('选择己方使者或替身，开始行动。');
    this.roster = null;   // 席位只对"这一局"有效，下一局重新登记（免得剧情战莫名带上 2v2）
    this.control = null;  // 控制表同理：已经收敛进 s.control，下一局重新登记
    this.storyScene = null; // ★ 幕同理：已经合并进 s.story
    this.requestedMap = null; // ★ 地图同理：已经收敛进 s.mapId，下一局重新登记（免得上局的图跟着跑）
    return true;
  }

  touch() { this.revision++; }
  /** 第 `n` 个回合（`turnNumber`）属于第几轮。**轮的口径只在这一处推导**。 */
  roundOfTurn(n) { return Math.floor((n - 1) / this.s.slots.length) + 1; }
  /**
   * 当前是第几轮（界面上的 ROUND xx）：**每个角色各走一次算一轮**。
   * 1v1 时是"两边各走一次"（＝改动前的口径，逐值等价：`floor((n+1)/2) === floor((n-1)/2)+1`）；
   * 2v2 时是"4 个角色各走一次"。**只在这一处算**，界面与台词触发共用。
   */
  roundNumber() { return this.roundOfTurn(this.s.turnNumber); }
  /**
   * 这一次 `endTurn()` 是不是**正好把整轮走完**（2v2 里＝最后一个角色交完回合）。
   * ⚠️ 第八章的冷枪按"轮"结算（用户定：每 2 回合放一枪），而 `endTurn()` 一轮会被调
   *    `slots.length` 次——所以必须用它把"一轮只结算一次、而且是在轮末"钉死，
   *    不能拿 `roundNumber()` 直接判断（那样一轮里的第一个回合就会把枪打出去）。
   * 口径：`turnNumber` 只由 `enterTurn()` 加 1，所以"下一个回合是否属于下一轮"就是轮末。
   */
  roundEnding() { return this.roundOfTurn(this.s.turnNumber + 1) !== this.roundNumber(); }
  /**
   * 播一句战斗内台词（每章 4 句：开局 / 第 2 回合 / 半血 / 击倒对手）。
   * 同一句一局只播一次；没有写台词、或不是剧情模式，就静默跳过。
   */
  bark(key) {
    const line = this.s.story?.barks?.[key];
    if (!line || this.s.barks[key]) return false;
    this.s.barks[key] = true;
    // key 是"说话人的角色 id"，界面拿它去取左侧那张立绘（旁白没有 key，界面会用窄版式）
    this.emit('bark', { key, who: line.who, whoKey: line.key || null, text: line.text });
    return true;
  }
  emit(type, data = {}) {
    const event = { id: ++this.revision, type, turn: this.s.turnNumber, ...data };
    if (event.text) {
      this.s.log.push(event);
      if (this.s.log.length > 160) this.s.log.shift();
    }
    this.onEvent(event);
    return event;
  }
  notice(text, level = 'hint') { this.s.notice = { text, level, id: ++this.revision }; }
  fail(text) { this.notice(text, 'warn'); return false; }
  /**
   * ★★ 2026-10-03 用户要求①：**玩家点空白处可以把提示收掉**（例如「移动完成，剩余 2 AP」）。
   *
   * 提示是"一句话播报"：**本身没有计时器**，收掉它就等于它播完了，界面随之回到默认那行提示。
   *
   * 三条口径（别写歪）：
   *   ① 纯**呈现状态**：`s.notice` 全项目只被 HUD 读来显示（hud.js 的 renderActions / 选人页的 draftHint），
   *      不参与任何判据，所以收掉它**不改变对局任何数值**；
   *   ② 因此这里**不发事件、不 `touch()`、不碰 revision**——收掉一条提示不该进战斗记录、
   *      也不该让"这一局变了"这类缓存口径跟着动（界面侧的刷新由调用方 invalidate() 负责）；
   *   ③ 返回"真的收掉了一条"（本来就没有提示时返回 false，界面据此什么都不做）。
   */
  dismissNotice() {
    if (!this.s.notice) return false;
    this.s.notice = null;
    return true;
  }
  at(row, col) { return this.index.at(row, col); }
  tile(u) { return u ? this.at(u.row, u.col) : null; }
  near(t) { return neighbors(t, this.index.byQR); }
  unit(id) { return this.s.units.find(u => u.id === id) || null; }
  get selected() { return this.unit(this.s.selectedId); }
  /**
   * 取某个**角色槽位**的角色数据。
   * 传队别（`'p1'`/`'p2'`）时会退回"该队第一个角色"——1v1 下两者是同一个键，
   * 所以界面里那些"按队别取角色"的老写法继续有效；2v2 里要精确到角色就请传槽位。
   */
  fighter(slot) {
    const direct = this.s.fighters[slot];
    if (direct) return direct;
    return this.s.fighters[teamOf(slot)] || null;
  }
  // ================= 第七章「披着同伴的脸」：两阶段（伪装 → 本体） =================
  /** 这一局是不是"伪装 → 本体"那一关；是就返回那份机制数据，否则返回 null。 */
  temperanceRule() { return this.s.story?.temperance === true ? TEMPERANCE : null; }
  /** 敌方现在是不是还在伪装阶段（棋子还是"花京院"）。已变身之后返回 false。 */
  disguised() {
    const rule = this.temperanceRule();
    return !!rule && this.fighter('p2')?.key === rule.disguiseAs;
  }
  /**
   * ★★ 伪装破裂：把 p2 从"花京院"换成真正的本体（拉巴索 & 黄色节制）。
   *   · 棋子：删掉伪装那一方的全部棋子（花京院有本体 + 绿色法皇两枚），在**原本体站的位置**放一枚本体棋子；
   *   · 血量：**重置为满血**（用户明确要求"重置血量"）——所以这一战实际要打两条命；
   *   · 绿宝石柱：伪装阶段铺下的柱子一起消失（那是花京院的替身造物，人也换了就不该留着；
   *     而且柱子每回合会给它那一方回血，留着等于白送优势）；
   *   · 冷却：清掉伪装阶段的技能冷却（换人了，旧冷却没有意义）。
   * ⚠️ **必须在判胜负之前调用**（见 damage）：否则一发把伪装形态打死的瞬间这一局就结束了，
   *    玩家永远看不到本体。
   */
  unmaskIfNeeded(side = 'p2') {
    const rule = this.temperanceRule();
    if (!rule || side !== 'p2' || this.s.phase !== 'battle' || !this.disguised()) return false;
    const target = FIGHTERS[this.s.story?.enemy];
    if (!target) return false;
    // 与全局"半血"同一口径：共享 HP ≤ 上限的一半（正好一半也触发）
    if (this.s.hp.p2 > this.fighter('p2').hp * rule.unmaskAt) return false;

    const s = this.s;
    const spot = s.units.find(u => u.side === 'p2' && u.kind === 'user');   // 站哪儿就还在哪儿
    // 兜底（正常情况下走不到）：棋子不在场上时让他从**棋盘正中央**现身——
    // ⚠️ 2026-10-05 棋盘放大后这里原来写死的 (5,9) 已经不是中央了，改由 COLS/ROWS 算。
    const at = spot ? { row: spot.row, col: spot.col } : { row: MID_ROW, col: COLS >> 1 };
    s.units = s.units.filter(u => u.side !== 'p2');
    if (s.selectedId?.startsWith('p2-')) s.selectedId = null;
    s.fighters.p2 = target;
    s.units.push({ ...target.user, id: 'p2-user', side: 'p2', slot: 'p2', kind: 'user', fighter: target.key,
      row: at.row, col: at.col, dmg: target.user.dmg || 0, range: target.user.range || 0 });
    s.pillars = s.pillars.filter(p => p.side !== 'p2');
    s.cd.p2 = {};
    if (rule.unmaskHeal) s.hp.p2 = target.hp;          // ★ 血量重置为满血
    this.emit('unmask', { side: 'p2',
      kicker: '伪装破裂',
      title: `${target.user.name} & ${target.standName}`,
      tail: `那张脸不是花京院 · 血量重置为满血 ${target.hp} · 现在只有一枚棋子、射程 1 格`,
      text: `伪装破裂：${target.label} 现出本体（血量重置为满血 ${target.hp}）` });
    this.notice(`伪装破裂！那张脸不是花京院——${target.label} 现出本体，血量重置为满血 ${target.hp}。`, 'warn');
    this.touch();
    return true;
  }
  // ================= 「打到半血即胜」（章节数据声明的剧情机制）=================
  // ⚠️⚠️ 2026-10-03 第三条用户拍板之后，**这一章已经不用它了**：第八章阶段 1（波鲁纳雷夫 单挑 皇帝）
  //    改回**正常胜负**——把他的血打空才算赢。**但这套代码一个字都没删**（用户明确要求"保留"），
  //    以后任何一幕只要写上 `phaseWin` 数据，下面这整套就照旧生效（见 tests/chapter8-rework.test.js）。
  // 规格文档：`design/第八章-两阶段改版.md` 第三节第 3 条（照 `TEMPERANCE.unmaskAt` 的写法做成
  //    **章节数据**）。当初用户拍板的规则：
  //      · 某一幕的对手是波鲁纳雷夫**单挑**的霍尔·霍斯，胜负**不是**"打倒全队"那套；
  //      · **他的血打到一半（≤ 上限 × hpRatio）就触发演出** → 这一场**判玩家胜并结束**；
  //      · 触发那一击**把他的血夹到 1**（血条别显示成负数、也别显示成 0——他不是被打死的）；
  //      · 演出交给"一条大字横幅 ＋ 紧接着要读的那段正文"，引擎不另做"替死"机制。
  // 写法（与第七章的 unmaskIfNeeded 同一处口径，**通用、不按角色名硬编码**）：
  //   · 数据长在幕上（`scene.phaseWin`），槽位名也由数据给（`slot`），换一场/换一章都只是改数据；
  //   · 判定放在 `damage()` 里（**既有伤害结算之后**）、在调用方的 `checkEnd()` **之前**：
  //     这样"这一击把他打到 0 血"的极端情况也会先被夹到 1，演出不会丢；
  //   · 判定结果只记一个旗标（`s.phaseWin`），**判胜交给 `checkEnd()`**——不要在这里直接
  //     `endGame()`：伤害是在 `attack()` 中途结算的，提前结束会让攻击方后面的收尾逻辑踩到终局状态。

  /** 这一场有没有「打到半血即胜」这条章节机制；有就返回那份数据，否则返回 null。 */
  phaseWinRule() { return this.s.story?.phaseWin || null; }
  /** 演出有没有已经触发过（触发即这一场结束，所以一个对局里只会是 true）。 */
  phaseWinDone() { return !!this.s.phaseWin; }
  /**
   * 被打到阈值就触发演出：**夹血到 1 ＋ 记旗标 ＋ 报一条横幅**（判胜由 `checkEnd()` 负责）。
   * 返回是不是这一次触发的（只可能触发一次）。
   */
  phaseWinIfNeeded(tgt) {
    const rule = this.phaseWinRule(), s = this.s;
    if (!rule || s.phase !== 'battle' || s.phaseWin) return false;
    if (!tgt || tgt.kind === 'pillar' || tgt.slot !== rule.slot) return false;
    const fighter = this.fighter(rule.slot);
    if (!fighter) return false;
    // 与全局"半血"同一口径：共享生命 ≤ 上限 × ratio（正好一半也触发）
    if (s.hp[rule.slot] > fighter.hp * (rule.hpRatio ?? 0.5)) return false;
    // ★ 触发那一击**把他的血夹到 1**（用户要求：血条别显示成负数 / 也不是"被打死"）
    s.hp[rule.slot] = 1;
    s.phaseWin = true;
    const banner = rule.banner || {};
    this.emit('phasewin', { side: tgt.side, slot: rule.slot, unit: tgt.id, tile: this.tile(tgt),
      kicker: banner.kicker || '打到半血', title: banner.title || tgt.name, tail: banner.tail || '',
      theme: rule.theme || 'emperor',
      text: rule.text || `${tgt.name} 被打到一半 —— 这一场到此为止` });
    this.notice(rule.notice || rule.text || '打到他半血 · 这一场判你赢。', 'warn');
    this.touch();
    return true;
  }
  // ================= 幕级加成 / 剧本保护 / 必败剧情战（2026-10-03 第四条用户要求）=================
  // 规格：`design/第八章-两阶段改版.md` 第二节（阶段 1），用户 2026-10-03 第四条把那一场从
  //   "打到半血即胜"改成了**必败剧情战**（原作里阿布德尔替波鲁纳雷夫挡下那一枪而死）。三样都是
  //   **幕级数据**（`scene.buff` / `scene.hpFloor` / `scene.storyLoss`），引擎侧一律通用写法：
  //     · 槽位名由数据给（`slot`），**绝不按角色名硬编码**；
  //     · 别的章节、别的幕、自由对局照样一个字都不受影响（没声明就是 null / 空操作）。
  /**
   * 取这一幕给某个槽位的**加成**（`scene.buff`）：
   * `{ slot, atk, def }`——`atk` 加在普攻攻击力上、`def` 加在基础防御上；没声明返回 null。
   * ⚠️ 写法允许 `buff` 直接是对象（一场一个槽位）或**数组**（一场多个槽位），与 `hpFloor` 同一口径。
   */
  sceneBuff(slot) {
    const list = this.s.story?.buff;
    const one = Array.isArray(list) ? list.find(item => item?.slot === slot) : (list?.slot === slot ? list : null);
    return one || null;
  }
  /**
   * 把这一幕的加成**并进 `s.fighters[slot]` 的那份拷贝**（start() 建完 `s.fighters` 之后立刻调用）。
   *
   * ⚠️ 关键是"拷贝"：`FIGHTERS` 是全局共享的角色表，直接改它会把加成带进**之后每一局**
   *    （自由对局、别的章节都会莫名其妙变强）。这里新建对象，原始数据一个字都不动。
   * ⚠️ 落点选 `s.fighters` 是因为界面与引擎**都**只读它：
   *    · 防御：`baseDefense()` 读 `fighter(side).def`（→ `defense()` / `preview()`）；
   *    · 攻击：棋子的 `dmg` 在 start() 里就是从 `f.user.dmg` 拷的，状态栏的
   *      `unitAttack()` 也读棋子自己的 `dmg`——所以两边会自动一致。
   */
  applySceneBuff(slot) {
    const rule = this.sceneBuff(slot), base = this.s.fighters[slot];
    if (!rule || !base) return null;
    const atk = Number(rule.atk) || 0, def = Number(rule.def) || 0;
    // ⚠️ `atk` 只加在**本来就有普攻攻击力**的那一份上：使者（`user`）通常没有普攻
    //    （`u.dmg` 是 0/undefined），凭空给他加一个会让"没有普攻的使者"多出一种打法。
    const buffed = { ...base, user: { ...base.user,
      ...(base.user?.dmg ? { dmg: base.user.dmg + atk } : {}) },
      def: (base.def || 0) + def };
    // 双单位角色（本体 + 替身）也照同一份额外加：这一场"他打出去的东西"一律更狠。
    if (base.stand) buffed.stand = { ...base.stand, dmg: (base.stand.dmg || 0) + atk };
    this.s.fighters[slot] = buffed;
    return buffed;
  }
  /**
   * 取这一幕的**剧本保护**（`scene.hpFloor`）：`{ slot, min }`——那个槽位的血**最低停在 `min`**。
   * 没声明返回 null（＝照常可以打到 0）。第八章阶段 1 用它保证"皇帝这一场不会被玩家杀死"。
   */
  hpFloorRule(slot) {
    const list = this.s.story?.hpFloor;
    const one = Array.isArray(list) ? list.find(item => item?.slot === slot) : (list?.slot === slot ? list : null);
    return one || null;
  }
  /** 某个槽位的**血下限**（没有剧本保护就是 null）。判定与界面一律读它。 */
  hpFloor(slot) {
    const rule = this.hpFloorRule(slot);
    if (!rule) return null;
    return Math.max(0, Number(rule.min) || 0);
  }
  /** 按剧本保护夹一次血（在 `damage()` 与 `preview()` 里各用一次，口径必须一致）。 */
  clampHpFloor(slot, hp) {
    const floor = this.hpFloor(slot);
    return floor == null ? hp : Math.max(floor, hp);
  }
  /**
   * 取这一幕的**必败剧情战**数据（`scene.storyLoss`）：
   * `{ slot, hpRatio, reason, banner, notice, text }`——`slot`（默认 `p1`）那一方掉到
   * `hpRatio`（默认 0.5）以下就触发演出、这一场**判玩家战败**；没声明返回 null。
   */
  storyLossRule() { return this.s.story?.storyLoss || null; }
  /** 演出有没有已经触发过（触发即这一场结束，所以一个对局里只会是 true）。 */
  storyLossDone() { return !!this.s.storyLoss; }
  /**
   * 被打到阈值就触发演出：**记旗标 ＋ 报一条横幅**（判负由 `checkEnd()` 负责，同 phaseWin 那条口径：
   * 伤害是在 `attack()` 中途结算的，这里直接 `endGame()` 会让攻击方后面的收尾逻辑踩到终局状态）。
   * 返回是不是这一次触发的（只可能触发一次）。
   *
   * ⚠️ 判定口径与全局"半血"完全一致：**共享生命 ≤ 上限 × ratio，含正好一半**（写成 `hp * 2 <= 上限`）。
   * ⚠️ **不夹血**：触发方的血该是多少就是多少（夹血是 phaseWin 那一套的，它夹的是"不该死"的对手）。
   */
  storyLossIfNeeded() {
    const rule = this.storyLossRule(), s = this.s;
    if (!rule || s.phase !== 'battle' || s.storyLoss) return false;
    const slot = rule.slot || 'p1';
    const fighter = this.fighter(slot);
    if (!fighter) return false;
    if (s.hp[slot] > fighter.hp * (rule.hpRatio ?? 0.5)) return false;
    s.storyLoss = true;
    const banner = rule.banner || {};
    this.emit('storyloss', { side: slot, slot,
      kicker: banner.kicker || '剧情', title: banner.title || '', tail: banner.tail || '',
      theme: rule.theme || 'emperor',
      text: rule.text || '剧情到此为止 —— 这一场结束' });
    this.notice(rule.notice || rule.text || '剧情到此为止 —— 这一场结束。', 'warn');
    this.touch();
    return true;
  }
  /** 剧情模式下这一方的角色改动（技能替换 / 觉醒加成）；null 表示按角色原本的数据。 */
  storySwaps(side) {
    const story = this.s.story;
    if (!story) return null;
    return story.swaps?.[this.fighter(side)?.key] || null;
  }
  /** 觉醒是否已触发（剧情模式专用，触发一次就永久保留）。 */
  storyRage(side) { return !!(this.s.story && this.s.rage?.[side]); }
  /** 觉醒带来的攻击力加成；非剧情模式或未触发时为 0。 */
  storyAttack(side) {
    const rage = this.storySwaps(side)?.rage;
    return rage && this.storyRage(side) ? rage.atk : 0;
  }
  /** 觉醒带来的每回合额外行动点。 */
  storyAP(side) {
    const rage = this.storySwaps(side)?.rage;
    return rage && this.storyRage(side) ? rage.ap : 0;
  }
  /** 状态标签文字（供界面显示）；没有则为空串。 */
  storyStatus(side) {
    const rage = this.storySwaps(side)?.rage;
    if (!rage) return '';
    return this.storyRage(side)
      ? `${rage.name} · 攻击 +${rage.atk} · 每回合 +${rage.ap} AP`
      : `${rage.name} · 半血后觉醒`;
  }
  /** 共享生命降到阈值以下时触发觉醒（只触发一次）。 */
  checkStoryRage(side) {
    const rage = this.storySwaps(side)?.rage;
    if (!rage || this.s.rage[side] || this.s.phase !== 'battle') return false;
    // 与「时停半血解锁」同一口径：共享 HP ≤ 上限的一半
    if (this.s.hp[side] > this.fighter(side).hp * rage.hpRatio) return false;
    this.s.rage[side] = true;
    this.emit('status', { side, text: `${rage.name}觉醒 · 攻击力 +${rage.atk}、每个己方回合 +${rage.ap} 行动点（永久）` });
    return true;
  }
  skills(side) {
    const swapped = this.storySwaps(side)?.skills;
    return swapped ? [...swapped] : skillSetFor(this.fighter(side)?.key);
  }
  /** ★ 同伴＝**同一个角色槽位**里的另一枚棋子（本体 ↔ 替身）。
   *  2v2 时同一队的另一个角色**不是**同伴：连携距离只在同一个角色的两枚棋子之间算。 */
  partner(u) { return this.s.units.find(x => x.slot === u.slot && x !== u); }
  /** 这一格上站着谁（单位优先、其次宝石柱／船体要害）；空格一律返回 `null`。
   *  ⚠️ 末尾那个 `|| null` 是 2026-10-04 补的：以前"格子是空的"返回的是 `undefined`、而"格子不存在"
   *     返回 `null`，同一个函数两种空值；让路那件事（`removeFallenSlot`）之后"空格"变成很常见的结果，
   *     统一成 `null` 之后判据与断言都能直接写 `occupant(t) === null`（内部读它的地方全是真值判断，不受影响）。 */
  occupant(t) { return t ? this.s.units.find(u => u.row === t.row && u.col === t.col) || this.pillarAt(t) || null : null; }
  pillarAt(t) { return this.s.pillars.find(p => p.row === t.row && p.col === t.col); }
  fireAt(t) { return this.s.fire.find(f => f.row === t.row && f.col === t.col); }
  /** 某个角色的宝石柱（**按槽位**记：柱子给的是"摆柱子那个角色"的加成与回血）。
   *  ⚠️ 兼容两种旧数据：1v1 与 `s.shipParts()`（船体要害只有 `side`、没有 `slot`），
   *     以及测试里手动造的柱子对象（只有 `side`）——所以没有 `slot` 时退回按队别匹配。 */
  pillarsOf(key) { return this.s.pillars.filter(p => (p.slot ? p.slot === key : p.side === key)); }
  isRock(t) { return this.s.terrain[tileKey(t)] === 'rock'; }
  adjRock(t) { return this.near(t).some(n => this.isRock(n)); }
  distLimit(side) {
    // ★★ 道具「连携」（用户拍板）：连携距离 +1，**只按角色槽位记账**——
    //   所以它改的正是这条既有的"本体与替身距离上限"，`reachable()` / `moveReason()` / 界面那一栏一起吃到。
    return (this.fighter(side)?.distLimit ?? RULE.distLimit) + this.itemBuffs(side).dist;
  }

  /** 该单位是否被藤蔓缠住（按单位记录，本体与替身分别计算）。 */
  vined(u) { return !!(u && this.s.vine?.[u.id]); }
  /** 被缠住时的实际移动距离，界面与判定共用。
   *  水域地图（地图特性 `features.water`）里，被 `slowedTeams` 列到的队**站在水里**时再 −移动惩罚；
   *  判定时机是「**开始移动那一刻**」（用户 2026-09-15 规定）——所以起点在甲板上就不减，哪怕这一趟走进水里。 */
  moveRange(u) {
    if (!u) return 0;
    const water = this.inWater(u) && this.waterSlows(teamOf(u.slot)) ? this.waterPenalty() : 0;
    // 拆要害的代价之一：移动 −1（拆掉第 1、2 个时生效，全拆完恢复）
    const ship = this.shipPenalty(teamOf(u.slot)).move;
    // ★★ 道具「疾风」（用户拍板）：移动 +1（本局永久，按角色槽位记账）——加在**基础移动**上，
    //    于是藤蔓 −1、水里 −1、拆船 −1 那些惩罚照旧照算（互不冲突）。
    const items = this.itemBuffs(u.slot).move;
    // ★ 东方仗助：被「修复」削掉移速时减在这里；「重组·回滚」补回来的差额加在这里（下限 0）。
    return Math.max(0, (u.move || 0) + items - (this.vined(u) ? RULE.vineMovePenalty : 0) - water - ship
      - this.fixPenalty(u.slot, 'move') + this.s.fixRestore[u.slot].move);
  }
  /**
   * 这一局的地图**有没有水**（＝地图特性里有没有 `water`；只有水域地图有）。
   * ⚠️ 2026-10-05 起判据从"剧情章节的 arena 是不是 'sea'"改成"**当前地图有没有水域特性**"——
   *    行为逐值不变（第四章用的就是浅滩水路地图），但自由对局现在也能选到这张图。
   *    渲染层用它决定要不要铺水与木甲板（见 ui/render.js 的 drawSea）。
   */
  wateryArena() { return !!this.map().features?.water; }
  /** 水里起步的移动惩罚（地图数据；数值的唯一来源仍是 `RULE.waterMovePenalty`）。 */
  waterPenalty() { return this.map().features?.water?.movePenalty ?? 0; }
  /** 这一队在水里会不会被减速（地图数据 `slowedTeams`；只有玩家方，水生替身不受影响）。 */
  waterSlows(team) { return (this.map().features?.water?.slowedTeams || []).includes(team); }
  /** 水上地图的**居中甲板矩形**；不是水域地图就是 null。唯一口径在 rules.js 的 `deckRectOf()`。 */
  deckRect() { return deckRectOf(this.map()); }
  /** 某个格子是不是水（甲板那条带子上不算水）。**渲染层也用它，只有这一处判定。** */
  isWaterTile(t) {
    const deck = this.deckRect();
    if (!deck || !t) return false;
    return !(t.row >= deck.rowStart && t.row <= deck.rowEnd
      && t.col >= deck.colStart && t.col <= deck.colEnd);
  }
  /** 某个单位是不是站在水里。 */
  inWater(u) { return !!u && this.isWaterTile(this.tile(u)); }

  // ================= 第八章「皇帝与吊死者」：反光点 =================
  // ⚠️ 这一关的核心机制全在下面这几个方法里（数据见 rules.js 的 MIRRORS）：
  //    正文写的是「吊死者不进路面，只走反光的地方：镜面、金属、水洼」，于是
  //    **它走不到普通空地，只能在这些点之间跳**（★ 2026-10-03 用户第三次拍板起，
  //    **未被占用的岩石格**也算它的落点——"可以在所有场景建筑内存在"，见 `mirrorLanding()`）；
  //    而「火焰封住镜面」＝ 把那些点一个个废掉。
  //    别的章节没有 `mirrors` 旗，`s.mirrors` 一直是空数组 —— 这一套等于不存在。

  /** 这一局是不是「反光点」那一关；是就返回那份机制数据，否则返回 null。 */
  mirrorRule() { return this.s.story?.mirrors === true ? MIRRORS : null; }
  /**
   * 这枚棋子是不是**只在反光点与岩石之间跳**的那种（吊死者）。
   * ⚠️ 判据是**数据旗标**（`FIGHTERS.geil.stand.mirrorWalk`），**不按角色名硬编码**；
   *    并且要求这一局真的有反光点（＝带 `mirrors` 旗的章节）——否则它哪儿都去不了，
   *    会白白卡死在那些"不是剧情模式"的对局里（比如测试里那 16 组配对收敛）。
   */
  mirrorWalker(u) { return !!(u && u.mirrorWalk === true && this.mirrorRule()); }
  /** 某个格子上的反光点（没有就是 null）。 */
  mirrorAt(t) { return t ? this.s.mirrors.find(m => m.row === t.row && m.col === t.col) || null : null; }
  /** **还没被封住**的反光点（"它还能跳到哪儿"读的就是这个）。 */
  openMirrors() { return this.s.mirrors.filter(m => !m.sealed); }
  /** 这个反光点现在能不能落人（**没被封** + **没被单位或柱子占着**）。 */
  mirrorOpenFor(m) { return !!m && !m.sealed && !this.occupant(this.at(m.row, m.col)); }
  /**
   * ★★ 2026-10-03 用户第三次拍板：这类棋子（吊死者）的**落点判据只有这一处**——
   *   **还没被封的反光点** ∪ **没被占用的岩石格**（用户原话"可以在所有场景建筑内存在"，
   *   口径确认为**岩石**这类障碍格）。
   * ⚠️ 两条别写错：
   *   · "占着"用的是 `occupant()`（单位**和宝石柱**都算），所以被占的岩石照样落不了；
   *   · **封镜机制一个字没动**：被封的反光点仍然不是落点（岩石上铺不了火，所以岩石不会被封）。
   * `reachable()` 与 `moveReason()` 共用它，于是"高亮说能落"与"点了真的能落"永远一致。
   */
  mirrorLanding(t) {
    if (!t) return false;
    if (this.mirrorOpenFor(this.mirrorAt(t))) return true;
    return this.isRock(t) && !this.occupant(t);
  }
  /**
   * 撒反光点：照 `generateTerrain()` 的写法用 `this.random` 随机挑合法格子。
   * 合法＝**不贴边**（离每条边至少 `margin` 格）、**不重叠**、**不压特殊地形**
   *（岩石／草丛／恢复点／毒沼，也就是 `s.terrain` 里有东西的格子）、**不压棋子与柱子**。
   * ⚠️ 只在这一章生效（别的章节直接返回，`s.mirrors` 保持空数组）。
   * ⚠️ 挑不满 `count` 个就**不硬塞**（有多少算多少）；18×13 的棋盘上 margin=2 划出的中场有
   *    (18−4)×(13−4) = **126 格**，扣掉地形与棋子也一定挑得满 4 个。
   */
  generateMirrors() {
    const rule = this.mirrorRule();
    if (!rule) return 0;
    const s = this.s;
    s.mirrors = [];
    const { margin, count } = rule;
    const inside = t => t.row >= margin && t.row <= ROWS - 1 - margin
      && t.col >= margin && t.col <= COLS - 1 - margin;
    const pool = this.tiles.filter(t => inside(t) && !s.terrain[tileKey(t)] && !this.occupant(t));
    for (let i = pool.length - 1; i > 0; i--) {
      const j = Math.min(i, Math.floor(this.random() * (i + 1)));
      [pool[i], pool[j]] = [pool[j], pool[i]];
    }
    for (const t of pool.slice(0, Math.max(0, count))) {
      s.mirrors.push({ id: `mirror-${this.epoch}-${t.row}-${t.col}`, row: t.row, col: t.col, sealed: false });
    }
    // ★ 开局时**它就已经站在一个反光点上**（用户要求：不要用常规的对称摆位）。
    //   挑"离它原本站位最近的那个点"，这样它不会莫名其妙跑到棋盘另一头去。
    for (const u of s.units.filter(x => this.mirrorWalker(x))) {
      const from = this.tile(u);
      const spot = s.mirrors.map(m => this.at(m.row, m.col))
        .sort((a, b) => hexDist(a, from) - hexDist(b, from))[0];
      if (spot && !this.occupant(spot)) { u.row = spot.row; u.col = spot.col; }
    }
    return s.mirrors.length;
  }
  /**
   * 火焰盖住反光点 → **这个点永久失效**（用户定）。
   * ⚠️ 接在 `place()` 里铺火的那条既有分支上，**不另写一套火焰逻辑**；
   *    这里只负责"把镜子标记成 sealed ＋ 报一句"。火焰之后被清除也不复原（永久）。
   */
  sealMirror(t, side = null) {
    if (!this.mirrorRule()) return false;
    const m = this.mirrorAt(t);
    if (!m || m.sealed) return false;
    m.sealed = true;
    const left = this.openMirrors().length;
    // ★ 2026-10-03：封光所有反光点**不再**等于"无处可跳"——它还能落在没被占用的岩石上
    //   （见 `mirrorLanding()`）。所以最后那一条要**按 `reachable()` 的实际空否**分岔，
    //   否则界面会报一句骗人的话（"无处可跳"），玩家照着围上去会扑空。
    const ghost = this.s.units.find(u => this.mirrorWalker(u));
    const stuck = !ghost || this.reachable(ghost).length === 0;
    this.emit('status', { side, tile: t, text: left
      ? `${MIRRORS.name}被封住了 · ${MIRRORS.name}还剩 ${left}/${this.s.mirrors.length}`
      : stuck
        ? `★ 最后一个${MIRRORS.name}也被封住了 · 吊死者无处可跳，只能停在原地出手`
        : `★ 最后一个${MIRRORS.name}也被封住了 · 吊死者只能退到岩石上` });
    return true;
  }

  // ================= 第八章「皇帝与吊死者」：场边冷枪 =================
  // ⚠️ 用户拍板的规矩（`design/第八章设计草案.md`，数值不许改）：枪手霍尔·霍斯
  //    **每 2 回合朝玩家放一枪**（净伤 6 点真实伤害、无视防御），
  //    **开火的前一个回合在地面画出弹道与目标格**——站在那一格上才挨打，挪开就躲开了。
  // ⚠️⚠️ 2026-10-03 改版（规格文档：`design/第八章-两阶段改版.md`）：这一章改成**两阶段两场**，
  //    冷枪**只在阶段 1（波鲁纳雷夫 单挑 皇帝）生效**——所以 `sniper` 旗标挪到了**幕**上
  //    （`s.story` 是"章节 + 当前这一幕"合并出来的对象，见 start()）。
  //    同时**撤掉了原来的 `immune`（打不死）与 `pinned`（钉在外圈）两条**：
  //    单挑要能打伤他、能追他，他靠射程 4 与移动 2 拉开距离。引擎里那两条通用判据也一并删了。
  // ⚠️ 判据只剩一个**数据旗标**：`FIGHTERS.emperor.user.sniper === true`（**不按角色名硬编码**）。

  /** 这一局是不是「场边冷枪」那一幕；是就返回那份机制数据，否则返回 null。 */
  sniperRule() { return this.s.story?.sniper === true ? SNIPER : null; }
  /** 这一局放冷枪的那枚棋子（没有就是 null）。**只看数据旗标**，不看角色名。 */
  sniperUnit() { return this.sniperRule() ? this.s.units.find(u => u.sniper === true) || null : null; }
  /**
   * 本章的**关键槽位**：章节用数据声明"胜负只看这一个槽位"（第八章阶段 2＝J·凯尔那一格）。
   * ⚠️ 通用写法——槽位名来自章节数据（`keySlot`），而且必须是这一局真的参战的槽位；
   *    没声明（或声明了一个不存在的槽位）就返回 null＝沿用"全队倒下才算输"的老口径。
   */
  keySlot() {
    const key = this.s.story?.keySlot;
    return key && this.s.slots.includes(key) ? key : null;
  }
  /**
   * 冷枪的**每轮结算**（接在 `endTurn()` 那条既有链路上，排在扣血系之后、胜负判定之前）。
   * 节奏（用户定：每 2 回合放一枪）：
   *   · 第 1、3、5… 轮结束＝**画弹道**：记下"离枪手最近的、还活着的敌方单位"所在格，emit 一句提示；
   *   · 第 2、4、6… 轮结束＝**开火**：站在那一格上的单位挨 6 点**真实伤害**（无视防御），没人就是打空。
   * 也就是说：弹道画出来之后，玩家有**整整一个回合**把棋子挪开——这是这一关的躲枪窗口。
   * ⚠️ 一轮只结算一次（`s.shotRound`）：2v2 的一轮有 4 个回合，`endTurn()` 会被调 4 次。
   */
  tickSniper() {
    const rule = this.sniperRule(), s = this.s;
    if (!rule) return false;
    const round = this.roundNumber();
    if (s.shotRound === round) return false;      // 这一轮已经结算过
    s.shotRound = round;
    const shooter = this.sniperUnit();
    const alive = !!shooter && this.slotAlive(shooter.slot);
    // 上一轮画下的弹道，这一轮结束就落地（开火优先于重新瞄准）。
    if (s.shotAim) {
      if (!alive) { s.shotAim = null; return false; }   // 枪手不在了：这条弹道作废
      return this.fireSniper(rule, shooter);
    }
    if (!alive || (round - 1) % rule.interval !== 0) return false;
    return this.aimSniper(rule, shooter);
  }
  /**
   * 瞄准：把"离枪手最近的、还活着的玩家单位"所在格记进 `s.shotAim`，并报一句。
   * ⚠️ 目标选法就是用户拍板的那一句（最近的那个玩家单位）；同距离时按槽位、再按 id 定序，
   *    保证同一局面下可复现（否则两枚棋子等距时枪口会随机摆）。
   */
  aimSniper(rule, shooter) {
    const s = this.s, from = this.tile(shooter);
    const foes = s.units.filter(u => u.side !== teamOf(shooter.slot) && this.slotAlive(u.slot));
    if (!foes.length) return false;
    const target = foes.slice().sort((a, b) => hexDist(this.tile(a), from) - hexDist(this.tile(b), from)
      || String(a.slot).localeCompare(String(b.slot)) || String(a.id).localeCompare(String(b.id)))[0];
    const tile = this.at(target.row, target.col);
    s.shotAim = { row: target.row, col: target.col, round: this.roundNumber(),
      shooterId: shooter.id, slot: shooter.slot, name: target.name };
    this.emit('status', { side: shooter.side, unit: shooter.id, tile,
      text: `${rule.aimText} · 目标 ${tileLabel(tile)}（${target.name}）` });
    return true;
  }
  /**
   * 开火：结算 `s.shotAim` 那一格。
   *   · 格子上站着人（且那个角色还活着）→ 挨 `rule.dmg` 点伤害，**走既有的 `preview()`／
   *     `damage()` 口径**（按常规结算防御；灼烧、减伤、胜负判定全部照常生效）；
   *   · 格子上没人 → **打空**（＝"躲开了"），只记一条日志、不掉血。
   * ⚠️ 结算完**先清掉 `s.shotAim`** 再扣血：万一这一枪直接打死了玩家，界面也不该还留着准星。
   * ⚠️ `damage()` 只扣血、不判胜负，所以这里必须自己补一次 `checkEnd()`（与扬沙同一处口径）。
   */
  fireSniper(rule, shooter) {
    const s = this.s, aim = s.shotAim;
    s.shotAim = null;
    s.shots++;
    const tile = this.at(aim.row, aim.col);
    // ⚠️ 只算**敌方**单位（这一枪瞄的就是玩家）：同队的棋子（含枪手自己人）后来挪进这一格时，
    //    这一枪按"打空"处理——既不会自伤，也不会让 `preview()` 拿到 null 而抛错。
    const victim = s.units.find(u => u.row === aim.row && u.col === aim.col
      && u.side !== shooter.side && this.slotAlive(u.slot));
    if (!victim) {
      this.emit('status', { side: shooter.side, unit: shooter.id, tile, text: rule.missText });
      return false;
    }
    // ★ 伤害口径（2026-10-03 用户定）：**净伤 6，真实伤害（无视一切防御）**。
    //   原来写的是"6 点攻击力 − 常规防御"，实战只扣 2~4，用户要求改成字面的净伤 6——
    //   走的是和「波纹疾走／扬沙」同一条 `pierce` 通道。
    this.damage(victim, rule.dmg, { side: shooter.side, slot: shooter.slot, source: rule.name, pierce: true });
    this.checkEnd();
    return true;
  }

  // ================= 剧情 boss「皇帝」：瞄准 / 皇帝 =================
  // ★★ 2026-10-03 用户拍板重做霍尔·霍斯（数值见 SKILLS.aim / SKILLS.emperor，**不许改**）：
  //    · 「瞄准」：1 AP / CD 1 回合 → 接下来**两次他造成的攻击无视对手防御**，按**次数**记账；
  //    · 「皇帝」：1 AP / CD 1 回合 / 射程 5 → 锁定一个**单位**，**一回合之后** 10 点伤害（**计防御**）。
  //    ⚠️ 两条都**不写角色名**：一切按数据走（`this.skills(slot)` 里有没有 `aim` / `emperor`），
  //       所以这两个方法对任何拥有这两个技能的角色都成立（现在只有他）。
  //    ⚠️ 与「场边冷枪」互不干扰：冷枪是幕上的 `sniper` 机制，不吃 AP／CD，也不消耗「瞄准」的次数。

  /**
   * 这个单位现在有没有「瞄准」的无视防御次数。
   * ⚠️ **只按槽位记账**（`s.aimCharges[u.slot]`）：2v2 里同队另一个角色一点都沾不上。
   */
  aimPierce(u) { return !!u && (this.s.aimCharges?.[u.slot] || 0) > 0; }
  /**
   * 结算一次"他打出去的攻击"→ 消耗一次「瞄准」（只有在真的扣了血的那条路径上调用，
   * 所以**打空（扬沙迷眼）不消耗**）。用完就把次数清零，之后恢复正常结算防御。
   */
  spendAim(u) {
    if (!this.aimPierce(u)) return false;
    const left = --this.s.aimCharges[u.slot];
    this.emit('status', { side: u.side, unit: u.id, text: left
      ? `${SKILLS.aim.name} · 这一击无视对手防御（还剩 ${left} 次）`
      : `${SKILLS.aim.name}已用完 · 接下来的攻击恢复正常结算防御` });
    return true;
  }
  /**
   * 「皇帝」的可用性判定（界面高亮、AI 选招、真人点击都读它——与 `vineReason`／`dragReason` 同一套写法）。
   * 口径：**只能锁单位**（宝石柱不行）、**不能锁自己人**、**已经倒下的角色不算目标**、
   * 距离 ≤ `SKILLS.emperor.range`，其余交给 `skillReason`（AP／冷却／技能归属）。
   */
  emperorReason(u, tgt) {
    if (!tgt) return `请选择 ${SKILLS.emperor.range} 格内的一个单位。`;
    if (tgt.kind === 'pillar') return `「${SKILLS.emperor.name}」只能锁定单位，不能打宝石柱`;
    if (u && tgt.side === u.side) return '不能锁定己方单位。';
    if (tgt.kind !== 'pillar' && !this.slotAlive(tgt.slot)) return '这个角色已经倒下了，不能作为目标。';
    const reason = this.skillReason(u, 'emperor');
    if (reason) return reason;
    if (hexDist(this.tile(u), this.tile(tgt)) > SKILLS.emperor.range) {
      return `目标超出射程 · 最远 ${SKILLS.emperor.range} 格`;
    }
    return '';
  }
  /**
   * 「皇帝」锁定的伤害：**按常规结算防御**（`SKILLS.emperor.dmg` 减去目标**当前**防御，最低 1）。
   * ⚠️ 与 `preview(u, tgt, 'emperor')` 的口径**必须一致**（预览与实际结算对不上就是骗玩家）：
   *    两边都含「伪装」那 −2 减伤，也**都不吃「瞄准」的无视防御**（用户定：皇帝按常规结算防御）。
   * ⚠️ 防御按**结算那一刻**的站位算（草丛／邻石／贴柱都会跟着变），锁定的只是"哪个单位"，不是"哪一格"。
   */
  emperorDamage(tgt) {
    if (!tgt || tgt.kind === 'pillar') return 0;
    const disguised = !this.s.disguiseUsed[tgt.slot] && this.skills(tgt.slot).includes('disguise');
    return Math.max(1, SKILLS.emperor.dmg - this.defense(tgt).total - (disguised ? SKILLS.disguise.cut : 0));
  }
  /**
   * 施放「皇帝」：把**这个单位**记进 `s.emperorMark[目标槽位]`，一回合后的轮末结算。
   * ⚠️ 同一个目标槽位只留**最后一次**锁定（重复施放＝刷新，绝不会叠成两次伤害）；
   *    实战里 CD 1 回合本来也拦得住，这条只是把边界钉死。
   */
  emperorLock(tgt) {
    const u = this.selected, s = this.s;
    const reason = this.emperorReason(u, tgt);
    if (reason) return this.fail(reason);
    const round = this.roundNumber();
    s.ap[u.slot] -= SKILLS.emperor.cost;
    s.cd[u.slot].emperor = SKILLS.emperor.cd;
    s.stats[u.slot].skills++;
    if (s.emperorMark[tgt.slot]) {
      this.emit('status', { side: tgt.side, unit: tgt.id,
        text: `「${SKILLS.emperor.name}」重新锁定 ${tgt.name} · 上一次锁定作废（不会叠成两下）` });
    }
    s.emperorMark[tgt.slot] = { by: u.slot, unitId: tgt.id, round, name: tgt.name };
    const damage = this.emperorDamage(tgt);
    this.clearSelection();
    this.emit('skill', { side: u.side, unit: u.id, fighter: u.fighter, skill: 'emperor', label: SKILLS.emperor.name, cry: 'EMPEROR',
      text: `${u.name} 举枪锁定 ${tgt.name} · 一回合后结算 ${SKILLS.emperor.dmg} 点伤害（计防御）` });
    this.emit('status', { side: u.side, unit: u.id, targetSide: tgt.side, tile: this.tile(tgt),
      text: `${SKILLS.emperor.name}锁定中 · 第 ${round + 1} 轮结束时 ${tgt.name} 受到 ${damage} 点伤害（计防御 · 挪开也躲不掉）` });
    this.notice(`「${SKILLS.emperor.name}」已锁定 ${tgt.name}：一回合之后结算 ${damage} 点伤害——他走到哪里都躲不掉。`);
    this.touch();
    return true;
  }
  /** 这一局正在进行中的「皇帝」锁定（渲染、状态标签、格子说明共用这一份）：
   *  `[{ slot, mark, unit, by }]`——拿不到目标单位的那条直接跳过（棋子理论上不会被删除）。 */
  emperorMarks() {
    const s = this.s || {};
    return (s.slots || []).map(slot => {
      const mark = s.emperorMark?.[slot];
      if (!mark) return null;
      const unit = s.units.find(u => u.id === mark.unitId) || s.units.find(u => u.slot === slot) || null;
      return unit ? { slot, mark, unit, by: s.units.find(u => u.slot === mark.by) || null } : null;
    }).filter(Boolean);
  }
  /**
   * 「皇帝」的结算：**一回合之后**（施放那一轮的**下一轮**结束时）落到被锁定的那个单位头上。
   *   · 与冷枪同一条 `endTurn` 链路、同一个 `roundEnding()` 判据——**一轮只结算一次**
   *     （2v2 的一轮有 4 个回合，`endTurn()` 会被调 4 次）；
   *   · 伤害**按常规结算防御**（`emperorDamage()`，不是真实伤害）；
   *   · **目标在结算前已经倒下 → 静默跳过**（不扣血、不报日志，只把锁定清掉）；
   *   · 施放者自己倒下**不影响**这一下（枪已经开出去了：锁定记的是目标，不是"他还在不在场"）。
   */
  tickEmperor() {
    const s = this.s, round = this.roundNumber();
    let fired = 0;
    for (const slot of s.slots) {
      const mark = s.emperorMark[slot];
      if (!mark || round <= mark.round) continue;
      s.emperorMark[slot] = null;
      const tgt = s.units.find(u => u.id === mark.unitId) || s.units.find(u => u.slot === slot);
      if (!tgt || !this.slotAlive(slot)) continue;      // ★ 目标提前倒下：静默跳过
      this.damage(tgt, this.emperorDamage(tgt), { side: teamOf(mark.by), slot: mark.by, source: SKILLS.emperor.name });
      fired++;
    }
    return fired;
  }

  // ================= 剧情 boss「皇帝」：暗枪 =================
  // ★★ 2026-10-05 用户拍板（数值见 SKILLS.darkgun，**不许改**）：
  //    不消耗 AP、每回合一次，一次在**射程内连着点两个格子**埋枪；
  //    **对手回合结束时**，踩在标记格上的敌方单位各挨 **8 点伤害（按常规结算防御）**，
  //    结算完标记清空；标记期间对手看得见、能躲（**挪开那一格就躲开了**）。
  //   ⚠️ 与「皇帝」的区别（用户定，两者都要）：皇帝锁的是**单位**（挪开也躲不掉）、
  //      一回合之后结算、吃 1 AP；暗枪锁的是**格子**、对手回合结束就结算、不吃 AP。
  //   ⚠️ 与「场边冷枪」的区别：冷枪是**幕上的 `sniper` 旗标机制**（自动、每 2 回合、真实伤害），
  //      暗枪是**技能**（玩家/AI 自己放、计防御）。两条路互不干扰，一个字节都没动冷枪那一段。
  //   ⚠️ 一切按数据走（`this.skills(slot)` 里有没有 `darkgun`），**不写角色名**。

  /**
   * 「暗枪」的可标记格子清单：射程内的所有格子。
   * ⚠️ 与 `placement()` **刻意不同**：被棋子占着的格子**照样能标**——那一格恰恰是最常见的靶子，
   *    而 `placement()`（火焰／宝石柱用）会把有人的格子滤掉，所以这里不读它、自己算一遍。
   * ⚠️ 已经标过的格子要排掉（这一手的两个位置不能重复；上一手还没结算的标记也不重复埋）。
   */
  darkgunTiles(u) {
    if (!u) return [];
    const range = SKILLS.darkgun.range;
    return this.tiles.filter(t => hexDist(this.tile(u), t) <= range && !this.darkgunMarked(t));
  }
  /** 这一格是不是已经埋过暗枪了（**这一手**点的两格 ∪ 场上还没结算的标记）。 */
  darkgunMarked(t) {
    if (!t) return false;
    const s = this.s, key = tileKey(t);
    return (s.darkPlaced || []).some(x => tileKey(x) === key)
      || (s.darkMarks || []).some(m => m.row === t.row && m.col === t.col);
  }
  /**
   * 单个格子的合法性（界面高亮、格子说明、AI 选格、真人点击四处共用这一份）。
   * 口径只有两条（用户定）：**两格不能重复**、**都要在射程内**。
   */
  darkgunTileReason(u, t) {
    if (!u) return '请先选择己方单位。';
    if (!t) return `请选择 ${SKILLS.darkgun.range} 格内的一个格子。`;
    if (this.darkgunMarked(t)) return '这一格已经标过了 · 两个位置不能重复';
    if (hexDist(this.tile(u), t) > SKILLS.darkgun.range) {
      return `目标超出射程 · 最远 ${SKILLS.darkgun.range} 格`;
    }
    return '';
  }
  /** 「暗枪」整条技能的可用性（在单格判据之外，再加上 AP／冷却／技能归属）。 */
  darkgunReason(u, t) {
    const actor = this.actorReason(u);
    if (actor) return actor;
    const reason = this.skillReason(u, 'darkgun');
    if (reason) return reason;
    return this.darkgunTileReason(u, t);
  }
  /**
   * 「暗枪」的伤害：**按常规结算防御**（`SKILLS.darkgun.dmg` 减去目标**当前**防御，最低 1）。
   * ⚠️ 与 `preview(u, tgt, 'darkgun')` 的口径**必须一致**（预览与实际结算对不上就是骗玩家）：
   *    两边都含「伪装」那 −2 减伤，也**都不吃「瞄准」的无视防御**（用户定：按常规结算防御）。
   * ⚠️ 防御按**结算那一刻**的站位算（草丛／邻石／贴柱都会跟着变）——暗枪标的是"哪一格"，
   *    不是"哪个人"，所以谁踩上来就算谁的账。
   */
  darkgunDamage(tgt) {
    if (!tgt || tgt.kind === 'pillar') return 0;
    const disguised = !this.s.disguiseUsed[tgt.slot] && this.skills(tgt.slot).includes('disguise');
    return Math.max(1, SKILLS.darkgun.dmg - this.defense(tgt).total - (disguised ? SKILLS.disguise.cut : 0));
  }
  /**
   * 结算那一刻站在 `t` 上的**敌方**单位（`side` ＝ 埋枪那一方的队别）。
   * ⚠️ 判据里带 `slotAlive`：倒下的角色不再挨枪。**只打敌人**——自己人站在标记格上一点事都没有
   *    （用户明确要求："标记到自己人身上也不伤自己人"）。
   */
  darkgunVictim(t, side) {
    if (!t) return null;
    return this.s.units.find(u => u.row === t.row && u.col === t.col
      && u.side !== side && this.slotAlive(u.slot)) || null;
  }
  /**
   * 埋下一格暗枪（真人点击与 AI 走的是**同一条路**，照「火焰道路」的 `place()` 那套写法）。
   *   · **第一格**落地就结算费用与冷却（`cost: 0`＝不扣 AP；`cd: 1`＝这一回合不能再埋）；
   *   · 点满 `SKILLS.darkgun.marks` 格（2 格）就自动收手，中途可按 Esc 提前收手
   *     （已经埋下的标记**不会撤销**，与火焰那套口径一致）；
   *   · 每次落地都报一条日志，界面上立刻就能看见。
   */
  darkgunMark(u, t) {
    const s = this.s, key = 'darkgun';
    if (s.phase !== 'battle') return this.fail('对局尚未开始或已结束。');
    if (s.pendingSkill !== key) return this.fail(`请先选择「${SKILLS.darkgun.name}」。`);
    const actor = this.actorReason(u);
    if (actor) return this.fail(actor);
    if (s.selectedId !== u.id) return this.fail(`请使用当前正在埋${SKILLS.darkgun.name}的使者。`);
    // ⚠️ 与 `place()` 同一处取舍：第一格才查 `skillReason`（它包含 AP／冷却），
    //    后面那几格只查"这一格能不能标"——否则第二格会被"刚刚才进的冷却"顶掉。
    const committed = s.darkPlaced.length > 0;
    const reason = committed ? this.darkgunTileReason(u, t) : this.darkgunReason(u, t);
    if (reason) return this.fail(reason);
    if (!committed) {
      s.ap[u.slot] -= SKILLS.darkgun.cost;
      s.cd[u.slot][key] = SKILLS.darkgun.cd;
      s.stats[u.slot].skills++;
      this.emit('skill', { side: u.side, unit: u.id, fighter: u.fighter, skill: key,
        label: SKILLS.darkgun.name, cry: 'DARK GUN' });
    }
    // ★ 标记记的是**格子**（不是单位）：谁在那时候踩上来谁挨枪，`side` 定住"这是哪一方的枪"。
    s.darkMarks.push({ by: u.slot, side: u.side, row: t.row, col: t.col, round: this.roundNumber(), name: u.name });
    s.darkPlaced.push(t);
    this.emit('place', { side: u.side, unit: u.id, tile: t, skill: key,
      text: `${SKILLS.darkgun.name} → ${tileLabel(t)} · ${s.darkPlaced.length}/${SKILLS.darkgun.marks} 格` });
    if (s.darkPlaced.length >= SKILLS.darkgun.marks) this.finishDarkgun();
    else this.notice(`「${SKILLS.darkgun.name}」已标下第 ${s.darkPlaced.length} 个位置。再点一格埋好第二个（两格都不能重复、都要在 ${SKILLS.darkgun.range} 格内）。`);
    this.touch();
    return true;
  }
  /** 收手（点满两格、按 Esc、或回合结束时都会走到这里）。已经埋下的标记照旧生效。 */
  finishDarkgun() {
    if (this.s.phase !== 'battle' || this.s.pendingSkill !== 'darkgun') return false;
    const count = this.s.darkPlaced.length;
    this.clearSelection();
    this.notice(count >= SKILLS.darkgun.marks
      ? `「${SKILLS.darkgun.name}」已埋好两个位置 —— 对手回合结束时，踩在那两格上的敌方单位各受 ${SKILLS.darkgun.dmg} 点伤害（计防御）。`
      : count ? `「${SKILLS.darkgun.name}」只埋了 ${count} 格：已埋下的标记照旧生效，对手回合结束时结算。`
        : `已取消${SKILLS.darkgun.name}，没有消耗行动点。`);
    return true;
  }
  /** 场上正在进行中的暗枪标记（渲染、状态标签、格子说明共用这一份）：带 `tile` 的标记清单。 */
  darkgunMarks() {
    const s = this.s || {};
    return (s.darkMarks || []).map(mark => ({ ...mark, tile: this.at(mark.row, mark.col) }))
      .filter(entry => entry.tile);
  }
  /**
   * 「暗枪」的结算：**对手回合结束时**（用户原话"在对方回合结束时"）。
   *   参数 `ending` ＝ 刚刚结束的那个槽位（`endTurn()` 里的 `previous`）。
   *
   *   口径：
   *     · 只结算**不属于 `ending` 那一队**的标记（埋枪方自己回合结束时不结算）；
   *     · 踩在标记格上的**敌方**单位各挨一发 `darkgunDamage()`（**走 `damage()`，计防御**），
   *       格子上没人就是**打空**（＝躲开了），不掉血；
   *     · 结算完那一批标记**全部清空**（用户要求"结算完标记清空"）；
   *     · 埋枪的人自己倒下了**不影响**这一下（枪已经埋在地上了，与皇帝"枪已经开出去了"同一取舍）。
   *   ⚠️ `damage()` 只扣血、不判胜负，所以调用点必须紧挨着 `checkEnd()`（与冷枪／皇帝同一处口径）。
   */
  tickDarkgun(ending = this.s.turn) {
    const s = this.s, marks = s.darkMarks || [];
    if (!marks.length) return 0;
    const team = teamOf(ending);
    const firing = marks.filter(m => m.side !== team);
    if (!firing.length) return 0;
    s.darkMarks = marks.filter(m => m.side === team);   // ★ 结算完标记清空（只清要结算的那一批）
    let hits = 0;
    for (const mark of firing) {
      const tile = this.at(mark.row, mark.col);
      const victim = this.darkgunVictim(tile, mark.side);
      if (!victim) {
        this.emit('status', { side: mark.side, tile, text: `${SKILLS.darkgun.name} · ${tileLabel(tile)} 上没有人 · 这一枪埋空了` });
        continue;
      }
      this.damage(victim, this.darkgunDamage(victim), { side: mark.side, slot: mark.by, source: SKILLS.darkgun.name });
      hits++;
    }
    this.emit('status', { side: team, text: hits ? `${SKILLS.darkgun.name}结算完毕 · ${hits} 处标记命中，标记已清空` : `${SKILLS.darkgun.name}结算完毕 · 标记已清空` });
    this.touch();
    return hits;
  }

  // ================= 剧情 boss「力量」：整艘船就是这个替身 =================
  // ⚠️ 这一关的规则**不靠技能**，全靠场地：boss 是个单棋子的猩猩，替他出手的是这艘船。
  //    所以下面这些方法都只读 s.story.ship，普通对局与其它章节一律不受影响。

  /** 这一局是不是「力量」那一关；是就返回那份场地规则，否则返回 null。 */
  shipRule() { return this.s.story?.ship === true ? STRENGTH : null; }

  // ================= 剧情 boss「黑檀之魔」：憎恨值 =================
  // ⚠️ 规矩来自用户正文：「越是恨它，它就越有力气」「把那股狠劲暂时收了回去……等对方靠到足够近」。
  //    所以**打它就是在喂它**：打得越猛 → 它攻击力越高；玩家停手一个回合，它才会软一点。
  // ⚠️ 原来还有"憎恨到阈值就打不到它"（躲进暗处）——**用户 2026-09-27 要求删掉**，
  //    所以这条不再有"打不到"的状态：憎恨的唯一效果就是给它加攻击力。

  /** 这一局是不是「黑檀之魔」那一关；是就返回那份机制数据，否则返回 null。 */
  ebonyRule() { return this.s.story?.hatred === true ? EBONY : null; }
  /** 这一关的憎恨值（不是那一关就恒为 0）。 */
  hatredLevel() { return this.ebonyRule() ? this.s.hatred : 0; }
  /** 人偶因憎恨得到的攻击力加成（只加在**人偶自己**的攻击上）。 */
  hatredAtkBonus(u) {
    const rule = this.ebonyRule();
    if (!rule || !u || u.kind !== 'stand' || u.side !== 'p2') return 0;
    return this.s.hatred * rule.hatredAtkBonus;
  }
  /** 命中对方（人偶或本体）之后：憎恨 +1（并记下"这一回合打到了它"）。 */
  addHatred() {
    const rule = this.ebonyRule();
    if (!rule) return;
    this.s.hatredHit = true;
    if (this.s.hatred >= rule.hatredMax) return;
    this.s.hatred += rule.hatredPerHit;
    this.emit('status', { side: 'p2', text: `憎恨 ${this.s.hatred}/${rule.hatredMax} · 人偶攻击力 +${this.s.hatred * rule.hatredAtkBonus}` });
    // ★ 第一次叠满 → 放一次大招插画（用户 2026-09-30 要求）。
    //   ⚠️ 判定放在"涨到上限的那一次"（上面那句 `>= hatredMax` 的提前返回意味着
    //   已经满了之后的每次命中都直接 return，所以这里天然只在**第一次**满时走到）。
    //   之后再满（掉下去又涨回来）只由上面的 status 提示，不重复放大招画面。
    if (this.s.hatred >= rule.hatredMax && !this.s.hatredCutin) {
      this.s.hatredCutin = true;
      this.emit('cutin', { side: 'p2', fighter: this.fighter('p2').key, label: rule.cutinLabel, cry: rule.cutinCry });
      this.notice('憎恨叠满了——它现在是最狠的状态。', 'warn');
    }
  }
  /** 玩家回合开始时的憎恨结算：上一回合一次都没打到它 → 冷静下来，憎恨 −1。 */
  decayHatred() {
    const rule = this.ebonyRule();
    if (!rule) return;
    const hit = this.s.hatredHit;
    this.s.hatredHit = false;                       // 新的一回合重新记
    if (hit || this.s.hatred <= 0) return;
    this.s.hatred = Math.max(0, this.s.hatred - rule.hatredDecay);
    this.emit('status', { side: 'p2', text: `你住了手 · 憎恨降到 ${this.s.hatred}/${rule.hatredMax} · 人偶攻击力 +${this.s.hatred * rule.hatredAtkBonus}` });
  }
  /**
   * 当前该用哪张**场地背景图**（见 ui/assets.js 的 `ARENAS`），`null` ＝ 用默认深色底。
   *
   * 三个来源，**顺序就是这个优先级**：
   *   ① `arenaOverride`＝**中途覆盖值**（第五章拆掉一个船体要害就推进一层，见 advanceShip）；
   *   ② `story.arena`＝**章节指定的场地**（第二章 plane、第五章 ship-deck……）；
   *   ③ `map().arena`＝**地图自带的配套背景**（浅滩水路 → 'sea'）——
   *      ★★ 2026-10-05 加地图体系时新增的这一档：自由对局选了地图，背景就跟着地图走。
   *      ⚠️ 它是**兜底**而不是覆盖：章节写了 arena 就听章节的（所以第四章仍然由数据里的
   *        `arena:'sea'` 决定背景，与改动前逐值一致；而它恰好和地图自带的那张是同一张）。
   */
  arenaKey() { return this.s.arenaOverride || this.s.story?.arena || this.map().arena || null; }
  /** 某一方还剩几个完好的船体要害（普通对局恒为 0）。 */
  shipParts(side = 'p2') { return this.pillarsOf(side).filter(p => p.part); }
  /** 这个目标是不是「被钢壁护着」——要害没拆完之前，本体打不到。
   *  这正是正文里那句"使用者最后被逼着露面"。 */
  shipGuarded(tgt) {
    if (!tgt || tgt.kind === 'pillar' || !this.shipRule()) return false;
    return this.shipParts(tgt.side).length > 0;
  }
  /** 开战时铺设**第一个**船体要害（其余依次出现）与初始钢壁；不是那一关就什么都不做。 */
  setupShip() {
    const rule = this.shipRule();
    if (!rule) return false;
    this.s.partsBroken = 0;
    this.s.arenaOverride = null;
    // 剧情模式的 boss 一定在 p2（章节数据里 player→p1、enemy→p2），血条文案据此换词
    this.s.shipSide = 'p2';
    this.s.shipPartIndex = 0;
    // ★ 一次只放一个要害（用户 2026-09-27：依次出现、固定在角落，拆掉一个才出下一个）
    this.spawnShipPart();
    // 一开始就立几面钢壁，让"走廊很窄"这件事第一眼就看得出来。
    // ⚠️ 同样要跳过有单位/柱子的格子：现在的出生点与隔板位并不冲突，但万一以后调了站位或隔板位，
    //    这里就是"把钢壁立在棋子脚下"的事故点。
    for (const { row, col } of rule.bulwarkSlots.slice(0, Math.ceil(rule.bulwarkSlots.length / 2))) {
      const t = this.at(row, col);
      if (t && !this.occupant(t) && this.s.terrain[tileKey(t)] === undefined) this.s.terrain[tileKey(t)] = 'rock';
    }
    this.emit('status', { side: 'p2', text: `${rule.parts[0].name}已出现 · 拆掉它才会露出下一个要害` });
    return true;
  }
  /** 放出「当前该出现的那一个」船体要害（拆掉一个才调用一次）。 */
  spawnShipPart() {
    const rule = this.shipRule();
    const def = rule?.parts[this.s.shipPartIndex];
    if (!def) return null;
    const t = this.at(def.row, def.col);
    if (!t) return null;
    const part = { id: `part-${this.epoch}-${this.s.shipPartIndex}`, kind: 'pillar', part: true, side: 'p2',
      partKey: def.key, name: def.name, row: def.row, col: def.col, hp: rule.partHp, maxHp: rule.partHp };
    this.s.pillars.push(part);
    return part;
  }
  /** 前面几个要害都拆完了吗（决定第几层场地、以及猩猩该不该登场）。 */
  shipPartsCleared() { return this.s.partsBroken; }
  /** 「力量」那一关：从开局起，玩家**每个自己的回合开始时**扣血——待在这艘船里本身就要付代价。
   *  ⚠️ 但**三个要害全拆完之后就不掉了**（用户 2026-09-27：拆掉第三个后"不受持续伤害"）：
   *     船身被撕开，代价结束。 */
  drainShipToll(side) {
    const rule = this.shipRule();
    if (!rule || side !== 'p1' || !rule.drainPerTurn) return 0;
    if (this.s.partsBroken >= rule.parts.length) return 0;   // 全拆完 → 不再持续掉血
    const user = this.s.units.find(u => u.side === 'p1' && u.kind === 'user') || this.s.units.find(u => u.side === 'p1');
    const loss = this.damage(user, rule.drainPerTurn, { source: '船体挤压', terrain: true });
    this.emit('status', { side: 'p1', text: `船体挤压 · 每回合 −${rule.drainPerTurn} HP（待在船里的代价）` });
    return loss;
  }
  /** 每拆掉一个要害，玩家伤害 +1（用户 2026-09-27 定的成长）。 */
  shipBreakBonus(side) { return side === 'p1' ? this.s.partsBroken * (this.shipRule()?.breakBonus || 0) : 0; }
  /**
   * 拆要害的**代价**（用户 2026-09-27 追加）：拆掉第 1 个 → 移动 −1；第 2 个 → 再叠行动点 −1；
   * 拆掉第 3 个（全部拆完）→ 两者恢复。表在 `STRENGTH.breakPenalties`，按已拆数量取索引。
   */
  shipPenalty(side) {
    const rule = this.shipRule();
    const table = rule?.breakPenalties;
    if (!rule || side !== 'p1' || !table?.length || !this.s.partsBroken) return { move: 0, ap: 0 };
    return table[Math.min(this.s.partsBroken, table.length) - 1] || { move: 0, ap: 0 };
  }
  /** 单位卡片上要显示的普攻数值：**与 preview() 的普攻口径完全一致**（含剧情觉醒与拆船成长）。
   *  ⚠️ 以前 hud 里写的是 `u.dmg + damageBonus(u)`，漏了剧情觉醒 +3 与拆船 +1，
   *     于是"卡片写 8、打出去 9 / 11"这种对不上的情况会出现（用户 2026-09-27 就是被这个绕了一下）。 */
  unitAttack(u) {
    if (!u || !u.dmg) return 0;
    // ★ 东方仗助：被「修复」削掉攻击力时这里要跟着减（卡片、预览、结算都读这一个出口）；
    //   「重组·回滚」补回来的差额也加在这里（`fixRestore`）。
    return Math.max(0, u.dmg + this.damageBonus(u) + this.storyAttack(u.slot) + this.shipBreakBonus(teamOf(u.slot))
      - this.fixPenalty(u.slot, 'atk') + this.s.fixRestore[u.slot].atk);
  }
  /** 当前场地的中文说法（换层横幅与状态标签共用这一处）。 */
  arenaName(key = this.arenaKey()) { return this.shipRule()?.arenaNames?.[key] || key || ''; }
  /** 让猩猩登场（拆完最后一个要害才调用）。他会从 STRENGTH.bossSpawn 出现。 */
  spawnShipBoss() {
    const rule = this.shipRule();
    const f = this.fighter('p2');
    if (!rule || !f || this.s.units.some(u => u.side === 'p2')) return null;
    const { row, col } = rule.bossSpawn;
    const t = this.at(row, col);
    // 目标格被别人占着就沿着一行找最近的空格，保证他一定能出场（否则这一关会卡住）
    let spot = t && !this.occupant(t) && !this.isRock(t) ? t : null;
    if (!spot) spot = this.tiles.find(x => !this.occupant(x) && !this.isRock(x) && x.row === row) || null;
    if (!spot) spot = this.tiles.find(x => !this.occupant(x) && !this.isRock(x)) || null;
    if (!spot) return null;
    const unit = { ...f.user, id: 'p2-user', side: 'p2', slot: 'p2', kind: 'user', fighter: f.key,
      row: spot.row, col: spot.col, dmg: f.user.dmg || 0, range: f.user.range || 0 };
    this.s.units.push(unit);
    // 登场时**满血**（用户要的就是"最后一个要害拆完后猩猩才上场，血量 40"）。
    // 这一句是保险：哪怕以后有人给拆要害加了"预扣船体耐久"的规则，他也不会一登场就残血。
    this.s.hp.p2 = f.hp;
    return unit;
  }
  /**
   * 变形之后玩家**至少还留有一个合法行动**（能走一格，或者够得着什么能打的东西）。
   *
   * ⚠️ 这道检查只负责挡住"彻底动弹不得"这种死局，**不能要求"当场就打得着要害"**——
   *    开局时玩家离要害本来就有好几格，那种写法会让每一次变形都被回滚（等于把这套机制关掉）。
   *    "打不到要害而站着发呆"是**AI 选目标**的问题，在 `ai.js` 里解决（把要害并进走位目标）。
   */
  stillPlayable() {
    return this.s.units.filter(u => u.side === 'p1')
      .some(u => this.reachable(u).length > 0 || this.targets(u, u.range || 0).length > 0);
  }
  /**
   * 棋盘变形：每个回合开始，船会改变内部结构——从固定的「隔板位」里翻几格（钢壁 ⇄ 空地）。
   * ⚠️ **每一步都先试改再验证**，不满足就回滚，两道验证缺一不可：
   *    ① 每个单位至少还剩一个能走过去的邻格（不能把人围死）
   *    ② `stillPlayable()`——玩家还必须打得着目标（否则整局永远打不下去）
   */
  tickBulwarks() {
    const rule = this.shipRule();
    if (!rule) return 0;
    const s = this.s;
    const open = t => !this.isRock(t) && !this.pillarAt(t) && !this.occupant(t);
    const everyoneCanMove = () => s.units.every(u => {
      const t = this.tile(u);
      return t && this.near(t).some(n => open(n));
    });
    const safe = () => everyoneCanMove() && this.stillPlayable();
    const candidates = rule.bulwarkSlots.map(({ row, col }) => this.at(row, col)).filter(t => {
      if (!t || this.occupant(t) || this.pillarAt(t)) return false;
      const type = s.terrain[tileKey(t)];
      return type === 'rock' || type === undefined;      // 只在"钢壁/空地"之间翻转，不动别的地形
    });
    // 洗牌后取前 N 个
    for (let i = candidates.length - 1; i > 0; i--) {
      const j = Math.min(i, Math.floor(this.random() * (i + 1)));
      [candidates[i], candidates[j]] = [candidates[j], candidates[i]];
    }
    let changed = 0;
    for (const t of candidates.slice(0, rule.flipPerTurn)) {
      const key = tileKey(t), closing = s.terrain[key] !== 'rock';
      if (closing) s.terrain[key] = 'rock'; else delete s.terrain[key];
      if (safe()) { changed++; continue; }
      // 回滚：这一下会把谁困住、或者让玩家再也打不到目标
      if (closing) delete s.terrain[key]; else s.terrain[key] = 'rock';
    }
    if (changed) this.emit('status', { side: 'p2', text: `船体改变内部结构 · ${changed} 处隔板${changed > 1 ? '同时' : ''}动过` });
    return changed;
  }
  /** 血条上那四个字。默认「共享生命」；「力量」那一关打的是船，所以显示「船体耐久」。 */
  healthLabel(side) { return this.s.shipSide === side ? '船体耐久' : '共享生命'; }
  /**
   * 拆掉一个船体要害之后：累计数量 → 推进场地阶段 → 放出下一个要害 → 全拆完就让猩猩登场。
   * 场地用 `arenaOverride` 记，**不去改 s.story**（那是章节对象本身，改了会污染后面每一局）。
   */
  onPartBroken(part) {
    const rule = this.shipRule();
    if (!rule) return;
    const s = this.s;
    s.partsBroken++;
    const total = rule.parts.length;
    const left = total - s.partsBroken;
    // 伤害成长：每拆一个 +1（`shipBreakBonus` 读的就是 partsBroken）。
    // ⚠️ 只在 breakBonus > 0 时才播这条——用户 2026-09-27 把加成改成 0 之后，
    //    再播"攻击力 +0"就成了假提示。
    if (rule.breakBonus > 0) {
      this.emit('status', { side: 'p1', text: `拆开${part.name} · 看穿了结构，攻击力 +${rule.breakBonus}（累计 +${s.partsBroken * rule.breakBonus}）` });
    } else {
      this.emit('status', { side: 'p1', text: `拆开${part.name} · 船体结构被看穿` });
    }
    // 拆一个就往船里推进一层
    s.arenaOverride = rule.arenas[Math.min(s.partsBroken, rule.arenas.length - 1)];
    const layer = this.arenaName(s.arenaOverride);
    if (left > 0) {
      // ★ 下一个要害依次出现（固定在下一个角落）
      s.shipPartIndex++;
      const next = this.spawnShipPart();
      // 拆要害的代价：拆掉第 1 个移动 −1、第 2 个再叠行动点 −1（用户 2026-09-27）。
      // 一定要**明确提示**，否则玩家只会觉得"走不动了/行动点少了"却不知道为什么。
      const now = this.shipPenalty('p1');
      const penaltyText = [now.move ? `移动 −${now.move}` : '', now.ap ? `行动点 −${now.ap}` : ''].filter(Boolean).join('、');
      this.emit('stage', { side: 'p2', arena: s.arenaOverride, layer, done: s.partsBroken, total,
        part: next ? next.name : '', penalty: penaltyText, text: `船体往里塌了一层 · 进入${layer}` });
      this.notice(`拆掉${part.name}：船体往里塌了一层，战场推进到${layer}。下一个要害「${next ? next.name : '？'}」已经露出来了（还剩 ${left} 个）。`
        + (penaltyText ? `船体压在你身上：**${penaltyText}**。` : ''), 'hint');
      return;
    }
    // ★ 最后一个也拆掉了 → 猩猩被迫登场；同时"船体压在身上"的代价全部解除
    const boss = this.spawnShipBoss();
    this.emit('stage', { side: 'p2', arena: s.arenaOverride, layer, done: s.partsBroken, total, boss: !!boss, released: true,
      text: `船体崩开 · 猩猩现身（${layer}）` });
    this.notice(boss
      ? `船体要害全部拆掉：船身被撕开一个大口子，猩猩被迫现身了——现在可以攻击他（他也会动手）。`
        + `与此同时船体不再压着你：移动距离与行动点恢复，也不会再被持续挤压掉血。`
      : '船体要害全部拆掉：猩猩被迫现身了。', 'hint');
  }
  /** 船体反击：每个回合结束，还完好的要害会打 1 格内的敌方单位。
   *  与毒沼/火焰同口径——**固定伤害、不看防御**（船板夹过来不会因为你穿了护甲就轻一点）。 */
  tickParts() {
    const rule = this.shipRule();
    // ⚠️ 伤害为 0 时直接不结算：否则会"命中 0 点"、还白白产生伤害事件与数字飘字
    if (!rule || !rule.partDmg) return 0;
    let hits = 0;
    for (const part of this.s.pillars.filter(p => p.part && p.hp > 0)) {
      for (const victim of this.s.units.filter(u => u.side !== part.side
        && hexDist(this.tile(part), this.tile(u)) <= rule.partRange)) {
        this.damage(victim, rule.partDmg, { side: part.side, source: `${part.name} · 船体夹击`, terrain: true });
        hits++;
      }
    }
    return hits;
  }
  /**
   * 「你的下一句话是」：同一个单位对同一个目标连续两次做同一种行动（同一技能或普攻）
   * 就被预判成功——给拥有该被动的一方在下个己方回合 +1 AP（每回合最多一次）。
   */
  noteAction(u, kind, targetId) {
    if (!u || !targetId) return;
    const s = this.s, signature = `${kind}:${targetId}`, previous = s.repeat[u.id];
    s.repeat[u.id] = signature;
    if (previous !== signature) return;
    // 被动属于**防守方**：找到对面那一队里带「你的下一句话是」的槽位
    // （1v1 就是对面那一位；2v2 时是持有该被动的那个角色，而不是"对方第一个角色"）。
    const foe = this.teamSlots(otherSide(teamOf(u.slot))).find(slot => this.skills(slot).includes('nextline'));
    if (!foe) return;
    if (s.predicted[foe] === s.turnNumber) return;
    s.predicted[foe] = s.turnNumber;
    s.extraAP[foe] = true;
    this.emit('status', { side: foe, key: 'nextline', text: `你的下一句话是…… · ${foe.toUpperCase()} 下个回合 +1 AP` });
    this.notice('你的下一句话是…… 预判成功：下个己方回合额外 +1 行动点。');
  }
  /** 藤蔓缠绕的可用性判定。 */
  vineReason(u, tgt) {
    const actor = this.actorReason(u);
    if (actor) return actor;
    const sk = SKILLS.vine;
    if (!u || !this.skills(u.slot).includes('vine')) return '该技能不属于当前角色。';
    if (u.kind !== 'user') return '需要本人释放';
    if (!tgt || !this.s.units.includes(tgt)) return '藤蔓只能缠住战场上的单位。';
    if (tgt.side === u.side) return '不能缠绕己方单位。';
    if (this.vined(tgt)) return '目标已经被藤蔓缠住。';
    if (hexDist(this.tile(u), this.tile(tgt)) > sk.range) return `目标超出射程 · 最远 ${sk.range} 格`;
    if ((this.s.cd[u.slot].vine || 0) > 0) return `冷却 ${this.s.cd[u.slot].vine} 个己方回合`;
    if (this.s.ap[u.slot] < sk.cost) return `行动点不足 · 需要 ${sk.cost} AP`;
    return '';
  }
  /** 藤蔓缠绕：给射程内一名敌人挂上移动 −1，同一单位只吃一层。 */
  vine(tgt) {
    const u = this.selected, reason = this.vineReason(u, tgt);
    if (reason) return this.fail(reason);
    const s = this.s;
    s.vine[tgt.id] = true;
    s.ap[u.slot] -= SKILLS.vine.cost;
    s.cd[u.slot].vine = SKILLS.vine.cd;
    s.stats[u.slot].skills++;
    this.noteAction(u, 'vine', tgt.id);
    this.emit('skill', { side: u.side, unit: u.id, fighter: u.fighter, skill: 'vine', cry: 'HERMIT PURPLE', label: SKILLS.vine.name,
      text: `${u.name} · 藤蔓缠绕 → ${tgt.name} · 移动 −${RULE.vineMovePenalty}` });
    this.notice(`${tgt.name} 被藤蔓缠住：移动距离 −${RULE.vineMovePenalty}，对方可花 ${RULE.vineBreakAP} AP 挣脱。`);
    this.clearSelection();
    return true;
  }
  /** 挣脱藤蔓的可用性判定。 */
  breakReason(u) {
    const actor = this.actorReason(u);
    if (actor) return actor;
    if (!this.vined(u)) return '这个单位没有被藤蔓缠住。';
    if (this.s.ap[u.slot] < RULE.vineBreakAP) return `行动点不足 · 挣脱需要 ${RULE.vineBreakAP} AP`;
    return '';
  }
  /** 花 1 AP 挣脱藤蔓（无冷却）；挣脱后保持选中，方便接着移动。 */
  breakFree(u = this.selected) {
    const reason = this.breakReason(u);
    if (reason) return this.fail(reason);
    const s = this.s;
    delete s.vine[u.id];
    s.ap[u.slot] -= RULE.vineBreakAP;
    this.emit('status', { side: u.side, unit: u.id, text: `${u.name} 挣脱了藤蔓 · 移动距离恢复` });
    this.notice(`${u.name} 挣脱藤蔓，移动距离恢复为 ${u.move}。`);
    return true;
  }
  /** 扬沙（伊奇）：给射程内一名敌人挂上「普攻 30% 打空」，自己人不能放、同一目标不重复挂。 */
  sandblastReason(u, tgt) {
    const actor = this.actorReason(u);
    if (actor) return actor;
    const sk = SKILLS.sandblast;
    if (!u || !this.skills(u.slot).includes('sandblast')) return '该技能不属于当前角色。';
    if (!tgt || !this.s.units.includes(tgt)) return '扬沙只能作用于战场上的单位。';
    if (tgt.side === u.side) return '不能对己方单位扬沙。';
    if (this.s.sandBlind[tgt.slot]) return '目标已经被沙迷住了眼。';
    if (hexDist(this.tile(u), this.tile(tgt)) > sk.range) return `目标超出射程 · 最远 ${sk.range} 格`;
    if ((this.s.cd[u.slot].sandblast || 0) > 0) return `冷却 ${this.s.cd[u.slot].sandblast} 个己方回合`;
    if (this.s.ap[u.slot] < sk.cost) return `行动点不足 · 需要 ${sk.cost} AP`;
    return '';
  }
  /** 扬沙：造成 3 点真实伤害（无视防御），并让目标接下来一个回合里的普攻有几率打空。 */
  sandblast(tgt) {
    const u = this.selected, reason = this.sandblastReason(u, tgt);
    if (reason) return this.fail(reason);
    const s = this.s, sk = SKILLS.sandblast;
    s.sandBlind[tgt.slot] = u.slot;               // 记下是谁放的（槽位），好在施放方下个回合开始时清掉
    s.ap[u.slot] -= sk.cost;
    s.cd[u.slot].sandblast = sk.cd;
    s.stats[u.slot].skills++;
    this.noteAction(u, 'sandblast', tgt.id);
    this.emit('skill', { side: u.side, unit: u.id, fighter: u.fighter, skill: 'sandblast', cry: 'SAND SPRAY', label: sk.name,
      text: `${u.name} · 扬沙 → ${tgt.name} · 真实伤害 ${sk.dmg} · 普通攻击 ${Math.round(sk.miss * 100)}% 打空` });
    // ★ 真实伤害（2026-09-30 用户要求"扬沙带3点真实伤害"）：走和「波纹疾走」同一条 `pierce` 通道，
    //   无视草丛/岩石/柱子与基础防御。
    if (sk.dmg) {
      this.damage(tgt, sk.dmg, { side: u.side, slot: u.slot, source: sk.name, pierce: true });
      // ⚠️⚠️ `damage()` **只扣血、不判胜负**（见交接文档 §6）：扬沙现在能打死人，
      //   所以这里必须自己补一次 checkEnd()，否则"扬沙打死对手"这一局不会结束。
      this.checkEnd();
    }
    this.notice(`${tgt.name} 被沙迷眼：受到 ${sk.dmg} 点真实伤害，接下来一个回合的普通攻击有 ${Math.round(sk.miss * 100)}% 概率打空。`);
    this.clearSelection();
    return true;
  }
  /** 这一方是不是正在【溺水】（暗蓝之月的「拖入水下」挂的 debuff）。
   *  溺水的全部效果就是**每个回合结束时掉真实伤害**——用户 2026-09-26 明确规定：**不减速**。 */
  drowning(side) { return (this.s.drown?.[side] || 0) > 0; }
  /** 拖入水下的可用性判定。 */
  dragReason(u, tgt) {
    const actor = this.actorReason(u);
    if (actor) return actor;
    const sk = SKILLS.drag;
    if (!u || !this.skills(u.slot).includes('drag')) return '该技能不属于当前角色。';
    if (u.kind !== 'stand') return '需要替身释放';
    if (!tgt || !this.s.units.includes(tgt)) return '拖入水下只能作用于战场上的单位。';
    if (tgt.side === u.side) return '不能把己方单位拖进水里。';
    if (this.drowning(tgt.slot)) return '目标已经在水里挣扎了。';
    if (hexDist(this.tile(u), this.tile(tgt)) > sk.range) return `目标超出射程 · 最远 ${sk.range} 格`;
    if ((this.s.cd[u.slot].drag || 0) > 0) return `冷却 ${this.s.cd[u.slot].drag} 个己方回合`;
    if (this.s.ap[u.slot] < sk.cost) return `行动点不足 · 需要 ${sk.cost} AP`;
    return '';
  }
  /** 拖入水下：把射程内一名敌人拖进水里，挂上【溺水】。
   *  ⚠️ 只挂 debuff，**不搬动目标的位置**（用户确认的方案里没有位移，别自作聪明加）。 */
  drag(tgt) {
    const u = this.selected, reason = this.dragReason(u, tgt);
    if (reason) return this.fail(reason);
    const s = this.s, sk = SKILLS.drag;
    s.drown[tgt.slot] = sk.drownTurns;
    s.ap[u.slot] -= sk.cost;
    s.cd[u.slot].drag = sk.cd;
    s.stats[u.slot].skills++;
    this.noteAction(u, 'drag', tgt.id);
    this.emit('skill', { side: u.side, unit: u.id, fighter: u.fighter, skill: 'drag', cry: 'DARK BLUE MOON', label: sk.name,
      text: `${u.name} · ${sk.name} → ${tgt.name} · 溺水 ${sk.drownTurns} 回合（每回合结束 −${sk.drownDmg} 真实伤害）` });
    this.notice(`${tgt.name} 被拖进水里：每个回合结束时受 ${sk.drownDmg} 点真实伤害，还能挣扎 ${sk.drownTurns} 个回合结束。`);
    this.clearSelection();
    return true;
  }
  standBonus(side) { return Math.max(0, (this.fighter(side)?.standDefBonus ?? RULE.standDefBonus) - this.s.traumaCut[side]); }
  damageBonus(u) {
    // ★★ 道具「力量」（用户拍板）：攻击 +2（本局永久，按角色槽位记账）。
    // ⚠️ 加在**这里**是刻意的：`preview()` 的普攻/飞刀那两条与 `unitAttack()` 都读它，
    //    所以"界面预览显示的数字"与"实际结算伤害"必然一致（`attack()` 直接用 `pv.damage`）；
    //    而柱子 +1 与精湛剑术 +1 也走这一处——三者的口径完全一样，没有另造一套。
    return (u.kind === 'stand' ? this.pillarsOf(u.slot).length : 0) + this.swordBonus(u) + this.itemBuffs(u.slot).atk;
  }
  /** 绿宝石柱（以及第五章的「船体要害」）的护体防御。
   *  ★ 2026-10-03 用户改动：**贴着一根就给 +1，不再按根数叠加**（旧写法是"贴几根加几点"）。
   *  「己方」＝**同一队**（2v2 时队友贴着你的柱子也吃得到）。
   *  ⚠️ 船体要害也存放在 `s.pillars` 里，而且既有规则明确要求"要害给紧邻本体 +1 防御"，
   *     所以这里**不能**把 `p.part` 排除掉——它和宝石柱共用同一套相邻判定。 */
  pillarDef(u) {
    const team = teamOf(u.slot);
    return this.s.pillars.some(p => teamOf(p.slot || p.side) === team
      && hexDist(this.tile(p), this.tile(u)) === 1) ? 1 : 0;
  }
  /** 某个**角色槽位**里"本体与替身"之间的距离（单单位角色为 0）。
   *  1v1 时传 `'p1'`/`'p2'` 与改动前完全一致；2v2 请传槽位（`'p1b'`）。 */
  pairDistance(slot = this.s.turn) {
    const list = this.s.units.filter(u => u.slot === slot);
    return list.length === 2 ? hexDist(this.tile(list[0]), this.tile(list[1])) : 0;
  }
  /** 剑刃的六个直线方向（轴向 q/r 增量）。 */
  /** 剑刃沿某方向经过的格子：最多射程格，遇到岩石或宝石柱即停（该格计入路径）。 */
  bladePath(u, dir) {
    const out = [], start = this.tile(u);
    for (let step = 1; step <= SKILLS.blade.range; step++) {
      const t = this.index.byQR.get(`${start.q + dir[0] * step},${start.r + dir[1] * step}`);
      if (!t) break;
      out.push(t);
      if (this.isRock(t) || this.pillarAt(t)) break;
    }
    return out;
  }
  /** 剑刃可命中的目标：每个方向上第一个敌人；岩石/宝石柱挡下剑刃（自身不受伤害），己方单位不阻挡。 */
  bladeTargets(u) {
    const res = [];
    for (const dir of BLADE_DIRS) {
      for (const t of this.bladePath(u, dir)) {
        const occ = this.occupant(t);
        // ★ 2026-10-03：吊死者**能栖在岩石上**，而"岩石挡剑刃"说的是**挡路**——
        //   所以判据改成"岩石/柱子**挡住的是剑刃的推进**，但**站在岩石上的那个单位本身照常吃剑刃**"。
        //   ⚠️ 顺序不能反：先看格子上有没有人，空岩石才 break。
        //      宝石柱那条口径**一个字没改**（柱子仍然只挡路、不当目标——attackReason 里也拦着）。
        if (this.pillarAt(t)) break;
        if (this.isRock(t) && !occ) break;
        if (!occ) continue;
        // 倒下的角色不挡剑刃、也不吃剑刃（与 targets() 同一口径）
        if (occ.side !== u.side && (occ.kind === 'pillar' || this.slotAlive(occ.slot))) res.push(occ);
        break;
      }
    }
    return res;
  }
  bladeLineIsClear(u, tgt) { return this.bladeTargets(u).includes(tgt); }

  /**
   * 「力量」那一关在船舱里：**不撒野外地形**（船内部不该长出草丛和毒沼），
   * 场上的隔板与要害由 setupShip() 铺，剩下的交给"船体变形"动态改变。
   *
   * ★★ 2026-10-05 加地图体系：**撒哪些元素、各撒几块，全部读当前地图的 `terrain` 数据**
   *    （见 rules.js 的 `MAPS`）。判据仍然只有这一处，`default` 地图走的就是改动前那一条路：
   *      · 元素与数量＝地图 `terrain` 表里的基线 × **面积比**（`当前格数 ÷ TERRAIN_BASE_AREA`），
   *        所以 18×13 上 default 仍是 岩石 9 / 草丛 6 / 恢复点 3 / 毒沼 3（逐值一致）；
   *      · 合法格＝**不与任何单位的出生点相邻**（`hexDist > 1`）**且不是地图特性地面**
   *        （甲板这类"人造地面"不长野外地形；default 没有这种格子，所以候选集与改动前完全相同）；
   *      · 从合法格里**随机挑**（洗牌算法与随机数消耗顺序一个字没改）。
   */
  generateTerrain() {
    if (this.shipRule()) return;
    const spawn = this.s.units.map(u => this.tile(u));
    const open = this.tiles.filter(t => spawn.every(st => hexDist(st, t) > 1) && !this.featureGround(t));
    for (let i = open.length - 1; i > 0; i--) {
      const j = Math.min(i, Math.floor(this.random() * (i + 1)));
      [open[i], open[j]] = [open[j], open[i]];
    }
    // 数量按面积等比放大（见 rules.js 的 TERRAIN_BASE_AREA 那段说明）：18×13 时是 岩石 9 / 草丛 6 / 恢复点 3 / 毒沼 3
    const ratio = (COLS * ROWS) / TERRAIN_BASE_AREA;
    for (const [type, base] of Object.entries(this.map().terrain || {})) {
      const count = Math.max(base, Math.round(base * ratio));
      for (let i = 0; i < count; i++) this.s.terrain[tileKey(open.pop())] = type;
    }
  }
  /**
   * 这一格是不是**地图特性铺出来的地面**（目前只有水域地图的甲板：2026-10-05 用户拍板后是
   * **横跨左右全宽、厚 3 行、垂直居中**的一条带子，18×13 上是行 5~7、共 54 格）。
   * 用途只有一处：`generateTerrain()` 不往甲板上撒野外地形（甲板是"船上的木地板"，
   * 不该长出礁石与毒沼）。没有特性地面的地图（default）恒为 false，所以那条撒法一字未动。
   * ⚠️ 判据仍然只有"在不在 `deckRect()` 里"这一条，**与甲板多大无关**——甲板改宽改窄它自动跟着走。
   */
  featureGround(t) {
    const deck = this.deckRect();
    if (!deck || !t) return false;
    return t.row >= deck.rowStart && t.row <= deck.rowEnd
      && t.col >= deck.colStart && t.col <= deck.colEnd;
  }

  /* ============================== 可拾取的道具 ==============================
   * ★★ 2026-10-05 用户拍板（数值与出场规则见 rules.js 的 `ITEM_TYPES` / `ITEM_RULE`）。
   * ⚠️ 这一段的**判据只在这几个方法里**，别在别处再写一份"能不能放道具 / 捡到加什么"。
   */

  /** 道具规则：这一局开不开、开几个（读**当前地图**的 `items`；`null` ＝ 这张图没有道具）。 */
  itemRule() { return resolveItemRule(this.map()); }
  /** 这一格上的道具（没有就是 `null`）。 */
  itemAt(t) { return t ? this.s.items.find(item => item.row === t.row && item.col === t.col) || null : null; }
  /**
   * 某个槽位从道具拿到的**永久加成**（按角色槽位记账）。没有道具时返回那份冻结的空值。
   * ⚠️ 四个数值的**生效点**（都要接在既有口径上，别另造一套）：
   *   · `atk` → `damageBonus()`（于是 `preview()` 与 `unitAttack()` 一起吃到，预览与实际结算永远一致）；
   *   · `def` → `baseDefense()`（草丛／岩石／柱子那些照旧叠加）；
   *   · `move` → `moveRange()`（受水域 −1、藤蔓 −1 之类也不冲突）；
   *   · `dist` → `distLimit()`（就是"本体与替身距离上限"那条既有的判据）。
   */
  itemBuffs(slot) { return this.s.itemBuffs?.[slot] || NO_ITEM_BUFF; }
  /**
   * **双方出生点** ＝ 按摆位表（`deploySpot`）算出来的开局格，**与棋子现在站在哪无关**。
   * 用途只有一处：道具「开局离出生点至少若干格」这条判据（别让谁一开局就白捡）。
   */
  spawnTiles() {
    const twoSided = this.s.slots.length > 2;
    return this.s.slots.flatMap(slot => {
      const f = this.s.fighters[slot];
      if (!f) return [];
      return (f.stand ? ['user', 'stand'] : ['user'])
        .map(kind => deploySpot(slot, f, kind, twoSided))
        .map(spot => this.at(spot.row, spot.col)).filter(Boolean);
    });
  }
  /**
   * 这一格是不是第五章「力量」里**会翻转的隔板位**（钢壁 ⇄ 空地，见 `tickBulwarks`）。
   * 用途只有一处：`itemSpots()` 不往这些格子上放道具（否则变形会把它"砌进墙里"）。
   * 别的章节 `shipRule()` 是 null，恒为 false。
   */
  bulwarkSlot(t) {
    const slots = this.shipRule()?.bulwarkSlots;
    return !!t && !!slots && slots.some(slot => slot.row === t.row && slot.col === t.col);
  }
  /**
   * ★★ 道具落点的**合法格池**——判据**只有这一处**（开局与刷新共用）。合法＝
   *   · **不贴边**（离棋盘每条边至少 `edge` 格；由 COLS/ROWS 算，别写死行列）；
   *   · **不压地形**（岩石／草丛／恢复点／毒沼，也就是 `s.terrain` 里有东西的格子）；
   *   · **不压甲板**（地图特性铺出来的"人造地面"，与 `generateTerrain()` 避开的是同一批判据）；
   *   · **不落在会变形的隔板位上**（第五章「力量」：`bulwarkSlots` 那几格会在钢壁与空地之间翻转，
   *     道具落在那儿会被"砌进墙里"——虽然翻回来又拿得到，但读起来别扭，所以一开始就不放那儿）；
   *   · **不与任何棋子／柱子／反光点／已有道具重叠**；
   *   · **避开锚点若干格**（`spawn + 1` 格以内都不放）：开局锚点＝双方出生点、刷新锚点＝场上所有棋子。
   *
   * ⚠️ **水域是可以放道具的**（这是对"不压甲板/水域"那条要求的一处**有意取舍**，理由实测过）：
   *    浅滩水路这张图**除甲板以外全是水**，两条同时成立时一个合法格都挑不出来
   *    （实测 1v1 `pool = 0`）——那样用户要的"两张地图都开道具"就直接落空了。
   *    所以口径定为"**甲板不压**（甲板是'人造地面'，与地形撒法避的是同一批格子）、
   *    **水面上可以漂着道具**"：水里捡同样要付"水里起步移动 −1"那份代价，地图特性一点没被绕开。
   * ⚠️ 挑不满就**不硬塞**（返回的池子里有几个算几个，调用方照 `Math.min` 取）——绝不会抛错。
   */
  itemSpots({ edge = null, spawn = null, from = null } = {}) {
    const rule = this.itemRule();
    if (!rule) return [];
    const margin = edge ?? rule.edge, gap = spawn ?? rule.spawn;
    const anchors = from || this.spawnTiles();
    return this.tiles.filter(t => {
      if (t.row < margin || t.row > ROWS - 1 - margin) return false;
      if (t.col < margin || t.col > COLS - 1 - margin) return false;
      if (this.s.terrain[tileKey(t)]) return false;
      if (this.featureGround(t)) return false;
      if (this.bulwarkSlot(t)) return false;
      if (this.occupant(t) || this.pillarAt(t)) return false;
      if (this.mirrorAt(t)) return false;
      if (this.itemAt(t)) return false;
      return anchors.every(anchor => hexDist(anchor, t) > gap);
    });
  }
  /** 加权随机取一种道具（认不出的种类与 ≤0 的权重都不算）。池子为空时返回 `null` 且**不消耗随机数**。 */
  pickItemType() {
    const weights = Object.entries(this.itemRule()?.weights || {});
    const total = weights.reduce((sum, [, weight]) => sum + weight, 0);
    if (!(total > 0)) return null;
    let roll = this.random() * total;
    for (const [type, weight] of weights) {
      roll -= weight;
      if (roll < 0) return type;
    }
    return weights.at(-1)[0];
  }
  /**
   * 在合法空地上摆 `count` 个道具（洗牌挑格、加权挑种类，随机源与既有的 `generateTerrain` / `generateMirrors` 同一个）。
   * ⚠️ 三条口径：
   *   ① `max` 这道闸也在这里守着：最多补到 `max` 个（场上满了就一个都不刷）；
   *   ② **地毯式挑选**：池子空了（无处可放）就停在原地，不崩、不硬塞到不该放的格子上；
   *   ③ 只有**中途刷新**（`announce:true`）才写一句战斗记录；开局那两个是静默摆好的
   *      （界面靠棋盘上的图标与图例说明，开局不该先刷两条日志）。
   */
  spawnItems(count = 1, { spawn = null, from = null, announce = false } = {}) {
    const rule = this.itemRule();
    if (!rule || count <= 0) return [];
    const room = Math.min(count, rule.max - this.s.items.length);
    if (room <= 0) return [];
    const pool = this.itemSpots({ spawn, from });
    for (let i = pool.length - 1; i > 0; i--) {
      const j = Math.min(i, Math.floor(this.random() * (i + 1)));
      [pool[i], pool[j]] = [pool[j], pool[i]];
    }
    const out = [];
    for (const t of pool.slice(0, Math.max(0, room))) {
      const type = this.pickItemType();
      if (!type) break;
      const item = { id: `item-${this.epoch}-${t.row}-${t.col}`, type, name: ITEM_TYPES[type].name,
        row: t.row, col: t.col, turn: this.s.turnNumber };
      this.s.items.push(item);
      out.push(item);
      if (announce) {
        this.emit('status', { side: null, tile: t, text: `${ITEM_TYPES[type].name}道具落在 ${tileLabel(t)} · 走上去就能捡走` });
      }
    }
    return out;
  }
  /**
   * **回合刷新**：每 `everyTurns` 个回合在空地补 1 个（上限 `max`）。
   * ⚠️ 时钟是 `s.turnNumber`（`enterTurn()` 只在这一处加 1），所以"第 3、6、9…个回合"各补一次；
   *    刷新时的锚点是**场上所有棋子**（离谁都至少 2 格），免得凭空送到谁脚底下。
   */
  tickItems() {
    const rule = this.itemRule();
    if (!rule || !(rule.everyTurns > 0)) return [];
    if (this.s.turnNumber % rule.everyTurns !== 0) return [];
    if (this.s.items.length >= rule.max) return [];
    return this.spawnItems(1, { spawn: rule.refreshClear, from: this.s.units.map(u => this.tile(u)).filter(Boolean), announce: true });
  }
  /**
   * ★★ **走上去就捡走**（`move()` 落点结算的最后一步，与 `applyTerrain()` 同一处）：
   *   格子清空 → 加成**按角色槽位**立刻生效 → 写进战斗记录（措辞照既有 `status` 那一套）。
   * ⚠️ 三条别写歪：
   *   ① 「连携」对**没有替身棋子**的角色（数据判据 `fighter.stand` 在不在，不按角色名）**改成移动 +1**；
   *   ② 「时间」是**当场 +1 行动点**（不进加成表）——而捡它本身要走上那一格（移动扣 1 AP），
   *      所以净账是"这一趟移动不花行动点"，绝不会凭空把行动点顶到超过本回合开始时那个数；
   *   ③ 返回**被捡走的那件道具**（界面/调用方据此改提示语），没捡到就是 `null`。
   */
  pickItem(u) {
    const tile = this.tile(u), item = this.itemAt(tile);
    if (!item) return null;
    const def = ITEM_TYPES[item.type];
    this.s.items = this.s.items.filter(x => x !== item);
    this.touch();
    if (!def) return item;                         // 认不出的种类：只把格子清空，绝不抛错
    const slot = u.slot;
    // 保险：万一这个槽位不在记账表里（非正常路径），就地补一份空的，绝不在捡东西时抛错
    const buffs = this.s.itemBuffs[slot] || (this.s.itemBuffs[slot] = { ...NO_ITEM_BUFF });
    const { key, amount } = this.itemEffect(def, slot);
    if (key === 'ap') this.s.ap[slot] += amount;   // 一次性：当场生效，不记账
    else buffs[key] += amount;                     // 永久：按槽位记账，本体与替身一起吃
    this.emit('status', { side: slot, unit: u.id, tile, text: this.itemPickupText(item, u) });
    return item;
  }
  /**
   * 这一件道具对某个槽位**实际**加到哪本账上（含用户点名的"连携对单单位角色改成移动 +1"那条口径）。
   * ⚠️ 判据是**数据**（`FIGHTERS.xxx.stand` 在不在），**不按角色名硬编码**；
   *    拾取、文案、AI 估价三处都调它，所以"改了什么"与"说成什么"不可能对不上。
   */
  itemEffect(def, slot) {
    const solo = def.buff === 'dist' && !this.fighter(slot)?.stand;
    const eff = solo ? (ITEM_TYPES[def.soloFallback] || def) : def;
    return { key: eff.buff, stat: eff.stat, amount: eff.amount, grab: eff.grab, solo };
  }
  /** 捡到某件道具之后提示语该写什么（与战斗记录同一条口径，界面只负责显示）。 */
  itemPickupText(item, u) {
    const def = ITEM_TYPES[item?.type];
    if (!def) return '';
    const { stat, amount, solo } = this.itemEffect(def, u?.slot);
    return `${u?.name || '棋子'} 捡到「${def.name}」· ${stat} +${amount}（${def.duration}）${solo ? ' · 这个角色没有替身棋子，改记成移动 +1' : ''}`;
  }
  /** 这一件道具对某个槽位值多少分（**AI 走位评分**用；口径与拾取效果同一处，别在 ai.js 里另写一份）。 */
  itemGrabValue(item, slot) {
    const def = ITEM_TYPES[item?.type];
    return def ? this.itemEffect(def, slot).grab || 0 : 0;
  }

  /** Paths and reachability use the same BFS; only the final tile has a tether limit. */
  paths(u) {
    // ★ 第八章「反光点」：**只在反光点与岩石之间跳**的棋子（吊死者）没有"走过的路"——
    //   它每一跳都是一步到位，所以"路径"就是 `[落点]` 这一格。
    //   渲染的跳跃动画、AI 的落点检查（`paths(u).get(...)`）、界面的悬停预览共用这里。
    if (this.mirrorWalker(u)) {
      return new Map(this.reachable(u).map(t => [tileKey(t), [t]]));
    }
    const from = this.tile(u), result = new Map();
    if (!from) return result;
    const seen = new Set([tileKey(from)]);
    let frontier = [{ tile: from, path: [] }];
    // 移动距离一律走 moveRange()：藤蔓 −1、海面关卡在水里再 −1（**只有玩家方**受影响）。
    // ⚠️ 这里原来把两者各写了一遍，加水域规则时就会漏掉一处——高亮显示能走 4 格、实际只能走 3 格。
    //    凡是「能走几格」都只认 moveRange() 这一个出口。
    const steps = this.moveRange(u);
    for (let step = 0; step < steps; step++) {
      const next = [];
      for (const entry of frontier) for (const t of this.near(entry.tile)) {
        const key = tileKey(t);
        if (seen.has(key) || this.isRock(t) || this.occupant(t)) continue;
        seen.add(key);
        const path = [...entry.path, t];
        result.set(key, path);
        next.push({ tile: t, path });
      }
      frontier = next;
    }
    return result;
  }
  reachable(u) {
    // ★★ 第八章「反光点」：**只在反光点与岩石之间跳**的棋子走这条专用分支——
    //   落点＝**所有还没被封、也没被占着的反光点** ∪ **所有没被占用的岩石格**（★ 2026-10-03
    //   用户第三次拍板加的后一半），**不判移动距离、不判路径阻挡、也不受连携距离限制**
    //   （用户定："花 1 AP 就能跳到任意一个反光点"，"在倒影之间跳跃"）。
    //   反过来说：它**一个普通空地都落不了**（这一分支里根本不看 BFS 的结果）。
    //   ⚠️ 判据统一走 `mirrorLanding()`，别在这里再写一遍（`moveReason()` 读的是同一个）。
    if (this.mirrorWalker(u)) {
      const spots = this.s.mirrors.filter(m => this.mirrorOpenFor(m)).map(m => this.at(m.row, m.col));
      const rocks = this.tiles.filter(t => this.isRock(t) && this.mirrorLanding(t));
      return [...spots, ...rocks];
    }
    const partner = this.partner(u), anchor = this.tile(partner);
    return [...this.paths(u).values()].map(p => p[p.length - 1])
      .filter(t => !anchor || hexDist(t, anchor) <= this.distLimit(u.slot));
  }
  targets(u, range = u?.range || 0) {
    if (!u || !range) return [];
    // ⚠️ 2026-10-04 起：倒下的角色**棋子已经离场**（见 `removeFallenSlot`），所以这里其实
    //    筛不到什么；留着这道判据是为了兜住"血量被别处改成 0"这种非正常路径（旧口径：2v2 里
    //    倒下的角色留在棋盘上但不再是目标——那套取舍已被用户推翻）。1v1 归零就直接结算了。
    return [...this.s.units, ...this.s.pillars]
      .filter(t => t.side !== u.side && hexDist(this.tile(u), this.tile(t)) <= range)
      .filter(t => t.kind === 'pillar' || this.slotAlive(t.slot));
  }
  placement(u, skill = this.s.pendingSkill) {
    if (!u || !SKILLS[skill]?.range) return [];
    let out = this.tiles.filter(t => hexDist(this.tile(u), t) <= SKILLS[skill].range && !this.isRock(t) && !this.occupant(t));
    if (skill === 'flame') {
      out = out.filter(t => !this.fireAt(t));
      const last = this.s.flamePlaced.at(-1);
      if (last) out = out.filter(t => hexDist(t, last) === 1);
    }
    return out;
  }

  actorReason(u) {
    if (this.s.phase !== 'battle') return '对局尚未开始或已结束。';
    if (!u || !this.s.units.includes(u)) return '请先选择己方单位。';
    if (u.slot !== this.s.turn) return '现在是对手的回合。';
    // 「力量」第一阶段：本体**自己也不出手**——他藏在船里操纵整艘船，出手的是船体要害；
    // 要害全拆掉之后才被迫现身、开始真打（用户 2026-09-26 定的方案）。
    // ⚠️ 拦在 actorReason 里，移动/攻击/技能就一起挡住了，不用在三个地方各写一遍。
    if (this.shipRule() && this.shipParts(u.side).length > 0) {
      return '他藏在船里操纵整艘船 · 拆完全部船体要害才会现身出手';
    }
    return '';
  }
  select(id) {
    const u = this.unit(id), reason = this.actorReason(u);
    if (reason) return this.fail(reason);
    if (this.s.pendingSkill === 'flame' && this.s.flamePlaced.length) this.finishFlame();
    // ★ 暗枪同理：换人之前先把这一手收干净（已埋下的标记照旧留在场上，见 finishDarkgun）。
    if (this.s.pendingSkill === 'darkgun' && this.s.darkPlaced.length) this.finishDarkgun();
    this.s.selectedId = id;
    this.s.pendingSkill = null;
    this.s.flamePlaced = [];
    this.s.darkPlaced = [];
    this.s.action = 'move';
    this.checkTimeWindow();
    this.notice(`${u.name}已就绪。选择落点或目标；Esc 取消选择。`);
    return true;
  }
  cancel() {
    if (this.s.phase !== 'battle') return false;
    if (this.s.pendingSkill === 'flame' && this.s.flamePlaced.length) return this.finishFlame();
    // ★ 暗枪的 Esc：与火焰那套一致——"提前收手"，把这一手结束掉（已埋的标记不会撤销）。
    if (this.s.pendingSkill === 'darkgun' && this.s.darkPlaced.length) return this.finishDarkgun();
    if (this.s.pendingSkill) {
      this.s.pendingSkill = null;
      this.s.flamePlaced = [];
      this.s.darkPlaced = [];
      this.notice('已取消瞄准，未消耗行动点。');
    } else {
      this.s.selectedId = null;
      this.notice('选择已取消。已结算的行动不会撤销。');
    }
    this.s.action = 'move';
    return true;
  }
  clearSelection() {
    this.s.selectedId = null;
    this.s.pendingSkill = null;
    this.s.flamePlaced = [];
    // ★ 暗枪这一手点过的格子也一起清掉。⚠️ 它只是"这一手"的记账，**不是**场上的标记：
    //   场上的标记在 `s.darkMarks` 里，不会被这里清掉（要等对手回合结束才结算／清空）。
    this.s.darkPlaced = [];
    this.s.action = 'move';
  }
  chooseAction(action) {
    if (!this.selected) return this.fail('请先选择己方单位。');
    if (this.s.pendingSkill === 'flame' && this.s.flamePlaced.length) return this.fail('请先完成已开始的火焰铺设。');
    // ★ 暗枪：埋到一半就去点"移动／普攻"，第二个位置会留在半空中，所以照火焰那条口径拦住。
    if (this.s.pendingSkill === 'darkgun' && this.s.darkPlaced.length) {
      return this.fail(`请先埋好第二个${SKILLS.darkgun.name}位置（Esc 可以提前收手）。`);
    }
    if (action === 'attack' && !this.selected.range) return this.fail('替身使者无法普通攻击；请选择替身。');
    this.s.pendingSkill = null;
    this.s.darkPlaced = [];
    this.s.action = action === 'attack' ? 'attack' : 'move';
    this.notice(action === 'attack' ? '选择红色标记中的敌方目标。' : '选择带三角标记的落点。');
    return true;
  }

  actionAt(t) {
    if (!t || this.s.phase !== 'battle') return false;
    const clicked = this.occupant(t), u = this.selected;
    if (u && this.s.pendingSkill) {
      if (this.s.pendingSkill === 'vine') return this.vine(clicked);
      if (this.s.pendingSkill === 'sandblast') return this.sandblast(clicked);
      if (this.s.pendingSkill === 'drag') return this.drag(clicked);
      // ★「皇帝」：点一个敌方单位＝锁定它（延迟一回合结算），走的是和扬沙／拖入水下同一条"选目标"分支。
      if (this.s.pendingSkill === 'emperor') return this.emperorLock(clicked);
      // ★★「暗枪」：点的是**格子**（不是单位）——被棋子占着的格子照常能标，
      //   所以这一支排在下面那条 `place()`（它只认空格）**之前**，而且传的是 `t` 不是 `clicked`。
      if (this.s.pendingSkill === 'darkgun') return this.darkgunMark(u, t);
      if (['emerald', 'flame'].includes(this.s.pendingSkill)) return this.place(u, t);
      // ★★「重组」（东方仗助）：**点技能 → 选目标 → 选选项**——所以第一次点棋子只是"选定目标"
      //   （`pickRebuildTarget`），真正执行要等玩家在选项里挑一个（`confirmRebuild`）。
      if (this.s.pendingSkill === 'rebuild') return this.pickRebuildTarget(u, clicked);
      if (clicked) return this.attack(u, clicked, this.s.pendingSkill);
      return this.fail('请选择射程内的敌人或敌方宝石柱，Esc 取消瞄准。');
    }
    if (clicked?.slot === this.s.turn && clicked.kind !== 'pillar') return this.select(clicked.id);
    // ★ 东方仗助「修复」：**普攻也可以指向友军**（＝治疗）。判据在 `fixTargets()` 里
    //   （同队、不是自己、活着、射程内），所以这里只认"这一枚友军确实可治"的情况，
    //   其余友军照旧还是"选中它"（`select`），不会误伤玩家的操作习惯。
    if (clicked && this.fixTargets(u).includes(clicked)) return this.mend(u, clicked);
    if (!u) return this.fail(clicked ? '这是敌方单位。先选择己方替身才能攻击。' : '请先选择己方单位。');
    if (clicked) return this.attack(u, clicked);
    if (this.s.action === 'attack') return this.fail('这一格没有敌方目标。');
    return this.move(u, t);
  }

  moveReason(u, t) {
    const reason = this.actorReason(u);
    if (reason) return reason;
    if (this.s.ap[u.slot] < RULE.moveCost) return '行动点不足，请结束回合。';
    // ★ 第八章：只在反光点与岩石之间跳的棋子（吊死者）**跳多远都行、也不受连携距离限制**，
    //   唯一的条件是"落点是一个还没被封的反光点，或者一块没被占用的岩石"（见 mirrorLanding）。
    //   ⚠️ 所以"岩石阻挡通行"这条对它是**例外**——它恰恰能站在岩石上；但被单位／柱子占着的
    //     格子（无论是不是岩石）照旧落不了，被封的反光点也照旧落不了（`mirrorLanding` 里判）。
    //   ⚠️ 这条分支必须排在下面那两条通用判据**之前**，否则岩石格会先被"岩石阻挡通行"顶掉。
    if (this.mirrorWalker(u)) {
      return this.mirrorLanding(t) ? ''
        : `吊死者只能落在还没被封的${MIRRORS.name}上，或者没被占用的岩石格上。`;
    }
    if (!t || this.isRock(t)) return '岩石阻挡通行，请选择其他落点。';
    if (this.occupant(t)) return '落点已被单位或宝石柱占据。';
    const anchor = this.tile(this.partner(u));
    if (anchor && hexDist(t, anchor) > this.distLimit(u.slot)) return `落点距同伴 ${hexDist(t, anchor)} 格，超过 ${this.distLimit(u.slot)} 格上限。`;
    if (!this.paths(u).has(tileKey(t))) return `无法在 ${u.move} 步内到达这个落点。`;
    return '';
  }
  move(u, t) {
    const reason = this.moveReason(u, t);
    if (reason) return this.fail(reason);
    const s = this.s, from = this.tile(u), path = this.paths(u).get(tileKey(t)), travelled = [];
    s.ap[u.slot] -= RULE.moveCost;
    s.stats[u.slot].moves++;
    this.clearSelection();
    let fireHit = false;
    for (const step of path) {
      u.row = step.row; u.col = step.col;
      travelled.push(step);
      const fire = this.fireAt(step);
      if (fire && fire.side !== u.side && !fireHit) {
        fireHit = true;
        this.damage(u, RULE.fireDmg, { side: fire.side, source: '火焰道路', terrain: true });
        this.addBurn(u.slot);
        if (s.hp[u.slot] <= 0) break;
      }
    }
    this.emit('move', { unit: u.id, side: u.side, from, path: travelled, text: `${u.name} → ${tileLabel(this.tile(u))} · 消耗 1 AP` });
    if (s.hp[u.slot] > 0) this.applyTerrain(u);
    // ★★ 道具：**走上去就捡走**（与 `applyTerrain()` 同一处结算：落点上的地形效果与道具一起生效）。
    //   ⚠️ 只在"这一步真的走成了"之后调用——被拒的移动在 `moveReason()` 就 return 了，捡不到东西。
    const picked = s.hp[u.slot] > 0 ? this.pickItem(u) : null;
    this.checkEnd();
    this.checkTimeWindow();
    if (s.phase === 'battle') {
      // 捡到东西时提示语换成那一条（战斗记录里也照旧有一条 `status`），否则与改动前逐字相同。
      this.notice(picked ? this.itemPickupText(picked, u)
        : s.ap[u.slot] ? `移动完成，剩余 ${s.ap[u.slot]} AP。` : '行动点已用完。可使用已就绪的零消耗技能，或结束回合。');
    }
    return true;
  }

  /** 基础防御：波鲁纳雷夫处于「卸甲」形态时归零，穿回装甲即恢复。 */
  /** 基础防御：卸甲时为 0；潜沙的 +1 与「史莱姆防御」的 +2 都只加在基础防御上（草丛/岩石等加成照旧叠加）。 */
  baseDefense(side) {
    if (this.s.armorOff?.[side]) return 0;
    // ★ 东方仗助：被「修复」削掉防御力时减在这里（防御的唯一出口，卡片与预览都读它）；
    //   「重组·回滚」补回来的差额同样加在这里，下限 0。
    return Math.max(0, this.fighter(side).def
      + (this.s.sandGuard?.[side] ? SKILLS.dive.guard : 0)
      + (this.s.slimeGuard?.[side] ? SKILLS.slime.guard : 0)
      // ★★ 道具「护盾」（用户拍板）：基础防御 +1（本局永久，按角色槽位记账）——
      //    加在**基础防御**上，于是草丛 +3、邻石 +1、柱子 +1 那些照旧照常叠加。
      + this.itemBuffs(side).def
      - this.fixPenalty(side, 'def') + this.s.fixRestore[side].def);
  }
  /** 剑术被动：卸甲期间每次攻击 +1、最多 +3；加成永久保留，穿回装甲后依然生效。 */
  swordBonus(u) {
    if (!u || u.kind !== 'stand') return 0;
    if (!this.skills(u.slot).includes('mastery')) return 0;
    return Math.min(RULE.masteryMax, this.s.swordBuff[u.slot] || 0);
  }
  /** 技能显示名：装甲／卸甲这类双形态技能，名字随当前形态变化。 */
  skillLabel(key, side) {
    const sk = SKILLS[key];
    if (!sk) return '';
    if (key === 'armor') return this.s.armorOff?.[side] ? (sk.altName || sk.name) : sk.name;
    return sk.name;
  }
  defense(tgt, skill = null) {
    if (tgt.kind === 'pillar') return { base: 0, stand: 0, bush: 0, rock: 0, pillar: 0, total: 0 };
    const d = { base: this.baseDefense(tgt.slot), stand: tgt.kind === 'stand' ? this.standBonus(tgt.slot) : 0,
      bush: skill !== 'ora' && this.s.terrain[tileKey(this.tile(tgt))] === 'bush' ? RULE.bushDefBonus : 0,
      rock: skill !== 'ora' && this.adjRock(this.tile(tgt)) ? RULE.rockAdjDef : 0,
      pillar: skill !== 'ora' ? this.pillarDef(tgt) : 0 };
    return { ...d, total: Object.values(d).reduce((a, b) => a + b, 0) };
  }
  /**
   * ★★ 出手方的「穿甲」（**数据字段**，见 rules.js 的 `FIGHTERS.geil.stand.armorPierce`）。
   * 口径（2026-10-03 用户拍板）：他打人时**目标防御按这个数下调，下限 0**——
   *   · 只有"防御"这一个数被削，**草丛／邻石／宝石柱那些地形与对象加成照旧照常叠加**；
   *   · 所以它**不是** `pierce`（真实伤害／无视防御）那条"防御全部归零"的通道，别混用；
   *   · 全项目只有吊死者身上有这个字段，别处读到 `undefined` → `?? 0`，逐值等价、一个数都不动。
   * ⚠️ 只在 `preview()` 里生效（`attack()` 直接使用 `pv.damage`），所以**界面瞄准时显示的伤害
   *    与实际结算必然一致**；`defense()` 本身不动（单位卡上显示的是目标自己的防御，不该随谁在瞄它而变）。
   */
  armorPierceOf(u) { return Math.max(0, u?.armorPierce || 0); }
  preview(u, tgt, skill = null, fixedAttack = null) {
    if (!u || !tgt) return null;
    /**
     * ★ 东方仗助（2026-10-09 用户设计）：**普攻指向友军＝治疗**，预览要能显示"能回多少血"。
     * 口径与 `mend()` 完全一致（治疗量 ＝ 攻击力 − 2，再走 `healAmount` 扣掉上限与灼烧减疗的部分），
     * 所以界面瞄准友军时看到的数字就是真正会发生的结果。
     * ⚠️ 只有"拥有 `fix` 且目标不是自己这个角色"时才给这份预览（"不能治自己"）。
     */
    if (tgt.side === u.side) {
      if (tgt.kind === 'pillar' || tgt.slot === u.slot || !this.skills(u.slot).includes('fix') || !this.slotAlive(tgt.slot)) return null;
      const heal = this.fixHeal(u);
      return { attack: this.unitAttack(u), defense: { base: 0, stand: 0, bush: 0, rock: 0, pillar: 0, total: 0 },
        damage: 0, hp: this.s.hp[tgt.slot], hpAfter: Math.min(this.fighter(tgt.slot).hp, this.s.hp[tgt.slot] + heal),
        lethal: false, heal, miss: 0, dealt: 0, wins: false, friendly: true, healActual: this.healAmount(tgt.slot, heal) };
    }
    // 剧情模式的觉醒加成加在「攻击力」上，所以凡是按攻击力结算的技能都吃得到（含普攻）
    const story = this.storyAttack(u.slot);
    // 「力量」那一关：每拆掉一个船体要害，玩家伤害 +1（用户 2026-09-27 定的成长）。
    // ⚠️ 这一项**加在最终伤害上**（不加进 `story`）：加进 story 的话欧拉欧拉会把它翻倍
    //    （(攻击力+story)×2），那就不是"伤害 +1"而是"+2"了。
    const breakBonus = this.shipBreakBonus(teamOf(u.slot));
    // ★ 第八章「场边冷枪」：`fixedAttack` 是"这一枪的攻击力"（冷枪＝SNIPER.dmg）。
    //   不传时（**所有既有调用**）仍然是出手者自己的攻击力，逐值等价。
    // ★ 东方仗助「重拳」（2026-10-09 用户定）：伤害 ＝ **当前攻击力 × 2**，按常规结算防御。
    //   ⚠️ 直接取 `unitAttack(u) * 2`（它已经把道具、剧情觉醒、拆船成长、削项与回滚都算进去了），
    //      所以**不再叠加**下面那句 `+ breakBonus + hatredAtkBonus`（那是既有技能的口径）。
    const attack = skill === 'heavy' ? this.unitAttack(u) * 2
      : (fixedAttack != null ? fixedAttack
      : skill === 'hamon' ? SKILLS.hamon.base + (this.vined(tgt) ? SKILLS.hamon.bonus : 0)
      // 扬沙（伊奇）：固定 3 点真实伤害（用户 2026-09-30 加的）。
      // ⚠️ 必须写进 preview：界面瞄准时读的就是它——不写的话，瞄准"扬沙"会显示成
      //    "普攻伤害"（预览原来就掉进了下面那条按攻击力兜底的分支，玩家看到的是错的数字）。
      : skill === 'sandblast' ? SKILLS.sandblast.dmg
      // 飞刀（DIO）：伤害＝自身攻击力（本体扔也按替身的攻击力算，见 strikePower）。
      // ⚠️ 时停的额外回合里**伤害不变**（用户 2026-09-30 先要过 +1、随后取消）——那一回合只免冷却。
      : skill === 'knife' ? this.strikePower(u) + this.damageBonus(u) + story
      : skill === 'ora' ? (u.dmg + story) * 2 : skill === 'splash' ? SKILLS.splash.base + SKILLS.splash.perPillar * this.pillarsOf(u.slot).length
      : skill === 'drain' ? SKILLS.drain.base : skill === 'star' ? u.dmg + story
        // 沙之爪：攻击力 +3；目标「共享生命低于一半」时再 +2（严格低于，不含正好一半）
        : skill === 'claw' ? u.dmg + SKILLS.claw.bonus
          + (tgt.kind !== 'pillar' && this.s.hp[tgt.slot] * 2 < this.fighter(tgt.slot).hp ? SKILLS.claw.execute : 0)
          // 针舌穿刺（灰塔）：攻击力 +2；目标「当前不是满血」时再 +2
          : skill === 'needle' ? u.dmg + SKILLS.needle.bonus
            + (tgt.kind !== 'pillar' && this.s.hp[tgt.slot] < this.fighter(tgt.slot).hp ? SKILLS.needle.execute : 0)
          // ★「皇帝」（霍尔·霍斯）：固定 10 点，**按常规结算防御**（下面那条 pierce 不认它）。
          //   预览要能显示这一下——真人瞄准与 AI 选招读的都是这个数。
          : skill === 'emperor' ? SKILLS.emperor.dmg
          // ★★「暗枪」：固定 8 点，**按常规结算防御**（与「皇帝」同一条通道，
          //    所以下面那条 `pierce` 也要把它排除在外——用户定："8 点按常规结算防御"）。
          : skill === 'darkgun' ? SKILLS.darkgun.dmg
          : skill === 'blade' ? u.dmg + this.swordBonus(u) + RULE.bladeBonus + story
            // 吸盘突袭（暗蓝之月）：攻击力 +3；目标正在【溺水】时再 +2
            : skill === 'sucker' ? u.dmg + SKILLS.sucker.bonus
              + (tgt.kind !== 'pillar' && this.drowning(tgt.slot) ? SKILLS.sucker.execute : 0)
            : u.dmg + this.damageBonus(u) + story) + breakBonus + this.hatredAtkBonus(u);
    // 波纹疾走与扬沙都是真实伤害：无视草丛、岩石、宝石柱与基础防御。
    // ★★ 「瞄准」（霍尔·霍斯）：生效期间**他打出去的每一击**也走同一条通道（防御全部归零）。
    //    ⚠️「皇帝」自己那一下**不吃**这个（用户定：皇帝按常规结算防御）——所以它被排除在外。
    //    ★★「暗枪」同理：用户定的也是"8 点按常规结算防御"，所以**不消耗**「瞄准」的次数、
    //       也**不吃**它的无视防御（`spendAim` 只在普攻那条路上调用，这里根本不经过那一支）。
    const pierce = ['hamon', 'sandblast'].includes(skill)
      || (!['emperor', 'darkgun'].includes(skill) && this.aimPierce(u));
    const rawDefense = pierce
      ? { base: 0, stand: 0, bush: 0, rock: 0, pillar: 0, total: 0 } : this.defense(tgt, skill);
    // ★★ 「穿甲」（`u.armorPierce`，全项目只有吊死者身上有）：**只把防御那个数往下调 2、下限 0**，
    //   草丛／邻石／宝石柱那几项原封不动地留在上面（＝"照旧叠加"），也**不走 pierce 那条真伤通道**。
    //   ⚠️ 必须写进 preview：界面瞄准时读的就是 `pv.defense` 与 `pv.damage`，不写这里预览就会
    //      比实际结算多显示 2 点伤害（骗玩家）。真伤（pierce）时防御本来就是 0，不必再削。
    const armorPierce = pierce ? 0 : this.armorPierceOf(u);
    const defense = armorPierce
      ? { ...rawDefense, pierce: armorPierce, total: Math.max(0, rawDefense.total - armorPierce) }
      : rawDefense;
    // 灰塔的「伪装」被动：每个对手回合里第一次被攻击时伤害 −2。
    // 必须算在 preview 里（attack() 直接使用 pv.damage），否则界面预览和实际结算会对不上。
    // 这里只读取状态、不改状态；标记是在 attack() 真正打到人时才置位。
    const disguiseCut = tgt.kind !== 'pillar' && !this.s.disguiseUsed[tgt.slot] && this.skills(tgt.slot).includes('disguise')
      ? SKILLS.disguise.cut : 0;
    const damage = Math.max(1, attack - defense.total - disguiseCut), hp = tgt.kind === 'pillar' ? tgt.hp : this.s.hp[tgt.slot];
    // ★★ 剧本保护（`scene.hpFloor`）：预览必须**与真实结算口径一致**——
    //   他的血最低停在 1，所以"这一下打不死他"要在这里就体现出来（`lethal` / `wins` 都得是假），
    //   否则界面上会亮出一个永远打不出来的"致命一击"标记，AI 也会按假数字算分。
    const rawAfter = Math.max(0, hp - damage);
    const hpAfter = tgt.kind === 'pillar' ? rawAfter : this.clampHpFloor(tgt.slot, rawAfter);
    // 实际会掉的血（有剧本保护时会小于 `damage`）；只作参考字段，**不参与结算**（见下面那段说明）。
    const dealt = Math.max(0, hp - hpAfter);
    const lethal = hpAfter === 0;
    const heal = skill === 'drain' && tgt.kind !== 'pillar' ? this.healAmount(u.slot, damage) : 0;
    // 被扬沙迷眼的普攻有几率打空：把这个概率带给界面，好在预览里提示玩家
    const miss = !skill && this.s.sandBlind?.[u.slot] ? SKILLS.sandblast.miss : 0;
    // 击碎宝石柱没有反噬：柱子只负责挡路与加成，打碎它不会让花京院方掉血，也不会因此获胜
    // ★★ 剧本保护（`scene.hpFloor`）只改 `hpAfter` / `lethal` / `wins`（"这一下打不死他"要在
    //   预览里就体现出来，否则界面会亮出一个永远打不出来的"可终结"标记、AI 也按假数字算分）。
    // ⚠️⚠️ `damage` 仍然是**按攻击力算出来的那个数**，**不改**：它是 `attack()` 真正传下去的量、
    //   也是吸血（drain）回复量的依据——把它夹成"实际掉血"会在"目标残血"时连带改掉
    //   吸血回复等一串既有数值（那些与第八章毫无关系）。多余的量本来就由 `damage()` 里的
    //   `Math.min(血, 量)` 与这里那道血下限吃掉了，实际结算一字不变。
    return { attack, defense, damage, hp, hpAfter, lethal, heal, miss, dealt,
      wins: tgt.kind === 'pillar' ? false : lethal };
  }
  /** 这一下**实际**能回多少血（治疗点上限、灼烧减半都算在内）。
   *  ★★ 2026-10-04：**归零的角色不会被治疗回来**——"出局就是出局"（见 `removeFallenSlot`）。
   *  正常流程里根本走不到这一条：治疗都发生在活着的角色身上（自己的回合开始、自己踩到恢复点、
   *  自己放涅槃/吸血），而那些路径本来都先看过 `slotAlive`。它挡的是下面这条**窄路**：
   *  时停的额外回合（`endTurn()` 里那句 `enterTurn(previous)`）会给"刚在自己回合里被打倒的那一位"
   *  再结算一次**绿宝石柱每回合回血 / 水下呼吸**——不拦的话，一个共享生命 0、场上又已经没有棋子的
   *  角色会被拉回 1 点以上：他打不着、也打不死，这一局就再也收不了尾了。
   *  ⚠️ 判据放在**这里**（治疗量的唯一出口）而不是 `heal()` 里：`heal()` 自己会按 `actual` 决定
   *     要不要记账/报事件，于是"回 0"天然等于"什么都没发生"；界面与 AI 读的也是同一个数。 */
  healAmount(side, amount) {
    if (!this.slotAlive(side)) return 0;
    return Math.max(0, Math.min(this.fighter(side).hp - this.s.hp[side], this.s.burn[side] ? Math.ceil(amount / 2) : amount));
  }
  heal(side, amount, source, unit) {
    const actual = this.healAmount(side, amount);
    this.s.hp[side] += actual;
    this.s.stats[side].healed += actual;
    if (actual) this.emit('heal', { side, unit: unit?.id, tile: this.tile(unit), amount: actual, text: `${source} · ${slotName(side)} 恢复 ${actual} HP${this.s.burn[side] ? '（灼烧减疗）' : ''}` });
    return actual;
  }
  /**
   * 结算一次伤害。**只有单位**才有槽位：宝石柱／船体要害走上面那条分支。
   * `slot` 是"这一击算在谁的账上"（战绩统计），不传就退回 `side`（1v1 下两者相同）。
   */
  damage(tgt, amount, { side, slot = null, source = '攻击', terrain = false } = {}) {
    if (tgt.kind === 'pillar') {
      const loss = Math.min(tgt.hp, amount);
      tgt.hp = Math.max(0, tgt.hp - amount);
      this.emit('hit', { side, targetSide: tgt.side, unit: tgt.id, tile: this.tile(tgt), amount: loss, terrain,
        text: `${source} → ${tgt.part ? tgt.name : '宝石柱'} · −${loss} HP` });
      // 船体要害：拆结构比打人有效——伤害按 breakScale 倍计入船体耐久（＝boss 的共享生命）。
      // 这样"能建起来就能拆开"在数值上也成立，而不是只能拆着玩。
      if (tgt.part) {
        const rule = this.shipRule();
        const extra = rule ? Math.round(loss * (rule.breakScale - 1)) : 0;
        if (extra > 0) {
          const owner = tgt.side;
          this.s.hp[owner] = Math.max(0, this.s.hp[owner] - extra);
          if (side && side !== owner) this.s.stats[slot || side].damage += extra;
          this.emit('hit', { side, targetSide: owner, unit: tgt.id, tile: this.tile(tgt), amount: extra, terrain: true,
            text: `拆开${tgt.name} → 船体耐久 · −${extra} HP` });
          // 这一条走的**不是**"单位被打"那条路，所以"血量归零 ⇒ 场上没有他的棋子"要在这里自己补一次
          // （见 `removeFallenSlot`）。今天是个**空操作**：第五章的猩猩是"要害全拆完才登场、登场即满血"
          // （`spawnShipBoss` 那句 `s.hp.p2 = f.hp`），所以这截耐久扣不出一个"在场却归零"的槽位。
          if (this.s.slots.includes(owner)) this.removeFallenSlot(owner);
        }
      }
      if (tgt.hp === 0) {
        this.s.pillars = this.s.pillars.filter(p => p !== tgt);
        if (tgt.part) this.onPartBroken(tgt);
      }
      return loss;
    }
    // ★★ 剧本保护（`scene.hpFloor`，用户 2026-10-03 第四条）：第八章阶段 1 里霍尔·霍斯
    //   **不会被玩家杀死**——血最低停在 1（不然会出现"把他打死了却还要演阿布德尔替他挡枪"的矛盾）。
    //   ⚠️ `loss` 改成"掉血前后**真实的差**"：没有剧本保护时它与原来那句
    //      `Math.min(hp, amount)` **逐值相同**（`before - max(0, before - amount) === min(before, amount)`），
    //      有保护时战绩统计与日志里报的才是真的掉血量（不会出现"报 −9、血条只掉了 3"）。
    const before = this.s.hp[tgt.slot];
    this.s.hp[tgt.slot] = this.clampHpFloor(tgt.slot, Math.max(0, before - amount));
    const loss = before - this.s.hp[tgt.slot];
    if (side && side !== tgt.side) this.s.stats[slot || side].damage += loss;
    this.emit('hit', { side, targetSide: tgt.side, unit: tgt.id, tile: this.tile(tgt), amount: loss, terrain,
      text: `${source} → ${tgt.name} · −${loss} HP` });
    // ★ 玩家半血的台词：共享生命首次 ≤ 一半时播（与"觉醒"同一时机，但各自独立播一次）
    //   2v2 里**每个角色**各自算一次（剧情的半血觉醒只发生在 1v1 的 p1，口径不变）。
    if (teamOf(tgt.slot) === 'p1' && this.s.hp[tgt.slot] * 2 <= this.fighter(tgt.slot).hp) this.bark('half');
    // ★ 「黑檀之魔」那一关：**打中对方就是在喂它**——憎恨 +1（攻击力跟着涨，到阈值它就躲起来）。
    //   用户 2026-09-27 决定：**打本体（德沃）也算**，所以这里按"是不是 p2 的单位"判定，
    //   不能只写 `tgt.kind === 'stand'`（那样玩家一路打本体就能完全绕开憎恨机制）。
    if (this.ebonyRule() && (tgt.kind === 'user' || tgt.kind === 'stand') && tgt.side === 'p2' && side === 'p1') this.addHatred();
    // 剧情模式：被打到半血以下就觉醒（放在伤害落定之后，保证觉醒当回合的攻击就已经吃上加成）
    this.checkStoryRage(tgt.slot);
    // ★ 第七章：伪装形态被打到半血以下 → **立刻现出本体**（并把血量重置为满血）。
    //   ⚠️ 必须在这里（`damage()` 内部、调用方的 `checkEnd()` 之前）：
    //      否则一发把伪装形态打到 0 血时，这一局会直接结束，玩家根本看不到本体。
    this.unmaskIfNeeded(tgt.side);
    // ★ 「打到半血即胜」：打到半血 → **触发演出、夹血到 1**，然后由调用方的 `checkEnd()` 判玩家胜。
    //   同样必须在 `damage()` 内部：这样"这一击直接把他打到 0"也走同一条演出，
    //   不会变成"他被正常打死"那种结果文案。
    //   ⚠️ 2026-10-03 之后**没有任何一幕**声明 phaseWin 了（第八章阶段 1 改回正常胜负），
    //      所以这里通常是个空操作；机制代码保留，等以后有别的幕要用。
    this.phaseWinIfNeeded(tgt);
    // ★★ 被打倒 → **棋子离场、让出格子**（2026-10-04 用户要求，见 `removeFallenSlot`）。
    //   ⚠️ 必须排在上面那两道**会把血改回去**的判定**之后**（`unmaskIfNeeded` 重置满血、
    //      `phaseWinIfNeeded` 夹血到 1）——只有它们都放行，"血量归零"才算真的倒下。
    //      `removeFallenSlot` 自己会再判一次 `slotAlive`，所以顺序写反也拦得住，但别靠它兜。
    //   ⚠️ 又必须排在 `storyLossIfNeeded` **之前**（见下）：万一这一击同时触发剧情演出，提示里
    //      留着的该是剧情那一条——`removeFallenSlot` 自己那条 notice 被它顶掉正是我们要的顺序。
    this.removeFallenSlot(tgt.slot);
    // ★★ **必败剧情战**（章节数据 `scene.storyLoss`，用户 2026-10-03 第四条）：
    //   第八章阶段 1 里**波鲁纳雷夫掉到半血以下**就是这一场的终点——触发演出 → `checkEnd()`
    //   判**玩家战败**。放在这里（`damage()` 内部、调用方的 `checkEnd()` 之前）的理由与上面那条相同：
    //   "这一击直接把他打到 0"的极端情况也得走同一条演出，而不是变成"玩家被打光了"那种普通结算。
    //   ⚠️ 排在 `bark('half')` 与 `phaseWinIfNeeded` 之后：半血那句台词先播，紧接着才是横幅。
    this.storyLossIfNeeded();
    return loss;
  }
  addBurn(slot) {
    if (this.s.burn[slot] >= RULE.burnMax) return;
    this.s.burn[slot]++;
    this.emit('status', { side: slot, text: `${slotName(slot)} 灼烧 ${this.s.burn[slot]}/${RULE.burnMax} 层 · 治疗减半` });
  }
  applyTerrain(u) {
    const t = this.tile(u), key = tileKey(t), type = this.s.terrain[key];
    if (type === 'heal') {
      if (this.heal(u.slot, RULE.healAmt, '恢复点', u)) delete this.s.terrain[key];
    } else if (type === 'hazard') this.damage(u, RULE.hazardDmg, { source: '毒沼', terrain: true });
    else if (type === 'bush') {
      this.s.bushTimer[key] = 2;
      this.emit('status', { side: u.side, text: `${u.name}进入草丛 · +${RULE.bushDefBonus} 防御，下一对手回合结束后消失` });
    }
  }

  /** 残血判定：任意一方的共享生命降到上限的一半——背景音乐切危急曲用它。
   *  ⚠️ 口径必须与全局「半血」一致：**包含正好一半**（写成 `hp * 2 <= 上限`）。
   *     原来 main.js 里写的是严格 `< 0.5`，于是血量正好等于一半（例如 20/40）时不播危急曲——
   *     从残血被治疗回到"正好半血"时，音乐会被切回主界面曲，玩家看到的现象就是
   *     "我明明还在半血，音乐却没了；再次回到半血也不播"。 */
  lowHealth() {
    const s = this.s;
    // 2v2 时**每一个角色**都算：任意一个角色的血量跌到一半就切危急曲。
    // ⚠️ 已经倒下的角色（血量 0）不算"残血"——否则一方倒下之后危急曲会一直响到终局。
    //    1v1 时血量归零就已经结算了（phase !== 'battle'），所以这一条不影响旧口径。
    return s.phase === 'battle' && s.slots.some(slot => {
      const fighter = this.s.fighters[slot];
      return fighter && s.hp[slot] > 0 && s.hp[slot] * 2 <= fighter.hp;
    });
  }
  timeAvailable(side) {
    if (!this.skills(side).includes('time') || this.s.timeUsed[side]) return false;
    // DIO（timeRule 'hp'）用「是否解锁过」判断，不是实时查当前血量——
    // 详见 checkTimeWindow 里的说明。
    return this.fighter(side).timeRule === 'hp' ? this.s.timeUnlocked[side] : this.s.timeReady[side];
  }
  /** 现在这一回合是不是「时停给的额外回合」（对手那个回合被跳过之后、还给施放方的那个回合）。
   *  ★ 2026-09-30 用户为 DIO 的「飞刀」定的规则：**只在这一个回合里免冷却**（伤害不变）。
   *  ⚠️ 不要拿 `skipSide` 当条件：它只覆盖"按下时停的那一个回合"，被跳过的对手回合一到就被清掉了。 */
  timeExtraTurn(side) { return this.s.timeExtra?.[side] === true; }
  /** 这个单位"自身的攻击力"，用于「飞刀」这类"伤害＝自身攻击力"的技能。
   *  ⚠️ 本体（DIO 本人）没有自己的 `dmg`（他不能普攻），所以要退回**该方替身的攻击力**——
   *     用户 2026-09-30 选的规则是"本体与替身都能扔"，两边打出来的伤害必须一样。 */
  strikePower(u) { return u.dmg || this.fighter(u.slot).stand?.dmg || 0; }
  checkTimeWindow() {
    const s = this.s, side = s.turn;
    // 技能表里没有「时停」就不要开窗口——剧情模式把时停删掉了，
    // 只按角色的 timeRule 判断会弹出根本不存在的「时停窗口开启」提示。
    if (s.phase !== 'battle' || !this.skills(side).includes('time')) return;
    const rule = this.fighter(side)?.timeRule;
    if (rule === 'hp') {
      // DIO：血量掉到 ≤50% 就**永久解锁**（技能说明写的是"不限回合、可一直留到后面的回合再放"）。
      // ⚠️ 这里必须是「解锁锁存」，不能每次实时比较血量：DIO 的整套打法就是吸血回血，
      //    一旦回到半血以上，实时判定会让时停按钮又变灰，凭空多出一个"窗口期"。
      if (s.hp[side] > 0 && s.hp[side] <= this.fighter(side).hp / 2 && !s.timeUnlocked[side]) {
        s.timeUnlocked[side] = true;
        this.emit('status', { side, text: `${side.toUpperCase()} 时停已解锁 · 本局内随时可发动` });
      }
      return;
    }
    if (rule !== 'window' || s.timeLocked[side] || s.timeUsed[side]) return;
    if (s.hp[side] <= this.fighter(side).hp / 2 && s.hp[side] > 0) {
      s.timeReady[side] = true; s.timeLocked[side] = true;
      this.emit('status', { side, text: `${side.toUpperCase()} 时停窗口开启 · 本回合内可用，错过即失效` });
    }
  }
  skillReason(u, key) {
    const actor = this.actorReason(u), sk = SKILLS[key], s = this.s;
    if (actor) return actor;
    if (!sk || !this.skills(u.slot).includes(key)) return '该技能不属于当前角色。';
    if (sk.passive) return '被动技能自动触发。';
    if (sk.by !== 'any' && sk.by !== u.kind) return sk.by === 'stand' ? '需要替身释放' : '需要使者释放';
    if (key === 'time') {
      if (s.timeUsed[u.slot]) return '本局已使用';
      if (s.timeLocked[u.slot] && !s.timeReady[u.slot] && this.fighter(u.slot).timeRule === 'window') return '时停窗口已错过';
      if (!this.timeAvailable(u.slot)) return '共享 HP ≤ 50% 时解锁';
    }
    if (key === 'blaze' && s.blazeUsed[u.slot]) return '本局已使用';
    if (key === 'blade' && !this.bladeTargets(u).length) return '直线范围内没有可命中的敌人';
    if ((s.cd[u.slot][key] || 0) > 0 && !(key === 'knife' && this.timeExtraTurn(u.slot))) {
      // ★ 例外：DIO 的「飞刀」在**时停给的额外回合**里不占冷却（用户 2026-09-30 定的），
      //   所以那一回合里可以按 AP 连扔（3~4 把），这就是"时停里撒飞刀"的手感。
      return `冷却 ${s.cd[u.slot][key]} 个己方回合`;
    }
    if (s.ap[u.slot] < sk.cost) return `行动点不足 · 需要 ${sk.cost} AP`;
    if (key === 'emerald' && this.pillarsOf(u.slot).length >= SKILLS.emerald.cap) return '宝石柱已达 3 根上限';
    if (key === 'blaze' && !s.fire.length) return '场上没有火焰';
    // ★ 「皇帝」：射程内一个可锁定的敌人都没有时，不要给出一个"点了才报错"的假可选
    //   （界面高亮、AI 选招读的都是这里，照 `blade` 那条的写法）。
    if (key === 'emperor' && !this.targets(u, SKILLS.emperor.range)
      .some(t => t.kind !== 'pillar' && this.slotAlive(t.slot))) return '射程内没有可锁定的敌人';
    // ★★「暗枪」：射程内一个能标的格子都没有时（理论上只会在棋盘被塞满时发生），
    //   同样不要给出一个"点了才报错"的假可选。⚠️ 它**不要求**射程内有敌人——
    //   暗枪标的是格子，空地上也能提前埋（AI 那边另有"没有敌人就不埋"的取舍，见 ai.js）。
    if (key === 'darkgun' && !this.darkgunTiles(u).length) return '射程内没有可标记的格子';
    return '';
  }
  skillStatus(side, key, u = null) {
    const sk = SKILLS[key], s = this.s;
    // `side` 在界面里一直是"当前行动的槽位"（1v1 时就是 p1 / p2）。
    const team = teamOf(side);
    const owner = u || s.units.find(x => x.slot === side && x.kind === (sk.by === 'user' ? 'user' : 'stand'));
    if (sk.passive) {
      // ⚠️ 这一支原来第一项是 `key === 'vamp'`：2026-09-30 用户要求把「吸血鬼」并进时停的说明之后，
      //    它不再是任何角色的技能按钮（skillStatus 只会被"己方技能列表里的键"调用），所以删掉了，
      //    强化进度改由**时停那一格**显示（见下面 `key === 'time'` 的 status）。
      const status = key === 'trauma' ? (s.traumaUsed[side] ? '本局已触发' : '首次攻击替身时触发')
          : key === 'mastery' ? (s.swordBuff[side] ? `攻击力 +${s.swordBuff[side]}/${RULE.masteryMax}` : s.armorOff[side] ? '卸甲期间攻击即可叠加' : '先卸甲才能叠加')
            : key === 'nextline' ? (s.extraAP[side] ? '已预判 · 下回合 +1 AP' : '等对手重复同一个动作')
            : key === 'disguise' ? (s.disguiseUsed[side] ? '本回合的减伤已经用掉' : `本回合第一次被攻击 −${sk.cut}`)
            : key === 'aquatic' ? `每个己方回合开始恢复 ${sk.regen} HP`
            : key === 'erosion' ? (this.teamSlots(otherSide(team)).some(slot => s.eroded[slot])
                ? `对方已被侵蚀 · 每次自己普攻 −${sk.erosionDmg} HP`
                : `攻击命中即给对面挂上侵蚀（每次自己普攻 −${sk.erosionDmg} HP，持续整局）`)
            // 2v2 里"对面"是两个角色，这里报**叠得最多的那个**（1v1 时就是对面那一位，与改动前一致）
            : `敌方灼烧 ${Math.max(0, ...this.teamSlots(otherSide(team)).map(slot => s.burn[slot] || 0))}/${RULE.burnMax}`;
      return { enabled: false, passive: true, status, reason: '被动技能自动触发', cd: 0, cost: 0 };
    }
    const reason = this.skillReason(owner, key);
    const status = reason || (key === 'time' ? (s.vampCharged[side] ? '已强化 · 可发动（时停额外回合 +1 AP，且那一回合飞刀不占冷却）' : `可发动 · 本局一次（吸血累计回复 ${s.drainHeal[side]} / >10 可强化）`)
      // ★ 霍尔·霍斯的两个新技能（2026-10-03 用户拍板）：状态栏要能一眼看出"还剩几次 / 锁定了谁"。
      : key === 'aim' ? ((s.aimCharges[side] || 0) > 0
          ? `已瞄准 · 接下来 ${s.aimCharges[side]} 次攻击无视对手防御（草丛／岩石／宝石柱也不算）`
          : `接下来 ${sk.charges} 次攻击无视对手防御（用一次减一次）`)
      : key === 'emperor' ? `射程 ${sk.range} 格 · 锁定一个单位，一回合后结算 ${sk.dmg} 点伤害（计防御 · 躲不掉）${this.emperorMarks().length ? ` · 场上已有 ${this.emperorMarks().length} 处锁定` : ''}`
      // ★★「暗枪」：状态栏要能一眼看出"这一手标了几格 / 场上还剩几处没结算"。
      //   口径取自数据（`sk.dmg` / `sk.marks` / `sk.range`），界面里不手写数值。
      : key === 'darkgun' ? (() => {
          const marks = this.darkgunMarks();
          const mine = marks.filter(m => m.by === side).length;
          const target = `对手回合结束时踩在上面受 ${sk.dmg} 点伤害（计防御）`;
          if (mine) return `${sk.name}已标记 ${mine} 格 · ${target}${mine < sk.marks ? ` · 还能再标 ${sk.marks - mine} 格` : ''}`;
          if (marks.length) return `射程 ${sk.range} 格 · 一次标 ${sk.marks} 格，${target} · 场上已有 ${marks.length} 处标记`;
          return `不消耗行动点 · 在 ${sk.range} 格内连着点两个格子埋枪，${target}`;
        })()
      : key === 'knife' ? `射程 ${sk.range} 格 · 伤害 = 自身攻击力${this.timeExtraTurn(side) ? ' · ⚡时停额外回合：不占冷却（伤害不变）' : ''}`
      : key === 'blaze' ? `清除 ${s.fire.length} 格 · 恢复 ${this.healAmount(side, s.fire.length * RULE.blazeHealPerTile)} HP`
        : key === 'slime' ? (s.slimeGuard[side]
            ? `基础防御 +${sk.guard} 生效中（到下个己方回合开始）`
            : `裹紧身体 · 基础防御 +${sk.guard}，持续到你的下个回合开始`)
        : key === 'emerald' ? `宝石柱 ${this.pillarsOf(side).length}/${sk.cap} · 有柱子每回合回 ${RULE.pillarRegen} HP · 射程 ${sk.range}`
          : key === 'armor' ? (s.armorOff[side]
              ? `当前已卸甲 · 穿回后共享防御恢复为 ${this.fighter(side).def}`
              : `当前装甲 · 卸甲后共享防御归零、每回合 +${RULE.armorAP} AP`)
            : key === 'blade' ? `直线射程 ${sk.range} 格 · 伤害 = 攻击力+${RULE.bladeBonus}`
              : key === 'vine' ? `射程 ${sk.range} 格 · 移动 −${RULE.vineMovePenalty}（对方可花 ${RULE.vineBreakAP} AP 挣脱）`
                : key === 'dive' ? (s.sandGuard[side]
                    ? `互换位置 · 基础防御 +${SKILLS.dive.guard} 生效中`
                    : `伊奇与愚者互换位置 · 换完基础防御 +${SKILLS.dive.guard}`)
                  : key === 'sandblast' ? `射程 ${sk.range} 格 · 真实伤害 ${sk.dmg} · 目标普攻 ${Math.round(sk.miss * 100)}% 打空（持续一回合）`
                    : key === 'claw' ? `贴身 ${sk.range} 格 · 攻击力 +${sk.bonus}（目标共享生命低于一半再 +${sk.execute}）`
                : key === 'needle' ? `射程 ${sk.range} 格 · 攻击力 +${sk.bonus}（目标不是满血再 +${sk.execute}）`
                : key === 'drag' ? `射程 ${sk.range} 格 · 挂【溺水】${sk.drownTurns} 回合（每回合结束 −${sk.drownDmg}，不减速）`
                : key === 'sucker' ? `贴身 ${sk.range} 格 · 攻击力 +${sk.bonus}（目标正在溺水再 +${sk.execute}）`
                : key === 'hamon' ? `真实伤害 ${SKILLS.hamon.base}（无视防御）· 被缠绕目标 +${SKILLS.hamon.bonus}`
              : key === 'flame' ? '连续铺设最多 3 格' : `射程 ${sk.range} 格 · 选择目标`);
    return { enabled: !reason, reason, status, passive: false, cd: s.cd[side][key] || 0, cost: sk.cost };
  }
  beginSkill(u, key) {
    const reason = this.skillReason(u, key), s = this.s;
    if (reason) return this.fail(reason);
    if (s.pendingSkill === 'flame' && s.flamePlaced.length) return this.fail('请先完成已开始的火焰铺设。');
    if (s.pendingSkill === 'darkgun' && s.darkPlaced.length) return this.fail(`请先埋好第二个${SKILLS.darkgun.name}位置（Esc 可以提前收手）。`);
    if (key === 'armor') {
      // 双形态切换：装甲 ⇄ 卸甲。SKILLS.armor.cd=2 即用户口径的「CD 1 回合」：
      // 切换后的下个自己回合不能再切，隔一个回合才能切回来（口径见 rules.js 顶部说明）
      const label = this.skillLabel(key, u.slot);   // 出手时的形态名（卸甲／装甲），要在切换之前取
      const takingOff = !s.armorOff[u.slot];
      s.armorOff[u.slot] = takingOff;
      s.cd[u.slot][key] = SKILLS.armor.cd;
      if (takingOff) s.ap[u.slot] += RULE.armorAP;   // 卸甲当回合立刻多 1 AP；穿回装甲不立刻扣，只从下个己方回合起恢复
      s.stats[u.slot].skills++;
      this.clearSelection();
      this.emit('skill', { side: u.side, unit: u.id, fighter: u.fighter, skill: key, label,
        cry: takingOff ? 'ARMOR OFF' : 'ARMOR ON',
        text: takingOff ? `${u.name} 卸下铠甲 · 共享防御归零，此后每回合 +${RULE.armorAP} AP`
          : `${u.name} 重新穿上铠甲 · 共享防御恢复为 ${this.fighter(u.slot).def}` });
      this.notice(takingOff
        ? `铠甲已卸下：共享防御归零，本回合及之后每个己方回合行动点 +${RULE.armorAP}。`
        : `铠甲已穿回：共享防御恢复为 ${this.fighter(u.slot).def}，额外行动点从下个己方回合起结束（精湛剑术的攻击力加成保留）。`);
      return true;
    }
    if (key === 'dive') {
      // 潜沙（伊奇）：本体与替身互换位置，换完获得一回合的基础防御 +1。
      // 防御的到期在 enterTurn：施放方下次轮到自己的时候清掉，所以整个对手回合都吃得到。
      const user = s.units.find(x => x.slot === u.slot && x.kind === 'user');
      const stand = s.units.find(x => x.slot === u.slot && x.kind === 'stand');
      if (!user || !stand) return this.fail('伊奇与愚者必须同时在场才能互换位置。');
      const userAt = { row: user.row, col: user.col };
      user.row = stand.row; user.col = stand.col;
      stand.row = userAt.row; stand.col = userAt.col;
      s.sandGuard[u.slot] = true;
      s.ap[u.slot] -= SKILLS.dive.cost;
      s.cd[u.slot][key] = SKILLS.dive.cd;
      s.stats[u.slot].skills++;
      this.clearSelection();
      this.emit('skill', { side: u.side, unit: u.id, fighter: u.fighter, skill: key, label: SKILLS.dive.name, cry: 'SAND SWAP',
        text: `${user.name} 与 ${stand.name} 互换位置 · 基础防御 +${SKILLS.dive.guard}（持续到下个己方回合开始）` });
      this.notice(`潜沙：伊奇与愚者已互换位置，基础防御 +${SKILLS.dive.guard} 持续到你的下个回合开始。`);
      this.touch();
      return true;
    }
    if (key === 'slime') {
      // 史莱姆防御（黄色节制）：黏液裹紧身体，基础防御 +2，持续到施放方下个回合开始。
      // 到期在 enterTurn 里（和潜沙同一处），所以整个对手回合都吃得到。
      s.slimeGuard[u.slot] = true;
      s.ap[u.slot] -= SKILLS.slime.cost;
      s.cd[u.slot][key] = SKILLS.slime.cd;
      s.stats[u.slot].skills++;
      this.clearSelection();
      this.emit('skill', { side: u.side, unit: u.id, fighter: u.fighter, skill: key, label: SKILLS.slime.name, cry: 'SLIME ARMOR',
        text: `${u.name} 用黏液裹紧身体 · 基础防御 +${SKILLS.slime.guard}（持续到下个己方回合开始）` });
      this.notice(`史莱姆防御：基础防御 +${SKILLS.slime.guard}，持续到下个己方回合开始。`);
      this.touch();
      return true;
    }
    if (key === 'blaze') {
      s.ap[u.slot] -= SKILLS.blaze.cost;
      s.blazeUsed[u.slot] = true;
      const count = s.fire.length;
      s.fire = [];
      const amount = this.heal(u.slot, count * RULE.blazeHealPerTile, '涅槃', u);
      s.stats[u.slot].skills++;
      this.clearSelection();
      this.emit('skill', { side: u.side, unit: u.id, fighter: u.fighter, skill: key, cry: 'NIRVANA', text: `涅槃 · 清除 ${count} 格火焰，恢复 ${amount} HP` });
      this.notice(`涅槃已结算，恢复 ${amount} HP。`);
      return true;
    }
    if (key === 'time') {
      s.timeUsed[u.slot] = true; s.timeReady[u.slot] = false;
      // ★ 时停跳过的是**对手的下一个出手回合**：按交错顺序取下一个还站着的槽位
      //   （1v1 时就是对面那一位，与改动前完全一致）。
      s.skipSide = this.nextSlot(u.slot);
      if (s.vampCharged[u.slot]) s.extraAP[u.slot] = true;
      s.stats[u.slot].skills++;
      this.clearSelection();
      this.emit('skill', { side: u.side, unit: u.id, fighter: u.fighter, skill: key, text: `${u.name} · 时间停止！对方下个回合将自动跳过` });
      this.notice(`时间停止已生效。结束回合后，将自动跳过 ${slotName(s.skipSide)} 的行动。`);
      return true;
    }
    if (key === 'aim') {
      // ★ 瞄准（霍尔·霍斯）：**立刻生效、不需要选目标**（照潜沙／史莱姆防御那两条的写法）。
      //   账本按**次数**记：`s.aimCharges[槽位]`，打出去一次攻击减一（见 spendAim）。
      //   ⚠️ 重复施放＝**重新计满** `SKILLS.aim.charges` 次（不叠加、也不累加），
      //     实战里 CD 1 回合本来也拦得住，这里只是把边界写清楚。
      s.aimCharges[u.slot] = SKILLS.aim.charges;
      s.ap[u.slot] -= SKILLS.aim.cost;
      s.cd[u.slot][key] = SKILLS.aim.cd;
      s.stats[u.slot].skills++;
      this.clearSelection();
      this.emit('skill', { side: u.side, unit: u.id, fighter: u.fighter, skill: key, label: SKILLS.aim.name, cry: 'AIM',
        text: `${u.name} 举枪瞄准 · 接下来 ${SKILLS.aim.charges} 次攻击无视对手防御` });
      this.notice(`${SKILLS.aim.name}：接下来 ${SKILLS.aim.charges} 次攻击无视对手的一切防御（用一次减一次）。`);
      this.touch();
      return true;
    }
    if (key === 'rebuild') {
      // ★★ 2026-10-09 用户要求改流程：**点技能 → 选目标 → 选选项**（原来是"先选模式、再选目标"）。
      //   所以这里只进入"选目标"状态：目标定下来之后，界面才会列出这个目标**可用的选项**
      //   （清状态 / 回滚 1~3 回合前，不可用的那几档置灰并写明理由），见 `rebuildOptions()` / `confirmRebuild()`。
      s.rebuildTarget = null;
      s.rebuildMode = null;
      s.selectedId = u.id;
      s.pendingSkill = key;
      s.action = 'skill';
      this.notice(`${SKILLS.rebuild.name}：先选 ${SKILLS.rebuild.range} 格内的目标（友军与敌人都能选），选定后再挑要用哪个效果。Esc 取消。`);
      this.touch();
      return true;
    }
    s.selectedId = u.id;
    s.pendingSkill = key;
    s.flamePlaced = [];
    s.darkPlaced = [];
    s.action = 'skill';
    this.notice(['emerald', 'flame'].includes(key) ? `${SKILLS[key].name}：选择带菱形标记的空格。首格落地才消耗 AP。`
      : key === 'vine' ? `${SKILLS.vine.name}：选择 ${SKILLS.vine.range} 格内的一名敌人，施加"移动 −${RULE.vineMovePenalty}"。Esc 取消。`
      : key === 'sandblast' ? `${SKILLS.sandblast.name}：选择 ${SKILLS.sandblast.range} 格内的一名敌人，造成 ${SKILLS.sandblast.dmg} 点真实伤害并令其普通攻击有 ${Math.round(SKILLS.sandblast.miss * 100)}% 概率打空。Esc 取消。`
      : key === 'drag' ? `${SKILLS.drag.name}：选择 ${SKILLS.drag.range} 格内的一名敌人，把它拖进水里（每回合结束受 ${SKILLS.drag.drownDmg} 点真实伤害，持续 ${SKILLS.drag.drownTurns} 回合）。Esc 取消。`
      // ★「皇帝」：说的是"锁一个单位（本体或替身都行）"，不是"打一下就完"——提示要写清延迟与计防御。
      : key === 'emperor' ? `${SKILLS.emperor.name}：选择 ${SKILLS.emperor.range} 格内的一个敌方单位（本体或替身都行，宝石柱不行）锁定它——一回合之后结算 ${SKILLS.emperor.dmg} 点伤害（按常规结算防御，躲不掉）。Esc 取消。`
      // ★★「暗枪」：点的是**格子**（连着点两个），不是"选一个单位"——提示要写清这一点，
      //    否则玩家会像用「皇帝」那样去找棋子点。花费是 0 AP，所以提示里不再提行动点。
      : key === 'darkgun' ? `${SKILLS.darkgun.name}：在 ${SKILLS.darkgun.range} 格内连着点两个格子埋枪（两格不能重复；被棋子占着的格子也能标）。不消耗行动点，对手回合结束时踩在标记格上的敌方单位各受 ${SKILLS.darkgun.dmg} 点伤害（按常规结算防御）。Esc 提前收手。`
      : key === 'blade' ? `${SKILLS[key].name}：只能命中同一直线上（最多 ${SKILLS[key].range} 格）的第一个敌人，岩石与宝石柱会挡下剑刃。Esc 取消。`
        : `${SKILLS[key].name}：选择 ${SKILLS[key].range} 格内的敌人或宝石柱。Esc 取消。`);
    return true;
  }

  /* ==================== 东方仗助 & 疯狂钻石（2026-10-09 用户设计） ==================== */

  /**
   * 「修复」削项带来的扣减：`stat` ∈ `'atk' | 'def' | 'move'`，没有就是 0。
   * ⚠️ 三个**唯一出口**（`unitAttack` / `baseDefense` / `moveRange`）都读它，
   *    所以棋子卡片、瞄准预览与实际结算的数字必然一致（这是本工程反复强调的口径）。
   */
  fixPenalty(slot, stat) {
    const down = this.s.fixDown?.[slot];
    return down && down.stat === stat ? SKILLS.fix.down : 0;
  }
  /**
   * 「修复」能治疗的**友军**目标（用户要求"普攻可以选择友方"）。
   * 口径：同队、**不是自己这个角色**（用户拍板"不能治自己"，贴原著）、还活着、在替身普攻射程内。
   * ⚠️ 判据是**数据**（技能表里有没有 `fix` ＋ 队伍与槽位比较），不按角色名硬编码。
   * ⚠️ 1v1 里没有同队的第二个角色，所以返回空数组——被动只剩"打敌人随机削一项"那一半。
   */
  fixTargets(u) {
    if (!u || !this.skills(u.slot).includes('fix')) return [];
    return this.s.units.filter(t => t.side === u.side && t.slot !== u.slot
      && this.slotAlive(t.slot) && hexDist(this.tile(u), this.tile(t)) <= (u.range || 0));
  }
  /** 「修复」的治疗量 ＝ 攻击力 − 2（用户定的口径）。攻击力读 `unitAttack`，所以道具与觉醒都算在内。 */
  fixHeal(u) { return Math.max(0, this.unitAttack(u) - SKILLS.fix.mendMinus); }
  /** 「修复」对友军使用是否可行（判据与普攻同款，只是目标换成了友军）。 */
  fixReason(u, tgt) {
    const reason = this.actorReason(u);
    if (reason) return reason;
    if (!u || !tgt) return '先选择要治疗的目标。';
    if (tgt.side !== u.side) return '「修复」用来治疗友军。';
    if (tgt.slot === u.slot) return '疯狂钻石治不了仗助自己。';
    if (!this.slotAlive(tgt.slot)) return '这个角色已经倒下了。';
    if (!u.range || !u.dmg) return '使者没有普通攻击，请选择替身。';
    if (this.s.ap[u.slot] < RULE.attackCost) return '行动点不足，请结束回合。';
    if (hexDist(this.tile(u), this.tile(tgt)) > u.range) return `目标超出射程 · 最远 ${u.range} 格`;
    return '';
  }
  /**
   * 普攻指向友军 ＝ **治疗**（用户要求的"普攻可以选择友方"）。
   * 花费与普攻相同（1 AP）；走 `heal()` 以继承既有治疗规则（不超过上限、灼烧时治疗减半）。
   * ⚠️ **不触发任何命中后效果**：灼烧／创伤／吸血／侵蚀／削项都只属于"打敌人"那一条路。
   */
  mend(u, tgt) {
    const reason = this.fixReason(u, tgt);
    if (reason) return this.fail(reason);
    const s = this.s, amount = this.fixHeal(u);
    s.ap[u.slot] -= RULE.attackCost;
    const actual = this.heal(tgt.slot, amount, SKILLS.fix.name, tgt);
    this.clearSelection();
    this.checkEnd();
    if (s.phase === 'battle') {
      this.notice(actual
        ? `${SKILLS.fix.name}：${tgt.name} 恢复 ${actual} HP（剩 ${s.ap[u.slot]} AP）。`
        : `${tgt.name} 的生命是满的，这一手只花掉了行动点。`);
    }
    return true;
  }
  /**
   * 「修复」的削项：**普通攻击**打中敌人时，随机把它的一项（攻击力／防御力／移速）−1。
   * 口径（用户定）：每个**自己的回合**只触发一次；"持续到下一个敌方回合结束"＝施放方下个自己回合开始时到期
   * （与伊奇潜沙／史莱姆防御同一套到期口径，见 `enterTurn`）。
   * 随机取引擎注入的 `this.random`（与扬沙打空同一个源），所以可复现、可测试、不给 AI 造成不确定性。
   */
  applyFixDown(u, tgt) {
    if (!u || !tgt || tgt.kind === 'pillar' || tgt.side === u.side) return null;
    if (!this.skills(u.slot).includes('fix') || this.s.fixUsed[u.slot]) return null;
    const stats = SKILLS.fix.stats;
    const stat = stats[Math.min(stats.length - 1, Math.floor(this.random() * stats.length))];
    const label = { atk: '攻击力', def: '防御力', move: '移速' }[stat] || '数值';
    this.s.fixDown[tgt.slot] = { by: u.slot, stat };
    this.s.fixUsed[u.slot] = true;
    this.emit('status', { side: tgt.side, unit: tgt.id, tile: this.tile(tgt),
      text: `${tgt.name} 的${label}被修复的力量削掉 ${SKILLS.fix.down} 点（持续到下一个敌方回合结束）` });
    return stat;
  }
  /**
   * 每个自己回合开始时留一份数值快照——「重组·回滚」就是拿它当"那时候的数值"。
   * ⚠️ **按角色槽位**记（共享生命、攻/防/移速都在一起），所以回滚是一整份一起补回来的。
   * ⚠️ 快照取的是**当前生效值**（`unitAttack` / `baseDefense` / `moveRange`），
   *    于是"这几回合里掉掉的东西"（削项、藤蔓、卸甲）在回滚时能自然补回来。
   * 只留最近 6 条（回滚最多看 3 个回合前）。
   */
  recordSnap(slot) {
    const units = this.s.units.filter(u => u.slot === slot);
    const stand = units.find(u => u.kind === 'stand') || units[0];
    if (!stand || !this.s.snap[slot]) return;
    const list = this.s.snap[slot];
    list.push({ round: this.s.turnNumber, hp: this.s.hp[slot],
      atk: this.unitAttack(stand), def: this.baseDefense(slot), move: this.moveRange(stand) });
    if (list.length > 6) list.splice(0, list.length - 6);
  }
  /** 现在能选哪几档回滚（1~`rewindMax` 个自己回合前）；历史还没那么长就不列出来。 */
  rewindDepths(slot) {
    const list = this.s.snap[slot] || [];
    const out = [];
    for (let depth = 1; depth <= SKILLS.rebuild.rewindMax; depth++) if (list.length - 1 - depth >= 0) out.push(depth);
    return out;
  }
  /** 「重组·回滚」能不能用（一局一次 ＋ 至少有一档历史 ＋ 2 AP）。返回 `''` 表示可用。 */
  rewindReason(u, slot = u?.slot) {
    const reason = this.actorReason(u);
    if (reason) return reason;
    if (!this.skills(u.slot).includes('rebuild')) return '该技能不属于当前角色。';
    if (this.s.rebuildUsed[u.slot]) return '本局已经回滚过一次了';
    if (this.s.ap[u.slot] < SKILLS.rebuild.rewindCost) return `行动点不足 · 回滚需要 ${SKILLS.rebuild.rewindCost} AP`;
    if (!this.rewindDepths(slot).length) return '还没有可回滚的记录（至少要打过一个自己的回合）';
    return '';
  }
  /** 目标身上有哪些减益（显示与清除共用这一处判据）。 */
  debuffsOn(slot) {
    const s = this.s, out = [];
    if (s.burn[slot]) out.push('灼烧');
    if (s.drown[slot]) out.push('溺水');
    if (s.eroded[slot]) out.push('侵蚀');
    if (s.sandBlind[slot]) out.push('沙迷眼');
    if (s.fixDown[slot]) out.push('被削弱的数值');
    if (s.units.some(u => u.slot === slot && this.vined(u))) out.push('藤蔓');
    return out;
  }
  /** 清掉某个槽位身上的一切减益，返回被清掉的名单（写日志／提示用）。 */
  clearDebuffs(slot) {
    const s = this.s, cleared = this.debuffsOn(slot);
    s.burn[slot] = 0; s.drown[slot] = 0; s.eroded[slot] = false;
    s.sandBlind[slot] = null; s.fixDown[slot] = null;
    for (const u of s.units) if (u.slot === slot) delete s.vine[u.id];
    return cleared;
  }
  /**
   * 「重组·回滚」：把目标角色补回 `depth` 个自己回合前的数值状态。
   * 口径（用户拍板）：**只升不降**（所以拿去打敌人也不会削它）、**不回位置**、**不复活**已倒下的人；
   * 血量走 `heal()` → 自动继承"不超过上限、灼烧减疗"；攻／防／移速的差额记进 `fixRestore`（本局永久）。
   * ⚠️ 一局一次：`s.rebuildUsed` 置位后 `rewindReason()` 就拦住第二次。
   */
  rewind(u, tgt, depth = 1) {
    if (!u || !tgt || tgt.kind === 'pillar') return this.fail('「重组」要选一个角色。');
    const reason = this.rewindReason(u, tgt.slot);
    if (reason) return this.fail(reason);
    // ★ 不复活（用户拍板的口径）：已经倒下的角色不能被重组回来。
    //   ⚠️ 必须显式挡在这里——`heal()` 只挡得住"血量回不上去"，挡不住攻/防/移速那几项照样补回来，
    //      于是会出现"一个已经倒下的角色数值被补满、却还是 0 血"的怪状态。
    if (!this.slotAlive(tgt.slot)) return this.fail('已经倒下的角色不能被重组回来。');
    const s = this.s, slot = tgt.slot, list = s.snap[slot] || [];
    const snap = list[list.length - 1 - depth];
    if (!snap) return this.fail('那个时候还没有留下记录，换一个档位。');
    const units = s.units.filter(x => x.slot === slot);
    const stand = units.find(x => x.kind === 'stand') || units[0];
    const now = { hp: s.hp[slot], atk: this.unitAttack(stand), def: this.baseDefense(slot), move: this.moveRange(stand) };
    // 先把"要补多少"全部算出来，**再决定要不要真动手**——
    // ⚠️ 什么都不用补（那个状态与现在一模一样）时**直接作废**：一局一次的名额不能被空放浪费掉，
    //    所以这一步必须在 `heal()` / `fixRestore` 之前判完（否则血已经回上去了才发现是空放）。
    const hpGain = Math.max(0, Math.min(snap.hp, this.fighter(slot).hp) - now.hp);
    const gains = [];
    for (const [stat, label] of [['atk', '攻击力'], ['def', '防御力'], ['move', '移速']]) {
      const gain = Math.max(0, snap[stat] - now[stat]);
      if (gain > 0) gains.push({ stat, label, gain });
    }
    if (!hpGain && !gains.length) {
      return this.fail('那个状态和现在一模一样，没有可补回的数值——回滚没有生效，名额也没用掉。');
    }
    // ① 生命：只往上补，且照既有治疗规则（不超过上限、灼烧减疗）
    const healed = hpGain ? this.heal(slot, hpGain, SKILLS.rebuild.name, tgt) : 0;
    // ② 攻／防／移速：只升不降（差额记进 fixRestore，本局永久生效）
    for (const g of gains) s.fixRestore[slot][g.stat] += g.gain;
    s.ap[u.slot] -= SKILLS.rebuild.rewindCost;
    s.cd[u.slot].rebuild = SKILLS.rebuild.cd;
    s.rebuildUsed[u.slot] = true;
    s.stats[u.slot].skills++;
    this.clearSelection();
    const parts = [healed ? `生命 +${healed}` : null, ...gains.map(g => `${g.label} +${g.gain}`)].filter(Boolean);
    this.emit('skill', { side: u.side, unit: u.id, fighter: u.fighter, skill: 'rebuild', label: `${SKILLS.rebuild.name}·回滚`,
      cry: 'CRAZY DIAMOND',
      text: `${u.name} 把 ${tgt.name} 重组回 ${depth} 个自己回合前的状态 · ${parts.join('、') || '这段时间没有可补回的数值'}` });
    this.notice(`${SKILLS.rebuild.name}·回滚：${tgt.name} 回到 ${depth} 个自己回合前（${parts.join('、') || '没有可补回的数值'}）。本局不能再回滚第二次。`);
    this.checkEnd();
    return true;
  }
  /**
   * 「重组」的主模式：清掉目标身上的一切减益；**对敌人额外扣一发普攻伤害**。
   * 口径（用户定）：1 AP、CD 1 回合（数据 `cd: 2`）、射程 2、**友军与敌人都能选**。
   * 用户原话「扣血对敌方生效」→ 友军只清不减血；敌人按**普通攻击**那套结算（计防御）。
   */
  rebuildMend(u, tgt) {
    const reason = this.actorReason(u);
    if (reason) return this.fail(reason);
    if (!u || !tgt) return this.fail('先选择目标。');
    if (tgt.kind === 'pillar') return this.fail('「重组」只能作用于角色。');
    if (!this.slotAlive(tgt.slot)) return this.fail('这个角色已经倒下了。');
    const sr = this.skillReason(u, 'rebuild');
    if (sr) return this.fail(sr);
    if (hexDist(this.tile(u), this.tile(tgt)) > SKILLS.rebuild.range) return this.fail(`目标超出射程 · 最远 ${SKILLS.rebuild.range} 格`);
    const s = this.s;
    s.ap[u.slot] -= SKILLS.rebuild.cost;
    s.cd[u.slot].rebuild = SKILLS.rebuild.cd;
    s.stats[u.slot].skills++;
    const cleared = this.clearDebuffs(tgt.slot);
    // 对敌人：额外一发普攻伤害（走 preview → damage，所以预览与实际结算天然一致）
    let dealt = 0;
    if (tgt.side !== u.side) {
      const pv = this.preview(u, tgt);
      dealt = pv ? pv.damage : 0;
      if (dealt) this.damage(tgt, dealt, { side: u.side, slot: u.slot, source: SKILLS.rebuild.name });
    }
    this.clearSelection();
    const text = `${SKILLS.rebuild.name} · ${tgt.name}${cleared.length ? ` 清除了 ${cleared.join('、')}` : ' 身上没有减益'}${dealt ? ` · 受到 ${dealt} 点伤害` : ''}`;
    this.emit('skill', { side: u.side, unit: u.id, fighter: u.fighter, skill: 'rebuild', label: SKILLS.rebuild.name, text });
    this.checkEnd();
    if (s.phase === 'battle') this.notice(`${text}（剩 ${s.ap[u.slot]} AP）。`);
    return true;
  }
  /** 「重组」的统一入口：按当前模式（`s.rebuildMode`）分派到回滚或清状态。 */
  rebuild(u, tgt, mode = this.s.rebuildMode) {
    const depth = typeof mode === 'number' && mode > 0 ? mode : null;
    return depth ? this.rewind(u, tgt, depth) : this.rebuildMend(u, tgt);
  }
  /**
   * 「重组」**第一步：能点哪些棋子**（射程内的角色——友军与敌人都算；宝石柱／船体要害不算）。
   * 界面的高亮（蓝环）与 `rebuildTargetReason()` 共用这一处判据。
   */
  rebuildTargets(u) {
    if (!u || !this.skills(u.slot).includes('rebuild')) return [];
    return this.s.units.filter(t => t.kind !== 'pillar' && this.slotAlive(t.slot)
      && hexDist(this.tile(u), this.tile(t)) <= SKILLS.rebuild.range);
  }
  /** 这个棋子能不能当「重组」的目标（第一步点它的合法性）。返回 `''` 表示可以。 */
  rebuildTargetReason(u, tgt) {
    const reason = this.actorReason(u);
    if (reason) return reason;
    if (!u || !tgt) return '先选择一个目标。';
    if (tgt.kind === 'pillar') return '「重组」只能作用于角色（宝石柱不行）。';
    if (!this.slotAlive(tgt.slot)) return '这个角色已经倒下了。';
    if (this.s.pendingSkill !== 'rebuild') return '先按「重组」。';
    if (hexDist(this.tile(u), this.tile(tgt)) > SKILLS.rebuild.range) return `目标超出射程 · 最远 ${SKILLS.rebuild.range} 格`;
    return '';
  }
  /**
   * ★★ 2026-10-09 用户要求的新流程第一步：**把目标记下来，先不执行**——
   * 目标定下来之后界面才会列出可用选项（`rebuildOptions()`），第二步由 `confirmRebuild()` 真正动手。
   */
  pickRebuildTarget(u, tgt) {
    const reason = this.rebuildTargetReason(u, tgt);
    if (reason) return this.fail(reason);
    this.s.rebuildTarget = tgt.id;
    this.notice(`${SKILLS.rebuild.name}：目标 ${tgt.name} 已选定 —— 现在挑要用哪个效果，或点「换个目标」重选。`);
    this.touch();
    return true;
  }
  /**
   * 这个目标**当前可用的选项**（界面按钮、提示文字、AI 读的都是这一份）。
   * 每一项：`{ mode, label, cost, ok, reason, detail }`——
   * `mode: 'mend'`＝清状态（1 AP、CD 1 回合）；`mode: 1|2|3`＝回滚到 N 个自己回合前（2 AP、一局一次）。
   * ⚠️ 回滚的"有没有那么早的记录"按**目标自己的槽位**算（换个目标可能就只有 1 档可选）。
   */
  rebuildOptions(u, tgt) {
    if (!u || !tgt) return [];
    const out = [];
    const mendReason = this.skillReason(u, 'rebuild');
    const pv = tgt.side !== u.side ? this.preview(u, tgt) : null;
    out.push({ mode: 'mend', label: `${SKILLS.rebuild.name}·清状态`, cost: SKILLS.rebuild.cost,
      ok: !mendReason, reason: mendReason,
      detail: tgt.side === u.side ? '清除它身上的一切减益（友军不掉血）'
        : `清除它的减益，并造成 ${pv ? pv.damage : 0} 点伤害（计防御）` });
    for (let depth = 1; depth <= SKILLS.rebuild.rewindMax; depth++) {
      const has = (this.s.snap[tgt.slot] || []).length - 1 - depth >= 0;
      const reason = !has ? '那个时候还没有留下记录' : this.rewindReason(u, tgt.slot);
      out.push({ mode: depth, label: `回滚 ${depth} 回合前`, cost: SKILLS.rebuild.rewindCost,
        ok: !reason, reason, detail: '把生命与攻／防／移速补回那时（只升不降、不回位置）' });
    }
    return out;
  }
  /** ★★ 新流程第二步：按选定的选项真正执行（目标取自第一步存下的 `s.rebuildTarget`）。 */
  confirmRebuild(u, mode) {
    const tgt = this.s.rebuildTarget ? this.unit(this.s.rebuildTarget) : null;
    if (!tgt) return this.fail('先选一个目标，再选效果。');
    const opt = this.rebuildOptions(u, tgt).find(o => String(o.mode) === String(mode));
    if (!opt) return this.fail('没有这个选项。');
    if (!opt.ok) return this.fail(opt.reason);
    const done = this.rebuild(u, tgt, mode);
    if (done) this.s.rebuildTarget = null;
    return done;
  }

  attackReason(u, tgt, skill = null) {
    const reason = this.actorReason(u);
    if (reason) return reason;
    if (!tgt || ![...this.s.units, ...this.s.pillars].includes(tgt)) return '目标已经离开战场。';
    if (u.side === tgt.side) return '不能攻击己方单位。';
    // 2v2：已经倒下的角色不能再被打（2026-10-04 起他的棋子已经**离场**了，见 `removeFallenSlot`；
    // 这一条兜住"血量被别处改成 0、棋子还在"的非正常路径）
    if (tgt.kind !== 'pillar' && !this.slotAlive(tgt.slot)) return '这个角色已经倒下了，不能作为目标。';
    // 「力量」那一关：船体要害没拆完之前，本体被钢壁护着打不到。
    // ⚠️ 判定必须放在 attackReason 里（而不是 attack 里）：界面高亮、AI 选招都读它，
    //    只拦 attack() 会出现"能选中、点了才报错"的假可选。
    if (this.shipGuarded(tgt)) {
      return `他被钢壁护着 · 先拆掉剩下的 ${this.shipParts(tgt.side).length} 个船体要害`;
    }
    // ★ 用户 2026-09-27 要求：「改为可以攻击本体，删除不能攻击他的机制」。
    //   原来这里有一条"德沃躲在暗处操纵人偶 · 打不到他"的拦截，现在**删掉了**：
    //   德沃是场上的普通可攻击目标（而且没有替身那 +2 防御，打他更疼）。
    //   平衡的代价由憎恨值承担——**打中本体同样憎恨 +1**（见 damage 里的判定），
    //   所以"集火本体绕过机制"这条捷径依然要把人偶喂强，只是多了一种打法。
    // ⚠️ 同一天用户还要求「把躲在暗处这个机制删了」：原来人偶憎恨到阈值会"躲进暗处、打不到"，
    //   那条判定（连同 game.ebonyHidden）已经整块删除——现在**场上所有敌人都能打**。
    if (skill) {
      if (!['ora', 'star', 'drain', 'splash', 'blade', 'hamon', 'claw', 'needle', 'sucker', 'knife', 'heavy'].includes(skill)) return '这个技能不能用于攻击。';
      const sr = this.skillReason(u, skill);
      if (sr) return sr;
    } else {
      if (!u.range || !u.dmg) return '使者没有普通攻击，请选择替身。';
      if (this.s.ap[u.slot] < RULE.attackCost) return '行动点不足，请结束回合。';
    }
    const range = skill ? SKILLS[skill].range : u.range;
    if (hexDist(this.tile(u), this.tile(tgt)) > range) return `目标超出射程 · 最远 ${range} 格`;
    if (skill === 'blade') {
      if (tgt.kind === 'pillar') return '宝石柱会挡下剑刃，无法作为目标';
      if (!this.bladeLineIsClear(u, tgt)) return '目标不在剑刃直线上，或被岩石/宝石柱挡住';
    }
    // 波纹疾走只能打单位（宝石柱没有防御，但也不该被波纹「绕过」）
    if (skill === 'hamon' && tgt.kind === 'pillar') return '波纹只能作用于单位，不能打宝石柱';
    // 沙之爪可以打宝石柱（用户 2026-09-12 要求）：柱子的「半血 +2」不适用，只吃 +3 基础加成
    return '';
  }
  attack(u, tgt, skill = null) {
    const reason = this.attackReason(u, tgt, skill);
    if (reason) return this.fail(reason);
    const s = this.s, pv = this.preview(u, tgt, skill);
    s.ap[u.slot] -= skill ? SKILLS[skill].cost : RULE.attackCost;
    if (skill) {
      s.cd[u.slot][skill] = SKILLS[skill].cd || 0;
      s.stats[u.slot].skills++;
      this.emit('skill', { side: u.side, unit: u.id, fighter: u.fighter, skill });
    }
    // 扬沙：被沙迷眼的一方，普通攻击有几率打空（技能不受影响）。
    // 打空同样算一次行动——AP 与冷却照扣，但不结算伤害与任何命中后效果。
    if (!skill && s.sandBlind[u.slot] && this.random() < SKILLS.sandblast.miss) {
      this.noteAction(u, 'attack', tgt.id);
      this.emit('status', { side: u.side, unit: u.id, targetSide: tgt.side, tile: this.tile(u),
        text: `${u.name} 的普通攻击被扬沙打空` });
      this.notice(`${u.name} 被沙迷眼，这一击打空了。`, 'warn');
      // ⚠️ 打空**也算一次普通攻击**：侵蚀的代价照样要付，而且要自己补判胜负（这条分支原本直接 return）
      this.payErosionCost(u, skill);
      this.checkEnd();
      return true;
    }
    this.damage(tgt, pv.damage, { side: u.side, slot: u.slot, source: skill ? SKILLS[skill].name : `${u.name} 普攻`, pierce: skill === 'hamon' });
    // ★★ 「瞄准」（霍尔·霍斯）：**这一击真的打出去了**才算一次——所以消耗点放在 `damage()` 之后、
    //   上面那条"打空"的提前 return 之后（被扬沙迷眼打空不消耗次数）。
    this.spendAim(u);
    // 灰塔的「伪装」：这一击把它本回合的减伤用掉了（伤害已在 preview 里按"未使用"算过，
    // 所以这里只需置位，不能再减一次）。到灰塔自己回合开始时才重置。
    if (tgt.kind !== 'pillar' && this.skills(tgt.slot).includes('disguise')) s.disguiseUsed[tgt.slot] = true;
    // 「你的下一句话是」：记录这次行动（同一单位 + 同一目标 + 同一种行动 才会被预判）
    this.noteAction(u, skill || 'attack', tgt.id);
    if (skill === 'drain' && tgt.kind !== 'pillar') {
      const amount = this.heal(u.slot, pv.damage, '吸血', u);
      s.drainHeal[u.slot] += amount;
      if (s.drainHeal[u.slot] > 10 && !s.vampCharged[u.slot]) {
        s.vampCharged[u.slot] = true;
        this.emit('status', { side: u.side, text: '吸血鬼强化触发 · 时停后的己方回合额外 +1 AP' });
      }
    }
    if (tgt.kind !== 'pillar') {
      if (this.skills(u.slot).includes('trauma') && u.kind === 'stand' && tgt.kind === 'stand' && !s.traumaUsed[u.slot]) {
        s.traumaUsed[u.slot] = true; s.traumaCut[tgt.slot]++;
        this.emit('status', { side: tgt.side, text: `${tgt.name}受到创伤 · 替身防御永久 −1` });
      }
      if (this.skills(u.slot).includes('burn')) this.addBurn(tgt.slot);
      // ★ 东方仗助「修复」的削项：**普通攻击**命中敌人时随机削它一项（每自己回合一次）。
      //   ⚠️ 只认普攻（`!skill`）——重拳/重组这类技能不削项；打空那条分支早就 return 了，所以也不会触发。
      if (!skill) this.applyFixDown(u, tgt);
    }
    // 精湛剑术：卸甲后，替身每次攻击（含技能）自身攻击力 +1，最多 +3
    if (u.kind === 'stand' && s.armorOff[u.slot] && this.skills(u.slot).includes('mastery') && s.swordBuff[u.slot] < RULE.masteryMax) {
      s.swordBuff[u.slot]++;
      this.emit('status', { side: u.side, text: `精湛剑术 · 攻击力 +${s.swordBuff[u.slot]}/${RULE.masteryMax}` });
    }
    // ★ 侵蚀（黄色节制）：① 本体的攻击给对面那一方挂上【侵蚀】；② **出手方自己**要付侵蚀的代价。
    //   两件都放在 `checkEnd()` 之前——万一这一下把自己扣死，也得能正常结束这一局。
    this.applyErosion(u, tgt);
    this.payErosionCost(u, skill);
    this.clearSelection();
    this.checkEnd();
    this.checkTimeWindow();
    if (s.phase === 'battle') this.notice(`命中 ${tgt.name}，造成 ${pv.damage} 伤害。剩余 ${s.ap[u.slot]} AP。`);
    return true;
  }
  /**
   * ★ 「侵蚀」（黄色节制，第七章）：本体的**攻击**会给对方那一方挂上【侵蚀】。
   *   中了侵蚀的一方**每次自己出手普攻**就损失 2 点血，**一直持续到这一局结束**（不叠加）。
   *   ⚠️ 用户确认过的口径：是"**中招方自己普攻时扣自己的血**"，不是"被打中时多挨 2 点"；
   *      只对普通攻击生效（技能不算），宝石柱不算一方。
   */
  applyErosion(u, tgt) {
    if (!tgt || tgt.kind === 'pillar') return false;
    if (!this.skills(u.slot).includes('erosion') || this.s.eroded[tgt.slot]) return false;
    this.s.eroded[tgt.slot] = true;
    this.emit('status', { side: tgt.side,
      text: `中了【侵蚀】· 每次自己出手普攻会损失 ${SKILLS.erosion.erosionDmg} 点血（持续到这一局结束）` });
    return true;
  }
  /** 侵蚀的代价：出手方自己普攻要付那 2 点血。技能攻击不走这里（见 `attack()` 的 `!skill` 判定）。 */
  payErosionCost(u, skill) {
    if (skill || !this.s.eroded?.[u.slot]) return false;
    this.damage(u, SKILLS.erosion.erosionDmg, { source: '侵蚀' });
    if (this.s.phase === 'battle') {
      this.notice(`${u.name} 被【侵蚀】反噬，损失 ${SKILLS.erosion.erosionDmg} 点血。`, 'warn');
    }
    return true;
  }

  place(u, t) {
    const s = this.s, key = s.pendingSkill;
    if (!['emerald', 'flame'].includes(key)) return this.fail('请先选择放置技能。');
    const actor = this.actorReason(u);
    if (actor) return this.fail(actor);
    if (s.selectedId !== u.id) return this.fail('请使用当前正在铺设的替身。');
    const committed = key === 'flame' && s.flamePlaced.length > 0;
    const reason = committed ? '' : this.skillReason(u, key);
    if (reason) return this.fail(reason);
    if (!t || !this.placement(u, key).includes(t)) return this.fail(key === 'flame'
      ? '无法铺设：需射程内空格，并与上一格相邻。Esc 可完成当前铺设。'
      : '无法放置：请选择射程内没有岩石、单位或柱子的空格。');
    if (!committed) {
      s.ap[u.slot] -= SKILLS[key].cost;
      s.cd[u.slot][key] = SKILLS[key].cd;
      s.stats[u.slot].skills++;
      this.emit('skill', { side: u.side, unit: u.id, fighter: u.fighter, skill: key });
    }
    if (key === 'emerald') {
      // ⚠️ `slot` 是"这根柱子属于哪个角色"：宝石柱的加成与每回合回血都只给摆柱子的那个角色。
      s.pillars.push({ id: `pillar-${this.epoch}-${this.revision}`, kind: 'pillar', side: u.side, slot: u.slot,
        name: '绿宝石柱', row: t.row, col: t.col, hp: SKILLS.emerald.pillarHp, maxHp: SKILLS.emerald.pillarHp });
      this.clearSelection();
      this.emit('place', { side: u.side, tile: t, text: `绿宝石柱 → ${tileLabel(t)} · 替身伤害 +1，相邻己方防御 +1` });
      this.notice('宝石柱已生成：挡路、为紧贴的己方加防御，唯一缺点是会被打碎。');
    } else {
      s.fire.push({ side: u.side, row: t.row, col: t.col });
      s.flamePlaced.push(t);
      // ★ 第八章「反光点」：火焰落在一个反光点上＝**那个点永久失效**（用户定）。
      //   接在这条既有的铺火分支里（人机与真人走的是同一条路），不另写一套火焰逻辑。
      this.sealMirror(t, u.side);
      this.emit('place', { side: u.side, tile: t, text: `火焰道路 → ${tileLabel(t)} · ${s.flamePlaced.length}/${SKILLS.flame.max}` });
      if (s.flamePlaced.length >= SKILLS.flame.max || !this.placement(u, key).length) this.finishFlame();
      else this.notice(`已铺 ${s.flamePlaced.length}/${SKILLS.flame.max} 格。继续选择相邻格，或完成铺设；无需额外 AP。`);
    }
    return true;
  }
  finishFlame() {
    if (this.s.phase !== 'battle' || this.s.pendingSkill !== 'flame') return false;
    const count = this.s.flamePlaced.length;
    this.clearSelection();
    this.notice(count ? `已完成 ${count} 格铺设。已结算的火焰与行动点不会撤销。` : '已取消火焰道路，未消耗行动点。');
    return true;
  }

  /** 【溺水】的结算：**每个回合结束时都掉血**（用户 2026-09-26 选定 A 方案）。
   *  也就是不分敌我，每次调用掉一次——被拖下水之后，自己回合结束掉 2 点、对手回合结束再掉 2 点。
   *  真实伤害：不走防御，也不吃任何减免（走 damage() 直接给固定值即可）。 */
  tickDrown() {
    const s = this.s;
    // 溺水按**角色槽位**记账：2v2 时谁被拖下水谁掉血，同队另一个不受影响。
    for (const slot of s.slots) {
      if (!this.slotAlive(slot)) continue;      // 倒下的角色不再结算溺水（1v1 里走不到这一步）
      if (!this.drowning(slot)) continue;
      const u = s.units.find(x => x.slot === slot && x.kind === 'user') || s.units.find(x => x.slot === slot);
      s.drown[slot]--;
      this.damage(u, SKILLS.drag.drownDmg, { source: '回合结束 · 溺水', terrain: true });
      if (this.drowning(slot)) this.emit('status', { side: slot, text: `溺水 · 还能挣扎 ${s.drown[slot]} 个回合结束` });
      else this.emit('status', { side: slot, text: '终于浮出水面 · 溺水结束' });
    }
  }
  tickBurn(slot) {
    // 倒下的角色不再结算灼烧（2v2 里他可能在自己回合里被打倒；1v1 时血量归零就已经结算了）
    if (!this.slotAlive(slot) || !this.s.burn[slot]) return;
    const u = this.s.units.find(x => x.slot === slot && x.kind === 'user') || this.s.units.find(x => x.slot === slot);
    this.damage(u, this.s.burn[slot] * RULE.burnDmgPerStack, { source: '回合结束 · 灼烧', terrain: true });
  }
  /** 进入 `slot`（角色槽位）的回合。1v1 时槽位就是 p1 / p2，行为与改动前完全一致。 */
  enterTurn(slot) {
    const s = this.s;
    s.turn = slot;
    s.turnNumber++;
    // 「力量」那一关：船在自己的每个回合开始改变内部结构（舱门关上、走廊变宽），
    // 逼着玩家放弃固定阵型。放在这里是为了"变形 → 玩家回合"的顺序，玩家一上来就看到新地形。
    this.tickBulwarks();
    // 紧接着扣"待在船里的代价"（只针对玩家侧，见 drainShipToll）
    this.drainShipToll(teamOf(slot));
    // ★ 「黑檀之魔」那一关：玩家回合开始时结算憎恨——上一回合没打到它，它就冷静一点
    if (slot === 'p1') this.decayHatred();
    // ★ 「第 2 回合」的台词：玩家**自己的第 2 个回合**开始时（＝界面显示 ROUND 02 那一刻）
    if (slot === 'p1' && this.roundNumber() === 2) this.bark('turn2');
    // 伊奇的两种临时效果都在「施放方下次轮到自己」时到期，所以整个对手回合都吃得到：
    // 潜沙的防御 +1 消失；自己扬出去的沙也同时失效。
    // 灰塔的伪装同理：轮到自己时重置，于是「每个对手回合只生效一次」。
    if (this.s.disguiseUsed[slot]) this.s.disguiseUsed[slot] = false;
    if (s.sandGuard[slot]) { s.sandGuard[slot] = false; this.emit('status', { side: slot, text: '潜沙的防御加成已结束' }); }
    // 「史莱姆防御」同样是"施放方下次轮到自己"到期（整个对手回合都吃得到）
    if (s.slimeGuard[slot]) { s.slimeGuard[slot] = false; this.emit('status', { side: slot, text: '史莱姆防御已到期 · 防御加成结束' }); }
    for (const target of s.slots) {
      if (s.sandBlind[target] === slot) {
        s.sandBlind[target] = null;
        this.emit('status', { side: target, text: '眼里的沙已被揉掉 · 普通攻击恢复正常' });
      }
      // ★ 「修复」的削项同样是"施放方下次轮到自己"到期（用户定的"持续到下一个敌方回合结束"）。
      if (s.fixDown[target]?.by === slot) {
        const stat = SKILLS.fix.statNames?.[s.fixDown[target].stat] || '数值';
        s.fixDown[target] = null;
        this.emit('status', { side: target, text: `修复的效果已到期 · ${stat}恢复` });
      }
    }
    // 施放方**这一回合**的削项名额也在这里重置（"每个自己的回合只触发一次"）
    s.fixUsed[slot] = false;
    // ★★ 每个自己回合开始时留一份数值快照（「重组·回滚」要用它当"那时的数值"）。
    //   放在 AP/治疗那几段**之前**（快照反映的是"这一回合刚开头"的状态，与界面上的数字一致）。
    this.recordSnap(slot);
    s.ap[slot] = RULE.apPerTurn + (s.armorOff[slot] ? RULE.armorAP : 0) + (s.extraAP[slot] ? 1 : 0) + this.storyAP(slot)
      - this.shipPenalty(teamOf(slot)).ap;      // 拆要害的代价之二：行动点 −1（拆掉第 2 个时生效，全拆完恢复）
    s.turnAP[slot] = s.ap[slot];
    s.extraAP[slot] = false;
    for (const key of this.skills(slot)) s.cd[slot][key] = Math.max(0, (s.cd[slot][key] || 0) - 1);
    // 宝石柱的续航：己方回合开始时，只要场上有自己的柱子，就恢复 RULE.pillarRegen 点 HP。
    // **不随柱子数量叠加**：1 根和 3 根都只回这么多。
    // 走 heal() 是为了自动继承既有治疗规则：不超过血量上限、灼烧时治疗减半。
    // ⚠️ 按**槽位**取柱子：2v2 里只有摆柱子的那个角色回血，同队另一个角色不白拿。
    const pillars = this.pillarsOf(slot);
    if (pillars.length) this.heal(slot, RULE.pillarRegen, `绿宝石柱 ×${pillars.length}`, pillars[0]);
    // 水下呼吸（暗蓝之月被动）：每个己方回合开始恢复 SKILLS.aquatic.regen 点共享生命。走 heal() 以继承一切治疗规则。
    if (this.skills(slot).includes('aquatic')) {
      const stand = s.units.find(x => x.slot === slot && x.kind === 'stand');
      this.heal(slot, SKILLS.aquatic.regen, SKILLS.aquatic.name, stand);
    }
    for (const key of Object.keys(s.bushTimer)) {
      if (--s.bushTimer[key] <= 0) {
        delete s.terrain[key]; delete s.bushTimer[key];
        this.emit('status', { text: '草丛掩护到期，地块恢复为空地' });
      }
    }
    this.checkTimeWindow();
    // ★★ 道具：**每 `everyTurns` 个回合在空地补 1 个**（上限 `max`，满了就不再刷）。
    //   放在 `enterTurn()` 的最后：此刻 `turnNumber` 已经是新回合的号，所以"第 3、6、9…"各补一次。
    this.tickItems();
  }
  endTurn() {
    const s = this.s;
    if (s.phase !== 'battle') return false;
    const previous = s.turn;
    // 这一次 endTurn 结束的就是"时停额外回合"（如果这一回合正是它）——
    // 先清掉旗标；下面若又跳过了对手的回合，会再把它置位（见 skipSide 那段）。
    s.timeExtra[previous] = false;
    if (this.s.pendingSkill === 'flame') this.finishFlame();
    // ★ 暗枪：回合结束时把"这一手"收干净（已埋下的标记照旧留在场上等对手回合结束结算）。
    if (this.s.pendingSkill === 'darkgun') this.finishDarkgun();
    this.tickBurn(previous);
    this.tickDrown();
    // 「力量」那一关：回合结束时，还完好的船体要害会夹击 1 格内的敌方单位
    this.tickParts();
    // ★ 第八章「场边冷枪」：**只在一整轮真正走完的那一刻**结算（2v2 一轮 4 个回合，中途不算），
    //   插在这条既有链路的末尾、胜负判定之前——于是它打出的伤害照常走下面那次 `checkEnd()`。
    if (this.roundEnding()) this.tickSniper();
    // ★★ 霍尔·霍斯的「皇帝」同理：**一回合之后的轮末**才结算（判据、位置与冷枪完全一致），
    //   ⚠️ 它**不是**章节机制，任何拥有 `emperor` 技能的对局都要跑，所以**不挂在 sniperRule 上**。
    if (this.roundEnding()) this.tickEmperor();
    // ★★ 「暗枪」：**对手回合结束时**结算（用户原话），所以它不挂 `roundEnding()`——
    //   刚结束的那个回合只要不属于埋枪那一方，埋在地里的枪就落地（`tickDarkgun(previous)`）。
    //   位置与冷枪／皇帝完全一致（扣血系之后、`checkEnd()` 之前），所以它打出的伤害照常判胜负。
    this.tickDarkgun(previous);
    if (this.checkEnd()) return true;
    s.timeReady[previous] = false;
    this.clearSelection();
    // ★ 下一个出手的槽位：**交错顺序 + 跳过已经倒下的角色**（1v1 时就是 otherSide）。
    this.enterTurn(this.nextSlot(previous));
    // 进回合时可能有伤害（「力量」那一关的船体挤压），所以这里要再判一次胜负
    if (this.checkEnd()) return true;
    if (s.skipSide === s.turn) {
      const skipped = s.turn;
      s.skipSide = null;
      s.ap[skipped] = 0;
      this.emit('skip', { side: skipped, text: `${slotName(skipped)} 的行动已被时停跳过` });
      this.tickBurn(skipped);
      this.tickDrown();   // 被跳过的那个回合同样「结束了」，溺水照掉（口径见 tickDrown）
      // ⚠️ 暗枪同理：被时停跳过的那一个回合也**确实结束了**，所以埋在地里的枪照常落地
      //    （与上面 `tickBurn(skipped)`／`tickDrown()` 同一条口径）。
      this.tickDarkgun(skipped);
      if (this.checkEnd()) return true;
      s.timeReady[skipped] = false;
      // ★ 接下来这个回合就是"时停给的额外回合"（飞刀在这一回合里不占冷却，伤害不变）。
      //   2v2 里同样把回合**还给施放时停的那个角色**（与 1v1 的口径一致：跳过对手的下一个回合 → 自己再动一次）。
      s.timeExtra[previous] = true;
      this.enterTurn(previous);
      this.emit('status', { side: previous, text: '时停的额外回合 · 这一回合里「飞刀」不占冷却（伤害不变）' });
    }
    this.emit('turn', { side: s.turn, team: teamOf(s.turn), fighter: s.fighters[s.turn]?.key || null,
      text: `${slotName(s.turn)} 回合 · ${s.ap[s.turn]} AP` });
    this.notice(`${slotName(s.turn)} 行动。选择己方单位开始回合。`);
    return true;
  }
  /**
   * 胜负判定：**一队所有角色槽位的血都 ≤ 0** 才算输。
   * 1v1 时等价于原来那句"任意一方共享生命归零"——包括双方同时归零时保持原有的判定优先级
   * （仍然是先看 p1，所以 p2 获胜；这里没有引入平局分支）。
   *
   * ★★ 第八章「皇帝与吊死者」（第④步，用户拍板）：章节可以用数据声明一个**关键槽位**
   *    （`s.story.keySlot`）——那一队的胜负**只看这一个槽位**：
   *      · 这一章的关键槽位是 J·凯尔（`enemy` → `'p2'`），所以"打倒 J·凯尔就赢"；
   *      · 枪手霍尔·霍斯不参与胜负：**把他打倒不算赢**（他的槽位掉到 0 也不判负），
   *        反过来"没打他"更是毫无影响。
   *    ⚠️ 写法是通用的（槽位名来自章节数据，不按角色名硬编码）；没声明 keySlot 的章节
   *       一律沿用老口径，1v1／2v2／自由对局的判定一个字都没变。
   */
  checkEnd() {
    if (this.s.phase !== 'battle') return this.s.phase === 'result';
    // ★★ 「打到半血即胜」（章节数据 `scene.phaseWin`，写法通用、不按角色名硬编码）。
    //   ⚠️ 排在下面那套"谁血归零"之前：声明了这一条的场次本来就不是靠打空血条分胜负的，
    //      演出一触发就是**玩家胜**（`phaseWinIfNeeded` 已经把他的血夹到 1，所以不会误判成他也倒了）。
    //   ⚠️ 2026-10-03 第三条用户拍板之后**第八章阶段 1 不再声明它**（改回"把他的血打空才算赢"），
    //      于是这一章会直接落到下面那套普通口径上；**机制本身保留**（没有任何章节用也不影响别的局）。
    const phase = this.phaseWinRule();
    if (phase && this.s.phaseWin) {
      this.endGame('p1', phase.reason || '打到半血 · 这一场结束');
      return true;
    }
    // ★★ **必败剧情战**（章节数据 `scene.storyLoss`，用户 2026-10-03 第四条）。
    //   ⚠️ **必须排在下面那套"谁血归零"之前**：这一场判的是**玩家战败**，而它和"玩家被打光"
    //      可能在同一击里同时成立（一击从半血以上直接打到 0）——那种时候要给的仍然是
    //      "阿布德尔挡下了那一枪"这条剧情，不是一条"共享生命归零"的普通结算。
    //   ⚠️ 这里再补判一次（`damage()` 里已经判过）：既兜住"血是被别处改低的"这种情况，
    //      也让"直接摆一个半血局面再 checkEnd()"能照常收敛。
    //   ⚠️⚠️ 判据必须写成 `s.storyLoss || storyLossIfNeeded()`——**不能只看后者**：
    //      `damage()` 里已经把旗标置上了（横幅也播了），如果这里只认"这一次刚触发的"返回值，
    //      就会漏掉那一条、然后落到下面"谁血归零"上，结算理由变成一条普通的"共享生命归零"
    //      （HUD 上就成了一场普通败仗，而不是剧情）。
    if (this.storyLossRule() && (this.s.storyLoss || this.storyLossIfNeeded())) {
      this.endGame('p2', this.storyLossRule().reason || '剧情到此为止 · 这一场结束');
      return true;
    }
    const key = this.keySlot();
    // 这一队算不算"输光了"：声明了关键槽位的那一队只看它，其余照旧看全队。
    const wiped = team => (key && teamOf(key) === team
      ? this.s.hp[key] <= 0
      : this.teamSlots(team).every(slot => this.s.hp[slot] <= 0));
    const loser = ['p1', 'p2'].find(team => wiped(team));
    if (!loser) return false;
    this.endGame(otherSide(loser), '共享生命归零');
    return true;
  }
  /** 认输：`side` 可以是槽位（界面传的是当前行动的槽位）；一认输**整队**就结束这一局。 */
  resign(side = this.s.turn) {
    if (this.s.phase !== 'battle' || !this.s.slots.includes(side)) return false;
    this.endGame(otherSide(side), `${slotName(side)} 主动认输`, { resigned: true });
    return true;
  }
  endGame(winner, reason, { resigned = false } = {}) {
    if (this.s.phase !== 'battle') return false;
    this.clearSelection();
    this.s.phase = 'result';
    this.s.winner = winner;
    this.s.resultReason = reason;
    // ⚠️⚠️ **"击倒对手"那句台词必须在 `result` 事件之前播**（2026-09-27 用户报"结算出现得太早、看不清结束对话"）：
    //   界面收到 `result` 时会先看"台词还在不在播"，在播就把结算弹窗挂起来等台词播完；
    //   顺序反了（先 result 后 bark）的话，它会以为没台词、0.5 秒后就弹窗，而弹窗是顶层——
    //   台词条在棋盘里，一定被盖住，玩家只能看到它闪一下。**改这里之前先看 main.js 的 pendingResult。**
    if (winner === 'p1') this.bark('death');
    // ⚠️ `resigned` 是**给界面看的**旗标（2026-09-30 用户报"点击认输结算太慢"）：
    //   认输是玩家的主动操作，界面据此**跳过排队中的台词**、立刻弹结算；
    //   击倒对手（`checkEnd`）时它是 false，仍然要等"击倒对手"那句播完。
    //   别让界面去 `resultReason.includes('认输')` 猜——那是拿显示文案当逻辑用。
    this.emit('result', { side: winner, reason, resigned, text: `${winner.toUpperCase()} 获胜 · ${reason}` });
    // ★★ 必败剧情战（`s.storyLoss`）：这一场判的是玩家战败，但**不是让玩家重开**——剧情照常往下走。
    //   所以板子上那句提示也得跟着换（旧文案"可再战一局"会把人往"重打"上引，与设计正好相反）。
    this.notice(this.s.storyLoss
      ? '这一场到此为止 —— 点「继续」接着往下看。'
      : `${winner.toUpperCase()} 获胜。可再战一局或重新选人。`);
    return true;
  }
  actionView() {
    const u = this.selected, s = this.s, pending = s.pendingSkill;
    return {
      selected: u,
      reach: u && !pending && s.action !== 'attack' && s.ap[u.slot] >= RULE.moveCost ? this.reachable(u) : [],
      attackable: u ? this.targets(u, pending ? SKILLS[pending].range : u.range)
        // 藤蔓是「施加 debuff」而不是攻击：判定要用 vineReason，不能走 attackReason
        // （attackReason 的技能白名单里没有 vine，用它过滤会导致一个高亮圈都画不出来）。
        // 波纹只能打单位、打不到宝石柱，所以那一种瞄准要把柱子排除。
        .filter(t => pending === 'vine' ? (t.kind !== 'pillar' && !this.vineReason(u, t))
          : pending === 'sandblast' ? (t.kind !== 'pillar' && !this.sandblastReason(u, t))
          // 拖入水下同样是「施加 debuff」：走 dragReason 才能正确高亮可选目标
          : pending === 'drag' ? (t.kind !== 'pillar' && !this.dragReason(u, t))
          // ★「皇帝」是"锁定"而不是当场攻击：高亮要走 emperorReason（attackReason 的技能白名单里没有它）
          : pending === 'emperor' ? (t.kind !== 'pillar' && !this.emperorReason(u, t))
          : pending === 'hamon' ? (t.kind !== 'pillar' && !this.attackReason(u, t, pending))
            : !this.attackReason(u, t, pending)) : [],
      // ★★「暗枪」点的是**格子**（被棋子占着的格子也能标），所以它自己走一条清单；
      //    `placement()` 只认空格，拿它来高亮会把最该标的那些格子全滤掉。
      placeTiles: pending === 'darkgun' ? this.darkgunTiles(u)
        : ['flame', 'emerald'].includes(pending) ? this.placement(u) : [],
      range: u ? (pending ? SKILLS[pending].range || 0 : u.range) : 0,
      // ★ 东方仗助「修复」：普攻可以指向的**友军**（渲染层用绿色高亮区分于红色的敌人）。
      //   判据在 `fixTargets()` 里（同队、不是自己、活着、射程内），这里只是转出去给界面。
      fixable: u && !pending ? this.fixTargets(u) : [],
      // ★「重组」的两步流程（用户 2026-10-09 改的）：`targets`＝第一步能点的棋子（蓝环），
      //   选定之后 `options` 才是这个目标可用的效果（清状态 / 回滚 N 回合前，不可用的带 reason）。
      rebuild: pending === 'rebuild' ? (() => {
        const tgt = s.rebuildTarget ? this.unit(s.rebuildTarget) : null;
        return { target: tgt, targets: this.rebuildTargets(u), options: tgt ? this.rebuildOptions(u, tgt) : [] };
      })() : null,
      bladeTiles: u && pending === 'blade' ? BLADE_DIRS.flatMap(dir => this.bladePath(u, dir)) : [],
    };
  }
}
