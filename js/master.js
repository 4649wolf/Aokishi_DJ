(() => {
  'use strict';

  const knob = document.querySelector('[data-master-knob]');
  const transport = window.DJTransport;
  if (!knob || !transport) return;

  const MIN = 0;
  const MAX = 3;
  const ROTATION_MIN = -135;
  const ROTATION_MAX = 135;
  const DRAG_PIXELS_FOR_FULL_RANGE = 180;
  const KEY_STEP = 0.05;
  const FINE_KEY_STEP = 0.01;

  let volume = Math.min(Math.max(Number(transport.getMasterVolume?.() ?? 1), MIN), MAX);
  let activePointerId = null;
  let startY = 0;
  let startVolume = volume;
  let statusTimer = 0;

  function clamp(value) {
    return Math.min(Math.max(Number(value) || 0, MIN), MAX);
  }

  function percent(value = volume) {
    return Math.round(clamp(value) * 100);
  }

  function describe(value = volume) {
    return `MASTER ${percent(value)}%`;
  }

  function restoreStatusSoon() {
    window.clearTimeout(statusTimer);
    statusTimer = window.setTimeout(() => {
      if (transport.isScratching?.()) return;
      transport.setStatus?.(transport.isPlaying?.() ? 'PLAYING' : 'READY');
    }, 700);
  }

  function render(nextVolume, announce = false) {
    volume = Math.round(clamp(nextVolume) * 100) / 100;
    // Keep unity gain (100%) at the physical center of the knob even though
    // the boost range extends to 300%. 0-100% uses the left half; 100-300%
    // uses the right half so the normal reference position stays intuitive.
    const normalized = volume <= 1
      ? (volume / 1) * 0.5
      : 0.5 + ((volume - 1) / (MAX - 1)) * 0.5;
    const angle = ROTATION_MIN + normalized * (ROTATION_MAX - ROTATION_MIN);

    knob.style.setProperty('--master-angle', `${angle.toFixed(1)}deg`);
    knob.style.setProperty('--master-intensity', String(Math.max(0.12, normalized)));
    knob.classList.toggle('is-muted', volume === 0);
    knob.setAttribute('aria-valuenow', String(percent()));
    knob.setAttribute('aria-valuetext', describe());
    knob.dataset.masterValue = volume.toFixed(2);

    transport.setMasterVolume?.(volume);

    if (announce) {
      transport.setStatus?.(describe());
      restoreStatusSoon();
    }
  }

  function beginDrag(event) {
    if (event.pointerType === 'mouse' && event.button !== 0) return;
    event.preventDefault();
    activePointerId = event.pointerId;
    startY = event.clientY;
    startVolume = volume;
    knob.classList.add('is-dragging');
    knob.setPointerCapture?.(event.pointerId);
    transport.ensureAudioReady?.();
  }

  function moveDrag(event) {
    if (event.pointerId !== activePointerId) return;
    event.preventDefault();
    // One full drag travel spans the complete 0-300% range. This keeps 300%
    // reachable on a phone without requiring an excessively long swipe.
    const delta = ((startY - event.clientY) / DRAG_PIXELS_FOR_FULL_RANGE) * (MAX - MIN);
    render(startVolume + delta, true);
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
    render(1, true);
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
    const step = event.shiftKey ? FINE_KEY_STEP : KEY_STEP;
    if (event.key === 'ArrowUp' || event.key === 'ArrowRight') {
      event.preventDefault();
      transport.ensureAudioReady?.();
      render(volume + step, true);
    } else if (event.key === 'ArrowDown' || event.key === 'ArrowLeft') {
      event.preventDefault();
      transport.ensureAudioReady?.();
      render(volume - step, true);
    } else if (event.key === 'PageUp') {
      event.preventDefault();
      transport.ensureAudioReady?.();
      render(volume + 0.10, true);
    } else if (event.key === 'PageDown') {
      event.preventDefault();
      transport.ensureAudioReady?.();
      render(volume - 0.10, true);
    } else if (event.key === 'Home' || event.key === '0') {
      event.preventDefault();
      transport.ensureAudioReady?.();
      render(0, true);
    } else if (event.key === 'End') {
      event.preventDefault();
      transport.ensureAudioReady?.();
      render(MAX, true);
    }
  });

  render(volume, false);
})();
