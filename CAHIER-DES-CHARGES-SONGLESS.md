# Songless — cahier des charges et plan d’action

Version de cadrage : 2 septembre 2026
Statut : validé pour exécution, avec carte blanche sur les choix techniques et UX
Projet : application locale `songless-local`, sans publication ni dépôt public

## 1. Vision

Songless doit devenir une régie de blind test complète, utilisable aussi bien seul
que pendant une soirée :

- l’appareil qui lance Songless avec le lanceur officiel — `Songless.bat` sur
  Windows ou l’application Songless sur téléphone — devient l’autorité technique
  et de sécurité de son instance ;
- un écran de télévision peut afficher une vue spectaculaire, sans commande
  sensible ;
- un téléphone administrateur peut piloter la partie après autorisation explicite
  du PC hôte ;
- les joueurs peuvent participer depuis un téléphone ou un autre ordinateur, sur
  le réseau local ou par Internet via Tailscale Funnel ;
- chaque mode de jeu pertinent doit fonctionner dans les trois contextes : local
  sur le PC, soirée avec écran TV et partie en ligne ;
- aucune donnée musicale ou donnée de profil ne dépend d’un service distant.

Direction visuelle : toutes les interfaces hors TV reprennent strictement l’identité
du Songless original : fond noir pointillé, palette violette, DM Sans, cartes sobres,
rayons, boutons et densité comparables à l’écran PC. Elles ne doivent pas développer
une esthétique de « régie » séparée. La TV conserve volontairement son habillage
spectaculaire actuel, validé comme une exception, et ne doit pas être harmonisée avec
les autres écrans. Les contrôleurs restent compacts et rapides sans changer de famille
visuelle.

## 2. Principes non négociables

1. **Autorité locale** : seul le processus lancé par le lanceur officiel peut créer
   une partie avec les pleins pouvoirs, modifier la bibliothèque, importer ou
   supprimer des données, gérer les profils et déléguer une télécommande
   administrateur. Sur Windows, ce lanceur reste `Songless.bat`. Sur téléphone,
   il s’agit d’une application installable Songless : Android ne peut pas exécuter
   directement un fichier `.bat`.
2. **Délégation limitée** : le téléphone administrateur reçoit un jeton temporaire,
   révocable et limité aux commandes de la partie. Il ne reçoit jamais le jeton
   hôte principal et n’accède pas aux fichiers ni aux réglages sensibles.
3. **TV en lecture seule** : l’écran TV utilise un jeton d’affichage distinct. Il ne
   peut ni répondre, ni modifier une partie, ni consulter la bibliothèque privée.
4. **Joueurs cloisonnés** : chaque joueur possède uniquement son jeton de joueur et
   ne voit que les informations autorisées pour la phase en cours.
5. **Même moteur de règles** : les versions PC, TV et en ligne d’un mode partagent
   les mêmes règles côté serveur. Les interfaces ne doivent jamais recalculer seules
   un score, une élimination ou une victoire.
6. **Fonctionnement local prioritaire** : le mode PC doit rester utilisable sans
   Tailscale ni Internet.
7. **Une seule instance** : un second lancement ne doit créer ni serveur, ni tunnel,
   ni onglet supplémentaire.
8. **Aucune régression silencieuse** : une fonctionnalité n’est terminée qu’après
   tests automatiques, contrôle visuel et console navigateur sans erreur.

## 3. Rôles et permissions cibles

### 3.1 PC hôte

- lance et arrête Songless ;
- choisit la bibliothèque, les filtres, le mode et les règles ;
- crée la partie et les codes d’appairage ;
- autorise ou révoque le téléphone administrateur et l’écran TV ;
- possède toutes les commandes de manche ;
- gère fichiers, profils, sauvegardes, métadonnées et diagnostic ;
- reste le seul détenteur du secret hôte principal.

**Racine de confiance Windows livrée le 2 septembre 2026** : `Songless.bat`
appelle le lanceur PowerShell autorisé, qui crée une clé d’installation protégée
par Windows DPAPI puis en dérive un secret différent à chaque démarrage. Le
serveur échange ce secret uniquement depuis la machine hôte contre un cookie de
session HttpOnly/SameSite, puis retire le secret de l’adresse par redirection.
Un autre onglet local sans ce cookie reçoit l’interface contrôleur et toutes les
API d’administration lui sont refusées. Le mode Internet utilise le même contrat.

### 3.1 bis Téléphone hôte autonome

Le téléphone doit pouvoir remplacer entièrement le PC hôte, sans PC allumé sur le
réseau. L’expérience porte le même nom « Songless », même si Android utilise une
application installable et non le fichier Windows `Songless.bat`.

- le lanceur mobile démarre et arrête une instance Songless locale sur le téléphone ;
- Songless détecte le type d’appareil et ouvre automatiquement une interface admin
  tactile, responsive et fonctionnellement équivalente à celle du PC ;
- l’hôte mobile peut sélectionner la bibliothèque musicale autorisée par Android,
  gérer profils et sauvegardes, choisir les modes, créer la partie et commander
  chaque manche ;
- un écran « Inviter et afficher » montre en grand les QR codes Joueur, TV et
  Télécommande, les adresses LAN utiles et l’état des connexions ;
- le téléphone peut ouvrir localement la vue TV ou fournir son QR à un autre écran ;
- le serveur reste actif écran verrouillé ou application en arrière-plan dans les
  limites autorisées par Android, avec notification persistante explicite ;
- une fermeture ou un redémarrage restaure proprement la partie et les jetons encore
  valides, sans dupliquer le serveur ;
- le mode local et LAN fonctionne sans Internet.

La preuve d’autorité n’est pas la simple présence d’un fichier, falsifiable depuis
un navigateur. Le lanceur qui crée l’instance génère et conserve un secret hôte ou
une clé d’appareil dans le stockage sécurisé du système. L’interface ouverte par ce
lanceur reçoit une session admin locale liée à cette instance ; aucun autre onglet,
appareil ou fichier copié ne devient administrateur automatiquement.

Contraintes de réalisation mobile :

- une PWA seule n’est retenue que si elle peut réellement héberger le serveur,
  accéder durablement aux morceaux et survivre à l’arrière-plan ; sinon utiliser
  une application Android native ou un conteneur embarquant le runtime nécessaire ;
- accès aux morceaux via le sélecteur de dossiers Android, sans exiger de terminal ;
- aucune clé durable en clair dans les fichiers partagés ;
- contrôle réel sur le POCO X5 Pro 5G : lancement, arrière-plan, reprise, QR,
  connexion d’un joueur et d’une TV, console sans erreur et test de permissions.

### 3.1 ter Distribution transférable Windows et Android

Songless doit pouvoir être remis à une autre personne sous la forme d’un kit complet,
copiable par clé USB, partage de fichiers ou téléchargement privé. Deux parcours sont
acceptés : application portable contenant déjà ses dépendances, ou installateur qui
déploie automatiquement Songless et son runtime sur l’appareil cible.

Les seuls systèmes destinés à héberger une instance Songless sont Windows et
Android. Le livrable prend donc la forme d’un **kit à deux paquets** :

- Windows : installateur ou application portable signée, lancement en un clic ;
- Android : APK ou paquet équivalent signé, sans terminal ni commande à saisir ;
- navigateur sur macOS, Linux, iPhone, iPad ou un autre système : utilisable
  comme joueur, TV ou télécommande, mais jamais déclaré hôte autonome.

Le lanceur ou l’installateur doit :

1. détecter le système, l’architecture et les capacités disponibles ;
2. installer ou extraire uniquement les fichiers nécessaires dans un dossier dédié ;
3. créer les dossiers de données, vérifier les droits d’accès et demander à
   l’utilisateur de choisir sa bibliothèque musicale ;
4. ne jamais inclure automatiquement la bibliothèque musicale personnelle dans le
   paquet transféré ;
5. démarrer Songless, vérifier sa santé et ouvrir l’interface adaptée à l’appareil ;
6. proposer réparation, mise à jour et désinstallation sans effacer les données sans
   confirmation explicite ;
7. fonctionner hors ligne après installation pour les fonctions locales et LAN ;
8. produire un diagnostic lisible si la plateforme n’est pas prise en charge.

Le lancement officiel constitue la racine de confiance parce que le processus crée
une **nouvelle clé d’instance** protégée par le système et remet une session admin à
son interface locale. L’exécutable lui-même n’est ni un mot de passe ni un jeton :
une copie du kit permet d’administrer la nouvelle installation créée sur l’appareil,
mais ne donne aucun pouvoir sur une autre instance Songless. Les fichiers musicaux,
profils et secrets d’un hôte ne sont jamais transférés implicitement.

Critères de livraison du kit : installation neuve, second lancement sans doublon,
réparation, conservation des données, désinstallation, fonctionnement hors ligne,
permissions négatives et test réel sur Windows x64 et les architectures Android
annoncées.

### 3.2 Téléphone administrateur

- appairage volontaire depuis le PC par QR ou code court ;
- démarrer, mettre en pause, révéler, passer et terminer une manche ;
- choisir le prochain événement ou valider une action exceptionnelle ;
- gérer les équipes et exclusions de la partie en cours ;
- afficher l’état technique utile ;
- aucun accès à la suppression, à l’import, aux fichiers ou au secret hôte ;
- jeton expirant à la fin de la partie ou lors de sa révocation.

### 3.3 Écran TV

- vue plein écran dédiée, sans menus d’administration ;
- code et QR d’arrivée dans le lobby ;
- compte à rebours, manche, animations, réponses révélées, scores et podium ;
- masquage strict des réponses avant la révélation ;
- reconnexion automatique après une coupure brève ;
- jeton d’affichage en lecture seule.

### 3.4 Joueur sur téléphone ou autre PC

- choix ou création d’un profil selon les règles existantes ;
- rejoindre avec un code ou une invitation secrète ;
- interface adaptée au mode : réponse, buzzer, enchère, confiance, vote coopératif,
  choix d’intrus, joker ou mission ;
- statistiques et état personnels, sans données cachées des adversaires ;
- aucune commande d’hôte, même en fabriquant manuellement une requête HTTP.

## 4. Socle de modes

Tous les modes ci-dessous doivent utiliser une fiche commune : règles, nombre de
joueurs, durée, conditions de victoire, actions du joueur, commandes de l’hôte,
contenu TV, gestion des équipes, compatibilité locale et compatibilité distante.

### 4.1 Modes existants à consolider

1. Partie classique à réponses simultanées.
2. Mode Buzzer.
3. Battle Royale / Survie à trois vies.
4. Duel Tir à la corde.
5. Partie solo limitée à 5, 10, 20 ou 50 morceaux.
6. Partie sans fin.
7. Entraînement intelligent.
8. Collections personnalisées.
9. Défis enregistrés et rejouables.
10. Jeu en équipes.
11. Contraintes et effets de manche existants.

Le mode Survie existe déjà. Il doit être fiabilisé, pas recréé. Son duel final
automatique est livré : après une partie ayant compté au moins trois survivants,
il se déclenche lorsqu’il reste exactement deux joueurs vivants. Le premier à
deux manches gagnées remporte la partie ; les égalités ne donnent aucun point.
Il ne s’applique pas aux classements ordinaires sans élimination.

### 4.2 Nouveaux modes validés

#### Intrus

- identifier le morceau, l’artiste, l’année ou le genre qui ne correspond pas au
  groupe ;
- difficulté progressive selon la proximité des propositions ;
- justification claire après révélation ;
- génération interdite si les métadonnées ne permettent pas une réponse certaine.

#### Enchères

- les joueurs enchérissent sur la durée minimale d’extrait nécessaire ;
- tours d’enchère temporisés ;
- le gagnant de l’enchère répond seul ou perd l’avantage selon la variante ;
- aucune enchère impossible ou négative ;
- égalités départagées de manière annoncée et déterministe.

#### Confiance

- mise choisie avant validation de la réponse ;
- gain et perte proportionnels et visibles avant confirmation ;
- plafond empêchant une seule manche de détruire une partie ;
- bilan indiquant audace, précision et rentabilité.

#### Coopération

- objectif commun de points, de séries ou de survie ;
- rôles complémentaires possibles ;
- résultat collectif accompagné des contributions individuelles ;
- aucune récompense qui pousse à saboter volontairement l’équipe.

#### Joker

- mode spécial distinct, et non option ajoutée partout ;
- jokers limités et annoncés : seconde écoute, durée supplémentaire, choix réduit,
  protection de vie ou multiplicateur ;
- équilibre identique entre joueurs ;
- utilisation et effet décidés côté serveur.

#### Missions secrètes

- objectifs individuels envoyés uniquement au contrôleur concerné ;
- trois niveaux : Facile, Difficile et Expert ;
- missions réellement exigeantes aux niveaux élevés ;
- aucune mission ne doit nécessiter de tricher, de ralentir la partie ou de nuire à
  l’expérience des autres ;
- révélation et récompense au podium.

## 5. Adaptation intelligente

### 5.1 Handicap intelligent

- option activable par l’hôte ;
- s’appuie sur les statistiques persistantes et la partie en cours ;
- agit avec mesure sur la durée d’extrait, les indices ou le multiplicateur ;
- ne falsifie jamais secrètement une bonne réponse ;
- explique au joueur le bonus ou handicap appliqué ;
- bornes strictes pour conserver une compétition crédible.

### 5.2 Duel final

- uniquement dans les modes à vies ou élimination ;
- déclenchement lorsque deux joueurs vivants restent ;
- transition TV dédiée ;
- règles courtes, lisibles et identiques sur les deux contrôleurs ;
- départage explicite en cas d’égalité technique.

## 6. Bibliothèque et qualité des métadonnées

Avant les modes fondés sur les genres ou les années, le classement doit être
fiabilisé.

### 6.1 Genres

- taxonomie canonique stable ;
- regroupement des synonymes et variantes orthographiques ;
- conservation de la valeur source pour audit ;
- niveau de confiance et file de validation manuelle ;
- possibilité de corriger plusieurs morceaux à la fois ;
- aucun mode Intrus ou thématique construit sur un genre incertain.

### 6.2 Années

- distinguer année du morceau, de l’album, de la réédition et du fichier ;
- stocker la provenance et la confiance ;
- signaler les valeurs impossibles ou ambiguës ;
- correction en lot et aperçu avant application ;
- décennies calculées depuis l’année canonique validée.
- chaque morceau déjà présent et chaque futur téléchargement est recherché sur
  MusicBrainz à partir de son titre et de son artiste ; le cache permet de
  reprendre après une coupure sans recommencer les requêtes ;
- la première date de sortie MusicBrainz est préférée à la date de mise en ligne
  YouTube, qui reste une information de faible confiance ;
- une correction manuelle n'est jamais écrasée et une correspondance ambiguë
  reste dans la file de validation.
- les variantes manifestement non officielles — notamment Nightcore, sped up,
  slowed, parodies, reprises marquées cover, karaokés, bootlegs, mashups, bass
  boosted, 8D et montages de fans — ne sont pas obligées d'avoir
  un artiste ou une année ; seul leur titre et leur genre restent requis ;
- ces variantes sont recherchées sur YouTube pour leur genre, tandis que les
  morceaux officiels sont vérifiés sur MusicBrainz ; le téléchargeur applique
  automatiquement la même règle aux futurs ajouts.
- pour cette automatisation, un morceau n'est considéré comme officiel que si
  MusicBrainz fournit une correspondance forte ; après un échec définitif de
  cette recherche, il bascule sur YouTube et n'exige plus artiste ni année.

**Livré le 3 septembre 2026** : la provenance historique restaure une confiance
prudente sans réécrire `metadata.json` (`manual` élevée, `musicbrainz` et `tag`
moyennes, `filename` faible), tandis qu’une confiance explicitement enregistrée
reste prioritaire. Le mode année, les filtres de genre et les décennies
thématiques n’acceptent que les valeurs élevées ou moyennes, côté interface
comme côté serveur ; ce dernier vérifie également que chaque morceau correspond
réellement au genre ou à la décennie demandés. Une sélection devenue vide est
refusée au lieu de produire une manche sans réponse certaine.

**Livré le 4 septembre 2026** : la file de validation de la bibliothèque peut
être filtrée par priorité — toutes les fiches, titres officiels ou variantes —
et par champ à corriger — genre absent ou incertain, année obligatoire absente
ou incertaine, artiste obligatoire absent. Chaque entrée affiche un compteur
dynamique. Les genres seulement déduits du nom de fichier restent à confirmer :
ils ne sont pas certifiés automatiquement. Le parcours a été contrôlé à
1440 x 1000 et 390 x 844, sans débordement ni erreur console ou HTTP.

**Correction du 4 septembre 2026** : l'ancien repli MusicBrainz par titre seul
pouvait associer un homonyme lorsque l'artiste renseigné n'était pas retrouvé.
Ce repli est désormais interdit dès qu'un artiste est présent. Les 40 artistes
déjà issus de ce parcours ont été repérés par un aperçu reproductible, puis leur
confiance a été abaissée après simulation et sauvegarde, sans réécrire leur nom.
Un filtre « Artistes présents à confirmer » les rend explicitement accessibles.

**Revue vérifiée du 4 septembre 2026** : 14 pistes de `Solatorobo Perfect
Sound Track` ont reçu l'année 2012 à partir de la première parution officielle
MusicBrainz du 16 octobre 2012 (release-group
`4e636c08-fbd4-42ec-9cbd-2435434f1dd2`). Cinq autres identités ambiguës ont été
confirmées par recoupement du fichier, des tags, de la durée et de
MusicBrainz : `Lyin' 2 Me` — CG5 (2020), `Sunday Best` — Surfaces (2019),
`The Moss` — Cosmo Sheldrake (2014), `Why Don’t You Get a Job?` — The
Offspring (1998) et `Good to Be Alive` — CG5 (2021). Chaque application a été
simulée sur une copie puis sauvegardée avant écriture. L'éditeur protège
désormais tout artiste enregistré à la main en `manual/high`, et un ancien
aperçu d'années ne peut plus écraser une année renseignée entre-temps.

### 6.3 Favoris, pochettes et icône

- unifier les notions de favori et coup de cœur ;
- contrôler la présence et la validité des pochettes ;
- fallback propre sans erreur console ;
- conserver une icône d’onglet locale et valide ;
- ne jamais confondre favicon du site et pochette musicale.

### 6.3.1 Identité et renommage des morceaux

- le tri par année, favori, genre ou sous-genre ne modifie jamais le titre source ;
- aucune traduction, translittération ou réécriture automatique du titre affiché :
  ces transformations créent des identités concurrentes et de faux doublons ;
- le nom source reste la référence tant que l’utilisateur ne choisit pas de le
  modifier explicitement ;
- le téléchargeur conserve aussi ce nom pour le fichier créé ; il se contente
  de neutraliser les caractères interdits par le système et ne fabrique plus un
  nom « Artiste - Titre » à partir des métadonnées ;
- une option crayon discrète permet de renommer le titre affiché depuis chaque
  mode, uniquement sur le PC local ou hôte et après la révélation ;
- ce renommage manuel réutilise l’éditeur de la bibliothèque et ne modifie ni le
  fichier audio, ni son identifiant stable ;
- le bouton et les métadonnées éditables sont absents des vues TV et des
  contrôleurs distants.

### 6.4 Détection des doublons

- doublons exacts par empreinte de fichier ;
- doublons musicaux probables malgré un nom ou un encodage différent ;
- regroupement par titre/artiste normalisés avec score de confiance ;
- classification explicite des versions : originale, reprise, parodie, remix,
  sped-up, slowed, live, acoustique, instrumental, karaoké et remaster ;
- deux versions artistiquement ou techniquement différentes restent deux morceaux,
  même si elles partagent le titre et l’artiste d’origine ;
- ces variantes ne sont jamais supprimées automatiquement : la détection sert à
  informer et comparer, pas à nettoyer aveuglément la bibliothèque ;
- une variation notable de vitesse, de durée, d’interprète ou d’arrangement interdit
  toute proposition automatique de suppression ;
- écran de comparaison avant toute suppression ;
- aucune suppression automatique et sauvegarde obligatoire avant action en lot ;
- toute mise à l’écart va dans la corbeille récupérable de Songless.

**Livré le 2 septembre 2026** : comparaisons par paires avec durée, taille,
métadonnées et écoute côte à côte ; empreinte SHA-256 seulement sur les paires
de même taille ; niveau de confiance et raison visibles ; protection des
variantes ; décision « versions distinctes » persistante, exportable et
réversible paire par paire. Le comparateur ne contient aucune suppression.

### 6.5 Indice de qualité

Chaque morceau reçoit un diagnostic explicable :

- titre, artiste, année et genre ;
- pochette ;
- durée et intégrité du fichier ;
- qualité audio disponible ;
- risque de doublon ;
- cohérence des métadonnées ;
- statut prêt à jouer, à vérifier ou problématique.

Le score ne doit pas prétendre mesurer ce qui n’est pas réellement analysé.

### 6.6 Blacklist configurable

L’hôte choisit :

- la cible : morceau, artiste, genre, thème, année ou décennie ;
- la durée : nombre de parties, heures, jours, semaines ou date de fin ;
- la portée : tous les modes ou certains modes ;
- le motif facultatif ;
- l’activation immédiate et la levée anticipée.

Les exclusions expirées sont retirées automatiquement. L’interface montre pourquoi
un morceau a été exclu et permet de prévisualiser la sélection restante.

**Livré le 2 septembre 2026** : règles persistantes et exportables, six types de
cible, cinq durées, portée solo/multijoueur, filtrage serveur non contournable,
consommation par partie, levée anticipée, purge automatique et aperçu obligatoire.
Le panneau hôte a été contrôlé en Chromium à 1440 × 1000 et 390 × 844, sans
erreur console, débordement, texte coupé ni violation Axe.

## 7. Écran TV et expérience de soirée

- route et interface TV dédiées, pas simple agrandissement de l’écran PC ;
- lisibilité testée à plusieurs mètres et aux formats 16:9 courants ;
- état de connexion visible mais discret ;
- lobby avec QR, joueurs et équipes ;
- transitions propres entre attente, écoute, réponse, révélation et podium ;
- animations réduites si le système ou l’utilisateur le demande ;
- aucune information secrète dans le DOM avant le moment autorisé ;
- mode plein écran et récupération après actualisation ;
- téléphone administrateur conçu comme une télécommande, pas comme une copie du PC.

### 7.1 Suggestions de réponse

- proposer jusqu’à 16 réponses pertinentes au lieu d’une liste trop courte ;
- volet déroulant borné à la fenêtre, avec défilement tactile et molette ;
- titre et artiste visibles sur plusieurs lignes, sans ellipse ni coupe arbitraire ;
- aucune ligne ne déborde horizontalement, y compris sur téléphone étroit ;
- navigation complète par flèches, Entrée et Échap avec état annoncé aux lecteurs
  d’écran ;
- même contrat visuel et fonctionnel en solo PC, multijoueur PC et contrôleur.

## 8. Podium et portraits musicaux

Le podium doit produire plusieurs distinctions factuelles et humoristiques à partir
des statistiques de la partie et de l’historique.

Exemples dynamiques :

- « Ennemi juré de Coldplay » ;
- « Shazam sous Windows Vista » ;
- « Bloqué dans les années 2000 » ;
- « Un cœur, zéro peur » ;
- « Confiance injustifiée » ;
- « L’intrus, c’était lui ».

Contraintes :

- au moins 50 modèles de titres au premier lot ;
- formulation amusante mais jamais humiliante ou discriminatoire ;
- aucun titre attribué sans preuve statistique ;
- variables artiste, genre et décennie échappées avant affichage ;
- priorité aux faits remarquables pour éviter dix titres insignifiants ;
- possibilité de partager une carte souvenir sans exposer de donnée privée.

**Livré le 2 septembre 2026** : la carte souvenir produit localement un PNG
1080 × 1350 avec podium, scores, portraits et preuves statistiques. Elle reste
anonyme par défaut ; l’affichage des pseudos exige une activation explicite et
aucun code de salon, adresse, lien, jeton ou identifiant n’est exporté. L’image
peut être copiée ou téléchargée, avec repli automatique vers le téléchargement
si le presse-papiers refuse les images. La modale PC et téléphone a été contrôlée
en Chromium, sans erreur console, débordement, texte coupé ni violation Axe.

## 9. Succès et easter eggs

- ajouter 100 succès au catalogue existant de 105, soit au moins 205 au total ;
- répartir les nouveaux succès entre découverte, progression, maîtrise, modes,
  coopération, prise de risque, bibliothèque et secrets ;
- difficultés graduées de très simple à exceptionnel ;
- une partie des succès reste cachée jusqu’au déblocage ;
- descriptions précises et conditions vérifiées côté moteur ;
- pas de succès impossible à cause d’un mode ou d’une métadonnée absente.

### Règle de révélation des easter eggs

- le futur mode **Indice** est le seul où un easter egg peut fournir librement un
  indice pendant la recherche ;
- dans tous les autres modes, l’easter egg reste absent du DOM jusqu’au verdict
  individuel autorisé : après un `guess true`, ou après un `guess false` seulement
  lorsque toutes les tentatives du joueur sont épuisées ;
- un `skip` ne vaut jamais `guess false` et ne déclenche aucun easter egg ;
- les écrans partagés ne révèlent l’effet qu’au moment où la réponse elle-même est
  autorisée, sans exposer auparavant de texte, attribut ou ressource révélatrice.

### Easter egg Portal validé

Pour un morceau parodiant ou référençant Portal, identifié par une règle de
métadonnée explicite et vérifiable :

- un gâteau apparaît sur l’écran TV ;
- si quelqu’un trouve, confettis et succès secret ;
- sinon le gâteau brûle à la révélation ;
- affichage de « The cake is a lie » ;
- l’effet ne doit pas révéler prématurément la réponse ;
- l’animation respecte le réglage de réduction des mouvements.

D’autres easter eggs pourront suivre la même architecture déclarative, sans ajouter
des conditions dispersées dans le code.

**Livré le 2 septembre 2026** : Portal est sélectionnable dans la fiche locale du
morceau, refusé s’il ne correspond pas au catalogue déclaratif, absent des trois
DOM avant le verdict autorisé, puis rendu sur PC, téléphone et TV. Une réussite
déclenche gâteau, confettis et succès secret ; un échec individuel reste privé
jusqu’à épuisement des tentatives et le gâteau ne brûle sur les écrans partagés
qu’à la révélation. Un skip ne déclenche rien. Les animations respectent
`prefers-reduced-motion`.

## 10. Diagnostic avant soirée

Un bouton unique doit contrôler :

- Node.js et les dépendances locales ;
- ports 3000 et 3001 ;
- instance unique ;
- lecture audio ;
- bibliothèque et nombre de morceaux jouables ;
- métadonnées indispensables ;
- Microsoft Defender pour les imports ;
- ffmpeg et yt-dlp si les téléchargements sont utilisés ;
- Tailscale, compte Songless et Funnel pour le mode Internet ;
- création d’une partie de test, QR, contrôleur, vue TV et permissions ;
- fermeture automatique de tous les éléments temporaires.

Le résultat doit être compréhensible sans terminal : Vert, À vérifier ou Bloquant,
avec une action recommandée.

**Première version livrée le 2 septembre 2026** : bouton hôte unique et rapport
Prêt/À vérifier/Bloquant pour Node.js, dépendances, ports, instance, accès réel à
un fichier audio, couverture des métadonnées, Defender, ffmpeg, yt-dlp et état
Tailscale/Funnel selon le mode lancé. Un salon temporaire éprouve la génération
du QR et la séparation hôte/TV/télécommande avant d’être supprimé. L’API refuse
les appareils distants. Le test sonore interactif joue deux notes et demande une
confirmation explicite.

**Validation visuelle finale le 4 septembre 2026** : le parcours complet a été
rejoué sur un serveur et une bibliothèque fictifs isolés à 1440 x 1000,
820 x 1180 et 390 x 844. Les états initial, rapport et confirmation des deux
notes sont lisibles ; les onze contrôles et le résumé concordent. Le contrôle ne
relève aucune erreur console ou HTTP, aucun débordement horizontal et aucune
violation Axe sérieuse ou critique. Les données personnelles et la bibliothèque
réelle n'ont pas été utilisées.

## 11. Phase zéro — audit complet obligatoire

Aucune nouvelle fonctionnalité ne commence avant cette phase.

### 11.1 Inventaire et préservation

- relever l’état Git et préserver les modifications existantes ;
- cartographier HTML, CSS, JavaScript, serveur, stockage et scripts ;
- inventorier tous les modes, réglages, routes et formats de données ;
- établir une sauvegarde locale réversible des fichiers modifiés ;
- ne jamais inclure les musiques ni les données personnelles dans Git.

### 11.2 Qualité du code

- `node --check` sur chaque fichier JavaScript ;
- recherche de code mort, duplications, fonctions trop longues et responsabilités
  mélangées ;
- vérification des erreurs asynchrones et promesses non gérées ;
- vérification de l’encodage UTF-8 et correction des textes corrompus ;
- contrôle des écritures atomiques et de la récupération après fichier incomplet ;
- audit des dépendances sans mise à jour aveugle.

### 11.3 Sécurité et permissions

- matrice de toutes les routes : local, appairé, invité, joueur, TV, télécommande et
  hôte ;
- tests négatifs fabriquant des requêtes sans droit ;
- vérification que le secret hôte n’apparaît ni dans une URL publique, ni dans le
  DOM TV, ni sur un contrôleur joueur ;
- rotation, expiration et révocation des jetons ;
- contrôle des chemins, uploads, archives, téléchargements et limites de taille ;
- aucune confiance accordée à une décision calculée par le navigateur.

### 11.4 Fonctionnel

- démarrage et arrêt par chaque lanceur ;
- mode local hors ligne ;
- LAN ;
- Internet via Funnel ;
- profils, statistiques, collections, défis, import et export ;
- ajout d’un morceau, scan Defender et erreurs maîtrisées ;
- chaque mode existant, en individuel et en équipes quand cohérent ;
- reconnexion, actualisation, abandon, égalité et fin de partie ;
- instance unique et libération des ports.

### 11.5 Affichage

- contrôle réel dans le navigateur sur PC ;
- formats téléphone étroit, téléphone large, tablette et autre ordinateur ;
- future vue TV en 1280×720, 1920×1080 et 4K ;
- zoom navigateur et textes longs ;
- clavier, focus visible et contraste ;
- console sans erreur et aucune ressource manquante ;
- aucune réponse secrète visible avant révélation ;
- test avec mouvements réduits.

### 11.6 Données et bibliothèque

- intégrité de `metadata.json` et `songless-data.json` ;
- cohérence des identifiants ;
- genres, années, favoris et pochettes ;
- doublons et fichiers manquants ;
- sauvegarde et restauration vérifiées sur une copie isolée ;
- aucun test destructeur sur la bibliothèque réelle.

### 11.7 Livrable d’audit

Un rapport classera chaque constat :

- bloquant ;
- important ;
- amélioration ;
- conforme.

Chaque anomalie contiendra preuve, risque, correction proposée et test de validation.

## 12. Plan d’action

### Phase 0 — vérifier avant de construire

Exécuter l’audit complet de la section 11, corriger d’abord les blocages et obtenir
une base reproductible sans erreur.

### Phase 1 — consolider le moteur

- formaliser un registre unique des modes et de leurs capacités ;
- centraliser règles, scores, vies, phases et conditions de victoire côté serveur ;
- stabiliser les contrats d’API et les tests ;
- conserver la compatibilité avec les données existantes.

### Phase 2 — construire les rôles et permissions

- jetons distincts hôte, télécommande, TV et joueur ;
- création hôte réservée au PC local ;
- appairage, révocation et expiration ;
- tests d’autorisation systématiques ;
- reconnexion sûre sans transfert du secret principal.

### Phase 3 — créer TV et télécommande administrateur

- interface TV dédiée ;
- téléphone administrateur ;
- lobby et appairage ;
- synchronisation de phase et reprise après coupure ;
- validation visuelle multi-écrans.
- lanceur Android permettant d’héberger Songless sans PC ;
- interface admin tactile complète et écran centralisé des QR codes ;
- sélecteur Android natif limité au dossier choisi, import récursif des
  sous-dossiers et permission persistante ;
- copie dans une zone temporaire privée puis contrôle ClamAV atomique de toute
  la collection avant installation ;
- identité d’hôte liée à l’instance lancée et protégée par le stockage sécurisé du
  téléphone ;
- tests réels d’arrière-plan, reprise et réseau local sur le téléphone cible.

### Phase 4 — unifier les modes existants

- classique, buzzer, survie, duel, solo, entraînement, collections et défis ;
- comportement cohérent PC, TV et contrôleurs ;
- équipes, égalités, abandons et fin de partie ;
- duel final limité aux deux survivants.

### Phase 5 — fiabiliser la bibliothèque

- taxonomie des genres ;
- année canonique et provenance ;
- favoris et pochettes ;
- doublons ;
- indice de qualité ;
- blacklist temporaire configurable.

Cette phase précède Intrus et les manches thématiques.

### Phase 6 — ajouter les nouveaux modes

Ordre recommandé :

1. Confiance ;
2. Coopération ;
3. Intrus ;
4. Enchères ;
5. Joker ;
6. Missions secrètes ;
7. handicap intelligent.

Chaque mode est livré simultanément sur PC, TV et contrôleur, avec tests de règles
et permissions. Aucun mode ne sera laissé « PC uniquement » en attente.

### Phase 7 — enrichir la personnalité — livrée

- portraits musicaux et 50 titres de podium ;
- 100 nouveaux succès ;
- architecture déclarative des easter eggs ;
- easter egg Portal ;
- carte souvenir et animations accessibles.

### Phase 8 — diagnostic et finition

- diagnostic avant soirée ;
- tests de charge raisonnables ;
- audit final des permissions ;
- parcours complet local, LAN et Internet ;
- contrôle visuel de tous les écrans ;
- documentation simple pour l’utilisateur non technique.
- fabrication du kit transférable Windows/Android et des installateurs autonomes ;
- installation, réparation, mise à jour et désinstallation testées sans terminal ;
- matrice de compatibilité publiée uniquement pour les plateformes réellement
  exécutées et validées.

## 13. Critères de livraison

Une phase est terminée uniquement si :

1. les tests automatisés concernés passent ;
2. chaque JavaScript modifié passe `node --check` ;
3. aucun secret ou jeton durable n’est ajouté au dépôt ;
4. les données réelles n’ont pas servi de jeu de test ;
5. les permissions sont testées positivement et négativement ;
6. les interfaces PC, TV et téléphone ont été ouvertes et inspectées ;
7. la console navigateur est vide ;
8. le mode local fonctionne sans Internet ;
9. le tunnel de test est refermé ;
10. l’état Git et les fichiers modifiés sont expliqués.

## 14. Hors périmètre

- héberger les musiques sur un VPS ;
- exposer la bibliothèque audio comme service public permanent ;
- publier le dépôt ou les données ;
- remplacer Tailscale Funnel par une ouverture de ports domestiques ;
- donner aux téléphones joueurs, TV ou télécommandes non administratrices les
  droits de suppression ou d’import ;
- ajouter une dépendance cloud obligatoire au fonctionnement du jeu.
- héberger Songless sur macOS, Linux, iPhone ou iPad ; ces appareils restent
  utilisables comme joueur, TV ou télécommande par navigateur.

## 15. Avancement réel au 4 septembre 2026

| Phase | État | Réalisé | Reste principal |
|---|---|---|---|
| 0 — Audit | Livrée | Audit moteur, HTTP, bibliothèque, encodage, sécurité et contrôle Playwright/Axe multi-écrans ; lanceurs Windows local et Wi-Fi rejoués sur une installation fraîche et isolée ; lanceur Internet frais validé avec HTTPS Funnel, salon, QR et invitation, puis fermeture automatique du tunnel et libération des ports | — |
| 1 — Moteur | Livrée | Registre unique des 17 formats et capacités ; règles, scores, vies, phases et conditions de victoire calculés côté serveur ; façade `party-engine` validant et centralisant les contrats entre commandes, manches, résultats et stockage joueur ; compatibilité des profils et historiques existants couverte par les tests de stockage/import ; suite complète, permissions et charge validées | — |
| 2 — Rôles | Très avancée | Jetons distincts hôte, joueur, TV et télécommande ; expiration et révocation ; tests négatifs ; clé d’installation Windows protégée par DPAPI, secret de démarrage dérivé et session admin HttpOnly refusant un autre onglet local | Reconnexion et validation visuelle réelle sur les appareils cibles |
| 3 — TV/admin | Version Android signée | `tv.html`, `remote.html`, boutons d’appairage et commandes limitées ; écran hôte centralisant les QR joueur, TV et télécommande avec jetons temporaires séparés et tests de rôle, révocation et refus distant ; APK Release autonome React Native + Node embarqué ouvert sur un émulateur Android 17 neuf ; interface WebView et bibliothèque administrateur visibles ; textes Windows masqués sur l’hôte Android ; architectures ARM64 et x86-64 ; second lancement à chaud sans serveur en double ; service d’arrière-plan et notification persistante contrôlés, serveur encore joignable après retour à l’accueil Android ; ClamAV 1.5.4 ARM64/x86-64 et bases officielles embarqués ; sélecteur SAF natif avec permission persistante, import récursif plafonné à 5 000 fichiers / 32 Go et copie privée avant analyse ; collection saine installée, EICAR refusé atomiquement et lot temporaire nettoyé ; mise à jour différée sans désactiver la protection hors ligne ; provenance et licences documentées ; longue ligne de bibliothèque et actions en lot corrigées puis contrôlées visuellement sur l’émulateur ; clé Release RSA 4096 bits privée générée hors dépôt, mot de passe protégé par DPAPI et APK v2 signé ; moteur YouTube JavaScript embarqué avec recherche, métadonnées, playlists et flux M4A sans Python, yt-dlp ni ffmpeg, validé par une recherche et un téléchargement public réel ; Express 5.2.1 et Multer 2.3.0 embarqués avec adaptation Android testée de `path-to-regexp` au moteur Node Mobile ; Release installée sur l’émulateur 16 Kio, interface et serveur validés en mode de compatibilité ; service relancé automatiquement après un redémarrage Android complet et API hôte disponible sans ouverture manuelle ; React Native 0.77.3, pont Node Mobile 16 Kio recompilé et audit ELF reproductible des 56 bibliothèques ramenant les incompatibilités de 22 à 2, limitées aux variantes ARM64 et x86-64 de `libnode.so` | Reconstruire `libnode.so` sur Linux pour la compatibilité native 16 Kio complète, sauvegarder la clé, puis valider sur le POCO |
| 4 — Modes existants | Livrée | Duel final Battle Royale à deux survivants, persistance du vrai vainqueur et interfaces PC/TV/télécommande/téléphone validées ; catalogue commun de 17 formats couvrant les 10 modes multijoueurs et les formats solo limités/sans fin, Duel PC, Survie PC, entraînement, collections et défis ; chaque fiche indique joueurs, durée, victoire, actions, commandes, TV, équipes et compatibilité, avec rendu repliable contrôlé sur PC/téléphone ; sessions locales harmonisées avec suivi sans fin, collections réellement bornées, défis sans fin conservés, bouton d’arrêt/bilan et retour automatique au bilan ; contraintes mystère filtrées selon les modes, effets de score et tentative unique vérifiés côté serveur ; option Mystère masquée pour Intrus et rétablie pour Enchères/Classique lors du contrôle Chrome réel | — |
| 5 — Bibliothèque | Très avancée | Audit des 1 687 fichiers, favoris unifiés, sous-genres et années avec provenance/confiance, filtres précis, aperçus obligatoires avant application des années ou genres en lot, blacklist temporaire, mesure d’encodage et dimensions de pochettes, comparateur réversible de doublons et indice de qualité explicable ; file de validation manuelle séparant titres officiels, variantes et chaque type de champ absent ou incertain, avec compteurs dynamiques et contrôle visuel ordinateur/mobile ; l’édition d’un titre ne certifie plus silencieusement son genre et protège un artiste corrigé en `manual/high` ; migration rétrocompatible de la confiance depuis les provenances historiques ; enrichissement initial par tags et cache MusicBrainz, puis vérification Internet complète des 1 687 fiches avec 312 correspondances MusicBrainz, 1 352 replis YouTube et 23 absences définitives, appliquée après aperçu complet, simulation isolée et sauvegarde ; le repli dangereux par titre seul est supprimé et les 40 artistes concernés remis en revue ; 14 années Solatorobo et 5 identités/années ambiguës ont ensuite été confirmées ; couverture portée à 721 genres fiables et 428 années fiables ; Intrus, le mode année et les thèmes genre/décennie refusent strictement toute métadonnée de confiance faible ou inconnue, avec verrou identique côté client et serveur | Valider manuellement 669 genres présents mais incertains, compléter 297 genres absents, confirmer 36 artistes ambigus et renseigner 2 années encore obligatoires ; 980 fiches nécessitent au moins une revue selon le moteur |
| 6 — Nouveaux modes | Livrée | Confiance, Coopération, Intrus, Enchères, Joker, Missions secrètes et Handicap intelligent livrés côté serveur, PC, contrôleur et TV, avec tests de règles, permissions et contrôle visuel Playwright/Axe | — |
| 7 — Personnalité | Livrée | Catalogue porté de 105 à 206 succès : **100/100 nouveaux succès** déclaratifs plus le succès secret Portal, persistants, dédupliqués et contrôlés sur PC/téléphone ; succès secrets masqués avant déblocage ; **50/50 titres de podium** factuels et uniques ; Portal déclaratif et anti-spoiler contrôlé sur PC/téléphone/TV ; carte souvenir PNG privée par défaut, copie, téléchargement et animations accessibles contrôlés sur PC/téléphone | — |
| 8 — Finition | Avancée | Carte souvenir documentée ; diagnostic avant soirée ; kit Windows x64 autonome construit et audité ; installation fraîche, lancement local, lancement Wi-Fi, réparation avec conservation exacte de la clé d’autorité et désinstallation avec conservation des données validés sur un espace isolé ; réglages durables du kit déplacés dans `Songless-Data`, migration des anciennes installations prévue et confirmation explicite du compte Tailscale ajoutée au premier lancement Internet ; parcours Internet frais validé de bout en bout avec HTTPS Funnel, salon, QR, invitation et nettoyage ; contrôle visuel Android automatisé par émulateur isolé, ayant permis de corriger le chargement ESM de `music-metadata` et les expressions Unicode incompatibles avec Node mobile ; Release corrigée réinstallée sur Android 17 et diagnostic hôte réel rejoué : 8 contrôles verts, 1 contrôle manuel et seulement 2 blocages attendus sur une installation vierge sans musique ; test de charge HTTP reproductible avec 32 joueurs, 32 réponses simultanées, 640 états et 8 flux audio concurrents, dernière passe p95 à 15 ms ; matrice finale des permissions validant invitation, joueur, TV et télécommande, puis le refus de 41 routes administratives même avec une invitation valide ; joueur téléphone, télécommande administrateur et démarrage Android réharmonisés avec le Songless original puis vérifiés à 390 × 844 sans débordement, tandis que la TV validée reste inchangée ; constructeur Android en double clic détectant JDK et SDK, régénérant le moteur embarqué, purgeant ses caches générés, signant l’APK avec la clé privée réutilisable, vérifiant la signature, l’alignement de l’archive, l’empreinte SHA-256 et l’absence de données privées ; Release React Native 0.77.3 compilée et signée en v2 ; `music-metadata` 11.15.0 intégré, tests ciblés et suite complète verts ; kit Windows reconstruit le 4 septembre (3 980 fichiers, 595 Mo), manifeste vérifié fichier par fichier ; APK reconstruit et signé en v2, SHA-256 `06C57681EF29B3CB2549D6757A37F0C04FD8E2C5D4C6C737B43668683E7E5553` ; audit Android 17 ramené de 22 à 2 bibliothèques incompatibles après recompilation du pont, le constructeur Linux de `libnode.so` restant à exécuter | Reconstruction Linux de `libnode.so`, sauvegarde de signature et validation sur le POCO |

**Validation du dernier APK au 4 septembre 2026** : l’APK intégrant
`music-metadata` 11.15.0 a été réinstallé avec succès sur l’émulateur Android 17
à pages de 16 Kio. Le démarrage à froid est confirmé en 1,24 s, l’API hôte répond
sur le port 3000, l’écran administrateur est rendu correctement, aucun journal
d’erreur Android, React Native ou Chromium n’est présent, et le service reste au
premier plan avec notification pendant que l’application est en arrière-plan.

**Compatibilité Android 16 Kio au 4 septembre 2026** : la migration de React
Native 0.76.9 vers 0.77.3 a réduit le bilan de 22 à 4 bibliothèques natives
incompatibles. Le pont Node Mobile a ensuite été recompilé avec un alignement de
16 Kio, ramenant le bilan réel à 2 sur 56 : `libnode.so` pour ARM64 et x86-64.
Un constructeur Linux reproductible est prêt pour reconstruire ces deux fichiers
depuis Node Mobile v18.20.4 au commit vérifié
`959b6e8637c86fb1f63f1aaf72adc86c7e8c335d`, avec le NDK r28. Il n’a pas encore
été exécuté faute d’environnement Linux/VPS accessible ; la compatibilité native
complète n’est donc pas déclarée.

Le VPS est désormais accessible, mais son inventaire du 3 septembre 2026 n'a
relevé que 13 Gio libres sur la partition qui héberge aussi ses services. Le NDK
r28 n'y est pas présent et la chaîne de compilation (`make`, GCC/G++ et `unzip`)
reste à installer. La compilation n'a volontairement pas été lancée afin de ne
pas risquer de saturer un serveur en service. WSL n'est pas installé sur le PC.
Le constructeur reste donc prêt pour un environnement Linux disposant d'un
volume de travail suffisamment dimensionné ; cette limite ne concerne pas le
fonctionnement actuel de l'APK en mode de compatibilité Android.

**Signature Android au 3 septembre 2026** : les outils d’export PKCS12 chiffré
et de restauration sans écrasement ont été validés de bout en bout sur une clé
factice ; le certificat restauré est strictement identique et le nouveau secret
local est reprotégé par DPAPI. La sauvegarde de la vraie clé reste à déclencher
par Manaël afin que son mot de passe ne soit ni enregistré ni exposé à un agent.

Les opérations restantes dépendant du POCO, de Linux, d'un secret humain ou d'un
autre système sont détaillées pas à pas dans
`VALIDATIONS-EXTERNES-SONGLESS.md`. Elles ne déclenchent aucun achat automatique.

Un élément n’est considéré comme livré que s’il respecte les critères de la
section 13. Une présence dans le présent document signifie « demandé », pas
« déjà développé ».

## 16. État initial constaté avant audit approfondi

- le dépôt contient actuellement 105 trophées ;
- les modes multijoueurs visibles sont Classique, Buzzer, Battle Royale, Duel,
  Confiance, Coopération, Intrus, Enchères, Joker et Missions secrètes ;
- le mode Survie à trois vies existe en solo et en multijoueur ;
- les contrôleurs utilisent déjà des jetons joueur et les commandes hôte un jeton
  distinct ;
- trois modifications locales préexistantes concernent la séparation des comptes
  Tailscale ; elles doivent être préservées ;
- le mode Internet Songless et son QR ont été vérifiés avec succès le 2 septembre
  2026 ;
- certains textes du serveur semblent présenter des traces d’encodage corrompu et
  devront être confirmés pendant l’audit ;
- aucune fonctionnalité nouvelle de ce cahier des charges n’est considérée comme
  livrée tant qu’elle n’a pas passé les critères de la section 13.

## 17. Reprise vérifiée du 5 septembre 2026

La correction d'identité MusicBrainz déjà présente dans les modifications locales
a été terminée et testée. L'API de bibliothèque transmet désormais le statut de
variante non officielle, le rapprochement MusicBrainz et les informations d'album.
Le statut de variante utilise le même détecteur que l'enrichissement, y compris
en secours sur le nom d'un fichier sans fiche enrichie. Les filtres n'exigent plus
artiste et année pour les variantes ; leur genre reste obligatoire et doit être
fiable. Les morceaux ordinaires conservent les exigences artiste et année.

Une correction effective de titre ou d'artiste retire le rapprochement obsolète
et l'album non manuel ; une simple différence de casse ne les retire pas. Un
album saisi à la main est conservé, tout comme une année manuelle. Le nom du
fichier audio ne change pas. Aucun classement de la bibliothèque réelle n'a été
modifié pendant cette reprise.

Le contrôle visuel a également trouvé des actions de sélection coupées et des
titres presque invisibles sur une fenêtre étroite hors Android. La bibliothèque
utilise désormais deux lignes pour séparer identité et commandes sous 820 px ;
les actions en lot s'empilent et les onglets étroits placent l'icône au-dessus du
libellé. La TV conserve son habillage.

Validation : suite complète `npm.cmd test` réussie après la correction serveur ;
34 contrôles statiques d'interface réussis après la correction CSS ; parcours
Chrome réel à 1440 x 1000 et 390 x 844 avec filtres, compteurs, édition et
persistance ; aucune erreur console/HTTP, aucun débordement, aucun titre ni bouton
de bibliothèque coupé dans le scénario final. Les captures ont été inspectées.
Preuves hors dépôt : `Codex\songless-reprise-20260905\visuel\rapport.json`.

Le kit Windows a été reconstruit : 3 983 fichiers, 623 461 241 octets couverts par
le manifeste ; tailles et SHA-256 vérifiés fichier par fichier, et correspondance
des sources serveur/CSS confirmée. Les paquets ne contiennent pas la bibliothèque
ni les profils personnels.

Comptage en lecture seule au 5 septembre : 1 687 morceaux, 979 fiches nécessitant
au moins une revue, 297 genres absents, 669 genres incertains, 22 artistes
incertains, aucun artiste obligatoire absent, 2 années obligatoires absentes,
aucune année obligatoire présente mais incertaine. Les catégories se recoupent.
Ces chiffres remplacent les anciens compteurs de la section 15.

Les validations POCO, la sauvegarde humaine de la signature et la reconstruction
Linux des deux `libnode.so` restent ouvertes. La phase 5 et la compatibilité
Android native 16 Kio ne sont pas déclarées achevées. Aucun push effectué.

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
