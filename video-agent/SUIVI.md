# Suivi montage

## Ce que tu aimes
- ★ Style « montage dynamique » validé (voir STYLES.md, Méthode validée) + variante calme face caméra
- Couvertures avec mots-clés en gros pour le fil ; musique de fond légère différente à chaque vidéo ; une voix à la fois
- Personnage Kadi (torse), Anatomie, Mosaïque, Papier & encre, vidéos explicatives avec voix
- Motion design « verre premium » bleu nuit (style A dans STYLES.md)
- Face caméra + cartes blanches simples + chrono (style B)
- Sous-titres mot par mot, sons calés, découpage serré

## Ce que tu n'aimes pas
- MODE HIVER, Ligne Kadio, galerie / film barbier, effets « Apple » A/B/C, photos retouchées
- Voix designées (OmniVoice instruct) ; trop d'effets sur une vidéo face caméra (« on a du mal à suivre »)

## Vidéos en cours
- abonnements-kadio : v1 animée + sons (28 s)
- club-kadio-v2 : remontage animé de la vidéo Club Kadio (52 s) — à valider
- campagne des fêtes : 10 vidéos — plan dans plans/fetes-10-videos.md, à valider

- menu-kadio : 5 vidéos motion design (abonnements, famille, privilèges, tresses, locs/barbier) — livrées, à valider

## Outils installés
- 44 skills dans `.claude/skills/` (short-editing, hyperframes, remotion, earshot…)
- Hyperframes CLI testé : rendu 1080×1920 OK (`templates/verre-premium/apercu.mp4`)

## À brancher
- Voix clonée en local (Chatterbox) — OK, échantillon à valider
- Postiz (publication) — clé à ajouter dans les secrets de l'environnement
- Dossier « montage vidéo » de l'ordi — via Remote Control

## 28 nov. 2026
- Style validé et sauvegardé (STYLES.md + styles/montage-dynamique.md) ; bibliothèque de plans (592) et de musiques (49)
- Publiés : talk1 (entretien locks 65 $) et talk2 (abonnement) avec couvertures
- Bibliothèque d'effets : montage/effets (23 effets + détourage) — démo `premium/build.py effets` pas encore rendue
- EN PAUSE (demande de Kadio) : série services 5 vidéos (nattes, locks, coupe créative, twists, coupe+barbe) —
  config `premium/vo/serie/config.json`, voix faites : nattes + locks (phrase 3 locks à refaire avec « lok »), couvertures faites
