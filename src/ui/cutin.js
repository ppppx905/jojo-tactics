/**
 * 大招插画（cutin）**该不该播**的判定。
 *
 * ★ 2026-10-05 用户要求①：每个角色的**第三个技能**都要播大招插画。
 *   判定拆成两个纯函数放在这里（照 `ui/skip.js` 的写法：判定与显示分开），
 *   于是 `tests/cutin-third-skill.test.js` 既能在不用 DOM 的情况下逐角色验一遍，
 *   也能在**假 DOM** 里把同一份判定喂给 main.js 真实的 `onEvent`，看画面上是不是真播了。
 *
 * ⚠️ 显示那一侧（`showCutin`：节奏、喊话、减弱动效的退化、自动收起）一个字都没动，
 *    仍在 main.js 里；这里只回答"这一次出手该不该放"。
 */

/**
 * 该角色技能表里的**第三个技能**。
 *
 * 口径（用户 2026-10-05 定）：
 *   · 传进来的是**实际生效的那一份技能表**（引擎侧就是 `game.skills(槽位)`）——
 *     剧情模式的技能替换（`swaps.<角色>.skills`）会让表**变短或换内容**，判定跟着走；
 *   · **不足三个技能的角色**（只有 2 个技能的 boss、没有技能的 boss）＝**没有第三技能**：
 *     这里返回 `null`，调用方照常走白名单那一支，**不报错、也不瞎播**；
 *   · 不是数组（调用方漏传）走同一个兜底，同样返回 `null`。
 */
export const thirdSkillOf = skills => (Array.isArray(skills) && skills.length >= 3 ? skills[2] : null);

/** 这一次出手的技能，是不是"该角色的第三个技能"（表按**实际生效**的那一份传进来）。 */
export const isThirdSkill = (skills, skill) => !!skill && thirdSkillOf(skills) === skill;
