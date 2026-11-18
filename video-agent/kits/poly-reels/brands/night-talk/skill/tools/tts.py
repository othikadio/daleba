# Voices a whole episode as one real conversation with Gemini TTS, using this brand's locked voices (brand/voice.json).
# Usage: python tools/tts.py <video folder> [--lang en]      writes voice_<lang>.wav
# Emotion comes from <tags> inside each line's text, for example "<sad> One. <short pause> It said unsubscribe."
# The key comes from GEMINI_API_KEY. It is never printed or saved.
import sys, os, json, re, base64, wave, time
from google import genai
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
a = sys.argv[1:]
ep = a[0]
lang = a[a.index("--lang") + 1] if "--lang" in a else "en"
model = os.environ.get("GEMINI_TTS_MODEL", "gemini-3.8-flash-lite-tts")
V = json.load(open(os.path.join(ROOT, "brand", "voice.json"), encoding="utf-8"))
E = json.load(open(os.path.join(ep, "episode.json"), encoding="utf-8"))
key = os.environ.get("GEMINI_API_KEY") or os.environ.get("GOOGLE_API_KEY")
if not key: sys.exit("GEMINI_API_KEY is not set.")
for l in E["lines"]:
    if l["who"] not in V: sys.exit(f"'{l['who']}' has no locked voice. Only the male and female characters speak.")
content = []
for l in E["lines"]:
    s = V[l["who"]]; text = (l.get(lang) or l["text"]).strip()
    if lang == "hi" and not l.get("hi"): sys.exit("Every line needs a `hi` field for Hindi.")
    content.append({"type": "text", "text": text, "annotations": [{"type": "speech_metadata", "speaker": s["name"], "style": s["style"]}]})
names = {V[k]["name"]: V[k]["voice"] for k in ("human", "bot")}
client = genai.Client(api_key=key)
for attempt in range(4):     # the API sometimes drops a long request
    try:
        it = client.interactions.create(
            model=model, input=[{"type": "user_input", "content": content}], response_format={"type": "audio"},
            generation_config={"speech_config": {"speakers": [{"speaker": n, "voice": v} for n, v in names.items()]}})
        break
    except Exception as e:
        if attempt == 3: raise
        print("retrying after:", type(e).__name__); time.sleep(5 * (attempt + 1))
pcm = base64.b64decode(it.output_audio.data); out = os.path.join(ep, f"voice_{lang}.wav")
if pcm[:4] == b"RIFF": open(out, "wb").write(pcm)
else:
    with wave.open(out, "wb") as w: w.setnchannels(1); w.setsampwidth(2); w.setframerate(24000); w.writeframes(pcm)
print("saved", out, "with", names)
