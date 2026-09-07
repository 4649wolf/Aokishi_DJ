(() => {
  'use strict';

  const knob = document.querySelector('[data-echo-knob]');
  const indicator = knob?.querySelector('span');
  const transport = window.DJTransport;

  if (!knob || !indicator || !transport) return;

  const MIN_VALUE = 0;
  const MAX_VALUE = 1;
  const MIN_ANGLE = -135;
  const ROTATION_SPAN = 270;
  const SNAP_TO_OFF = 0.02;
  const DRAG_PIXELS_FOR_FULL_RANGE = 150;
  const KEY_STEP = 0.05;
  const FINE_KEY_STEP = 0.01;

  let echoAmount = transport.getEchoAmount?.() ?? 0;
  let activePointerId = null;
  let startY = 0;
  let startAmount = 0;

  function clamp(value, min, max) {
    return Math.min(Math.max(value, min), max);
  }

  function normalize(value) {
    let next = clamp(Number(value) || 0, MIN_VALUE, MAX_VALUE);
    if (next <= SNAP_TO_OFF) next = 0;
    return Math.round(next * 100) / 100;
  }

  function describe(value) {
    const percent = Math.round(value * 100);
    return percent === 0 ? 'ECHO OFF' : `ECHO ${percent}%`;
  }

  function restoreStatusSoon() {
    window.clearTimeout(knob._statusTimer);
    knob._statusTimer = window.setTimeout(() => {
      if (transport.isScratching?.()) return;
      transport.setStatus?.(transport.isPlaying?.() ? 'PLAYING' : 'READY');
    }, 700);
  }

  function render(value, announce = false) {
    echoAmount = normalize(value);
    const angle = MIN_ANGLE + echoAmount * ROTATION_SPAN;

    knob.style.setProperty('--echo-angle', `${angle.toFixed(1)}deg`);
    knob.classList.toggle('is-off', echoAmount === 0);
    knob.classList.toggle('is-echoing', echoAmount > 0);
    knob.setAttribute('aria-valuenow', String(Math.round(echoAmount * 100)));
    knob.setAttribute('aria-valuetext', describe(echoAmount));

    transport.setEchoAmount?.(echoAmount);

    if (announce) {
      transport.setStatus?.(describe(echoAmount));
      restoreStatusSoon();
    }
  }

  function beginDrag(event) {
    if (event.pointerType === 'mouse' && event.button !== 0) return;
    event.preventDefault();
    activePointerId = event.pointerId;
    startY = event.clientY;
    startAmount = echoAmount;
    knob.classList.add('is-dragging');
    knob.setPointerCapture?.(event.pointerId);
    transport.ensureAudioReady?.();
  }

  function moveDrag(event) {
    if (event.pointerId !== activePointerId) return;
    event.preventDefault();

    // Up = more echo, down = less echo.
    const delta = (startY - event.clientY) / DRAG_PIXELS_FOR_FULL_RANGE;
    render(startAmount + delta, true);
  }

  function endDrag(event) {
    if (activePointerId === null) return;
    if (event?.pointerId !== undefined && event.pointerId !== activePointerId) return;

    try {
      if (knob.hasPointerCapture?.(activePointerId)) {
        knob.releasePointerCapture(activePointerId);
      }
    } catch (_) {}

    activePointerId = null;
    knob.classList.remove('is-dragging');
  }

  function resetEcho() {
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
    resetEcho();
  });

  knob.addEventListener('keydown', (event) => {
    const step = event.shiftKey ? FINE_KEY_STEP : KEY_STEP;

    if (event.key === 'ArrowUp' || event.key === 'ArrowRight') {
      event.preventDefault();
      transport.ensureAudioReady?.();
      render(echoAmount + step, true);
    } else if (event.key === 'ArrowDown' || event.key === 'ArrowLeft') {
      event.preventDefault();
      transport.ensureAudioReady?.();
      render(echoAmount - step, true);
    } else if (event.key === 'PageUp') {
      event.preventDefault();
      transport.ensureAudioReady?.();
      render(echoAmount + 0.2, true);
    } else if (event.key === 'PageDown') {
      event.preventDefault();
      transport.ensureAudioReady?.();
      render(echoAmount - 0.2, true);
    } else if (event.key === 'Home' || event.key === '0') {
      event.preventDefault();
      resetEcho();
    }
  });

  render(echoAmount, false);
})();
