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
# Brand 3 uses the user's own setup: Bodi and Kore, temperature 1.
from google.genai import types
parts = []
for l in E["lines"]:
    s = V[l["who"]]; text = (l.get(lang) or l["text"]).strip()
    if lang == "hi" and not l.get("hi"): sys.exit("Every line needs a `hi` field for Hindi.")
    meta = {"speaker": s["name"]}
    if s.get("style"): meta["style"] = s["style"]
    parts.append(types.Part(text=text, speech_metadata=types.SpeechMetadata(**meta)))
cfg = types.GenerateContentConfig(temperature=V.get("temperature", 1), response_modalities=["audio"], speech_config=types.SpeechConfig(multi_speaker_voice_config=types.MultiSpeakerVoiceConfig(speaker_voice_configs=[
    types.SpeakerVoiceConfig(speaker=V[k]["name"], voice_config=types.VoiceConfig(prebuilt_voice_config=types.PrebuiltVoiceConfig(voice_name=V[k]["voice"]))) for k in ("human", "bot")])))
client = genai.Client(api_key=key)
for attempt in range(4):     # the API sometimes drops a long request
    try:
        pcm, rate = bytearray(), 24000
        for c in client.models.generate_content_stream(model=model, contents=[types.Content(role="user", parts=parts)], config=cfg):
            if c.parts and c.parts[0].inline_data and c.parts[0].inline_data.data:
                pcm.extend(c.parts[0].inline_data.data); m = re.search(r"rate=(\d+)", c.parts[0].inline_data.mime_type or "")
                if m: rate = int(m.group(1))
        if pcm: break
        raise RuntimeError("no audio returned")
    except Exception as e:
        if attempt == 3: raise
        print("retrying after:", type(e).__name__); time.sleep(5 * (attempt + 1))
out = os.path.join(ep, f"voice_{lang}.wav")
if pcm[:4] == b"RIFF": open(out, "wb").write(pcm)
else:
    with wave.open(out, "wb") as w: w.setnchannels(1); w.setsampwidth(2); w.setframerate(rate); w.writeframes(bytes(pcm))
print("saved", out, "with", V["human"]["voice"], V["bot"]["voice"])
