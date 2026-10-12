"""绕开 pip 的解压临时目录，直接从 PyPI 取 wheel 并解压到工作区。

pip 在本沙箱里下载正常、但解压阶段会被拒（Permission denied），
所以这里用 urllib 下载 + zipfile 本地解压；证书用 pip 自带的 certifi。
"""
import io
import json
import os
import ssl
import sys
import urllib.request
import zipfile

for _s in (sys.stdout, sys.stderr):
    try:
        _s.reconfigure(encoding="utf-8", errors="replace")
    except Exception:
        pass

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))  # jojo/
WORK = os.path.join(ROOT, ".piptmp")
TARGET = os.path.join(ROOT, ".fonttools")

try:
    from pip._vendor import certifi
    CA = certifi.where()
except Exception:
    CA = None
CTX = ssl.create_default_context(cafile=CA) if CA else ssl.create_default_context()

PACKAGES = [
    ("fonttools", r"-py3-none-any\.whl$"),
    ("brotli", r"cp313-cp313-win_amd64\.whl$"),
]


def pick_file(pkg, pattern):
    import re
    url = f"https://pypi.org/pypi/{pkg}/json"
    with urllib.request.urlopen(url, timeout=60, context=CTX) as response:
        data = json.load(response)
    files = [f for f in data["urls"] if f["filename"].endswith(".whl")]
    for f in files:
        if re.search(pattern, f["filename"]):
            return f
    if files:
        print(f"  未匹配 {pattern}，改用 {files[0]['filename']}")
        return files[0]
    raise SystemExit(f"{pkg} 没有可用 wheel")


def main():
    os.makedirs(WORK, exist_ok=True)
    os.makedirs(TARGET, exist_ok=True)
    print(f"CA 证书: {CA or '系统默认'}")
    for pkg, pattern in PACKAGES:
        meta = pick_file(pkg, pattern)
        print(f"[{pkg}] {meta['filename']}  ({meta['size']:,} B)")
        with urllib.request.urlopen(meta["url"], timeout=180, context=CTX) as response:
            blob = response.read()
        print(f"  下载 {len(blob):,} B")
        with zipfile.ZipFile(io.BytesIO(blob)) as archive:
            names = archive.namelist()
            archive.extractall(TARGET)
        print(f"  解压 {len(names)} 个条目 -> .fonttools")

    sys.path.insert(0, TARGET)
    import fontTools
    import brotli
    print(f"\n✓ 成功：fontTools {fontTools.version} / brotli {brotli.__version__}")


if __name__ == "__main__":
    main()
