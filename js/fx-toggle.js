(() => {
  'use strict';

  const button = document.querySelector('[data-fx-toggle]');
  const module = button?.closest('.module--fx');
  const transport = window.DJTransport;

  if (!button || !module || !transport) return;

  let fxEnabled = transport.getFxEnabled?.() ?? false;
  let statusTimer = 0;

  function restoreStatusSoon() {
    window.clearTimeout(statusTimer);
    statusTimer = window.setTimeout(() => {
      if (transport.isScratching?.()) return;
      transport.setStatus?.(transport.isPlaying?.() ? 'PLAYING' : 'READY');
    }, 700);
  }

  function render(announce = false) {
    button.classList.toggle('is-active', fxEnabled);
    module.classList.toggle('is-fx-enabled', fxEnabled);
    button.setAttribute('aria-pressed', String(fxEnabled));
    button.setAttribute('aria-label', `FILTERとECHOのFXを${fxEnabled ? 'OFF' : 'ON'}にする`);

    if (announce) {
      transport.setStatus?.(fxEnabled ? 'FX ON' : 'FX OFF');
      restoreStatusSoon();
    }
  }

  async function toggleFx() {
    // Resume/create Web Audio while still inside the user's click/tap gesture.
    await transport.ensureAudioReady?.();
    fxEnabled = transport.setFxEnabled?.(!fxEnabled) ?? !fxEnabled;
    render(true);
  }

  button.addEventListener('click', toggleFx);

  window.addEventListener('dj:fxchange', (event) => {
    const next = Boolean(event.detail?.enabled);
    if (next === fxEnabled) return;
    fxEnabled = next;
    render(false);
  });

  render(false);
})();
