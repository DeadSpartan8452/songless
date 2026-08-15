# Songless — blind test local

Clone de Songless / Heardle qui tourne sur ta machine, avec ta propre
bibliothèque musicale.

**Raccourci `Songless` sur le Bureau** : double-clic, ça démarre le serveur et
ouvre le jeu. Rien d'autre à faire.

Une fenêtre réduite « Songless - serveur » apparaît dans la barre des tâches :
**la fermer arrête Songless**. Relancer le raccourci quand le jeu tourne déjà
n'ouvre qu'un onglet, ça ne démarre pas un second serveur.

En ligne de commande si besoin :

```
npm start          →  http://localhost:3000
```

Le raccourci pointe sur `Songless.ps1`, à la racine du projet. Si tu déplaces le
dossier, recrée-le (clic droit sur le Bureau → Nouveau → Raccourci) avec :

```
powershell.exe -NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File "<chemin>\Songless.ps1"
```

---

## Ce qui a été ajouté

| Fonction | Où |
|---|---|
| Téléchargement d'un morceau depuis un titre | onglet **Bibliothèque**, ou `tools/download.js` |
| Import d'une playlist YouTube entière | onglet **Bibliothèque** → « Importer une playlist » |
| Titres renommés en noms compréhensibles | `tools/enrich.js` + `lib/overrides.json` |
| Années de sortie | `tools/years.js` |
| Tri et filtre par genre | barre du haut de l'onglet **Jouer** |
| Filtre par décennie | même panneau, sous les genres |
| Seed aléatoire par partie | barre du haut de l'onglet **Jouer** |
| Deviner le titre, l'artiste ou l'année | **Jouer** → bouton « Options » |
| Extrait accéléré, à l'envers, ou démarré au refrain | **Jouer** → bouton « Options » |
| Durée des six essais réglable | **Jouer** → bouton « Options » → Paliers |
| Profils de joueur (statistiques séparées) | bouton en haut à droite |
| Parties de 5, 10, 20 ou 50 morceaux | onglet **Modes** |
| Entraînement intelligent sur les morceaux à revoir | onglet **Modes** |
| Collections et défis rejouables | onglet **Modes** |
| Soirée multijoueur classique ou buzzer | onglet **Modes** |
| Export/import complet des données de jeu | onglet **Modes** |
| Statistiques par genre et par artiste | onglet **Statistiques** |
| Résumé de partie à partager | bouton « Partager » en fin de manche |
| Télécommande Kahoot sur téléphone | `Songless (telephone).bat` + bouton 📱 |
| Détection de doublons | automatique au téléchargement + `tools/dedupe.js` |
| Diagnostic de la bibliothèque | onglet **Bibliothèque** → « État de la bibliothèque » |

---

## 0. Jouer depuis le téléphone

Double-clic sur **`Songless (telephone).bat`** au lieu du raccourci habituel.
Le serveur écoute alors aussi le wifi de la maison, et affiche un QR code dans
sa fenêtre — le bouton 📱 en haut du jeu affiche le même, en plus lisible.

Le téléphone doit être sur le **même wifi**. Le QR code contient un jeton
d'appairage temporaire, recréé à chaque lancement, et ouvre une page mobile
séparée. Une pop-up demande immédiatement de choisir un profil existant ou d'en
créer un. Ce choix n'est jamais mémorisé : chaque ouverture ou actualisation le
redemande. Le joueur entre ensuite le code de 5 caractères affiché sur le PC.

Le téléphone est uniquement une **manette façon Kahoot** : réponse, buzzer,
verdict et classement. Il n'affiche ni lecteur audio, ni boutons du pavé
numérique, ni bibliothèque, ni réglages. Il peut toutefois offrir une musique
par son titre, une URL ou un fichier audio. Il ne peut ni consulter, éditer ou
supprimer les morceaux, ni créer une collection ou commander la partie. Le PC
reste l'unique hôte et diffuse la musique.

En ligne de commande : `node server.js --lan`.

### Invitations et accès Internet

Chaque soirée affiche un bouton **Copier le lien même wifi**. Le lien contient
un secret aléatoire propre au salon : connaître seulement le code à cinq
caractères ne suffit pas pour entrer depuis Internet. Quand le tunnel HTTPS est
configuré, un second bouton copie le lien Internet.

Le mode Internet tourne exclusivement sur ce PC avec Tailscale Funnel. Il
n'utilise aucun serveur distant personnel et n'ouvre aucun port entrant sur la
box. Funnel fournit gratuitement une adresse `https://…ts.net` et son
certificat ; Songless ajoute un secret d'invitation,
des commandes d'hôte séparées, une limitation de débit, des en-têtes de sécurité,
des URL distantes limitées à YouTube, un plafond mobile de 200 Mo et l'analyse
Microsoft Defender.

Le lancement se fait par **`Songless.bat`** après connexion gratuite
à Tailscale. Les invités ouvrent le lien dans leur navigateur sans compte et
sans installer Tailscale.

Le lanceur est protégé par une instance unique : un second double-clic, même
sur les anciens lanceurs téléphone ou Internet, n'ouvre ni onglet, ni console,
ni tunnel supplémentaire.

---

## 1. Ajouter une musique

### Depuis le site
Onglet **Bibliothèque** → « Télécharger une musique ». Tu tapes un titre
(ou colles un lien), le MP3 est téléchargé, converti, renommé proprement et
ajouté au jeu avec son genre. La progression s'affiche en direct.

### Par fichier ou par archive
Onglet **Bibliothèque** → zone de dépôt. Tu peux y glisser :

- un fichier audio isolé ;
- une **archive `.zip`** entière : elle est décompressée, chaque morceau est
  trié (titre rendu lisible, genre, alias) et **les doublons sont supprimés
  automatiquement** — qu'ils fassent doublon avec ta bibliothèque ou entre eux
  à l'intérieur de l'archive.

Un rapport s'affiche à la fin : ce qui a été ajouté, ce qui a été écarté comme
doublon, et ce qui a échoué. Sur une grosse archive, seuls les 40 premiers
genres inconnus sont cherchés en ligne (MusicBrainz impose une requête par
seconde) ; `node tools/enrich.js` complète le reste ensuite.

### Grosse archive : passer par le terminal
Le navigateur doit envoyer l'archive entière au serveur, qui l'écrit dans
`.cache` avant de la décompresser : ça occupe deux fois la place et c'est long.
Pour une grosse archive, ou pour un dossier déjà rangé sur un disque :

```bash
node tools/import.js "D:\musiques.zip"
node tools/import.js "D:\Ma collection"            # dossier, sous-dossiers compris
node tools/import.js "D:\Ma collection" --deplacer # vide le dossier source
node tools/import.js "D:\musiques.zip" --hors-ligne
node tools/import.js "D:\musiques.zip" --sans-plafond   # tous les genres cherchés en ligne
```

Même traitement que par le site (titre lisible, genre, alias, doublons
écartés), sans plafond de taille et sans recopie. Au-delà de 400 Mo,
l'archive est décompressée en flux par `tar` — celui de Windows — au lieu
d'être chargée en mémoire.

Depuis le site, le plafond est de 32 Go.

### En ligne de commande

```bash
node tools/download.js "Darude Sandstorm"
node tools/download.js "https://youtu.be/xxxx" --genre "Meme / Internet"
node tools/download.js "Gdzie jest bialy wegorz" --title "Polish Cow"
node tools/download.js --file chansons.txt
node tools/download.js --check      # vérifie yt-dlp et ffmpeg
node tools/download.js --genres     # liste des genres
```

Format de `--file` (une ligne par morceau, `#` pour commenter) :

```
titre ou URL | genre | titre affiché
Darude Sandstorm | Électro / EDM
https://youtu.be/xxx | Meme / Internet | Polish Cow
```

**Doublons** : avant de télécharger, le morceau est comparé à toute la
bibliothèque (titre affiché, titre d'origine, artiste, durée). S'il existe
déjà — même sous un nom de fichier complètement différent — le
téléchargement est annulé et le fichier existant t'est indiqué.
`--force` passe outre.

### Outils requis
`yt-dlp` (téléchargement) et `ffmpeg` (conversion MP3). Déjà installés ici.
Pour les réinstaller ailleurs :

```bash
pip install yt-dlp
winget install Gyan.FFmpeg
```

Ils sont détectés automatiquement, y compris dans les dossiers winget, sans
avoir à toucher au PATH.

---

## 2. Titres lisibles

Un nom de fichier YouTube n'est pas une réponse jouable. Chaque morceau reçoit
donc un **titre affiché** (la réponse à deviner) et garde son **titre
d'origine** à part, montré à la fin de la partie.

Les règles, dans l'ordre :

1. **`lib/overrides.json`** — les morceaux connus sous un autre nom que leur
   titre réel. C'est là que se règle le cas que tu citais : le morceau polonais
   *Gdzie jest biały węgorz ?* s'appelle **Polish Cow** dans le jeu, et les deux
   formes sont acceptées à la saisie. Le fichier est fait pour être complété à
   la main.
2. **Alphabets non latins** — le cyrillique et le grec sont translittérés
   automatiquement (Пыяла → Pyyala). Le japonais, le chinois et le coréen ne se
   translittèrent pas utilement : ils sont signalés pour être nommés à la main.
   Les 28 cas de la bibliothèque ont été traités (`tools/fix-cjk-titles.js`).
3. **Langues latines étrangères** — les 15 titres concernés (espagnol,
   portugais, vietnamien, polonais…) ont été nommés dans
   `tools/fix-latin-titles.js`.
4. **Anglais et français** — laissés tels quels, seulement débarrassés du bruit
   (« Official Video », « Lyrics », « _CBR_256k », identifiants YouTube…).

Les titres anglais restent en anglais, comme demandé.

### Corriger un titre
Bouton crayon dans la liste de l'onglet **Bibliothèque**, ou :

```bash
node tools/retitle.js --review                     # ce qui reste à nommer
node tools/retitle.js "nom du fichier.mp3" --title "Nom connu" --genre "Pop"
node tools/retitle.js "fichier.mp3" --alias "autre réponse acceptée"
```

Une fiche corrigée à la main est marquée comme validée : `tools/enrich.js` ne
l'écrasera plus.

---

## 3. Genres

17 genres, comptés et filtrables. Dans l'onglet **Jouer**, le bouton
« Genres » ouvre la liste : tu coches ceux que tu veux jouer, la partie se
limite à ceux-là. L'onglet **Bibliothèque** a le même filtre pour parcourir ta
collection.

Le genre vient, dans l'ordre : de `overrides.json`, du tag ID3 du fichier, des
tags MusicBrainz de l'artiste, puis d'indices dans le nom de fichier
(« OST », « Undertale », « anime »…).

```bash
node tools/enrich.js                # met à jour toute la bibliothèque
node tools/enrich.js --no-network   # sans MusicBrainz, instantané
node tools/enrich.js --force        # réécrit même les fiches validées
```

MusicBrainz impose une requête par seconde : le premier passage est long, les
suivants lisent le cache disque (`.cache/`) et sont immédiats.

---

## 4. Seed aléatoire

**Une seed = un ordre de passage précis.**

- Une nouvelle seed est tirée **à chaque lancement** du jeu (aléatoire
  cryptographique du navigateur).
- Le bouton **Nouvelle seed** en tire une autre et repart du premier morceau.
- Le bouton **lien** copie l'adresse `?seed=XXXX` : la rouvrir rejoue
  exactement la même suite.
- Le bouton **crayon** permet de saisir une seed à la main.

Ce que la seed détermine :

- l'ordre des morceaux (mélange Fisher-Yates piloté par un générateur
  déterministe amorcé par la seed) ;
- le passage joué dans chaque morceau — deux parties sur la même seed sont
  strictement identiques.

Le mélange porte sur **toute** la bibliothèque, et le filtre par genre s'applique
seulement ensuite : cocher ou décocher un genre ne rebat pas les cartes, ça
retire juste des morceaux de la file. Le compteur « Morceau 12 / 340 » indique
où tu en es.

---

## 4 bis. Navigation entre les chansons, et anti-triche

Raccourcis pendant une manche :

| Touche | Effet |
| --- | --- |
| `Espace` | lancer / mettre en pause / relancer l'extrait |
| `Pav. 1` | passer (essai consommé, palier de temps débloqué) |
| `Pav. 2` | chanson suivante |
| `Pav. 3` | chanson précédente |

**Revenir en arrière ne remet pas les compteurs à zéro.** Chaque manche entamée
est mémorisée pour la durée de la session : `Pav. 3` restitue la chanson **dans
l'état où tu l'as laissée**, avec ses essais déjà consommés. Sans ça, il
suffisait de faire un aller-retour pour récupérer six essais neufs sur une
chanson déjà largement entendue.

La chanson bascule en **écoute seule** — dévoilée, écoutable en entier, plus
jouable — dans trois cas :

- plus de **2 essais** consommés (skips et mauvaises réponses confondus) : trop
  d'indices entendus pour que la reprise soit honnête ;
- manche **gagnée** ;
- manche **perdue**.

Rien n'est recompté dans les statistiques : une manche n'y entre qu'une fois, au
moment où elle se termine vraiment.

Tirer une **nouvelle seed** efface cette mémoire — l'ordre et les passages joués
changent, c'est une autre partie.

---

## 4 ter. Écouter un morceau depuis la bibliothèque

Chaque ligne de la bibliothèque a un bouton **▶**. Il joue le morceau en entier,
sans rapport avec la manche en cours : la ligne se souligne en violet, le bouton
passe en pause, et le lecteur du jeu se coupe — une seule source à la fois.
L'aperçu s'arrête tout seul quand tu quittes l'onglet, quand tu relances un
extrait du jeu, ou quand la liste est actualisée.

Pratique pour vérifier qu'un fichier fraîchement importé se lit bien, ou pour
retrouver à quoi ressemble un titre avant de le renommer.

---

## 4 quater. Options de manche

Bouton **Options**, à côté du filtre de genres. Tout y est enregistré par
profil : chacun garde sa façon de jouer.

### Ce qu'il faut deviner

| Mode | Ce qu'on tape | Bon si |
|---|---|---|
| **Le titre** | le nom du morceau (autocomplétion) | c'est le bon morceau |
| **L'artiste** | un nom d'artiste (autocomplétion) | il fait partie des crédits — pour « 6arelyhuman, asteria », répondre « asteria » suffit |
| **L'année** | quatre chiffres | à **2 ans près** |

Les modes « artiste » et « année » **réduisent la liste jouable** : un morceau
sans artiste ou sans année n'a pas de réponse, il est écarté du tirage. Le
compteur sous les boutons dit combien il reste de morceaux jouables.

Un essai raté en mode année indique la direction : *« 1999 — c'est plus
récent ↑ »*.

### Comment sonne l'extrait

- **Vitesse** — ×0,75 à ×1,5. La hauteur du son suit la vitesse (effet
  « chipmunk »), c'est ce qui rend l'exercice retors. Le palier reste compté en
  **secondes de musique** : à ×1,5 tu entends la même chose, en moins de temps.
- **Sens** — à l'endroit ou **à l'envers**. À l'envers, le morceau est décodé
  en entier dans le navigateur (quelques centaines de millisecondes, un message
  l'annonce), puis l'extrait remonte le temps depuis son point de départ.
- **Départ** — tiré par la seed (par défaut), **au refrain** (le passage le plus
  énergique du morceau, hors intro et hors final), ou au tout début.

Une fois le morceau dévoilé, il se réécoute toujours normalement : à l'endroit,
à vitesse normale.

### Paliers

Trois préréglages, plus un mode sur mesure :

| | 1 | 2 | 3 | 4 | 5 | 6 |
|---|---|---|---|---|---|---|
| Facile | 1 s | 3 s | 6 s | 10 s | 20 s | 30 s |
| Normal | 0,2 s | 0,7 s | 2,5 s | 5 s | 9 s | 15 s |
| Hardcore | 0,1 s | 0,3 s | 0,8 s | 2 s | 4 s | 7 s |

La barre du haut se redécoupe automatiquement. Il y a toujours six essais :
seules les durées changent.

---

## 4 quinquies. Décennies et années

Sous les pastilles de genre, le même système par décennie. Attention à ce que
ce filtre promet : **l'année n'est connue que pour une partie de la
bibliothèque**, et le compte exact est affiché à côté du titre « Décennies ».
« Sans année » est un lot comme un autre, pas un oubli.

Pour remplir les années :

```bash
node tools/years.js                  # tous les morceaux sans année
node tools/years.js --limit 100      # s'arrêter après 100 recherches réseau
node tools/years.js --cache-only     # hors ligne, n'utilise que le cache
node tools/years.js --force          # réinterroger ceux qui ont déjà une année
```

L'année vient de la **première parution** de l'enregistrement selon MusicBrainz
— la bonne définition : l'année du morceau, pas celle de la vidéo YouTube (ce
que faisait le téléchargeur, d'où des années 2020 partout). Une chanson de 1985
rééditée en compilation reste datée de 1985.

MusicBrainz impose une requête par seconde : comptez une demi-heure pour 1 500
morceaux. Le script est **reprenable** — coupez-le, relancez-le, le cache disque
(`.cache/musicbrainz-years.json`) le fait repartir où il en était. Le taux de
trouvaille tourne autour de 30 % sur une bibliothèque très « internet »
(nightcore, memes, OST de jeux) : ces morceaux-là ne sont pas catalogués.

---

## 4 sexies. Profils

Bouton en haut à droite. Chaque profil a **ses statistiques, son historique et
ses réglages** ; la bibliothèque, elle, reste commune. Les statistiques
existantes ont été rattachées au premier profil, rien n'est perdu.

Le **crayon** renomme un profil (nom et emoji) : Entrée valide, Échap annule.
Renommer ne touche qu'à l'affichage — les statistiques suivent le profil.

Supprimer un profil efface aussi ses statistiques — la confirmation le dit.

---

## 4 septies. Modes de jeu, collections et soirées

L'onglet **Modes** regroupe les parties avec une vraie fin (5, 10, 20 ou 50
morceaux), le mode sans fin habituel et l'entraînement intelligent. Celui-ci
fait remonter d'abord les morceaux ratés, jamais joués ou qui n'ont pas été vus
depuis longtemps. Le bilan apparaît à la dernière manche et empêche de dépasser
la limite par le bouton ou le pavé numérique.

Une **collection** mémorise les morceaux correspondant aux genres, décennies et
autres filtres actuellement actifs. Un **défi** mémorise en plus la seed, les
réglages d'extrait et le nombre de manches : le bouton « Rejouer » restaure la
même partie.

Pour une soirée, le PC crée un salon puis partage son code de 5 caractères. Le
PC n'est pas compté comme joueur : il lance les manches, diffuse la musique et
révèle les réponses. Les téléphones rejoignent avec leur profil partagé. Deux
variantes sont proposées :

- réponses simultanées, avec bonus de rapidité ;
- buzzer, où seul le premier joueur peut envoyer sa réponse.

Chaque variante conserve séparément ses options : réponse attendue, vitesse,
sens, départ de l'extrait, durée et points. Score et compteurs de session
repartent de zéro à chaque salon. Les totaux globaux restent attachés au profil
et sont enregistrés sur le PC.

Les réponses sont vérifiées par le serveur, jamais par le téléphone. Avant la
révélation, une manette ne reçoit ni l'identifiant du morceau ni le verdict des
autres joueurs. Les joueurs, l'ordre des buzzers et les scores sont actualisés
toutes les secondes sans interrompre une réponse en cours de saisie.

La **sauvegarde complète** exporte un JSON contenant profils, statistiques,
historique, réglages, collections et défis. L'import crée d'abord une copie de
sécurité automatique dans `metadata-backups/`, puis remplace ces données. Les
fichiers musicaux ne font jamais partie de cette sauvegarde.

---

## 5. Doublons

```bash
node tools/dedupe.js            # liste les doublons probables
node tools/dedupe.js --apply    # supprime le fichier en trop
```

Deux fichiers sont considérés comme le même morceau s'ils partagent titre
d'origine, ou titre + artiste, ou **les mêmes mots répartis autrement** entre
titre et artiste — **et** une durée proche (à 5 % près). Cette dernière règle
rattrape le cas courant du même morceau enregistré deux fois sous deux noms de
fichier différents : `ADDICT - HAZBIN HOTEL FR.mp3` était lu comme *artiste
ADDICT + titre HAZBIN HOTEL FR*, quand `ADDICT HAZBIN HOTEL FR CBR-.mp3`
donnait un titre entier sans artiste. Mêmes mots, même durée : même morceau.

La durée évite de confondre deux versions : le Megalovania d'Undertale (2:36)
et celui de Deltarune (3:04) restent deux morceaux distincts. En cas de
doublon, le fichier le plus ancien est gardé et récupère le meilleur titre des
deux.

**Rien n'est détruit.** Le fichier écarté part dans `.cache/corbeille`, que ce
soit par `dedupe.js` ou pendant un import. Une détection de doublon reste une
supposition : si elle se trompe, le fichier se récupère. Vide ce dossier quand
tu es sûr.

Pour corriger un titre et un artiste inversés :

```bash
node tools/retitle.js "fichier.mp3" --title "Addict" --artist "" --original ""
```

---

## 6. Importer une playlist entière

Onglet **Bibliothèque** → « Importer une playlist ». Colle l'adresse d'une
playlist YouTube, choisis éventuellement un genre imposé et un plafond de
titres, puis lance : chaque morceau passe par exactement le même chemin qu'un
ajout à l'unité (titre lisible, genre, alias, écartement des doublons).

Le journal rend compte titre par titre, et un morceau bloqué ou supprimé
n'interrompt pas les suivants — sur cinquante titres, il y en a toujours un qui
coince. Fermer l'onglet arrête l'import en cours.

Le plafond par défaut est de 50 titres, réglable jusqu'à 500. Si la playlist est
plus longue que le plafond, le journal le dit au lieu de tronquer en silence.

**Spotify et Deezer ne sont pas lisibles** par yt-dlp : leurs liens ne
fonctionneront pas.

---

## 7. État de la bibliothèque

Onglet **Bibliothèque** → « État de la bibliothèque » → **Analyser**. Une
bibliothèque de 1 700 morceaux accumule en silence des fiches bancales ; ce
diagnostic les liste, classées par gravité. **Rien n'est corrigé ni supprimé
automatiquement** : chaque groupe rappelle la commande ou le geste qui répare.

| Gravité | Exemples |
|---|---|
| **Bloquant** | fichier vide ou corrompu, fichier muet |
| **Gênant** | morceau de 12 s, mix d'une heure, titre indevinable (« videoplayback »), doublon probable, longue intro silencieuse |
| **Cosmétique** | pas d'artiste, genre « Autre », pas d'année, fiche sans fichier |

L'analyse ordinaire est immédiate (elle lit les fiches, pas les fichiers).
Cocher **« Écouter aussi les fichiers »** lance en plus ffmpeg sur les
25 premières secondes de chaque morceau pour repérer les fichiers muets et les
intros vides : comptez plusieurs minutes sur une grosse bibliothèque.

Un défaut partagé par un millier de morceaux se raconte par son total : seuls
les premiers exemples de chaque type sont listés, le compte complet est dans la
pastille.

---

## 8. Statistiques et résumé partageable

L'onglet **Statistiques** ajoute, sous les compteurs habituels :

- **Par genre** — ton taux de réussite genre par genre, à partir de 3 manches
  jouées dans le genre (en dessous, un 0/1 malheureux ne veut rien dire).
- **Tes bêtes noires** — les artistes qui te font perdre le plus souvent.
- **Résumé de la session** — une grille d'emojis à copier-coller :

```
🎵 Songless — seed QDZA-RUHJ
4 morceaux · 3 trouvés · 2,3 essais en moyenne
⚙ deviner l'année · ×1,5 · paliers hardcore

🟥🟩⬜⬜⬜⬜
🟨🟥🟥🟩⬜⬜
```

🟩 trouvé · 🟥 raté · 🟨 passé · ⬜ essai non utilisé. **Aucun titre n'apparaît**
: le résumé se partage sans rien dévoiler, et le lien de la seed qui l'accompagne
permet à quelqu'un de rejouer exactement la même partie.

Le bouton **Partager** en fin de manche copie la même chose.

---

## Organisation des fichiers

```
server.js              serveur Express (API + site)
lib/
  player-store.js       profils, statistiques, listes et sauvegardes partagés
  party.js              salons, manches, buzzers et scores temporaires
  antivirus.js          analyse Defender avant installation d'un fichier
  titles.js            nettoyage, translittération, genres, alias
  overrides.json       titres connus sous un autre nom  ← à compléter
  store.js             lecture/écriture de metadata.json
  downloader.js        yt-dlp + ffmpeg, détection de doublons, playlists
  importer.js          archives et dossiers : extraction, tri, doublons
  dupes.js             définition commune de « c'est le même morceau »
  health.js            diagnostic de la bibliothèque
tools/
  download.js          ajout de musique en ligne de commande
  import.js            import d'une archive ou d'un dossier du disque
  enrich.js            passe sur toute la bibliothèque
  years.js             années de sortie (MusicBrainz)
  retitle.js           correction d'une fiche
  dedupe.js            doublons
  fix-cjk-titles.js    noms des titres japonais/chinois/coréens
  fix-latin-titles.js  noms des titres latins étrangers
public/
  index.html, app.js, style.css
  platform.js           appairage et synchronisation téléphone ↔ PC
  expansions.js         parties finies, entraînement, listes et multijoueur
  expansions.css        interface de l'onglet Modes
  controller.html       page mobile dédiée, sans accès au jeu complet
  controller.js         profil, code de salle, réponse, buzzer et classement
  controller.css        interface tactile de la télécommande
  session.css          seed, genres, téléchargement, modale d'édition
  features.css         profils, options de manche, décennies, diagnostic
  favicon.svg          icône d'onglet
  default-cover.svg    pochette de repli
  vendor/
    lucide.min.js      icônes                    ← ne pas supprimer
    fonts.css          déclarations @font-face
    fonts/             DM Sans (4 fichiers .woff2)
musiques/              tes fichiers audio (source de vérité)
metadata.json          titres, genres, alias  (généré, réparable)
.cache/                caches MusicBrainz (artistes, années), corbeille
songless-data.json     profils et données de jeu partagés (non versionné)
Songless.bat           lanceur principal (PC, téléphones et Internet HTTPS)
Songless (telephone).bat  lanceur en mode réseau local
```

`musiques/` fait foi : `metadata.json` ne fait qu'ajouter des informations
par-dessus. Le supprimer ne perd aucune musique, il suffit de relancer
`node tools/enrich.js`.

---

## Icônes

Elles viennent de [Lucide](https://lucide.dev) (licence ISC), **servi en local**
depuis `public/vendor/lucide.min.js`.

Ça n'a pas toujours été le cas : le fichier était chargé depuis `unpkg.com`, et
`lucide.createIcons()` était la toute première ligne de l'initialisation. Sans
Internet, `lucide` n'existait pas, la ligne plantait, et **tout le reste du
démarrage était emporté** — pas d'onglets, pas de seed, pas de bibliothèque, pas
de raccourcis clavier. La page s'affichait, morte. Pour un jeu qui lit des MP3
sur le disque dur, dépendre d'un serveur distant pour démarrer n'avait pas de
sens.

Deux protections désormais :

1. le fichier est dans le projet, plus aucun appel sortant ;
2. les appels passent par `dessinerIcones()` (`app.js`), qui vérifie que `lucide`
   est là. S'il manque, un avertissement part dans la console et le jeu démarre
   sans icônes — un défaut d'affichage, pas une panne.

**Mettre à jour la bibliothèque** :

```bash
curl -L -o public/vendor/lucide.min.js https://unpkg.com/lucide@latest
```

Puis retirer la dernière ligne `//# sourceMappingURL=…` du fichier : la
sourcemap n'est pas téléchargée avec, et sans ça DevTools la réclame pour rien.

---

## Polices

**DM Sans**, servie en local depuis `public/vendor/fonts/`, déclarée dans
`public/vendor/fonts.css` (licence SIL Open Font License 1.1).

Quatre fichiers `.woff2`, 211 Ko en tout — c'est la police **variable** (toutes
les graisses de 100 à 1000 en continu), découpée par `unicode-range` :

```
dm-sans-latin.woff2              63 Ko   romain, latin de base
dm-sans-latin-ext.woff2          31 Ko   romain, accents rares et vietnamien
dm-sans-italic-latin.woff2       76 Ko   italique, latin de base
dm-sans-italic-latin-ext.woff2   41 Ko   italique, étendu
```

Le navigateur ne télécharge un sous-ensemble que s'il croise un caractère qui en
relève : en pratique, une page normale ne charge que les deux premiers.

Avant, elle venait de `fonts.googleapis.com`. Contrairement aux icônes, une
police absente ne cassait rien — le navigateur retombait sur une police système.
Mais c'était le dernier fil qui reliait le jeu à Internet, et **Playfair Display
était chargée en plus alors qu'elle n'est utilisée nulle part** dans le CSS :
supprimée.

**Mettre à jour** — récupérer le CSS que Google sert à un navigateur récent :

```bash
curl -s -H "User-Agent: Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/151.0.0.0 Safari/537.36" \
  "https://fonts.googleapis.com/css2?family=DM+Sans:ital,opsz,wght@0,9..40,100..1000;1,9..40,100..1000&display=swap"
```

Il liste quatre URL `.woff2` : les télécharger dans `public/vendor/fonts/` sous
les mêmes noms qu'au-dessus, et reporter les `unicode-range` dans `fonts.css`.

## Aucune dépendance réseau

Le jeu ne fait **plus aucun appel sortant**. Vérifié en bloquant tout ce qui
n'est pas `localhost` au niveau du navigateur : 1040 requêtes, zéro hors
localhost, zéro échec, console vide, police et icônes en place, audio qui joue.

Débranche la box, Songless tourne. Le QR code du mode téléphone est fabriqué
sur place (paquet `qrcode`), pas récupéré en ligne.

Restent hors ligne du jeu, et uniquement à la demande : le téléchargement de
musique (yt-dlp), et les recherches MusicBrainz de `tools/enrich.js` et
`tools/years.js`.

---

## Note

Les fichiers téléchargés le sont pour ton usage personnel hors ligne. Ne les
rediffuse pas.
