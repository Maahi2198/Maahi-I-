const dom = {
  voiceFile: document.querySelector('#voice-file'),
  musicFile: document.querySelector('#music-file'),
  moodSelect: document.querySelector('#mood-select'),
  characterStyle: document.querySelector('#character-style'),
  musicVolume: document.querySelector('#music-volume'),
  musicVolumeOutput: document.querySelector('#music-volume-output'),
  fxIntensity: document.querySelector('#fx-intensity'),
  fxOutput: document.querySelector('#fx-output'),
  previewBtn: document.querySelector('#preview-btn'),
  exportBtn: document.querySelector('#export-btn'),
  stopBtn: document.querySelector('#stop-btn'),
  statusText: document.querySelector('#status-text'),
  progressBar: document.querySelector('#progress-bar'),
  timeLabel: document.querySelector('#time-label'),
  canvas: document.querySelector('#scene-canvas'),
};

const ctx = dom.canvas.getContext('2d');
const offscreenCanvas = document.createElement('canvas');
offscreenCanvas.width = dom.canvas.width;
offscreenCanvas.height = dom.canvas.height;
const exportCtx = offscreenCanvas.getContext('2d');

const moodThemes = {
  sunset: {
    skyTop: '#31255e',
    skyBottom: '#ff9c73',
    stage: '#5d2d4d',
    sparkle: '#ffe599',
    accent: '#78f0d9',
  },
  neon: {
    skyTop: '#090d22',
    skyBottom: '#24246d',
    stage: '#1f143c',
    sparkle: '#ff7dcf',
    accent: '#68f2ff',
  },
  forest: {
    skyTop: '#12362d',
    skyBottom: '#3f8f6a',
    stage: '#3f2e22',
    sparkle: '#ffd36e',
    accent: '#8af79a',
  },
  space: {
    skyTop: '#020611',
    skyBottom: '#182f61',
    stage: '#17172f',
    sparkle: '#d5ccff',
    accent: '#7ad7ff',
  },
};

const state = {
  audioContext: null,
  voiceBuffer: null,
  musicBuffer: null,
  voiceUrl: null,
  musicUrl: null,
  voiceEnergy: [0],
  musicEnergy: [0],
  duration: 0,
  playing: false,
  exporting: false,
  animationFrame: 0,
  startTime: 0,
  previewSources: [],
  previewNodes: [],
  mediaRecorder: null,
  exportChunks: [],
  exportAudioContext: null,
  lastFrameTime: 0,
  progressTimer: null,
  currentTime: 0,
};

function setStatus(message) {
  dom.statusText.textContent = message;
}

function formatTime(seconds) {
  if (!Number.isFinite(seconds)) return '00:00';
  const mins = Math.floor(seconds / 60).toString().padStart(2, '0');
  const secs = Math.floor(seconds % 60).toString().padStart(2, '0');
  return `${mins}:${secs}`;
}

function updateRangeLabels() {
  dom.musicVolumeOutput.textContent = `${dom.musicVolume.value}%`;
  dom.fxOutput.textContent = `${dom.fxIntensity.value}%`;
}

async function getAudioContext() {
  if (!state.audioContext) {
    state.audioContext = new (window.AudioContext || window.webkitAudioContext)();
  }
  if (state.audioContext.state === 'suspended') {
    await state.audioContext.resume();
  }
  return state.audioContext;
}

async function loadAudioFile(file, key) {
  if (!file) {
    state[`${key}Buffer`] = null;
    state[`${key}Energy`] = [0];
    state[`${key}Url`] = null;
    return;
  }

  const audioContext = await getAudioContext();
  const arrayBuffer = await file.arrayBuffer();
  const audioBuffer = await audioContext.decodeAudioData(arrayBuffer.slice(0));
  state[`${key}Buffer`] = audioBuffer;
  state[`${key}Energy`] = analyzeEnergy(audioBuffer);
  state[`${key}Url`] = URL.createObjectURL(file);
  syncDuration();
}

function analyzeEnergy(audioBuffer, bucketCount = 720) {
  const channelData = audioBuffer.getChannelData(0);
  const sampleSize = Math.max(256, Math.floor(channelData.length / bucketCount));
  const values = [];

  for (let offset = 0; offset < channelData.length; offset += sampleSize) {
    let total = 0;
    const end = Math.min(offset + sampleSize, channelData.length);
    for (let i = offset; i < end; i += 1) {
      total += Math.abs(channelData[i]);
    }
    values.push(total / (end - offset || 1));
  }

  const peak = Math.max(...values, 0.001);
  return values.map((value) => Math.min(1, value / peak));
}

function syncDuration() {
  state.duration = Math.max(state.voiceBuffer?.duration || 0, state.musicBuffer?.duration || 0);
  dom.timeLabel.textContent = `${formatTime(state.currentTime)} / ${formatTime(state.duration)}`;
}

function energyAt(values, time) {
  if (!values.length || !state.duration) return 0;
  const progress = Math.min(0.999, Math.max(0, time / state.duration));
  const index = Math.floor(progress * values.length);
  return values[index] || 0;
}

function getSceneSnapshot(time) {
  const voice = energyAt(state.voiceEnergy, time);
  const music = energyAt(state.musicEnergy, time);
  const combined = Math.min(1, voice * 0.78 + music * 0.44);
  const fxScale = Number(dom.fxIntensity.value) / 100;
  return {
    time,
    voice,
    music,
    combined,
    fxScale,
    theme: moodThemes[dom.moodSelect.value],
    characterStyle: dom.characterStyle.value,
  };
}

function drawFrame(targetCtx, snapshot) {
  const { width, height } = targetCtx.canvas;
  const { theme, time, voice, music, combined, fxScale, characterStyle } = snapshot;
  const pulse = 0.5 + Math.sin(time * 2.8) * 0.5;

  const gradient = targetCtx.createLinearGradient(0, 0, 0, height);
  gradient.addColorStop(0, theme.skyTop);
  gradient.addColorStop(1, theme.skyBottom);
  targetCtx.fillStyle = gradient;
  targetCtx.fillRect(0, 0, width, height);

  drawGlow(targetCtx, width * 0.5, height * 0.18, 180 + combined * 90, `rgba(255,255,255,${0.08 + combined * 0.08})`);
  drawGlow(targetCtx, width * 0.18, height * 0.22, 110 + music * 70, `${hexToRgba(theme.accent, 0.2)}`);
  drawGlow(targetCtx, width * 0.82, height * 0.18, 130 + voice * 90, `${hexToRgba(theme.sparkle, 0.18)}`);

  drawStage(targetCtx, snapshot);
  drawSpectrum(targetCtx, snapshot);
  drawSparkles(targetCtx, snapshot, pulse);
  drawCharacters(targetCtx, snapshot, characterStyle);
  drawSpeechBubble(targetCtx, snapshot);
  drawOverlay(targetCtx, snapshot);
}

function drawGlow(targetCtx, x, y, radius, color) {
  const gradient = targetCtx.createRadialGradient(x, y, 0, x, y, radius);
  gradient.addColorStop(0, color);
  gradient.addColorStop(1, 'rgba(255,255,255,0)');
  targetCtx.fillStyle = gradient;
  targetCtx.beginPath();
  targetCtx.arc(x, y, radius, 0, Math.PI * 2);
  targetCtx.fill();
}

function drawStage(targetCtx, snapshot) {
  const { width, height } = targetCtx.canvas;
  targetCtx.fillStyle = hexToRgba(snapshot.theme.stage, 0.96);
  targetCtx.beginPath();
  targetCtx.moveTo(0, height * 0.74);
  targetCtx.quadraticCurveTo(width * 0.5, height * 0.62, width, height * 0.74);
  targetCtx.lineTo(width, height);
  targetCtx.lineTo(0, height);
  targetCtx.closePath();
  targetCtx.fill();

  targetCtx.fillStyle = 'rgba(255,255,255,0.05)';
  for (let i = 0; i < 8; i += 1) {
    const stripeHeight = 16 + Math.sin(snapshot.time * 3 + i) * 5;
    targetCtx.fillRect(0, height * 0.78 + i * 18, width, stripeHeight);
  }
}

function drawSpectrum(targetCtx, snapshot) {
  const { width, height } = targetCtx.canvas;
  const barCount = 28;
  const baseY = height * 0.72;

  for (let i = 0; i < barCount; i += 1) {
    const ratio = i / (barCount - 1);
    const wobble = Math.sin(snapshot.time * 5 + i * 0.8) * 0.5 + 0.5;
    const heightFactor = 26 + snapshot.combined * 120 * wobble + snapshot.music * 55;
    const barWidth = width / barCount - 8;
    const x = 18 + i * (width / barCount);
    const barHeight = heightFactor * (0.55 + ratio * 0.45);

    targetCtx.fillStyle = i % 2 === 0 ? hexToRgba(snapshot.theme.accent, 0.7) : hexToRgba(snapshot.theme.sparkle, 0.64);
    roundRect(targetCtx, x, baseY - barHeight, barWidth, barHeight, 14, true, false);
  }
}

function drawSparkles(targetCtx, snapshot, pulse) {
  const { width, height } = targetCtx.canvas;
  const count = 12 + Math.round(snapshot.fxScale * 18);
  for (let i = 0; i < count; i += 1) {
    const seed = i + 1;
    const x = ((seed * 97 + snapshot.time * 90 * (0.4 + snapshot.music)) % (width + 100)) - 50;
    const y = 80 + ((seed * 57 + snapshot.time * 55 * (0.25 + snapshot.voice)) % (height * 0.5));
    const radius = 3 + ((seed % 5) * 1.6 + pulse * 3 + snapshot.combined * 7);
    targetCtx.fillStyle = i % 3 === 0 ? snapshot.theme.sparkle : snapshot.theme.accent;
    star(targetCtx, x, y, radius, radius * 1.8, 5, 0.4 + pulse * 0.8);
    targetCtx.fill();
  }
}

function drawCharacters(targetCtx, snapshot, style) {
  const { width, height } = targetCtx.canvas;
  const configs = {
    solo: [{ x: 0.5, scale: 1.18, color: '#ffd36e', accent: '#ff7dcf' }],
    duo: [
      { x: 0.36, scale: 1.04, color: '#78f0d9', accent: '#ffd36e' },
      { x: 0.64, scale: 0.98, color: '#ff9ad9', accent: '#9affaf' },
    ],
    band: [
      { x: 0.25, scale: 0.9, color: '#78f0d9', accent: '#ffd36e' },
      { x: 0.5, scale: 1.08, color: '#ff9ad9', accent: '#68f2ff' },
      { x: 0.75, scale: 0.94, color: '#ffd36e', accent: '#b995ff' },
    ],
  };

  const characters = configs[style];
  characters.forEach((character, index) => {
    const bounce = Math.sin(snapshot.time * 6 + index) * (12 + snapshot.combined * 26 * snapshot.fxScale);
    const sway = Math.sin(snapshot.time * 2.5 + index * 1.8) * (10 + snapshot.music * 24);
    const mouth = 8 + snapshot.voice * 22 + (index % 2) * 4;
    const x = width * character.x + sway;
    const y = height * 0.66 - bounce;
    drawCartoonCharacter(targetCtx, {
      x,
      y,
      scale: character.scale,
      bodyColor: character.color,
      accentColor: character.accent,
      mouthOpen: mouth,
      armSwing: snapshot.combined,
      blink: Math.sin(snapshot.time * 1.4 + index * 2.2) > 0.96,
      spotlight: index === 1 || characters.length === 1,
    });
  });
}

function drawCartoonCharacter(targetCtx, options) {
  const {
    x,
    y,
    scale,
    bodyColor,
    accentColor,
    mouthOpen,
    armSwing,
    blink,
    spotlight,
  } = options;

  targetCtx.save();
  targetCtx.translate(x, y);
  targetCtx.scale(scale, scale);

  if (spotlight) {
    targetCtx.fillStyle = 'rgba(255,255,255,0.08)';
    targetCtx.beginPath();
    targetCtx.moveTo(-80, -230);
    targetCtx.lineTo(80, -230);
    targetCtx.lineTo(160, 130);
    targetCtx.lineTo(-160, 130);
    targetCtx.closePath();
    targetCtx.fill();
  }

  targetCtx.strokeStyle = 'rgba(0,0,0,0.35)';
  targetCtx.lineWidth = 6;
  targetCtx.lineCap = 'round';

  targetCtx.fillStyle = bodyColor;
  roundRect(targetCtx, -64, -60, 128, 152, 40, true, true);

  targetCtx.fillStyle = '#ffe5c7';
  targetCtx.beginPath();
  targetCtx.arc(0, -120, 64, 0, Math.PI * 2);
  targetCtx.fill();
  targetCtx.stroke();

  targetCtx.fillStyle = accentColor;
  targetCtx.beginPath();
  targetCtx.arc(-36, -172, 16, 0, Math.PI * 2);
  targetCtx.arc(36, -172, 16, 0, Math.PI * 2);
  targetCtx.fill();

  targetCtx.strokeStyle = '#18212f';
  targetCtx.lineWidth = 5;
  const eyeY = -132;
  targetCtx.beginPath();
  if (blink) {
    targetCtx.moveTo(-25, eyeY);
    targetCtx.lineTo(-5, eyeY + 1);
    targetCtx.moveTo(5, eyeY + 1);
    targetCtx.lineTo(25, eyeY);
  } else {
    targetCtx.arc(-15, eyeY, 8, 0, Math.PI * 2);
    targetCtx.arc(15, eyeY, 8, 0, Math.PI * 2);
  }
  targetCtx.stroke();

  targetCtx.fillStyle = '#ff6f7f';
  targetCtx.beginPath();
  targetCtx.ellipse(0, -95, 18, mouthOpen, 0, 0, Math.PI * 2);
  targetCtx.fill();

  targetCtx.strokeStyle = '#18212f';
  targetCtx.lineWidth = 8;
  const armOffset = 18 + armSwing * 30;
  targetCtx.beginPath();
  targetCtx.moveTo(-48, -20);
  targetCtx.lineTo(-92, 8 - armOffset);
  targetCtx.moveTo(48, -20);
  targetCtx.lineTo(92, 8 + armOffset);
  targetCtx.moveTo(-20, 88);
  targetCtx.lineTo(-30, 150);
  targetCtx.moveTo(20, 88);
  targetCtx.lineTo(30, 150);
  targetCtx.stroke();

  targetCtx.fillStyle = accentColor;
  roundRect(targetCtx, -34, 4, 68, 26, 12, true, false);

  targetCtx.restore();
}

function drawSpeechBubble(targetCtx, snapshot) {
  const { width } = targetCtx.canvas;
  const bubbleWidth = 310;
  const bubbleHeight = 94;
  const x = width - bubbleWidth - 42;
  const y = 38;
  const energyWord = snapshot.voice > 0.7 ? 'BIG CHORUS!' : snapshot.voice > 0.35 ? 'IN SYNC!' : 'READY TO GROOVE';

  targetCtx.fillStyle = 'rgba(255,255,255,0.92)';
  roundRect(targetCtx, x, y, bubbleWidth, bubbleHeight, 24, true, false);
  targetCtx.beginPath();
  targetCtx.moveTo(x + 55, y + bubbleHeight - 6);
  targetCtx.lineTo(x + 80, y + bubbleHeight + 22);
  targetCtx.lineTo(x + 100, y + bubbleHeight - 6);
  targetCtx.closePath();
  targetCtx.fill();

  targetCtx.fillStyle = '#142034';
  targetCtx.font = '700 18px Inter, sans-serif';
  targetCtx.fillText('Cartoon stage AI mix', x + 24, y + 34);
  targetCtx.font = '800 30px Inter, sans-serif';
  targetCtx.fillText(energyWord, x + 24, y + 70);
}

function drawOverlay(targetCtx, snapshot) {
  const { width, height } = targetCtx.canvas;
  targetCtx.fillStyle = 'rgba(8, 13, 24, 0.35)';
  roundRect(targetCtx, 24, 24, 240, 102, 22, true, false);

  targetCtx.fillStyle = '#f4fbff';
  targetCtx.font = '700 18px Inter, sans-serif';
  targetCtx.fillText('Voice energy', 44, 58);
  targetCtx.fillText('Music energy', 44, 96);

  drawMeter(targetCtx, 150, 42, 90, 18, snapshot.voice, '#78f0d9');
  drawMeter(targetCtx, 150, 80, 90, 18, snapshot.music, '#ff7dcf');

  targetCtx.fillStyle = 'rgba(255,255,255,0.65)';
  targetCtx.font = '600 16px Inter, sans-serif';
  targetCtx.fillText(`${dom.moodSelect.options[dom.moodSelect.selectedIndex].text} • ${dom.characterStyle.options[dom.characterStyle.selectedIndex].text}`, 24, height - 26);
}

function drawMeter(targetCtx, x, y, width, height, value, color) {
  targetCtx.fillStyle = 'rgba(255,255,255,0.12)';
  roundRect(targetCtx, x, y, width, height, 999, true, false);
  targetCtx.fillStyle = color;
  roundRect(targetCtx, x, y, width * Math.max(0.08, value), height, 999, true, false);
}

function hexToRgba(hex, alpha) {
  const sanitized = hex.replace('#', '');
  const bigint = parseInt(sanitized, 16);
  const r = (bigint >> 16) & 255;
  const g = (bigint >> 8) & 255;
  const b = bigint & 255;
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

function roundRect(targetCtx, x, y, width, height, radius, fill, stroke) {
  const r = Math.min(radius, width / 2, height / 2);
  targetCtx.beginPath();
  targetCtx.moveTo(x + r, y);
  targetCtx.arcTo(x + width, y, x + width, y + height, r);
  targetCtx.arcTo(x + width, y + height, x, y + height, r);
  targetCtx.arcTo(x, y + height, x, y, r);
  targetCtx.arcTo(x, y, x + width, y, r);
  targetCtx.closePath();
  if (fill) targetCtx.fill();
  if (stroke) targetCtx.stroke();
}

function star(targetCtx, x, y, innerRadius, outerRadius, points, rotation) {
  targetCtx.beginPath();
  for (let i = 0; i < points * 2; i += 1) {
    const radius = i % 2 === 0 ? outerRadius : innerRadius;
    const angle = rotation + (Math.PI * i) / points;
    const px = x + Math.cos(angle) * radius;
    const py = y + Math.sin(angle) * radius;
    if (i === 0) targetCtx.moveTo(px, py);
    else targetCtx.lineTo(px, py);
  }
  targetCtx.closePath();
}

function renderPreviewFrame() {
  if (!state.playing) return;
  const audioContext = state.audioContext;
  const currentTime = Math.max(0, audioContext.currentTime - state.startTime);
  state.currentTime = currentTime;
  dom.timeLabel.textContent = `${formatTime(currentTime)} / ${formatTime(state.duration)}`;
  dom.progressBar.style.width = `${Math.min(100, (currentTime / state.duration) * 100)}%`;

  const snapshot = getSceneSnapshot(currentTime);
  drawFrame(ctx, snapshot);

  if (currentTime >= state.duration) {
    stopPlayback();
    setStatus('Preview finished. You can adjust settings and export a video when ready.');
    return;
  }

  state.animationFrame = window.requestAnimationFrame(renderPreviewFrame);
}

function clearPreview() {
  drawFrame(ctx, getSceneSnapshot(0));
  state.currentTime = 0;
  dom.progressBar.style.width = '0%';
  dom.timeLabel.textContent = `${formatTime(0)} / ${formatTime(state.duration)}`;
}

function stopPlayback() {
  state.playing = false;
  window.cancelAnimationFrame(state.animationFrame);
  state.previewSources.forEach((source) => {
    try {
      source.stop();
    } catch (error) {
      // Source may already be stopped.
    }
  });
  state.previewSources = [];
  state.previewNodes.forEach((node) => node.disconnect());
  state.previewNodes = [];
}

function stopEverything() {
  stopPlayback();
  if (state.mediaRecorder && state.mediaRecorder.state !== 'inactive') {
    state.mediaRecorder.stop();
  }
  if (state.exportAudioContext && state.exportAudioContext.state !== 'closed') {
    state.exportAudioContext.close();
  }
  state.exportAudioContext = null;
  state.exporting = false;
  clearPreview();
  setStatus('Playback stopped.');
}

function createBufferSource(audioContext, audioBuffer, gainValue, destination) {
  const source = audioContext.createBufferSource();
  source.buffer = audioBuffer;
  const gainNode = audioContext.createGain();
  gainNode.gain.value = gainValue;
  source.connect(gainNode);
  gainNode.connect(destination);
  return { source, gainNode };
}

async function startPreview() {
  if (!state.voiceBuffer) {
    setStatus('Please upload a main audio track before previewing.');
    return;
  }

  stopPlayback();
  await getAudioContext();

  const destination = state.audioContext.destination;
  const voiceTrack = createBufferSource(state.audioContext, state.voiceBuffer, 1, destination);
  state.previewSources.push(voiceTrack.source);
  state.previewNodes.push(voiceTrack.gainNode);

  if (state.musicBuffer) {
    const musicTrack = createBufferSource(
      state.audioContext,
      state.musicBuffer,
      Number(dom.musicVolume.value) / 100,
      destination,
    );
    state.previewSources.push(musicTrack.source);
    state.previewNodes.push(musicTrack.gainNode);
    musicTrack.source.start();
  }

  voiceTrack.source.start();
  state.startTime = state.audioContext.currentTime;
  state.playing = true;
  setStatus('Previewing your synchronized cartoon scene...');
  renderPreviewFrame();
}

async function exportVideo() {
  if (!state.voiceBuffer) {
    setStatus('Upload a main audio track before exporting a video.');
    return;
  }

  if (state.exporting) {
    return;
  }

  stopPlayback();
  state.exporting = true;
  dom.exportBtn.disabled = true;
  dom.previewBtn.disabled = true;
  setStatus('Exporting WebM video. Keep this tab open until the download starts...');

  const exportAudioContext = new (window.AudioContext || window.webkitAudioContext)();
  state.exportAudioContext = exportAudioContext;
  const mediaDestination = exportAudioContext.createMediaStreamDestination();

  const voiceTrack = createBufferSource(exportAudioContext, state.voiceBuffer, 1, mediaDestination);
  const exportNodes = [voiceTrack.gainNode];
  voiceTrack.source.start();

  if (state.musicBuffer) {
    const musicTrack = createBufferSource(
      exportAudioContext,
      state.musicBuffer,
      Number(dom.musicVolume.value) / 100,
      mediaDestination,
    );
    exportNodes.push(musicTrack.gainNode);
    musicTrack.source.start();
  }

  const canvasStream = offscreenCanvas.captureStream(30);
  const combinedStream = new MediaStream([
    ...canvasStream.getVideoTracks(),
    ...mediaDestination.stream.getAudioTracks(),
  ]);

  const recorder = new MediaRecorder(combinedStream, {
    mimeType: MediaRecorder.isTypeSupported('video/webm;codecs=vp9,opus')
      ? 'video/webm;codecs=vp9,opus'
      : 'video/webm;codecs=vp8,opus',
  });

  state.exportChunks = [];
  state.mediaRecorder = recorder;

  recorder.ondataavailable = (event) => {
    if (event.data.size > 0) {
      state.exportChunks.push(event.data);
    }
  };

  recorder.onstop = async () => {
    exportNodes.forEach((node) => node.disconnect());
    if (state.exportAudioContext && state.exportAudioContext.state !== 'closed') {
      await state.exportAudioContext.close();
    }
    state.exportAudioContext = null;

    const blob = new Blob(state.exportChunks, { type: 'video/webm' });
    const downloadUrl = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = downloadUrl;
    anchor.download = `cartoon-audio-video-${Date.now()}.webm`;
    anchor.click();
    URL.revokeObjectURL(downloadUrl);

    dom.exportBtn.disabled = false;
    dom.previewBtn.disabled = false;
    state.exporting = false;
    dom.progressBar.style.width = '100%';
    setStatus('Video exported successfully. Your browser should download the WebM file now.');
  };

  recorder.start(250);

  const startedAt = performance.now();
  const renderExportLoop = () => {
    const elapsed = (performance.now() - startedAt) / 1000;
    const clamped = Math.min(state.duration, elapsed);
    state.currentTime = clamped;
    dom.timeLabel.textContent = `${formatTime(clamped)} / ${formatTime(state.duration)}`;
    dom.progressBar.style.width = `${Math.min(100, (clamped / state.duration) * 100)}%`;

    const snapshot = getSceneSnapshot(clamped);
    drawFrame(exportCtx, snapshot);
    ctx.drawImage(offscreenCanvas, 0, 0, dom.canvas.width, dom.canvas.height);

    if (clamped >= state.duration) {
      recorder.stop();
      return;
    }

    window.requestAnimationFrame(renderExportLoop);
  };

  renderExportLoop();
}

async function handleVoiceChange(event) {
  const [file] = event.target.files;
  if (!file) {
    state.voiceBuffer = null;
    state.voiceEnergy = [0];
    syncDuration();
    clearPreview();
    setStatus('Main audio removed. Upload a file to continue.');
    return;
  }

  setStatus(`Loading “${file.name}” and analyzing its waveform...`);
  await loadAudioFile(file, 'voice');
  clearPreview();
  setStatus('Main audio loaded. Add optional background music or start previewing.');
}

async function handleMusicChange(event) {
  const [file] = event.target.files;
  if (!file) {
    state.musicBuffer = null;
    state.musicEnergy = [0];
    syncDuration();
    clearPreview();
    setStatus('Background music removed. Preview will use voice audio only.');
    return;
  }

  setStatus(`Loading background music “${file.name}”...`);
  await loadAudioFile(file, 'music');
  clearPreview();
  setStatus('Background music loaded. Preview the mix or export a video.');
}

function bindEvents() {
  dom.voiceFile.addEventListener('change', (event) => {
    handleVoiceChange(event).catch((error) => {
      console.error(error);
      setStatus('Could not read the main audio file. Please try another file.');
    });
  });

  dom.musicFile.addEventListener('change', (event) => {
    handleMusicChange(event).catch((error) => {
      console.error(error);
      setStatus('Could not read the background music file. Please try another file.');
    });
  });

  dom.musicVolume.addEventListener('input', updateRangeLabels);
  dom.fxIntensity.addEventListener('input', updateRangeLabels);
  dom.moodSelect.addEventListener('change', clearPreview);
  dom.characterStyle.addEventListener('change', clearPreview);
  dom.previewBtn.addEventListener('click', () => {
    startPreview().catch((error) => {
      console.error(error);
      setStatus('Preview failed. Check whether your browser supports Web Audio playback.');
    });
  });
  dom.exportBtn.addEventListener('click', () => {
    exportVideo().catch((error) => {
      console.error(error);
      state.exporting = false;
      dom.exportBtn.disabled = false;
      dom.previewBtn.disabled = false;
      setStatus('Export failed. Try a shorter file or a Chromium-based browser.');
    });
  });
  dom.stopBtn.addEventListener('click', stopEverything);
}

function initialize() {
  updateRangeLabels();
  bindEvents();
  clearPreview();
  setStatus('Upload your voice audio to generate a cartoon animation and downloadable video.');
}

initialize();
