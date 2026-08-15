(() => {
  'use strict';

  const $ = (id) => document.getElementById(id);
  const ui = {
    start: $('startBtn'), pause: $('pauseBtn'), end: $('endBtn'), hit: $('hitBtn'),
    mute: $('muteBtn'), scene: $('scene'), stage: $('stage'), wrap: $('muyuWrap'),
    mallet: $('premiumMallet'), impact: $('malletImpact'), dong: $('dong'),
    status: $('statusText'), bg: $('bgWord'), toast: $('toast'), time: $('timeText'),
    count: $('countText'), merit: $('meritText'), rate: $('rateText'), today: $('todayText'),
    best: $('bestText'), speed: $('speed'), tone: $('tone'), volume: $('volume'), volumeValue: $('volumeValue'),
    ambientButton: $('ambientBtn'), ambientVolume: $('ambientVolume'), ambientVolumeValue: $('ambientVolumeValue'), goal: $('goal'),
    progress: $('progressInner'), goalText: $('goalText'), badges: $('badges'),
    modal: $('modal'), closeModal: $('closeModal'), achievementUnlock: $('achievementUnlock'), achievementName: $('achievementName')
  };

  const SETTINGS_KEY = 'muyu-user-settings-v2';
  // CC0: "Mokugyo.wav" by jonopodmore, Freesound sound 607215.
  const isLocalFile = window.location.protocol === 'file:';
  const localWoodfishSample = isLocalFile ? new Audio('woodfish.mp3') : null;
  if (localWoodfishSample) localWoodfishSample.preload = 'auto';
  const woodSampleDataPromise = isLocalFile ? Promise.resolve(null) : fetch('woodfish.mp3?v=1').then((response) => {
      if (!response.ok) throw new Error('木魚音效載入失敗');
      return response.arrayBuffer();
    });
  const sayings = ['功德無量', '身心自在', '吉祥平安', '一念清淨', '心誠則靈', '福慧雙修', '無憂無懼'];
  const achievements = [['初入佛門', 10], ['一百零八功德圓滿', 108], ['虔誠居士', 500], ['禪修達人', 1000], ['木魚宗師', 10000]];
  let running = false;
  let paused = false;
  let startedAt = 0;
  let accumulatedMs = 0;
  let count = 0;
  let merit = 0;
  let muted = false;
  let pendingHits = 0;
  let badgeLevel = -1;
  let timer = 0;
  let autoTimer = 0;
  let sayingTimer = 0;
  let saveTimer = 0;
  let audioContext = null;
  let woodInput = null;
  let ambientInput = null;
  let masterGain = null;
  let ambientGain = null;
  let woodSampleBuffer = null;
  let woodSampleLoading = null;
  let audioPreparing = false;
  let ambientEnabled = false;
  let bellTimer = 0;
  let returnFocus = null;

  const currentMode = () => document.querySelector('input[name="mode"]:checked')?.value || 'manual';
  const elapsedSeconds = () => Math.floor((accumulatedMs + (running ? Date.now() - startedAt : 0)) / 1000);
  const formatTime = (seconds) => `${String(Math.floor(seconds / 60)).padStart(2, '0')}:${String(seconds % 60).padStart(2, '0')}`;
  const todayKey = () => {
    const date = new Date();
    return `muyu-user-today-${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
  };
  const readNumber = (key) => {
    try { return Number(localStorage.getItem(key) || 0); } catch { return 0; }
  };
  const writeValue = (key, value) => {
    try { localStorage.setItem(key, String(value)); } catch {}
  };

  function showToast(message) {
    ui.toast.textContent = message;
    ui.toast.classList.add('show');
    clearTimeout(showToast.timer);
    showToast.timer = setTimeout(() => ui.toast.classList.remove('show'), 1500);
  }

  function saveSettings() {
    try {
      localStorage.setItem(SETTINGS_KEY, JSON.stringify({
        mode: currentMode(), speed: ui.speed.value, tone: ui.tone.value,
        volume: ui.volume.value, ambientVolume: ui.ambientVolume.value,
        ambientEnabled, goal: ui.goal.value, muted
      }));
    } catch {}
  }

  function loadSettings() {
    let settings = {};
    try { settings = JSON.parse(localStorage.getItem(SETTINGS_KEY) || '{}') || {}; } catch {}
    const radio = document.querySelector(`input[name="mode"][value="${settings.mode || 'manual'}"]`);
    if (radio) radio.checked = true;
    if (settings.speed) ui.speed.value = settings.speed;
    if (settings.tone) ui.tone.value = settings.tone;
    if (settings.volume) ui.volume.value = settings.volume;
    if (settings.ambientVolume) ui.ambientVolume.value = settings.ambientVolume;
    ambientEnabled = Boolean(settings.ambientEnabled);
    if (settings.goal) ui.goal.value = settings.goal;
    muted = Boolean(settings.muted);
    updateRangeLabels();
    updateAmbientButton();
    updateMuteButton();
  }

  function updateRangeLabels() {
    ui.volumeValue.textContent = `${Math.round(Number(ui.volume.value) * 100)}%`;
    ui.ambientVolumeValue.textContent = `${Math.round(Number(ui.ambientVolume.value) * 100)}%`;
  }

  function updateAmbientButton() {
    ui.ambientButton.textContent = ambientEnabled ? '🔔 寺院鐘聲：開啟' : '🔔 寺院鐘聲：關閉';
    ui.ambientButton.classList.toggle('soundOn', ambientEnabled);
    ui.ambientButton.setAttribute('aria-pressed', String(ambientEnabled));
  }

  function updateMuteButton() {
    ui.mute.textContent = muted ? '🔇 靜音中' : '🔊 音效開啟';
    ui.mute.classList.toggle('muted', muted);
    ui.mute.setAttribute('aria-pressed', String(muted));
  }

  function flushProgress() {
    clearTimeout(saveTimer);
    if (!pendingHits) return;
    const total = readNumber(todayKey()) + pendingHits;
    writeValue(todayKey(), total);
    writeValue('muyu-user-best', Math.max(total, readNumber('muyu-user-best')));
    pendingHits = 0;
    updateLocalStats();
  }

  function queueProgressSave() {
    pendingHits += 1;
    ui.today.textContent = readNumber(todayKey()) + pendingHits;
    clearTimeout(saveTimer);
    saveTimer = setTimeout(flushProgress, 1000);
  }

  function updateLocalStats() {
    ui.today.textContent = readNumber(todayKey()) + pendingHits;
    ui.best.textContent = Math.max(readNumber('muyu-user-best'), Number(ui.today.textContent));
  }

  function renderBadges(force = false) {
    const level = achievements.filter(([, target]) => count >= target).length;
    if (!force && level === badgeLevel) return;
    badgeLevel = level;
    ui.badges.replaceChildren(...achievements.map(([name, target]) => {
      const badge = document.createElement('div');
      const done = count >= target;
      badge.className = `badge ${done ? 'done' : ''}`;
      badge.textContent = `${done ? '✅' : '🔒'} ${name}：${target} 下`;
      return badge;
    }));
  }

  function unlockAchievement(name, target) {
    ui.achievementName.textContent = `${name}・${target} 下`;
    ui.achievementUnlock.classList.remove('show');
    void ui.achievementUnlock.offsetWidth;
    ui.achievementUnlock.classList.add('show');
    clearTimeout(unlockAchievement.timer);
    unlockAchievement.timer = setTimeout(() => ui.achievementUnlock.classList.remove('show'), 2700);
  }

  function updateGoal() {
    const goal = Number(ui.goal.value);
    ui.progress.style.width = goal ? `${Math.min(100, Math.round(count / goal * 100))}%` : '0%';
    ui.goalText.textContent = goal ? `目前 ${count} / ${goal} 下` : '自由修行模式，無固定目標';
  }

  function updateStats() {
    const seconds = elapsedSeconds();
    ui.time.textContent = formatTime(seconds);
    ui.count.textContent = count;
    ui.merit.textContent = merit;
    ui.rate.textContent = seconds ? Math.round(count / seconds * 60) : 0;
    renderBadges();
    updateGoal();
  }

  function prepareAudio() {
    if (audioContext) return;
    const AudioContextClass = window.AudioContext || window.webkitAudioContext;
    try {
      audioContext = new AudioContextClass({ latencyHint: 'interactive' });
    } catch {
      audioContext = new AudioContextClass();
    }
    woodInput = audioContext.createGain();
    ambientInput = audioContext.createGain();
    masterGain = audioContext.createGain();
    ambientGain = audioContext.createGain();
    const woodCompressor = audioContext.createDynamicsCompressor();
    const ambientCompressor = audioContext.createDynamicsCompressor();
    const woodLimiter = audioContext.createDynamicsCompressor();
    const ambientLimiter = audioContext.createDynamicsCompressor();
    [woodCompressor, ambientCompressor].forEach((compressor) => {
      compressor.threshold.value = -20;
      compressor.knee.value = 16;
      compressor.ratio.value = 5;
      compressor.attack.value = 0.003;
      compressor.release.value = 0.2;
    });
    [woodLimiter, ambientLimiter].forEach((limiter) => {
      limiter.threshold.value = -2;
      limiter.knee.value = 0;
      limiter.ratio.value = 20;
      limiter.attack.value = 0.001;
      limiter.release.value = 0.08;
    });
    woodInput.connect(woodCompressor).connect(masterGain).connect(woodLimiter).connect(audioContext.destination);
    ambientInput.connect(ambientCompressor).connect(ambientGain).connect(ambientLimiter).connect(audioContext.destination);
    woodSampleLoading = isLocalFile ? Promise.resolve() : woodSampleDataPromise
      .then((data) => audioContext.decodeAudioData(data.slice(0)))
      .then((buffer) => { woodSampleBuffer = buffer; })
      .catch((error) => { woodSampleBuffer = null; throw error; });
  }

  function unlockAudio() {
    try {
      prepareAudio();
      if (!muted) audioContext.resume();
    } catch {}
  }

  function playSound() {
    if (muted) return;
    unlockAudio();
    const toneProfiles = {
      standard: { rate: 1, level: 1 },
      crisp: { rate: 1.24, level: 0.92 },
      deep: { rate: 0.74, level: 1 },
      soft: { rate: 0.9, level: 0.58 }
    };
    const toneProfile = toneProfiles[ui.tone.value] || toneProfiles.standard;
    if (isLocalFile && localWoodfishSample) {
      const sample = localWoodfishSample.cloneNode();
      sample.preservesPitch = false;
      sample.mozPreservesPitch = false;
      sample.webkitPreservesPitch = false;
      sample.playbackRate = toneProfile.rate;
      sample.volume = Math.min(1, Number(ui.volume.value || 1) * toneProfile.level);
      sample.play().catch(() => {});
      return;
    }
    if (audioContext && woodSampleBuffer) {
      const now = audioContext.currentTime;
      const source = audioContext.createBufferSource();
      const sampleGain = audioContext.createGain();
      source.buffer = woodSampleBuffer;
      source.playbackRate.value = toneProfile.rate;
      sampleGain.gain.setValueAtTime(toneProfile.level, now);
      sampleGain.gain.setValueAtTime(toneProfile.level, now + 0.18);
      sampleGain.gain.exponentialRampToValueAtTime(0.0001, now + 0.3);
      masterGain.gain.setTargetAtTime(Number(ui.volume.value || 1), now, 0.004);
      source.connect(sampleGain).connect(woodInput);
      // 跳過 MP3 編碼器在檔頭加入的極短靜音，讓觸控與聲音貼齊。
      source.start(now, Math.min(0.025, woodSampleBuffer.duration / 4));
      source.stop(now + 0.32);
      return;
    }
  }

  function playTempleBell() {
    if (!ambientEnabled || muted) return;
    try {
      unlockAudio();
      const now = audioContext.currentTime;
      ambientGain.gain.setTargetAtTime(Number(ui.ambientVolume.value || 0.35), now, 0.02);
      const partials = [[196, 1, 5.8], [392, 0.5, 4.2], [566, 0.3, 3.4], [784, 0.18, 2.6]];
      partials.forEach(([frequency, level, duration]) => {
        const oscillator = audioContext.createOscillator();
        const gain = audioContext.createGain();
        oscillator.type = 'sine';
        oscillator.frequency.setValueAtTime(frequency, now);
        oscillator.frequency.exponentialRampToValueAtTime(frequency * 0.992, now + duration);
        gain.gain.setValueAtTime(0.0001, now);
        gain.gain.exponentialRampToValueAtTime(level, now + 0.012);
        gain.gain.exponentialRampToValueAtTime(0.0001, now + duration);
        oscillator.connect(gain).connect(ambientInput);
        oscillator.start(now);
        oscillator.stop(now + duration + 0.05);
      });
    } catch {}
  }

  function scheduleTempleBell(playImmediately = false) {
    clearInterval(bellTimer);
    if (!ambientEnabled) return;
    if (playImmediately) playTempleBell();
    bellTimer = setInterval(playTempleBell, 14000);
  }

  function haptic() {
    try { navigator.vibrate?.(18); } catch {}
  }

  function restartAnimation(element, className) {
    element.classList.remove(className);
    element.getAnimations?.().forEach((animation) => animation.cancel());
    element.classList.add(className);
  }

  function effects() {
    const ring = document.createElement('div');
    ring.className = 'ring';
    ui.scene.appendChild(ring);
    setTimeout(() => ring.remove(), 780);
    restartAnimation(ui.dong, 'show');
    const particleCount = currentMode() === 'auto' ? 5 : 8;
    for (let index = 0; index < particleCount; index += 1) {
      const particle = document.createElement('div');
      particle.className = 'spark';
      particle.textContent = ['✨', '✦', '🙏', 'ポク'][Math.floor(Math.random() * 4)];
      particle.style.left = `${ui.scene.clientWidth / 2 - 38 + Math.random() * 110}px`;
      particle.style.top = `${ui.scene.clientHeight / 2 - 18 + Math.random() * 52}px`;
      particle.style.setProperty('--x', `${Math.random() * 280 - 140}px`);
      particle.style.setProperty('--y', `${-90 - Math.random() * 145}px`);
      ui.scene.appendChild(particle);
      setTimeout(() => particle.remove(), 1100);
    }
  }

  function hitWoodfish() {
    if (!running) {
      showToast(paused ? '請先繼續修行' : '請先按「開始修行」');
      return;
    }
    // 聲音優先排程，避免手機在重排動畫版面後才開始播放。
    playSound();
    count += 1;
    merit += currentMode() === 'auto' && Number(ui.speed.value) <= 460 ? 2 : 1;
    restartAnimation(ui.wrap, 'hit');
    restartAnimation(ui.mallet, 'hit');
    restartAnimation(ui.impact, 'show');
    haptic();
    effects();
    updateStats();
    queueProgressSave();
    const goal = Number(ui.goal.value);
    if (goal && count === goal) showToast(`🎉 目標達成：${goal} 下`);
    const achievement = achievements.find(([, target]) => target === count);
    if (achievement) unlockAchievement(achievement[0], achievement[1]);
  }

  function clearPracticeTimers() {
    clearInterval(timer);
    clearInterval(autoTimer);
    clearInterval(sayingTimer);
  }

  function startAutoIfNeeded() {
    clearInterval(autoTimer);
    if (running && currentMode() === 'auto' && !document.hidden) {
      autoTimer = setInterval(hitWoodfish, Number(ui.speed.value));
    }
  }

  function startLiveTimers() {
    timer = setInterval(updateStats, 1000);
    sayingTimer = setInterval(() => {
      const saying = sayings[Math.floor(Math.random() * sayings.length)];
      ui.status.textContent = `🙏 ${saying}`;
      ui.bg.textContent = saying;
    }, 3000);
    startAutoIfNeeded();
  }

  async function startPractice() {
    if (running || paused || audioPreparing) return;
    audioPreparing = true;
    ui.start.disabled = true;
    ui.status.textContent = '正在準備低延遲木魚音效…';
    unlockAudio();
    try {
      await woodSampleLoading;
      if (!muted) await audioContext.resume();
    } catch {
      audioPreparing = false;
      ui.start.disabled = false;
      ui.status.textContent = '音效載入失敗，請確認網路後重新整理';
      showToast('木魚音效載入失敗');
      return;
    }
    audioPreparing = false;
    running = true;
    startedAt = Date.now();
    accumulatedMs = 0;
    count = 0;
    merit = 0;
    badgeLevel = -1;
    ui.stage.classList.add('running');
    ui.start.disabled = true;
    ui.pause.disabled = false;
    ui.end.disabled = false;
    ui.hit.disabled = false;
    ui.status.textContent = '🙏 修行中，點擊木魚累積功德';
    startLiveTimers();
    updateStats();
    showToast('修行開始');
  }

  function togglePause() {
    if (!running && !paused) return;
    if (running) {
      accumulatedMs += Date.now() - startedAt;
      running = false;
      paused = true;
      clearPracticeTimers();
      flushProgress();
      ui.stage.classList.remove('running');
      ui.pause.textContent = '繼續修行';
      ui.hit.disabled = true;
      ui.status.textContent = '修行已暫停';
      updateStats();
      return;
    }
    unlockAudio();
    running = true;
    paused = false;
    startedAt = Date.now();
    ui.stage.classList.add('running');
    ui.pause.textContent = '暫停修行';
    ui.hit.disabled = false;
    ui.status.textContent = '🙏 修行繼續';
    startLiveTimers();
  }

  function openSummary() {
    $('sumTime').textContent = formatTime(elapsedSeconds());
    $('sumCount').textContent = count;
    $('sumMerit').textContent = merit;
    $('sumRate').textContent = elapsedSeconds() ? Math.round(count / elapsedSeconds() * 60) : 0;
    $('summaryMsg').textContent = count >= 108 ? '功德圓滿，福慧增長。' : '功德無量，保持一念清淨。';
    returnFocus = document.activeElement;
    ui.modal.setAttribute('aria-hidden', 'false');
    ui.modal.classList.add('show');
    ui.closeModal.focus();
  }

  function closeSummary() {
    ui.modal.classList.remove('show');
    ui.modal.setAttribute('aria-hidden', 'true');
    returnFocus?.focus();
  }

  function endPractice() {
    if (!running && !paused) return;
    if (running) accumulatedMs += Date.now() - startedAt;
    running = false;
    paused = false;
    clearPracticeTimers();
    flushProgress();
    ui.stage.classList.remove('running');
    ui.start.disabled = false;
    ui.pause.disabled = true;
    ui.pause.textContent = '暫停修行';
    ui.end.disabled = true;
    ui.hit.disabled = true;
    ui.status.textContent = '修行已結束，願你今日平安順心';
    updateStats();
    openSummary();
  }

  ui.start.addEventListener('click', startPractice);
  ui.pause.addEventListener('click', togglePause);
  ui.end.addEventListener('click', endPractice);
  function bindImmediateHit(element) {
    element.addEventListener('pointerdown', (event) => {
      if (event.pointerType === 'mouse' && event.button !== 0) return;
      event.preventDefault();
      hitWoodfish();
    });
    // 保留鍵盤啟動按鈕時產生的無座標 click。
    element.addEventListener('click', (event) => {
      if (event.detail === 0) hitWoodfish();
    });
  }
  bindImmediateHit(ui.hit);
  bindImmediateHit(ui.scene);
  ui.scene.addEventListener('keydown', (event) => {
    if (event.code === 'Enter') { event.preventDefault(); hitWoodfish(); }
  });
  ui.mute.addEventListener('click', () => {
    muted = !muted;
    updateMuteButton();
    saveSettings();
    if (!muted) playSound();
    showToast(muted ? '已切換為靜音' : '已開啟音效');
  });
  ui.ambientButton.addEventListener('click', () => {
    ambientEnabled = !ambientEnabled;
    updateAmbientButton();
    saveSettings();
    scheduleTempleBell(ambientEnabled);
    showToast(ambientEnabled ? '寺院鐘聲已開啟' : '寺院鐘聲已關閉');
  });
  ui.volume.addEventListener('input', () => {
    updateRangeLabels();
    if (masterGain && audioContext) masterGain.gain.setTargetAtTime(Number(ui.volume.value), audioContext.currentTime, 0.01);
  });
  ui.ambientVolume.addEventListener('input', () => {
    updateRangeLabels();
    if (ambientGain && audioContext) ambientGain.gain.setTargetAtTime(Number(ui.ambientVolume.value), audioContext.currentTime, 0.01);
  });
  ui.ambientVolume.addEventListener('change', saveSettings);
  [ui.speed, ui.tone, ui.volume, ui.goal].forEach((control) => {
    control.addEventListener('change', () => {
      saveSettings();
      updateGoal();
      startAutoIfNeeded();
      if (control === ui.tone || control === ui.volume) {
        playSound();
        showToast('聲音設定已更新');
      }
    });
  });
  document.querySelectorAll('input[name="mode"]').forEach((radio) => {
    radio.addEventListener('change', () => { saveSettings(); startAutoIfNeeded(); });
  });
  ui.closeModal.addEventListener('click', closeSummary);
  ui.modal.addEventListener('click', (event) => { if (event.target === ui.modal) closeSummary(); });
  $('resetBtn').addEventListener('click', () => {
    if (!confirm('確定要清除今日敲擊與單日最高紀錄嗎？')) return;
    pendingHits = 0;
    try { localStorage.removeItem(todayKey()); localStorage.removeItem('muyu-user-best'); } catch {}
    updateLocalStats();
    showToast('本機紀錄已清除');
  });
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) { clearInterval(autoTimer); clearInterval(bellTimer); flushProgress(); }
    else { startAutoIfNeeded(); scheduleTempleBell(false); }
  });
  window.addEventListener('pagehide', flushProgress);
  document.addEventListener('keydown', (event) => {
    if (event.code === 'Escape' && ui.modal.classList.contains('show')) { closeSummary(); return; }
    if (ui.modal.classList.contains('show') || ['INPUT', 'SELECT', 'BUTTON'].includes(event.target.tagName)) return;
    if (event.code === 'Space') { event.preventDefault(); if (!event.repeat) hitWoodfish(); }
    if (event.code === 'KeyS') { event.preventDefault(); running || paused ? endPractice() : startPractice(); }
    if (event.code === 'KeyP') { event.preventDefault(); togglePause(); }
  });

  loadSettings();
  scheduleTempleBell(false);
  updateLocalStats();
  renderBadges(true);
  updateGoal();
})();
