(() => {
  'use strict';

  const fader = document.querySelector('[data-crossfader]');
  const cap = fader?.querySelector('.fader__cap');
  const transport = window.DJTransport;
  if (!fader || !cap || !transport) return;

  const KEY_STEP = 0.02;
  const FINE_KEY_STEP = 0.005;
  const CENTER_SNAP = 0.015;

  let position = clamp(Number(transport.getCrossfaderPosition?.() ?? 0.5));
  let activePointerId = null;
  let statusTimer = 0;

  function clamp(value) {
    return Math.min(Math.max(Number(value) || 0, 0), 1);
  }

  function snapCenter(value) {
    const next = clamp(value);
    return Math.abs(next - 0.5) <= CENTER_SNAP ? 0.5 : next;
  }

  function sidePercentages(value = position) {
    const b = Math.round(clamp(value) * 100);
    return { a: 100 - b, b };
  }

  function describe(value = position) {
    const { a, b } = sidePercentages(value);
    if (value <= 0.005) return 'A: Instrumental 100% / Vocals 0%';
    if (value >= 0.995) return 'B: Vocals 100% / Instrumental 0%';
    if (Math.abs(value - 0.5) < 0.005) return 'CENTER: Instrumental + Vocals';
    return `Instrumental ${a}% / Vocals ${b}%`;
  }

  function render() {
    const rect = fader.getBoundingClientRect();
    const capWidth = cap.getBoundingClientRect().width || 27;
    const travel = Math.max(0, rect.width - capWidth);
    cap.style.left = `${(travel * position).toFixed(2)}px`;

    const percent = Math.round(position * 100);
    fader.setAttribute('aria-valuenow', String(percent));
    fader.setAttribute('aria-valuetext', describe());
    fader.classList.toggle('is-center', Math.abs(position - 0.5) < 0.005);
    fader.classList.toggle('is-a-side', position < 0.5);
    fader.classList.toggle('is-b-side', position > 0.5);
  }

  function restoreStatusSoon() {
    window.clearTimeout(statusTimer);
    statusTimer = window.setTimeout(() => {
      if (transport.isScratching?.()) return;
      transport.setStatus?.(transport.isPlaying?.() ? 'PLAYING' : 'READY');
    }, 700);
  }

  function commit(nextPosition, announce = true) {
    position = Math.round(snapCenter(nextPosition) * 1000) / 1000;
    transport.setCrossfaderPosition?.(position);
    render();

    if (announce) {
      const { a, b } = sidePercentages();
      transport.setStatus?.(position === 0.5 ? 'XFADE CENTER' : `XFADE A${a} B${b}`);
      restoreStatusSoon();
    }
  }

  function positionFromPointer(event) {
    const rect = fader.getBoundingClientRect();
    const capWidth = cap.getBoundingClientRect().width || 27;
    const halfCap = capWidth / 2;
    const travel = Math.max(1, rect.width - capWidth);
    return clamp((event.clientX - rect.left - halfCap) / travel);
  }

  fader.addEventListener('pointerdown', (event) => {
    if (event.pointerType === 'mouse' && event.button !== 0) return;
    event.preventDefault();
    activePointerId = event.pointerId;
    fader.classList.add('is-dragging');
    fader.setPointerCapture?.(event.pointerId);
    commit(positionFromPointer(event));
  });

  fader.addEventListener('pointermove', (event) => {
    if (activePointerId === null || event.pointerId !== activePointerId) return;
    event.preventDefault();
    commit(positionFromPointer(event), false);
  });

  function endPointer(event) {
    if (activePointerId === null) return;
    if (event?.pointerId !== undefined && event.pointerId !== activePointerId) return;
    try {
      if (fader.hasPointerCapture?.(activePointerId)) fader.releasePointerCapture(activePointerId);
    } catch (_) {}
    activePointerId = null;
    fader.classList.remove('is-dragging');
    const { a, b } = sidePercentages();
    transport.setStatus?.(position === 0.5 ? 'XFADE CENTER' : `XFADE A${a} B${b}`);
    restoreStatusSoon();
  }

  fader.addEventListener('pointerup', endPointer);
  fader.addEventListener('pointercancel', endPointer);
  fader.addEventListener('lostpointercapture', () => endPointer());

  fader.addEventListener('dblclick', (event) => {
    event.preventDefault();
    commit(0.5);
  });

  fader.addEventListener('keydown', (event) => {
    if (event.repeat) return;
    const step = event.shiftKey ? FINE_KEY_STEP : KEY_STEP;
    let next = null;

    if (event.key === 'ArrowRight') next = position + step;
    else if (event.key === 'ArrowLeft') next = position - step;
    else if (event.key === 'PageUp') next = position + 0.10;
    else if (event.key === 'PageDown') next = position - 0.10;
    else if (event.key === 'Home') next = 0;
    else if (event.key === 'End') next = 1;
    else if (event.key === '0' || event.key.toLowerCase() === 'c') next = 0.5;

    if (next !== null) {
      event.preventDefault();
      commit(next);
    }
  });

  window.addEventListener('resize', render, { passive: true });
  window.addEventListener('dj:crossfaderchange', (event) => {
    const next = event.detail?.position;
    if (next === undefined || next === null) return;
    position = clamp(next);
    render();
  });

  commit(position, false);
})();
