'use strict';

const GRAVITY_PENALTY = {
  bloquant: 40,
  genant: 14,
  cosmetique: 5,
};

function assess(options = {}) {
  const issues = Array.isArray(options.issues) ? options.issues : [];
  const deep = options.deep === true;
  const duplicateRisk = options.duplicateRisk === true;
  const checks = {
    identity: true,
    yearAndGenre: true,
    cover: options.coverKnown === true,
    durationAndIntegrity: true,
    duplicateRisk: true,
    audioSignal: deep,
    encodingQuality: false,
  };

  const reasons = issues.slice(0, 8).map(issue => ({
    type: String(issue.type || 'inconnu'),
    gravity: String(issue.gravite || 'cosmetique'),
    detail: String(issue.detail || '').slice(0, 220),
  }));
  if (duplicateRisk && !reasons.some(reason => reason.type === 'doublon')) {
    reasons.push({
      type: 'doublon',
      gravity: 'genant',
      detail: 'Ce morceau appartient à un groupe de doublons probables à comparer.',
    });
  }

  const blocking = reasons.some(reason => reason.gravity === 'bloquant');
  const status = blocking ? 'problematic' : reasons.length ? 'review' : 'ready';
  const score = Math.max(0, 100 - reasons.reduce((total, reason) =>
    total + (GRAVITY_PENALTY[reason.gravity] || GRAVITY_PENALTY.cosmetique), 0));
  const assessed = Object.values(checks).filter(Boolean).length;
  const total = Object.keys(checks).length;

  return {
    status,
    score,
    coverage: Math.round((assessed / total) * 100),
    assessedChecks: Object.keys(checks).filter(key => checks[key]),
    unknownChecks: Object.keys(checks).filter(key => !checks[key]),
    reasons,
  };
}

module.exports = { assess };
