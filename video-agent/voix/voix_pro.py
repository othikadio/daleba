import sys, json, torch, torchaudio as ta
from chatterbox.mtl_tts import ChatterboxMultilingualTTS
torch.set_num_threads(4)
m = ChatterboxMultilingualTTS.from_pretrained(device="cpu")
for j in json.load(open(sys.argv[1])):
    torch.manual_seed(j.get("seed", 1))
    kw = dict(language_id="fr", exaggeration=j.get("ex", .7), cfg_weight=j.get("cfg", .4), temperature=j.get("temp", .8))
    if j.get("ref"): kw["audio_prompt_path"] = j["ref"]
    wav = m.generate(j["text"], **kw); ta.save(j["out"], wav, m.sr); print("ok", j["out"], round(wav.shape[-1] / m.sr, 2), flush=True)
