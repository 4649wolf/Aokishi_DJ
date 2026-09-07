(() => {
  'use strict';

  const knob = document.querySelector('[data-filter-knob]');
  const indicator = knob?.querySelector('span');
  const transport = window.DJTransport;

  if (!knob || !indicator || !transport) return;

  const MIN_VALUE = -1;
  const MAX_VALUE = 1;
  const ROTATION_RANGE = 135;
  const SNAP_TO_CENTER = 0.025;
  const DRAG_PIXELS_FOR_FULL_RANGE = 150;
  const KEY_STEP = 0.05;
  const FINE_KEY_STEP = 0.01;

  let filterAmount = transport.getFilterAmount?.() ?? 0;
  let activePointerId = null;
  let startY = 0;
  let startAmount = 0;

  function clamp(value, min, max) {
    return Math.min(Math.max(value, min), max);
  }

  function normalize(value) {
    let next = clamp(Number(value) || 0, MIN_VALUE, MAX_VALUE);
    if (Math.abs(next) <= SNAP_TO_CENTER) next = 0;
    return Math.round(next * 100) / 100;
  }

  function describe(value) {
    const percent = Math.round(Math.abs(value) * 100);
    if (value < 0) return `ローパス ${percent}%`;
    if (value > 0) return `ハイパス ${percent}%`;
    return '原音';
  }

  function statusLabel(value) {
    const percent = Math.round(Math.abs(value) * 100);
    if (value < 0) return `FILTER LP ${percent}%`;
    if (value > 0) return `FILTER HP ${percent}%`;
    return 'FILTER 0';
  }

  function restoreStatusSoon() {
    window.clearTimeout(knob._statusTimer);
    knob._statusTimer = window.setTimeout(() => {
      if (transport.isScratching?.()) return;
      transport.setStatus?.(transport.isPlaying?.() ? 'PLAYING' : 'READY');
    }, 700);
  }

  function render(value, announce = false) {
    filterAmount = normalize(value);
    const angle = filterAmount * ROTATION_RANGE;

    knob.style.setProperty('--filter-angle', `${angle.toFixed(1)}deg`);
    knob.classList.toggle('is-center', filterAmount === 0);
    knob.classList.toggle('is-lowpass', filterAmount < 0);
    knob.classList.toggle('is-highpass', filterAmount > 0);
    knob.setAttribute('aria-valuenow', String(Math.round(filterAmount * 100)));
    knob.setAttribute('aria-valuetext', describe(filterAmount));

    transport.setFilterAmount?.(filterAmount);

    if (announce) {
      transport.setStatus?.(statusLabel(filterAmount));
      restoreStatusSoon();
    }
  }

  function beginDrag(event) {
    if (event.pointerType === 'mouse' && event.button !== 0) return;
    event.preventDefault();
    activePointerId = event.pointerId;
    startY = event.clientY;
    startAmount = filterAmount;
    knob.classList.add('is-dragging');
    knob.setPointerCapture?.(event.pointerId);
    transport.ensureAudioReady?.();
  }

  function moveDrag(event) {
    if (event.pointerId !== activePointerId) return;
    event.preventDefault();

    // Up = clockwise / high-pass, down = counter-clockwise / low-pass.
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

  function resetFilter() {
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
    resetFilter();
  });

  knob.addEventListener('keydown', (event) => {
    const step = event.shiftKey ? FINE_KEY_STEP : KEY_STEP;

    if (event.key === 'ArrowUp' || event.key === 'ArrowRight') {
      event.preventDefault();
      transport.ensureAudioReady?.();
      render(filterAmount + step, true);
    } else if (event.key === 'ArrowDown' || event.key === 'ArrowLeft') {
      event.preventDefault();
      transport.ensureAudioReady?.();
      render(filterAmount - step, true);
    } else if (event.key === 'PageUp') {
      event.preventDefault();
      transport.ensureAudioReady?.();
      render(filterAmount + 0.2, true);
    } else if (event.key === 'PageDown') {
      event.preventDefault();
      transport.ensureAudioReady?.();
      render(filterAmount - 0.2, true);
    } else if (event.key === 'Home' || event.key === '0') {
      event.preventDefault();
      resetFilter();
    }
  });

  render(filterAmount, false);
})();
