(() => {
  'use strict';

  const pads = [...document.querySelectorAll('.pad[data-sound]')];
  const samples = new Map();
  const routedSamples = new WeakSet();

  function createSample(pad) {
    const audio = new Audio(pad.dataset.sound);
    audio.preload = 'auto';
    audio.playsInline = true;
    audio.volume = 1;
    audio.load();
    return audio;
  }

  function getSample(pad) {
    if (!samples.has(pad)) {
      samples.set(pad, createSample(pad));
    }
    return samples.get(pad);
  }

  function flashPad(pad) {
    pad.classList.add('is-active');
    clearTimeout(pad._flashTimer);
    pad._flashTimer = window.setTimeout(() => {
      pad.classList.remove('is-active');
    }, 110);
  }

  function triggerPad(pad) {
    const audio = getSample(pad);
    const transport = window.DJTransport;

    // Join the shared output/VU bus on first use. PAD audio intentionally bypasses
    // the deck MASTER knob so its established loudness stays unchanged while
    // BGM/scratch can be boosted independently up to 300%.
    if (!routedSamples.has(audio) && transport?.connectExternalMediaElement?.(audio)) {
      routedSamples.add(audio);
      audio.volume = 1;
    } else if (!routedSamples.has(audio)) {
      audio.volume = 1;
    }

    // Sampler-like retrigger: every hit restarts the assigned SE from the beginning.
    audio.pause();
    try {
      audio.currentTime = 0;
    } catch (_) {
      // Some browsers may not expose currentTime until metadata is ready.
    }

    const playPromise = audio.play();
    if (playPromise && typeof playPromise.catch === 'function') {
      playPromise.catch((error) => {
        // Ignore AbortError caused by very rapid retriggers; surface other failures.
        if (error?.name !== 'AbortError') {
          console.warn(`PAD ${pad.dataset.pad ?? ''} could not play.`, error);
        }
      });
    }

    flashPad(pad);
  }




  pads.forEach((pad) => {
    // Prepare each tiny SE ahead of time so the first hit is as responsive as possible.
    getSample(pad);

    // Pointer Events cover mouse, pen, and touch with one low-latency handler.
    pad.addEventListener('pointerdown', (event) => {
      if (event.pointerType === 'mouse' && event.button !== 0) return;
      triggerPad(pad);
    });

    // Keep the pads usable from a physical keyboard as real buttons.
    pad.addEventListener('keydown', (event) => {
      if (event.repeat) return;
      if (event.key === 'Enter' || event.key === ' ') {
        event.preventDefault();
        triggerPad(pad);
      }
    });
  });
})();
