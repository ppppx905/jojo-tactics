"""Reproducible crops. Source sheets remain intact; shipped assets are small WebP files."""
from pathlib import Path
import json
from PIL import Image, ImageFilter
from slice import chroma_key

ROOT = Path(__file__).resolve().parent.parent
NAMES = ['jotaro', 'dio', 'kakyoin', 'avdol']
PIECES = ['jotaro', 'star_platinum', 'dio', 'the_world', 'kakyoin', 'hierophant', 'avdol', 'magicians_red']

def split_quads(source, category, gutter=0):
    image = Image.open(ROOT / source).convert('RGB')
    w, h = image.size
    dest = ROOT / 'assets/out' / category
    dest.mkdir(parents=True, exist_ok=True)
    for i, name in enumerate(NAMES):
        x, y = (i % 2) * w // 2, (i // 2) * h // 2
        tile = image.crop((x + gutter, y + gutter, x + w // 2 - gutter, y + h // 2 - gutter))
        tile.thumbnail((768, 512), Image.Resampling.LANCZOS)
        tile.save(dest / f'{name}.webp', quality=91, method=6)

split_quads('assets/src/portraits-v2.png', 'portraits')
split_quads('assets/src/cutins-v1.png', 'cutins', 3)

source = ROOT / 'assets/src/standees-v3-blue.png'
if source.exists():
    image = Image.open(source).convert('RGBA')
    w, h = image.size
    dest = ROOT / 'assets/out/standees'
    dest.mkdir(parents=True, exist_ok=True)
    metadata = {}
    contact = Image.new('RGB', (800, 420), '#181323')
    for i, name in enumerate(PIECES):
        x, y = (i % 4) * w // 4, (i // 4) * h // 2
        cell = image.crop((x + 3, y + 3, x + w // 4 - 3, y + h // 2 - 3))
        cell = chroma_key(cell, key=(0, 0, 255), channel='r', tol=.42, erode=0, feather=.25)
        bbox = cell.getchannel('A').point(lambda x: 255 if x > 30 else 0).getbbox()
        if not bbox:
            raise ValueError(f'Empty character: {name}')
        cell = cell.crop(bbox)
        cell.thumbnail((184, 284), Image.Resampling.LANCZOS)
        canvas = Image.new('RGBA', (192, 288))
        canvas.alpha_composite(cell, ((192 - cell.width) // 2, 284 - cell.height))
        canvas.save(dest / f'{name}.webp', quality=94, method=6)
        metadata[name] = {'width': 192, 'height': 288, 'source_box': [x, y, x + w // 4, y + h // 2]}
        preview = canvas.copy()
        preview.thumbnail((120, 180), Image.Resampling.LANCZOS)
        contact.paste(preview, ((i % 4) * 200 + 40, (i // 4) * 210 + 15), preview)
    (dest / 'manifest.json').write_text(json.dumps(metadata, indent=2) + '\n')
    contact.save(dest / 'contact.png')
print('Prepared portraits, cut-ins and available standees.')
