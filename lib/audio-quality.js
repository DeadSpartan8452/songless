'use strict';

function finite(value) {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? number : null;
}

function inspect(format = {}) {
  const bitrate = finite(format.bitrate);
  const sampleRate = finite(format.sampleRate);
  const bitsPerSample = finite(format.bitsPerSample);
  const channels = finite(format.numberOfChannels);
  const codec = String(format.codec || '').trim().slice(0, 80) || null;
  const container = String(format.container || '').trim().slice(0, 40) || null;
  const lossless = format.lossless === true;
  // Le nom « MP3 » ou « AAC » identifie un format, pas sa qualité. Au moins
  // une mesure quantitative est nécessaire avant de déclarer le contrôle fait.
  const known = Boolean(bitrate || sampleRate || bitsPerSample);
  const issues = [];

  if (!lossless && bitrate && bitrate < 96_000) {
    issues.push({
      type: 'encodage-faible',
      gravite: 'genant',
      detail: `${Math.round(bitrate / 1000)} kb/s : compression très forte, des artefacts peuvent gêner l’écoute.`,
      action: 'Remplace ce fichier par une source d’au moins 128 kb/s, sans convertir une copie déjà compressée.',
    });
  } else if (!lossless && bitrate && bitrate < 128_000) {
    issues.push({
      type: 'encodage-moyen',
      gravite: 'cosmetique',
      detail: `${Math.round(bitrate / 1000)} kb/s : qualité correcte mais inférieure au repère de 128 kb/s.`,
      action: 'À remplacer seulement si une meilleure source originale est disponible.',
    });
  }

  if (sampleRate && sampleRate < 32_000) {
    issues.push({
      type: 'echantillonnage-faible',
      gravite: 'genant',
      detail: `${Math.round(sampleRate / 1000)} kHz : bande passante limitée pour un morceau musical.`,
      action: 'Retrouve une source originale en 44,1 ou 48 kHz ; un réencodage ne recrée pas les fréquences perdues.',
    });
  }

  if (lossless && bitsPerSample && bitsPerSample < 16) {
    issues.push({
      type: 'profondeur-faible',
      gravite: 'cosmetique',
      detail: `${bitsPerSample} bits : profondeur inhabituelle pour une source musicale sans perte.`,
      action: 'Vérifie la source ; ne convertis pas artificiellement le fichier en 16 bits.',
    });
  }

  return {
    known,
    codec,
    container,
    lossless,
    bitrate: bitrate ? Math.round(bitrate) : null,
    sampleRate: sampleRate ? Math.round(sampleRate) : null,
    bitsPerSample: bitsPerSample ? Math.round(bitsPerSample) : null,
    channels: channels ? Math.round(channels) : null,
    issues,
  };
}

module.exports = { inspect };
