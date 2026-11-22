"""Choisit la meilleure prise de chaque phrase (transcription whisper large vs texte), puis tonalité."""
import json, subprocess, difflib, re, unicodedata, os, sys
S=json.load(open("spec.json")); W=os.path.expanduser("~/.cache/whisper-cpp/ggml-large-v3-turbo-q5_0.bin")
n=lambda s: " ".join(re.sub(r"[^a-z0-9 ]"," ",unicodedata.normalize("NFD",s.lower()).encode("ascii","ignore").decode()).split())
AF=("highpass=f=70,equalizer=f=170:t=q:w=1:g=1.5,equalizer=f=3100:t=q:w=1.2:g=2.5,equalizer=f=10000:t=q:w=1:g=1.5,"
    "acompressor=threshold=-18dB:ratio=2.5:attack=8:release=120,alimiter=limit=0.9,areverse,silenceremove=start_periods=1:start_threshold=-45dB,areverse,"
    "silenceremove=start_periods=1:start_threshold=-45dB")
rep=[]
for k,d in S.items():
    if len(sys.argv)>1 and k not in sys.argv[1:]: continue
    for i,txt in enumerate(d["vo"]):
        best=None
        for sd in (11,5,7):
            f=f"vo/{k}_{i}_s{sd}.wav"
            if not os.path.exists(f): continue
            subprocess.run(["ffmpeg","-v","error","-y","-i",f,"-ar","16000","-ac","1","/tmp/pk.wav"])
            h=subprocess.run(["whisper-cli","-m",W,"-l","fr","-nt","-np","-f","/tmp/pk.wav"],capture_output=True,text=True).stdout.strip()
            sc=difflib.SequenceMatcher(None,n(h),n(txt)).ratio()
            if not best or sc>best[0]: best=(sc,f,h)
        subprocess.run(["ffmpeg","-v","error","-y","-i",best[1],"-af",AF,"-ar","48000",f"vo/{k}_{i}.wav"])
        rep.append(f"{k}_{i} {best[0]:.2f} {os.path.basename(best[1])}: {best[2]}"); print(rep[-1],flush=True)
open("vo/rapport.txt","a").write("\n".join(rep))
