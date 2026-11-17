import json, os, sys, subprocess
from datetime import datetime
from zoneinfo import ZoneInfo
cal = json.load(open(sys.argv[1])); up = json.load(open(sys.argv[2])); which = [int(x) for x in sys.argv[3].split(",")]; tiktok_type = sys.argv[4]
KEY = sys.argv[5]
MODE = sys.argv[6] if len(sys.argv) > 6 else "schedule"
IDS = {"facebook": "cmwdczeem001po3074vfb8fni", "instagram": "cmwddj73z00bqo108bjg4c79m", "tiktok": "cmwdcvm1i01e0pr07plg94q0r"}
TITLES = {"kadio-menu-v1-abonnements.mp4": "Club Kadio : tes abonnements coiffure", "kadio-menu-v5-locs-barbier.mp4": "Locs, barbier, tissages : le menu",
          "kadio-menu-v4-tresses.mp4": "Nattes, twists, knotless : nos prix", "kadio-menu-v3-privileges.mp4": "Être membre Club Kadio, ça rapporte",
          "kadio-menu-v2-famille.mp4": "Toute la famille chez Kadio Coiffure", "kadio-reel-routine.mp4": "Ta routine coiffure à prix fixe", "kadio-bento-fetes-voixpro.mp4": "Ta coiffure des fêtes chez Kadio"}
for i in which:
    p = cal["posts"][i]; u = up[p["video"]]
    date = datetime.fromisoformat(p["date"]).replace(tzinfo=ZoneInfo(cal["fuseau"])).astimezone(ZoneInfo("UTC")).strftime("%Y-%m-%dT%H:%M:%S.000Z")
    media = [{"id": u["id"], "path": u["path"], "thumbnailTimestamp": 4000}]
    val = [{"content": p["texte"], "image": media}]
    if MODE == "now": date = datetime.now(ZoneInfo("UTC")).strftime("%Y-%m-%dT%H:%M:%S.000Z")
    body = {"type": MODE, "date": date, "shortLink": False, "tags": [], "posts": [
        {"integration": {"id": IDS["facebook"]}, "value": val, "settings": {"__type": "facebook", "post_type": "post", "title": TITLES[p["video"]]}},
        {"integration": {"id": IDS["instagram"]}, "value": val, "settings": {"__type": "instagram", "post_type": "post", "is_trial_reel": False, "collaborators": []}},
        {"integration": {"id": IDS["tiktok"]}, "value": val, "settings": {"__type": tiktok_type, "title": TITLES[p["video"]], "privacy_level": "PUBLIC_TO_EVERYONE",
            "duet": False, "stitch": False, "comment": True, "autoAddMusic": "no", "brand_content_toggle": False, "brand_organic_toggle": False,
            "video_made_with_ai": os.environ.get("CONTENU_IA", "1") == "1", "content_posting_method": "DIRECT_POST"}}]}
    r = subprocess.run(["curl", "-sS", "-m", "60", "-X", "POST", "https://api.postiz.com/public/v1/posts", "-H", "Authorization: " + KEY,
                        "-H", "Content-Type: application/json", "-d", json.dumps(body, ensure_ascii=False), "-w", "\nHTTP %{http_code}"], capture_output=True, text=True)
    print(i, p["video"], date, "->", r.stdout.strip()[-600:], r.stderr[-200:])
