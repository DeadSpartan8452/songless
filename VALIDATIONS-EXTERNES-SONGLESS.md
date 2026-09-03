# Validations externes restantes — Songless

Dernière mise à jour vérifiée : **4 septembre 2026**.

Ce document ne remplace pas le cahier des charges. Il regroupe uniquement les
contrôles qui ne peuvent pas être terminés sur le PC actuel. Aucun achat n'est
nécessaire pour les préparer. Une plateforme ne doit jamais être déclarée
compatible avant l'exécution réelle de sa section.

## 1. POCO X5 Pro 5G

Cette validation exige le téléphone déverrouillé et l'accord de Manaël au moment
de l'installation. L'APK à tester est :

`dist\Songless-Android\Songless-Android.apk`

Empreinte SHA-256 attendue :

`06C57681EF29B3CB2549D6757A37F0C04FD8E2C5D4C6C737B43668683E7E5553`

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

## 4. Validation manuelle des métadonnées

Ce travail demande une décision musicale humaine ; aucun agent ne doit certifier
une année ou un genre au hasard. Dans **Bibliothèque**, utiliser successivement :

1. `Genres présents à confirmer` — 499 fiches au dernier comptage.
2. `Années présentes à confirmer` — 125 fiches au dernier comptage.
3. `Fiches incomplètes` — 1 419 fiches auxquelles manque au moins un champ.

Pour chaque fiche : écouter le morceau, vérifier l'artiste, distinguer la première
sortie d'une réédition, choisir le genre canonique, puis enregistrer. Les modes
sensibles restent volontairement verrouillés tant que la confiance est faible.

Ne pas envoyer les titres de la bibliothèque à MusicBrainz ou à un autre service
sans l'accord explicite de Manaël au moment du traitement.

## 5. Linux, macOS et iOS

Le code et les intentions de paquetage ne constituent pas une validation. Il faut
pour chaque système un hôte réel, une construction autonome, une installation
fraîche, un lancement sans terminal, un test réseau et un contrôle visuel. Tant
que ces preuves n'existent pas, la matrice du README doit rester « non validé ».

## Critère de clôture

Une section est close uniquement avec une preuve reproductible et un résultat
noté. Un manque de matériel, de secret ou d'environnement reste documenté comme
blocage externe ; il ne doit ni provoquer un achat automatique ni être transformé
en déclaration de compatibilité.
