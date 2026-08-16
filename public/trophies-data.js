'use strict';

/**
 * Catalogue complet des 105 Trophées Songless
 * Catégories :
 * - speed: Rapidité & Réflexes (15)
 * - accuracy: Précision & Séries (15)
 * - time: Années & Décennies (12)
 * - genre: Genres & Découvertes (13)
 * - audio: Sens & Effets Audio FX (12)
 * - battle: Duels & Battle Royale (13)
 * - party: Multijoueur & Soirées (13)
 * - secrets: Insolite & Cachés (12)
 */
const SONGLESS_TROPHIES = [
  // ============================================================
  // 1. RAPIDITÉ & RÉFLEXES (15 trophées)
  // ============================================================
  { id: 'speed_first', cat: 'speed', icon: '⚡', name: 'Première Étincelle', desc: 'Trouver un morceau dès le 1er palier (0,2 s).' },
  { id: 'speed_3_row', cat: 'speed', icon: '⚡', name: 'Oreille d’Or', desc: 'Trouver 3 morceaux d’affilée dès le 1er palier.' },
  { id: 'speed_5_row', cat: 'speed', icon: '⚡', name: 'Réflexe Foudroyant', desc: 'Trouver 5 morceaux d’affilée dès le 1er palier.' },
  { id: 'speed_10_total', cat: 'speed', icon: '🚀', name: 'Le Shinkansen', desc: 'Cumuler 10 victoires au 1er palier.' },
  { id: 'speed_25_total', cat: 'speed', icon: '🚀', name: 'Vitesse Lumière', desc: 'Cumuler 25 victoires au 1er palier.' },
  { id: 'speed_50_total', cat: 'speed', icon: '🌌', name: 'Télépathe Sonore', desc: 'Cumuler 50 victoires au 1er palier.' },
  { id: 'speed_second_step', cat: 'speed', icon: '⏱️', name: 'Presque Instantané', desc: 'Trouver un morceau au 2e palier (0,7 s).' },
  { id: 'speed_clutch_6', cat: 'speed', icon: '🛡️', name: 'Au Bout du Suspense', desc: 'Trouver un morceau au 6e palier (15 s).' },
  { id: 'speed_clutch_5_row', cat: 'speed', icon: '🧗', name: 'L’Insubmersible', desc: 'Trouver 5 morceaux au 6e palier sans jamais perdre.' },
  { id: 'speed_instant_submit', cat: 'speed', icon: '🎯', name: 'Doigt sur la Gâchette', desc: 'Valider une bonne réponse en moins de 3 secondes après le lancement.' },
  { id: 'speed_hardcore_1', cat: 'speed', icon: '💀', name: 'Brave Hardcore', desc: 'Trouver un morceau avec les paliers Hardcore (0,1 s).' },
  { id: 'speed_hardcore_5', cat: 'speed', icon: '🏆', name: 'Maître du Hardcore', desc: 'Trouver 5 morceaux consécutifs en difficulté Hardcore.' },
  { id: 'speed_turbo_win', cat: 'speed', icon: '🏎️', name: 'Pilote de F1', desc: 'Gagner une manche avec la vitesse audio ×1,5.' },
  { id: 'speed_slow_win', cat: 'speed', icon: '🐢', name: 'Patience Zen', desc: 'Gagner une manche avec la vitesse audio ×0,75.' },
  { id: 'speed_no_pause', cat: 'speed', icon: '🌊', name: 'D’une Seule Traite', desc: 'Enchaîner 5 manches sans jamais mettre en pause l’audio.' },

  // ============================================================
  // 2. PRÉCISION & SÉRIES (15 trophées)
  // ============================================================
  { id: 'acc_first_win', cat: 'accuracy', icon: '🎵', name: 'Premier Pas', desc: 'Remporter votre toute première manche.' },
  { id: 'acc_win_5', cat: 'accuracy', icon: '🥉', name: 'Mélomane en Herbe', desc: 'Trouver 5 morceaux au total.' },
  { id: 'acc_win_20', cat: 'accuracy', icon: '🥈', name: 'Connaisseur Averti', desc: 'Trouver 20 morceaux au total.' },
  { id: 'acc_win_50', cat: 'accuracy', icon: '🥇', name: 'Grand Maestro', desc: 'Trouver 50 morceaux au total.' },
  { id: 'acc_win_100', cat: 'accuracy', icon: '👑', name: 'Encyclopédie Vivante', desc: 'Trouver 100 morceaux au total.' },
  { id: 'acc_win_250', cat: 'accuracy', icon: '🌟', name: 'Légende Musicale', desc: 'Trouver 250 morceaux au total.' },
  { id: 'acc_streak_5', cat: 'accuracy', icon: '🔥', name: 'En Pleine Flamme', desc: 'Réussir une série de 5 victoires sans aucune défaite.' },
  { id: 'acc_streak_10', cat: 'accuracy', icon: '🔥', name: 'Inarrêtable', desc: 'Réussir une série de 10 victoires consécutives.' },
  { id: 'acc_streak_20', cat: 'accuracy', icon: '☄️', name: 'Météorite', desc: 'Réussir une série de 20 victoires consécutives.' },
  { id: 'acc_format_perfect_5', cat: 'accuracy', icon: '🎯', name: 'Quinté Parfait', desc: 'Faire un sans-faute sur une partie Format de 5 morceaux.' },
  { id: 'acc_format_perfect_10', cat: 'accuracy', icon: '🏆', name: 'La Décimale Parfaite', desc: 'Faire 10/10 sur une partie Format de 10 morceaux.' },
  { id: 'acc_format_perfect_20', cat: 'accuracy', icon: '💎', name: 'Chef-d’Œuvre', desc: 'Faire 20/20 sur une partie Format de 20 morceaux.' },
  { id: 'acc_no_wrong_guess', cat: 'accuracy', icon: '👌', name: 'Zéro Faux Pas', desc: 'Gagner 10 manches sans jamais soumettre une mauvaise réponse.' },
  { id: 'acc_all_artists', cat: 'accuracy', icon: '🎙️', name: 'Reconnaissance Vocale', desc: 'Trouver 15 morceaux en mode « Deviner l’Artiste ».' },
  { id: 'acc_exact_title', cat: 'accuracy', icon: '✍️', name: 'Au Mot Près', desc: 'Trouver un titre comportant plus de 5 mots.' },

  // ============================================================
  // 3. ANNÉES & DÉCENNIES (12 trophées)
  // ============================================================
  { id: 'time_first_year', cat: 'time', icon: '📅', name: 'Historien Débutant', desc: 'Trouver une année exacte en mode « Deviner l’Année ».' },
  { id: 'time_year_streak_3', cat: 'time', icon: '🕰️', name: 'Chronomètre Mental', desc: 'Trouver 3 années exactes d’affilée.' },
  { id: 'time_year_total_10', cat: 'time', icon: '⏳', name: 'Voyageur Temporel', desc: 'Trouver 10 années exactes au total.' },
  { id: 'time_decade_70', cat: 'time', icon: '📻', name: 'Génération Vinyle', desc: 'Trouver 5 morceaux sortis dans les années 70 ou avant.' },
  { id: 'time_decade_80', cat: 'time', icon: '📼', name: 'Flashback 80s', desc: 'Trouver 5 morceaux des années 1980.' },
  { id: 'time_decade_90', cat: 'time', icon: '💾', name: 'Génération Eurodance & Grunge', desc: 'Trouver 5 morceaux des années 1990.' },
  { id: 'time_decade_2000', cat: 'time', icon: '💿', name: 'Années MP3', desc: 'Trouver 5 morceaux des années 2000.' },
  { id: 'time_decade_2010', cat: 'time', icon: '📱', name: 'Ère du Streaming', desc: 'Trouver 5 morceaux des années 2010.' },
  { id: 'time_decade_2020', cat: 'time', icon: '🎧', name: 'Fraîcheur Actuelle', desc: 'Trouver 5 morceaux sortis après 2020.' },
  { id: 'time_all_decades', cat: 'time', icon: '🌍', name: 'À Travers les Âges', desc: 'Trouver au moins un morceau dans 4 décennies différentes.' },
  { id: 'time_ancient_gem', cat: 'time', icon: '🏛️', name: 'Pièce de Musée', desc: 'Trouver un morceau sorti il y a plus de 40 ans.' },
  { id: 'time_brand_new', cat: 'time', icon: '✨', name: 'Tout Chaud', desc: 'Trouver un morceau sorti cette année.' },

  // ============================================================
  // 4. GENRES & DÉCOUVERTES (13 trophées)
  // ============================================================
  { id: 'genre_filter_use', cat: 'genre', icon: '🎚️', name: 'Sélecteur Pointu', desc: 'Jouer une partie en filtrant sur un genre précis.' },
  { id: 'genre_rock', cat: 'genre', icon: '🎸', name: 'Rockeur Pur Jus', desc: 'Trouver 5 morceaux de Rock.' },
  { id: 'genre_pop', cat: 'genre', icon: '🎤', name: 'Star de la Pop', desc: 'Trouver 5 morceaux de Pop.' },
  { id: 'genre_electro', cat: 'genre', icon: '🎹', name: 'Nuit Électro', desc: 'Trouver 5 morceaux d’Électro / Dance.' },
  { id: 'genre_rap', cat: 'genre', icon: '🧢', name: 'Flow Impeccable', desc: 'Trouver 5 morceaux de Rap / Hip-Hop.' },
  { id: 'genre_rnb', cat: 'genre', icon: '🎷', name: 'Groove & Soul', desc: 'Trouver 5 morceaux de R&B / Soul.' },
  { id: 'genre_metal', cat: 'genre', icon: '🤘', name: 'Décibels d’Acier', desc: 'Trouver 3 morceaux de Metal.' },
  { id: 'genre_french', cat: 'genre', icon: '🥖', name: 'Variété & Chanson', desc: 'Trouver 5 morceaux francophones.' },
  { id: 'genre_soundtrack', cat: 'genre', icon: '🎬', name: 'Cinéphile Averti', desc: 'Trouver 3 musiques de film, série ou jeu vidéo.' },
  { id: 'genre_eclectic', cat: 'genre', icon: '🌈', name: 'Oreille Éclectique', desc: 'Gagner des morceaux dans 5 genres différents.' },
  { id: 'genre_collection_create', cat: 'genre', icon: '📚', name: 'Curateur Musical', desc: 'Créer votre première collection personnalisée.' },
  { id: 'genre_collection_play', cat: 'genre', icon: '🗂️', name: 'Jukebox Privé', desc: 'Terminer une session complète sur une collection.' },
  { id: 'genre_challenge_save', cat: 'genre', icon: '🏅', name: 'Créateur de Défis', desc: 'Enregistrer un défi pour vos amis.' },

  // ============================================================
  // 5. SENS, REVERS & EFFETS AUDIO FX (12 trophées)
  // ============================================================
  { id: 'audio_reverse_first', cat: 'audio', icon: '🔄', name: 'Monde à l’Envers', desc: 'Gagner un morceau joué en lecture inversée.' },
  { id: 'audio_reverse_3', cat: 'audio', icon: '🌀', name: 'Sens Dessus Dessous', desc: 'Trouver 3 morceaux consécutifs à l’envers.' },
  { id: 'audio_reverse_10', cat: 'audio', icon: '🔮', name: 'Sorcier du Rétrograde', desc: 'Trouver 10 morceaux en lecture inversée.' },
  { id: 'audio_fx_8bit', cat: 'audio', icon: '🕹️', name: 'Nostalgie Arcade', desc: 'Trouver un morceau avec le filtre audio 8-Bit Chiptune.' },
  { id: 'audio_fx_radio', cat: 'audio', icon: '📻', name: 'Fréquence 1920', desc: 'Trouver un morceau avec le filtre Radio Vintage.' },
  { id: 'audio_fx_underwater', cat: 'audio', icon: '🌊', name: 'En Apnée', desc: 'Trouver un morceau avec le filtre Sous l’Eau.' },
  { id: 'audio_fx_nightcore', cat: 'audio', icon: '⚡', name: 'Hyperactivité', desc: 'Trouver un morceau avec l’effet Nightcore survolté.' },
  { id: 'audio_fx_slowed', cat: 'audio', icon: '🌙', name: 'Ambiance Vaporeuse', desc: 'Trouver un morceau avec l’effet Slowed + Reverb.' },
  { id: 'audio_fx_bass', cat: 'audio', icon: '🔊', name: 'Caisson de Basses', desc: 'Trouver un morceau avec l’effet Bass Boost activé.' },
  { id: 'audio_fx_all', cat: 'audio', icon: '🎛️', name: 'Ingénieur du Son', desc: 'Avoir remporté au moins une manche avec chaque filtre audio.' },
  { id: 'audio_refrain_start', cat: 'audio', icon: '🌟', name: 'Cœur du Morceau', desc: 'Gagner une manche avec le départ fixé sur « Le refrain ».' },
  { id: 'audio_debut_start', cat: 'audio', icon: '🎬', name: 'Dès les Premières Notes', desc: 'Gagner une manche avec le départ fixé sur « Le début ».' },

  // ============================================================
  // 6. DUELS & BATTLE ROYALE (13 trophées)
  // ============================================================
  { id: 'battle_royale_first', cat: 'battle', icon: '👑', name: 'Premier Sang Royale', desc: 'Participer à une partie en mode Battle Royale.' },
  { id: 'battle_royale_win', cat: 'battle', icon: '🏆', name: 'Dernier Survivant', desc: 'Remporter une Battle Royale sans perdre toutes vos vies.' },
  { id: 'battle_royale_flawless', cat: 'battle', icon: '💖', name: 'Cœur Pur', desc: 'Gagner une Battle Royale en gardant vos 3 cœurs intacts.' },
  { id: 'battle_royale_ghost', cat: 'battle', icon: '👻', name: 'Esprit Frappeur', desc: 'Envoyer des réactions et encouragements en mode Fantôme.' },
  { id: 'battle_royale_clutch', cat: 'battle', icon: '❤️‍🩹', name: 'Au Bord du Gouffre', desc: 'Gagner une Battle Royale alors qu’il ne vous restait qu’un seul cœur.' },
  { id: 'duel_first', cat: 'battle', icon: '🥊', name: 'Gant Jeté', desc: 'Participer à votre premier Duel de vitesse.' },
  { id: 'duel_win', cat: 'battle', icon: '🥇', name: 'Victoire au Sommet', desc: 'Remporter un Duel en tirant la corde jusqu’à votre camp.' },
  { id: 'duel_streak_3', cat: 'battle', icon: '🥋', name: 'Ceinture Noire', desc: 'Gagner 3 Duels d’affilée.' },
  { id: 'duel_comeback', cat: 'battle', icon: '⚡', name: 'Remontada', desc: 'Gagner un Duel après avoir été mené à plus de 70% par l’adversaire.' },
  { id: 'duel_fast_finish', cat: 'battle', icon: '💥', name: 'K.O. Éclair', desc: 'Terminer un Duel en moins de 3 manches.' },
  { id: 'battle_5_victories', cat: 'battle', icon: '⚔️', name: 'Gladiateur Vétéran', desc: 'Cumuler 5 victoires en mode Duel ou Battle Royale.' },
  { id: 'battle_10_victories', cat: 'battle', icon: '🛡️', name: 'Champion de l’Arène', desc: 'Cumuler 10 victoires en mode Duel ou Battle Royale.' },
  { id: 'battle_team_champion', cat: 'battle', icon: '👥', name: 'Force Collective', desc: 'Remporter un Duel ou une Battle Royale en équipe.' },

  // ============================================================
  // 7. MULTIJOUEUR & SOIRÉES (13 trophées)
  // ============================================================
  { id: 'party_first_join', cat: 'party', icon: '📱', name: 'Connecté !', desc: 'Rejoindre une soirée multijoueur depuis un smartphone.' },
  { id: 'party_host_first', cat: 'party', icon: '🎉', name: 'Maître de Cérémonie', desc: 'Héberger votre première partie multijoueur sur PC.' },
  { id: 'party_podium_gold', cat: 'party', icon: '🥇', name: 'Sur la Première Marche', desc: 'Terminer 1er d’une soirée multijoueur.' },
  { id: 'party_podium_silver', cat: 'party', icon: '🥈', name: 'Médaille d’Argent', desc: 'Monter sur le podium en 2e place.' },
  { id: 'party_podium_bronze', cat: 'party', icon: '🥉', name: 'Médaille de Bronze', desc: 'Monter sur le podium en 3e place.' },
  { id: 'party_team_create', cat: 'party', icon: '🚩', name: 'Capitaine d’Équipe', desc: 'Créer une équipe et accueillir des coéquipiers.' },
  { id: 'party_team_win', cat: 'party', icon: '🏆', name: 'Équipe Championne', desc: 'Mener votre équipe à la victoire finale.' },
  { id: 'party_buzzer_win', cat: 'party', icon: '🔔', name: 'Buzzer d’Or', desc: 'Remporter une partie complète en mode Buzzer.' },
  { id: 'party_react_spam', cat: 'party', icon: '🔥', name: 'Ambianceur en Chef', desc: 'Envoyer au moins 10 réactions d’émojis au cours d’une soirée.' },
  { id: 'party_souvenir_copy', cat: 'party', icon: '📋', name: 'Gardien des Souvenirs', desc: 'Copier la carte souvenir Wrapped à la fin d’une partie.' },
  { id: 'party_history_view', cat: 'party', icon: '📜', name: 'Archives Royales', desc: 'Consulter le Palmarès des soirées.' },
  { id: 'party_mystery_win', cat: 'party', icon: '🃏', name: 'Dompteur du Chaos', desc: 'Gagner une manche avec un Défi Mystère actif.' },
  { id: 'party_random_team', cat: 'party', icon: '🎲', name: 'Destin Aléatoire', desc: 'Jouer une partie avec la répartition aléatoire des équipes.' },

  // ============================================================
  // 8. INSOLITE, HABITUDES & SECRETS (12 trophées)
  // ============================================================
  { id: 'secret_night_owl', cat: 'secrets', icon: '🦉', name: 'Oiseau de Nuit', desc: 'Jouer une manche entre minuit et 5h du matin.' },
  { id: 'secret_early_bird', cat: 'secrets', icon: '🌅', name: 'Chant du Coq', desc: 'Jouer une manche entre 6h et 8h du matin.' },
  { id: 'secret_avatar_collector', cat: 'secrets', icon: '🎭', name: 'Caméléon', desc: 'Changer au moins 3 fois d’avatar dans vos profils.' },
  { id: 'secret_quiz_print', cat: 'secrets', icon: '📄', name: 'Imprimeur de Quiz', desc: 'Générer une fiche de quiz apéro imprimable.' },
  { id: 'secret_demo_run', cat: 'secrets', icon: '🤖', name: 'Face aux Robots', desc: 'Terminer une démo simulée contre les 5 bots.' },
  { id: 'secret_seed_copy', cat: 'secrets', icon: '🔗', name: 'Partageur de Graine', desc: 'Copier le lien d’une seed pour la partager.' },
  { id: 'secret_seed_custom', cat: 'secrets', icon: '✏️', name: 'Architecte de Seed', desc: 'Jouer une seed personnalisée saisie à la main.' },
  { id: 'secret_training_smart', cat: 'secrets', icon: '🧠', name: 'Entraînement Cérébral', desc: 'Compléter une session d’entraînement intelligent de 20 morceaux.' },
  { id: 'secret_marathon_50', cat: 'secrets', icon: '🏃', name: 'Ultra-Marathonien', desc: 'Compléter une partie Format de 50 morceaux d’affilée.' },
  { id: 'secret_skip_all', cat: 'secrets', icon: '↷', name: 'Stratège Téméraire', desc: 'Passer volontairement 5 fois de suite avant de deviner.' },
  { id: 'secret_huge_library', cat: 'secrets', icon: '📦', name: 'Collectionneur Insatiable', desc: 'Avoir plus de 30 morceaux dans votre bibliothèque Songless.' },
  { id: 'secret_completionist', cat: 'secrets', icon: '💎', name: 'Maître Absolu de Songless', desc: 'Débloquer au moins 50 trophées dans votre galerie.' }
];

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { SONGLESS_TROPHIES };
}
