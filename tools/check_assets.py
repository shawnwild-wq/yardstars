"""Проверка картинок игры: ищет обрезанные предметы и прилипшие кусочки соседних картинок.

Запуск: python3 tools/check_assets.py [папка_assets] [--fix]
Код выхода 1 и список файлов, если что-то не так.
--fix — вырезать найденные кусочки соседних картинок прямо в файлах (обрезы и «два предмета» чинятся вручную).

Что считается ошибкой:
  1. «Обрезано» — предмет упирается в край картинки или у него ровный срез без чёрного контура
     (так выглядит место, где нож нарезки прошёл через предмет: диван, хлеб, паэлья 29.10).
  2. «Кусочек соседа» — у края картинки есть отдельный небольшой кусок, не связанный с главным предметом.
  3. «Два предмета» — в одной картинке два крупных предмета (столик и торшер 29.10).
Фоны (комната, места улицы) и портреты (лица героев, аватарки) не проверяются: они по задумке во весь кадр.
"""
import glob
import os
import sys

import numpy as np
from PIL import Image
from scipy import ndimage

FIX = '--fix' in sys.argv
ARGS = [x for x in sys.argv[1:] if x != '--fix']
ROOT = ARGS[0] if ARGS else os.path.join(os.path.dirname(__file__), '..', 'game', 'assets')
SKIP_DIRS = {'avatars'}
BACKGROUNDS = {'room/base0', 'room/base1', 'place/home', 'place/yard', 'place/sport', 'place/cafe', 'place/park', 'place/market'}
EDGE_SHARE = 0.10      # доля края, занятая непрозрачными пикселями, после которой предмет считается обрезанным
EDGE_PIXELS = 30       # и минимум пикселей подряд по краю
CUT_SHARE = 0.70       # доля высоты/ширины предмета, срезанная ровной светлой линией без контура
MULTI_OK = {'room/pictures', 'place/p_lamp', 'place/c_lights'}   # здесь несколько предметов — так задумано


def name_of(path):
    return os.path.relpath(path, ROOT).replace(os.sep, '/')[:-5]


def straight_cut(arr, a):
    """доля строк (столбцов), где предмет кончается в одной и той же точке светлым пикселем — ровный срез без контура"""
    lum = arr[:, :, :3].max(2)
    res = {}
    for side in ('слева', 'справа', 'сверху', 'снизу'):
        A, L = (a, lum) if side in ('слева', 'справа') else (a.T, lum.T)
        if side in ('справа', 'снизу'):
            A, L = A[:, ::-1], L[:, ::-1]
        rows = np.where(A.any(1))[0]
        first = A[rows].argmax(1)
        e = first.min()
        inner = L[rows, np.minimum(first + 1, A.shape[1] - 1)]
        res[side] = float(np.mean((first <= e + 1) & (inner > 110)))
    return res


def fragments(arr, a):
    """маски кусочков соседних картинок: небольшой отдельный кусок у края, срезанный ровной линией со стороны края"""
    lab, k = ndimage.label(a, structure=np.ones((3, 3)))
    if k < 2:
        return []
    sizes = ndimage.sum(a, lab, range(1, k + 1))
    objs = ndimage.find_objects(lab)
    mi = int(np.argmax(sizes))
    h, w = a.shape
    m = max(12, int(0.14 * max(h, w)))   # «у края» — ближе 14% размера картинки (нарезка оставляет поля)
    out = []
    for i, (y, x) in enumerate(objs):
        s = sizes[i]
        if i == mi or s < 0.002 * sizes[mi] or s > 0.35 * sizes[mi]:
            continue
        sides = {'слева': x.start, 'справа': w - x.stop, 'сверху': y.start, 'снизу': h - y.stop}
        side = min(sides, key=sides.get)
        if sides[side] > m:
            continue
        piece = lab[y, x] == i + 1
        rgb = arr[y, x, :3][piece]
        if (rgb.max(1) < 70).mean() < 0.03:
            continue   # без чёрного контура — это дымок или пар, часть рисунка, а не кусок соседа
        if straight_cut(arr[y, x], piece)[side] > 0.35:
            out.append(lab == i + 1)
    return out


def check(name, path):
    im = Image.open(path).convert('RGBA')
    arr = np.array(im).astype(int)
    a = arr[:, :, 3] > 40
    if not a.any():
        return ['пустая картинка']
    problems = []
    for side, line in (('слева', a[:, 0]), ('справа', a[:, -1]), ('сверху', a[0, :]), ('снизу', a[-1, :])):
        if line.mean() > EDGE_SHARE and line.sum() > EDGE_PIXELS:
            problems.append('обрезано ' + side)
    for side, v in straight_cut(arr, a).items():
        if v > CUT_SHARE:
            problems.append('ровный срез ' + side)
    if name not in MULTI_OK:
        fr = fragments(arr, a)
        if fr:
            problems.append('кусочек соседней картинки у края')
            if FIX:
                keep = np.array(im)
                for f in fr:
                    keep[ndimage.binary_dilation(f, iterations=2), 3] = 0
                Image.fromarray(keep).save(path, 'WEBP', quality=88, method=6)
                problems[-1] += ' — вырезан'
        core = ndimage.binary_erosion(arr[:, :, 3] > 200, iterations=3)
        cl, ck = ndimage.label(core)
        if ck > 1:
            cs = sorted(ndimage.sum(core, cl, range(1, ck + 1)), reverse=True)
            if cs[1] > 0.3 * cs[0]:
                problems.append('два предмета в одной картинке')
    return problems


def main():
    bad = []
    files = sorted(glob.glob(os.path.join(ROOT, '**', '*.webp'), recursive=True))
    for f in files:
        n = name_of(f)
        if n.split('/')[0] in SKIP_DIRS or n in BACKGROUNDS or n.endswith('_face'):
            continue
        p = check(n, f)
        if p:
            bad.append(f'{n}: {", ".join(p)}')
    print(f'картинок проверено: {len(files)}, с ошибками: {len(bad)}')
    for b in bad:
        print('  ✗ ' + b)
    sys.exit(1 if bad else 0)


if __name__ == '__main__':
    main()
