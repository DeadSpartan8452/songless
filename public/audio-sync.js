(function (root) {
  'use strict';

  const clamp = (value, minimum, maximum) => Math.min(maximum, Math.max(minimum, value));

  function outputLatencySeconds(context) {
    if (!context) return 0;
    const output = Number(context.outputLatency);
    const base = Number(context.baseLatency);
    const estimate = Number.isFinite(output) && output > 0 ? output : base;
    return Number.isFinite(estimate) ? clamp(estimate, 0, 0.25) : 0;
  }

  function manualTrimSeconds(value) {
    const milliseconds = Number(value);
    return Number.isFinite(milliseconds)
      ? clamp(milliseconds, 0, 250) / 1000 : 0;
  }

  function contentOffsetSeconds(context, trimMilliseconds, speed = 1) {
    const rate = Number.isFinite(Number(speed)) ? clamp(Number(speed), 0.1, 4) : 1;
    return clamp(outputLatencySeconds(context) + manualTrimSeconds(trimMilliseconds), 0, 0.5) * rate;
  }

  function estimatedServerNow(serverAtReceipt, receivedAt, now = Date.now()) {
    const serverTime = Number(serverAtReceipt);
    const localReceipt = Number(receivedAt);
    const localNow = Number(now);
    if (![serverTime, localReceipt, localNow].every(Number.isFinite)) return localNow;
    return serverTime + Math.max(0, localNow - localReceipt);
  }

  function remainingStartDelay(startedAt, serverAtReceipt, receivedAt, now = Date.now()) {
    return Math.max(0, Number(startedAt)
      - estimatedServerNow(serverAtReceipt, receivedAt, now));
  }

  root.SonglessAudioSync = {
    outputLatencySeconds,
    manualTrimSeconds,
    contentOffsetSeconds,
    estimatedServerNow,
    remainingStartDelay,
  };
})(typeof window !== 'undefined' ? window : globalThis);
