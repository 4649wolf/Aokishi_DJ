(() => {
  'use strict';

  const deck = document.querySelector('.module--deck[data-scratch-instrumental][data-scratch-vocals]');
  const platterWrap = deck?.querySelector('.platter-wrap');
  const platter = deck?.querySelector('.platter');
  const strobeDots = deck?.querySelector('.strobe-dots');
  const transport = window.DJTransport;

  if (!deck || !platterWrap || !platter || !transport) return;

  const SECONDS_PER_REVOLUTION = 60 / (33 + 1 / 3); // 1.8 sec at 33⅓ RPM
  const DEGREES_PER_SECOND = 360 / SECONDS_PER_REVOLUTION;
  const GRAIN_INTERVAL_MS = 28;
  const GRAIN_DURATION_SEC = 0.075;
  const MIN_SCRATCH_SPEED = 0.08;
  const MAX_SCRATCH_SPEED = 4.5;

  let isDragging = false;
  let activePointerId = null;
  let lastPointerAngle = 0;
  let lastMoveAt = 0;
  let scratchTime = 0;
  let resumeAfterScratch = false;
  let lastGrainAt = 0;
  let animationFrame = 0;

  let scratchInstrumentalBuffer = null;
  let scratchVocalBuffer = null;
  let outputContext = null;
  let scratchMaster = null;
  let scratchEqLow = null;
  let scratchEqMid = null;
  let scratchEqHigh = null;
  let scratchLowpass = null;
  let scratchHighpass = null;
  let scratchDry = null;
  let scratchDelay = null;
  let scratchFeedback = null;
  let scratchEchoTone = null;
  let scratchWet = null;
  let scratchOutputGain = null;
  let scratchAnalyser = null;
  let scratchAnalyserFloatData = null;
  let scratchAnalyserByteData = null;
  let scratchFilterAmount = transport.getFilterAmount?.() ?? 0;
  let scratchEchoAmount = transport.getEchoAmount?.() ?? 0;
  let scratchFxEnabled = transport.getFxEnabled?.() ?? false;
  let scratchEqState = transport.getEqState?.() ?? { low: 0, mid: 0, high: 0 };
  let scratchMasterVolume = Math.min(Math.max(Number(transport.getMasterVolume?.() ?? 1), 0), 3);
  let scratchCrossfaderPosition = Math.min(Math.max(Number(transport.getCrossfaderPosition?.() ?? 0.5), 0), 1);
  const activeGrains = new Set();

  function clamp(value, min, max) {
    return Math.min(Math.max(value, min), max);
  }

  function normalizeAngleDelta(degrees) {
    let delta = degrees;
    while (delta > 180) delta -= 360;
    while (delta < -180) delta += 360;
    return delta;
  }

  function getPointerAngle(event) {
    const rect = platterWrap.getBoundingClientRect();
    const x = event.clientX - (rect.left + rect.width / 2);
    const y = event.clientY - (rect.top + rect.height / 2);
    return Math.atan2(y, x) * 180 / Math.PI;
  }

  function getMaximumTime() {
    const transportDuration = transport.getDuration();
    if (transportDuration > 0) return transportDuration;
    if (scratchInstrumentalBuffer?.duration) return scratchInstrumentalBuffer.duration;
    if (scratchVocalBuffer?.duration) return scratchVocalBuffer.duration;
    return Number.POSITIVE_INFINITY;
  }

  function setVisualRotation(time) {
    const degrees = time * DEGREES_PER_SECOND;
    const transform = `rotate(${degrees}deg)`;
    platter.style.transform = transform;
    if (strobeDots) strobeDots.style.transform = transform;
  }

  function updateAria(time) {
    const duration = getMaximumTime();
    const safeTime = Math.max(0, Number(time) || 0);
    platterWrap.setAttribute('aria-valuenow', safeTime.toFixed(1));
    platterWrap.setAttribute('aria-valuetext', `${safeTime.toFixed(1)}秒`);
    if (Number.isFinite(duration)) {
      platterWrap.setAttribute('aria-valuemax', duration.toFixed(1));
    }
  }

  function animatePlatter() {
    if (!isDragging) {
      const time = transport.getCurrentTime();
      setVisualRotation(time);
      updateAria(time);
    }
    animationFrame = window.requestAnimationFrame(animatePlatter);
  }

  async function decodeScratchPreview(url) {
    if (!url) return null;
    const response = await fetch(url, { cache: 'force-cache' });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const bytes = await response.arrayBuffer();

    // OfflineAudioContext can decode before a user gesture without opening
    // an audible output device. The actual output context is created only
    // after the user touches/clicks the platter.
    const OfflineContext = window.OfflineAudioContext || window.webkitOfflineAudioContext;
    if (!OfflineContext) throw new Error('OfflineAudioContext is not supported.');
    const decodeContext = new OfflineContext(1, 1, 22050);
    return decodeContext.decodeAudioData(bytes);
  }

  async function preloadScratchBuffers() {
    try {
      const [instrumentalBuffer, vocalBuffer] = await Promise.all([
        decodeScratchPreview(deck.dataset.scratchInstrumental),
        decodeScratchPreview(deck.dataset.scratchVocals),
      ]);
      scratchInstrumentalBuffer = instrumentalBuffer;
      scratchVocalBuffer = vocalBuffer;
      updateAria(transport.getCurrentTime());
    } catch (error) {
      console.warn('Scratch stem previews could not be prepared. Seeking still works silently.', error);
    }
  }

  function applyScratchEq() {
    if (!outputContext || !scratchEqLow || !scratchEqMid || !scratchEqHigh) return;
    const now = outputContext.currentTime;
    const low = clamp(Number(scratchEqState.low) || 0, -24, 6);
    const mid = clamp(Number(scratchEqState.mid) || 0, -24, 6);
    const high = clamp(Number(scratchEqState.high) || 0, -24, 6);
    scratchEqLow.gain.setTargetAtTime(low, now, 0.015);
    scratchEqMid.gain.setTargetAtTime(mid, now, 0.015);
    scratchEqHigh.gain.setTargetAtTime(high, now, 0.015);
  }

  function applyScratchFilter() {
    if (!outputContext || !scratchLowpass || !scratchHighpass) return;

    const amount = scratchFxEnabled ? clamp(Number(scratchFilterAmount) || 0, -1, 1) : 0;
    const now = outputContext.currentTime;
    const nyquistSafe = Math.min(20000, outputContext.sampleRate * 0.45);
    const minLowpass = 220;
    const minHighpass = 20;
    const maxHighpass = Math.min(5200, nyquistSafe * 0.6);

    let lowpassFrequency = nyquistSafe;
    let highpassFrequency = minHighpass;

    if (amount < 0) {
      const t = Math.abs(amount);
      lowpassFrequency = nyquistSafe * Math.pow(minLowpass / nyquistSafe, t);
    } else if (amount > 0) {
      highpassFrequency = minHighpass * Math.pow(maxHighpass / minHighpass, amount);
    }

    const resonance = 0.72 + Math.abs(amount) * 3.3;
    scratchLowpass.frequency.setTargetAtTime(lowpassFrequency, now, 0.01);
    scratchHighpass.frequency.setTargetAtTime(highpassFrequency, now, 0.01);
    scratchLowpass.Q.setTargetAtTime(resonance, now, 0.015);
    scratchHighpass.Q.setTargetAtTime(resonance, now, 0.015);
  }

  function applyScratchEcho() {
    if (!outputContext || !scratchDry || !scratchDelay || !scratchFeedback || !scratchWet) return;

    const amount = scratchFxEnabled ? clamp(Number(scratchEchoAmount) || 0, 0, 1) : 0;
    const now = outputContext.currentTime;
    scratchDelay.delayTime.setTargetAtTime(0.25, now, 0.01);
    scratchWet.gain.setTargetAtTime(amount * 0.58, now, 0.018);
    scratchFeedback.gain.setTargetAtTime(amount * 0.62, now, 0.02);
    scratchDry.gain.setTargetAtTime(1 - amount * 0.10, now, 0.018);
  }

  function applyScratchMaster() {
    if (!outputContext || !scratchOutputGain) return;
    const now = outputContext.currentTime;
    scratchOutputGain.gain.cancelScheduledValues(now);
    scratchOutputGain.gain.setTargetAtTime(scratchMasterVolume, now, 0.012);
  }

  function readScratchRms() {
    if (!scratchAnalyser) return 0;

    let sum = 0;
    if (typeof scratchAnalyser.getFloatTimeDomainData === 'function') {
      if (!scratchAnalyserFloatData || scratchAnalyserFloatData.length !== scratchAnalyser.fftSize) {
        scratchAnalyserFloatData = new Float32Array(scratchAnalyser.fftSize);
      }
      scratchAnalyser.getFloatTimeDomainData(scratchAnalyserFloatData);
      for (let i = 0; i < scratchAnalyserFloatData.length; i += 1) {
        const sample = scratchAnalyserFloatData[i];
        sum += sample * sample;
      }
      return Math.sqrt(sum / Math.max(1, scratchAnalyserFloatData.length));
    }

    if (!scratchAnalyserByteData || scratchAnalyserByteData.length !== scratchAnalyser.fftSize) {
      scratchAnalyserByteData = new Uint8Array(scratchAnalyser.fftSize);
    }
    scratchAnalyser.getByteTimeDomainData(scratchAnalyserByteData);
    for (let i = 0; i < scratchAnalyserByteData.length; i += 1) {
      const sample = (scratchAnalyserByteData[i] - 128) / 128;
      sum += sample * sample;
    }
    return Math.sqrt(sum / Math.max(1, scratchAnalyserByteData.length));
  }

  async function ensureOutputContext() {
    const AudioContextClass = window.AudioContext || window.webkitAudioContext;
    if (!AudioContextClass) return null;

    if (!outputContext) {
      outputContext = new AudioContextClass({ latencyHint: 'interactive' });
      scratchMaster = outputContext.createGain();
      scratchEqLow = outputContext.createBiquadFilter();
      scratchEqMid = outputContext.createBiquadFilter();
      scratchEqHigh = outputContext.createBiquadFilter();
      scratchLowpass = outputContext.createBiquadFilter();
      scratchHighpass = outputContext.createBiquadFilter();
      scratchDry = outputContext.createGain();
      scratchDelay = outputContext.createDelay(1.0);
      scratchFeedback = outputContext.createGain();
      scratchEchoTone = outputContext.createBiquadFilter();
      scratchWet = outputContext.createGain();
      scratchOutputGain = outputContext.createGain();
      scratchAnalyser = outputContext.createAnalyser();
      scratchMaster.gain.value = 0.9;
      scratchEqLow.type = 'lowshelf';
      scratchEqLow.frequency.value = 100;
      scratchEqLow.gain.value = 0;
      scratchEqMid.type = 'peaking';
      scratchEqMid.frequency.value = 1000;
      scratchEqMid.Q.value = 1.0;
      scratchEqMid.gain.value = 0;
      scratchEqHigh.type = 'highshelf';
      scratchEqHigh.frequency.value = 10000;
      scratchEqHigh.gain.value = 0;
      scratchLowpass.type = 'lowpass';
      scratchHighpass.type = 'highpass';
      scratchDry.gain.value = 1;
      scratchDelay.delayTime.value = 0.25;
      scratchFeedback.gain.value = 0;
      scratchEchoTone.type = 'lowpass';
      scratchEchoTone.frequency.value = 5200;
      scratchEchoTone.Q.value = 0.5;
      scratchWet.gain.value = 0;
      scratchOutputGain.gain.value = scratchMasterVolume;
      scratchAnalyser.fftSize = 1024;
      scratchAnalyser.smoothingTimeConstant = 0.58;
      scratchAnalyser.minDecibels = -90;
      scratchAnalyser.maxDecibels = -6;

      scratchMaster.connect(scratchEqLow);
      scratchEqLow.connect(scratchEqMid);
      scratchEqMid.connect(scratchEqHigh);
      scratchEqHigh.connect(scratchLowpass);
      scratchLowpass.connect(scratchHighpass);
      scratchHighpass.connect(scratchDry);
      scratchDry.connect(scratchOutputGain);
      scratchHighpass.connect(scratchDelay);
      scratchDelay.connect(scratchEchoTone);
      scratchEchoTone.connect(scratchWet);
      scratchWet.connect(scratchOutputGain);
      scratchEchoTone.connect(scratchFeedback);
      scratchFeedback.connect(scratchDelay);
      scratchOutputGain.connect(scratchAnalyser);
      scratchAnalyser.connect(outputContext.destination);
      applyScratchEq();
      applyScratchFilter();
      applyScratchEcho();
      applyScratchMaster();
    }

    if (outputContext.state === 'suspended') {
      try { await outputContext.resume(); } catch (_) {}
    }

    return outputContext;
  }

  function stopScratchAudio() {
    if (scratchMaster && outputContext) {
      const now = outputContext.currentTime;
      scratchMaster.gain.cancelScheduledValues(now);
      scratchMaster.gain.setValueAtTime(scratchMaster.gain.value, now);
      scratchMaster.gain.linearRampToValueAtTime(0, now + 0.018);
      window.setTimeout(() => {
        if (scratchMaster && outputContext) scratchMaster.gain.value = 0.9;
      }, 28);
    }

    for (const source of activeGrains) {
      try { source.stop(); } catch (_) {}
    }
    activeGrains.clear();
  }

  function playScratchGrain(positionSeconds, velocity, force = false) {
    if ((!scratchInstrumentalBuffer && !scratchVocalBuffer) || !outputContext || !scratchMaster) return;

    const nowMs = performance.now();
    if (!force && nowMs - lastGrainAt < GRAIN_INTERVAL_MS) return;

    const magnitude = Math.abs(velocity);
    if (magnitude < MIN_SCRATCH_SPEED) return;
    lastGrainAt = nowMs;

    const direction = velocity >= 0 ? 1 : -1;
    const speed = clamp(magnitude, 0.22, MAX_SCRATCH_SPEED);
    const outputFrames = Math.max(256, Math.floor(outputContext.sampleRate * GRAIN_DURATION_SEC));
    const grain = outputContext.createBuffer(1, outputFrames, outputContext.sampleRate);
    const output = grain.getChannelData(0);
    const instrumentalData = scratchInstrumentalBuffer?.getChannelData(0) ?? null;
    const vocalData = scratchVocalBuffer?.getChannelData(0) ?? null;
    const referenceBuffer = scratchInstrumentalBuffer || scratchVocalBuffer;
    const sourceRate = referenceBuffer.sampleRate;
    const sampleStep = direction * speed * sourceRate / outputContext.sampleRate;
    const crossfadeAngle = scratchCrossfaderPosition * Math.PI / 2;
    const instrumentalGain = Math.cos(crossfadeAngle);
    const vocalGain = Math.sin(crossfadeAngle);

    function interpolate(data, index, fraction) {
      if (!data) return 0;
      if (index >= 0 && index + 1 < data.length) {
        return data[index] + (data[index + 1] - data[index]) * fraction;
      }
      return index >= 0 && index < data.length ? data[index] : 0;
    }

    // Center each grain around the current platter position. Reading both stem
    // previews backwards gives a real reverse scratch while preserving the
    // CROSSFADER's Instrumental <-> Vocals balance.
    let sourceIndex = positionSeconds * sourceRate - sampleStep * outputFrames * 0.45;

    for (let i = 0; i < outputFrames; i += 1) {
      const index = Math.floor(sourceIndex);
      const fraction = sourceIndex - index;
      const instrumentalSample = interpolate(instrumentalData, index, fraction);
      const vocalSample = interpolate(vocalData, index, fraction);
      const mixedSample = instrumentalSample * instrumentalGain + vocalSample * vocalGain;

      // Hann-style envelope prevents clicks while overlapping short grains.
      const envelope = Math.sin(Math.PI * i / Math.max(1, outputFrames - 1));
      output[i] = clamp(mixedSample, -1, 1) * envelope * 0.95;
      sourceIndex += sampleStep;
    }

    const node = outputContext.createBufferSource();
    node.buffer = grain;
    node.connect(scratchMaster);
    activeGrains.add(node);
    node.addEventListener('ended', () => activeGrains.delete(node), { once: true });
    node.start();
  }

  async function beginPointerScratch(event) {
    if (event.pointerType === 'mouse' && event.button !== 0) return;
    if (isDragging) return;

    event.preventDefault();
    isDragging = true;
    activePointerId = event.pointerId;
    platterWrap.classList.add('is-scratching');
    platterWrap.setPointerCapture?.(event.pointerId);

    resumeAfterScratch = transport.beginScratch();
    scratchTime = transport.getCurrentTime();
    lastPointerAngle = getPointerAngle(event);
    lastMoveAt = performance.now();
    lastGrainAt = 0;
    setVisualRotation(scratchTime);
    updateAria(scratchTime);

    await ensureOutputContext();
  }

  function movePointerScratch(event) {
    if (!isDragging || event.pointerId !== activePointerId) return;
    event.preventDefault();

    const now = performance.now();
    const nextAngle = getPointerAngle(event);
    const deltaDegrees = normalizeAngleDelta(nextAngle - lastPointerAngle);
    lastPointerAngle = nextAngle;

    const positionDelta = deltaDegrees / DEGREES_PER_SECOND;
    const elapsedSeconds = Math.max((now - lastMoveAt) / 1000, 1 / 240);
    const velocity = positionDelta / elapsedSeconds;
    lastMoveAt = now;

    const maxTime = getMaximumTime();
    scratchTime = clamp(scratchTime + positionDelta, 0, Number.isFinite(maxTime) ? Math.max(0, maxTime - 0.005) : scratchTime + Math.abs(positionDelta) + 1);
    scratchTime = transport.seekTo(scratchTime);

    setVisualRotation(scratchTime);
    updateAria(scratchTime);
    playScratchGrain(scratchTime, velocity);
  }

  async function endPointerScratch(event) {
    if (!isDragging) return;
    if (event && event.pointerId !== undefined && event.pointerId !== activePointerId) return;

    isDragging = false;
    try {
      if (activePointerId !== null && platterWrap.hasPointerCapture?.(activePointerId)) {
        platterWrap.releasePointerCapture(activePointerId);
      }
    } catch (_) {}
    activePointerId = null;
    platterWrap.classList.remove('is-scratching');
    stopScratchAudio();
    await transport.endScratch(resumeAfterScratch);
    resumeAfterScratch = false;
  }

  async function nudgeWithKeyboard(deltaSeconds) {
    if (isDragging) return;
    const shouldResume = transport.beginScratch();
    const next = transport.seekTo(transport.getCurrentTime() + deltaSeconds);
    setVisualRotation(next);
    updateAria(next);
    await ensureOutputContext();
    playScratchGrain(next, deltaSeconds > 0 ? 1 : -1, true);
    window.setTimeout(() => stopScratchAudio(), 85);
    await transport.endScratch(shouldResume);
  }

  platterWrap.addEventListener('pointerdown', beginPointerScratch);
  platterWrap.addEventListener('pointermove', movePointerScratch);
  platterWrap.addEventListener('pointerup', endPointerScratch);
  platterWrap.addEventListener('pointercancel', endPointerScratch);
  platterWrap.addEventListener('lostpointercapture', () => {
    if (isDragging) endPointerScratch();
  });

  platterWrap.addEventListener('keydown', (event) => {
    if (event.repeat) return;
    if (event.key === 'ArrowRight') {
      event.preventDefault();
      nudgeWithKeyboard(event.shiftKey ? 1 : 0.25);
    } else if (event.key === 'ArrowLeft') {
      event.preventDefault();
      nudgeWithKeyboard(event.shiftKey ? -1 : -0.25);
    }
  });


  window.addEventListener('dj:eqchange', (event) => {
    const state = event.detail?.state;
    if (state) {
      scratchEqState = {
        low: clamp(Number(state.low) || 0, -24, 6),
        mid: clamp(Number(state.mid) || 0, -24, 6),
        high: clamp(Number(state.high) || 0, -24, 6),
      };
    } else {
      const band = event.detail?.band;
      if (['low', 'mid', 'high'].includes(band)) {
        scratchEqState[band] = clamp(Number(event.detail?.gain) || 0, -24, 6);
      }
    }
    applyScratchEq();
  });

  window.addEventListener('dj:filterchange', (event) => {
    scratchFilterAmount = clamp(Number(event.detail?.amount) || 0, -1, 1);
    applyScratchFilter();
  });

  window.addEventListener('dj:echochange', (event) => {
    scratchEchoAmount = clamp(Number(event.detail?.amount) || 0, 0, 1);
    applyScratchEcho();
  });

  window.addEventListener('dj:fxchange', (event) => {
    scratchFxEnabled = Boolean(event.detail?.enabled);
    applyScratchFilter();
    applyScratchEcho();
  });

  window.addEventListener('dj:masterchange', (event) => {
    scratchMasterVolume = clamp(Number(event.detail?.volume) || 0, 0, 3);
    applyScratchMaster();
  });

  window.addEventListener('dj:crossfaderchange', (event) => {
    scratchCrossfaderPosition = clamp(Number(event.detail?.position) || 0, 0, 1);
  });

  // VU meter reads this separate AudioContext while scratching. Normal BGM and
  // PAD audio are measured by DJTransport's analyser on the shared MASTER bus.
  window.DJScratchMeter = Object.freeze({
    getMeterRms: readScratchRms,
  });

  preloadScratchBuffers();
  animatePlatter();

  window.addEventListener('pagehide', () => {
    window.cancelAnimationFrame(animationFrame);
    stopScratchAudio();
    outputContext?.close?.().catch?.(() => {});
  }, { once: true });
})();
