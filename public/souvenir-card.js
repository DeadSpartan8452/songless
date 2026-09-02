'use strict';

(function (root) {
  function clean(value, max = 80) {
    return String(value || '').replace(/[\u0000-\u001f\u007f]/g, '').trim().slice(0, max);
  }

  function modeLabel(mode) {
    return ({
      classic: 'Classique', buzzer: 'Buzzer', royale: 'Battle Royale', duel: 'Duel',
      confidence: 'Confiance', cooperation: 'Coopération', intruder: 'Intrus',
      auction: 'Enchères', joker: 'Joker', missions: 'Missions secrètes',
    })[mode] || 'Blind test';
  }

  function buildModel(state, options = {}) {
    const source = state && typeof state === 'object' ? state : {};
    const showNames = options.showNames === true;
    const sorted = [...(Array.isArray(source.players) ? source.players : [])]
      .sort((a, b) => {
        if (source.winnerProfileId && a.profileId === source.winnerProfileId) return -1;
        if (source.winnerProfileId && b.profileId === source.winnerProfileId) return 1;
        return (Number(b.score) || 0) - (Number(a.score) || 0);
      }).slice(0, 3);
    const players = sorted.map((player, index) => {
      const portrait = Array.isArray(player.portraitTitles) && player.portraitTitles[0];
      return {
        rank: index + 1,
        emoji: clean(player.emoji, 8) || '🎧',
        name: showNames ? clean(player.nom, 24) || `Joueur ${index + 1}` : `Joueur ${index + 1}`,
        score: Math.max(0, Math.round(Number(player.score) || 0)),
        correct: Math.max(0, Math.round(Number(player.session && player.session.correct) || 0)),
        rounds: Math.max(0, Math.round(Number(player.session && player.session.rounds) || 0)),
        title: portrait ? clean(portrait.label, 60) : '',
        evidence: portrait ? clean(portrait.evidence, 90) : '',
      };
    });
    const model = {
      brand: 'SONGLESS',
      edition: 'BILAN DE SOIRÉE',
      mode: modeLabel(clean(source.mode, 30)),
      rounds: Math.max(0, Math.round(Number(source.round) || 0)),
      playerCount: Array.isArray(source.players) ? source.players.length : 0,
      players,
      privacy: showNames ? 'Pseudos affichés avec votre accord.' : 'Carte anonyme : aucun pseudo, code ou identifiant.',
    };
    if (source.mode === 'cooperation' && source.cooperation) {
      model.collective = {
        won: source.cooperation.result === 'won',
        points: Math.max(0, Math.round(Number(source.cooperation.sharedPoints) || 0)),
        target: Math.max(0, Math.round(Number(source.cooperation.targetPoints) || 0)),
      };
    }
    return model;
  }

  function roundedRect(ctx, x, y, width, height, radius) {
    const r = Math.min(radius, width / 2, height / 2);
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + width, y, x + width, y + height, r);
    ctx.arcTo(x + width, y + height, x, y + height, r);
    ctx.arcTo(x, y + height, x, y, r);
    ctx.arcTo(x, y, x + width, y, r);
    ctx.closePath();
  }

  function fitText(ctx, text, maxWidth, startSize, minSize = 24) {
    let size = startSize;
    while (size > minSize) {
      ctx.font = `800 ${size}px "DM Sans", sans-serif`;
      if (ctx.measureText(text).width <= maxWidth) break;
      size -= 2;
    }
    return size;
  }

  function draw(canvas, model) {
    if (!canvas || typeof canvas.getContext !== 'function') return false;
    canvas.width = 1080;
    canvas.height = 1350;
    const ctx = canvas.getContext('2d');
    const bg = ctx.createLinearGradient(0, 0, 1080, 1350);
    bg.addColorStop(0, '#171126');
    bg.addColorStop(.48, '#28134a');
    bg.addColorStop(1, '#0d0b14');
    ctx.fillStyle = bg;
    ctx.fillRect(0, 0, 1080, 1350);

    ctx.globalAlpha = .18;
    for (let y = 0; y < 1350; y += 28) {
      ctx.fillStyle = y % 56 ? '#ff4fa3' : '#8b5cf6';
      ctx.fillRect(0, y, 1080, 1);
    }
    ctx.globalAlpha = 1;
    ctx.fillStyle = '#ffdc5e';
    ctx.fillRect(72, 72, 9, 148);
    ctx.font = '900 92px "DM Sans", sans-serif';
    ctx.fillText(model.brand, 112, 145);
    ctx.fillStyle = '#f8d4ef';
    ctx.font = '800 28px "DM Sans", sans-serif';
    ctx.letterSpacing = '8px';
    ctx.fillText(model.edition, 116, 195);
    ctx.letterSpacing = '0px';

    roundedRect(ctx, 72, 260, 936, 112, 28);
    ctx.fillStyle = '#ffffff0e'; ctx.fill();
    ctx.strokeStyle = '#ffffff25'; ctx.lineWidth = 2; ctx.stroke();
    ctx.fillStyle = '#ffffff';
    ctx.font = '800 36px "DM Sans", sans-serif';
    ctx.fillText(model.mode, 110, 330);
    ctx.textAlign = 'right';
    ctx.fillStyle = '#d8b4fe';
    ctx.fillText(`${model.rounds} manches · ${model.playerCount} joueurs`, 970, 330);
    ctx.textAlign = 'left';

    const medals = ['01', '02', '03'];
    const colors = ['#ffdc5e', '#cbd5e1', '#f6a46c'];
    model.players.forEach((player, index) => {
      const y = 420 + index * 238;
      roundedRect(ctx, 72, y, 936, 204, 30);
      ctx.fillStyle = index === 0 ? '#ffffff18' : '#ffffff0b'; ctx.fill();
      ctx.strokeStyle = `${colors[index]}88`; ctx.lineWidth = index === 0 ? 4 : 2; ctx.stroke();
      ctx.fillStyle = colors[index];
      ctx.font = '900 62px Georgia, serif';
      ctx.fillText(medals[index], 105, y + 78);
      ctx.font = '48px "Segoe UI Emoji", sans-serif';
      ctx.fillText(player.emoji, 223, y + 76);
      ctx.fillStyle = '#fff';
      const nameSize = fitText(ctx, player.name, 430, 44, 28);
      ctx.font = `800 ${nameSize}px "DM Sans", sans-serif`;
      ctx.fillText(player.name, 305, y + 68);
      ctx.textAlign = 'right';
      ctx.fillStyle = colors[index];
      ctx.font = '900 42px "DM Sans", sans-serif';
      ctx.fillText(`${player.score} PT`, 965, y + 68);
      ctx.textAlign = 'left';
      ctx.fillStyle = '#e9d5ff';
      ctx.font = '800 30px "DM Sans", sans-serif';
      ctx.fillText(player.title || 'Soirée validée', 305, y + 118);
      ctx.fillStyle = '#b6a9c8';
      ctx.font = '500 24px "DM Sans", sans-serif';
      ctx.fillText(player.evidence || `${player.correct}/${player.rounds} réponses trouvées`, 305, y + 158);
    });

    if (model.collective) {
      roundedRect(ctx, 72, 1140, 936, 74, 22);
      ctx.fillStyle = model.collective.won ? '#34d39922' : '#fb718522'; ctx.fill();
      ctx.fillStyle = model.collective.won ? '#6ee7b7' : '#fda4af';
      ctx.font = '800 27px "DM Sans", sans-serif';
      ctx.fillText(model.collective.won ? 'OBJECTIF COLLECTIF ATTEINT' : 'DÉFI COLLECTIF MANQUÉ', 108, 1187);
      ctx.textAlign = 'right';
      ctx.fillText(`${model.collective.points}/${model.collective.target} PT`, 970, 1187);
      ctx.textAlign = 'left';
    }
    ctx.fillStyle = '#9f93b3';
    ctx.font = '600 22px "DM Sans", sans-serif';
    ctx.fillText(model.privacy, 72, 1282);
    ctx.textAlign = 'right';
    ctx.fillStyle = '#ffdc5e';
    ctx.font = '900 24px "DM Sans", sans-serif';
    ctx.fillText('À REJOUER.', 1008, 1282);
    ctx.textAlign = 'left';
    return true;
  }

  function summary(model) {
    const podium = model.players.map(player => (
      `${player.rank}. ${player.name}, ${player.score} points${player.title ? `, ${player.title}` : ''}`
    )).join(' ; ');
    return `${model.edition}. Mode ${model.mode}, ${model.rounds} manches, ${model.playerCount} joueurs. ${podium}. ${model.privacy}`;
  }

  function text(model) {
    const lines = [`🎵 ${model.brand} — ${model.edition}`, `${model.mode} · ${model.rounds} manches · ${model.playerCount} joueurs`, ''];
    model.players.forEach(player => {
      lines.push(`${player.rank}. ${player.emoji} ${player.name} — ${player.score} pts`);
      if (player.title) lines.push(`   « ${player.title} » — ${player.evidence}`);
    });
    lines.push('', model.privacy);
    return lines.join('\n');
  }

  const api = { buildModel, clean, draw, modeLabel, summary, text };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (root) root.songlessSouvenir = api;
})(typeof window !== 'undefined' ? window : null);
