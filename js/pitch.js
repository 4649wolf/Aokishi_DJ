(() => {
  'use strict';

  const deck = document.querySelector('.module--deck');
  const fader = deck?.querySelector('[data-pitch-fader]');
  const cap = fader?.querySelector('.fader__cap');
  const valueText = deck?.querySelector('[data-pitch-value]');
  const transport = window.DJTransport;

  if (!deck || !fader || !cap || !transport) return;

  const MIN_PITCH = -8;
  const MAX_PITCH = 8;
  const SNAP_TO_ZERO = 0.35;
  const KEY_STEP = 0.5;
  const FINE_KEY_STEP = 0.1;

  let activePointerId = null;
  let pitchPercent = transport.getPitchPercent?.() ?? 0;

  function clamp(value, min, max) {
    return Math.min(Math.max(value, min), max);
  }

  function normalizePitch(value) {
    let next = clamp(Number(value) || 0, MIN_PITCH, MAX_PITCH);
    if (Math.abs(next) <= SNAP_TO_ZERO) next = 0;
    return Math.round(next * 10) / 10;
  }

  function formatPitch(value) {
    if (value === 0) return '0.0%';
    return `${value > 0 ? '+' : ''}${value.toFixed(1)}%`;
  }

  function render(value, announce = false) {
    pitchPercent = normalizePitch(value);

    // +8 is the top of the slot and -8 is the bottom.
    const normalized = (MAX_PITCH - pitchPercent) / (MAX_PITCH - MIN_PITCH);
    cap.style.top = `calc(${(normalized * 100).toFixed(3)}% - var(--pitch-cap-half))`;

    fader.setAttribute('aria-valuenow', pitchPercent.toFixed(1));
    fader.setAttribute('aria-valuetext', `${formatPitch(pitchPercent)}、再生速度 ${(100 + pitchPercent).toFixed(1)}%`);
    fader.style.setProperty('--pitch-position', normalized.toFixed(4));
    fader.classList.toggle('is-zero', pitchPercent === 0);

    if (valueText) valueText.textContent = formatPitch(pitchPercent);
    transport.setPitchPercent(pitchPercent);

    if (announce) {
      transport.setStatus(`PITCH ${formatPitch(pitchPercent)}`);
      window.clearTimeout(fader._statusTimer);
      fader._statusTimer = window.setTimeout(() => {
        if (transport.isScratching()) return;
        transport.setStatus(transport.isPlaying() ? 'PLAYING' : 'READY');
      }, 650);
    }
  }

  function pitchFromClientY(clientY) {
    const rect = fader.getBoundingClientRect();
    if (!rect.height) return pitchPercent;
    const ratio = clamp((clientY - rect.top) / rect.height, 0, 1);
    return MAX_PITCH - ratio * (MAX_PITCH - MIN_PITCH);
  }

  function beginDrag(event) {
    if (event.pointerType === 'mouse' && event.button !== 0) return;
    event.preventDefault();
    activePointerId = event.pointerId;
    fader.classList.add('is-dragging');
    fader.setPointerCapture?.(event.pointerId);
    render(pitchFromClientY(event.clientY), true);
  }

  function moveDrag(event) {
    if (event.pointerId !== activePointerId) return;
    event.preventDefault();
    render(pitchFromClientY(event.clientY), true);
  }

  function endDrag(event) {
    if (activePointerId === null) return;
    if (event?.pointerId !== undefined && event.pointerId !== activePointerId) return;

    try {
      if (fader.hasPointerCapture?.(activePointerId)) {
        fader.releasePointerCapture(activePointerId);
      }
    } catch (_) {}

    activePointerId = null;
    fader.classList.remove('is-dragging');
  }

  function resetPitch() {
    render(0, true);
  }

  fader.addEventListener('pointerdown', beginDrag);
  fader.addEventListener('pointermove', moveDrag);
  fader.addEventListener('pointerup', endDrag);
  fader.addEventListener('pointercancel', endDrag);
  fader.addEventListener('lostpointercapture', () => {
    activePointerId = null;
    fader.classList.remove('is-dragging');
  });

  fader.addEventListener('dblclick', (event) => {
    event.preventDefault();
    resetPitch();
  });

  fader.addEventListener('keydown', (event) => {
    const step = event.shiftKey ? FINE_KEY_STEP : KEY_STEP;

    if (event.key === 'ArrowUp') {
      event.preventDefault();
      render(pitchPercent + step, true);
    } else if (event.key === 'ArrowDown') {
      event.preventDefault();
      render(pitchPercent - step, true);
    } else if (event.key === 'PageUp') {
      event.preventDefault();
      render(pitchPercent + 2, true);
    } else if (event.key === 'PageDown') {
      event.preventDefault();
      render(pitchPercent - 2, true);
    } else if (event.key === 'Home' || event.key === '0') {
      event.preventDefault();
      resetPitch();
    }
  });

  render(pitchPercent, false);
})();
