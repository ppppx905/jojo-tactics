/**
 * 剧情档案的回归：按漫画话数分章的档案必须章节齐全、话数标注规范、
 * 每章都有实质内容，且渲染出的目录与正文一一对应。
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { STORY, STORY_TITLE, STORY_NOTE, storyHtml, storyPageState, storyStats } from '../src/ui/story.js';

test('剧情档案按话数分章：章节齐全、每章都有话数标注与实质内容', () => {
  const stats = storyStats();
  assert.ok(stats.chapters >= 20, `章节数应 ≥ 20（覆盖整部剧情），实际 ${stats.chapters}`);
  assert.ok(stats.characters >= 2500, `总字数应 ≥ 2500，实际 ${stats.characters}`);

  const ids = new Set(), titles = new Set();
  for (const chapter of STORY) {
    assert.ok(chapter.id && /^[a-z0-9-]+$/.test(chapter.id), `章节 id 不合法：${chapter.id}`);
    assert.ok(!ids.has(chapter.id), `章节 id 重复：${chapter.id}`);
    ids.add(chapter.id);
    assert.ok(chapter.title && chapter.title.length >= 2, `章节标题缺失：${chapter.id}`);
    assert.ok(!titles.has(chapter.title), `章节标题重复：${chapter.title}`);
    titles.add(chapter.title);
    assert.match(chapter.chapters, /^第 \d+–\d+ 话（全 \d+–\d+）$/, `${chapter.title} 的话数标注不规范：${chapter.chapters}`);
    assert.ok(chapter.paragraphs.length >= 2, `${chapter.title} 至少要有两段`);
    for (const text of chapter.paragraphs) {
      assert.ok(typeof text === 'string' && text.trim().length >= 15, `${chapter.title} 有过短的段落：${text}`);
      assert.ok(!/TODO|待补|占位|lorem/i.test(text), `${chapter.title} 残留占位文字`);
    }
  }
});

test('话数标注按第三部顺序连续覆盖，不重叠、不倒退', () => {
  const parse = chapters => chapters.match(/^第 (\d+)–(\d+) 话（全 (\d+)–(\d+)）$/).slice(1).map(Number);
  let previous = 0;
  for (const chapter of STORY) {
    const [from, to, seriesFrom, seriesTo] = parse(chapter.chapters);
    assert.ok(to >= from, `${chapter.title} 的起止话数颠倒`);
    assert.ok(from > previous, `${chapter.title} 的起始话数 ${from} 应晚于上一章结尾 ${previous}`);
    previous = to;
    assert.equal(seriesTo - seriesFrom, to - from, `${chapter.title} 的全系列话数跨度应与第三部话数跨度一致`);
    assert.equal(seriesFrom - from, 113, `${chapter.title} 的全系列话数应比第三部话数大 113`);
  }
  assert.equal(previous, 152, `最后一章应结束在第 152 话，实际 ${previous}`);
  assert.equal(STORY[0].chapters.match(/^第 (\d+)/)[1], '1', '应从第 1 话开始');
});

test('渲染出目录与正文，目录按钮能对应到章节锚点', () => {
  const html = storyHtml();
  assert.ok(html.includes(STORY_NOTE), '应带上「含剧透」说明');
  for (const chapter of STORY) {
    assert.ok(html.includes(`id="story-${chapter.id}"`), `缺少章节锚点：${chapter.id}`);
    assert.ok(html.includes(`data-story-jump="${chapter.id}"`), `目录缺少按钮：${chapter.id}`);
    assert.ok(html.includes(chapter.chapters), `缺少话数标注：${chapter.chapters}`);
    for (const text of chapter.paragraphs) assert.ok(html.includes(text), `缺少段落：${text.slice(0, 10)}…`);
  }
  assert.equal((html.match(/<article /g) || []).length, STORY.length, 'article 数量应与章节数一致');
  assert.equal((html.match(/<\/article>/g) || []).length, STORY.length, 'article 必须闭合');
  assert.equal((html.match(/data-story-jump=/g) || []).length, STORY.length, '目录按钮数应与章节数一致');
});

test('翻页状态：页码夹取、当前位置文案、首末章按钮禁用', () => {
  const total = STORY.length;
  const first = storyPageState(0);
  assert.equal(first.index, 0);
  assert.equal(first.total, total, '总章数应与 STORY 一致');
  assert.equal(first.label, `第 1 / ${total} 章 · ${STORY[0].title}`);
  assert.equal(first.prevDisabled, true, '第 1 章的「上一章」应禁用');
  assert.equal(first.nextDisabled, false, '第 1 章的「下一章」应可点');

  const last = storyPageState(total - 1);
  assert.equal(last.index, total - 1);
  assert.equal(last.label, `第 ${total} / ${total} 章 · ${STORY.at(-1).title}`);
  assert.equal(last.nextDisabled, true, '最后一章的「下一章」应禁用');
  assert.equal(last.prevDisabled, false, '最后一章的「上一章」应可点');

  // 越界与脏输入必须夹回合法范围：连点「下一章」、传 NaN 都不能把界面弄成空白
  assert.equal(storyPageState(-5).index, 0, '负数应夹到第 1 章');
  assert.equal(storyPageState(total + 99).index, total - 1, '超出末尾应夹到最后一章');
  assert.equal(storyPageState(NaN).index, 0, 'NaN 应回到第 1 章');
  assert.equal(storyPageState(undefined).index, 0, 'undefined 应回到第 1 章');
  assert.equal(storyPageState(3.7).index, 3, '小数应取整');

  for (let i = 0; i < total; i++) {
    const state = storyPageState(i);
    assert.equal(state.title, STORY[i].title, `第 ${i + 1} 章的标题对不上`);
    assert.ok(state.label.includes(STORY[i].title), `第 ${i + 1} 章的文案应带标题`);
  }
  // 渲染出来的初始文案必须与纯函数一致，否则界面文案和翻页逻辑会各说各话
  assert.ok(storyHtml().includes(storyPageState(0).label), '初始位置文案应与 storyPageState(0) 一致');
});

test('剧情档案一页一章：默认只露出第 1 章，并带翻页条与当前位置', () => {
  const html = storyHtml();
  // 除当前章以外的章节都必须带 hidden（否则又会变回一长条要一直往下滚）
  assert.equal((html.match(/<article [^>]*hidden/g) || []).length, STORY.length - 1,
    `应只有 1 章可见，实际有 ${(html.match(/<article [^>]*hidden/g) || []).length} 章被隐藏`);
  const firstTag = html.match(/<article [^>]*>/)[0];
  assert.ok(firstTag.includes(`id="story-${STORY[0].id}"`), `第一篇应是第 1 章，实际 ${firstTag}`);
  assert.ok(!firstTag.includes('hidden'), '第一篇不应带 hidden');
  // 翻页条
  assert.ok(html.includes('data-story-page="-1"'), '缺少「上一章」按钮');
  assert.ok(html.includes('data-story-page="1"'), '缺少「下一章」按钮');
  assert.ok(html.includes('data-story-position'), '缺少「第几章」当前位置指示');
  assert.ok(html.includes(`第 1 / ${STORY.length} 章`), '当前位置应显示第 1 章');
  assert.ok(html.includes(`第 1 / ${STORY.length} 章 · ${STORY[0].title}`), '当前位置应带上第 1 章标题');
  // 目录高亮：有且只有当前章一个
  assert.equal((html.match(/is-current/g) || []).length, 1, '有且只有一个目录按钮应标为当前章');
  assert.ok(html.includes(`data-story-jump="${STORY[0].id}" data-story-index="0" class="is-current"`),
    '第 1 章的目录按钮应标为当前章');
  // 每个目录按钮都要带下标，切页才能直接按序号跳
  for (const [index, chapter] of STORY.entries()) {
    assert.ok(html.includes(`data-story-jump="${chapter.id}" data-story-index="${index}"`),
      `${chapter.title} 的目录按钮缺少 data-story-index`);
  }
});

test('剧情档案标注为原创梗概，不是搬运的现成文本', () => {
  assert.match(STORY_TITLE, /剧情档案/);
  assert.match(STORY_NOTE, /原创/);
});
