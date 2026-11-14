/**
 * 수지캠 v0.1.0-test — 통합 렌더러
 * - 세로 모드(피벗 모니터) 자동 감지
 * - 녹화 시 화면 회전 변환 (0°, 90°, 180°, 270°)
 * - 결과물 미리보기 회전 및 회전된 비디오 다운로드 지원
 * - Electron 데스크톱 & 웹 브라우저 공용 하이브리드
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

// ── 환경 및 모니터 방향 초기 감지 ──
document.addEventListener('DOMContentLoaded', () => {
  checkScreenOrientation();
  window.addEventListener('resize', checkScreenOrientation);
});

function checkScreenOrientation() {
  const isVertical = window.screen.height > window.screen.width;
  const orientBadge = document.getElementById('orientBadge');
  if (orientBadge) {
    orientBadge.textContent = isVertical ? '모니터 방향: 세로 (피벗)' : '모니터 방향: 가로';
    orientBadge.className = isVertical 
      ? 'text-xs px-2.5 py-0.5 rounded-full bg-cyan-950 text-cyan-300 border border-cyan-700 font-semibold'
      : 'text-xs px-2.5 py-0.5 rounded-full bg-neutral-900 text-neutral-400 border border-neutral-800 font-medium';
  }
}

function onRotateSettingChange() {
  const val = document.getElementById('selRotate').value;
  console.log('선택된 화면 회전 옵션:', val);
}

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
  timerEl.textContent = '00:00:00.000';
  timerEl.className = 'digital text-5xl font-bold timer-idle';
}

const pad  = n => String(n).padStart(2,'0');
const pad3 = n => String(n).padStart(3,'0');

// ── 녹화 엔진 (세로모드 & 회전 지원) ──
let mediaRecorder = null, chunks = [], captureStream = null, cropStream = null, cropRaf = null;
let lastRecordedBlob = null;
let previewRotationAngle = 0;

async function toggleRecord() {
  if (!isRec) await startRecord();
  else        stopRecord();
}

async function startRecord() {
  try {
    const fps    = parseInt(document.getElementById('selFps').value) || 60;
    const sysSnd = document.getElementById('chkSys').checked;
    const micOn  = document.getElementById('chkMic').checked;
    const rotateSetting = document.getElementById('selRotate').value;

    if (isElectron && ipcRenderer) {
      const sources = await ipcRenderer.invoke('get-screen-sources');
      const src = sources[0];

      captureStream = await navigator.mediaDevices.getUserMedia({
        audio: sysSnd ? {
          mandatory: { chromeMediaSource: 'desktop' }
        } : false,
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

    const videoTrack = captureStream.getVideoTracks()[0];
    const settings = videoTrack.getSettings ? videoTrack.getSettings() : {};
    const nativeW = settings.width || window.screen.width;
    const nativeH = settings.height || window.screen.height;

    // 회전 각도 결정 (auto인 경우 세로비율 감지)
    let angle = 0;
    if (rotateSetting === 'auto') {
      // 만약 소스 자체가 가로로 보고되는데 실제 디스플레이가 세로거나 cropArea가 세로인 경우 보정
      if (cropArea && cropArea.h > cropArea.w) {
        angle = 0; // cropArea에 세로 비율 그대로 반영
      } else if (window.screen.height > window.screen.width && nativeW > nativeH) {
        angle = 90; // 피벗 모니터인데 가로 버퍼로 들어온 경우 회전
      }
    } else {
      angle = parseInt(rotateSetting, 10) || 0;
    }

    let recordStream = captureStream;

    // 영역 지정이 있거나 회전이 필요한 경우 캔버스 변환 처리
    if (cropArea || angle !== 0) {
      const srcVideo = document.createElement('video');
      srcVideo.srcObject = captureStream;
      srcVideo.muted = true;
      await srcVideo.play();

      const cropX = cropArea ? cropArea.x : 0;
      const cropY = cropArea ? cropArea.y : 0;
      const cropW = cropArea ? cropArea.w : (srcVideo.videoWidth || nativeW);
      const cropH = cropArea ? cropArea.h : (srcVideo.videoHeight || nativeH);

      const cropCanvas = document.createElement('canvas');
      const is90or270 = (angle === 90 || angle === 270);
      cropCanvas.width  = is90or270 ? cropH : cropW;
      cropCanvas.height = is90or270 ? cropW : cropH;
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
    }

    chunks = [];
    const mimes = ['video/webm;codecs=vp9,opus','video/webm;codecs=vp8,opus','video/webm','video/mp4'];
    const mime  = mimes.find(m => MediaRecorder.isTypeSupported(m)) || '';
    mediaRecorder = new MediaRecorder(recordStream, mime ? { mimeType: mime } : {});
    mediaRecorder.ondataavailable = e => { if (e.data?.size > 0) chunks.push(e.data); };
    mediaRecorder.onstop = onRecordStop;
    mediaRecorder.start(200);

    captureStream.getVideoTracks()[0].onended = () => { if (isRec) stopRecord(); };

    isRec = true;
    startTimer();
    setUI(true);
    document.getElementById('resultCard').classList.add('hidden');

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
  stopTimer();
  setUI(false);
}

function onRecordStop() {
  lastRecordedBlob = new Blob(chunks, { type: 'video/webm' });
  const url = URL.createObjectURL(lastRecordedBlob);
  const v = document.getElementById('prevVideo');
  v.src = url;
  previewRotationAngle = 0;
  v.style.transform = 'rotate(0deg)';
  document.getElementById('lblRotateAngle').textContent = '화면 90° 돌리기';

  updateDownloadLink(url);
  document.getElementById('resultCard').classList.remove('hidden');
}

function updateDownloadLink(url) {
  const dl = document.getElementById('btnDl');
  dl.href = url;
  dl.download = `SuziCam_${new Date().toISOString().replace(/[:.]/g,'-')}.webm`;
}

// ── 결과물 화면 회전 (90도씩 회전) ──
function rotatePreviewVideo() {
  if (!lastRecordedBlob) return;
  previewRotationAngle = (previewRotationAngle + 90) % 360;
  const v = document.getElementById('prevVideo');
  v.style.transform = `rotate(${previewRotationAngle}deg)`;
  document.getElementById('lblRotateAngle').textContent = `회전: ${previewRotationAngle}°`;
}

function togglePause() {
  if (!mediaRecorder || !isRec) return;
  const p  = document.getElementById('btnPause');
  const sb = document.getElementById('statusBadge');
  if (mediaRecorder.state === 'recording') {
    mediaRecorder.pause(); isPaused = true; pauseStart = performance.now();
    p.textContent = '▶';
    p.className = 'px-5 py-4 rounded-xl font-bold text-sm bg-yellow-600 hover:bg-yellow-700 text-white cursor-pointer transition';
    sb.textContent = '일시 정지';
    sb.className = 'text-xs px-3 py-1 rounded-full bg-yellow-950 text-yellow-300 border border-yellow-700 font-semibold';
  } else if (mediaRecorder.state === 'paused') {
    mediaRecorder.resume(); isPaused = false; pausedTotal += performance.now() - pauseStart;
    p.textContent = '❚❚';
    p.className = 'px-5 py-4 rounded-xl font-bold text-sm bg-neutral-700 hover:bg-neutral-600 text-white cursor-pointer transition';
    sb.textContent = '녹화 중';
    sb.className = 'text-xs px-3 py-1 rounded-full bg-red-950 text-red-300 border border-red-700 font-semibold rec-dot';
  }
}

function setUI(recording) {
  const btn = document.getElementById('btnRec');
  const p   = document.getElementById('btnPause');
  const sb  = document.getElementById('statusBadge');
  const dot = document.getElementById('recDot');
  if (recording) {
    btn.innerHTML = '<span class="w-3.5 h-3.5 rounded-sm bg-white inline-block"></span><span>녹화 정지</span>';
    btn.className = 'flex-1 py-4 rounded-xl font-extrabold text-base bg-neutral-800 border border-red-500 text-red-400 transition flex items-center justify-center space-x-2 cursor-pointer';
    btn.style.boxShadow = '';
    p.disabled = false;
    p.className = 'px-5 py-4 rounded-xl font-bold text-sm bg-neutral-700 hover:bg-neutral-600 text-white cursor-pointer transition';
    sb.textContent = '녹화 중';
    sb.className = 'text-xs px-3 py-1 rounded-full bg-red-950 text-red-300 border border-red-700 font-semibold';
    dot.style.animation = '';
    dot.className = 'w-3 h-3 rounded-full bg-red-500 rec-dot';
  } else {
    btn.innerHTML = '<span class="w-3.5 h-3.5 rounded-full bg-white inline-block"></span><span>녹화 시작</span>';
    btn.className = 'flex-1 py-4 rounded-xl font-extrabold text-base bg-red-600 hover:bg-red-700 text-white transition flex items-center justify-center space-x-2 cursor-pointer';
    btn.style.boxShadow = '0 4px 20px rgba(255,0,0,0.45)';
    p.disabled = true; p.textContent = '❚❚';
    p.className = 'px-5 py-4 rounded-xl font-bold text-sm bg-neutral-800 text-neutral-500 cursor-not-allowed transition';
    sb.textContent = '대기 중';
    sb.className = 'text-xs px-3 py-1 rounded-full bg-neutral-900 text-neutral-500 border border-neutral-800 font-semibold';
    dot.className = 'w-3 h-3 rounded-full bg-red-600';
    dot.style.animation = 'none';
  }
}
