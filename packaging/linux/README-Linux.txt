SONGLESS POUR LINUX — HÔTE
==========================

Ce paquet x86-64 contient Songless et son propre runtime Node.js.
Il ne contient aucune musique, aucun profil ni aucune clé personnelle.

Installation et premier lancement
----------------------------------

1. Extraire Songless-Linux-x64.tar.gz dans un dossier accessible en écriture.
2. Ouvrir un terminal dans le dossier extrait.
3. Lancer : ./Songless
4. Choisir « Lancer la version actuelle » ou « Mise à jour depuis GitHub ».

Songless ouvre le navigateur sur l’ordinateur hôte. Pour démarrer le serveur,
le terminal reste ouvert ; le fermer arrête Songless. Un second lancement
réutilise le serveur existant au lieu d’en créer un autre.

Pour permettre aux téléphones du même réseau Wi-Fi de rejoindre la partie,
lancer : ./Songless --lan

Mise à jour
----------

La mise à jour ne remplace que les fichiers du programme. Les chansons,
playlists, profils et réglages restent dans le dossier XDG personnel. Les
archives GitHub ne servent jamais à télécharger des chansons.

Données et compatibilité
------------------------

Les morceaux, profils, réglages et métadonnées restent dans le dossier
personnel Linux, sous ~/.local/share/songless. Les réglages XDG_DATA_HOME,
XDG_CONFIG_HOME et XDG_CACHE_HOME sont respectés. SONGLESS_MUSIC_DIR permet
de choisir un autre dossier de musique.

Le paquet cible Linux x86-64 avec glibc 2.28 ou plus récente. Il ne nécessite
pas Node.js installé. Un navigateur moderne est nécessaire.

Les fonctions d’import et de téléchargement vérifient chaque fichier avec
ClamAV. Installe ClamAV depuis les dépôts officiels de ta distribution pour
utiliser ces fonctions. Les téléchargements YouTube nécessitent également
yt-dlp et ffmpeg disponibles dans le PATH.

L’hôte Linux fonctionne en local ou sur le réseau Wi-Fi. Le tunnel Internet
Tailscale du lanceur Windows n’est pas inclus dans ce paquet.
