# Crop a single asset collage into separate PNGs; cut out product shots with rembg (transparent background).
# Usage: python tools/crop_assets.py <collage.png> <out_dir>
import sys, os
from PIL import Image, ImageDraw, ImageFont
src, out = sys.argv[1:3]; os.makedirs(out, exist_ok=True)
im = Image.open(src).convert("RGB")
# name: (box in collage pixels, cut out background?)
CROPS = {
    "bud_left": ((28, 72, 215, 338), True), "bud_right": ((212, 72, 392, 338), True),
    "bud_3q": ((410, 50, 668, 340), True), "bud_side": ((680, 52, 875, 338), True),
    "case_open": ((882, 62, 1198, 330), True), "case_closed": ((1210, 90, 1520, 330), True),
    "apple_logo": ((28, 415, 310, 730), True), "window": ((342, 372, 748, 762), False),
    "phone_bluetooth": ((755, 376, 999, 900), False), "phone_noise": ((1001, 376, 1255, 900), False),
    "phone_fittest": ((1256, 376, 1524, 900), False), "ear": ((0, 762, 548, 1024), False), "person": ((555, 768, 752, 1024), False),
}
cut = None
for name, (box, bg) in CROPS.items():
    c = im.crop(box)
    if name in ("phone_bluetooth", "phone_noise"):  # hide the owner's name on the AirPods title
        d = ImageDraw.Draw(c); f = ImageFont.truetype("C:/Windows/Fonts/seguisb.ttf", 15 if name == "phone_bluetooth" else 12)
        y = 156 if name == "phone_bluetooth" else 49
        d.rectangle((14, y, c.width - 14, y + 26 if name == "phone_bluetooth" else y + 20), fill=(0, 0, 0))
        d.text((c.width / 2, y + 13 if name == "phone_bluetooth" else y + 10), "AirPods Pro", fill=(255, 255, 255), font=f, anchor="mm")
        if name == "phone_bluetooth":  # the Name row value too
            d.rectangle((92, 250, 210, 268), fill=c.getpixel((80, 259))); d.text((205, 259), "AirPods Pro", fill=(150, 150, 155), font=ImageFont.truetype("C:/Windows/Fonts/segoeui.ttf", 11), anchor="rm")
    if bg:
        if cut is None:
            from rembg import remove, new_session; cut = new_session("isnet-general-use")
        c = remove(c, session=cut)
        r, g, b, a = c.split()  # rembg leaves white-on-grey products half transparent: harden the matte, keep a soft edge
        a = a.point(lambda v: 0 if v < 40 else 255 if v > 110 else int((v - 40) * 255 / 70)); c = Image.merge("RGBA", (r, g, b, a))
        c = c.crop(c.getbbox())
    c.save(os.path.join(out, name + ".png")); print(name, c.size)
