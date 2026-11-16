# Publication Postiz

- Comptes : Facebook (Kadio Coiffure), Instagram (@kadiocoiffure), TikTok (@kadiocoiffure), Google Business (non utilisé pour la vidéo).
- La clé API n'est jamais écrite ici : elle est passée en argument (ou injectée par les secrets réseau de l'environnement).
- Envoyer une vidéo : `curl -X POST https://api.postiz.com/public/v1/upload -H "Authorization: $CLE" -F "file=@video.mp4;type=video/mp4"`
- Programmer : `python3 -I programmer_postiz.py calendrier.json medias.json 0,1,2 tiktok "$CLE"`
- TikTok : `video_made_with_ai: true` (voix off clonée par IA).
