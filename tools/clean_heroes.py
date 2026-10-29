"""Убирает остатки белого/кремового фона у героев: подложку под ногами, просветы между ног и между рукой и телом.

Запуск: python3 tools/clean_heroes.py [папка_с_героями] [--preview папка]
Снимается только светлый ненасыщенный цвет, который снаружи соединён с пустотой вокруг фигуры.
Чёрный контур героя служит стеной: всё, что внутри него (белые кители, кроссовки, животы, глаза), остаётся.
"""
import glob
import os
import sys

import numpy as np
from PIL import Image
from scipy import ndimage

PREVIEW = sys.argv[sys.argv.index('--preview') + 1] if '--preview' in sys.argv else None
args = [a for a in sys.argv[1:] if not a.startswith('--') and a != PREVIEW]
ROOT = args[0] if args else os.path.join(os.path.dirname(__file__), '..', 'game', 'assets', 'heroes', 'looks')


# у чёрного кота кремовая грудка в чёрном меху — со стороны неотличима от окошка фона
POCKET_SKIP = ('c_c',)


def light(rgb, lo=200, sat=40):
    return (rgb.min(2) > lo) & ((rgb.max(2) - rgb.min(2)) < sat)


def clean(arr, name=''):
    rgb = arr[:, :, :3].astype(int)
    a = arr[:, :, 3]
    empty = a < 40
    # чёрный контур героя, чуть утолщённый, чтобы закрыть разрывы — через него фон не «протекает» внутрь фигуры
    dark = (rgb.max(2) < 95) & (a > 100)
    wall = ndimage.binary_dilation(dark, iterations=2)
    bg = light(rgb, 165, 55) & ~empty & ~wall   # белый и кремовый фон (подложка ~ 230,212,190)
    # светлый фон, соединённый с пустотой вокруг фигуры (подложка под ногами, просвет между ног и рук)
    lab, _ = ndimage.label(bg | empty)
    touching = np.unique(lab[empty])
    gone = bg & np.isin(lab, touching[touching > 0])
    # подложка под ногами снимается целиком; отдельные светлые места выше (просвет между рукой и телом)
    # — только если это ровный однотонный фон, а не белый мех, кончик хвоста или пар
    gl, gn = ndimage.label(gone)
    h = gone.shape[0]
    lum = rgb.mean(2)
    for i, (ys, xs) in enumerate(ndimage.find_objects(gl)):
        if ys.stop >= int(h * 0.88):
            continue
        m = gl[ys, xs] == i + 1
        v = lum[ys, xs][m]
        if v.std() > 7 or v.mean() < 215 or m.sum() < 0.001 * gone.size:   # мелочь вроде пара не трогаем
            gone[ys, xs][m] = False
    # кусочки подложки, прижатые к контуру (их закрыла утолщённая стена) — снять, если рядом уже снятый фон
    near = ndimage.binary_dilation(gone, iterations=3) & light(rgb, 160, 60) & ~dark & ~empty
    gone |= near
    # замкнутые «окошки» фона внутри фигуры (между рукой и телом, вокруг бутылей): светлое пятно,
    # почти со всех сторон обведённое чёрным контуром. Белый мех, китель, кроссовки граничат с цветными тенями — их не трогаем
    pk = light(rgb, 215, 35) & ~empty & ~gone
    pl, pn = ndimage.label(pk)
    hh, ww = pk.shape
    for i in range(pn):
        c = pl == i + 1
        if c.sum() < 0.0008 * hh * ww:
            continue
        ring = ndimage.binary_dilation(c, iterations=3) & ~ndimage.binary_dilation(c, iterations=1)
        px = rgb[c]
        warm = 9 <= np.median(px[:, 0] - px[:, 2]) <= 26      # фон кремовый (≈252,247,235); одежда — чисто-белая или голубоватая
        if dark[ring].mean() > 0.7 and warm and px.mean(1).std() < 7.5 and not name.startswith(POCKET_SKIP):
            gone |= c
    out = arr.copy()
    out[gone, 3] = 0
    edge = ndimage.binary_dilation(gone, iterations=1) & ~gone
    out[edge, 3] = (out[edge, 3] * 0.7).astype(np.uint8)
    return out, gone


def main():
    files = sorted(glob.glob(os.path.join(ROOT, '**', '*.webp'), recursive=True))
    changed = 0
    tiles = []
    for f in files:
        arr = np.array(Image.open(f).convert('RGBA'))
        out, gone = clean(arr, os.path.basename(f))
        if gone.sum() < 30:
            continue
        changed += 1
        if PREVIEW:
            show = arr.copy(); show[gone] = [255, 0, 0, 255]
            tiles.append((os.path.basename(f), Image.fromarray(show)))
        else:
            Image.fromarray(out).save(f, 'WEBP', quality=88, method=6)
    print(f'героев: {len(files)}, почищено: {changed}')
    if PREVIEW:
        W, H, cols = 160, 200, 10
        rows = (len(tiles) + cols - 1) // cols
        for part in range(0, rows, 4):
            sub = tiles[part * cols:(part + 4) * cols]
            s = Image.new('RGBA', (cols * W, 4 * H), (60, 60, 60, 255))
            for k, (n, im) in enumerate(sub):
                im.thumbnail((W, H)); s.alpha_composite(im, ((k % cols) * W, (k // cols) * H))
            s.save(os.path.join(PREVIEW, f'clean_{part // 4}.png'))


if __name__ == '__main__':
    main()
