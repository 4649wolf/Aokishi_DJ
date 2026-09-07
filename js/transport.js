(() => {
  'use strict';

  const deck = document.querySelector('.module--deck[data-instrumental][data-vocals]');
  if (!deck) return;

  const playButton = deck.querySelector('[data-transport="play"]');
  const cueButton = deck.querySelector('[data-transport="cue"]');
  const statusText = document.querySelector('[data-status-text]');
  if (!playButton || !cueButton) return;

  const instrumental = new Audio(deck.dataset.instrumental);
  const vocals = new Audio(deck.dataset.vocals);
  const tracks = [instrumental, vocals];

  tracks.forEach((track) => {
    track.preload = 'auto';
    track.playsInline = true;
    track.loop = false;
    track.load();
  });

  let isPlaying = false;
  let isStarting = false;
  let isScratching = false;
  let playbackRequest = 0;
  let syncTimer = 0;
  let cueFlashTimer = 0;
  let pitchPercent = 0;
  let filterAmount = 0;
  let echoAmount = 0;
  let fxEnabled = false;
  let eqLowDb = 0;
  let eqMidDb = 0;
  let eqHighDb = 0;
  let masterVolume = 1;
  let crossfaderPosition = 0.5;

  let audioContext = null;
  let mixNode = null;
  let instrumentalGainNode = null;
  let vocalGainNode = null;
  let eqLowNode = null;
  let eqMidNode = null;
  let eqHighNode = null;
  let lowpassNode = null;
  let highpassNode = null;
  let dryGainNode = null;
  let echoDelayNode = null;
  let echoFeedbackNode = null;
  let echoToneNode = null;
  let echoWetGainNode = null;
  let masterGainNode = null;
  let analyserNode = null;
  let analyserFloatData = null;
  let analyserByteData = null;
  const externalMediaSources = new WeakMap();
  let mediaSources = [];
  let audioGraphReady = false;

  function setStatus(text) {
    if (statusText) statusText.textContent = text;
  }

  function clampPitch(value) {
    return Math.min(Math.max(Number(value) || 0, -8), 8);
  }

  function applyPlaybackRate() {
    const rate = 1 + pitchPercent / 100;
    tracks.forEach((track) => {
      track.playbackRate = rate;
      track.defaultPlaybackRate = rate;

      // A real DJ pitch control changes both speed and pitch together.
      // Disable browser pitch correction where the property is available.
      try { track.preservesPitch = false; } catch (_) {}
      try { track.webkitPreservesPitch = false; } catch (_) {}
    });
    return rate;
  }

  function setPitchPercent(value) {
    pitchPercent = Math.round(clampPitch(value) * 10) / 10;
    return applyPlaybackRate();
  }

  function getPitchPercent() {
    return pitchPercent;
  }

  function getPlaybackRate() {
    return 1 + pitchPercent / 100;
  }

  function clampFilter(value) {
    return Math.min(Math.max(Number(value) || 0, -1), 1);
  }

  function applyFilterCurve() {
    if (!audioGraphReady || !audioContext || !lowpassNode || !highpassNode) return;

    const amount = fxEnabled ? clampFilter(filterAmount) : 0;
    const now = audioContext.currentTime;
    const nyquistSafe = Math.min(20000, audioContext.sampleRate * 0.45);
    const minLowpass = 220;
    const minHighpass = 20;
    const maxHighpass = Math.min(5200, nyquistSafe * 0.6);

    let lowpassFrequency = nyquistSafe;
    let highpassFrequency = minHighpass;

    if (amount < 0) {
      const t = Math.abs(amount);
      lowpassFrequency = nyquistSafe * Math.pow(minLowpass / nyquistSafe, t);
    } else if (amount > 0) {
      const t = amount;
      highpassFrequency = minHighpass * Math.pow(maxHighpass / minHighpass, t);
    }

    const resonance = 0.72 + Math.abs(amount) * 3.3;
    lowpassNode.frequency.setTargetAtTime(lowpassFrequency, now, 0.012);
    highpassNode.frequency.setTargetAtTime(highpassFrequency, now, 0.012);
    lowpassNode.Q.setTargetAtTime(resonance, now, 0.018);
    highpassNode.Q.setTargetAtTime(resonance, now, 0.018);
  }


  function clampEqDb(value) {
    return Math.min(Math.max(Number(value) || 0, -24), 6);
  }

  function applyEqCurve() {
    if (!audioGraphReady || !audioContext || !eqLowNode || !eqMidNode || !eqHighNode) return;
    const now = audioContext.currentTime;
    eqLowNode.gain.setTargetAtTime(eqLowDb, now, 0.015);
    eqMidNode.gain.setTargetAtTime(eqMidDb, now, 0.015);
    eqHighNode.gain.setTargetAtTime(eqHighDb, now, 0.015);
  }

  function setEqBand(band, value) {
    const next = Math.round(clampEqDb(value) * 10) / 10;
    if (band === 'low') eqLowDb = next;
    else if (band === 'mid') eqMidDb = next;
    else if (band === 'high') eqHighDb = next;
    else return null;

    applyEqCurve();
    const state = { low: eqLowDb, mid: eqMidDb, high: eqHighDb };
    window.dispatchEvent(new CustomEvent('dj:eqchange', {
      detail: { band, gain: next, state },
    }));
    return next;
  }

  function getEqBand(band) {
    if (band === 'low') return eqLowDb;
    if (band === 'mid') return eqMidDb;
    if (band === 'high') return eqHighDb;
    return 0;
  }

  function getEqState() {
    return { low: eqLowDb, mid: eqMidDb, high: eqHighDb };
  }

  function clampMaster(value) {
    return Math.min(Math.max(Number(value) || 0, 0), 3);
  }

  function applyMasterVolume() {
    if (!audioGraphReady || !audioContext || !masterGainNode) return;
    const now = audioContext.currentTime;
    masterGainNode.gain.cancelScheduledValues(now);
    masterGainNode.gain.setTargetAtTime(masterVolume, now, 0.012);
  }

  function setMasterVolume(value) {
    masterVolume = Math.round(clampMaster(value) * 100) / 100;
    applyMasterVolume();
    window.dispatchEvent(new CustomEvent('dj:masterchange', {
      detail: { volume: masterVolume },
    }));
    return masterVolume;
  }

  function getMasterVolume() {
    return masterVolume;
  }

  function clampCrossfader(value) {
    return Math.min(Math.max(Number(value) || 0, 0), 1);
  }

  function getCrossfaderGains(position = crossfaderPosition) {
    const t = clampCrossfader(position);
    const angle = t * Math.PI / 2;
    return {
      instrumental: Math.cos(angle),
      vocals: Math.sin(angle),
    };
  }

  function applyCrossfaderCurve() {
    if (!audioGraphReady || !audioContext || !instrumentalGainNode || !vocalGainNode) return;
    const now = audioContext.currentTime;
    const gains = getCrossfaderGains();
    instrumentalGainNode.gain.cancelScheduledValues(now);
    vocalGainNode.gain.cancelScheduledValues(now);
    instrumentalGainNode.gain.setTargetAtTime(gains.instrumental, now, 0.01);
    vocalGainNode.gain.setTargetAtTime(gains.vocals, now, 0.01);
  }

  function setCrossfaderPosition(value) {
    crossfaderPosition = Math.round(clampCrossfader(value) * 1000) / 1000;
    applyCrossfaderCurve();
    const gains = getCrossfaderGains();
    window.dispatchEvent(new CustomEvent('dj:crossfaderchange', {
      detail: {
        position: crossfaderPosition,
        instrumentalGain: gains.instrumental,
        vocalGain: gains.vocals,
      },
    }));
    return crossfaderPosition;
  }

  function getCrossfaderPosition() {
    return crossfaderPosition;
  }

  function readAnalyserRms() {
    if (!audioGraphReady || !analyserNode) return 0;

    let sum = 0;
    if (typeof analyserNode.getFloatTimeDomainData === 'function') {
      if (!analyserFloatData || analyserFloatData.length !== analyserNode.fftSize) {
        analyserFloatData = new Float32Array(analyserNode.fftSize);
      }
      analyserNode.getFloatTimeDomainData(analyserFloatData);
      for (let i = 0; i < analyserFloatData.length; i += 1) {
        const sample = analyserFloatData[i];
        sum += sample * sample;
      }
      return Math.sqrt(sum / Math.max(1, analyserFloatData.length));
    }

    if (!analyserByteData || analyserByteData.length !== analyserNode.fftSize) {
      analyserByteData = new Uint8Array(analyserNode.fftSize);
    }
    analyserNode.getByteTimeDomainData(analyserByteData);
    for (let i = 0; i < analyserByteData.length; i += 1) {
      const sample = (analyserByteData[i] - 128) / 128;
      sum += sample * sample;
    }
    return Math.sqrt(sum / Math.max(1, analyserByteData.length));
  }

  function connectExternalMediaElement(element) {
    if (!(element instanceof HTMLMediaElement)) return false;

    // This function is deliberately synchronous from the caller's perspective:
    // ensureAudioReady() builds the graph before its first await, preserving
    // low-latency PAD playback inside the original user gesture.
    ensureAudioReady();
    if (!audioContext || !analyserNode) return false;
    if (externalMediaSources.has(element)) return true;

    try {
      const source = audioContext.createMediaElementSource(element);
      // PAD/external sampler audio bypasses the deck MASTER gain so its current
      // loudness stays unchanged. It still joins the analyser/output bus, so
      // the VU meter reflects PAD hits together with the deck.
      source.connect(analyserNode);
      externalMediaSources.set(element, source);
      return true;
    } catch (error) {
      console.warn('External media could not join the output/VU bus.', error);
      return false;
    }
  }

  async function ensureAudioReady() {
    const AudioContextClass = window.AudioContext || window.webkitAudioContext;
    if (!AudioContextClass) return false;

    if (!audioContext) {
      try {
        audioContext = new AudioContextClass({ latencyHint: 'interactive' });
        mixNode = audioContext.createGain();
        instrumentalGainNode = audioContext.createGain();
        vocalGainNode = audioContext.createGain();
        eqLowNode = audioContext.createBiquadFilter();
        eqMidNode = audioContext.createBiquadFilter();
        eqHighNode = audioContext.createBiquadFilter();
        lowpassNode = audioContext.createBiquadFilter();
        highpassNode = audioContext.createBiquadFilter();
        dryGainNode = audioContext.createGain();
        echoDelayNode = audioContext.createDelay(1.0);
        echoFeedbackNode = audioContext.createGain();
        echoToneNode = audioContext.createBiquadFilter();
        echoWetGainNode = audioContext.createGain();
        masterGainNode = audioContext.createGain();
        analyserNode = audioContext.createAnalyser();

        eqLowNode.type = 'lowshelf';
        eqMidNode.type = 'peaking';
        eqHighNode.type = 'highshelf';
        eqLowNode.frequency.value = 100;
        eqLowNode.gain.value = 0;
        eqMidNode.frequency.value = 1000;
        eqMidNode.Q.value = 1.0;
        eqMidNode.gain.value = 0;
        eqHighNode.frequency.value = 10000;
        eqHighNode.gain.value = 0;
        lowpassNode.type = 'lowpass';
        highpassNode.type = 'highpass';
        echoToneNode.type = 'lowpass';
        lowpassNode.frequency.value = Math.min(20000, audioContext.sampleRate * 0.45);
        highpassNode.frequency.value = 20;
        lowpassNode.Q.value = 0.72;
        highpassNode.Q.value = 0.72;
        dryGainNode.gain.value = 1;
        echoDelayNode.delayTime.value = 0.25;
        echoFeedbackNode.gain.value = 0;
        echoToneNode.frequency.value = 5200;
        echoToneNode.Q.value = 0.5;
        echoWetGainNode.gain.value = 0;
        masterGainNode.gain.value = masterVolume;
        analyserNode.fftSize = 1024;
        analyserNode.smoothingTimeConstant = 0.58;
        analyserNode.minDecibels = -90;
        analyserNode.maxDecibels = -6;

        mediaSources = tracks.map((track, index) => {
          const source = audioContext.createMediaElementSource(track);
          source.connect(index === 0 ? instrumentalGainNode : vocalGainNode);
          return source;
        });
        instrumentalGainNode.connect(mixNode);
        vocalGainNode.connect(mixNode);

        mixNode.connect(eqLowNode);
        eqLowNode.connect(eqMidNode);
        eqMidNode.connect(eqHighNode);
        eqHighNode.connect(lowpassNode);
        lowpassNode.connect(highpassNode);

        // Dry path.
        highpassNode.connect(dryGainNode);
        dryGainNode.connect(masterGainNode);

        // Echo send + feedback path. Keeping this after FILTER means the echoes
        // inherit the current COLOR FILTER tone, which feels more like a mixer FX.
        highpassNode.connect(echoDelayNode);
        echoDelayNode.connect(echoToneNode);
        echoToneNode.connect(echoWetGainNode);
        echoWetGainNode.connect(masterGainNode);
        echoToneNode.connect(echoFeedbackNode);
        echoFeedbackNode.connect(echoDelayNode);

        // MASTER is the true final bus. The analyser sits after the MASTER gain,
        // so the VU meter reflects what is actually sent to the speakers.
        masterGainNode.connect(analyserNode);
        analyserNode.connect(audioContext.destination);

        audioGraphReady = true;
        applyCrossfaderCurve();
        applyEqCurve();
        applyFilterCurve();
        applyEchoCurve();
        applyMasterVolume();
      } catch (error) {
        console.warn('Web Audio FX graph could not be initialized. Falling back to direct audio.', error);
        audioGraphReady = false;
        return false;
      }
    }

    if (audioContext.state === 'suspended') {
      try { await audioContext.resume(); } catch (_) {}
    }

    return audioGraphReady;
  }

  function setFilterAmount(value) {
    filterAmount = Math.round(clampFilter(value) * 100) / 100;
    applyFilterCurve();
    window.dispatchEvent(new CustomEvent('dj:filterchange', {
      detail: { amount: filterAmount },
    }));
    return filterAmount;
  }

  function getFilterAmount() {
    return filterAmount;
  }

  function clampEcho(value) {
    return Math.min(Math.max(Number(value) || 0, 0), 1);
  }

  function applyEchoCurve() {
    if (!audioGraphReady || !audioContext || !dryGainNode || !echoDelayNode || !echoFeedbackNode || !echoWetGainNode) return;

    const amount = fxEnabled ? clampEcho(echoAmount) : 0;
    const now = audioContext.currentTime;

    // One-knob echo: keep a DJ-friendly 1/8-note-ish delay and use the knob
    // to control wet level + feedback. At 0 the echo path is fully silent.
    const delaySeconds = 0.25;
    const wetLevel = amount * 0.58;
    const feedback = amount * 0.62;
    const dryLevel = 1 - amount * 0.10;

    echoDelayNode.delayTime.setTargetAtTime(delaySeconds, now, 0.01);
    echoWetGainNode.gain.setTargetAtTime(wetLevel, now, 0.018);
    echoFeedbackNode.gain.setTargetAtTime(feedback, now, 0.02);
    dryGainNode.gain.setTargetAtTime(dryLevel, now, 0.018);
  }

  function setEchoAmount(value) {
    echoAmount = Math.round(clampEcho(value) * 100) / 100;
    applyEchoCurve();
    window.dispatchEvent(new CustomEvent('dj:echochange', {
      detail: { amount: echoAmount },
    }));
    return echoAmount;
  }

  function getEchoAmount() {
    return echoAmount;
  }

  function setFxEnabled(value) {
    fxEnabled = Boolean(value);
    applyFilterCurve();
    applyEchoCurve();
    window.dispatchEvent(new CustomEvent('dj:fxchange', {
      detail: {
        enabled: fxEnabled,
        filterAmount,
        echoAmount,
      },
    }));
    return fxEnabled;
  }

  function getFxEnabled() {
    return fxEnabled;
  }

  applyPlaybackRate();

  function setPlayingState(playing) {
    isPlaying = playing;
    playButton.classList.toggle('is-active', playing);
    playButton.setAttribute('aria-pressed', String(playing));
    deck.classList.toggle('is-playing', playing);
    if (!isScratching) setStatus(playing ? 'PLAYING' : 'READY');
  }

  function clearSyncTimer() {
    if (syncTimer) {
      window.clearInterval(syncTimer);
      syncTimer = 0;
    }
  }

  function getDuration() {
    return Number.isFinite(instrumental.duration) ? instrumental.duration : 0;
  }

  function clampTime(time) {
    const duration = getDuration();
    const max = duration > 0 ? Math.max(0, duration - 0.005) : Number.POSITIVE_INFINITY;
    return Math.min(Math.max(Number(time) || 0, 0), max);
  }

  function alignVocals(force = false) {
    if (!Number.isFinite(instrumental.currentTime) || !Number.isFinite(vocals.currentTime)) return;
    const drift = vocals.currentTime - instrumental.currentTime;
    if (force || Math.abs(drift) > 0.04) {
      try {
        vocals.currentTime = instrumental.currentTime;
      } catch (_) {
        // Seeking can fail briefly while metadata is still loading.
      }
    }
  }

  function seekTo(time) {
    const nextTime = clampTime(time);
    tracks.forEach((track) => {
      try {
        track.currentTime = nextTime;
      } catch (_) {
        // Metadata may still be loading. A later seek/play will recover.
      }
    });
    return nextTime;
  }

  function startSyncWatch() {
    clearSyncTimer();
    syncTimer = window.setInterval(() => alignVocals(false), 350);
  }

  async function startPlayback() {
    if (isScratching) return false;

    // Initialize/resume Web Audio inside the same user gesture without delaying
    // HTMLMediaElement.play(), which keeps mobile autoplay policies happy.
    ensureAudioReady();

    const request = ++playbackRequest;
    isStarting = true;
    alignVocals(true);
    setStatus('LOADING');

    const results = await Promise.allSettled(tracks.map((track) => track.play()));
    const failed = results.find((result) => result.status === 'rejected');

    if (request !== playbackRequest) {
      tracks.forEach((track) => track.pause());
      isStarting = false;
      return false;
    }

    if (failed) {
      tracks.forEach((track) => track.pause());
      clearSyncTimer();
      isStarting = false;
      setPlayingState(false);
      setStatus('ERROR');
      console.warn('BGM could not start.', failed.reason);
      return false;
    }

    isStarting = false;
    window.setTimeout(() => alignVocals(true), 80);
    startSyncWatch();
    setPlayingState(true);
    return true;
  }

  function pausePlayback() {
    playbackRequest += 1;
    isStarting = false;
    tracks.forEach((track) => track.pause());
    clearSyncTimer();
    setPlayingState(false);
  }

  function cueToStart() {
    if (isScratching) return;
    pausePlayback();
    seekTo(0);

    cueButton.classList.add('is-active');
    window.clearTimeout(cueFlashTimer);
    cueFlashTimer = window.setTimeout(() => cueButton.classList.remove('is-active'), 130);
    setStatus('CUE');
    window.setTimeout(() => {
      if (!isPlaying && !isScratching) setStatus('READY');
    }, 450);
  }

  function beginScratch() {
    if (isScratching) return false;

    const resumeAfterScratch = isPlaying || isStarting;
    playbackRequest += 1;
    isStarting = false;
    tracks.forEach((track) => track.pause());
    clearSyncTimer();
    isPlaying = false;
    isScratching = true;

    deck.classList.add('is-scratching');
    deck.classList.remove('is-playing');
    setStatus('SCRATCH');

    // Keep the PLAY light on while touching a spinning deck so it is clear
    // that releasing the platter will resume playback.
    playButton.classList.toggle('is-active', resumeAfterScratch);
    playButton.setAttribute('aria-pressed', String(resumeAfterScratch));

    return resumeAfterScratch;
  }

  async function endScratch(resumeAfterScratch) {
    if (!isScratching) return;

    isScratching = false;
    deck.classList.remove('is-scratching');
    alignVocals(true);

    if (resumeAfterScratch) {
      await startPlayback();
    } else {
      setPlayingState(false);
    }
  }

  playButton.addEventListener('click', () => {
    if (isScratching) return;
    if (isPlaying || isStarting) {
      pausePlayback();
    } else {
      startPlayback();
    }
  });

  cueButton.addEventListener('click', cueToStart);

  instrumental.addEventListener('ended', () => {
    if (isScratching) return;
    pausePlayback();
    seekTo(0);
  });

  instrumental.addEventListener('seeked', () => {
    if (!isScratching) alignVocals(true);
  });

  document.addEventListener('visibilitychange', () => {
    if (!document.hidden && isPlaying && !isScratching) alignVocals(true);
  });

  // Small public controller used by the platter block. Keeping all transport
  // state here prevents the platter and PLAY/CUE logic from fighting each other.
  window.DJTransport = Object.freeze({
    startPlayback,
    pausePlayback,
    beginScratch,
    endScratch,
    seekTo,
    getCurrentTime: () => Number.isFinite(instrumental.currentTime) ? instrumental.currentTime : 0,
    getDuration,
    isPlaying: () => isPlaying,
    isScratching: () => isScratching,
    setPitchPercent,
    getPitchPercent,
    getPlaybackRate,
    ensureAudioReady,
    setEqBand,
    getEqBand,
    getEqState,
    setMasterVolume,
    getMasterVolume,
    setCrossfaderPosition,
    getCrossfaderPosition,
    getCrossfaderGains,
    getMeterRms: readAnalyserRms,
    connectExternalMediaElement,
    setFilterAmount,
    getFilterAmount,
    setEchoAmount,
    getEchoAmount,
    setFxEnabled,
    getFxEnabled,
    setStatus,
  });

  window.addEventListener('pagehide', () => {
    audioContext?.close?.().catch?.(() => {});
  }, { once: true });
})();
