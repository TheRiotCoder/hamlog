from PIL import Image, ImageDraw
import math
def draw_icon(size, maskable=False, rounded=True):
    S = size*4  # supersample
    img = Image.new('RGBA', (S, S), (0,0,0,0))
    d = ImageDraw.Draw(img)
    bg_top, bg_bot = (30,58,138), (15,23,42)
    # vertical gradient background
    grad = Image.new('RGBA', (S, S))
    gd = ImageDraw.Draw(grad)
    for y in range(S):
        t = y/(S-1)
        c = tuple(int(bg_top[i]*(1-t)+bg_bot[i]*t) for i in range(3)) + (255,)
        gd.line([(0,y),(S,y)], fill=c)
    mask = Image.new('L', (S, S), 0)
    md = ImageDraw.Draw(mask)
    if rounded and not maskable:
        md.rounded_rectangle([0,0,S-1,S-1], radius=int(S*0.22), fill=255)
    else:
        md.rectangle([0,0,S,S], fill=255)
    img.paste(grad, (0,0), mask)
    d = ImageDraw.Draw(img)
    k = 0.72 if maskable else 1.0   # keep artwork inside maskable safe zone
    cx = S/2
    def P(x, y):  # artwork coords in 0..1 space, centered/scaled
        return (cx + (x-0.5)*S*k, S/2 + (y-0.5)*S*k)
    white = (255,255,255,255); amber = (251,191,36,255)
    lw = int(S*0.035*k)
    # antenna mast (tower)
    top = P(0.5, 0.30); bl = P(0.36, 0.84); br = P(0.64, 0.84)
    d.line([top, bl], fill=white, width=lw); d.line([top, br], fill=white, width=lw)
    for t in (0.35, 0.6, 0.85):
        y = 0.30 + (0.84-0.30)*t
        half = 0.14*t
        a = P(0.5-half, y); b = P(0.5+half, y)
        d.line([a, b], fill=white, width=int(lw*0.8))
    # cross braces
    for t0, t1 in ((0.35,0.6),(0.6,0.85)):
        y0 = 0.30 + 0.54*t0; y1 = 0.30 + 0.54*t1
        d.line([P(0.5-0.14*t0, y0), P(0.5+0.14*t1, y1)], fill=white, width=int(lw*0.6))
        d.line([P(0.5+0.14*t0, y0), P(0.5-0.14*t1, y1)], fill=white, width=int(lw*0.6))
    # radiating waves
    c = P(0.5, 0.30)
    for i, r in enumerate((0.11, 0.19, 0.27)):
        R = r*S*k
        box = [c[0]-R, c[1]-R, c[0]+R, c[1]+R]
        d.arc(box, start=-50, end=50, fill=amber, width=lw)
        d.arc(box, start=130, end=230, fill=amber, width=lw)
    # dot at top
    rr = S*0.035*k
    d.ellipse([c[0]-rr, c[1]-rr, c[0]+rr, c[1]+rr], fill=amber)
    return img.resize((size, size), Image.LANCZOS)

import os
out = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', 'icons') + os.sep
draw_icon(192).save(out+'icon-192.png')
draw_icon(512).save(out+'icon-512.png')
draw_icon(512, maskable=True).save(out+'icon-maskable-512.png')
# apple-touch-icon: opaque, square (iOS rounds corners itself)
a = draw_icon(180, rounded=False).convert('RGB'); a.save(out+'apple-touch-icon.png')
draw_icon(32).save(out+'favicon-32.png')
print('ok')
