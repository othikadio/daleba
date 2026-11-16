import sys, json, torch, torchaudio as ta
from chatterbox.mtl_tts import ChatterboxMultilingualTTS
torch.set_num_threads(8)
m = ChatterboxMultilingualTTS.from_pretrained(device="cpu")
jobs = json.load(open(sys.argv[1]))
for j in jobs:
    torch.manual_seed(j.get("seed", 1))
    wav = m.generate(j["text"], language_id="fr", audio_prompt_path=j["ref"], exaggeration=j.get("ex", 0.5), cfg_weight=j.get("cfg", 0.5), temperature=j.get("temp", 0.8))
    ta.save(j["out"], wav, m.sr); print("ok", j["out"], round(wav.shape[-1] / m.sr, 2), flush=True)
