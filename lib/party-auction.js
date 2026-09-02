'use strict';

const BID_OPTIONS = Object.freeze([0.5, 1, 2, 3, 5, 7, 10, 15]);
const BID_SECONDS = 15;

function participants(party) {
  return (party.players || []).filter(player => player.connected && !player.isGhost);
}

function validBid(value) {
  const bid = Number(value);
  return BID_OPTIONS.includes(bid) ? bid : null;
}

function pointsFor(basePoints, seconds) {
  const duration = validBid(seconds);
  if (!duration) return 0;
  const multiplier = 1 + (15 - duration) / 15;
  return Math.max(1, Math.round((Number(basePoints) || 1000) * multiplier));
}

function startRound(party, pendingPlayback, now = Date.now()) {
  party.auction = {
    phase: 'bidding',
    deadlineAt: now + BID_SECONDS * 1000,
    bids: [],
    order: [],
    activeIndex: -1,
    activeProfileId: null,
    pendingPlayback: pendingPlayback ? { ...pendingPlayback } : null,
    tie: false,
    tieBreak: 'En cas d’égalité, la première enchère reçue gagne ; le profil départage ensuite.',
    result: null,
  };
  party.playback = null;
  party.roundStartedAt = now;
}

function sortedBids(party) {
  return [...((party.auction && party.auction.bids) || [])].sort((left, right) => (
    left.seconds - right.seconds
    || left.submittedAt - right.submittedAt
    || left.profileId.localeCompare(right.profileId)
  ));
}

function activate(party, index, now = Date.now()) {
  const auction = party.auction;
  const bid = auction && auction.order[index];
  if (!bid) return false;
  auction.phase = 'answering';
  auction.activeIndex = index;
  auction.activeProfileId = bid.profileId;
  const playback = auction.pendingPlayback || {};
  party.playback = {
    ...playback,
    startedAt: now + 800,
    duration: bid.seconds,
    step: 0,
    loopDelay: Math.min(4.2, Math.max(2.2, 2 + bid.seconds * 0.15)),
    pausedAt: null,
  };
  party.roundStartedAt = party.playback.startedAt;
  return true;
}

function finalize(party, now = Date.now()) {
  const auction = party.auction;
  if (!auction || auction.phase !== 'bidding') return auction;
  auction.order = sortedBids(party);
  auction.tie = auction.order.length > 1
    && auction.order[0].seconds === auction.order[1].seconds;
  auction.deadlineAt = null;
  if (!auction.order.length) {
    auction.phase = 'resolved';
    auction.result = 'no_bid';
    party.roundDecision = 'all_finished';
    for (const player of participants(party)) player.finished = true;
    return auction;
  }
  activate(party, 0, now);
  return auction;
}

function refresh(party, now = Date.now()) {
  const auction = party.auction;
  if (auction && auction.phase === 'bidding' && now >= Number(auction.deadlineAt)) {
    finalize(party, now);
  }
  return auction;
}

function submitBid(party, player, value, now = Date.now()) {
  refresh(party, now);
  const auction = party.auction;
  if (!auction || auction.phase !== 'bidding') {
    throw new Error('Les enchères sont closes.');
  }
  const seconds = validBid(value);
  if (!seconds) throw new Error('Durée d’enchère impossible.');
  if (auction.bids.some(bid => bid.profileId === player.profileId)) {
    throw new Error('Ton enchère est déjà verrouillée.');
  }
  auction.bids.push({ profileId: player.profileId, seconds, submittedAt: now });
  const expected = participants(party).length;
  if (expected > 0 && auction.bids.length >= expected) finalize(party, now);
  return auction;
}

function canAnswer(party, player) {
  refresh(party);
  return Boolean(party.auction && party.auction.phase === 'answering'
    && party.auction.activeProfileId === player.profileId);
}

function resolveWrong(party, now = Date.now()) {
  const auction = party.auction;
  if (!auction || auction.phase !== 'answering') return;
  if (activate(party, auction.activeIndex + 1, now)) return;
  auction.phase = 'resolved';
  auction.activeProfileId = null;
  auction.result = 'missed';
  party.playback = null;
  party.roundDecision = 'all_finished';
}

function resolveCorrect(party, player) {
  const auction = party.auction;
  if (!auction || auction.phase !== 'answering') return 0;
  const bid = auction.order[auction.activeIndex];
  const points = pointsFor(party.settings && party.settings.points, bid && bid.seconds);
  auction.phase = 'resolved';
  auction.activeProfileId = null;
  auction.result = 'solved';
  auction.solvedByProfileId = player.profileId;
  auction.points = points;
  party.roundDecision = 'solved';
  return points;
}

function publicState(party, viewer) {
  refresh(party);
  const auction = party.auction;
  if (!auction) return null;
  const revealed = auction.phase !== 'bidding';
  const bids = participants(party).map(player => {
    const bid = auction.bids.find(item => item.profileId === player.profileId);
    return {
      profileId: player.profileId,
      submitted: Boolean(bid),
      seconds: bid && (revealed || (viewer && viewer.profileId === player.profileId))
        ? bid.seconds : null,
    };
  });
  const activeBid = auction.order[auction.activeIndex] || null;
  return {
    phase: auction.phase,
    deadlineAt: auction.deadlineAt,
    options: BID_OPTIONS.map(seconds => ({
      seconds,
      points: pointsFor(party.settings && party.settings.points, seconds),
    })),
    bids,
    activeProfileId: auction.activeProfileId,
    activeSeconds: activeBid ? activeBid.seconds : null,
    tie: auction.tie,
    tieBreak: auction.tieBreak,
    result: auction.result,
    solvedByProfileId: auction.solvedByProfileId || null,
    points: Number(auction.points) || 0,
  };
}

module.exports = {
  BID_OPTIONS, BID_SECONDS, canAnswer, finalize, pointsFor, publicState,
  refresh, resolveCorrect, resolveWrong, startRound, submitBid, validBid,
};
