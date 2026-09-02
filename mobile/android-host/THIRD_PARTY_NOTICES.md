# Composants antivirus Android

L’APK Songless Android embarque `clamscan` et ses bibliothèques d’exécution afin
de contrôler les imports localement, sans envoyer les musiques sur Internet.

- ClamAV 1.5.4 — Copyright Cisco Systems, Inc. et contributeurs — GPL-2.0
  — source : https://github.com/Cisco-Talos/clamav/tree/clamav-1.5.4
- Paquets Android fournis par Termux — recettes et correctifs :
  https://github.com/termux/termux-packages
- Dépôt binaire utilisé par le constructeur :
  https://packages.termux.dev/apt/termux-main/
- Bases de signatures officielles ClamAV (`main.cvd` et `daily.cvd`) :
  https://database.clamav.net/

Les versions et empreintes SHA-256 exactes de chaque paquet et de chaque base
sont épinglées dans `scripts/build-android-antivirus.js`. Le constructeur refuse
un téléchargement dont l’empreinte a changé afin qu’une nouvelle version soit
auditée avant son intégration.

Les bibliothèques transitives conservent leurs licences amont respectives. Leur
provenance, leur version et leur paquet Termux exact sont également déclarés
dans le constructeur. Ce fichier doit accompagner toute distribution de l’APK.
