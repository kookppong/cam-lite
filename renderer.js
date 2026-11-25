/**
 * 수지캠 v0.1.3-test — 통합 렌더러
 * - [신규] H.264 MP4 자동 변환 (FFmpeg, 데스크톱 전용)
 * - [신규] 메모리 효율적 스트림 녹화 (임시 파일 직접 쓰기)
 * - [신규] 변환 진행률 오버레이 UI
 * - 타이틀바 화면내리기/종료 버튼 연동
 * - 다중/서브 모니터 영역 드래그 및 타겟 모니터 매칭
 * - 특정 프로그램 창 선택 녹화 모드 지원
 * - 백그라운드 절전 방지 및 최근 녹화 5개 목록
 */

const isElectron = typeof window !== 'undefined' && typeof window.process === 'object' && window.process.type;
let ipcRenderer = null;

if (isElectron) {
  try {
    ipcRenderer = require('electron').ipcRenderer;
    window.ipcRenderer = ipcRenderer;
  } catch (e) {
    console.warn('Electron IPC 로드 실패:', e);
  }
}

// ── 타이틀바 창 제어 ──
function minimizeApp() {
  if (ipcRenderer) {
    ipcRenderer.send('win-minimize');
  }
}

function closeApp() {
  if (ipcRenderer) {
    ipcRenderer.send('win-close');
  } else {
    window.close();
  }
}
window.minimizeApp = minimizeApp;
window.closeApp = closeApp;

// ── 녹화 모드 관리 ('screen' | 'area' | 'window') ──
let currentMode = 'screen';
let targetWindowSource = null;
let cropArea = null;

function setRecordMode(mode) {
  currentMode = mode;
  const btnScreen = document.getElementById('btnModeScreen');
  const btnArea = document.getElementById('btnModeArea');
  const btnWindow = document.getElementById('btnModeWindow');
  const badge = document.getElementById('targetModeBadge');
  const panelArea = document.getElementById('panelAreaInfo');
  const panelWindow = document.getElementById('panelWindowInfo');

  const defaultClass = 'py-2.5 px-2 rounded-xl text-xs font-bold bg-neutral-800 hover:bg-neutral-700 text-neutral-300 border border-neutral-700 transition cursor-pointer flex flex-col items-center space-y-1';
  const activeClass = 'py-2.5 px-2 rounded-xl text-xs font-bold bg-blue-700 hover:bg-blue-600 text-white border border-blue-500 shadow-md transition cursor-pointer flex flex-col items-center space-y-1';
  const activeWinClass = 'py-2.5 px-2 rounded-xl text-xs font-bold bg-purple-700 hover:bg-purple-600 text-white border border-purple-500 shadow-md transition cursor-pointer flex flex-col items-center space-y-1';

  btnScreen.className = defaultClass;
  btnArea.className = defaultClass;
  btnWindow.className = defaultClass;

  panelArea.classList.add('hidden');
  panelWindow.classList.add('hidden');

  if (mode === 'screen') {
    btnScreen.className = activeClass;
    badge.textContent = '전체 화면 모드';
    badge.className = 'text-xs px-2.5 py-0.5 rounded bg-blue-950 text-blue-300 border border-blue-800 font-medium';
    cropArea = null;
  } else if (mode === 'area') {
    btnArea.className = activeClass;
    badge.textContent = cropArea ? `영역: ${cropArea.w}×${cropArea.h}` : '영역 지정 모드';
    badge.className = 'text-xs px-2.5 py-0.5 rounded bg-blue-950 text-cyan-300 border border-blue-700 font-medium';
    panelArea.classList.remove('hidden');
  } else if (mode === 'window') {
    btnWindow.className = activeWinClass;
    badge.textContent = targetWindowSource ? `창: ${targetWindowSource.name.slice(0, 15)}...` : '창 선택 모드';
    badge.className = 'text-xs px-2.5 py-0.5 rounded bg-purple-950 text-purple-300 border border-purple-700 font-medium';
    panelWindow.classList.remove('hidden');
  }
}
window.setRecordMode = setRecordMode;

// ── 다중 모니터 영역 선택 수신 ──
if (isElectron && ipcRenderer) {
  ipcRenderer.on('area-result', (_e, area) => {
    cropArea = area;
    updateAreaUI();
    setRecordMode('area');
  });
}

function openAreaSelector() {
  if (isElectron && ipcRenderer) {
    ipcRenderer.invoke('open-area-selector');
  } else {
    alert(
      '[웹 브라우저 안내]\n\n' +
      '크롬/엣지 웹 브라우저는 보안 정책상 창 밖의 PC 전체 화면 드래그를 차단합니다.\n\n' +
      '서브 모니터 및 바탕화면 전체 영역 지정은 [설치형 .exe] 프로그램을 실행해 주세요!'
    );
  }
}

function resetArea() {
  cropArea = null;
  updateAreaUI();
}

function updateAreaUI() {
  const areaW = document.getElementById('areaW');
  const areaH = document.getElementById('areaH');
  const areaX = document.getElementById('areaX');
  const areaY = document.getElementById('areaY');
  const modeBadge = document.getElementById('areaModeBadge');

  if (!cropArea) {
    areaX.textContent = '-';
    areaY.textContent = '-';
    areaW.textContent = '전체';
    areaH.textContent = '전체';
    if (modeBadge) {
      modeBadge.textContent = '전체 화면';
      modeBadge.className = 'text-xs px-2 py-0.5 rounded bg-neutral-800 text-neutral-400 border border-neutral-700';
    }
  } else {
    areaX.textContent = cropArea.x;
    areaY.textContent = cropArea.y;
    areaW.textContent = cropArea.w;
    areaH.textContent = cropArea.h;
    if (modeBadge) {
      modeBadge.textContent = `${cropArea.displayName || '모니터'} (${cropArea.w}×${cropArea.h})`;
      modeBadge.className = 'text-xs px-2 py-0.5 rounded bg-blue-950 text-blue-300 border border-blue-700';
    }
  }
}

// ── 창 선택 모달 (프로그램 창 목록) ──
async function openWindowSelectModal() {
  const modal = document.getElementById('modalWindowSelect');
  const container = document.getElementById('windowListContainer');
  modal.classList.remove('hidden');
  container.innerHTML = '<div class="text-xs text-neutral-400 text-center py-8">열려 있는 프로그램 창을 검색하는 중...</div>';

  if (isElectron && ipcRenderer) {
    try {
      const windows = await ipcRenderer.invoke('get-window-sources');
      if (!windows || windows.length === 0) {
        container.innerHTML = '<div class="text-xs text-neutral-400 text-center py-8">선택 가능한 창이 없습니다.</div>';
        return;
      }

      container.innerHTML = '';
      windows.forEach(win => {
        const item = document.createElement('div');
        item.className = 'flex items-center space-x-3 p-2.5 rounded-xl bg-neutral-900/80 hover:bg-neutral-800 border border-neutral-800 hover:border-purple-500 cursor-pointer transition';
        item.onclick = () => selectTargetWindow(win);

        item.innerHTML = `
          <img src="${win.thumbnail}" class="w-20 h-12 object-cover rounded bg-black border border-neutral-700 flex-shrink-0" />
          <div class="flex-1 truncate text-left">
            <div class="text-xs font-bold text-white truncate">${win.name}</div>
          </div>
        `;
        container.appendChild(item);
      });
    } catch(err) {
      container.innerHTML = `<div class="text-xs text-red-400 text-center py-8">창 목록 로드 실패: ${err.message}</div>`;
    }
  } else {
    container.innerHTML = `
      <div class="bg-neutral-900 border border-neutral-800 rounded-xl p-4 text-center space-y-3">
        <div class="text-xs text-neutral-300 leading-relaxed">
          웹 브라우저에서는 [녹화 시작]을 누르면 뜨는 브라우저 화면 공유 창에서 <strong>[창] 탭</strong>을 선택하시면 특정 프로그램만 녹화할 수 있습니다.
        </div>
        <button onclick="closeWindowSelectModal()" class="px-4 py-2 bg-purple-700 text-white rounded-lg text-xs font-bold">확인</button>
      </div>
    `;
  }
}
window.openWindowSelectModal = openWindowSelectModal;

function closeWindowSelectModal() {
  document.getElementById('modalWindowSelect').classList.add('hidden');
}
window.closeWindowSelectModal = closeWindowSelectModal;

function selectTargetWindow(win) {
  targetWindowSource = win;
  document.getElementById('selectedWindowName').textContent = win.name;
  closeWindowSelectModal();
  setRecordMode('window');
}

// ── 타이머 ──
let recStart = 0, isRec = false, isPaused = false, pausedTotal = 0, pauseStart = 0, timerIntervalId = null;
const timerEl = document.getElementById('recTimer');

function startTimer() {
  recStart = performance.now(); pausedTotal = 0; isPaused = false;
  timerEl.className = 'digital text-5xl font-bold timer-on';
  
  timerIntervalId = setInterval(() => {
    if (!isRec) return;
    const now = performance.now();
    const ms = isPaused ? (pauseStart - recStart - pausedTotal) : (now - recStart - pausedTotal);
    const ts = Math.floor(ms / 1000);
    timerEl.textContent =
      pad(Math.floor(ts/3600)) + ':' + pad(Math.floor((ts%3600)/60)) + ':' +
      pad(ts%60) + '.' + pad3(Math.floor(ms%1000));
  }, 100);
}

function stopTimer() {
  if (timerIntervalId) clearInterval(timerIntervalId);
  const finalDuration = timerEl.textContent;
  timerEl.textContent = '00:00:00.000';
  timerEl.className = 'digital text-5xl font-bold timer-idle';
  return finalDuration;
}

const pad  = n => String(n).padStart(2,'0');
const pad3 = n => String(n).padStart(3,'0');

// ── 최근 녹화 목록 (최대 5개 관리) ──
let recordedItems = [];
let mediaRecorder = null, chunks = [], captureStream = null, cropStream = null, renderIntervalId = null;
let currentVideoDimensions = { width: 1920, height: 1080 };

// [데스크톱 전용] 임시 파일 녹화 변수
let tempWebmPath = null;
let tempWriteStream = null;
let writePromiseChain = Promise.resolve();
let ffmpegAvailable = false;

// ── FFmpeg 사용 가능 여부 확인 (앱 시작 시 1회) ──
async function checkFfmpeg() {
  if (isElectron && ipcRenderer) {
    try {
      ffmpegAvailable = await ipcRenderer.invoke('check-ffmpeg');
      console.log('FFmpeg 사용 가능:', ffmpegAvailable);
      // FFmpeg 상태 뱃지 업데이트
      const badge = document.getElementById('ffmpegBadge');
      if (badge) {
        if (ffmpegAvailable) {
          badge.textContent = 'MP4 (H.264)';
          badge.className = 'text-[10px] px-1.5 py-0.5 rounded bg-green-950 text-green-300 border border-green-800 font-semibold';
        } else {
          badge.textContent = 'WebM (원본)';
          badge.className = 'text-[10px] px-1.5 py-0.5 rounded bg-orange-950 text-orange-300 border border-orange-800 font-semibold';
        }
      }
    } catch(e) {
      ffmpegAvailable = false;
    }
  }
}

// ── FFmpeg 변환 진행률 수신 ──
if (isElectron && ipcRenderer) {
  ipcRenderer.on('ffmpeg-progress', (_e, percent) => {
    const bar = document.getElementById('convertProgress');
    const status = document.getElementById('convertStatus');
    if (bar) bar.style.width = `${Math.min(percent, 99)}%`;
    if (status) status.textContent = `H.264 MP4 변환 중... ${percent}%`;
  });
}

function showConvertingOverlay() {
  const overlay = document.getElementById('convertingOverlay');
  if (overlay) {
    overlay.classList.remove('hidden');
    const bar = document.getElementById('convertProgress');
    const status = document.getElementById('convertStatus');
    if (bar) bar.style.width = '0%';
    if (status) status.textContent = 'FFmpeg 변환 준비 중...';
  }
}

function hideConvertingOverlay() {
  const overlay = document.getElementById('convertingOverlay');
  if (overlay) overlay.classList.add('hidden');
}

// ══════════════════════════════════════════════════════
// ── 녹화 시작 / 종료 ──
// ══════════════════════════════════════════════════════

async function toggleRecord() {
  if (!isRec) await startRecord();
  else        stopRecord();
}

async function startRecord() {
  try {
    const fps = parseInt(document.getElementById('selFps').value) || 60;
    const sysSnd = document.getElementById('chkSys').checked;
    const micOn = document.getElementById('chkMic').checked;
    const rotateSetting = document.getElementById('selRotate').value;

    if (isElectron && ipcRenderer) {
      // 1. 녹화 타겟 소스 ID 결정
      let targetSourceId = null;

      if (currentMode === 'window' && targetWindowSource) {
        targetSourceId = targetWindowSource.id;
      } else {
        const screenSources = await ipcRenderer.invoke('get-screen-sources');
        if (cropArea && cropArea.displayId) {
          const matched = screenSources.find(s => s.display_id === cropArea.displayId);
          targetSourceId = matched ? matched.id : screenSources[0].id;
        } else {
          targetSourceId = screenSources[0].id;
        }
      }

      captureStream = await navigator.mediaDevices.getUserMedia({
        audio: sysSnd ? { mandatory: { chromeMediaSource: 'desktop' } } : false,
        video: {
          mandatory: {
            chromeMediaSource: 'desktop',
            chromeMediaSourceId: targetSourceId,
            maxFrameRate: fps
          }
        }
      });
    } else {
      // 일반 웹 브라우저
      captureStream = await navigator.mediaDevices.getDisplayMedia({
        video: { 
          frameRate: { ideal: fps, max: fps },
          displaySurface: currentMode === 'window' ? 'window' : 'monitor'
        },
        audio: sysSnd
      });
    }

    if (micOn) {
      try {
        const mic = await navigator.mediaDevices.getUserMedia({ audio: true });
        mic.getAudioTracks().forEach(t => captureStream.addTrack(t));
      } catch(e) { console.warn('마이크 접근 실패:', e); }
    }

    // 비디오 해상도 감지
    const videoTrack = captureStream.getVideoTracks()[0];
    const settings = videoTrack.getSettings ? videoTrack.getSettings() : {};
    const nativeW = settings.width || window.screen.width || 1920;
    const nativeH = settings.height || window.screen.height || 1080;
    const isTargetVertical = nativeH > nativeW;

    const orientBadge = document.getElementById('orientBadge');
    if (orientBadge) {
      orientBadge.textContent = isTargetVertical 
        ? `모니터 방향: 세로 (${nativeW}×${nativeH})` 
        : `모니터 방향: 가로 (${nativeW}×${nativeH})`;
      orientBadge.className = isTargetVertical
        ? 'text-xs px-2.5 py-0.5 rounded-full bg-cyan-950 text-cyan-300 border border-cyan-700 font-semibold'
        : 'text-xs px-2.5 py-0.5 rounded-full bg-neutral-900 text-neutral-400 border border-neutral-800 font-medium';
    }

    let angle = 0;
    if (rotateSetting !== 'auto') {
      angle = parseInt(rotateSetting, 10) || 0;
    }

    let recordStream = captureStream;

    // 영역 크롭 또는 회전이 필요한 경우 캔버스 처리
    if ((currentMode === 'area' && cropArea) || angle !== 0) {
      const srcVideo = document.createElement('video');
      srcVideo.srcObject = captureStream;
      srcVideo.muted = true;
      srcVideo.playsInline = true;

      await new Promise((resolve) => {
        if (srcVideo.videoWidth > 0 && srcVideo.videoHeight > 0) return resolve();
        srcVideo.onloadedmetadata = () => {
          srcVideo.play().then(resolve).catch(resolve);
        };
        srcVideo.play().catch(() => {});
        setTimeout(resolve, 600);
      });

      const srcW = srcVideo.videoWidth || nativeW;
      const srcH = srcVideo.videoHeight || nativeH;
      const cropX = cropArea ? cropArea.x : 0;
      const cropY = cropArea ? cropArea.y : 0;
      const cropW = cropArea ? cropArea.w : srcW;
      const cropH = cropArea ? cropArea.h : srcH;

      const cropCanvas = document.createElement('canvas');
      const is90or270 = (angle === 90 || angle === 270);
      cropCanvas.width = is90or270 ? cropH : cropW;
      cropCanvas.height = is90or270 ? cropW : cropH;
      currentVideoDimensions = { width: cropCanvas.width, height: cropCanvas.height };

      const cctx = cropCanvas.getContext('2d');

      function drawFrame() {
        if (!isRec) return;
        cctx.save();
        cctx.clearRect(0, 0, cropCanvas.width, cropCanvas.height);

        if (angle === 90) {
          cctx.translate(cropCanvas.width, 0);
          cctx.rotate((90 * Math.PI) / 180);
          cctx.drawImage(srcVideo, cropX, cropY, cropW, cropH, 0, 0, cropW, cropH);
        } else if (angle === 180) {
          cctx.translate(cropCanvas.width, cropCanvas.height);
          cctx.rotate((180 * Math.PI) / 180);
          cctx.drawImage(srcVideo, cropX, cropY, cropW, cropH, 0, 0, cropW, cropH);
        } else if (angle === 270) {
          cctx.translate(0, cropCanvas.height);
          cctx.rotate((270 * Math.PI) / 180);
          cctx.drawImage(srcVideo, cropX, cropY, cropW, cropH, 0, 0, cropW, cropH);
        } else {
          cctx.drawImage(srcVideo, cropX, cropY, cropW, cropH, 0, 0, cropW, cropH);
        }
        cctx.restore();
      }

      const frameIntervalMs = Math.floor(1000 / fps);
      renderIntervalId = setInterval(drawFrame, frameIntervalMs);

      cropStream = cropCanvas.captureStream(fps);
      captureStream.getAudioTracks().forEach(t => cropStream.addTrack(t));
      recordStream = cropStream;
    } else {
      currentVideoDimensions = { width: nativeW, height: nativeH };
    }

    // ── [데스크톱] 임시 파일 WriteStream 생성 ──
    if (isElectron) {
      try {
        const os = require('os');
        const pathMod = require('path');
        const fsMod = require('fs');
        tempWebmPath = pathMod.join(os.tmpdir(), `suzicam_raw_${Date.now()}.webm`);
        tempWriteStream = fsMod.createWriteStream(tempWebmPath);
        writePromiseChain = Promise.resolve();
        console.log('임시 녹화 파일:', tempWebmPath);
      } catch(e) {
        console.warn('임시 파일 생성 실패, 메모리 모드:', e);
        tempWebmPath = null;
        tempWriteStream = null;
      }
    }

    chunks = [];

    // 코덱 선택 (VP9 우선, FFmpeg가 최종 변환 담당)
    const mimes = [
      'video/webm;codecs=vp9,opus',
      'video/webm;codecs=vp8,opus',
      'video/webm',
      'video/mp4'
    ];
    const mime = mimes.find(m => MediaRecorder.isTypeSupported(m)) || '';

    const recorderOptions = {
      mimeType: mime,
      videoBitsPerSecond: 8_000_000
    };

    mediaRecorder = new MediaRecorder(recordStream, mime ? recorderOptions : {});

    mediaRecorder.ondataavailable = (e) => {
      if (e.data?.size > 0) {
        if (isElectron && tempWriteStream) {
          // 데스크톱: 임시 파일에 직접 스트리밍 (메모리 절약)
          writePromiseChain = writePromiseChain.then(async () => {
            try {
              const arrayBuf = await e.data.arrayBuffer();
              tempWriteStream.write(Buffer.from(arrayBuf));
            } catch(err) {
              console.warn('청크 파일 쓰기 오류:', err);
            }
          });
        } else {
          // 웹 브라우저: 메모리에 축적
          chunks.push(e.data);
        }
      }
    };

    mediaRecorder.onstop = onRecordStop;
    mediaRecorder.start(500);

    captureStream.getVideoTracks()[0].onended = () => { if (isRec) stopRecord(); };

    isRec = true;
    startTimer();
    setUI(true);

  } catch(err) {
    if (err.name !== 'NotAllowedError') {
      alert('녹화 시작 오류: ' + err.message);
    }
    setUI(false);
  }
}

function stopRecord() {
  mediaRecorder?.state !== 'inactive' && mediaRecorder.stop();
  isRec = false;
  if (renderIntervalId) clearInterval(renderIntervalId);
  captureStream?.getTracks().forEach(t => t.stop());
  const finalDuration = stopTimer();
  setUI(false);
}

// ══════════════════════════════════════════════════════
// ── 녹화 종료 후처리 (MP4 변환 / WebM 대체) ──
// ══════════════════════════════════════════════════════

async function onRecordStop() {
  const durationMs = Math.max(100, Math.floor(performance.now() - recStart - pausedTotal));

  if (isElectron && ipcRenderer && tempWebmPath) {
    // ══ 데스크톱: FFmpeg H.264 MP4 변환 파이프라인 ══

    // 1. 모든 비동기 청크 쓰기 완료 대기
    await writePromiseChain;
    if (tempWriteStream) {
      tempWriteStream.end();
      await new Promise(resolve => tempWriteStream.on('finish', resolve));
      tempWriteStream = null;
    }

    const fsMod = require('fs');
    const tempMp4Path = tempWebmPath.replace('.webm', '.mp4');

    if (ffmpegAvailable) {
      // 2. 변환 오버레이 UI 표시
      showConvertingOverlay();

      try {
        // 3. FFmpeg 변환 실행 (WebM → H.264 MP4)
        await ipcRenderer.invoke('convert-to-mp4', {
          inputPath: tempWebmPath,
          outputPath: tempMp4Path,
          durationMs: durationMs
        });

        // 4. 변환 완료 → MP4 파일을 Blob URL로 로드
        const fileSize = fsMod.statSync(tempMp4Path).size;
        console.log(`MP4 변환 완료: ${(fileSize / 1024 / 1024).toFixed(1)} MB`);

        const mp4Buffer = fsMod.readFileSync(tempMp4Path);
        const mp4Blob = new Blob([mp4Buffer], { type: 'video/mp4' });
        const url = URL.createObjectURL(mp4Blob);

        addRecordingItem(mp4Blob, url, 'mp4');

        // 5. 임시 파일 정리
        try { fsMod.unlinkSync(tempWebmPath); } catch(e) {}
        try { fsMod.unlinkSync(tempMp4Path); } catch(e) {}

      } catch(err) {
        console.error('MP4 변환 실패:', err);
        // WebM 대체 로드
        fallbackToWebm(fsMod, durationMs);
      }

      hideConvertingOverlay();

    } else {
      // FFmpeg 없음 → WebM 직접 사용 (fix-webm-duration 적용)
      console.warn('FFmpeg 미설치, WebM 원본으로 대체');
      fallbackToWebm(fsMod, durationMs);
    }

    tempWebmPath = null;

  } else {
    // ══ 웹 브라우저: WebM + Duration Fix ══
    const rawBlob = new Blob(chunks, { type: 'video/webm' });

    let finalBlob = rawBlob;
    const fixFn = (typeof ysFixWebmDuration === 'function')
      ? ysFixWebmDuration
      : ((typeof window !== 'undefined' && typeof window.ysFixWebmDuration === 'function') ? window.ysFixWebmDuration : null);

    if (fixFn) {
      try {
        finalBlob = await fixFn(rawBlob, durationMs);
      } catch(err) {
        console.warn('WebM Duration fix 오류:', err);
        finalBlob = rawBlob;
      }
    }

    const url = URL.createObjectURL(finalBlob);
    addRecordingItem(finalBlob, url, 'webm');
  }
}

// WebM 대체 로드 (FFmpeg 실패 또는 미설치 시)
async function fallbackToWebm(fsMod, durationMs) {
  try {
    if (tempWebmPath && fsMod.existsSync(tempWebmPath)) {
      const webmBuffer = fsMod.readFileSync(tempWebmPath);
      let webmBlob = new Blob([webmBuffer], { type: 'video/webm' });

      // fix-webm-duration 적용 시도
      const fixFn = (typeof ysFixWebmDuration === 'function')
        ? ysFixWebmDuration
        : ((typeof window !== 'undefined' && typeof window.ysFixWebmDuration === 'function') ? window.ysFixWebmDuration : null);

      if (fixFn && durationMs > 0) {
        try {
          webmBlob = await fixFn(webmBlob, durationMs);
        } catch(e) {
          console.warn('WebM fix 대체 적용 실패:', e);
        }
      }

      const url = URL.createObjectURL(webmBlob);
      addRecordingItem(webmBlob, url, 'webm');
      try { fsMod.unlinkSync(tempWebmPath); } catch(e) {}
    }
  } catch(e) {
    console.error('WebM 대체 로드 실패:', e);
  }
}

// ── 녹화 아이템 추가 ──
function addRecordingItem(blob, url, format) {
  const now = new Date();
  const timeStr = `${now.getFullYear()}-${pad(now.getMonth()+1)}-${pad(now.getDate())} ${pad(now.getHours())}:${pad(now.getMinutes())}:${pad(now.getSeconds())}`;

  const sizeMB = (blob.size / 1024 / 1024).toFixed(1);

  const newItem = {
    id: Date.now(),
    blob: blob,
    url: url,
    format: format || 'webm',
    sizeMB: sizeMB,
    duration: timerEl.textContent !== '00:00:00.000' ? timerEl.textContent : '완료',
    timestamp: timeStr,
    width: currentVideoDimensions.width,
    height: currentVideoDimensions.height,
    rotation: 0
  };

  if (recordedItems.length >= 5) {
    const oldest = recordedItems.pop();
    if (oldest && oldest.url) URL.revokeObjectURL(oldest.url);
  }
  recordedItems.unshift(newItem);

  renderRecordingsList();
}

// ── 녹화 목록 렌더링 ──
function renderRecordingsList() {
  const section = document.getElementById('recordingsSection');
  const listEl = document.getElementById('recordingsList');
  const countBadge = document.getElementById('recCountBadge');

  if (recordedItems.length === 0) {
    section.classList.add('hidden');
    listEl.innerHTML = '';
    return;
  }

  section.classList.remove('hidden');
  countBadge.textContent = `${recordedItems.length} / 5`;
  listEl.innerHTML = '';

  recordedItems.forEach((item, index) => {
    const isVert = item.height > item.width;
    const isMp4 = item.format === 'mp4';
    const card = document.createElement('div');
    card.className = 'bg-[#12131a] border border-[#2b2d3a] rounded-xl p-3 space-y-2.5 shadow-md';
    card.id = `rec-card-${item.id}`;

    card.innerHTML = `
      <div class="flex items-center justify-between border-b border-neutral-800/80 pb-2">
        <div class="flex items-center space-x-2 flex-wrap gap-y-1">
          <span class="text-xs font-bold text-red-400">#${recordedItems.length - index}</span>
          <span class="text-[11px] text-neutral-400">${item.timestamp}</span>
          <span class="text-[10px] px-1.5 py-0.5 rounded font-mono ${isVert ? 'bg-cyan-950 text-cyan-300 border border-cyan-800' : 'bg-neutral-800 text-neutral-300 border border-neutral-700'}">
            ${isVert ? '세로' : '가로'} (${item.width}×${item.height})
          </span>
          <span class="text-[10px] px-1.5 py-0.5 rounded font-bold ${isMp4 ? 'bg-green-950 text-green-300 border border-green-800' : 'bg-orange-950 text-orange-300 border border-orange-800'}">
            ${(item.format || 'webm').toUpperCase()}
          </span>
          <span class="text-[10px] px-1.5 py-0.5 rounded bg-neutral-800 text-neutral-400 border border-neutral-700 font-mono">
            ${item.sizeMB} MB
          </span>
        </div>
        <button onclick="deleteRecording(${item.id})" 
          class="w-6 h-6 rounded-full hover:bg-red-950 text-neutral-400 hover:text-red-400 text-xs flex items-center justify-center transition cursor-pointer flex-shrink-0" title="이 녹화본 삭제">
          ✕
        </button>
      </div>

      <div class="flex justify-center bg-black/90 rounded-lg p-1.5 overflow-hidden min-h-[140px] items-center" id="preview-wrapper-${item.id}">
        <video id="video-player-${item.id}" src="${item.url}" controls 
          class="rounded max-h-48 max-w-full transition-transform duration-300 origin-center"
          style="transform: rotate(${item.rotation}deg);">
        </video>
      </div>

      <div class="flex items-center justify-between pt-1 text-xs">
        <button onclick="rotateRecording(${item.id})" 
          class="px-2.5 py-1.5 rounded-lg font-medium bg-neutral-800 hover:bg-neutral-700 text-cyan-300 border border-neutral-700 transition flex items-center space-x-1.5 cursor-pointer">
          <span>🔄</span>
          <span id="rotate-label-${item.id}">90° 회전 (${item.rotation}°)</span>
        </button>

        <a id="download-link-${item.id}" href="${item.url}" download="SuziCam_${item.timestamp.replace(/[: -]/g,'_')}.${item.format || 'webm'}"
          class="px-3.5 py-1.5 rounded-lg font-bold bg-green-700 hover:bg-green-600 text-white transition flex items-center space-x-1 shadow">
          <span>💾 다운로드 (.${item.format || 'webm'})</span>
        </a>
      </div>
    `;

    listEl.appendChild(card);
  });
}

function deleteRecording(id) {
  const idx = recordedItems.findIndex(item => item.id === id);
  if (idx !== -1) {
    const item = recordedItems[idx];
    if (item.url) URL.revokeObjectURL(item.url);
    recordedItems.splice(idx, 1);
    renderRecordingsList();
  }
}

function clearAllRecordings() {
  if (recordedItems.length === 0) return;
  if (!confirm('녹화된 모든 영상을 목록에서 지우시겠습니까?')) return;
  recordedItems.forEach(item => {
    if (item.url) URL.revokeObjectURL(item.url);
  });
  recordedItems = [];
  renderRecordingsList();
}

function rotateRecording(id) {
  const item = recordedItems.find(it => it.id === id);
  if (!item) return;

  item.rotation = (item.rotation + 90) % 360;

  const player = document.getElementById(`video-player-${id}`);
  const label = document.getElementById(`rotate-label-${id}`);
  const wrapper = document.getElementById(`preview-wrapper-${id}`);

  if (player) {
    player.style.transform = `rotate(${item.rotation}deg)`;
    if (item.rotation === 90 || item.rotation === 270) {
      wrapper.style.minHeight = '240px';
      player.style.maxHeight = '220px';
    } else {
      wrapper.style.minHeight = '140px';
      player.style.maxHeight = '180px';
    }
  }

  if (label) {
    label.textContent = `90° 회전 (${item.rotation}°)`;
  }
}

function togglePause() {
  if (!mediaRecorder || !isRec) return;
  const p = document.getElementById('btnPause');
  const sb = document.getElementById('statusBadge');
  if (mediaRecorder.state === 'recording') {
    mediaRecorder.pause(); isPaused = true; pauseStart = performance.now();
    p.textContent = '▶';
    p.className = 'px-5 py-3.5 rounded-xl font-bold text-sm bg-yellow-600 hover:bg-yellow-700 text-white cursor-pointer transition';
    sb.textContent = '일시 정지';
    sb.className = 'text-xs px-3 py-0.5 rounded-full bg-yellow-950 text-yellow-300 border border-yellow-700 font-semibold';
  } else if (mediaRecorder.state === 'paused') {
    mediaRecorder.resume(); isPaused = false; pausedTotal += performance.now() - pauseStart;
    p.textContent = '❚❚';
    p.className = 'px-5 py-3.5 rounded-xl font-bold text-sm bg-neutral-700 hover:bg-neutral-600 text-white cursor-pointer transition';
    sb.textContent = '녹화 중';
    sb.className = 'text-xs px-3 py-1 rounded-full bg-red-950 text-red-300 border border-red-700 font-semibold rec-dot';
  }
}

function setUI(recording) {
  const btn = document.getElementById('btnRec');
  const p = document.getElementById('btnPause');
  const sb = document.getElementById('statusBadge');
  const dot = document.getElementById('recDot');
  if (recording) {
    btn.innerHTML = '<span class="w-3.5 h-3.5 rounded-sm bg-white inline-block"></span><span>녹화 정지</span>';
    btn.className = 'flex-1 py-3.5 rounded-xl font-extrabold text-sm bg-neutral-800 border border-red-500 text-red-400 transition flex items-center justify-center space-x-2 cursor-pointer';
    btn.style.boxShadow = '';
    p.disabled = false;
    p.className = 'px-5 py-3.5 rounded-xl font-bold text-sm bg-neutral-700 hover:bg-neutral-600 text-white cursor-pointer transition';
    sb.textContent = '녹화 중';
    sb.className = 'text-xs px-3 py-1 rounded-full bg-red-950 text-red-300 border border-red-700 font-semibold';
    dot.style.animation = '';
    dot.className = 'w-3 h-3 rounded-full bg-red-500 rec-dot';
  } else {
    btn.innerHTML = '<span class="w-3.5 h-3.5 rounded-full bg-white inline-block"></span><span>녹화 시작</span>';
    btn.className = 'flex-1 py-3.5 rounded-xl font-extrabold text-base bg-red-600 hover:bg-red-700 text-white transition flex items-center justify-center space-x-2 cursor-pointer';
    btn.style.boxShadow = '0 4px 15px rgba(255,0,0,0.4)';
    p.disabled = true; p.textContent = '❚❚';
    p.className = 'px-5 py-3.5 rounded-xl font-bold text-sm bg-neutral-800 text-neutral-500 cursor-not-allowed transition';
    sb.textContent = '대기 중';
    sb.className = 'text-xs px-3 py-1 rounded-full bg-neutral-900 text-neutral-500 border border-neutral-800 font-semibold';
    dot.className = 'w-3 h-3 rounded-full bg-red-600';
    dot.style.animation = 'none';
  }
}

document.addEventListener('DOMContentLoaded', () => {
  setRecordMode('screen');
  checkFfmpeg();
});
