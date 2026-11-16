# Studio montage — styles et méthode

## Organisation d'un projet

```
video-agent/
├── rushs/      tes vidéos brutes (tu les envoies, je les range ici)
├── derush/     transcription + choix des meilleures prises
├── montage/    un dossier par vidéo en cours (spec, compositions)
├── exports/    vidéos finies prêtes à publier
├── SUIVI.md    mémoire du projet : où on en est, ce que tu aimes / n'aimes pas
└── templates/  modèles de motion design réutilisables
```

On avance **une étape à la fois** : intro → partie 1 → partie 2 → fin, validée à chaque fois.

## Style A — « Verre premium » (motion design pur, rien n'est filmé)

Référence aimée : vidéos 100 % animées, fond bleu nuit, cartes en verre dépoli.

- Fond : dégradé radial bleu (#05081c → #1a2cff), vagues lumineuses en bas.
- Cartes en verre : `backdrop-filter: blur(30px)`, bord blanc 18 %, coins 48 px.
- Typo : Inter Display 700–800, interlettrage serré (-0.045em).
- Mouvement : mots qui entrent avec flou de mouvement (blur 18 px → 0, ease power4.out),
  zoom-through entre les scènes (la carte grossit et se floute, la suivante arrive de petit à net).
- Objets 3D brillants (orbes, cubes arrondis), puces « ● Texte ».
- Outils : skill **hyperframes** (+ `hyperframes-registry` pour 450 blocs : glass-shard-title,
  orbit-card, cuboid-carousel…), **motion-doctrine** et **cut-the-curve** pour les transitions.
- Modèle prêt : `templates/verre-premium/` → `npx hyperframes render -o sortie.mp4`.
- Les mains qui tiennent un téléphone / ordi : images générées (skill `codex-images`) ou photos
  de toi détourées, intégrées dans la composition.

## Style B — « Cartes blanches + chrono » (face caméra)

Référence aimée : toi face caméra, cartes blanches simples en haut, compte à rebours.

- Face caméra plein écran, sous-titres blancs simples en bas du visage (pas trop gros).
- Cartes blanches arrondies en haut de l'écran, texte noir, apparaissent sur le mot exact :
  listes ✓/✕, arborescence de dossiers, étapes (« Intro / Partie 1 / Partie 2 / Fin »).
- Chrono digital (style réveil, chiffres jaunes) qui décompte jusqu'à la fin → rétention.
- Pas de titres qui tremblent, pas d'effets lourds.
- Outils : skill **short-editing** (coupe des silences, sous-titres, cartes « boards »),
  ou **steal** pour mesurer précisément un style à partir d'une vidéo de référence.

## Pour lancer un montage

1. Envoie tes rushs + dis le style (A ou B) et le message de la vidéo.
2. `/editing` choisit le bon skill, ou directement `/short-editing`.
3. Je te montre un aperçu, tu valides, j'exporte dans `exports/`.
