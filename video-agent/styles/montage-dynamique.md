# Style validé : « Montage dynamique » (dit « 5 € edit »)

Validé par Kadio le 28 nov. 2026 sur la vidéo barbier (`exports/kadio-premium-barbedit.mp4`) :
« Là c'est parfait… je commence vraiment à trouver ça professionnel. »
Références envoyées par Kadio : deux montages TikTok « 1 € edit / 5 € edit » (podcast + texte cinétique).

**C'est le style de référence. On le garde en priorité, mais on varie les couleurs, les polices d'accent et les plans d'une vidéo à l'autre.**

## Les règles du style
1. **Texte mot à mot calé sur la voix** : chaque mot apparaît à l'instant exact où il est prononcé (horodatage whisper par mot, `-ml 1 -sow -oj`).
2. **Hiérarchie typographique** dans une même phrase :
   - petits mots de liaison : sans-serif gras, petit (50 px) ;
   - mot fort : sans-serif Black énorme (`B`) ;
   - mot émotion : serif italique (Bodoni Moda) en couleur d'accent (`I`) ;
   - chiffre ou mot-choc : géant (`G`) + flash blanc + coup sourd.
   Chaque changement de style = nouvelle ligne, centré.
3. **Coupes rapides** : un plan toutes les 1 à 2 s (≈ 30 plans pour 45 s), petit zoom d'entrée (1,08 → 1) à chaque coupe.
4. **Alternance de fonds** : photo couleur / photo noir et blanc contrastée / aplat dégradé couleur d'accent / aplat blanc (texte en couleur d'accent).
5. **Plans de bibliothèque (B-roll)** : 1 à 3 s de vidéo qui illustre le mot dit (ex. « effort » → quelqu'un qui s'entraîne). Bibliothèque : `video-agent/bibliotheque/`.
6. **Son** : clic discret à chaque coupe, whoosh toutes les 3 coupes, coup sourd sur les chiffres, bruitages métier (tondeuse, ciseaux), musique en fond qui baisse sous la voix.
7. **Fin** : aplat couleur d'accent, nom du salon (sans-serif + serif italique), prix en pastilles blanches, adresse et téléphone.

## Ce qu'on fait varier d'une vidéo à l'autre
- Couleur d'accent (rouge #c8102e dans la v1 ; essayer or, bleu nuit, vert émeraude, orange Kadio #ff8a3d…).
- Police d'accent (Bodoni italique, Cormorant italique, Great Vibes…).
- Ratio photos / aplats / B-roll.

## Comment refaire une vidéo dans ce style
- Bloc `barbedit` de `video-agent/montage/premium/build.py` : une ligne de spec par phrase de voix off, par exemple
  `"[p:b6] D'abord/s on/s discute/I | [red] tes/s épis/B ta/s barbe/I"`
  - `[p:<photo>]`, `[p:<photo>:bw]`, `[red]`, `[white]`, `[v:<mot de la bibliothèque>]`
  - `mot/s` petit, `/B` gros, `/I` serif italique, `/G` géant, `/i` petit italique, `/x` caché ; `mot=Affiché` pour changer le texte (`cinq=5`).
- Voix : `vo/omni/barb_{i}.wav` + horodatage `vo/omni/barb_words.json`.
- Rendu : `./produire.sh barbedit`.

## Variante « calme » (face caméra) — retour de Kadio du 28 nov.
Sur une vidéo où la personne parle face caméra, la version très coupée « en fait un peu trop, on a du mal à suivre ».
Règles de la variante calme (blocs `talk1` / `talk2`) :
- la personne reste à l'écran presque tout le temps ; 1 seule carte couleur par vidéo (pour le chiffre ou le mot clé) ;
- sous-titres sur une ligne qui se remplit mot à mot, en bas (≈ 74 %), mots clés en italique serif ou en gras mais pas géants ;
- pas de flash, pas de noir et blanc, pas d'effets de zoom brusques (un seul plan resserré possible) ;
- sons discrets : un whoosh à l'entrée de la carte, une basse douce sur le chiffre.

## Couverture (aperçu dans le fil) — obligatoire à chaque publication
Demande de Kadio : le client qui défile doit lire de quoi parle la vidéo avant de cliquer.
- `video-agent/couvertures/couverture.py <nom>` : image 1080x1920 tirée de la vidéo, assombrie, avec 3 lignes en gros
  (petit mot espacé · MOT CLÉ énorme · accroche en serif italique) + pastille + KADIO COIFFURE.
- Texte entre ≈ 900 et 1650 px de haut : visible dans la grille Instagram (4:5 et 3:4) et pas caché par l'interface TikTok ; le visage reste visible au-dessus.
- La couverture est collée en ouverture (0,4 s) et `thumbnailTimestamp: 150` la choisit comme aperçu ; elle sert aussi d'image pour Google.
- La 1re ligne de la description reprend les mots de la couverture (c'est ce qui s'affiche avant « plus »).
