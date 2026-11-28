"""Détoure la personne d'une photo (MediaPipe selfie segmentation, modèle local) -> PNG transparent.
usage : PYTHONPATH=/opt/mp-lib /opt/voix/bin/python -S detoure.py in.jpg out.png [largeur 1080 hauteur 1920]
Le résultat est recadré comme `object-fit: cover` en 1080x1920 pour se superposer exactement à la photo."""
import sys, numpy as np, mediapipe as mp
from PIL import Image, ImageOps, ImageFilter
src, out = sys.argv[1], sys.argv[2]; W, H = (int(sys.argv[3]), int(sys.argv[4])) if len(sys.argv) > 4 else (1080, 1920)
im = ImageOps.fit(Image.open(src).convert("RGB"), (W, H))
seg = mp.solutions.selfie_segmentation.SelfieSegmentation(model_selection=0)
m = seg.process(np.array(im)).segmentation_mask
m = np.clip((m - .35) / .3, 0, 1)
a = Image.fromarray((m * 255).astype("uint8")).filter(ImageFilter.GaussianBlur(2))
im.putalpha(a); im.save(out); print("ok", out)
