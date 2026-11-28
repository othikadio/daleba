"""Nettoie index.json : pour chaque mot, garde d'abord les plans dont le titre contient la recherche (pertinents)."""
import json, os
H = os.path.dirname(os.path.abspath(__file__)); x = json.load(open(os.path.join(H, "index.json"))); mots = json.load(open(os.path.join(H, "mots.json")))
faibles = []
for fr, ids in x["mots"].items():
    qs = [w[:4] for q in mots.get(fr, [fr]) for w in q.split()]
    ok = [v for v in ids if any(k in x["clips"][v]["titre"] for k in qs)]
    x["mots"][fr] = ok
    if len(ok) < 3: faibles.append((fr, len(ok)))
json.dump(x, open(os.path.join(H, "index.json"), "w"), ensure_ascii=False, indent=1)
print("faibles:", faibles)
