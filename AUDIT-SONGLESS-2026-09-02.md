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

### Garde-fou easter eggs

- la définition reste exclusivement côté serveur avant le verdict autorisé ;
- un succès individuel autorise l’effet après `guess true` ;
- un échec ne l’autorise qu’après la dernière vraie tentative ;
- un `skip`, y compris au dernier palier, ne produit jamais `guess false` ;
- le futur mode Indice possède une exception explicite et isolée ;
- la TV célèbre une bonne réponse, mais ne diffuse pas l’échec individuel d’un
  joueur pendant que les autres cherchent encore.

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
- le diagnostic calcule désormais un statut prêt / à vérifier / problématique,
  une note expliquée par ses raisons et la couverture réelle des contrôles ;
- la qualité d’encodage demeure explicitement « inconnue » tant qu’elle n’est pas
  mesurée, afin que la note ne prétende pas contrôler ce qui ne l’est pas ;
- les pochettes annoncées sont maintenant confrontées à leur signature binaire
  réelle (PNG, JPEG, GIF ou WebP) et le favicon SVG local est contrôlé séparément
  sur les quatre interfaces ;
- `tools/years.js` n’écrit plus directement : il produit un aperçu JSON, puis
  exige une seconde commande `--apply` ; l’application est bornée aux fichiers
  encore présents et ne peut transmettre aucun champ de titre ;
- la sélection multiple permet maintenant de préparer un classement genre et
  sous-genre ; le serveur renvoie un aperçu lisible et un jeton temporaire à
  usage unique avant d’autoriser l’application, sans accepter de champ titre ;
- la grande majorité des années doit être complétée ;
- genres et artistes demandent une normalisation avec niveau de confiance ;
- la qualité d’encodage et les dimensions visuelles des pochettes restent à analyser ;
- la détection des doublons doit apprendre à distinguer explicitement les
  variantes artistiques.

Les parodies, remix, reprises, versions sped-up, slowed, live, acoustiques,
instrumentales, karaoké et remasterisées sont conservés comme des morceaux
distincts. Même lorsqu’un rapprochement est affiché, aucune suppression n’est
automatique.

### Dépendances

- aucune vulnérabilité connue ;
- Express 5 et Multer 2 sont des mises à jour majeures non appliquées afin de ne
  pas introduire de régression pendant l’audit ;
- `music-metadata` possède une mise à jour corrective mineure, à appliquer dans
  une phase dédiée avec tests avant/après.

## Contrôle restant avant clôture administrative de la phase zéro

Rejouer les trois lanceurs sur une instance fraîche, puis vérifier l’arrêt et la
libération des ports. Le port 3000 est actuellement occupé par une instance
Songless déjà ouverte, qui n’a volontairement pas été arrêtée pendant l’audit.

## État de la phase zéro

**Techniquement validée.** Moteur, données, sécurité HTTP, rendu réel et
accessibilité disposent maintenant de contrôles reproductibles. Seul le rejeu
administratif des trois lanceurs sur un port 3000 libéré reste à consigner.
