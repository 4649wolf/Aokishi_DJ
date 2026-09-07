(() => {
  'use strict';

  const meter = document.querySelector('.vu-meter');
  const bars = [...document.querySelectorAll('.vu-meter__bars i')];
  const miniBars = [...document.querySelectorAll('.mini-meter i')];
  const transport = window.DJTransport;
  if (!meter || bars.length === 0 || !transport) return;

  // dBFS thresholds chosen for an 8-segment DJ-style meter. The lower LEDs
  // react to normal program material while the final red LED warns near peak.
  const THRESHOLDS_DB = [-42, -34, -28, -22, -16, -10, -6, -3];
  const FLOOR_DB = -60;
  const DECAY_DB_PER_SECOND = 24;
  const PEAK_HOLD_MS = 420;
  const PEAK_DECAY_DB_PER_SECOND = 18;

  let displayDb = FLOOR_DB;
  let peakDb = FLOOR_DB;
  let peakHoldUntil = 0;
  let lastFrameAt = performance.now();
  let animationFrame = 0;

  function clamp(value, min, max) {
    return Math.min(Math.max(value, min), max);
  }

  function rmsToDb(rms) {
    const safe = Math.max(Number(rms) || 0, 1e-6);
    return clamp(20 * Math.log10(safe), FLOOR_DB, 3);
  }

  function getCombinedRms() {
    const mainRms = Math.max(0, Number(transport.getMeterRms?.()) || 0);
    const scratchRms = Math.max(0, Number(window.DJScratchMeter?.getMeterRms?.()) || 0);

    // The normal deck/PAD bus and scratch preview live in separate AudioContexts.
    // Combining their powers gives a useful approximation of the actual summed
    // acoustic output if both are active at the same instant.
    return Math.sqrt(mainRms * mainRms + scratchRms * scratchRms);
  }

  function updateBars(currentDb, heldPeakDb) {
    bars.forEach((bar, index) => {
      const threshold = THRESHOLDS_DB[index] ?? 0;
      const lit = currentDb >= threshold;
      bar.classList.toggle('is-lit', lit);
      bar.style.setProperty('--vu-strength', String(clamp((currentDb - threshold + 8) / 12, 0.35, 1)));
    });

    const peakIndex = THRESHOLDS_DB.reduce((result, threshold, index) => (
      heldPeakDb >= threshold ? index : result
    ), -1);
    bars.forEach((bar, index) => bar.classList.toggle('is-peak-hold', index === peakIndex && peakIndex >= 0));

    // Mirror the same real signal into the tiny header meter for visual coherence.
    if (miniBars.length) {
      const activeCount = Math.round(clamp((currentDb - FLOOR_DB) / (0 - FLOOR_DB), 0, 1) * miniBars.length);
      miniBars.forEach((bar, index) => bar.classList.toggle('is-lit', index < activeCount));
    }
  }

  function render(now) {
    const deltaSeconds = Math.min(Math.max((now - lastFrameAt) / 1000, 0), 0.1);
    lastFrameAt = now;

    const rawDb = rmsToDb(getCombinedRms());

    // Fast attack, slower falloff. This keeps kick/snare transients visible without
    // turning the display into a nervous flicker.
    if (rawDb >= displayDb) {
      displayDb = rawDb;
    } else {
      displayDb = Math.max(rawDb, displayDb - DECAY_DB_PER_SECOND * deltaSeconds);
    }

    if (rawDb >= peakDb) {
      peakDb = rawDb;
      peakHoldUntil = now + PEAK_HOLD_MS;
    } else if (now > peakHoldUntil) {
      peakDb = Math.max(rawDb, peakDb - PEAK_DECAY_DB_PER_SECOND * deltaSeconds);
    }

    updateBars(displayDb, peakDb);

    const ariaDb = Math.round(displayDb * 10) / 10;
    meter.setAttribute('aria-valuenow', String(ariaDb));
    meter.setAttribute('aria-valuetext', ariaDb <= FLOOR_DB + 0.1 ? 'MASTER 無音' : `MASTER ${ariaDb.toFixed(1)} dBFS`);
    meter.dataset.levelDb = ariaDb.toFixed(1);

    animationFrame = window.requestAnimationFrame(render);
  }

  animationFrame = window.requestAnimationFrame(render);

  window.addEventListener('pagehide', () => {
    window.cancelAnimationFrame(animationFrame);
  }, { once: true });
})();
