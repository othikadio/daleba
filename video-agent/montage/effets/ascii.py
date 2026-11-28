"""Image -> portrait en caractères (effet « corps en code »). usage : python3 ascii.py in.jpg out.png [couleur]"""
import sys
from PIL import Image, ImageDraw, ImageFont, ImageOps
src, out = sys.argv[1], sys.argv[2]; col = sys.argv[3] if len(sys.argv) > 3 else "#7CFFB2"
W, H, FS = 1080, 1920, 24
f = ImageFont.truetype("/usr/share/fonts/truetype/dejavu/DejaVuSansMono-Bold.ttf", FS)
cw = f.getbbox("M")[2]; ch = int(FS * 1.15); cols, rows = W // cw, H // ch
im = ImageOps.fit(Image.open(src).convert("L"), (cols, rows)); im = ImageOps.autocontrast(im, cutoff=2); im = im.point(lambda p: int(255 * (p / 255) ** 1.1))
chars = " .:-=+*#%@"
o = Image.new("RGB", (W, H), "#050806"); d = ImageDraw.Draw(o)
for y in range(rows):
    for x in range(cols):
        v = im.getpixel((x, y)) / 255
        if v < .08: continue
        c = chars[min(len(chars) - 1, int(v * (len(chars) - 1)))]
        a = int(80 + 175 * v); d.text((x * cw, y * ch), c, font=f, fill=tuple(int(col[i:i + 2], 16) * a // 255 for i in (1, 3, 5)))
o.save(out); print("ok", out)
