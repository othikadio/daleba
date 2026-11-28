# Bibliothèque d'effets Kadio

Ajoutée le 28 nov. 2026 à partir de deux références envoyées par Kadio :
une capture (carte d'app « Installing… » + sous-titre en bande deux tons) et une vidéo « 20 effets en 20 secondes ».
But : **varier les vidéos** en piochant 2 à 4 effets par vidéo, jamais toujours les mêmes, au service du propos.

Fichiers : `effets.js` (code), `effets.css` (styles), `ascii.py` (image → portrait en caractères).
Démo : `premium/build.py effets` → `exports/kadio-premium-effets.mp4`.
Utilisation dans un bloc de `build.py` : ajouter `open(effets.css)` au CSS et `open(effets.js)` au JS, puis appeler `FX.nom(t, durée, options)`.

| # | Effet | Appel | Bon pour |
|---|---|---|---|
| 01 | Curseur | `FX.curseur(t, d, {x, y, click})` | montrer un bouton, un prix, « clique ici » |
| 02 | Carte app | `FX.carte(t, d, {titre, sous, bouton, encours, fini, icone})` | réservation en ligne, abonnement Club Kadio |
| 03 | Sous-titre deux tons | `FX.bande([[mot, temps], …], {par, top})` | alternative aux sous-titres mot à mot (style podcast) |
| 04 | Cadran | `FX.cadran(t, d, {libelles, cible})` | jour de rendez-vous, nombre de semaines, étapes |
| 05 | Touches | `FX.touches(t, d, {mot})` | un mot clé tapé au clavier (KADIO, LOCKS, RDV) |
| 06 | Anneau | `FX.anneau(t, d, {texte, top})` | texte qui tourne autour d'une tête / d'une coiffure |
| 07 | Mur de posts | `FX.mur(t, d, {images, n, total, suffixe})` | « 1 711 clients », portfolio, avant/après en masse |
| 08 | Commentaires | `FX.commentaires(t, d, {liste:[[nom, texte]], top})` | appel à l'action « Commente RDV » |
| 09 | Croquis | `FX.croquis(t, d, {mot, couleur, top})` | un mot dessiné au crayon puis rempli |
| 10 | Lame | `FX.lame(t, d, {image, bandes, etiquettes})` | décomposer une coupe : dégradé / contour / barbe |
| 11 | Mise au point | `FX.miseaupoint(t, d, sélecteur, {de, a})` | passage flou → net, révélation |
| 12 | Billet | `FX.billet(t, d, {image, num, texte})` | prix, abonnement, « ça vaut le coût » |
| 13 | Note vocale | `FX.notevocale(t, d, {top})` | témoignage client, message vocal |
| 14 | Image choc | `FX.impact(t, d, {image, mot})` | mot fort en BD noir et blanc + lignes de vitesse |
| 15 | Zoom dolly | `FX.dolly(t, d, sélecteur)` | moment dramatique, révélation du résultat |
| 16 | Une de journal | `FX.journal(t, d, {image, titre, sous})` | « la nouvelle du jour », promo, ouverture |
| 17 | Déchirure | `FX.dechirure(t, d)` | transition : le papier se déchire pour ouvrir la scène |
| 18 | Couches 3D | `FX.couches(t, d, {image, libelles})` | « les coulisses » : photo, couleur, texte, son |
| 19 | Corps en code | `FX.code(t, d, {ascii})` (+ `ascii.py`) | look tech/IA, portrait en caractères |
| 20 | Envol | `FX.envol(t, d, {image, col, lig})` | fin de vidéo : l'image s'envole en morceaux |
| 21 | Texte derrière la personne | `FX.derriere(t, d, {image, detoure, mot, couleur})` | gros mot entre le fond et le client (NATTES, LOCKS) |
| 22 | Rangée de clones | `FX.clones(t, d, {image, detoure, n, echelle})` | « tous nos clients », effet de série |
| 23 | Pile de têtes | `FX.pile(t, d, {image, detoure, n})` | effet surprise, multiplication |
| + | Liste « Dans cette vidéo » | `FX.liste(t0, t1, items, temps)` | séries, tutoriels en étapes |

## Détourage (pour les effets 21 à 23)
`detoure.py` (MediaPipe, modèle inclus, aucun téléchargement) : photo -> `cut_<photo>.png` transparent, cadré en 1080x1920.
`PYTHONPATH=/opt/mp-lib /opt/voix/bin/python -S montage/effets/detoure.py photo.jpg cut_photo.png`
(installé dans /opt/mp-lib ; à réinstaller si la machine est neuve : mediapipe==0.10.14 + numpy 1.26 + protobuf 4.25 + opencv-headless).

## Règles d'usage
**Les effets sont un assaisonnement, pas la base.** La base reste la méthode validée par Kadio
(`video-agent/STYLES.md`, section « Méthode validée ») : texte mot à mot calé sur la voix, coupes rapides,
aplats couleur / blanc, photos du salon + plans de la bibliothèque, une voix, musique de fond légère, couverture lisible.
- 2 à 4 effets par vidéo au maximum ; sur une vidéo face caméra, version calme (1 ou 2 effets).
- Chaque effet doit illustrer ce qui est dit (prix → billet, réservation → carte app, étapes → lame ou cadran).
- Varier d'une vidéo à l'autre : noter dans la publication quels effets ont servi.
