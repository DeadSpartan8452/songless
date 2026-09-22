# Audit Songless — 2 septembre 2026

## Résultat exécutif

La base actuelle démarre, ses fichiers JavaScript et JSON sont valides et les
quatre modes multijoueurs existants passent les tests de moteur. Quatre défauts
importants de confidentialité, de règles ou de durabilité ont été trouvés puis
corrigés :

1. les textes des tentatives adverses étaient présents dans l’état API pendant
   une manche ;
2. un joueur éliminé en Battle Royale pouvait encore répondre ;
3. la TV et la télécommande recevaient avant révélation un identifiant décodable
   contenant le nom du fichier musical ;
4. l'historique multijoueur disparaissait de la mémoire au redémarrage.

L’encodage de `server.js` était également corrompu sur 116 lignes, y compris
dans plusieurs messages visibles et emojis. Il est maintenant corrigé en UTF-8.

Le contrôle visuel complet est désormais réalisé. Le navigateur intégré de Codex
reste bloqué par son bootstrap de confiance malgré une configuration correcte ;
un laboratoire Playwright Core + Axe isolé a donc piloté le Chrome déjà installé,
sur un serveur Songless temporaire et un fichier de profils séparé. Quatorze
captures ont couvert PC, tablette, téléphone joueur, TV et télécommande, du lobby
à la révélation. Le laboratoire et ses captures restent hors du dépôt dans
`C:\Users\Dead Spartan\Codex\songless-visual-lab`.

## Contrôles réussis

- 36 fichiers JavaScript : syntaxe valide avec `node --check` ;
- 23 fichiers JSON : lecture valide avec `JSON.parse` ;
- scripts PowerShell : analyse syntaxique valide ;
- HTML : aucun identifiant statique dupliqué ;
- dépendances installées : arborescence cohérente ;
- audit npm : zéro vulnérabilité connue ;
- simulation existante : partie complète à six joueurs réussie ;
- tests moteur et cas limites multijoueurs : 25 sur 25 réussis ;
- tests de stockage, import et restauration : 10 sur 10 réussis ;
- tests HTTP profils et sauvegardes : 8 sur 8 réussis ;
- tests de protection des variantes : 14 sur 14 réussis ;
- tests statiques d'interface : 12 sur 12 réussis ;
- tests HTTP isolés : 19 sur 19 réussis ;
- entrée locale reconnue comme hôte ;
- entrée Internet reconnue comme distante ;
- création et commandes hôte refusées sur l’entrée Internet ;
- bibliothèque et QR hôte refusés à distance ;
- invitation requise pour rejoindre une partie ;
- jeton joueur distinct du jeton hôte ;
- morceau et réponse masqués avant révélation ;
- en-têtes CSP, HSTS, nosniff et anti-frame présents ;
- aucun secret courant détecté dans les fichiers suivis ;
- tous les fichiers texte contrôlés sont valides en UTF-8 ;
- `git diff --check` ne signale aucune erreur de diff ;
- démarrage Internet, Funnel, QR et invitation validés avant l’audit.
- 14 captures visuelles réelles, sur 390 × 844, 820 × 1180,
  1440 × 1000 et 1920 × 1080 ;
- aucun débordement horizontal ni texte coupé après correction ;
- aucune erreur de console ou réponse HTTP en échec sur les interfaces finales ;
- audit Axe : zéro violation sur les huit écrans représentatifs contrôlés.

## Bibliothèque

Diagnostic rapide et analyse audio profonde effectués en lecture seule.

- fichiers audio : 1 687 ;
- fiches de métadonnées : 1 687 ;
- fichiers bloquants, vides, muets ou illisibles : 0 ;
- problèmes gênants : 49 ;
- introductions silencieuses longues : 7 ;
- morceaux très courts : 30 ;
- morceaux très longs : 5 ;
- titres douteux : 4 ;
- titres à relire : 3 ;
- années manquantes : 1 234 ;
- artistes manquants : 347 ;
- genres absents ou classés « Autre » : 510.

Les problèmes de métadonnées expliquent pourquoi les futurs modes Intrus,
thématiques et portraits musicaux doivent attendre la phase de fiabilisation.

Les parodies, remix, reprises, versions sped-up, slowed, live, acoustiques,
instrumentales et remasterisées sont des versions distinctes. Elles ne doivent
jamais être supprimées comme doublons sur la seule base du titre ou de l’artiste.

## Corrections appliquées

### Encodage

- réparation ciblée de 116 lignes dans `server.js` ;
- 253 marqueurs de corruption supprimés ;
- nombre de lignes conservé ;
- syntaxe et simulation repassées après correction ;
- sauvegarde antérieure conservée hors du dépôt dans
  `C:\Users\Dead Spartan\Codex\_songless-audit-backups`.

### Confidentialité des réponses

Pendant une manche, un joueur ne reçoit plus le texte des tentatives de ses
adversaires. Il conserve l’accès à ses propres tentatives. L’hôte et l’état de
révélation gardent les informations nécessaires.

### Battle Royale

Un joueur devenu fantôme peut encore regarder, réagir et discuter, mais ne peut
plus répondre ni influencer une manche.

### Secret musical avant révélation

Seul le PC hôte reçoit désormais `currentTrackId`. La TV, la télécommande et les
joueurs suivent la manche par son numéro et ne reçoivent plus cet identifiant,
car sa valeur en base64url permettait de retrouver le nom du fichier musical.

### Persistance et messages fiables

- `partyHistory` est normalisé, conservé au chargement et testé sur une copie
  temporaire isolée ;
- les confirmations de création ou de demande d'équipe ne s'affichent plus si
  la commande distante a échoué.
- un import incomplet ou malformé est refusé sans vider l'état existant ;
- les sauvegardes des tests restent dans leur dossier temporaire ;
- le calcul des victoires ignore les participants qui ne correspondent à aucun
  profil enregistré.

### Cas limites multijoueurs

- quitter signale un abandon, retire le joueur des votes et libère le buzzer ;
- une reconnexion avec le même jeton réactive le même joueur ;
- une double révélation ne retire plus deux vies en Battle Royale ;
- une partie terminée refuse toute nouvelle action ;
- une équipe inexistante ne peut plus être assignée ;
- les joueurs ayant le même score reçoivent le même rang.

### Lanceur unique

- `Songless.bat` propose Local, Réseau maison ou Internet ;
- le mode local ne requiert ni Tailscale ni droits administrateur ;
- les anciens raccourcis téléphone et Internet ciblent le bon mode ;
- un second lancement n'ouvre ni serveur ni onglet supplémentaire ;
- deux ports occupés ne sont plus confondus avec Songless : processus, ligne de
  commande et contextes HTTP sont vérifiés avant de conclure qu'il tourne déjà.

### Tests reproductibles

Commandes ajoutées :

```text
npm test
npm run test:party
npm run test:store
npm run test:player-http
npm run test:dupes
npm run test:ui
npm run test:http
```

Le test HTTP utilise des ports et un fichier de données temporaires. Il ne
modifie ni les profils ni la bibliothèque réels.

### Corrections issues du contrôle visuel

- navigation PC réorganisée sur quatre colonnes à 390 px, sans onglet coupé ;
- formulaire de création de profil mobile remis sur toute la largeur ;
- champs du nouveau profil de nouveau lisibles et utilisables ;
- cibles tactiles principales agrandies sur le téléphone ;
- favicon locale déclarée sur la TV et la régie, supprimant le dernier 404 ;
- trois listes déroulantes multijoueurs dotées d’un nom accessible ;
- chaque case de sélection musicale annonce désormais le titre concerné ;
- contrastes des textes secondaires, badges, seed et états inactifs corrigés ;
- focus clavier renforcé sur le PC, le téléphone et la télécommande.

Le seul événement réseau observé pendant la passe finale est l’annulation
attendue d’une lecture audio lorsque le scénario automatisé change d’onglet.
Il ne correspond ni à un fichier absent ni à une erreur de l’application.

### Contrôle ciblé suggestions et renommage

- 16 suggestions vérifiées en solo PC et sur contrôleur téléphone 360 px ;
- listes déroulantes, défilement tactile/molette et titres longs contrôlés ;
- aucun débordement horizontal, aucune troncature de la ligne longue testée ;
- navigation par flèches et `aria-activedescendant` vérifiées ;
- zéro erreur console, zéro erreur HTTP et zéro violation Axe sur les zones ;
- crayon de renommage contrôlé après révélation sur le PC, absent des interfaces
  TV, télécommande et joueur distant ;
- captures et rapport reproductible dans le laboratoire visuel isolé, sans
  écriture dans les profils ou métadonnées personnels.

### Validation finale du diagnostic avant soirée

- parcours complet contrôlé avec une bibliothèque fictive isolée sur ordinateur
  1440 x 1000, tablette 820 x 1180 et téléphone 390 x 844 ;
- onze contrôles rendus avec résumé concordant et confirmation audio reportée ;
- captures initiales et finales inspectées : textes et actions lisibles ;
- zéro erreur console ou HTTP, zéro débordement horizontal et zéro violation Axe
  sérieuse ou critique dans le composant.

### Garde-fou easter eggs

- la définition reste exclusivement côté serveur avant le verdict autorisé ;
- un succès individuel autorise l’effet après `guess true` ;
- un échec ne l’autorise qu’après la dernière vraie tentative ;
- un `skip`, y compris au dernier palier, ne produit jamais `guess false` ;
- le futur mode Indice possède une exception explicite et isolée ;
- la TV célèbre une bonne réponse, mais ne diffuse pas l’échec individuel d’un
  joueur pendant que les autres cherchent encore.

### Blacklist temporaire configurable

- cibles morceau, artiste, genre, thème, année et décennie, sans traduction ni
  modification des métadonnées sources ;
- durées en parties, heures, jours, semaines ou date de fin ;
- portée globale ou limitée aux modes solo et multijoueurs choisis ;
- motif visible, activation immédiate, levée anticipée et suppression ;
- purge automatique des règles arrivées à échéance ;
- aperçu serveur obligatoire du nombre de morceaux restant avant création ;
- filtrage réappliqué par le serveur à la création multijoueur ;
- consommation solo une seule fois par seed et par mode ;
- persistance dans la sauvegarde partagée et export/import complet ;
- tests purs et HTTP sur des fichiers temporaires, sans toucher aux données
  personnelles ni au port 3000.

Le contrôle Chromium du panneau a découvert puis permis de corriger deux
régressions de Bibliothèque auparavant invisibles aux tests statiques : une
liste de genres utilisant une variable hors portée et l’échappement d’une année
numérique comme du texte. La passe finale à 1440 × 1000 et 390 × 844 ne relève
aucune erreur console, aucun débordement ou texte coupé, et aucune violation Axe.

## Points importants à traiter ensuite

### Architecture

- `public/app.js`, `public/expansions.js` et `server.js` sont volumineux ;
- les nouvelles fonctions doivent être séparées en modules plutôt qu’ajoutées
  au monolithe ;
- les rôles TV et télécommande administrateur disposent maintenant de jetons
  distincts, temporaires et révocables ;
- le téléphone joueur et la télécommande ne reçoivent jamais le secret hôte ;
- la playlist d’une partie est désormais validée et conservée côté serveur ;
- `tv.html` fournit un affichage spectacle en lecture seule ;
- `remote.html` fournit une régie mobile limitée à lancer la manche suivante,
  révéler, revenir au salon et terminer la partie ;
- il reste à sortir ces responsabilités de `server.js` dans des modules dédiés.

### Modes

- Classique, Buzzer, Battle Royale et Duel existent en multijoueur ;
- solo limité, sans fin, entraînement, collections et défis existent côté PC ;
- tous ne disposent pas encore d’une présentation TV et distante homogène ;
- le duel final automatique à deux survivants est isolé, testé et visible sur
  PC, TV, télécommande et contrôleur ;
- Intrus, Enchères, Confiance, Coopération, Joker, Missions et handicap
  intelligent restent à construire.

### Métadonnées

- les anciens champs de favoris convergent vers `favorite`, avec une étoile
  accessible et un filtre dédié dans la bibliothèque ;
- année, provenance, confiance et sous-genre précis sont éditables sans modifier
  le titre, le fichier ou l’identifiant audio ;
- les filtres de bibliothèque couvrent genre, sous-genre, décennie, année
  manquante et favoris ;
- une recherche MusicBrainz avec artiste ne peut plus être relancée sans artiste
  pour accepter un homonyme de même titre ;
- les 40 artistes déjà issus de cet ancien repli ont été identifiés par le cache,
  simulés sur une copie, sauvegardés puis marqués à confirmer sans changer leur
  nom ; un filtre et un compteur dédiés les exposent dans la bibliothèque ;
- cinq de ces identités ou autres rapprochements ambigus ont ensuite été
  confirmés par preuves concordantes et protégés comme corrections manuelles ;
- 14 années Solatorobo et 5 années de morceaux corrigés ont été ajoutées après
  aperçu et simulation ; il reste 2 années obligatoires sans preuve suffisante ;
- l'éditeur protège maintenant un artiste saisi en `manual/high`, et
  `tools/years.js` refuse qu'un aperçu ancien écrase une année déjà renseignée ;
- le diagnostic calcule désormais un statut prêt / à vérifier / problématique,
  une note expliquée par ses raisons et la couverture réelle des contrôles ;
- la qualité d’encodage demeure explicitement « inconnue » fichier par fichier
  tant qu’aucun débit, échantillonnage ou profondeur n’a réellement été lu ;
- les pochettes annoncées sont maintenant confrontées à leur signature binaire
  réelle (PNG, JPEG, GIF ou WebP) et le favicon SVG local est contrôlé séparément
  sur les quatre interfaces ;
- `tools/years.js` n’écrit plus directement : il produit un aperçu JSON, puis
  exige une seconde commande `--apply` ; l’application est bornée aux fichiers
  encore présents et ne peut transmettre aucun champ de titre ;
- la sélection multiple permet maintenant de préparer un classement genre et
  sous-genre ; le serveur renvoie un aperçu lisible et un jeton temporaire à
  usage unique avant d’autoriser l’application, sans accepter de champ titre ;
- le dernier comptage réel donne 979 fiches à revoir : 669 genres présents mais
  incertains, 297 genres absents, 22 artistes incertains et 2 années obligatoires
  absentes ; les catégories peuvent se recouper ;
- le diagnostic lit désormais débit, échantillonnage, profondeur, codec et mode
  avec/sans perte, sans juger un FLAC avec les seuils d’un codec destructif ;
- les dimensions PNG, JPEG, GIF et WebP sont lues depuis les octets intégrés,
  en acceptant les `Uint8Array` réellement renvoyés par `music-metadata` ;
- le passage réel en lecture seule a mesuré 1 027 encodages et les dimensions
  des 1 026 pochettes annoncées : 4 encodages faibles, 35 intermédiaires et
  39 pochettes sous 256 px ont été signalés, sans aucune écriture automatique ;
- le comparateur oppose maintenant les paires suspectes avec durée, taille,
  année, genre et écoute indépendante ; une paire de même taille reçoit une
  empreinte SHA-256 pour confirmer si les octets sont strictement identiques ;
- les variantes artistiques connues restent exclues des rapprochements ;
- « conserver les deux » mémorise un faux positif dans la sauvegarde partagée,
  et « réexaminer » restaure uniquement la paire choisie ;
- le comparateur ne propose aucune suppression et n’écrit jamais dans les
  fichiers musicaux ;
- le parcours Chromium desktop/mobile, titre long compris, passe sans erreur
  console, débordement, troncature ou violation Axe.

Les parodies, remix, reprises, versions sped-up, slowed, live, acoustiques,
instrumentales, karaoké et remasterisées sont conservés comme des morceaux
distincts. Même lorsqu’un rapprochement est affiché, aucune suppression n’est
automatique.

### Dépendances

- aucune vulnérabilité connue ;
- Express 5.2.1 et Multer 2.3.0 sont intégrés et couverts par la suite HTTP ;
- `music-metadata` 11.15.0 est intégré côté Windows et Android, avec validation
  complète après mise à jour.

## Clôture administrative de la phase zéro — 3 septembre 2026

Les lanceurs local et Wi-Fi ont été rejoués sur une installation fraîche et
isolée. Le lanceur Internet a ensuite été validé avec le compte Tailscale
Songless : démarrage des deux entrées, activation du Funnel HTTPS, création
d'un salon, génération du QR, ouverture de l'invitation publique, arrêt du
serveur, coupure du Funnel et libération des ports 3000 et 3001.

Ce dernier parcours a découvert puis corrigé deux défauts du test frais : le
chargement manquant de l'assembly DPAPI sous PowerShell 5.1 et la conservation
irrégulière du cookie à travers une redirection par le client PowerShell. Le
second point utilise désormais l'autorisation locale déjà réservée au seul
processus `-SmokeTest`; les tests distincts continuent de vérifier le vrai
cookie HttpOnly et les refus distants.

## État de la phase zéro

**Livrée.** Moteur, données, sécurité HTTP, rendu réel, accessibilité et les
trois parcours de lancement disposent de contrôles reproductibles. Le dernier
test a confirmé qu'aucun Funnel ni port Songless ne reste actif après fermeture.

## Contrôle de reprise — 5 septembre 2026

Constat important reproduit : le test HTTP de la correction MusicBrainz échouait
sur une valeur absente ; `buildTrack()` omettait également `unofficialVariant`.
Les compteurs d'une interface utilisant cette API pouvaient donc classer une
variante comme morceau ordinaire et lui réclamer artiste/année à tort.

Correction : transmission explicite de ces champs dans les deux chemins de
construction d'une fiche, détecteur de variante commun à l'enrichissement,
protection des albums manuels pendant une correction d'identité et maintien du
nettoyage du rapprochement obsolète déjà commencé localement.

Tests isolés supplémentaires : conservation des liens lors d'un favori ou d'un
changement de casse ; modification d'artiste et de titre ; absence d'ancien album
MusicBrainz après correction ; conservation d'album/année manuels ; identifiant
MusicBrainz invalide refusé ; variante explicite, variante déduite du nom,
variante au genre incertain et morceau ordinaire incomplet via la véritable API.

Défaut visuel découvert sur capture : les règles compactes réservées à
`.mobile-host` laissaient les boutons en lot coupés et les titres écrasés sur
un navigateur étroit. Correction étendue aux petits écrans, titres sur une ligne
de grille distincte des quatre commandes, actions en lot empilées, onglets
compacts avec icône au-dessus du texte. Captures finales relues et géométrie des
titres/boutons contrôlée, pas seulement la largeur totale du document.

Résultats : suite complète verte après correction serveur, 34 tests statiques
d'interface verts après CSS, contrôle réel PC/téléphone vert. Dernière charge :
32 joueurs, 32 réponses simultanées, 640 états, p95 15 ms, huit flux audio.
Kit Windows reconstruit et ses 3 983 entrées de manifeste vérifiées par taille
et SHA-256. Rapport détaillé :
`C:\Users\Dead Spartan\Codex\songless-reprise-20260905\verification-livraison.json`.

Bibliothèque réelle seulement lue pour comptage : 979 fiches à revoir, dont 297
genres absents, 669 genres incertains, 22 artistes incertains et 2 années
obligatoires absentes. Aucun fichier audio ni métadonnée personnelle modifié.

Les paragraphes historiques « Modes » ci-dessus ne décrivent pas l'avancement
actuel : les nouveaux modes de la phase 6 sont livrés et leur suite passe. Le
cahier, sections 15 et 17, précise l'état opérationnel. Les travaux Tailscale
préexistants sont conservés, sans publication ni commit automatique.

## Reprise du 7 septembre 2026 — téléchargement et bibliothèque temporairement écartée

- Le test réel Windows a reproduit une erreur YouTube HTTP 403 avec yt-dlp 2026.07.04.
- yt-dlp officiel 2026.08.19 est conservé dans tools/bin et désormais prioritaire sur les installations globales. Le constructeur Windows conserve cette copie au lieu de l'écraser avec un outil plus ancien.
- Recherche, téléchargement, conversion MP3, analyse Microsoft Defender, lecture des métadonnées audio et détection du doublon validés sur une bibliothèque de test séparée (130,056 s, 3 121 965 octets). Aucun ajout à la bibliothèque personnelle.
- La blacklist propose « Toute la bibliothèque actuelle ». L'aperçu capture les identifiants exacts, puis l'activation consomme un jeton temporaire de cinq minutes. Les nouveaux ajouts restent disponibles ; lever la règle ou attendre son expiration rétablit les anciens morceaux. Une bibliothèque entièrement écartée est explicitement annoncée et autorisée dans ce seul parcours.
- Tests purs, API isolée (aperçu obligatoire, refus distant, paramètres modifiés refusés, réutilisation du jeton refusée, ajout entre aperçu et activation, redémarrage, levée) et parcours Chromium à 1440 et 390 px validés ; captures inspectées, aucune erreur console ni débordement horizontal.
- Preuves : Codex/songless-update-20260907/validation/report.json et Codex/songless-download-check-20260907/result.json.
- Demande précisée ensuite : régler un nombre de chansons aléatoires en équilibrant les sources/personnes pour éviter qu'une grande playlist domine. Le tirage équilibré n'est pas encore implémenté ; la distinction import multi-playlists / sélection de la bibliothèque est en attente de précision. Le code actuel ne conserve pas l'appartenance aux playlists/personnes.
- Spotify, Deezer et les fichiers listes de titres ne sont pas intégrés. Les entrées de téléchargement sont les recherches par titre et YouTube ; les fichiers audio et ZIP suivent le parcours d'import distinct.
- Aucune publication ni modification de la bibliothèque personnelle ; toutes les modifications préexistantes sont conservées.

## Tirage équilibré entre sources — 7 septembre 2026

Les deux parcours demandés sont implémentés : téléchargement de nouveautés depuis plusieurs playlists et sélection dans la bibliothèque existante.

- Import hôte : 2 à 20 playlists YouTube / YouTube Music, 1 à 500 nouveautés demandées. Une ligne accepte un nom de source facultatif suivi de « | URL ». Plusieurs playlists portant le même nom sont fusionnées en une source. Le tirage examine au maximum 5 000 titres par playlist, signale toute troncature et présente un aperçu avant téléchargement. Une playlist inaccessible ne bloque pas les autres ; le manque final est explicite.
- L’équilibre porte sur les ajouts réussis ; doublons et erreurs sont remplacés si possible, les sources épuisées cèdent leur place. Le nombre de tentatives est borné et l’arrêt coupe la file après le titre éventuellement en cours. Les aperçus sont locaux, bornés et consommables une seule fois.
- Bibliothèque : option persistante d’équilibrage, nombre de titres et choix des sources. La même fonction de tirage déterministe sert au solo et au serveur multijoueur. Le serveur applique blacklist et filtres avant le tirage et renvoie à l’hôte l’ordre réellement retenu ; le nombre de manches est borné aux titres disponibles. Les défis enregistrés conservent leur ordre.
- Les métadonnées conservent importSource. Les ajouts classiques acceptent une étiquette ; les dons depuis un contrôleur prennent le nom du profil. Les anciens titres sans origine restent dans une source explicite « Origine non renseignée ». L’hôte peut attribuer une source en lot après aperçu, avec sauvegarde et sans réécriture du titre ni du fichier audio. Les imports de fichiers/ZIP/dossier Android reçoivent également leur origine.
- Aucun rattachement automatique de la bibliothèque personnelle n’a été effectué. Spotify, Deezer et les fichiers de listes de titres ne sont pas intégrés dans ce lot.

Validation : six scénarios purs dont 100 graines testées contre des sources de tailles 1 000 et 3 ; parcours HTTP isolés d’attribution, permissions et multijoueur ; parcours Chromium 1440×1000 et 390×844 avec import simulé et répartition 3/3 ; aucune erreur console ni débordement, aucun défaut Axe sérieux/critique après correction du focus du journal. La suite npm.cmd test passe, charge 32 joueurs / 640 états / huit flux audio, p95 15 ms. Les cinq nouvelles routes ont été ajoutées à la matrice d’autorisations.

Essai Internet réel isolé : playlists publiques Kevin MacLeod Archive et Scott Buckley ; deux nouveautés demandées, une de chaque source, zéro erreur ni doublon. Conversion MP3 et analyse Defender réussies ; fichiers audio relus (326,616 s et 124,128 s). Les tests sont dans Codex/songless-sources-20260907, hors bibliothèque personnelle.

Preuves : validation/report.json, real-download/report.json et tests-complets.log dans ce dossier de contrôle. Aucun push ni publication.

### Distributions du 7 septembre 2026

Kit Windows reconstruit et vérifié : 3988 fichiers. APK reconstruit, signature contrôlée par le constructeur et nouvelles sources vérifiées dans l’archive. Taille APK : 212238563 octets ; SHA-256 : EB1C410A1D57723D6C9541D56B06FD70991206C22E16005BF869A8B304F28836. Les exécutables Windows ne sont pas embarqués dans Android. Aucun déploiement ni installation sur le POCO. Les validations externes POCO et Android natif 16 Kio restent ouvertes.

## Audit de dépendances et reconstruction du 22 septembre 2026

L'audit npm en ligne a trouvé deux avis actifs sur la dépendance directe
`adm-zip` 0.6.0, dont un avis de sévérité élevée sur l'allocation mémoire lors
de la lecture d'une archive. Le passage à 0.6.1 ramène l'audit à zéro
vulnérabilité connue. La suite complète reste verte ; dernière charge :
32 joueurs, 640 états, huit flux audio et p95 à 17 ms.

Le kit Windows a été reconstruit avec 3 988 fichiers et la version 0.6.1
embarquée. L'APK Release a été reconstruit en 9 min 5 s : 212 242 015 octets,
SHA-256 `E7AAF42F913FD4201F10B97437F9E1F9C0499A23251FAE0E6AB66F585B776F79`,
signature v2 valide, un signataire RSA 4096 bits et alignement ZIP validé. La
version 0.6.1 a été relue directement dans l'archive. L'audit ELF contrôle
56 bibliothèques et retrouve uniquement les deux `libnode.so` déjà documentées.
Le POCO n'était pas connecté ; aucune installation ni publication n'a eu lieu.
