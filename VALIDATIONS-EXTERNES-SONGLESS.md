# Validations externes restantes — Songless

Dernière mise à jour vérifiée : **30 septembre 2026** (paquets hôtes mis à jour).

Ce document ne remplace pas le cahier des charges. Il regroupe uniquement les
contrôles qui ne peuvent pas être terminés sur le PC actuel. Aucun achat n'est
nécessaire pour les préparer. Une plateforme ne doit jamais être déclarée
compatible avant l'exécution réelle de sa section.

## 1. POCO X5 Pro 5G

Cette validation exige le téléphone déverrouillé et l'accord de Manaël au moment
de l'installation. L'APK à tester est :

`dist\Songless-Android.apk`

Empreinte SHA-256 de l’APK livré :

`B3F8CACEE7AE17C50CD906CCA8E467DDFA5CC834457A0131926F1BBBDADE2764`

Taille : 212 188 551 octets. Signature v2 vérifiée, un signataire RSA 4096 bits.

Parcours utilisateur à contrôler :

1. Installer l'APK sans désinstaller une éventuelle version Songless existante.
2. Ouvrir Songless et accepter uniquement les permissions expliquées à l'écran.
3. Choisir un dossier de test contenant des copies de morceaux autorisés.
4. Vérifier que la bibliothèque apparaît et qu'un morceau peut être lu.
5. Faire rejoindre un second téléphone avec le QR joueur.
6. Vérifier séparément le QR TV et le QR télécommande administrateur.
7. Revenir à l'accueil Android pendant cinq minutes.
8. Verrouiller ensuite l'écran pendant cinq minutes.
9. Vérifier que la partie et le serveur sont toujours accessibles.
10. Rouvrir Songless et vérifier qu'aucun second serveur n'est créé.
11. Avec un nouvel accord explicite, redémarrer le POCO.
12. Vérifier le retour de la notification et du serveur après le démarrage.

Résultat à noter : modèle exact, version Android, succès ou échec de chaque étape,
heure du test et message d'erreur exact. Ne jamais copier de musique privée dans
le dépôt ni dans un rapport.

## 2. Bibliothèques Android natives 16 Kio

Le VPS Man'A Pattes ne doit pas être utilisé dans son état actuel : il ne possède
que 13 Gio libres et héberge déjà des services. Utiliser un Linux jetable ou une
machine disposant d'un espace de travail confortable, sans acheter de ressource
sans accord explicite.

Prérequis : Linux x86-64, Git, Python 3, Make, GCC, G++, `sha256sum` et Android
NDK r28. Le script refuse un autre système et vérifie le commit source attendu.

Depuis la racine du projet :

```bash
bash scripts/build-node-mobile-16k-linux.sh /chemin/vers/ndk-r28
```

Sortie attendue :

`dist/node-mobile-16k`

Ce dossier doit contenir les deux fichiers suivants et `SHA256SUMS` :

- `arm64-v8a/libnode.so`
- `x86_64/libnode.so`

Après retour de ce dossier sur le PC, reconstruire avec :

`packaging\android\Construire APK Songless.bat`

Le constructeur vérifie les deux fichiers avant de les intégrer. Le rapport
`Songless-Android-compatibilite-16K.txt` doit alors indiquer **0 bibliothèque
incompatible**. Il faut ensuite rejouer toute la section POCO.

## 3. Sauvegarde de la vraie signature Android

Cette étape exige que Manaël choisisse et saisisse lui-même un mot de passe. Le
mot de passe ne doit être communiqué ni au chat, ni à un agent, ni au dépôt.

1. Double-cliquer sur
   `packaging\android\Sauvegarder signature Android.bat`.
2. Saisir deux fois un mot de passe d'au moins 14 caractères.
3. Copier `dist\Songless-Sauvegarde-Signature` sur un support séparé.
4. Conserver le mot de passe ailleurs que sur ce support.
5. Vérifier que le fichier `.p12` et son fichier `.sha256.txt` sont présents.

La restauration a déjà été testée avec une clé factice. Ne pas restaurer la vraie
clé sur ce PC : le script refuserait de toute façon d'écraser la clé locale.

## 4. Validation des métadonnées

Manaël a autorisé le 4 septembre 2026 l'envoi des titres et artistes à
MusicBrainz, ainsi que la recherche des variantes non officielles sur YouTube.
Le traitement automatique vérifie toute la bibliothèque, conserve les
corrections manuelles et ne valide que les correspondances fortes. Les versions
Nightcore, sped up, slowed et assimilées exigent un genre, mais pas d'artiste ni
d'année. L'aperçu complet a été appliqué le 4 septembre 2026 après simulation
isolée et sauvegarde automatique. Dans **Bibliothèque**, il reste à traiter :

1. `Genres présents à confirmer` — 669 fiches au dernier comptage.
2. `Genres absents` — 297 fiches au dernier comptage.
3. `Années obligatoires absentes` — 2 fiches au dernier comptage ; leurs dates
   YouTube 2025 ne suffisent pas à prouver une première parution.
4. `Artistes présents à confirmer` — 22 fiches au dernier comptage, après
   correction vérifiée de plusieurs rapprochements de l'ancien repli par titre
   seul, désormais interdit.
5. `Fiches à revoir` — 979 fiches ayant encore au moins un point à traiter.

Les années 2012 des 14 pistes Solatorobo et les cinq identités/années corrigées
ont été appliquées le 4 septembre après simulation et sauvegarde. `Good to Be
Alive` est confirmé comme un titre de CG5 paru le 3 février 2021 par MusicBrainz
(enregistrement `43715e11-3689-445e-8011-c9581f5d62ec`) et par la publication
officielle CG5 du lendemain sur YouTube (`GYtBoxGB6Wo`).

Pour chaque fiche : écouter le morceau, vérifier l'artiste, distinguer la première
sortie d'une réédition, choisir le genre canonique, puis enregistrer. Les modes
sensibles restent volontairement verrouillés tant que la confiance est faible.

Ne jamais certifier automatiquement une correspondance ambiguë ni confondre la
date de mise en ligne d'une vidéo avec la première sortie du morceau.

## 5. Linux x86-64 — hôte

Paquet créé : `dist\Songless-Linux-x64.tar.gz` (Node.js x64 intégré, glibc 2.28
minimum). L’archive a été relue sur Windows, les exécutables ont leurs bits
d’exécution POSIX et aucun contenu de bibliothèque/profil n’y figure. Le
lancement réel sur Linux n’a pas encore été effectué faute d’environnement
Linux disponible sur ce PC.

À valider sur une machine Linux x86-64 :

1. Extraire l’archive et lancer `./Songless` dans un terminal.
2. Vérifier l’ouverture du navigateur sur l’hôte et l’arrêt en fermant le terminal.
3. Relancer Songless et confirmer qu’aucun second serveur ne se crée.
4. Tester `./Songless --lan` avec un téléphone du même Wi-Fi.
5. Vérifier l’import avec ClamAV et un téléchargement avec `yt-dlp` et `ffmpeg`.
6. Noter la distribution, sa version et la version de glibc.

Les données restent dans le dossier XDG personnel. Aucun droit administrateur
ni dossier Windows n’est requis. Le tunnel Tailscale Internet n’est pas inclus
dans le paquet Linux.

## 6. Autres systèmes

macOS, Linux ARM, iPhone et iPad ne sont pas des plateformes hôtes prévues.
Ils restent utilisables par navigateur comme joueur, TV ou télécommande. Aucun
installateur hôte n’est attendu sur ces systèmes.

## Critère de clôture

Une section est close uniquement avec une preuve reproductible et un résultat
noté. Un manque de matériel, de secret ou d'environnement reste documenté comme
blocage externe ; il ne doit ni provoquer un achat automatique ni être transformé
en déclaration de compatibilité.

## Mise à jour du 22 septembre 2026 — lot playlists

L'APK à conserver remplace l'empreinte historique indiquée plus haut :

- taille : 212 266 531 octets ;
- SHA-256 :
  `18F69D1341EFB65C1904D69B0DB6E2C8B65262F2C32BCFEB0F4BEEB9F7D9FDDB` ;
- signature v2 valide, unique signataire RSA 4096 bits ;
- 56 bibliothèques natives contrôlées, avec seulement les deux `libnode.so`
  encore non natifs 16 Kio.

Manaël a demandé de ne plus attendre le test POCO pour cette livraison. Cette
décision retire le test du chemin de clôture actuel sans transformer l'absence
de test matériel en preuve de compatibilité. La reconstruction Linux des deux
`libnode.so` reste une amélioration externe documentée.

La sauvegarde portable de signature a été créée hors dépôt dans
`C:\Users\Dead Spartan\Codex\Songless-Sauvegarde-Signature-2026-09-22` après
autorisation explicite de cette destination. Le PKCS12 contient l'alias
`songless`, sa lecture avec le mot de passe choisi a réussi, son SHA-256 livré
correspond à l'empreinte recalculée et aucun fichier temporaire ne subsiste.
Le mot de passe n'a été écrit dans aucun fichier. Il reste recommandé de copier
ce dossier sur un support physique séparé du PC.

## Mise à jour du 30 septembre 2026 — paquets Windows, Linux et Android

Trois fichiers transférables sont générés par `Build Songless.bat` :

- Windows x64 : `Songless-Windows-x64.zip`, 243 226 323 octets,
  SHA-256 `9E22E033F7DE5493DC774228CBEE72090ACF667EC4AC301E0844A6FE92BCE8F3` ;
- Linux x86-64 : `Songless-Linux-x64.tar.gz`, 50 655 235 octets,
  SHA-256 `B0D4817409427DCFE7BC87A2EC97E67C6B5D5FF88304730EFA435AD4B7360577` ;
- Android : `Songless-Android.apk`, 212 188 551 octets,
  SHA-256 `B3F8CACEE7AE17C50CD906CCA8E467DDFA5CC834457A0131926F1BBBDADE2764`.

Les contrôles ZIP/TAR confirment l’absence de musique, profils, métadonnées
personnelles et clés ; le manifeste Windows indique `personalDataIncluded=false`.
Le runtime Node Linux 24.15.0 a été téléchargé depuis `nodejs.org` et comparé
au manifeste SHA-256 officiel. Les dépendances Linux ont été installées depuis
`registry.npmjs.org` avec leurs scripts d’installation désactivés. Multer est
passé en 2.4.0 ; l’audit npm de l’ensemble Linux indique zéro vulnérabilité
connue.

L’APK a été reconstruit, signé en v2 et vérifié. Le contrôle d’alignement Android
retrouve encore deux bibliothèques `libnode.so` non natives 16 Kio ; l’APK reste
fonctionnel en mode de compatibilité. Le test POCO n’a pas été effectué et reste
hors du chemin de clôture demandé le 22 septembre.

La reconstruction Android a d’abord révélé un cache d’autolink Gradle contenant
des chemins vers l’ancien clone Gemini. Le constructeur purge désormais ce
cache précis avant Gradle ; il restaure également les dépendances Android
verrouillées si elles manquent. La compilation Release est ensuite passée.

Le paquet Linux n’a pas encore été démarré sur une machine Linux réelle. Les
tests du projet n’ont pas été lancés. Aucune publication, installation Android
sur téléphone, modification du système Windows ou dépense n’a été effectuée.

## Recontrôle local du 30 septembre 2026

La suite complète `npm.cmd test` a été exécutée après les changements du jour
et s’est terminée sans échec. Cela valide les scénarios automatisés sur la
copie source locale, mais ne change pas les validations matérielles ouvertes :
lancement Linux réel, essai sur POCO et compatibilité native Android 16 Kio.
Les paquets présents dans `dist/` précèdent le changement de quotas et devront
être reconstruits pour le transférer dans Windows, Linux et Android.
### Reconstruction des trois livrables — 30 septembre 2026

Le constructeur local a régénéré Windows, Linux et Android après la modification
des quotas. L’inspection des paquets confirme que l’interface et la logique
serveur mises à jour sont présentes dans les trois fichiers. APK Release
reconstruit avec Gradle, signature v2 et signataire RSA 4096 bits vérifiés.
Les empreintes et tailles finales sont dans la section 30 septembre du cahier
des charges et dans `dist\Songless-SHA256SUMS.txt`.

Cette reconstruction ne remplace pas les essais matériels : le paquet Linux
n’a pas été lancé sur Linux réel, le POCO n’a pas été testé et deux `libnode.so`
restent en mode de compatibilité Android 16 Kio.
