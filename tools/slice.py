#!/usr/bin/env python3
"""
jojo战棋 · 原子化切图管线

设计原则：生图只负责「造型 + 固有明暗」，本脚本负责把它切成
可被程序绑定状态的原子素材（trim / 居中 / 统一留白 / 1x+2x / 雪碧图 / 清单）。

用法:
    python3 tools/slice.py tools/sheets.json            # 全部
    python3 tools/slice.py tools/sheets.json A_terrain  # 只跑某一张

支持两种切分模式:
  grid  按网格切，每个 cell 一个素材
  items 按「连通块」自动识别并编号，适合模型自由排版的图

关键处理:
  1. alpha 归一化   —— 生图常见 max alpha = 253 而非 255，不归一化会整体发灰
  2. trim           —— 裁掉透明边
  3. 居中 + 统一留白 —— 保证同批素材视觉大小一致
  4. 缩小用 LANCZOS + 轻锐化，抵消缩放糊化
"""
import json
import math
import os
import sys
from PIL import Image, ImageFilter

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))


# ---------------------------------------------------------------- 基础工具

def load_rgba(path):
    if not os.path.exists(path):
        raise FileNotFoundError(path)
    return Image.open(path).convert("RGBA")


def normalize_alpha(im):
    """把 alpha 拉到满量程。生图输出的 max alpha 常是 250~253，会整体发灰。"""
    a = im.getchannel("A")
    lo, hi = a.getextrema()
    if hi == 0:
        return im
    if hi < 255:
        a = a.point(lambda v: min(255, round(v * 255.0 / hi)))
        im = im.copy()
        im.putalpha(a)
    return im


def alpha_bbox(im, thresh=8):
    """返回非透明区域的包围盒。"""
    a = im.getchannel("A").point(lambda v: 255 if v > thresh else 0)
    return a.getbbox()


def chroma_key(im, key=(255, 0, 255), soft=0.55, erode=1, feather=0.8, tol=0.50, channel=None):
    """
    色键抠图 —— 从画布边缘 flood fill，而不是全局按色阈值。

    为什么必须 flood fill（踩过的坑）：
      「黑色描边 × 键控色」的混合像素（如洋红混黑 → (125,1,125)）与「键控色本身」
      在 RGB 上几乎不可区分（两者 g 通道都≈0）。全局阈值会把描边判成背景，
      于是背景从描边渗进角色内部，把整个角色挖空成白块。
      正确做法：只有与画布边缘连通的键控色才算背景；角色内部的相近色一律保护。

    channel：用于估计混合比例的通道，必须是键控色里为 0 的那个通道。
      洋红/绿幕 → 'g'（洋红 g=0、绿幕 r=b=0，取 g 均可）
      蓝幕     → 'r'（蓝幕 r=0，且这批角色的黑/白/金/紫/绿/橙里 r 都偏高，最安全）
    """
    im = im.convert("RGBA")
    w, h = im.size
    px = im.load()
    kr, kg, kb = key
    if channel is None:
        # 自动挑一个键控色里最小的通道来估算
        channel = "rgb"[min(range(3), key=lambda i: key[i])]
    ci = "rgb".index(channel)

    def is_key(p):
        return max(abs(p[0] - kr), abs(p[1] - kg), abs(p[2] - kb)) / 255.0 <= tol

    # 从四条边 flood fill，求「与画布边缘连通的外部背景」
    seen = bytearray(w * h)
    stack = []
    for x in range(w):
        stack.append((x, 0))
        stack.append((x, h - 1))
    for y in range(h):
        stack.append((0, y))
        stack.append((w - 1, y))

    bg = 0
    edge = []
    while stack:
        x, y = stack.pop()
        i = y * w + x
        if seen[i]:
            continue
        seen[i] = 1
        p = px[x, y]
        if not is_key(p):
            edge.append((x, y))          # 背景边界上的实体像素，稍后反混合
            continue
        bg += 1
        px[x, y] = (p[0], p[1], p[2], 0)
        if x > 0:
            stack.append((x - 1, y))
        if x < w - 1:
            stack.append((x + 1, y))
        if y > 0:
            stack.append((x, y - 1))
        if y < h - 1:
            stack.append((x, y + 1))

    # 边界像素：按指定通道估计混入比例并反混合，去掉轮廓上的键控色污染
    for (x, y) in edge:
        r, g, b, a = px[x, y]
        a_est = min(1.0, (r, g, b)[ci] / 255.0)
        if a_est <= 0.05:
            px[x, y] = (r, g, b, 0)
            continue
        out = [r, g, b]
        for j in range(3):
            if j == ci:
                continue
            out[j] = min(255, max(0, round((out[j] - key[j] * (1 - a_est)) / a_est)))
        px[x, y] = (out[0], out[1], out[2], round(a * a_est))

    # 第二遍：连通块补漏。
    # 生图会在角色内部留下「被墨线围死的键控色洞」（外套后、头发后等），
    # 从画布边缘 flood fill 永远到不了。这里对键控色整体做连通块分析：
    # 凡是「本身是键控色」的连通块一律抠掉 —— 因为键控色是纯蓝/纯洋红，
    # 与角色自身配色（紫/金/绿/橙/黑/白）的最大通道差远超 tol，不会误伤。
    mask = bytearray(w * h)
    for y in range(h):
        for x in range(w):
            if px[x, y][3] > 0 and is_key(px[x, y]):
                mask[y * w + x] = 1

    visited = bytearray(w * h)
    holes = 0
    for sy in range(h):
        for sx in range(w):
            si = sy * w + sx
            if not mask[si] or visited[si]:
                continue
            comp = []
            stack2 = [(sx, sy)]
            visited[si] = 1
            while stack2:
                x, y = stack2.pop()
                comp.append((x, y))
                for nx, ny in ((x + 1, y), (x - 1, y), (x, y + 1), (x, y - 1)):
                    if 0 <= nx < w and 0 <= ny < h:
                        ni = ny * w + nx
                        if mask[ni] and not visited[ni]:
                            visited[ni] = 1
                            stack2.append((nx, ny))
            if len(comp) < 24:          # 太小的是噪点，不动
                continue
            holes += 1
            for (x, y) in comp:
                r, g, b, _a = px[x, y]
                a_est = min(1.0, (r, g, b)[ci] / 255.0)
                if a_est <= 0.05:
                    px[x, y] = (r, g, b, 0)
                else:
                    out = [r, g, b]
                    for j in range(3):
                        if j != ci:
                            out[j] = min(255, max(0, round((out[j] - key[j] * (1 - a_est)) / a_est)))
                    px[x, y] = (out[0], out[1], out[2], round(255 * a_est))

    if erode > 0:
        im.putalpha(im.getchannel("A").filter(ImageFilter.MinFilter(erode * 2 + 1)))
    if feather > 0:
        im.putalpha(im.getchannel("A").filter(ImageFilter.GaussianBlur(feather)))
    return im


def contact_sheet(sprites, hexsize=44, bg="#221C36", path=None):
    """
    把素材按「棋盘上的真实观感」拼成对照图：
    每个素材画在一枚深色六边形上 —— 这是唯一能判断"小尺寸下是否可读"的办法。
    """
    from PIL import ImageDraw

    def hexagon(cx, cy, r):
        pts = []
        for i in range(6):
            a = math.pi / 180 * (60 * i - 30)
            pts.append((cx + r * math.cos(a), cy + r * math.sin(a)))
        return pts

    cell = hexsize * 3
    cols = min(4, len(sprites))
    rows = math.ceil(len(sprites) / cols)
    sheet = Image.new("RGB", (cell * cols, cell * rows), "#0C0916")
    d = ImageDraw.Draw(sheet)
    for i, (name, im) in enumerate(sprites):
        cx = (i % cols) * cell + cell // 2
        cy = (i // cols) * cell + cell // 2
        d.polygon(hexagon(cx, cy, hexsize), fill=bg, outline="#6B5A9E")
        side = int(hexsize * 1.5)
        thumb = im.resize((side, side), Image.LANCZOS)
        sheet.paste(thumb, (cx - side // 2, cy - side // 2), thumb)
    if path:
        sheet.save(path)
    return sheet


def mirror_tile(im):
    """镜像成 2x2 再交给平铺使用：边缘严格自洽，从数学上保证无缝。"""
    w, h = im.size
    out = Image.new(im.mode, (w * 2, h * 2))
    out.paste(im, (0, 0))
    out.paste(im.transpose(Image.FLIP_LEFT_RIGHT), (w, 0))
    out.paste(im.transpose(Image.FLIP_TOP_BOTTOM), (0, h))
    out.paste(im.transpose(Image.ROTATE_180), (w, h))
    return out


def trim_and_fit(im, out_size, pad=0.08, seamless=False):
    """
    裁掉透明边 -> 按内容比例缩放 -> 居中放进正方形画布，四周留 pad 比例的空白。
    seamless=True 时走另一条路：直接缩放到目标尺寸、不 trim 不居中，
    保留原图满幅覆盖（纹理类素材需要边缘相接才能平铺）。
    """
    im = normalize_alpha(im)
    if seamless:
        return mirror_tile(im).resize((out_size, out_size), Image.LANCZOS)
    bb = alpha_bbox(im)
    if bb is None:
        return None
    im = im.crop(bb)
    w, h = im.size
    inner = max(1, int(out_size * (1 - 2 * pad)))
    scale = min(inner / w, inner / h)
    nw, nh = max(1, round(w * scale)), max(1, round(h * scale))
    # 分步缩小比一步到位更锐利
    while im.width > nw * 2:
        im = im.resize((im.width // 2, im.height // 2), Image.LANCZOS)
    im = im.resize((nw, nh), Image.LANCZOS)
    im = im.filter(ImageFilter.UnsharpMask(radius=1.0, percent=55, threshold=2))
    canvas = Image.new("RGBA", (out_size, out_size), (0, 0, 0, 0))
    canvas.paste(im, ((out_size - nw) // 2, (out_size - nh) // 2), im)
    return canvas


def erode_alpha(im, px=1):
    """轻微收缩 alpha，去掉生图边缘常见的半透明脏边。"""
    a = im.getchannel("A").filter(ImageFilter.MinFilter(px * 2 + 1))
    im = im.copy()
    im.putalpha(a)
    return im


# ---------------------------------------------------------------- 切分

def tone_down(im, flatten=0.0, desat=0.0, posterize=0, smooth=0.0):
    """
    降低对比 / 去饱和 / 向中灰压平 / 色阶量化。
    flatten:  向 128 中灰压平的比例 0~1
    desat:    去饱和比例 0~1
    posterize:保留的每通道位数（5 = 量化到 32 级）
    smooth:   高斯模糊半径，抹掉单像素噪点

    设计说明：纹理类素材作为叠加层时只需极弱信号，原图的高对比不但浪费体积
    还会盖过界面本身。而且单像素随机噪点是 PNG 的天敌（几乎不可压缩），
    轻微模糊 + 量化能把体积砍掉一个数量级，视觉上肉眼不可辨。
    """
    if flatten <= 0 and desat <= 0 and posterize <= 0 and smooth <= 0:
        return im
    from PIL import ImageEnhance
    rgb = im.convert("RGB")
    if desat > 0:
        rgb = ImageEnhance.Color(rgb).enhance(1 - desat)
    if flatten > 0:
        rgb = Image.blend(rgb, Image.new("RGB", rgb.size, (128, 128, 128)), flatten)
    if smooth > 0:
        rgb = rgb.filter(ImageFilter.GaussianBlur(smooth))
    if posterize > 0:
        levels = 2 ** posterize
        rgb = rgb.point(lambda v: round(v * (levels - 1) / 255) * 255 // (levels - 1))
    rgb = rgb.convert("RGBA")
    rgb.putalpha(im.getchannel("A"))
    return rgb


def split_grid(im, cols, rows, margin=0):
    """按网格切分。margin 是每个 cell 四周额外内缩的像素，防止串味。"""
    W, H = im.size
    cw, ch = W // cols, H // rows
    out = []
    for r in range(rows):
        for c in range(cols):
            x0, y0 = c * cw + margin, r * ch + margin
            x1, y1 = (c + 1) * cw - margin, (r + 1) * ch - margin
            out.append(((r, c), im.crop((x0, y0, x1, y1))))
    return out


def split_items(im, bg_thresh=10, feather=True):
    """
    按连通块自动识别素材。生图常常不严格按网格摆，这个模式更稳。
    返回 [(index, 子图), ...]，按「从左到右、从上到下」排序。
    """
    W, H = im.size
    a = im.getchannel("A").point(lambda v: 255 if v > bg_thresh else 0)
    mask = a.load()
    seen = [[False] * W for _ in range(H)]
    comps = []

    for sy in range(H):
        for sx in range(W):
            if seen[sy][sx] or mask[sx, sy] == 0:
                continue
            # 迭代式 flood fill（4 邻接），避免递归爆栈
            stack = [(sx, sy)]
            seen[sy][sx] = True
            minx, maxx, miny, maxy, n = sx, sx, sy, sy, 0
            while stack:
                x, y = stack.pop()
                n += 1
                if x < minx: minx = x
                if x > maxx: maxx = x
                if y < miny: miny = y
                if y > maxy: maxy = y
                for nx, ny in ((x + 1, y), (x - 1, y), (x, y + 1), (x, y - 1)):
                    if 0 <= nx < W and 0 <= ny < H and not seen[ny][nx] and mask[nx, ny]:
                        seen[ny][nx] = True
                        stack.append((nx, ny))
            comps.append((minx, miny, maxx, maxy, n))

    # 过滤碎片
    if not comps:
        return []
    big = max(c[4] for c in comps)
    comps = [c for c in comps if c[4] >= max(64, big * 0.02)]

    # 排序：先按行分带，再按列。容忍同一行的 y 抖动。
    comps.sort(key=lambda c: c[1])
    rows, cur = [], [comps[0]]
    for c in comps[1:]:
        ref = cur[0]
        if abs(c[1] - ref[1]) < (ref[3] - ref[1]) * 0.6:
            cur.append(c)
        else:
            rows.append(cur)
            cur = [c]
    rows.append(cur)

    out, idx = [], 0
    for row in rows:
        row.sort(key=lambda c: c[0])
        for (minx, miny, maxx, maxy, _n) in row:
            sub = im.crop((minx, miny, maxx + 1, maxy + 1))
            if feather:
                sub = erode_alpha(sub, 1)
            out.append((idx, sub))
            idx += 1
    return out


# ---------------------------------------------------------------- 输出

def make_sheet(images, out_path, pad=4):
    """把若干同尺寸素材横向拼成雪碧图 + 清单。"""
    if not images:
        return None
    n = len(images)
    w, h = images[0].size
    sheet = Image.new("RGBA", (w * n + pad * (n - 1), h), (0, 0, 0, 0))
    frames = []
    for i, im in enumerate(images):
        x = i * (w + pad)
        sheet.paste(im, (x, 0), im)
        frames.append({"name": i, "x": x, "y": 0, "w": w, "h": h})
    sheet.save(out_path)
    meta = {"image": os.path.basename(out_path), "size": [w, h], "count": n, "frames": frames}
    with open(os.path.splitext(out_path)[0] + ".json", "w", encoding="utf-8") as f:
        json.dump(meta, f, ensure_ascii=False, indent=2)
    return meta


def run_entry(entry, only=None):
    name = entry["name"]
    if only and only != name:
        return None
    src = os.path.join(ROOT, entry["src"])
    out_dir = os.path.join(ROOT, entry.get("out", "assets/out"), name)
    os.makedirs(out_dir, exist_ok=True)
    im = load_rgba(src)

    # 色键：生图给洋红底时必须先抠图，否则切出来全是紫红方块
    if entry.get("key"):
        k = entry["key"]
        im = chroma_key(im, tuple(k.get("color", [255, 0, 255])),
                        k.get("soft", 0.55), k.get("erode", 1), k.get("feather", 0.8), k.get("tol", 0.50), k.get("channel"))
        print("  · 已执行色键并去除边缘洋红污染")

    if entry.get("mode", "grid") == "grid":
        cols, rows = entry["cols"], entry["rows"]
        cells = split_grid(im, cols, rows, entry.get("margin", 0))
        labels = entry["names"]
        assert len(labels) == cols * rows, f"{name}: names 数量 {len(labels)} 与 {cols}x{rows} 不符"
        pairs = list(zip(labels, [c[1] for c in cells]))
    elif entry.get("mode") == "boxes":
        # 精确 bbox 模式：用于生图排版不规则、连通块又会粘连的情况。
        # bbox 由量测脚本给出，比猜网格可靠。
        pairs = []
        for cell in entry["boxes"]:
            x0, y0, x1, y1 = cell["box"]
            pairs.append((cell["name"], im.crop((x0, y0, x1, y1))))
        labels = [n for n, _ in pairs]
    else:
        items = split_items(im, entry.get("bg_thresh", 10))
        labels = entry.get("names")
        if labels is None:
            labels = [f"{name}_{i+1:02d}" for i in range(len(items))]
        pairs = list(zip(labels, [c[1] for c in items]))

    size = entry.get("size", 128)
    scale = entry.get("scale", 2)
    flat = entry.get("flatten", 0.0)
    desat = entry.get("desat", 0.0)
    post = entry.get("posterize", 0)
    smooth = entry.get("smooth", 0.0)
    made_2x = []

    for label, sub in pairs:
        sub = tone_down(sub, flat, desat, post, smooth)
        out = trim_and_fit(sub, size * scale, entry.get("pad", 0.08), seamless=entry.get("seamless", False))
        if out is None:
            print(f"  ! {label}: 空白，跳过")
            continue
        out.save(os.path.join(out_dir, f"{label}@{scale}x.png"))
        out.resize((size, size), Image.LANCZOS).save(os.path.join(out_dir, f"{label}@1x.png"))
        made_2x.append(out)
        print(f"  ✓ {label:<22} {size*scale}px / {size}px")

    if made_2x:
        sheet = os.path.join(out_dir, f"_sheet@{scale}x.png")
        make_sheet(made_2x, sheet)
        print(f"  ✓ 雪碧图 {os.path.relpath(sheet, ROOT)}  ({len(made_2x)} 帧)")

        # 对照图：唯一能判断"缩到棋盘实际尺寸后是否还看得清"的办法
        if entry.get("contact"):
            pairs = list(zip(labels, made_2x))
            cp = os.path.join(out_dir, "_contact.png")
            contact_sheet(pairs, entry.get("contactSize", 44), path=cp)
            print(f"  ✓ 实拍对照图 {os.path.relpath(cp, ROOT)}  （按棋盘真实尺寸绘制）")
    return {"name": name, "count": len(made_2x), "dir": os.path.relpath(out_dir, ROOT)}


def main():
    if len(sys.argv) < 2:
        print(__doc__)
        sys.exit(1)
    cfg_path = sys.argv[1]
    only = sys.argv[2] if len(sys.argv) > 2 else None
    with open(cfg_path, encoding="utf-8") as f:
        cfg = json.load(f)

    results = []
    for entry in cfg["sheets"]:
        print(f"[{entry['name']}] {entry['src']}")
        r = run_entry(entry, only)
        if r:
            results.append(r)
    print("\n完成:", json.dumps(results, ensure_ascii=False))


if __name__ == "__main__":
    main()
