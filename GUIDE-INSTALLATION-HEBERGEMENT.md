# Guide d’installation et d’hébergement Songless

Les versions prêtes à l’emploi sont publiées dans les [Releases GitHub](https://github.com/DeadSpartan8452/songless/releases). Choisis le fichier correspondant à l’appareil qui hébergera la partie. Les joueurs peuvent rejoindre avec un navigateur récent.

## Windows

1. Télécharge `Songless-Windows-x64.zip` depuis la Release.
2. Extrais l’archive dans un dossier où ton compte peut écrire.
3. Double-clique sur `Installer Songless.bat`.
4. Quand l’installation est terminée, lance Songless depuis le raccourci créé.
5. Dans le mini-menu, choisis **Lancer la version actuelle**. Choisis **Mise à jour** pour récupérer la dernière version stable.

Pour une première installation, la mise à jour automatique est disponible après cette installation initiale. La mise à jour remplace les fichiers du programme ; les chansons, playlists, profils et réglages restent dans `Songless-Data`.

## Linux

Le paquet vise Linux x86-64 avec glibc 2.28 ou plus récente.

1. Télécharge `Songless-Linux-x64.tar.gz` depuis la Release.
2. Extrais l’archive dans un dossier accessible en écriture.
3. Ouvre un terminal dans le dossier extrait.
4. Lance `./Songless`.
5. Dans le mini-menu, choisis **Lancer la version actuelle** ou **Mise à jour depuis GitHub**.

La mise à jour ne remplace que le programme. Les chansons, playlists, profils et réglages restent dans les dossiers personnels XDG, généralement sous `~/.local/share/songless`. Le terminal doit rester ouvert pendant l’hébergement ; le fermer arrête le serveur. Pour proposer la partie sur le réseau Wi-Fi local, lance `./Songless --lan`.

## Android

1. Télécharge `Songless-Android.apk` depuis la Release et transfère-le sur le téléphone.
2. Ouvre l’APK et suis les demandes d’installation d’Android. Si Android le demande, autorise temporairement l’installation depuis l’application utilisée pour ouvrir l’APK.
3. Ouvre Songless et choisis **Lancer la version actuelle** pour héberger, ou **Mise à jour** pour rechercher une nouvelle APK.
4. Lors d’une mise à jour, Android télécharge l’APK et affiche son installateur. Confirme l’installation. Android peut demander une autorisation d’installation depuis Songless.

Les mises à jour Android conservent les données privées de l’application si l’APK est signé avec la même clé. Les APK publiées ne contiennent pas la bibliothèque musicale de l’hôte.

## Données et chansons

La fonction de mise à jour télécharge et remplace les fichiers de l’application. Elle ne supprime pas les chansons, playlists, profils ou réglages présents dans les espaces de données prévus pour chaque système. Les archives de Release ne contiennent pas ta bibliothèque musicale et Songless ne télécharge pas de chansons depuis GitHub pendant une mise à jour.

Ferme la partie avant de mettre à jour sur Windows ou Linux. Sur Android, termine ou arrête l’hébergement avant de confirmer l’installation proposée par Android.

## Héberger une partie Internet avec Tailscale Funnel

**Funnel est intégré au lanceur Windows uniquement.** Linux et Android savent héberger en local et sur le Wi-Fi, mais n’activent pas Funnel eux-mêmes. Ils peuvent tout de même rejoindre une partie Internet hébergée par un PC Windows, depuis le navigateur.

Sur le PC Windows qui héberge la partie :

1. Installe Tailscale depuis [tailscale.com](https://tailscale.com/) et connecte le PC au compte Tailscale prévu pour Songless.
2. Active Funnel pour cet appareil dans Tailscale. L’autorisation doit être disponible pour le compte ou le tailnet concerné.
3. Installe Songless avec le paquet Windows et lance le raccourci **Songless Internet** (ou choisis le mode Internet dans le lanceur).
4. Suis les instructions affichées par Songless. Il vérifie le compte Tailscale actif avant de démarrer le tunnel.
5. Partage avec les invités le lien HTTPS d’invitation affiché par Songless. Ils l’ouvrent dans un navigateur ; ils n’ont pas besoin d’installer Tailscale ni d’avoir un compte Tailscale.

Le PC hôte doit rester allumé et connecté à Internet pendant toute la partie. Songless n’a pas besoin d’un serveur central ni d’une redirection de port sur la box. Un téléphone Android ou un PC Linux peut rejoindre le lien HTTPS dans son navigateur, mais ne peut pas fournir Funnel avec son lanceur actuel.

## Fichiers de la Release

- `Songless-Windows-x64.zip` : installation hôte Windows 64 bits.
- `Songless-Linux-x64.tar.gz` : hôte Linux x86-64.
- `Songless-Android.apk` : application hôte Android.
- `Songless-SHA256SUMS.txt` : empreintes SHA-256 des trois paquets, pour vérifier les téléchargements.

