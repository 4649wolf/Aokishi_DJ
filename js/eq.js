(() => {
  'use strict';

  const knobs = [...document.querySelectorAll('[data-eq-band]')];
  const transport = window.DJTransport;
  if (!knobs.length || !transport) return;

  const MIN_DB = -24;
  const MAX_DB = 6;
  const ROTATION_RANGE = 135;
  const DRAG_PIXELS_FOR_FULL_RANGE = 150;
  const KEY_STEP_DB = 1;
  const FINE_KEY_STEP_DB = 0.5;
  const SNAP_DB = 0.35;
  const statusTimers = new WeakMap();

  function clamp(value, min, max) {
    return Math.min(Math.max(value, min), max);
  }

  function normalizeDb(value) {
    let next = clamp(Number(value) || 0, MIN_DB, MAX_DB);
    if (Math.abs(next) <= SNAP_DB) next = 0;
    return Math.round(next * 10) / 10;
  }

  function dbToNormalized(db) {
    if (db < 0) return db / Math.abs(MIN_DB);
    if (db > 0) return db / MAX_DB;
    return 0;
  }

  function normalizedToDb(value) {
    const normalized = clamp(value, -1, 1);
    return normalized < 0
      ? normalized * Math.abs(MIN_DB)
      : normalized * MAX_DB;
  }

  function labelForBand(band) {
    if (band === 'low') return 'LOW';
    if (band === 'mid') return 'MID';
    return 'HIGH';
  }

  function describe(band, db) {
    const label = labelForBand(band);
    if (db === 0) return `${label} 0 dB`;
    return `${label} ${db > 0 ? '+' : ''}${db.toFixed(1)} dB`;
  }

  function restoreStatusSoon(knob) {
    const oldTimer = statusTimers.get(knob);
    if (oldTimer) window.clearTimeout(oldTimer);
    const timer = window.setTimeout(() => {
      if (transport.isScratching?.()) return;
      transport.setStatus?.(transport.isPlaying?.() ? 'PLAYING' : 'READY');
    }, 700);
    statusTimers.set(knob, timer);
  }

  function createController(knob) {
    const band = knob.dataset.eqBand;
    if (!['low', 'mid', 'high'].includes(band)) return;

    let db = normalizeDb(transport.getEqBand?.(band) ?? 0);
    let activePointerId = null;
    let startY = 0;
    let startNormalized = dbToNormalized(db);

    function render(nextDb, announce = false) {
      db = normalizeDb(nextDb);
      const normalized = dbToNormalized(db);
      const angle = normalized * ROTATION_RANGE;
      const percent = Math.round(Math.abs(normalized) * 100);

      knob.style.setProperty('--eq-angle', `${angle.toFixed(1)}deg`);
      knob.style.setProperty('--eq-intensity', String(Math.max(0.15, Math.abs(normalized))));
      knob.classList.toggle('is-center', db === 0);
      knob.classList.toggle('is-cut', db < 0);
      knob.classList.toggle('is-boost', db > 0);
      knob.setAttribute('aria-valuenow', db.toFixed(1));
      knob.setAttribute('aria-valuetext', describe(band, db));
      knob.dataset.eqValue = db.toFixed(1);

      transport.setEqBand?.(band, db);

      if (announce) {
        const suffix = db === 0 ? '0 dB' : `${db > 0 ? '+' : ''}${db.toFixed(1)} dB`;
        transport.setStatus?.(`${labelForBand(band)} ${suffix}`);
        restoreStatusSoon(knob);
      }

      return percent;
    }

    function beginDrag(event) {
      if (event.pointerType === 'mouse' && event.button !== 0) return;
      event.preventDefault();
      activePointerId = event.pointerId;
      startY = event.clientY;
      startNormalized = dbToNormalized(db);
      knob.classList.add('is-dragging');
      knob.setPointerCapture?.(event.pointerId);
      transport.ensureAudioReady?.();
    }

    function moveDrag(event) {
      if (event.pointerId !== activePointerId) return;
      event.preventDefault();
      const deltaNormalized = (startY - event.clientY) / DRAG_PIXELS_FOR_FULL_RANGE;
      render(normalizedToDb(startNormalized + deltaNormalized), true);
    }

    function endDrag(event) {
      if (activePointerId === null) return;
      if (event?.pointerId !== undefined && event.pointerId !== activePointerId) return;
      try {
        if (knob.hasPointerCapture?.(activePointerId)) knob.releasePointerCapture(activePointerId);
      } catch (_) {}
      activePointerId = null;
      knob.classList.remove('is-dragging');
    }

    function reset() {
      transport.ensureAudioReady?.();
      render(0, true);
    }

    knob.addEventListener('pointerdown', beginDrag);
    knob.addEventListener('pointermove', moveDrag);
    knob.addEventListener('pointerup', endDrag);
    knob.addEventListener('pointercancel', endDrag);
    knob.addEventListener('lostpointercapture', () => {
      activePointerId = null;
      knob.classList.remove('is-dragging');
    });

    knob.addEventListener('dblclick', (event) => {
      event.preventDefault();
      reset();
    });

    knob.addEventListener('keydown', (event) => {
      const step = event.shiftKey ? FINE_KEY_STEP_DB : KEY_STEP_DB;
      if (event.key === 'ArrowUp' || event.key === 'ArrowRight') {
        event.preventDefault();
        transport.ensureAudioReady?.();
        render(db + step, true);
      } else if (event.key === 'ArrowDown' || event.key === 'ArrowLeft') {
        event.preventDefault();
        transport.ensureAudioReady?.();
        render(db - step, true);
      } else if (event.key === 'PageUp') {
        event.preventDefault();
        transport.ensureAudioReady?.();
        render(db + 3, true);
      } else if (event.key === 'PageDown') {
        event.preventDefault();
        transport.ensureAudioReady?.();
        render(db - 6, true);
      } else if (event.key === 'Home' || event.key === '0') {
        event.preventDefault();
        reset();
      }
    });

    render(db, false);
  }

  knobs.forEach(createController);
})();
