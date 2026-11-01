'use strict';

const JOB_TTL_MS = 10 * 60 * 1000;
const MAX_JOBS = 24;
const ID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const jobs = new Map();

function validId(value) {
  return ID_PATTERN.test(String(value || ''));
}

function cleanup(now = Date.now()) {
  for (const [id, job] of jobs) {
    if (now - job.updatedAt > JOB_TTL_MS) jobs.delete(id);
  }
  while (jobs.size > MAX_JOBS) {
    const oldest = jobs.keys().next().value;
    if (!oldest) break;
    jobs.delete(oldest);
  }
}

function update(id, values) {
  if (!validId(id)) return false;
  cleanup();
  const prior = jobs.get(id) || { id, phase: 'preparing' };
  const next = {
    ...prior,
    ...values,
    id,
    updatedAt: Date.now(),
  };
  if (Number.isFinite(next.current) && Number.isFinite(next.total) && next.total > 0) {
    next.current = Math.max(0, Math.min(next.current, next.total));
    next.percent = Math.round((next.current / next.total) * 100);
  }
  jobs.set(id, next);
  return true;
}

function get(id) {
  if (!validId(id)) return null;
  cleanup();
  const job = jobs.get(id);
  if (!job) return null;
  const { id: ignored, updatedAt, ...publicState } = job;
  return { ...publicState };
}

module.exports = { get, update, validId };
