/**
 * 从 src/core/rules.js 重新生成规则基线 tools/rules-fingerprint.json。
 *
 * 用途：tests/game.test.js 会用这份基线逐项比对 RULE / FIGHTERS / SKILLS，
 * 用来发现"没打算改却改了"的数值漂移。**只有在故意改规则时才运行它**，
 * 运行后请检查 diff，确认每一处变化都是本次要改的。
 *
 * 用法：node tools/update-fingerprint.mjs
 */
import { writeFileSync, readFileSync } from 'node:fs';
import { dirname, resolve, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { RULE, FIGHTERS, SKILLS } from '../src/core/rules.js';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const OUT = join(ROOT, 'tools/rules-fingerprint.json');
const previous = JSON.parse(readFileSync(OUT, 'utf8'));

const fighterValues = f => ({ hp: f.hp, def: f.def, distLimit: f.distLimit, standDefBonus: f.standDefBonus,
  // 单单位角色（乔瑟夫）没有替身：dmg/range 用本体数值记录，moveS 记 0
  dmg: f.stand ? f.stand.dmg : (f.user.dmg || 0), range: f.stand ? f.stand.range : (f.user.range || 0),
  moveU: f.user.move, moveS: f.stand ? f.stand.move : 0,
  ...(f.solo ? { solo: true } : {}), ...(f.timeRule ? { timeRule: f.timeRule } : {}),
  // 单单位角色也可能"有替身名但没有棋子"（乔瑟夫＝隐者之紫），记下来防止被无声改回"无替身"
  ...(f.standName ? { standName: f.standName } : {}),
  // 剧情 boss 的标记必须记下来：丢了它灰塔就会出现在选人列表里
  ...(f.boss ? { boss: true } : {}) });
const skillValues = key => {
  // 已知技能沿用上次记录过的字段，再并上当前存在的所有候选字段：
  // 这样新增字段（例如双形态技能的 altName/toggle）也会进入基准，改名或改形态同样会被测出来。
  // ⚠️ 候选表必须覆盖**所有会影响平衡的数值字段**：漏一个（例如溺水伤害 drownDmg、
  //    被动回血 regen、斩杀加成 execute）等于那个数字没有基线保护，被人悄悄改掉也测不出来。
  //    ⚠️ 2026-09-30 又漏过一次：给扬沙加了 `dmg`（真实伤害 3）后基线报"修改 —"，
  //       说明这个字段当时不在表里——**新加数值字段时记得回来看这张表**。
  //       （同一天给飞刀加 `stopBonus`、给侵蚀加 `erosionDmg` 时也踩了同一个坑，一起补上了。）
  const candidates = ['name', 'altName', 'cost', 'cd', 'range', 'by', 'passive', 'line', 'once', 'toggle',
    'base', 'bonus', 'execute', 'cut', 'guard', 'miss', 'regen', 'perPillar', 'cap', 'pillarHp', 'max',
    'swap', 'drownTurns', 'drownDmg', 'dmg', 'stopBonus', 'erosionDmg'];
  const fields = new Set(previous.SKILLS[key] ? Object.keys(previous.SKILLS[key]) : []);
  for (const field of candidates) if (SKILLS[key][field] !== undefined) fields.add(field);
  const out = {};
  for (const field of [...fields].sort()) {
    const v = SKILLS[key][field];
    if (v === undefined) continue;
    out[field] = field === 'passive' || field === 'toggle' ? !!v : v;
  }
  return out;
};

const next = {
  RULE: { ...RULE },
  FIGHTERS: Object.fromEntries(Object.keys(FIGHTERS).map(k => [k, fighterValues(FIGHTERS[k])])),
  SKILLS: Object.fromEntries(Object.keys(SKILLS).map(k => [k, skillValues(k)])),
};

writeFileSync(OUT, JSON.stringify(next, null, 2) + '\n', 'utf8');

const added = k => Object.keys(next[k]).filter(x => !previous[k]?.[x]);
const removed = k => Object.keys(previous[k] || {}).filter(x => !next[k]?.[x]);
// 比较时按字段名排序后再序列化：基准文件里字段的书写顺序变化不算「修改」，
// 只有数值/名字真的改了才报出来。
const canon = value => JSON.stringify(Object.entries(value || {}).sort(([a], [b]) => a.localeCompare(b)));
console.log('已更新：', OUT);
for (const group of ['RULE', 'FIGHTERS', 'SKILLS']) {
  const a = group === 'RULE' ? Object.keys(next.RULE).filter(f => previous.RULE[f] === undefined) : added(group);
  const r = group === 'RULE' ? Object.keys(previous.RULE).filter(f => next.RULE[f] === undefined) : removed(group);
  const changed = group === 'RULE'
    ? Object.keys(next.RULE).filter(f => previous.RULE[f] !== undefined && previous.RULE[f] !== next.RULE[f])
    : Object.keys(next[group]).filter(k => previous[group]?.[k] && canon(previous[group][k]) !== canon(next[group][k]));
  console.log(`  ${group.padEnd(9)} 新增 ${a.length ? a.join(',') : '—'} | 修改 ${changed.length ? changed.join(',') : '—'} | 删除 ${r.length ? r.join(',') : '—'}`);
}
