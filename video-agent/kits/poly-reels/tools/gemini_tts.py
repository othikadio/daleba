"""Gemini 3.x TTS helper (Interactions API). Key comes from GEMINI_API_KEY env var.

Saved voice profiles live in tools/voices/<id>.json  ({"name","voice","style"}).

  python gemini_tts.py --list-models
  python gemini_tts.py --profile mako-voice1 --text "Hello" --out hello.wav
  python gemini_tts.py --profile mako-voice1 --file script.txt --out vo.wav
  python gemini_tts.py --speakers "Mako=mako-voice1,Priya=Puck" --file dialogue.txt --out talk.wav
      speakers may be a profile id or a raw prebuilt voice name; dialogue lines: "Mako: text"
      per-speaker style: --style "Priya=calm and warm"  (repeatable)
Inline events inside text: <short pause>, <laugh>, |backchannel|.
"""
import argparse, base64, json, os, sys, wave
from google import genai

HERE = os.path.dirname(os.path.abspath(__file__))
DEFAULT_MODEL = os.environ.get("GEMINI_TTS_MODEL", "gemini-3.8-flash-tts")


def load_profile(x):
    p = os.path.join(HERE, "voices", x + ".json")
    if os.path.exists(p):
        return json.load(open(p, encoding="utf-8"))
    return {"name": x, "voice": x, "style": ""}


def save_wav(path, pcm, rate=24000):
    with wave.open(path, "wb") as w:
        w.setnchannels(1); w.setsampwidth(2); w.setframerate(rate); w.writeframes(pcm)


def main():
    p = argparse.ArgumentParser()
    p.add_argument("--list-models", action="store_true")
    p.add_argument("--model", default=DEFAULT_MODEL)
    p.add_argument("--text"); p.add_argument("--file")
    p.add_argument("--profile", help="saved profile id (single speaker)")
    p.add_argument("--voice", help="raw prebuilt voice name (single speaker)")
    p.add_argument("--speakers", help='"Name=profileOrVoice,Name2=profileOrVoice" (max 2)')
    p.add_argument("--style", action="append", default=[], help='"Speaker=style" or just "style" (repeatable)')
    p.add_argument("--out", default="out.wav")
    a = p.parse_args()

    key = os.environ.get("GEMINI_API_KEY") or os.environ.get("GOOGLE_API_KEY")
    if not key:
        sys.exit("GEMINI_API_KEY is not set.")
    client = genai.Client(api_key=key)

    if a.list_models:
        for m in client.models.list():
            if "tts" in m.name.lower() or "audio" in m.name.lower():
                print(m.name)
        return

    text = open(a.file, encoding="utf-8").read() if a.file else a.text
    if not text:
        sys.exit("Give --text or --file")

    # speaker table: name -> (voice, style)
    table = {}
    if a.speakers:
        for pair in a.speakers.split(","):
            n, v = pair.split("=")
            pr = load_profile(v.strip())
            table[n.strip()] = (pr["voice"], pr.get("style", ""))
    else:
        pr = load_profile(a.profile) if a.profile else {"name": "Speaker", "voice": a.voice or "Kore", "style": ""}
        table[pr["name"]] = (pr["voice"], pr.get("style", ""))
    for s in a.style:
        if "=" in s and s.split("=", 1)[0] in table:
            n, st = s.split("=", 1); table[n] = (table[n][0], st)
        else:
            for n in table: table[n] = (table[n][0], s)

    names = list(table)
    content = []
    if len(names) == 1:
        voice, style = table[names[0]]
        item = {"type": "text", "text": text}
        if style:
            item["annotations"] = [{"type": "speech_metadata", "speaker": names[0], "style": style}]
        content.append(item)
        cfg = {"speech_config": [{"voice": voice}]}
    else:
        for line in text.splitlines():
            if ":" in line and line.split(":", 1)[0].strip() in table:
                n, t = line.split(":", 1); n = n.strip()
                ann = {"type": "speech_metadata", "speaker": n}
                if table[n][1]: ann["style"] = table[n][1]
                content.append({"type": "text", "text": t.strip(), "annotations": [ann]})
        cfg = {"speech_config": {"speakers": [{"speaker": n, "voice": table[n][0]} for n in names]}}

    it = client.interactions.create(
        model=a.model,
        input=[{"type": "user_input", "content": content}],
        response_format={"type": "audio"},
        generation_config=cfg,
    )
    pcm = base64.b64decode(it.output_audio.data)
    if pcm[:4] == b"RIFF":
        open(a.out, "wb").write(pcm)
    else:
        save_wav(a.out, pcm)
    print("saved", a.out)


if __name__ == "__main__":
    main()
