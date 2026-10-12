import { hexDist, tileKey } from './hex.js';
import { RULE, SKILLS, otherSide, teamOf } from './game.js';

const nearest = (tile, targets) => Math.min(...targets.map(t => hexDist(tile, t)));

/**
 * ★★ 2026-10-03 用户要求③：带 `flees` 旗标的单位（全项目只有 J·凯尔**本体**）走位评分的两个常数。
 *   · `base`：这一趟撤退本身值多少。它要**刚好压过"随手打一下"**（本体攻 6 打常规 2 防 ≈ 16 分），
 *     又要**远低于**攻击计划里"当场就能打死"的那 1000 分——能收掉对手时照常出手；
 *   · `perTile`：每多拉开一格距离的加成（"离敌方单位越远越好"）。
 *   ⚠️ 这两个数只作用于"撤退"那一支，别的单位一点都读不到。
 */
const FLEE = { base: 18, perTile: 3 };

/**
 * ★★ 2026-10-04 用户要求③（本次改版）：远程角色的「拉扯」——`kite: true` **数据旗标**
 * （见 rules.js：霍尔·霍斯 / 乔瑟夫 / 花京院本体与绿色法皇，全项目只有这四个单位）。
 *
 * 目标行为（用户原话）："尽量站在敌人够不着的地方出手"——能打就打，但优先选择
 * **"在（或接近）自己最大射程、同时位于敌人威胁范围之外"**的落点；敌人逼近时**往后撤**再打。
 *   · `base`：撤退这一手本身值多少。要**刚好压过"随手打一下"**（7 攻打 2 防 ≈ 20 分），
 *     也要压过霍尔自己那两个技能的当轮价值（瞄准 48 / 皇帝 40）——"敌人逼近时**先撤再打**"，
 *     而不是站在人家的射程里对射；但又要**远低于**攻击计划里"当场就能打死"的那 1000 分
 *     （能收掉对手时照常出手）；
 *   · `fire`：撤过去**还够得着人**（＝"我打得着、他打不着"的那个距离带）额外加分——
 *     "撤到安全处却打不着"远不如"撤到射程边缘还能开火"；
 *   · `edge`：离**自己的最大射程**每近一格扣一点（`gap - range`，射程上刚好是 0）——
 *     于是它会挑"踩在射程边缘"的落点（典型放风筝站位），而不是一味往后退。
 * ⚠️ 这三个数只作用于 kite 单位，别的角色一点都读不到（走位评分与改动前逐值一致）。
 */
const KITE = { base: 60, fire: 8, edge: 2,
  /**
   * ★★ 2026-10-07 用户要求（本次改版）：**"远距离替身（攻击范围 ≥ 3）则向后拉扯着打"**——
   *   `minRange` 就是这个门槛：**替身射程 ≥ 3 一律拉扯**，不必再逐个插 `kite` 旗标
   *   （新覆盖的是阿布德尔的「魔术师之红」射程 3）。射程 2 的替身（白金之星 / 银色战车 / 愚者…）
   *   是近战主力，**照旧压上去打**，一个字都没改。
   *   ⚠️ 旗标一个字没删：霍尔 / 乔瑟夫 / 花京院本体与绿色法皇照旧带着它（那两个**本体**现在由
   *      `BODY` 那一支接管，见它的注释）。判据＝"旗标 ∪ 替身射程 ≥ 3"，写在走位那一段的 `kites()` 里。
   */
  minRange: 3 };

/**
 * ★★ 2026-10-05 用户拍板：「暗枪」（`SKILLS.darkgun`）在 AI 手里的两个常数。
 *   · `rate`：这一枪"能扣多少血"折算成多少分——`darkgunDamage(目标) × rate`。
 *     它是**额外的一记伤害、而且不花行动点**（`cost: 0`），所以按攻击计划那一套口径不打折；
 *     但落点由对手自己决定（他走开就空了），所以也不给溢价。
 *   · `second`：第二个位置的那点加成——"多埋一格"本身不值钱（对手不踩就是 0），
 *     只当"这一手确实埋满了两个位置"的一点点补贴。
 *   ⚠️⚠️ 上限定死在这里：**两个数加起来必须让暗枪压在「瞄准」那一档之下**——
 *     `tests/emperor-skills.test.js` ⑤ 用一处摆好的局面钉着"值得瞄的时候 AI 先开「瞄准」"
 *     （那一档最高 48 分 ＝ 16 + 4×8，防御越厚越接近它）。暗枪在那种局面里最多
 *     `(8 − 2) × 4 + 4 = 28` 分，所以顶不掉它；而皇帝自己打一下（攻击 7 打 2 防 ＝ 20 分）
 *     又略低于暗枪（24 分）——"免费的那一枪先埋、AP 照旧留着打人"，这就是这一条的设计意图。
 *   ⚠️ 只作用于**拥有 darkgun 技能**的槽位，别的角色一个数都读不到。
 */
const DARKGUN = { rate: 4, second: 4 };

/**
 * ★★ 2026-10-07 用户要求（本次改版）：**「本体」的站位规则**——用户原话是
 *   "**尽量只让替身暴露在对方攻击范围内，本体尽量后撤**"，远距离替身再加一条拉扯（见 `KITE.minRange`）。
 *
 * 为什么本体该退（这不是手感，是账）：本体与替身**共用一条命**，但**替身有 `standDefBonus` 防御加成**——
 *   同一个敌人打替身要扣掉更多防御。所以"让对手只能够得着替身、够不着本体"是实打实的减伤。
 *
 * 三条口径（每一条都对应一个"绝不能卡死 / 不能抖"的考虑）：
 *   · `expose`：**每有一个敌人够得着这一格就扣多少分**（口径 ＝ 敌方**普攻射程**，与 `flees`／`kite`
 *     两条既有的"够不够得着"完全同一套算法）。这一条让本体**不主动走进敌方射程**。
 *   · `retreat`：**离敌人每多拉开一格给多少分**（"尽量后撤"）。受**连携距离**这条引擎硬约束限制，
 *     所以最多退到连携上限就停——不会一路跑掉把替身甩下。
 *   · `escape`：从"正被够着"变成"够不着"的落点，额外给一次奖励（脱身优先于只是挪远一点）。
 *     ⚠️ 它和 `retreat` 加起来大约是"一次普通攻击"的量级（普攻一般 16～20 分）——也就是
 *     **躲伤害和打伤害一样值钱**：本体被够着时先脱身，替身该打照样打（谁先谁后由分值决定）。
 *     但远低于"当场打死"的 1000 分，所以能收掉对手时绝不会为了挪一步错过收割。
 *   · **往前走的格子一律不给正分**——这是防"进进退退原地抖"的关键：一旦退到连携上限，
 *     就没有任何一格拿得到正分，本体**原地不动**（省下行动点给替身出手），不会来回蹭。
 *
 * ⚠️⚠️ **两道防卡死的闸门**（用户反复强调"绝不能卡死"，参见 `flees`／`KITE` 的注释）：
 *   ① **只在"替身还能打到人"或"本体正被够着"时生效**（`standCanFight || dangerCur > 0`）：
 *      替身连一个能开火的落点都没有的时候，本支**整支不生效**，本体照旧走原来的"跟着压上"算法。
 *      否则被远程敌人（例如射程 5 的霍尔）压着时本体会拒绝上前 → 替身被连携锁住 → 整队再也进不了场。
 *   ② **让路**（`give`）：本体已经贴到连携上限、而这一格仍然安全时，允许往替身那侧走一步。
 *      连携距离是**落点硬约束**，本体不让路的话替身的落点会被锁死。分值刻意给得最小，
 *      所以只在替身没别的事可干（打不着人、又走不动）时才发生。
 *   ③ **不许把替身丢下**（`strand`）：本体退到"替身这一回合已经打不着人"的距离之外要重罚。
 *      实测（2026-10-07 调参时观察到）：只按①②打分时，本体能一口气退到 5 格外 → 替身被连携锁死
 *      → 下一手 `standCanFight` 变假、本体又得走回来，白花两个行动点还照样站回敌人射程里。
 *      所以"退"的上限是**替身还够得着的距离**（`替身射程 + 连携上限`，从本体落脚处算），
 *      再远就必须有别的理由（被够着、且退无可退时才认罚）。
 * ⚠️ 只作用于**有替身的角色的本体**（`kind === 'user'` ＋ 该角色确实有替身棋子）；单单位角色
 *   （乔瑟夫 / 霍尔 / 猩猩 / 黄色节制）没有替身棋子，谈不上"只让替身暴露"，本支一点都碰不到他们。
 *   带 `flees` 的本体（J·凯尔）仍旧走它自己那一支，一个字没改。
 */
const BODY = { expose: 12, retreat: 3, escape: 12, give: 2, strand: 20 };

/**
 * One bounded decision. The caller schedules it; stale timers never own game state.
 *
 * ★ 2v2：`s.turn` 是**槽位**（`'p1b'`），不是队别。所以：
 *   · 自己人＝`u.slot === side`（同一个角色的本体 + 替身，**不含同队另一个角色**）；
 *   · 敌人＝`u.side !== teamOf(side)`（队别才管"打谁"），并且跳过已经倒下的角色
 *     （★ 2026-10-04 起倒下的角色**棋子已经离场**，见 `Game.removeFallenSlot`，所以这里通常
 *     直接就读不到他们了；那道 `slotAlive` 判据留着兜住"血量被别处改成 0"的非正常路径）。
 *   ⚠️ 1v1 下 `slot === side === team`，下面每一处都与改动前逐值等价（别改成按队别取棋子：
 *      那样 2v2 里 AI 会替同队的另一个角色出手，而那个角色本该等它自己的回合）。
 */
export function chooseAI(game) {
  const s = game.s, side = s.turn;
  if (s.phase !== 'battle') return null;
  const mine = s.units.filter(u => u.slot === side);
  const foes = s.units.filter(u => u.side !== teamOf(side) && game.slotAlive(u.slot));
  const stand = mine.find(u => u.kind === 'stand'), user = mine.find(u => u.kind === 'user');
  // ★ 「力量」那一关（第五章）真正的目标不是敌人棋子，而是**还没拆的船体要害**。
  //   走位评分只看敌人棋子的话，AI 会站在原地看着要害发呆——实测 20 局里有 9 局双方
  //   都每回合空过、卡在 900 步上限打不完（见《开发交接文档》陷阱 31）。
  //   所以把要害的格子也并进"该往哪走"的目标集合；要害拆完之后它自然变回空数组。
  const shipParts = game.shipParts ? game.shipParts(otherSide(side)) : [];
  const foeTiles = [...foes.map(u => game.tile(u)), ...shipParts.map(p => game.tile(p))];
  // ★ 自己场上一个棋子都没有时直接过回合。第五章「力量」就是这样：猩猩要等船体要害
  //   全被拆掉才登场，在那之前 p2 是空的 —— 下面的 `nearest(game.tile(user), …)` 会拿到
  //   null 而抛错（hexDist 读 tile.q）。这条守卫就是为它加的。
  if (!mine.length) return { type: 'end' };
  const plans = [];
  if (!game.skillReason(stand, 'time')) return { type: 'skill', unit: stand, skill: 'time' };
  if (s.ap[side] <= 0) return { type: 'end' };

  for (const u of mine) {
    for (const skill of [null, ...game.skills(side).filter(k => ['ora', 'star', 'drain', 'splash', 'blade', 'hamon', 'claw', 'needle', 'sucker', 'knife', 'heavy'].includes(k))]) {
      const range = skill ? SKILLS[skill].range : u.range;
      for (const target of game.targets(u, range)) {
        if (game.attackReason(u, target, skill)) continue;
        const pv = game.preview(u, target, skill), cost = skill ? SKILLS[skill].cost : RULE.attackCost;
        // 打碎宝石柱不再给对手造成反噬伤害，AI 只按「这柱子挡不挡路」给一点价值
        const healthLoss = target.kind === 'pillar' ? pv.damage * .35 : Math.min(pv.damage, pv.hp);
        let score = healthLoss * 4 / cost + pv.heal * 2.4;
        if (pv.wins) score += 1000;
        if (target.kind === 'stand' && game.skills(side).includes('trauma') && !s.traumaUsed[side]) score += 5;
        if (game.skills(side).includes('burn') && s.burn[target.slot] < RULE.burnMax && target.kind !== 'pillar') score += 3;
        plans.push({ type: 'attack', unit: u, target, skill, score });
      }
    }
  }
  // ★★ 东方仗助 & 疯狂钻石（2026-10-09 用户设计）：AI 要用好这个支援位。
  //   ① **治疗友军**（被动「修复」的普攻方向）：只给"真的能补上血"的目标排计划——
  //      血是满的话这一手纯属白花行动点（`preview()` 里那个 `healActual` 就是这个判据）。
  //      分值口径沿用攻击那一套（伤害×4）：治疗量同样是"实打实的收益"。
  //   ② **重组·清状态**：对敌人按普攻伤害折算（能直接收掉就给 1000，同其它攻击计划）；
  //      对友军只在对方身上**真的有减益**时才排（否则等于空放一手）。
  //   ③ **重组·回滚**：一局一次的大招，只在血量掉到六成以下时排，分值＝"能补回多少血 × 3"。
  if (game.skills(side).includes('fix')) {
    for (const u of mine) {
      for (const tgt of game.fixTargets(u)) {
        const pv = game.preview(u, tgt);
        if (!pv || !pv.healActual) continue;
        plans.push({ type: 'mend', unit: u, target: tgt, score: pv.healActual * 4 });
      }
    }
  }
  if (game.skills(side).includes('rebuild') && stand && !game.skillReason(stand, 'rebuild')) {
    const ratio = s.hp[side] / game.fighter(side).hp;
    // ⚠️ 必须自己先算一遍"这一滚真的能补回血吗"：空回滚会被引擎作废（名额不消耗，但这一手白花），
    //    实测过 AI 会对着满血的自己按回滚（`kaykoin/josuke`、`josuke/emperor` 两局都撞上了）。
    const hist = s.snap?.[side] || [];
    const snap = hist[hist.length - 2];
    const healBack = snap ? Math.max(0, Math.min(snap.hp, game.fighter(side).hp) - s.hp[side]) : 0;
    if (ratio <= .6 && healBack > 0 && !game.rewindReason(stand, side)) {
      plans.push({ type: 'rebuild', unit: stand, target: stand, mode: 1, score: healBack * 3 });
    }
    // ⚠️ 宝石柱**不是角色**：`targets()` 会把柱子和船体要害一起返回，但「重组」只能作用于角色
    //   （引擎会拒），所以要在这里先滤掉——否则 AI 会频繁给出一个"点了才报错"的决定。
    for (const tgt of [...game.targets(stand, SKILLS.rebuild.range), ...game.fixTargets(stand)].filter(t => t.kind !== 'pillar')) {
      const debuffs = game.debuffsOn(tgt.slot).length;
      if (tgt.side === stand.side) {
        if (debuffs) plans.push({ type: 'rebuild', unit: stand, target: tgt, mode: 'mend', score: 8 + debuffs * 6 });
        continue;
      }
      const pv = game.preview(stand, tgt);
      if (!pv) continue;
      let score = pv.damage * 4 / SKILLS.rebuild.cost + debuffs * 2;
      if (pv.wins) score += 1000;
      plans.push({ type: 'rebuild', unit: stand, target: tgt, mode: 'mend', score });
    }
  }
  if (!game.skillReason(stand, 'blaze')) {
    const heal = game.healAmount(side, s.fire.length * RULE.blazeHealPerTile);
    if (heal >= 4) plans.push({ type: 'skill', unit: stand, skill: 'blaze', score: heal * 3 });
  }
  // 装甲／卸甲是双形态：血厚时卸甲换每回合 +1 AP，血少时穿回装甲补防御。
  if (game.skills(side).includes('armor') && !game.skillReason(stand, 'armor')) {
    const ratio = s.hp[side] / game.fighter(side).hp;
    const stripped = s.armorOff[side];
    const score = stripped ? (ratio <= .55 ? 28 : 2) : (ratio >= .7 ? 26 : 3);
    plans.push({ type: 'skill', unit: stand, skill: 'armor', score });
  }
  // 黄色节制｜史莱姆防御：1 AP 换 2 点基础防御、撑一整个对手回合。半血以下更值得花这 1 AP。
  // ⚠️ 单单位角色（黄色节制没有替身棋子）要用 user 出手，所以这里写 `stand || user`。
  if (game.skills(side).includes('slime')) {
    const owner = stand || user;
    if (owner && !game.skillReason(owner, 'slime')) {
      const ratio = s.hp[side] / game.fighter(side).hp;
      plans.push({ type: 'skill', unit: owner, skill: 'slime', score: ratio <= .5 ? 12 : 5 });
    }
  }
  // ★★ 霍尔·霍斯｜「瞄准」＋「皇帝」（2026-10-03 用户拍板，数值见 SKILLS.aim / SKILLS.emperor）。
  //   两条都是**by:'user'** 的技能（他是单单位角色），所以出手者取 `user || stand`，
  //   再由 `skillReason` 兜底（单位不对它会直接给理由）。
  //   ⚠️ 这里必须守着"不能反复施放"：瞄准只在`次数用光`时才重放，皇帝由 CD 拦着——
  //      否则 AI 会把行动点全砸在同一个技能上（甚至空转到 900 步上限，见两阶段那几条测试）。
  const gunner = user || stand;
  if (gunner && game.skills(side).includes('aim') && (s.aimCharges?.[side] || 0) === 0
    && !game.skillReason(gunner, 'aim')) {
    // 这一发能多扣多少血＝**目标那一层防御有多厚**（基础／替身／草丛／邻石／柱子都算在内）。
    const thickest = Math.max(0, ...game.targets(gunner, gunner.range)
      .filter(t => t.kind !== 'pillar' && !game.attackReason(gunner, t))
      .map(t => game.defense(t).total));
    // 价值折算：这一次瞄准会让**接下来两击**各多扣 `thickest` 点，但要先付出"这一发本可以打出去的
    // 伤害"（＝攻击力 − 那层防御）——**防御薄到跟没有一样时这笔买卖是亏的**，那就别瞄，直接打。
    // 留 1 点余量的理由：接下来那两击未必打在同一个目标上（可能落在更厚的替身／草丛／柱子身上），
    // 所以"打平"也值得先瞄（例：皇帝 攻击 7 打 2 防的目标＝5 点，两击各多扣 2 点，正好打平）。
    const plain = Math.max(1, game.unitAttack(gunner) - thickest);
    // ⚠️ 上限压在 900：**必须低于攻击计划里"当场就能打死"的那 1000**——
    //    能一枪收掉的时候不该先去瞄准（AI 的出手机会只有那么几次）。
    if (thickest * 2 >= plain - 1) plans.push({ type: 'skill', unit: gunner, skill: 'aim', score: Math.min(900, 16 + thickest * 8) });
  }
  if (gunner && game.skills(side).includes('emperor') && !game.skillReason(gunner, 'emperor')) {
    for (const target of game.targets(gunner, SKILLS.emperor.range)) {
      if (game.emperorReason(gunner, target)) continue;
      const pv = game.preview(gunner, target, 'emperor');
      // 估价：这一下是**额外的一记伤害**（不占他的普通攻击名额）、而且躲不掉，所以按"伤害 × 4"
      // 再补一点溢价；延迟一回合、可能被"目标提前倒下"吃掉的部分已经由那点溢价抵掉了。
      // 能直接收掉时给一个大分，但**仍然低于**"当场就能打死"的那 1000（那种机会不该让给一回合之后）。
      let score = pv.damage * 4 + 8;
      if (pv.wins) score += 300;
      // 同一个槽位已经有锁定在飞了：再锁一次只是把它顶掉（等于白花 1 AP）
      if (s.emperorMark?.[target.slot]) score -= 20;
      plans.push({ type: 'emperor', unit: gunner, target, score });
    }
  }
  // ★★ 霍尔·霍斯｜「暗枪」（2026-10-05 用户拍板，数值见 SKILLS.darkgun）。
  //   口径（用户定，别改成别的）：
  //     · **只挑"敌方棋子当前所在的那一格"当第一格**——射程里一个敌人都没有就**不埋**
  //       （用户原话的"没敌人在射程内就正确放弃"；空地上提前埋不算 AI 的活）；
  //     · 第二格优先挑**另一个敌人在射程内的所在格**（两个敌人就是人手一处），
  //       只有一个敌人时挑"它最可能踩上去的那一格"＝**紧挨目标、且离枪手更近**的那一格
  //       （对手朝我们走的方向，也就是他下一步最容易落的地方）；
  //       这两条都不成立时退到"手边任意一个可标格"——**一定要把两个位置埋满**，不留半手空着
  //       （埋了一半会让 `beginSkill`／`chooseAction` 一直拦着"先埋好第二个位置"）；
  //     · **本回合已经用过**（CD）／射程内没有可标的格子 → `skillReason` 直接给理由，这一条不生成。
  //   ⚠️ 必须守着"不能反复施放"：暗枪 `cost: 0`，如果不看 CD，AI 会在同一回合里
  //      把它排在最前面反复埋（0 AP 永远"买得起"）——`skillReason` 里的冷却判据就是那道闸。
  //   ⚠️ 与「瞄准」「皇帝」互不干扰：它是**另一条**计划，不动 `aimCharges`／`emperorMark` 那两本账
  //      （见 game.js 的 `preview()`：暗枪不吃「瞄准」的无视防御，也不消耗它的次数）。
  if (gunner && game.skills(side).includes('darkgun') && !game.skillReason(gunner, 'darkgun')) {
    const me = game.tile(gunner), darkRange = SKILLS.darkgun.range;
    // 射程**内**、还没被标过、而且是**敌方棋子当前所在**的格子（按"这一枪能扣多少血"从高到低）
    const prey = foes.map(f => ({ foe: f, tile: game.tile(f) }))
      .filter(p => p.tile && hexDist(me, p.tile) <= darkRange && !game.darkgunMarked(p.tile))
      .map(p => ({ ...p, dmg: game.darkgunDamage(p.foe) }))
      .sort((a, b) => b.dmg - a.dmg);
    if (prey.length) {                                   // 射程里没敌人 → 这一条压根不生成
      const free = game.darkgunTiles(gunner);
      const first = prey[0].tile;
      const second = prey.slice(1).map(p => p.tile).find(t => !game.darkgunMarked(t))
        || free.filter(t => hexDist(t, first) === 1).sort((a, b) => hexDist(me, a) - hexDist(me, b))[0]
        || free.find(t => !game.darkgunMarked(t));
      plans.push({ type: 'darkgun', unit: gunner, tiles: [first, ...(second ? [second] : [])],
        score: prey[0].dmg * DARKGUN.rate + (second ? DARKGUN.second : 0) });
    }
  }
  if (!game.skillReason(stand, 'emerald')) {
    const tiles = game.placement(stand, 'emerald');
    const target = tiles.sort((a, b) => {
      const score = t => mine.filter(u => hexDist(game.tile(u), t) === 1).length * 4 - nearest(t, foeTiles) * .2;
      return score(b) - score(a);
    })[0];
    if (target) plans.push({ type: 'place', unit: stand, skill: 'emerald', target,
      score: game.pillarsOf(side).length < 2 ? 13 : 8 });
  }

  if (!game.skillReason(stand, 'flame')) {
    const tiles = game.placement(stand, 'flame');
    const byEnemy = tiles.sort((a, b) => nearest(a, foeTiles) - nearest(b, foeTiles));
    if (byEnemy[0] && nearest(byEnemy[0], foeTiles) <= 1) {
      const chain = [byEnemy[0]];
      while (chain.length < SKILLS.flame.max) {
        const next = byEnemy.find(t => !chain.includes(t) && hexDist(t, chain.at(-1)) === 1);
        if (!next) break;
        chain.push(next);
      }
      plans.push({ type: 'flame', unit: stand, skill: 'flame', chain, score: 7 });
    }
  }

  // 乔瑟夫：藤蔓先手限制走位，波纹再吃「被缠绕 +3」的加成
  if (user && game.skills(side).includes('vine') && !game.skillReason(user, 'vine')) {
    for (const target of game.targets(user, SKILLS.vine.range)) {
      if (game.vineReason(user, target)) continue;
      const canFollow = !game.skillReason(user, 'hamon') && game.targets(user, SKILLS.hamon.range).includes(target);
      plans.push({ type: 'vine', unit: user, target,
        score: 7 + (target.kind === 'stand' ? 3 : 0) + (canFollow ? 7 : 0) });
    }
  }
  // 被藤蔓缠住且无事可做的单位，花 1 AP 挣脱
  for (const u of mine) {
    if (!game.vined(u) || game.breakReason(u)) continue;
    const canAttack = game.targets(u, u.range).some(t => !game.attackReason(u, t));
    if (!canAttack) plans.push({ type: 'breakfree', unit: u, score: 6 });
  }

  // 伊奇：伊奇被贴身时用潜沙换位脱身（沙顶在前面），扬沙优先废掉对方替身的普攻
  if (user && game.skills(side).includes('dive') && !game.skillReason(user, 'dive')) {
    if (foes.some(f => hexDist(game.tile(f), game.tile(user)) <= 1)) {
      plans.push({ type: 'skill', unit: user, skill: 'dive', score: 9 });
    }
  }
  if (stand && game.skills(side).includes('sandblast') && !game.skillReason(stand, 'sandblast')) {
    for (const target of game.targets(stand, SKILLS.sandblast.range)) {
      if (game.sandblastReason(stand, target)) continue;
      // 扬沙从 2026-09-30 起**带 3 点真实伤害**，所以不能只按"废掉对方普攻"给固定分：
      // 按攻击计划那一套口径把伤害折成价值（伤害 × 4 ÷ 消耗），能直接打死就加大分（同 attack 的 pv.wins）。
      const pv = game.preview(stand, target, 'sandblast');
      let score = (target.kind === 'stand' ? 8 : 4) + pv.damage * 4 / SKILLS.sandblast.cost;
      if (pv.wins) score += 1000;
      plans.push({ type: 'sandblast', unit: stand, target, score });
    }
  }
  // 暗蓝之月：先「拖入水下」挂上溺水，再用「吸盘突袭」吃那 +2 的额外伤害。
  // 顺序靠分数保证——单看这一手是负收益（1 AP 只换来每回合 2 点真伤），
  // 但如果紧接着能用吸盘打，价值就高得多，所以给「能接吸盘」的目标额外加分。
  if (stand && game.skills(side).includes('drag') && !game.skillReason(stand, 'drag')) {
    for (const target of game.targets(stand, SKILLS.drag.range)) {
      if (game.dragReason(stand, target)) continue;
      const canSucker = !game.attackReason(stand, target, 'sucker');
      // 溺水一共会掉 drownTurns 次血（每个回合结束都结算），价值按总伤害估
      const value = SKILLS.drag.drownDmg * SKILLS.drag.drownTurns;
      plans.push({ type: 'drag', unit: stand, target,
        score: value * 2.5 / SKILLS.drag.cost + (canSucker ? 8 : 0) + (target.kind === 'stand' ? 2 : 0) });
    }
  }

  // Both partners advance. Scoring only the stand caused the old AI to stall at its tether.
  const curStand = stand ? nearest(game.tile(stand), foeTiles) : Infinity, curUser = nearest(game.tile(user), foeTiles);
  /**
   * ★★ 2026-10-03 用户要求③：**「逃」这个数据旗标**（`FIGHTERS.geil.user.flees`，全项目只有 J·凯尔**本体**挂着）。
   *   它倾向拉开距离、不主动贴身：走位收益**符号反过来**——离敌方单位越远越好，
   *   撤到"敌方谁也够不着"的地方就停手（这就是用户原话的"优先离开敌方射程"）。
   *
   * 三条口径（用户明确要求"不能因此卡死、对局要打得完"，所以每一条都得交代清楚）：
   *   ① **只在真的被够得着时才撤**（`threatened`，用户原话"优先离开敌方射程"）：已经站在所有敌人的
   *      射程之外时，这一趟撤退没有意义——那一格照旧落到"正常推进"的算法上。
   *      ⚠️ 这一条同时是**防死循环的第一道闸**：两个都带旗标的单位（`geil` 对 `geil` 那两局）
   *         若"无条件能撤就撤"，会在半路上互相瞪着一格来回蹭、一颗血都不掉（实测就是这么卡住的）；
   *   ② **撤不动的格子照旧走"正常推进"**（下面那份老算法一个字没改）：所以被逼到角上时它会
   *      照常上前、照常出手，绝不会站着发呆——这是"无处可退时正常行动"的兜底；
   *   ③ 撤退分压得住"随手打一下"（本体攻 6 打 2 防 ≈ 16 分），但**压不住**攻击计划里"当场就能打死"
   *      的那 1000 分——所以"这一下能换到明显收益"（能收掉对手）时它照样正常出手。
   *   ⚠️ 只认旗标、不按角色名硬编码；别的角色身上没有这个字段，走位评分与改动前**逐值一致**。
   */
  const fleeUnit = mine.find(u => u.kind === 'user' && u.flees === true) || null;
  // 「现在是不是有敌人够得着它」——撤退的开关（口径＝**敌方射程**，见上面第 ① 条）。
  const threatened = !!fleeUnit
    && foes.some(f => hexDist(game.tile(fleeUnit), game.tile(f)) <= (f.range || 0));

  /**
   * ★★ 2026-10-04 用户要求③（本次改版）：**kite 旗标**（见上面 `KITE`）——远程角色的「拉扯」。
   * 这里先把"值得撤过去的落点"算出来（每个带旗标的单位一份），走位那一段只认这份表。
   *
   * 两道闸门（用户明确要求"绝不能卡死"，参照上面 `flees` 第 ① 条的教训）：
   *   ① **只有真的被够得着时才撤**：已经站在所有敌人的射程之外时，这一趟撤退没有意义，
   *      那个单位整份表都不进——它的走位照旧落到下面的既有算法上（该推进就推进）；
   *   ② **撤过去还得能出手**：只有"**我打得着、他打不着**"的落点真的存在时才优先撤；
   *      找不到这种落点就**照常行动**。⚠️ 这一条是防死循环的关键：当对手的射程 ≥ 自己的射程时
   *      （例如乔瑟夫射程 3 打射程 3 的花京院），"我能打、他打不着"的距离根本不存在，
   *      若还硬要撤，两边就会你退我进地蹭到天荒地老、一颗血都不掉。
   *   ③ `u.range` 为 0 的单位（**花京院的本体**不能普攻）没有"打得着"这回事，
   *      它只按第 ① 条撤到够不着的格子里——它不承担输出，站远一点就是它的全部工作。
   */
  const foeUnitTiles = foes.map(f => game.tile(f));
  /**
   * ★★ 2026-10-07 用户要求：「本体」的站位常备量（评分见上面 `BODY`，用法见下面的本体分支）。
   *   · `dangerAt(t)`：**有几个敌人够得着这一格**（口径＝敌方普攻射程，与 `flees`／`kite` 同一套算法）；
   *   · `bodyUser`：本方的**本体**（只在"这个角色确实有替身棋子"且没挂 `flees` 时才算）；
   *   · `standCanFight`：**替身还能不能打到人**——不是"现在够不够得着"，而是**从它任何合法的落点
   *     （`reachable`，连携与地形都已经算进去）能不能打到某个敌人**。"还能打"＝本体可以安心待后面；
   *     "打不到了"＝本体必须上前给替身腾地方（否则被远程敌人压着时整队再也进不了场）。
   *   · `dangerCur`：本体**眼下**被几个敌人够着；
   *   · `bodyMode`：本支的开关——"替身还能打"或"本体正被够着"，见 `BODY` 注释里的**闸门①**。
   */
  const dangerAt = tile => foes.filter(f => hexDist(tile, game.tile(f)) <= (f.range || 0)).length;
  const bodyUser = user && stand && user.flees !== true ? user : null;
  const standCanFight = !!stand && foes.some(f => game.reachable(stand)
    .some(t => hexDist(t, game.tile(f)) <= (stand.range || 0)));
  const dangerCur = bodyUser ? dangerAt(game.tile(bodyUser)) : 0;
  const bodyMode = !!bodyUser && (standCanFight || dangerCur > 0);
  const kiteTiles = new Map();
  /**
   * ★★ 2026-10-07：拉扯的判据（见 `KITE.minRange`）——**旗标 ∪ 替身射程 ≥ 3**。
   *   ⚠️ 这一行原来是"**只认旗标**"：没挂 `kite` 的单位直接跳过。用户这次要求"远距离替身
   *      （攻击范围 ≥ 3）也向后拉扯"，所以判据扩了一条；旗标本身照旧（谁带旗标谁拉扯，不受射程限制）。
   */
  const kites = u => u.kite === true || (u.kind === 'stand' && (u.range || 0) >= KITE.minRange);
  for (const u of mine) {
    if (u === bodyUser) continue;                     // 本体走 `BODY` 那一支（见下），不重复生成拉扯计划
    if (!kites(u)) continue;
    if (!foes.some(f => hexDist(game.tile(u), game.tile(f)) <= (f.range || 0))) continue;   // 闸门①
    const spots = game.reachable(u).filter(t =>
      foes.every(f => hexDist(t, game.tile(f)) > (f.range || 0))
      && ((u.range || 0) === 0 || foes.some(f => hexDist(t, game.tile(f)) <= u.range)));
    if (spots.length) kiteTiles.set(u, new Set(spots.map(tileKey)));                        // 闸门②
  }
  for (const u of mine) for (const t of game.reachable(u)) {
    const path = game.paths(u).get(tileKey(t));
    const fire = path.some(p => game.fireAt(p)?.side === otherSide(side));
    const ty = s.terrain[tileKey(t)];
    const damage = (fire ? RULE.fireDmg : 0) + (ty === 'hazard' ? RULE.hazardDmg : 0);
    if (damage >= s.hp[side]) continue;
    const distance = nearest(t, foeTiles);
    // ★ 逃跑单位（见上面 FLEE）：被够得着、且这一格**确实退得更远**时，走"越远越好"那一份；
    //   其余情况（够不着 / 原地 / 上前 / 被逼到角上）**原样落到下面那份"正常推进"的算法上**。
    if (u === fleeUnit && threatened && Number.isFinite(distance) && distance > curUser) {
      let score = FLEE.base + (distance - curUser) * FLEE.perTile - damage * 2;
      if (ty === 'heal') score += game.healAmount(side, RULE.healAmt) * 2.5;
      plans.push({ type: 'move', unit: u, target: t, score });
      continue;
    }
    // ★★ 2026-10-07 用户要求（本次改版）：**本体后撤、只让替身去顶**（评分见上面 `BODY`）。
    //   打分只有三项，刻意**不给"往前走"任何正分**——退了就不再蹭回来（没有来回抖动、也不白花行动点）。
    if (bodyMode && u === bodyUser) {
      const here = game.tile(u);
      if (tileKey(t) === tileKey(here)) continue;      // "移动到原地"没有任何意义（不许白花 1 AP）
      const danger = dangerAt(t);
      const back = Number.isFinite(distance) && Number.isFinite(curUser) ? distance - curUser : 0;
      let score = -danger * BODY.expose;               // ① 不主动走进敌方射程
      if (back > 0) score += back * BODY.retreat;      // ② 尽量后撤（受连携距离限制，退到上限即止）
      if (danger === 0 && dangerCur > 0) score += BODY.escape;   // ③ 脱身优先于只是挪远一点
      // 闸门②「让路」：已经贴到连携上限、这一格又安全时，允许朝替身那侧走一步给替身腾地方。
      if (danger === 0 && back < 0 && game.distLimit(u.slot) - hexDist(here, game.tile(stand)) <= 0) score += BODY.give;
      // 闸门③「不许把替身丢下」：退到"替身这一回合已经够不着人"的距离之外要重罚（见 `BODY` 的注释）。
      if (Number.isFinite(distance) && distance > (stand.range || 0) + game.distLimit(u.slot)) score -= BODY.strand;
      if (ty === 'heal') score += game.healAmount(side, RULE.healAmt) * 2.5;
      score -= damage * 2;
      if (score > .5) plans.push({ type: 'move', unit: u, target: t, score });
      continue;
    }
    // ★★ 拉扯（见上面 `KITE`）：这一格是"我打得着、他打不着"的落点 → 优先撤到这里再开火。
    //   评分按"射程边缘最好"来定（`gap - range`，站在最大射程上是 0，越近越亏），
    //   所以它挑的是**射程边缘**那一格，而不是一路退回角落。
    if (kiteTiles.get(u)?.has(tileKey(t))) {
      const range = u.range || 0;
      const gap = nearest(t, foeUnitTiles);
      let score = KITE.base - damage * 2;
      if (range > 0 && Number.isFinite(gap)) score += KITE.fire + (gap - range) * KITE.edge;
      if (ty === 'heal') score += game.healAmount(side, RULE.healAmt) * 2.5;
      plans.push({ type: 'move', unit: u, target: t, score });
      continue;
    }
    const gain = u.kind === 'stand' && stand ? (curStand - distance) * 4 : (curUser - distance) * 2;
    let score = gain - damage * 2;
    if (u.kind === 'stand' && stand && distance <= u.range && curStand > u.range) score += 6;
    if (ty === 'heal') score += game.healAmount(side, RULE.healAmt) * 2.5;
    // Small defensive bonuses never outweigh forward progress by themselves.
    if (gain > 0 && ty === 'bush') score += 1;
    /**
     * ★★ 2026-10-05 用户拍板：**AI 要学会捡道具**（走位评分里的一条倾向，不是另起一套算法）。
     * 加分的条件只有一条：**这一格上有道具，而且这一步确实在朝敌人推进**（`distance < 出发时的距离`＝顺路）。
     *   · 「顺路」这条闸同时管住两件事：**不为道具改道**（横着走、往后撤都不加）、
     *     于是既不会为了捡东西退开、也不会在道具旁边来回蹭（捡到手格子就空了，不存在来回蹭）；
     *   · 分值取自数据（`ITEM_TYPES[*].grab` ≤ 6，且「连携」对单单位角色按它实际变成的"移动 +1"折算），
     *     压在"随手打一下"（普攻一般 ≥ 12 分）之下——**打得着人时照旧先打**，只有顺路且不亏时才顺手拿走；
     *   · **送死的格子根本进不来**：上面那句 `damage >= s.hp[side]` 已经把"走过去就没了"的落点滤掉了。
     */
    const item = game.itemAt?.(t);
    if (item && Number.isFinite(distance) && distance < (u.kind === 'stand' && stand ? curStand : curUser)) {
      score += game.itemGrabValue?.(item, side) || 0;
    }
    if (score > .5) plans.push({ type: 'move', unit: u, target: t, score });
  }
  plans.sort((a, b) => b.score - a.score);
  return plans[0] || { type: 'end' };
}

export function playAIAction(game, plan = chooseAI(game)) {
  if (!plan) return false;
  const { type, unit, target, skill } = plan;
  if (type === 'end') return game.endTurn();
  // ★ 东方仗助：「修复」治疗友军 与「重组」（两个模式都在这里分派）
  if (type === 'mend') { game.select(unit.id); return game.mend(unit, target); }
  if (type === 'rebuild') { game.select(unit.id); return game.rebuild(unit, target, plan.mode); }
  if (type === 'move') return game.move(unit, target);
  if (type === 'attack') return game.attack(unit, target, skill);
  if (type === 'skill') return game.beginSkill(unit, skill);
  if (type === 'vine') { game.select(unit.id); return game.vine(target); }
  if (type === 'sandblast') { game.select(unit.id); return game.sandblast(target); }
  if (type === 'drag') { game.select(unit.id); return game.drag(target); }
  // ★「皇帝」：锁定一个单位（走 select → emperorLock 这条既有链路，与 drag／vine 完全同款）
  if (type === 'emperor') { game.select(unit.id); return game.emperorLock(target); }
  // ★★「暗枪」：一次埋两格——走 `beginSkill` → `darkgunMark`（与上面「火焰道路」那一支完全同款，
  //    只是不需要 `select`：`beginSkill` 自己会把选中落在出手者身上）。
  //    ⚠️ 收尾那句 `finishDarkgun()` 是必须的：万一只埋下一格（第二格被别的东西占掉了），
  //       `pendingSkill` 会一直挂着 'darkgun'，下一轮 `chooseAI` 里"先埋好第二个位置"那条闸
  //       会把移动／普攻全拦掉——写在这里收干净，AI 就不会自己把自己卡住。
  if (type === 'darkgun') {
    if (!game.beginSkill(unit, 'darkgun')) return false;
    for (const tile of plan.tiles || []) {
      if (game.s.pendingSkill !== 'darkgun') break;
      game.darkgunMark(unit, tile);
    }
    if (game.s.pendingSkill === 'darkgun') game.finishDarkgun();
    return true;
  }
  if (type === 'breakfree') return game.breakFree(unit);
  if (type === 'place') return game.beginSkill(unit, skill) && game.place(unit, target);
  if (type === 'flame') {
    if (!game.beginSkill(unit, 'flame')) return false;
    for (const tile of plan.chain) {
      if (game.s.pendingSkill !== 'flame') break;
      game.place(unit, tile);
    }
    if (game.s.pendingSkill === 'flame') game.finishFlame();
    return true;
  }
  return false;
}
