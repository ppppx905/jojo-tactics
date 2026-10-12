/**
 * 把当前构建同步到网站仓库（GitHub Pages 用的那份）。
 *
 * 网站结构（Hexo）：`<博客仓库>/source/jojo/` 下放**单文件版 HTML**（重命名为 index.html）+ `assets/out/**`。
 * 博客的 `_config.yml` 写了 `skip_render: jojo/**`，所以这些文件会被原样拷进 public/。
 *
 * 用法：
 *   node tools/sync-site.mjs                       # 同步到默认位置
 *   node tools/sync-site.mjs "D:/别的/博客仓库"      # 指定博客仓库根目录
 *   node tools/sync-site.mjs --check               # 只比对、不写任何文件
 *
 * ⚠️ 同步完成后**还要提交并推送**（推送脚本在博客仓库根目录），见《开发交接文档》§4。
 * ⚠️ 排除项：`standees/contact.png`（校对图）与 `terrain/_sheet@2x.*`（切片源图，约 610 KB），
 *    游戏运行时根本不读它们，放进网站只是白白占用体积。
 */
import { readFile, writeFile, mkdir, readdir, stat, rm } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const CHECK_ONLY = args.includes('--check');
const BLOG = path.resolve(args.find(a => !a.startsWith('--')) || 'D:/我的下载/hexo/blog');
const SITE = path.join(BLOG, 'source/jojo');
const BUNDLE = path.join(ROOT, 'jojo战棋-单文件版.html');

/** 这 9 个目录要上传（和发布包的清单一致）。
 *  ⚠️ 2026-10-05 补上 `parts`：**少了它就是 4 张船体要害图在线上 404**——
 *    本地因为文件就在 `assets/out/parts/` 所以看不出来，只有网页版会弹"有图没加载出来"。 */
const DIRS = ['standees', 'portraits', 'cutins', 'terrain', 'terrain-plane', 'audio', 'lobby', 'arenas', 'parts'];
/** 不上传的文件：校对图与切片源图。 */
const EXCLUDE = new Set(['contact.png', '_sheet@2x.png', '_sheet@2x.json']);

const sha = async file => createHash('sha256').update(await readFile(file)).digest('hex');
const listFiles = async dir => {
  const out = [];
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...await listFiles(full));
    else if (!EXCLUDE.has(entry.name)) out.push(full);
  }
  return out;
};

if (!existsSync(BUNDLE)) {
  console.error(`找不到单文件版：${BUNDLE}\n先跑 node tools/bundle-standalone.mjs`);
  process.exit(1);
}
if (!existsSync(path.join(BLOG, '.git'))) {
  console.error(`这不像是一个博客仓库（没有 .git）：${BLOG}`);
  process.exit(1);
}

console.log(`源：${ROOT}`);
console.log(`目标：${SITE}`);
console.log(CHECK_ONLY ? '模式：只比对（--check），不写文件\n' : '模式：同步\n');

let copied = 0, removed = 0, same = 0;
const problems = [];

/** ① 单文件版 HTML → source/jojo/index.html */
await mkdir(SITE, { recursive: true });
const target = path.join(SITE, 'index.html');
const sourceHash = await sha(BUNDLE);
const targetHash = existsSync(target) ? await sha(target) : null;
if (sourceHash === targetHash) {
  same++;
  console.log(`= index.html 已经是最新（${sourceHash.slice(0, 12)}）`);
} else if (CHECK_ONLY) {
  console.log(`! index.html 需要更新（本地 ${sourceHash.slice(0, 12)} ≠ 网站 ${targetHash ? targetHash.slice(0, 12) : '（不存在）'}）`);
} else {
  await writeFile(target, await readFile(BUNDLE));
  copied++;
  console.log(`+ index.html 已更新（${targetHash ? targetHash.slice(0, 12) : '新建'} → ${sourceHash.slice(0, 12)}）`);
}

/** ② 素材目录镜像：本地有的拷过去，网站多出来的（且不在排除项里）删掉 */
for (const dir of DIRS) {
  const from = path.join(ROOT, 'assets/out', dir);
  if (!existsSync(from)) { problems.push(`本地缺少目录 assets/out/${dir}`); continue; }
  const to = path.join(SITE, 'assets/out', dir);
  const wanted = new Map((await listFiles(from)).map(f => [path.relative(from, f), f]));
  const present = existsSync(to) ? await listFiles(to) : [];

  // 删掉网站上多出来的文件（保持两边一致，避免旧素材留在线上）
  for (const file of present) {
    const rel = path.relative(to, file);
    if (wanted.has(rel)) continue;
    if (CHECK_ONLY) { console.log(`! ${dir}/${rel} 网站上多余，应删除`); continue; }
    await rm(file);
    removed++;
  }
  // 拷贝新增或内容不同的文件
  let changed = 0;
  for (const [rel, src] of wanted) {
    const dst = path.join(to, rel);
    if (existsSync(dst) && await sha(src) === await sha(dst)) { same++; continue; }
    changed++;
    if (CHECK_ONLY) continue;          // ⚠️ 只比对模式：到这一步就停，绝不动磁盘（连建目录都不做）
    await mkdir(path.dirname(dst), { recursive: true });
    await writeFile(dst, await readFile(src));
    copied++;
  }
  const total = wanted.size;
  console.log(`${CHECK_ONLY ? '·' : changed ? '+' : '='} ${dir.padEnd(13)} ${String(total).padStart(2)} 个文件${changed ? `，更新 ${changed} 个` : '，已是最新'}`);
}

console.log('');
if (problems.length) {
  console.log('问题：');
  for (const p of problems) console.log(`  ! ${p}`);
  process.exit(1);
}
if (CHECK_ONLY) {
  console.log('比对完成（没有写任何文件）。要真正同步就去掉 --check。');
} else {
  console.log(`同步完成：拷贝/更新 ${copied} 个，删除多余 ${removed} 个，本来一致 ${same} 个。`);
  console.log('');
  console.log('★ 网站不会自己更新，还要提交并推送：');
  console.log(`   cd "${BLOG}"`);
  console.log('   git add source/jojo && git commit -m "游戏更新"');
  console.log('   然后双击仓库里的推送脚本（本地历史被重写过，要用【强制推送-清理手机号.bat】）');
}
