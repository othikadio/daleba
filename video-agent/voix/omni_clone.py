"""Voix off OmniVoice à partir d'une voix de référence (narrateurs LibriVox, domaine public / CC-BY).
jobs.json : [{"text","out","ref","ref_text","seed","speed"}]"""
import json, sys, torch, soundfile as sf
from omnivoice.models.omnivoice import OmniVoice
torch.set_num_threads(4)
m = OmniVoice.from_pretrained("k2-fsa/OmniVoice", device_map="cpu", dtype=torch.float32, allow_tokenizer_fallback=True)
for j in json.load(open(sys.argv[1])):
    a = m.generate(text=j["text"], language="French", ref_audio=j["ref"], ref_text=j.get("ref_text"), speed=j.get("speed", 1.0), seed=j.get("seed", 7))
    w = a[0]; w = w.detach().cpu().float().numpy() if hasattr(w, "detach") else w
    sf.write(j["out"], w.reshape(-1), m.sampling_rate); print("ok", j["out"], round(w.size / m.sampling_rate, 2), flush=True)
