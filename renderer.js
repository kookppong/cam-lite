/**
 * 수지캠 v0.1.0-test — 통합 렌더러
 * - 최근 녹화 목록 최대 5개 유지 및 [✕] 개별 삭제 기능
 * - 세로 모드(피벗) 화면 실시간 자동 감지 및 비율 보존
 * - 녹화 시 0/90/180/270도 회전 인코딩
 * - 녹화 완료 후 미리보기 화면 90도 회전 및 회전 적용 다운로드
 */

const isElectron = typeof window !== 'undefined' && typeof window.process === 'object' && window.process.type;
let ipcRenderer = null;

if (isElectron) {
  try {
    ipcRenderer = require('electron').ipcRenderer;
  } catch (e) {
    console.warn('Electron IPC 로드 실패:', e);
  }
}

// ── 최근 녹화 목록 (최대 5개 관리) ──
let recordedItems = []; // { id, blob, url, duration, timestamp, width, height, rotation }

// ── 영역 정보 ──
let cropArea = null; // null = 전체 화면

if (isElectron && ipcRenderer) {
  ipcRenderer.on('area-result', (_e, area) => {
    cropArea = area;
    updateAreaUI();
    document.getElementById('btnArea').textContent = '🖱️ 영역 재설정';
  });
}

function openAreaSelector() {
  if (isElectron && ipcRenderer) {
    ipcRenderer.invoke('open-area-selector');
  } else {
    alert(
      '[웹 브라우저 안내]\n\n' +
      '크롬/엣지 웹 브라우저는 보안 정책상 창 밖의 PC 전체 화면 드래그를 차단합니다.\n\n' +
      '바탕화면 전체 자유 영역 지정은 상단의 [설치형 .exe] 프로그램을 실행해 주세요!'
    );
  }
}

function resetArea() {
  cropArea = null;
  updateAreaUI();
  document.getElementById('btnArea').textContent = '🖱️ 화면에서 영역 직접 설정';
}

function updateAreaUI() {
  if (!cropArea) {
    document.getElementById('areaX').textContent = '-';
    document.getElementById('areaY').textContent = '-';
    document.getElementById('areaW').textContent = '전체';
    document.getElementById('areaH').textContent = '전체';
    document.getElementById('areaModeBadge').textContent = '전체 화면';
    document.getElementById('areaModeBadge').className =
      'text-xs px-2 py-0.5 rounded bg-neutral-800 text-neutral-400 border border-neutral-700';
  } else {
    document.getElementById('areaX').textContent = cropArea.x;
    document.getElementById('areaY').textContent = cropArea.y;
    document.getElementById('areaW').textContent = cropArea.w;
    document.getElementById('areaH').textContent = cropArea.h;
    const isVert = cropArea.h > cropArea.w;
    document.getElementById('areaModeBadge').textContent = `${cropArea.w} × ${cropArea.h} (${isVert ? '세로' : '가로'})`;
    document.getElementById('areaModeBadge').className =
      'text-xs px-2 py-0.5 rounded bg-blue-950 text-blue-300 border border-blue-700';
  }
}

// ── 타이머 ──
let recStart = 0, isRec = false, isPaused = false, pausedTotal = 0, pauseStart = 0, rafId = null;
const timerEl = document.getElementById('recTimer');

function startTimer() {
  recStart = performance.now(); pausedTotal = 0; isPaused = false;
  timerEl.className = 'digital text-5xl font-bold timer-on';
  function tick() {
    if (!isRec) return;
    const now = performance.now();
    const ms = isPaused ? (pauseStart - recStart - pausedTotal) : (now - recStart - pausedTotal);
    const ts = Math.floor(ms / 1000);
    timerEl.textContent =
      pad(Math.floor(ts/3600)) + ':' + pad(Math.floor((ts%3600)/60)) + ':' +
      pad(ts%60) + '.' + pad3(Math.floor(ms%1000));
    rafId = requestAnimationFrame(tick);
  }
  rafId = requestAnimationFrame(tick);
}

function stopTimer() {
  if (rafId) cancelAnimationFrame(rafId);
  const finalDuration = timerEl.textContent;
  timerEl.textContent = '00:00:00.000';
  timerEl.className = 'digital text-5xl font-bold timer-idle';
  return finalDuration;
}

const pad  = n => String(n).padStart(2,'0');
const pad3 = n => String(n).padStart(3,'0');

// ── 녹화 엔진 ──
let mediaRecorder = null, chunks = [], captureStream = null, cropStream = null, cropRaf = null;
let currentRecStartTime = '';
let currentVideoDimensions = { width: 1920, height: 1080 };

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
      const sources = await ipcRenderer.invoke('get-screen-sources');
      const src = sources[0];

      captureStream = await navigator.mediaDevices.getUserMedia({
        audio: sysSnd ? { mandatory: { chromeMediaSource: 'desktop' } } : false,
        video: {
          mandatory: {
            chromeMediaSource: 'desktop',
            chromeMediaSourceId: src.id,
            maxFrameRate: fps
          }
        }
      });
    } else {
      captureStream = await navigator.mediaDevices.getDisplayMedia({
        video: { frameRate: { ideal: fps, max: fps } },
        audio: sysSnd
      });
    }

    if (micOn) {
      try {
        const mic = await navigator.mediaDevices.getUserMedia({ audio: true });
        mic.getAudioTracks().forEach(t => captureStream.addTrack(t));
      } catch(e) { console.warn('마이크 접근 실패:', e); }
    }

    // 비디오 메타데이터 로드 대기 (실제 해상도 측정)
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
      setTimeout(resolve, 800);
    });

    const nativeW = srcVideo.videoWidth || window.screen.width || 1920;
    const nativeH = srcVideo.videoHeight || window.screen.height || 1080;
    const isTargetVertical = nativeH > nativeW;

    // 모니터 방향 뱃지 갱신
    const orientBadge = document.getElementById('orientBadge');
    if (orientBadge) {
      orientBadge.textContent = isTargetVertical 
        ? `모니터 방향: 세로 (${nativeW}×${nativeH})` 
        : `모니터 방향: 가로 (${nativeW}×${nativeH})`;
      orientBadge.className = isTargetVertical
        ? 'text-xs px-2.5 py-0.5 rounded-full bg-cyan-950 text-cyan-300 border border-cyan-700 font-semibold'
        : 'text-xs px-2.5 py-0.5 rounded-full bg-neutral-900 text-neutral-400 border border-neutral-800 font-medium';
    }

    // 회전 각도 계산
    let angle = 0;
    if (rotateSetting === 'auto') {
      angle = 0; // 세로면 세로 비율 그대로 보존
    } else {
      angle = parseInt(rotateSetting, 10) || 0;
    }

    let recordStream = captureStream;

    // 영역 크롭 또는 회전 변환 처리 (세로모드 포함)
    const cropX = cropArea ? cropArea.x : 0;
    const cropY = cropArea ? cropArea.y : 0;
    const cropW = cropArea ? cropArea.w : nativeW;
    const cropH = cropArea ? cropArea.h : nativeH;

    // 캔버스 인코더 구성
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
      cropRaf = requestAnimationFrame(drawFrame);
    }
    cropRaf = requestAnimationFrame(drawFrame);

    cropStream = cropCanvas.captureStream(fps);
    captureStream.getAudioTracks().forEach(t => cropStream.addTrack(t));
    recordStream = cropStream;

    chunks = [];
    currentRecStartTime = new Date().toLocaleTimeString();

    const mimes = ['video/webm;codecs=vp9,opus','video/webm;codecs=vp8,opus','video/webm','video/mp4'];
    const mime = mimes.find(m => MediaRecorder.isTypeSupported(m)) || '';
    mediaRecorder = new MediaRecorder(recordStream, mime ? { mimeType: mime } : {});
    mediaRecorder.ondataavailable = e => { if (e.data?.size > 0) chunks.push(e.data); };
    mediaRecorder.onstop = onRecordStop;
    mediaRecorder.start(200);

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
  if (cropRaf) cancelAnimationFrame(cropRaf);
  captureStream?.getTracks().forEach(t => t.stop());
  const finalDuration = stopTimer();
  setUI(false);
}

function onRecordStop() {
  const blob = new Blob(chunks, { type: 'video/webm' });
  const url = URL.createObjectURL(blob);
  const now = new Date();
  const timeStr = `${now.getFullYear()}-${pad(now.getMonth()+1)}-${pad(now.getDate())} ${pad(now.getHours())}:${pad(now.getMinutes())}:${pad(now.getSeconds())}`;

  // 새 녹화본 생성 (목록 최상단 추가)
  const newItem = {
    id: Date.now(),
    blob: blob,
    url: url,
    duration: timerEl.textContent !== '00:00:00.000' ? timerEl.textContent : '완료',
    timestamp: timeStr,
    width: currentVideoDimensions.width,
    height: currentVideoDimensions.height,
    rotation: 0
  };

  // 최대 5개 유지 (초과 시 가장 오래된 것 삭제 및 메모리 해제)
  if (recordedItems.length >= 5) {
    const oldest = recordedItems.pop();
    if (oldest && oldest.url) URL.revokeObjectURL(oldest.url);
  }
  recordedItems.unshift(newItem);

  renderRecordingsList();
}

// ── 녹화 목록 렌더링 (최대 5개, 개별 [X] 삭제) ──
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
    const card = document.createElement('div');
    card.className = 'bg-[#12131a] border border-[#2b2d3a] rounded-xl p-3 space-y-2.5 shadow-md';
    card.id = `rec-card-${item.id}`;

    card.innerHTML = `
      <!-- 헤더 (녹화 정보 및 X 닫기 버튼) -->
      <div class="flex items-center justify-between border-b border-neutral-800/80 pb-2">
        <div class="flex items-center space-x-2">
          <span class="text-xs font-bold text-red-400">#${recordedItems.length - index}</span>
          <span class="text-[11px] text-neutral-400">${item.timestamp}</span>
          <span class="text-[10px] px-1.5 py-0.5 rounded font-mono ${isVert ? 'bg-cyan-950 text-cyan-300 border border-cyan-800' : 'bg-neutral-800 text-neutral-300 border border-neutral-700'}">
            ${isVert ? '세로' : '가로'} (${item.width}×${item.height})
          </span>
        </div>
        <button onclick="deleteRecording(${item.id})" 
          class="w-6 h-6 rounded-full hover:bg-red-950 text-neutral-400 hover:text-red-400 text-xs flex items-center justify-center transition cursor-pointer" title="이 녹화본 삭제">
          ✕
        </button>
      </div>

      <!-- 비디오 미리보기 컨테이너 (회전 시 안 잘리도록 동적 여백 계산) -->
      <div class="flex justify-center bg-black/90 rounded-lg p-1.5 overflow-hidden min-h-[140px] items-center" id="preview-wrapper-${item.id}">
        <video id="video-player-${item.id}" src="${item.url}" controls 
          class="rounded max-h-48 max-w-full transition-transform duration-300 origin-center"
          style="transform: rotate(${item.rotation}deg);">
        </video>
      </div>

      <!-- 하단 액션 버튼들 (90도 회전, 다운로드) -->
      <div class="flex items-center justify-between pt-1 text-xs">
        <button onclick="rotateRecording(${item.id})" 
          class="px-2.5 py-1.5 rounded-lg font-medium bg-neutral-800 hover:bg-neutral-700 text-cyan-300 border border-neutral-700 transition flex items-center space-x-1.5 cursor-pointer">
          <span>🔄</span>
          <span id="rotate-label-${item.id}">90° 회전 (${item.rotation}°)</span>
        </button>

        <div class="flex items-center space-x-2">
          <a id="download-link-${item.id}" href="${item.url}" download="SuziCam_${item.timestamp.replace(/[: -]/g,'_')}.webm"
            class="px-3.5 py-1.5 rounded-lg font-bold bg-green-700 hover:bg-green-600 text-white transition flex items-center space-x-1 shadow">
            <span>💾 다운로드</span>
          </a>
        </div>
      </div>
    `;

    listEl.appendChild(card);
  });
}

// ── 녹화본 개별 [✕] 삭제 ──
function deleteRecording(id) {
  const idx = recordedItems.findIndex(item => item.id === id);
  if (idx !== -1) {
    const item = recordedItems[idx];
    if (item.url) URL.revokeObjectURL(item.url);
    recordedItems.splice(idx, 1);
    renderRecordingsList();
  }
}

// ── 전체 비우기 ──
function clearAllRecordings() {
  if (recordedItems.length === 0) return;
  if (!confirm('녹화된 모든 영상을 목록에서 지우시겠습니까?')) return;
  recordedItems.forEach(item => {
    if (item.url) URL.revokeObjectURL(item.url);
  });
  recordedItems = [];
  renderRecordingsList();
}

// ── 결과물 화면 90°씩 돌리기 ──
function rotateRecording(id) {
  const item = recordedItems.find(it => it.id === id);
  if (!item) return;

  item.rotation = (item.rotation + 90) % 360;

  const player = document.getElementById(`video-player-${id}`);
  const label = document.getElementById(`rotate-label-${id}`);
  const wrapper = document.getElementById(`preview-wrapper-${id}`);

  if (player) {
    player.style.transform = `rotate(${item.rotation}deg)`;
    // 90도나 270도 회전 시 세로 높이 공간 확보
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
    sb.className = 'text-xs px-3 py-0.5 rounded-full bg-red-950 text-red-300 border border-red-700 font-semibold rec-dot';
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
    sb.className = 'text-xs px-3 py-0.5 rounded-full bg-red-950 text-red-300 border border-red-700 font-semibold';
    dot.style.animation = '';
    dot.className = 'w-3 h-3 rounded-full bg-red-500 rec-dot';
  } else {
    btn.innerHTML = '<span class="w-3.5 h-3.5 rounded-full bg-white inline-block"></span><span>녹화 시작</span>';
    btn.className = 'flex-1 py-3.5 rounded-xl font-extrabold text-sm bg-red-600 hover:bg-red-700 text-white transition flex items-center justify-center space-x-2 cursor-pointer';
    btn.style.boxShadow = '0 4px 15px rgba(255,0,0,0.4)';
    p.disabled = true; p.textContent = '❚❚';
    p.className = 'px-5 py-3.5 rounded-xl font-bold text-sm bg-neutral-800 text-neutral-500 cursor-not-allowed transition';
    sb.textContent = '대기 중';
    sb.className = 'text-xs px-3 py-0.5 rounded-full bg-neutral-900 text-neutral-500 border border-neutral-800 font-semibold';
    dot.className = 'w-3 h-3 rounded-full bg-red-600';
    dot.style.animation = 'none';
  }
}
