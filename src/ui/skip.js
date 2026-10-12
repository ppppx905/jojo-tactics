/**
 * ★★ 2026-10-03 用户要求①：**在战斗界面点"空白处"＝跳过正在播的那一条演出**。
 *
 * 可跳的三样（各自独立，点一下**只收一样**，优先顺序＝台词 → 大字横幅 → 提示）：
 *   ① `bark`   战斗台词：收掉**正在播的这一条**（不是清队列），再点一下接下一句；
 *   ② `banner` 大字横幅（伪装破裂／剧情触发／阶段切换那种）；
 *   ③ `notice` 提示（HUD 里那行「移动完成，剩余 2 AP」）。
 * 三样都由 main.js 注入"收掉它"的回调（那边才拿得到计时器与节点），
 * 这里只负责**判定"这一点算不算点空白"**与**按顺序调一次**——所以这一份能直接用假 DOM 测。
 *
 * ⚠️⚠️ 这一条**绝不能影响**别的东西（用户原话"一点都不能被影响"）：
 *   · 按钮 / 棋子 / 棋盘格 / 对话框 / 确认框 / 弹窗 **各有自己的逻辑**，
 *     它们命中的点击**根本不算"空白"**（见 SKIP_OWNED）；
 *   · **键盘一个键都不抢**（Space 仍然是结束回合）——这里只有点击，没有按键；
 *   · 结算弹窗、认输/重开那种确认框、剧情阅读页里要玩家做选择的地方**一律不跳**
 *     （它们是 `dialog`／不在战斗界面，见 skipGate）。
 *
 * ★★ 2026-10-04 用户要求②（在文件末尾）：**剧情正文页上点空白处＝点那一页的「继续」**。
 *   那是**另一条独立闸门** `skipStoryBlank`（战斗这一套 `skipGate` / `createSkipper` 一个字都没改），
 *   原因见下面那个函数自己的注释。
 */

/**
 * 命中这些的点击＝**不算空白**（"有主"的东西，各自走自己的分支）。
 *
 * ⚠️ 三条最要紧的（漏掉任何一条都等于抢了别人的点击语义）：
 *   · `canvas`   —— 棋盘（#board）。点棋盘格照旧选择／移动／攻击，**一个字都不许改**；
 *   · `button`   —— 棋子卡、技能钮、结束回合、菜单……；
 *   · `dialog`   —— 所有弹窗：**结算页、认输/重开确认框**都在这一类里。
 * 其余是"长在别处的可点物"（剧情档案的翻页、选人页的角色与开关等），一并在内。
 *
 * ⚠️ 还有三个**演出自己的框**：台词框（#bark）、大字横幅（#stageBanner）、大招插画（#cutin）。
 *    它们 CSS 上是 `pointer-events: none`，点击本来就穿过去落到棋盘上；这里再列一次是**兜底**——
 *    万一以后那几条样式改了，点在"对话框上"也仍然不算"点空白处"（用户原话："对话框"不算）。
 */
export const SKIP_OWNED = [
  'button', 'a[href]', 'input', 'select', 'textarea', 'label',
  'canvas', 'dialog', '[role="dialog"]',
  '[data-unit]', '[data-command]', '[data-inspect-skill]',
  '[data-draft-side]', '[data-draft-focus]', '[data-control-slot]', '[data-team-size]',
  '[data-story]', '[data-help]', '[data-close]', '[data-story-jump]', '[data-story-page]',
  '#bark', '#stageBanner', '#cutin',
].join(', ');

/** 点一下的**优先顺序**：台词 → 大字横幅 → 提示（一条一条收，不是一把全清）。 */
export const SKIP_ORDER = ['bark', 'banner', 'notice'];

/**
 * 这一点算不算"点空白"：落在 `root`（＝ `#app`）里面，**且**不属于任何"有主"的元素。
 * ⚠️ 只接受元素（真 DOM 里 `event.target` 是元素）；拿不到 `closest`／不在 root 里一律判否。
 */
export function isBlankClick(target, root) {
  if (!target || !root) return false;
  if (typeof target.closest !== 'function' || typeof root.contains !== 'function') return false;
  if (!root.contains(target)) return false;
  return target.closest(SKIP_OWNED) === null;
}

/**
 * "这一刻到底该不该跳"——把调用处那几个条件收成一个纯函数，测试才能**逐条**钉住"不跳"的那几种情况。
 *   · `inBattle`  ：不是战斗界面就不跳（剧情阅读页 / 选人页 / 标题页 / 章节列表都在这个口子上被挡住）；
 *   · `appHidden` ：`#app` 不在台面上同理；
 *   · `modalOpen` ：**有任何一个弹窗开着就不跳**——结算弹窗、认输与重开的确认框、对局菜单、
 *                   规则与设置这些全都落在这一条上，玩家必须像原来那样去点按钮。
 */
export function skipGate({ inBattle = false, appHidden = false, modalOpen = false, target = null, root = null } = {}) {
  if (!inBattle || appHidden || modalOpen) return false;
  return isBlankClick(target, root);
}

/**
 * 把三条通道包成"点一下调一次"的分派器：按 `order` 依次问，**谁先真的收掉了就停手**（返回它的名字）。
 * 一条都没收掉时返回 `null`（＝这一点虽然算空白，但当时没有正在播的东西，什么都不用做）。
 * 通道缺省（`undefined`）时自动跳过它，所以 main.js 可以只注入自己关心的那几条。
 */
export function createSkipper(channels = {}, order = SKIP_ORDER) {
  return function skip() {
    for (const name of order) {
      const run = channels?.[name];
      if (typeof run !== 'function') continue;
      if (run() === true) return name;
    }
    return null;
  };
}

/**
 * ★★ 2026-10-04 用户要求②：**剧情正文页上点空白处＝点那一页的「继续」**。
 *
 * 由来：上面那套 `skipGate` 只在**战斗界面**生效（判定里要求"正在战斗"），
 * 所以剧情模式读小说那几页点空白**没反应**（用户实测）。
 *
 * ⚠️⚠️ 三条硬边界（都是用户原话"一点都不能被影响"）：
 *   ① **不是战斗那三条通道的替代品**：战斗里的跳过仍然只走 `skipGate` + `skipPresentation`，
 *      这一条是**另一条独立的闸门**，两边互不干扰（`skipGate` 一个字都没动）；
 *   ② **只认剧情正文页**：`#storyStage` 没在台面上（标题页 / 章节列表 / 选人页 / 战斗界面 /
 *      结算页）一律判否——所以结算弹窗、确认框照旧不能被跳过；
 *   ③ **有主的点击一律不算空白**（`isBlankClick` + SKIP_OWNED）：继续 / 返回标题这些**按钮**
 *      照旧走它们自己的分支；`dialog` 也照旧——`modalOpen` 与 SKIP_OWNED 各守一半。
 *      剧情正文页现在**没有**需要玩家做选择的页；将来若有，请给那个节点带上 SKIP_OWNED 里的
 *      标记（或加进那个清单），**绝不能让"点空白"替玩家做选择**。
 *
 * 分派：判定通过就调一次 `advance`——它必须是**那一页「继续」按钮同一个函数**
 * （main.js 里按钮的 onclick 与这一条共用 `storyAdvance`），这样两条路的行为逐值一致：
 * 推进下一幕 / 开打 / 完成本章，连音效都一样。`advance` 没给时判否（宁可不跳，也别猜）。
 */
export function skipStoryBlank({ stageHidden = true, modalOpen = false, target = null, root = null, advance = null } = {}) {
  if (stageHidden || modalOpen) return false;
  if (!isBlankClick(target, root)) return false;
  if (typeof advance !== 'function') return false;
  advance();
  return true;
}
