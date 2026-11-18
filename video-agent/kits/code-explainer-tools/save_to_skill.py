# Copy this project's code into the public skill as reference code (no timing/transcripts/media). Usage: python tools/save_to_skill.py <name>
import shutil, sys, pathlib
name = sys.argv[1]; root = pathlib.Path(__file__).resolve().parents[1]
dst = root.parents[1] / "skills" / "code-explainer-video" / "reference-code" / name
skip = lambda d, files: [f for f in files if f.startswith("timing_") or f.endswith((".json", ".mp3", ".wav", ".mp4", ".jpg", ".png", ".svg", ".webp")) or f in ("node_modules", "__pycache__", "assets")]
for sub in ("src", "tools"):
    shutil.rmtree(dst / sub, ignore_errors=True); shutil.copytree(root / sub, dst / sub, ignore=skip)
shutil.copy(root / "package.json", dst / "package.json"); print("saved ->", dst)
