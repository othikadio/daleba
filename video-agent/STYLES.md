# Studio montage — styles et méthode

## ★ MÉTHODE VALIDÉE PAR KADIO (priorité absolue, nov. 2026)

C'est **la façon de faire les vidéos de Kadio Coiffure**. Toute nouvelle vidéo part d'ici ;
on varie les couleurs, la musique et 2 à 4 effets, mais on ne change pas la base.
Fiche détaillée : `styles/montage-dynamique.md`.

1. **Style « montage dynamique » (réf. « 5 € edit »)** — validé : « Là c'est parfait, je trouve ça professionnel. »
   - Texte **mot à mot calé sur la voix** (horodatage whisper), petits mots en gras fin, mots forts énormes,
     mots émotion en **serif italique** couleur d'accent, chiffres géants avec flash + coup sourd.
   - **Coupes rapides** (un plan toutes les 1–2 s), petit zoom d'entrée à chaque coupe.
   - Alternance : photo couleur / photo noir et blanc / **aplat couleur d'accent** / **aplat blanc**.
   - **Plans de la bibliothèque** (`bibliotheque/`, 592 plans Mixkit) calés sur le sens des mots ; les photos du salon restent prioritaires pour les sujets cheveux afro.
   - Carte de fin : nom, prix en pastilles, adresse, téléphone.
2. **Variante calme pour le face caméra** — « ça en fait un peu trop, on a du mal à suivre » :
   la personne reste à l'écran, sous-titres sur une ligne en bas, 1 seule carte couleur, pas de flash / N&B / zooms brusques.
3. **Voix** : une seule voix à la fois (« la voix prend une personne à la fois ») ; en attendant le clone de la voix de Kadio,
   voix présentateur n° 1 (OmniVoice, réf. 9804), écrire « Kadio » et « lok » (pas « lock ») pour la prononciation.
   Sur une vidéo face caméra : la vraie voix de Kadio.
4. **Musique** : une musique de fond **légère sous la voix**, **différente à chaque vidéo** (`bibliotheque/musiques/`, 49 pistes par ambiance).
5. **Couleurs** : changer la palette à chaque vidéo (rouge, orange Kadio, vert/or, bleu électrique, turquoise, cuivre, rose, moutarde, bleu nuit…).
6. **Couverture obligatoire** (`couvertures/couverture.py`) : mots-clés en gros, lisibles dans le fil TikTok / Instagram avant le clic,
   collée en ouverture (0,4 s) + `thumbnailTimestamp: 150` ; 1re ligne de la description = mêmes mots-clés.
7. **Effets en plus** : `montage/effets/catalogue.md` (23 effets) — 2 à 4 par vidéo, au service du propos, jamais toujours les mêmes.

8. **Variante « documentaire cinéma »** (réf. envoyée le 28 nov., à valider) — bloc `premium/build.py doc_<nom>` :
   sujet détouré (`effets/detoure.py`) sur fond gris clair brumeux, brume qui glisse, bas de l'image fondu en blanc,
   mot-titre en **grand serif rouge (Bodoni)** placé derrière le sujet, petits mots gris mot à mot autour,
   apparitions par mise au point (flou → net), un calque flou au premier plan qui passe (profondeur), rythme lent, narration une voix.

Ce que Kadio n'aime pas : MODE HIVER, « Ligne Kadio », effets « Apple » A/B/C, voix designées artificielles,
photos retouchées, trop d'effets sur le face caméra.

---

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
