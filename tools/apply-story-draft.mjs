/**
 * 剧情档案扩写合并工具（一次性流水线用）。
 *
 * 把 design/story-draft/part-*.json 里的新 paragraphs 合并进 src/ui/story.js：
 *   - 只替换每章的 paragraphs 数组，id / title / chapters 一律沿用现有值（话数标注不会被改动）
 *   - 写入前逐条校验：原有段落必须**逐字**保留在新数组里（防止扩写时把已有内容弄丢）
 *   - 先备份到 design/story-draft/story.js.bak
 *
 * 用法:
 *   node tools/apply-story-draft.mjs            # 校验 + 应用
 *   node tools/apply-story-draft.mjs --check    # 只校验，不写文件
 */
import { readFileSync, writeFileSync, existsSync, readdirSync, mkdirSync, copyFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { STORY } from '../src/ui/story.js';

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const STORY_JS = join(ROOT, 'src/ui/story.js');
const DRAFT_DIR = join(ROOT, 'design/story-draft');
const CHECK_ONLY = process.argv.includes('--check');

/** 单引号字符串字面量的转义（与文件既有风格一致）。 */
const quote = (text) => `'${String(text).replace(/\\/g, '\\\\').replace(/'/g, "\\'")}'`;

/** 定位 `export const STORY = [` … 配对的 `];`，扫描时跳过字符串字面量。 */
function locateStoryArray(source) {
  const marker = 'export const STORY = [';
  const start = source.indexOf(marker);
  if (start < 0) throw new Error('没有找到 `export const STORY = [`');
  let depth = 0, i = start + marker.length - 1;
  for (; i < source.length; i++) {
    const ch = source[i];
    if (ch === "'" || ch === '"' || ch === '`') {
      const closer = ch;
      i++;
      while (i < source.length) {
        if (source[i] === '\\') { i += 2; continue; }
        if (source[i] === closer) break;
        i++;
      }
      continue;
    }
    if (ch === '[') depth++;
    else if (ch === ']') {
      depth--;
      if (depth === 0) return { from: start + marker.length - 1, to: i + 1 };
    }
  }
  throw new Error('STORY 数组没有闭合');
}

/** 按文件既有排版风格序列化整份章节表。 */
function serialize(chapters) {
  const body = chapters.map(chapter => {
    const paragraphs = chapter.paragraphs.map(text => `      ${quote(text)},`).join('\n');
    return `  {\n    id: ${quote(chapter.id)}, title: ${quote(chapter.title)}, chapters: ${quote(chapter.chapters)},\n    paragraphs: [\n${paragraphs}\n    ],\n  },`;
  }).join('\n');
  return `[\n${body}\n]`;
}

function loadDrafts() {
  if (!existsSync(DRAFT_DIR)) throw new Error(`缺少文稿目录: ${DRAFT_DIR}`);
  const files = readdirSync(DRAFT_DIR).filter(name => /^part-\d+\.json$/.test(name)).sort();
  if (!files.length) throw new Error('design/story-draft/ 下没有 part-N.json');
  const merged = new Map();
  for (const name of files) {
    const raw = readFileSync(join(DRAFT_DIR, name), 'utf8').replace(/^\uFEFF/, '');
    let data;
    try {
      data = JSON.parse(raw);
    } catch (error) {
      throw new Error(`${name} 不是合法 JSON：${error.message}`);
    }
    if (!Array.isArray(data.chapters)) throw new Error(`${name} 缺少 chapters 数组`);
    for (const entry of data.chapters) {
      if (merged.has(entry.id)) throw new Error(`${name} 里的 ${entry.id} 与其他文稿重复`);
      merged.set(entry.id, entry.paragraphs);
    }
  }
  return { files, merged };
}

function main() {
  const { files, merged } = loadDrafts();
  console.log(`读取文稿 ${files.length} 份：${files.join('、')}`);

  const problems = [];
  const byId = new Map(STORY.map(chapter => [chapter.id, chapter]));
  const drafts = [];

  for (const [id, paragraphs] of merged) {
    const chapter = byId.get(id);
    if (!chapter) { problems.push(`文稿里的 id 不在 story.js 中：${id}`); continue; }
    if (!Array.isArray(paragraphs) || paragraphs.length < 5) {
      problems.push(`${chapter.title}：扩写后段数不足 5（实际 ${paragraphs?.length}）`);
      continue;
    }
    // 原有段落必须逐字保留
    const next = paragraphs.map(text => String(text).trim());
    for (const old of chapter.paragraphs) {
      if (!next.includes(old)) problems.push(`${chapter.title}：原有段落丢失或改字 → 「${old.slice(0, 18)}…」`);
    }
    // 原文段落里本来就有偏短的句子，它们只受游戏测试的真实下限（15 字）约束；
    // 新增段落则要求至少 40 字，避免扩写用一句空话凑数。
    for (const [index, text] of next.entries()) {
      const isOriginal = chapter.paragraphs.includes(text);
      const floor = isOriginal ? 15 : 40;
      if (text.length < floor) {
        problems.push(`${chapter.title}：第 ${index + 1} 段过短（${text.length} 字，${isOriginal ? '原文' : '新增'}下限 ${floor}）`);
      }
      if (/TODO|待补|占位|lorem/i.test(text)) problems.push(`${chapter.title}：第 ${index + 1} 段有占位文字`);
    }
    if (new Set(next).size !== next.length) problems.push(`${chapter.title}：有重复段落`);
    drafts.push({ chapter, next });
  }

  const missing = STORY.filter(chapter => !merged.has(chapter.id));
  console.log(`${merged.size} / ${STORY.length} 章有扩写文稿`);
  if (missing.length) console.log(`没有文稿、保持原样的章节：${missing.map(c => c.id).join('、')}`);

  if (problems.length) {
    console.log('\n✗ 校验未通过：');
    for (const line of problems) console.log(`  - ${line}`);
    process.exit(1);
  }
  console.log('✓ 校验通过：原有段落逐字保留、段数达标、无占位文字、无重复段');

  if (CHECK_ONLY) { console.log('（--check 模式，未写入文件）'); return; }

  const draftById = new Map(drafts.map(item => [item.chapter.id, item.next]));
  const finalChapters = STORY.map(chapter => ({ ...chapter, paragraphs: draftById.get(chapter.id) || chapter.paragraphs }));
  const source = readFileSync(STORY_JS, 'utf8');
  const { from, to } = locateStoryArray(source);
  const rebuilt = source.slice(0, from) + serialize(finalChapters) + source.slice(to);

  mkdirSync(DRAFT_DIR, { recursive: true });
  copyFileSync(STORY_JS, join(DRAFT_DIR, 'story.js.bak'));
  writeFileSync(STORY_JS, rebuilt, 'utf8');

  const oldTotal = STORY.reduce((sum, c) => sum + c.paragraphs.join('').length, 0);
  const newTotal = finalChapters.reduce((sum, c) => sum + c.paragraphs.join('').length, 0);
  console.log('\n已写入 src/ui/story.js（备份：design/story-draft/story.js.bak）');
  for (const item of drafts) {
    const before = item.chapter.paragraphs.length, after = item.next.length;
    console.log(`  ${item.chapter.id.padEnd(12)} ${before} → ${after} 段`);
  }
  console.log(`总字数：${oldTotal} → ${newTotal}（+${newTotal - oldTotal}）`);
}

main();
