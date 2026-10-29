"""Cut Canva sheets into separate game images with transparent background.

usage: python3 tools/slice.py <folder with sheets> <game/assets folder>
Sheet files must be named as the keys in SHEETS below (e.g. bakery.png).
"""
import sys, os
import numpy as np
from PIL import Image, ImageFilter
from scipy import ndimage as ndi

S = 256  # icon size
SHEETS = {
    'bakery':  dict(n=5, out=['items/b0', 'items/b1', 'items/b2', 'items/b3', 'items/b4']),
    'dairy':   dict(n=5, out=['items/d0', 'items/d1', 'items/d2', 'items/d3', 'items/d4']),
    'garden':  dict(n=5, out=['items/g0', 'items/g1', 'items/g2', 'items/g3', 'items/g4']),
    'fish':    dict(n=5, out=['items/f0', 'items/f1', 'items/f2', 'items/f3', 'items/f4']),
    'gens':    dict(n=4, out=['gen/b', 'gen/d', 'gen/g', 'gen/f']),
    'special': dict(n=4, out=['sp/chest', 'sp/joker', 'sp/scis', 'sp/coin']),
    'jar':     dict(n=1, out=['sp/jar']),
    'goals1':  dict(n=6, out=['goals/water', 'goals/move', 'goals/sleep', 'goals/walk', 'goals/stretch', 'goals/breath']),
    'goals2':  dict(n=6, out=['goals/veg', 'goals/nophone', 'goals/read', 'goals/steps', 'goals/call', 'goals/tidy']),
    'furniture1': dict(n=5, out=['room/rug', 'room/sofa', 'room/table', 'room/lamp', 'room/shelf'], size=384),
    'furniture2': dict(n=4, out=['room/plant', 'room/pictures', 'room/wardrobe', 'room/lights'], size=384),
    'avatars_m': dict(n=4, out=['avatars/m0', 'avatars/m1', 'avatars/m2', 'avatars/m3']),
    'avatars_f': dict(n=4, out=['avatars/f0', 'avatars/f1', 'avatars/f2', 'avatars/f3']),
    # heroes: every figure becomes heroes/looks/<id>.webp plus a face crop <id>_face.webp (None = skip figure)
    'looks_trainer':    dict(n=3, bodies=['t_a', 't_b', 't_c']),
    'costumes_trainer': dict(n=2, bodies=['t_hero', 't_samurai']),
    # lifter: one sheet per appearance, figures = no gear / «Разрядник» set / «МСМК» set
    'lifter_bb':        dict(n=3, bodies=['l_plain', 'l_novice', 'l_msmk']),
    'lifter_bald':      dict(n=3, bodies=['l_bald', 'l_bald_novice', 'l_bald_msmk']),
    'lifter_hair':      dict(n=3, bodies=['l_hair', 'l_hair_novice', 'l_hair_msmk']),
    'lifter_hairbeard': dict(n=3, bodies=['l_hairbeard', 'l_hairbeard_novice', 'l_hairbeard_msmk']),
    'costumes_lifter':  dict(n=2, bodies=['l_viking', 'l_gold']),
    'looks_office':     dict(n=3, bodies=['o_a', 'o_b', 'o_c']),
    'costumes_office':  dict(n=2, bodies=['o_boss', 'o_astro']),
    'looks_cat':        dict(n=3, bodies=['c_a', 'c_b', 'c_c']),
    'costumes_cat':     dict(n=2, bodies=['c_knight', 'c_pirate']),
    'h_strongman': dict(n=2, bodies=['strongman_a', 'strongman_b']),
    'h_muaythai':  dict(n=2, bodies=['muaythai_a', 'muaythai_b']),
    'h_coachf':    dict(n=2, bodies=['coachf_a', 'coachf_b']),
    'h_student':   dict(n=2, bodies=['student_a', 'student_b']),
    'h_zoomer':    dict(n=2, bodies=['zoomer_a', 'zoomer_b']),
    'h_kid':       dict(n=2, bodies=['kid_a', 'kid_b']),
    'h_chef':      dict(n=2, bodies=['chef_a', 'chef_b']),
    'h_grandma':   dict(n=2, bodies=['grandma_a', 'grandma_b']),
    'h_yoga':      dict(n=2, bodies=['yoga_a', 'yoga_b']),
    'h_dog':       dict(n=2, bodies=[None, 'dog_a']),
    'h_hamster':   dict(n=2, bodies=[None, 'hamster_a']),
    # female versions of heroes: one figure per sheet
    'f_lifter':  dict(n=1, bodies=['lf_f']),
    'f_trainer': dict(n=1, bodies=['tf_f']),
    'f_office':  dict(n=1, bodies=['of_f']),
    # extra appearances: first figure repeats the base and is skipped
    'v_strongman': dict(n=3, bodies=[None, 'strongman_h1', 'strongman_h2']),
    'v_muaythai': dict(n=3, bodies=[None, 'muaythai_h1', 'muaythai_h2']),
    'v_coachf': dict(n=3, bodies=[None, 'coachf_h1', 'coachf_h2']),
    'v_student': dict(n=3, bodies=[None, 'student_h1', 'student_h2']),
    'v_zoomer': dict(n=3, bodies=[None, 'zoomer_h1', 'zoomer_h2']),
    'v_kid': dict(n=3, bodies=[None, 'kid_h1', 'kid_h2']),
    'v_chef': dict(n=3, bodies=[None, 'chef_h1', 'chef_h2']),
    'v_dog': dict(n=3, bodies=[None, 'dog_h1', 'dog_h2']),
    'v_hamster': dict(n=3, bodies=[None, 'hamster_h1', 'hamster_h2']),
    'v_grandma': dict(n=3, bodies=[None, 'grandma_h1', 'grandma_h2']),
    'v_yoga': dict(n=3, bodies=[None, 'yoga_h1', 'yoga_h2']),
    # gear icons
    'gear_lifter1': dict(n=5, out=['gear/lifter_singlet', 'gear/lifter_squatbelt', 'gear/lifter_benchbelt', 'gear/lifter_softwraps', 'gear/lifter_sleeves']),
    'gear_lifter2': dict(n=5, out=['gear/lifter_stiffwraps', 'gear/lifter_kneewraps', 'gear/lifter_elbows', 'gear/lifter_squatshoes', 'gear/lifter_dlshoes']),
    'gear_trainer': dict(n=5, out=['gear/trainer_whistle', 'gear/trainer_stopwatch', 'gear/trainer_dumbbells', 'gear/trainer_bottle', 'gear/trainer_clipboard']),
    'gear_office':  dict(n=5, out=['gear/office_coffee', 'gear/office_laptop', 'gear/office_tie', 'gear/office_planner', 'gear/office_headphones']),
    'gear_cat':     dict(n=5, out=['gear/cat_collar', 'gear/cat_bow', 'gear/cat_yarn', 'gear/cat_catbed', 'gear/cat_toyfish']),
    'gear_lifter_shoes': dict(n=2, out=['gear/lifter_squatshoes', 'gear/lifter_dlshoes']),  # redrawn, overrides the first versions
    'gear_strongman': dict(tol=14, n=5, out=['gear/strongman_stone', 'gear/strongman_kettlebell', 'gear/strongman_belt', 'gear/strongman_chalk', 'gear/strongman_straps']),
    'gear_muaythai': dict(n=5, out=['gear/muaythai_wraps', 'gear/muaythai_prajioud', 'gear/muaythai_gloves', 'gear/muaythai_shorts', 'gear/muaythai_mongkon']),
    'gear_coachf': dict(n=5, out=['gear/coachf_bands', 'gear/coachf_mat', 'gear/coachf_rope', 'gear/coachf_shaker', 'gear/coachf_tracker']),
    'gear_student': dict(n=5, out=['gear/student_backpack', 'gear/student_notes', 'gear/student_coffee', 'gear/student_recbook', 'gear/student_scarf']),
    'gear_zoomer': dict(tol=14, n=5, out=['gear/zoomer_phone', 'gear/zoomer_bubbletea', 'gear/zoomer_skate', 'gear/zoomer_earbuds', 'gear/zoomer_ringlight']),
    'gear_kid': dict(n=5, out=['gear/kid_ball', 'gear/kid_scooter', 'gear/kid_teddy', 'gear/kid_blocks', 'gear/kid_rocket']),
    'gear_chef': dict(n=5, out=['gear/chef_hat', 'gear/chef_pan', 'gear/chef_pin', 'gear/chef_spices', 'gear/chef_knife']),
    'gear_dog': dict(n=5, out=['gear/dog_collar', 'gear/dog_ball', 'gear/dog_bone', 'gear/dog_bowl', 'gear/dog_house']),
    'gear_hamster': dict(n=5, out=['gear/hamster_wheel', 'gear/hamster_seeds', 'gear/hamster_house', 'gear/hamster_bottle', 'gear/hamster_ball']),
    'gear_grandma': dict(n=5, out=['gear/grandma_knit', 'gear/grandma_glasses', 'gear/grandma_pies', 'gear/grandma_scarf', 'gear/grandma_jam']),
    'gear_yoga': dict(n=5, out=['gear/yoga_mat', 'gear/yoga_blocks', 'gear/yoga_strap', 'gear/yoga_incense', 'gear/yoga_bowl']),
    # street: icons of places (one row of 3) and objects of places (2x2 grid, row by row)
    'street1': dict(clean=True, n=3, out=['street/home', 'street/yard', 'street/sport'], size=384),
    'street2': dict(clean=True, n=3, out=['street/cafe', 'street/park', 'street/market'], size=384),
    'yard1':   dict(tight=True, clean=True, grid=2, out=['place/y_bench', 'place/y_sandbox', 'place/y_swing', 'place/y_lamp'], size=384),
    'yard2':   dict(tight=True, clean=True, grid=2, out=['place/y_flowers', 'place/y_slide', 'place/y_tree', 'place/y_fountain'], size=384),
    'sport1':  dict(tight=True, clean=True, grid=2, out=['place/s_pullup', 'place/s_rack', 'place/s_bench', 'place/s_kettle'], size=384),
    'sport2':  dict(tight=True, clean=True, grid=2, out=['place/s_tire', 'place/s_bag', 'place/s_mats', 'place/s_board'], size=384),
    'cafe1':   dict(tight=True, clean=True, grid=2, out=['place/c_table', 'place/c_plants', 'place/c_counter', 'place/c_coffee'], size=384),
    'cafe2':   dict(tight=True, clean=True, grid=2, out=['place/c_showcase', 'place/c_oven', 'place/c_sign', 'place/c_lights'], size=384),
    'park1':   dict(tight=True, clean=True, grid=2, out=['place/p_bench', 'place/p_flowers', 'place/p_lamp', 'place/p_pond'], size=384),
    'park2':   dict(tight=True, clean=True, grid=2, out=['place/p_bridge', 'place/p_yoga', 'place/p_gazebo', 'place/p_statue'], size=384),
    'market1': dict(tight=True, clean=True, grid=2, out=['place/m_veg', 'place/m_fruit', 'place/m_bread', 'place/m_milk'], size=384),
    'market2': dict(tight=True, clean=True, grid=2, out=['place/m_fish', 'place/m_flowers', 'place/m_scale', 'place/m_arch'], size=384),
    'bg_yard':   dict(bg='place/yard'),
    'bg_sport':  dict(bg='place/sport'),
    'bg_cafe':   dict(bg='place/cafe'),
    'bg_park':   dict(bg='place/park'),
    'bg_market': dict(bg='place/market'),
    # 29.10: new merge lines (Сад, Гриль, new levels) and signature dishes, 2x2 sheets in the hero style
    'food1': dict(grid=2, out=['food/pie_fest', 'food/cream', 'food/cheese_wheel', 'food/crab']),
    'food2': dict(grid=2, out=['food/salmon', 'food/tuna', 'food/cabbage', 'food/pumpkin']),
    'food3': dict(grid=2, out=['food/harvest', 'food/blueberry', 'food/strawberry', 'food/banana']),
    'food4': dict(grid=2, out=['food/mango', 'food/watermelon', 'food/sausage', 'food/cutlet']),
    'food5': dict(grid=2, out=['food/drumstick', 'food/kebab', 'food/tomahawk', 'gen/s']),
    'food6': dict(grid=2, out=['gen/m', 'dish/trainer', 'dish/lifter', 'dish/office']),
    'food7': dict(grid=2, out=['dish/cat', 'dish/dog', 'dish/hamster', 'dish/chef']),
    'food8': dict(grid=2, out=['dish/grandma', 'dish/yoga', 'dish/kid', 'dish/student']),
    'food9': dict(grid=2, out=['dish/zoomer', 'dish/muaythai', 'dish/strongman', 'dish/coachf']),
    # full backgrounds, no cutting
    'room0': dict(bg='room/base0'),
    'room1': dict(bg='room/base1'),
}


def bg_mask(rgb, tol=38):
    h, w, _ = rgb.shape
    border = np.concatenate([rgb[0], rgb[-1], rgb[:, 0], rgb[:, -1]]).astype(int)
    ref = np.median(border, axis=0)
    near = np.sqrt(((rgb.astype(int) - ref) ** 2).sum(-1)) < tol
    lab, _ = ndi.label(near)
    edge = set(np.unique(np.concatenate([lab[0], lab[-1], lab[:, 0], lab[:, -1]]))) - {0}
    return np.isin(lab, list(edge))


def objects(fg, n):
    """Items stand in one row: cut the row into n slots at the empty column gaps
    closest to an even split, then take the foreground inside each slot."""
    h, w = fg.shape
    cols = fg.sum(0) > 0
    xs = np.where(cols)[0]
    left, right = xs.min(), xs.max() + 1
    empty = ~cols
    cuts = []
    for k in range(1, n):
        ideal = left + (right - left) * k / n
        slot = (right - left) / n
        lo, hi = int(ideal - slot * 0.35), int(ideal + slot * 0.35)
        cand = [x for x in range(max(lo, 0), min(hi, w)) if empty[x]]
        if cand:
            # middle of the empty run closest to the ideal cut
            x = min(cand, key=lambda c: abs(c - ideal))
            a = b = x
            while a > 0 and empty[a - 1]: a -= 1
            while b < w - 1 and empty[b + 1]: b += 1
            cuts.append((a + b) // 2)
        else:
            cuts.append(int(ideal))
    edges = [0] + cuts + [w]
    lab = np.zeros_like(fg, dtype=np.int32)
    boxes = []
    for i in range(n):
        x0, x1 = edges[i], edges[i + 1]
        part = np.zeros_like(fg); part[:, x0:x1] = fg[:, x0:x1]
        ys, xs2 = np.where(part)
        if not len(xs2):
            continue
        lab[part] = i + 1
        boxes.append((xs2.min(), ys.min(), xs2.max() + 1, ys.max() + 1, i + 1))
    return boxes, lab


def grid_objects(fg, g):
    """Objects stand in a g x g grid: cut at the empty row/column nearest each even split."""
    h, w = fg.shape
    def cuts(empty, size):
        out = [0]
        for k in range(1, g):
            ideal = size * k / g
            cand = [x for x in range(int(ideal - size * .2), int(ideal + size * .2)) if empty[x]]
            out.append(min(cand, key=lambda c: abs(c - ideal)) if cand else int(ideal))
        return out + [size]
    ycut = cuts(fg.sum(1) == 0, h)
    lab = np.zeros_like(fg, dtype=np.int32)
    boxes = []
    for r in range(g):
        band = fg[ycut[r]:ycut[r + 1]]
        xcut = cuts(band.sum(0) == 0, w)
        for c in range(g):
            part = np.zeros_like(fg)
            part[ycut[r]:ycut[r + 1], xcut[c]:xcut[c + 1]] = fg[ycut[r]:ycut[r + 1], xcut[c]:xcut[c + 1]]
            ys, xs = np.where(part)
            if not len(xs):
                continue
            i = len(boxes) + 1
            lab[part] = i
            boxes.append((xs.min(), ys.min(), xs.max() + 1, ys.max() + 1, i))
    return boxes, lab


def holes(rgb, fg, tol=16, min_area=40):
    """Background-coloured pockets enclosed by an object (between swing posts, inside a frame)."""
    h, w, _ = rgb.shape
    border = np.concatenate([rgb[0], rgb[-1], rgb[:, 0], rgb[:, -1]]).astype(int)
    ref = np.median(border, axis=0)
    near = (np.sqrt(((rgb.astype(int) - ref) ** 2).sum(-1)) < tol) & fg
    lab, n = ndi.label(near)
    if not n:
        return fg
    area = ndi.sum(np.ones_like(lab), lab, index=np.arange(1, n + 1))
    big = np.isin(lab, np.where(area >= min_area)[0] + 1)
    return fg & ~big


def matte(img, fg):
    """Soft alpha on the object's rim and the white fringe removed from rim colours."""
    rgb = np.array(img).astype(float)
    border = np.concatenate([rgb[0], rgb[-1], rgb[:, 0], rgb[:, -1]])
    ref = np.median(border, axis=0)
    inner = ndi.binary_erosion(fg, iterations=2)
    rim = fg & ~inner
    d = np.sqrt(((rgb - ref) ** 2).sum(-1))
    a = np.where(inner, 1.0, np.where(rim, np.clip(d / 90.0, 0, 1), 0.0))
    a = np.array(Image.fromarray((a * 255).astype(np.uint8)).filter(ImageFilter.GaussianBlur(0.5))).astype(float) / 255
    a = np.where(fg, a, 0)
    safe = np.maximum(a, 1e-3)[..., None]
    col = np.where(rim[..., None] & (a[..., None] > 0.05), (rgb - (1 - safe) * ref) / safe, rgb)
    out = np.dstack([np.clip(col, 0, 255), a * 255]).astype(np.uint8)
    return Image.fromarray(out, 'RGBA')


def cutout(img, fg, lab, box, pad):
    x0, y0, x1, y1, i = box
    if img.mode == 'RGBA':  # already matted: keep only this object
        rgba = img.copy()
        al = np.array(rgba.split()[-1]); al[lab != i] = 0
        rgba.putalpha(Image.fromarray(al))
    else:
        a = ((lab == i) & fg).astype(np.uint8) * 255
        alpha = Image.fromarray(a).filter(ImageFilter.GaussianBlur(0.6))
        rgba = img.copy(); rgba.putalpha(alpha)
    x0, y0 = max(0, x0 - pad), max(0, y0 - pad)
    x1, y1 = min(img.width, x1 + pad), min(img.height, y1 + pad)
    return rgba.crop((x0, y0, x1, y1))


def fit_square(im, size):
    k = min(size / im.width, size / im.height)
    im = im.resize((max(1, round(im.width * k)), max(1, round(im.height * k))), Image.LANCZOS)
    c = Image.new('RGBA', (size, size), (0, 0, 0, 0))
    c.paste(im, ((size - im.width) // 2, (size - im.height) // 2), im)
    return c


def save(im, root, name):
    p = os.path.join(root, name + '.webp')
    os.makedirs(os.path.dirname(p), exist_ok=True)
    im.save(p, 'WEBP', quality=88, method=6)
    return p


def face_from_body(body):
    a = np.array(body.split()[-1]) > 40
    ys, xs = np.where(a)
    top, bot = ys.min(), ys.max()
    head_h = int((bot - top) * 0.42)
    rows = a[top:top + head_h]
    cols = np.where(rows.any(0))[0]
    cx = int((cols.min() + cols.max()) / 2)
    side = int(max(head_h, cols.max() - cols.min()) * 1.05)
    x0 = max(0, cx - side // 2)
    return fit_square(body.crop((x0, max(0, top - 4), x0 + side, top - 4 + side)), S)


def run(src, dst):
    done = []
    for key, spec in SHEETS.items():
        f = next((os.path.join(src, key + ext) for ext in ('.png', '.jpg', '.jpeg', '.webp') if os.path.exists(os.path.join(src, key + ext))), None)
        if not f:
            print('skip (no file):', key); continue
        img = Image.open(f).convert('RGB')
        if 'bg' in spec:
            im = img.copy(); im.thumbnail((720, 1280), Image.LANCZOS)
            done.append(save(im, dst, spec['bg'])); continue
        rgb = np.array(img)
        fg = ~bg_mask(rgb, spec.get('tol', 38))
        fg = ndi.binary_opening(fg, iterations=1)
        if 'grid' in spec:
            spec['n'] = spec['grid'] ** 2
            boxes, lab = grid_objects(fg, spec['grid'])
        else:
            boxes, lab = objects(fg, spec['n'])
        if len(boxes) != spec['n']:
            print(f'WARNING {key}: found {len(boxes)} objects, expected {spec["n"]}')
        pad = max(4, img.width // 200)
        if 'bodies' in spec:
            for box, name in zip(boxes, spec['bodies']):
                if not name:
                    continue
                body = cutout(img, fg, lab, box, pad)
                body.thumbnail((512, 640), Image.LANCZOS)
                done.append(save(body, dst, 'heroes/looks/' + name))
                done.append(save(face_from_body(body), dst, 'heroes/looks/' + name + '_face'))
            continue
        size = spec.get('size', S)
        if spec.get('clean'):
            fg = holes(rgb, fg)
            img = matte(img, fg)
        for b, name in zip(boxes, spec['out']):
            if spec.get('tight'):  # keep the object's own proportions so it stands on its base
                im = cutout(img, fg, lab, b, pad); im.thumbnail((size, size), Image.LANCZOS)
                done.append(save(im, dst, name)); continue
            done.append(save(fit_square(cutout(img, fg, lab, b, pad), size), dst, name))
    print('\n'.join(done)); print(len(done), 'files')


if __name__ == '__main__':
    run(sys.argv[1], sys.argv[2])
