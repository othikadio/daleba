"""Photo → illustration « affiche de jeu » (aplats de couleurs + contours encrés + teinte couchant)."""
import sys, os
from PIL import Image, ImageFilter, ImageOps, ImageEnhance, ImageChops
def art(src, dst, w=1080, h=1350, tint=(255,120,60)):
    im = ImageOps.fit(Image.open(src).convert("RGB"), (w, h), method=Image.LANCZOS, centering=(.5,.4))
    im = ImageEnhance.Color(im).enhance(1.45); im = ImageEnhance.Contrast(im).enhance(1.25)
    sm = im.filter(ImageFilter.MedianFilter(9)).filter(ImageFilter.SMOOTH_MORE)
    flat = ImageOps.posterize(sm, 3)
    g = ImageOps.grayscale(im.filter(ImageFilter.GaussianBlur(3.2)))
    ed = g.filter(ImageFilter.FIND_EDGES); ed = ImageEnhance.Contrast(ed).enhance(4)
    ed = ed.point(lambda v: 0 if v > 120 else 255).filter(ImageFilter.MedianFilter(3)).filter(ImageFilter.MinFilter(3))
    ink = Image.merge("RGB", (ed, ed, ed))
    out = ImageChops.multiply(flat, ink)
    grad = Image.linear_gradient("L").resize((w, h)).point(lambda v: int(v * .35))
    col = Image.new("RGB", (w, h), tint); out = Image.composite(ImageChops.screen(out, col), out, grad)
    out.save(dst, quality=93)
for f in sys.argv[1:]:
    art(f, os.path.join("art", os.path.basename(f))); print("ok", f)
