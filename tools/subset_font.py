#!/usr/bin/env python3
"""
字体子集化：得意黑整包 5.8MB -> 只保留游戏真正用到的字符 -> WOFF2

用法: py -3.13 tools/subset_font.py

字符来源是「自动扫描」而不是手写清单：
  - index.html、src 下的所有 .js / .css（含注释与模板字符串里的中文）
  - EXTRA：只在 JS 运行时拼出来、未必出现在源码里的字符（符号、假名、稀有名字等）

所以以后改文案只要重跑本脚本就行，不会再出现「某个字没进子集、浏览器拿别的字体顶上」
导致同一行里有一两个字长得不一样的问题（例如主页的「命运，由你落子。」里的「运」）。

扫描后会逐个核对：源字体里有、文案里用到、但子集漏掉的字符会被直接报出来。
"""
import glob
import os
import sys

# 控制台可能是 GBK 编码，直接 print 特殊字符会 UnicodeEncodeError 崩掉；统一改成 UTF-8 输出
for _stream in (sys.stdout, sys.stderr):
    try:
        _stream.reconfigure(encoding="utf-8", errors="replace")
    except Exception:
        pass

# 允许把 fonttools 装在任意位置并通过环境变量指过来（嵌入式 Python 会忽略 PYTHONPATH）：
#   $env:FONTTOOLS_PATH = "D:\...\libs"; py -3.13 tools/subset_font.py
_extra = os.environ.get("FONTTOOLS_PATH")
if _extra and os.path.isdir(_extra) and _extra not in sys.path:
    sys.path.insert(0, _extra)

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SRC = os.path.join(ROOT, "assets/fonts/SmileySans-Oblique.otf")
OUT = os.path.join(ROOT, "assets/fonts/smiley-subset.woff2")

# 要扫描的文案来源（相对项目根目录）
SCAN = ["index.html", "src/**/*.js", "src/**/*.css"]

# 源码里不一定出现、但运行时会显示出来的字符
EXTRA = set(
    "0123456789/+-×≤·（）【】、。：；！？　 "
    "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz"
    "ＡＢＣＤＥＦＧＨＩＪＫＬＭＮ"
    "オラウドドゴゴズキュゥンエメラルドスプラッシュクロスファイア"
    "無駄時止世界白金之星法皇魔術師紅緑空条承太郎花京院典明穆罕默德阿布徳爾"
    "⬡◆▸▲■✦⇄→↗"
)


def collect_chars():
    """扫描文案来源，返回 (用到的字符集合, 扫描过的文件数)。"""
    chars, files = set(), 0
    for pattern in SCAN:
        for path in glob.glob(os.path.join(ROOT, pattern), recursive=True):
            with open(path, encoding="utf-8") as fh:
                chars |= set(fh.read())
            files += 1
    return chars, files


def main():
    if not os.path.exists(SRC):
        print("缺少源字体:", SRC)
        sys.exit(1)
    try:
        from fontTools import subset
        from fontTools.ttLib import TTFont
    except ImportError:
        print("需要 fonttools: pip3 install --break-system-packages fonttools brotli")
        sys.exit(1)

    used, files = collect_chars()
    chars = used | EXTRA
    # 空白交给 subsetter 自己处理，只保留可打印字符
    text = "".join(sorted(c for c in chars if c.isprintable() and not c.isspace())) + " "
    print(f"扫描 {files} 个文件，得到 {len(chars)} 个字符，子集文本长度 {len(text)}")

    subset.main([
        SRC,
        f"--text={text}",
        "--flavor=woff2",
        "--layout-features=*",
        "--no-hinting",
        "--desubroutinize",
        f"--output-file={OUT}",
    ])

    # 核对：源字体支持的字符里，凡是文案用到的，子集都必须有
    source_cmap = set(TTFont(SRC).getBestCmap().keys())
    subset_cmap = set(TTFont(OUT).getBestCmap().keys())
    missing = sorted(c for c in chars
                     if not c.isspace() and ord(c) in source_cmap and ord(c) not in subset_cmap)

    for f in (SRC, OUT):
        if os.path.exists(f):
            print(f"  {os.path.getsize(f):>9,} B  {os.path.relpath(f, ROOT)}")

    # 顺便报一下「文案里用到、但字体本身就没有」的字符（一般是 emoji，会走系统字体）
    unsupported = sorted(c for c in chars if not c.isspace() and c.isprintable() and ord(c) not in source_cmap)
    if unsupported:
        print(f"  字体本身没有的字符 {len(unsupported)} 个（交给系统字体渲染）：{''.join(unsupported)}")

    if missing:
        print(f"✗ 子集缺字 {len(missing)} 个：{''.join(missing)}")
        sys.exit(1)
    print("✓ 核对通过：文案里用到的字符，只要字体支持，就都在子集里（不会再出现字体混用）")


if __name__ == "__main__":
    main()
