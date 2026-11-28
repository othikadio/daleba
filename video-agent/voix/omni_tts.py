"""Voix off naturelle avec OmniVoice (moteur de VoiceStudio), sans clonage.
usage: PYTHONPATH=/opt/omni-lib:outils/voicestudio /opt/voix/bin/python -I? (non) omni_tts.py jobs.json
jobs.json : [{"text": "...", "out": "x.wav", "instruct": "male, young adult, moderate pitch", "seed": 7, "speed": 1.0}]
"""
import json, sys, torch, soundfile as sf
from omnivoice.models.omnivoice import OmniVoice

torch.set_num_threads(4)
m = OmniVoice.from_pretrained("k2-fsa/OmniVoice", device_map="cpu", dtype=torch.float32, allow_tokenizer_fallback=True)
for j in json.load(open(sys.argv[1])):
    a = m.generate(text=j["text"], language="French", instruct=j.get("instruct"), speed=j.get("speed", 1.0),
                   seed=j.get("seed", 7), num_step=j.get("num_step", 32))
    w = a[0]
    w = w.detach().cpu().float().numpy() if hasattr(w, "detach") else w
    sf.write(j["out"], w.reshape(-1), m.sampling_rate)
    print("ok", j["out"], round(len(w.reshape(-1)) / m.sampling_rate, 2), flush=True)
