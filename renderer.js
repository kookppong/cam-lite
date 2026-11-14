/**
 * 수지캠 v0.1.0-test — 통합 렌더러 (Electron 데스크톱 & 웹 브라우저 공용)
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

// ── 환경 표시 업데이트 ──
document.addEventListener('DOMContentLoaded', () => {
  const envBadge = document.getElementById('areaModeBadge');
  if (!isElectron) {
    const titleEnv = document.createElement('span');
    titleEnv.className = 'text-[11px] px-2 py-0.5 rounded bg-blue-950 text-blue-300 border border-blue-800 ml-2';
    titleEnv.textContent = '웹 브라우저 모드';
    document.querySelector('.drag-region')?.appendChild(titleEnv);
  }
});

// ── 영역 정보 ──
let cropArea = null; // null = 전체 화면

// Electron 환경: 영역 선택 결과 수신
if (isElectron && ipcRenderer) {
  ipcRenderer.on('area-result', (_e, area) => {
    cropArea = area;
    updateAreaUI();
    document.getElementById('btnArea').textContent = '🖱️ 영역 재설정';
  });
}

function openAreaSelector() {
  if (isElectron && ipcRenderer) {
    // 데스크톱 환경: PC 전체 화면 투명 오버레이 실행 (바탕화면 전체 드래그)
    ipcRenderer.invoke('open-area-selector');
  } else {
    // 일반 웹 브라우저 환경 안내
    alert(
      '[웹 브라우저 안내]\n\n' +
      '크롬/엣지 같은 웹 브라우저는 보안 정책상 웹사이트가 PC 전체 화면을 임의로 제어하거나 창 밖을 드래그하는 것을 차단합니다.\n\n' +
      '반디캠처럼 다른 프로그램이나 바탕화면 전체에서 자유롭게 영역을 지정하려면 상단의 [v0.1.0-test 설치형 .exe] 프로그램을 다운로드해 실행해 주세요!'
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
    document.getElementById('areaModeBadge').textContent = `${cropArea.w} × ${cropArea.h}`;
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

// ── 녹화 엔진 ──
let mediaRecorder = null, chunks = [], captureStream = null, cropStream = null, cropRaf = null;

async function toggleRecord() {
  if (!isRec) await startRecord();
  else        stopRecord();
}

async function startRecord() {
  try {
    const fps    = parseInt(document.getElementById('selFps').value) || 60;
    const sysSnd = document.getElementById('chkSys').checked;
    const micOn  = document.getElementById('chkMic').checked;

    if (isElectron && ipcRenderer) {
      // [Electron 데스크톱 모드] 브라우저 선택 팝업 없이 PC 화면 바로 캡처
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
      // [일반 웹 브라우저 모드] WebRTC getDisplayMedia 사용
      captureStream = await navigator.mediaDevices.getDisplayMedia({
        video: { frameRate: { ideal: fps, max: fps } },
        audio: sysSnd
      });
    }

    // 마이크 추가
    if (micOn) {
      try {
        const mic = await navigator.mediaDevices.getUserMedia({ audio: true });
        mic.getAudioTracks().forEach(t => captureStream.addTrack(t));
      } catch(e) { console.warn('마이크 접근 실패:', e); }
    }

    let recordStream = captureStream;

    // 영역 크롭 (지정된 영역이 있을 경우)
    if (cropArea) {
      const cropCanvas = document.createElement('canvas');
      cropCanvas.width  = cropArea.w;
      cropCanvas.height = cropArea.h;
      const cctx = cropCanvas.getContext('2d');

      const srcVideo = document.createElement('video');
      srcVideo.srcObject = captureStream;
      srcVideo.muted = true;
      await srcVideo.play();

      function doCrop() {
        if (!isRec) return;
        cctx.drawImage(srcVideo, cropArea.x, cropArea.y, cropArea.w, cropArea.h, 0, 0, cropArea.w, cropArea.h);
        cropRaf = requestAnimationFrame(doCrop);
      }
      cropRaf = requestAnimationFrame(doCrop);

      cropStream = cropCanvas.captureStream(fps);
      captureStream.getAudioTracks().forEach(t => cropStream.addTrack(t));
      recordStream = cropStream;
    }

    // MediaRecorder 시작
    chunks = [];
    const mimes = ['video/webm;codecs=vp9,opus','video/webm;codecs=vp8,opus','video/webm','video/mp4'];
    const mime  = mimes.find(m => MediaRecorder.isTypeSupported(m)) || '';
    mediaRecorder = new MediaRecorder(recordStream, mime ? { mimeType: mime } : {});
    mediaRecorder.ondataavailable = e => { if (e.data?.size > 0) chunks.push(e.data); };
    mediaRecorder.onstop = onRecordStop;
    mediaRecorder.start(200);

    // 사용자가 외부에서 공유 중지했을 때
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
  const blob = new Blob(chunks, { type: 'video/webm' });
  const url  = URL.createObjectURL(blob);
  const v    = document.getElementById('prevVideo');
  v.src = url;
  const dl = document.getElementById('btnDl');
  dl.href = url;
  dl.download = `SuziCam_${new Date().toISOString().replace(/[:.]/g,'-')}.webm`;
  document.getElementById('resultCard').classList.remove('hidden');
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
