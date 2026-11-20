import json, subprocess, time, os
D=os.path.dirname(os.path.abspath(__file__)); ids=json.load(open(D+"/requests.json")); pend={k:v for k,v in ids.items() if not os.path.exists(f"{D}/{k}.mp4")}
for _ in range(240):
    for k,rid in list(pend.items()):
        d=json.loads(subprocess.run(["curl","-sS","-m","30",f"https://api.higgsfield.ai/requests/{rid}/status","-H","Authorization: Key proxy-injected"],capture_output=True,text=True).stdout or "{}")
        st=d.get("status","")
        if st=="completed":
            if subprocess.run(["curl","-sS","-f","-L","-o",f"{D}/{k}.mp4",d["video"]["url"]]).returncode==0: print(k,"ok",flush=True); del pend[k]
        elif st in ("failed","nsfw","canceled"): print(k,st,json.dumps(d)[:200],flush=True); del pend[k]
    if not pend: break
    time.sleep(15)
print("done",len(pend),"restants")
