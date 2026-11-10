/**
 * 수지캠 (SuziCam) v0.1.0-test
 * Electron 데스크톱 앱 및 GitHub 웹 테스트 공용 렌더러
 */

const isElectron = typeof window !== 'undefined' && window.process && window.process.type;

// 1. 실행 환경 표시 업데이트
document.addEventListener('DOMContentLoaded', () => {
  const envBadge = document.getElementById('envBadge');
  if (isElectron) {
    envBadge.textContent = "🖥️ PC 데스크톱 설치 모드";
    envBadge.className = "text-[11px] px-2 py-0.5 rounded bg-emerald-950 text-emerald-300 border border-emerald-800";
  } else {
    envBadge.textContent = "🌐 GitHub 웹 테스트 모드";
    envBadge.className = "text-[11px] px-2 py-0.5 rounded bg-blue-950 text-blue-300 border border-blue-800";
  }
});

// 2. 실시간 디지털 시계 / 타이머
const timerEl = document.getElementById('recTimer');
let recordingStartTime = 0;
let isRecordingActive = false;
let isPaused = false;
let pausedTotalTime = 0;
let pauseStartTime = 0;

function updateClock() {
  if (isRecordingActive) {
    const now = performance.now();
    let elapsedMs = 0;
    if (isPaused) {
      elapsedMs = pauseStartTime - recordingStartTime - pausedTotalTime;
    } else {
      elapsedMs = now - recordingStartTime - pausedTotalTime;
    }
    const totalSec = Math.floor(elapsedMs / 1000);
    const ms = Math.floor(elapsedMs % 1000);
    const h = String(Math.floor(totalSec / 3600)).padStart(2, '0');
    const m = String(Math.floor((totalSec % 3600) / 60)).padStart(2, '0');
    const s = String(totalSec % 60).padStart(2, '0');
    const msStr = String(ms).padStart(3, '0');
    timerEl.textContent = `${h}:${m}:${s}.${msStr}`;
  } else {
    const d = new Date();
    const h = String(d.getHours()).padStart(2, '0');
    const m = String(d.getMinutes()).padStart(2, '0');
    const s = String(d.getSeconds()).padStart(2, '0');
    const ms = String(d.getMilliseconds()).padStart(3, '0');
    timerEl.textContent = `${h}:${m}:${s}.${ms}`;
  }
  requestAnimationFrame(updateClock);
}
requestAnimationFrame(updateClock);

// 3. 화면 녹화 엔진 (WebRTC MediaRecorder)
let mediaRecorder = null;
let recordedChunks = [];
let captureStream = null;

async function handleRecordToggle() {
  if (!isRecordingActive) {
    try {
      const fps = parseInt(document.getElementById('selFps').value, 10) || 60;
      const includeAudio = document.getElementById('chkAudio').checked;

      captureStream = await navigator.mediaDevices.getDisplayMedia({
        video: {
          frameRate: { ideal: fps, max: fps },
          displaySurface: "monitor"
        },
        audio: includeAudio ? true : false
      });

      if (includeAudio) {
        try {
          const micStream = await navigator.mediaDevices.getUserMedia({ audio: true });
          const audioTracks = micStream.getAudioTracks();
          audioTracks.forEach(track => captureStream.addTrack(track));
        } catch (micErr) {
          console.log("마이크 없음 또는 권한 거부, 시스템 소리만 녹음:", micErr);
        }
      }

      recordedChunks = [];
      const mimeTypes = [
        'video/webm;codecs=vp9,opus',
        'video/webm;codecs=vp8,opus',
        'video/webm',
        'video/mp4'
      ];
      let selectedMime = mimeTypes.find(m => MediaRecorder.isTypeSupported(m)) || '';

      mediaRecorder = new MediaRecorder(captureStream, selectedMime ? { mimeType: selectedMime } : {});

      mediaRecorder.ondataavailable = (event) => {
        if (event.data && event.data.size > 0) {
          recordedChunks.push(event.data);
        }
      };

      mediaRecorder.onstop = () => {
        const blob = new Blob(recordedChunks, { type: selectedMime || 'video/webm' });
        const videoUrl = URL.createObjectURL(blob);
        const preview = document.getElementById('previewVideo');
        const downloadBtn = document.getElementById('btnDownload');
        
        preview.src = videoUrl;
        downloadBtn.href = videoUrl;
        downloadBtn.download = `SuziCam_Record_${new Date().toISOString().replace(/[:.]/g, '-')}.webm`;
        
        document.getElementById('resultCard').classList.remove('hidden');

        if (captureStream) {
          captureStream.getTracks().forEach(track => track.stop());
        }
      };

      mediaRecorder.start(200);
      
      isRecordingActive = true;
      isPaused = false;
      recordingStartTime = performance.now();
      pausedTotalTime = 0;

      const btnRec = document.getElementById('btnRec');
      btnRec.classList.replace('bg-red-600', 'bg-neutral-800');
      btnRec.classList.add('border', 'border-red-500', 'text-red-400');
      document.getElementById('btnRecText').textContent = "■ 녹화 정지 (STOP)";
      
      const btnPause = document.getElementById('btnPause');
      btnPause.disabled = false;
      btnPause.className = "px-4 py-3 rounded-xl font-bold text-sm bg-neutral-700 hover:bg-neutral-600 text-white cursor-pointer transition-all";
      
      const statusBadge = document.getElementById('statusBadge');
      statusBadge.textContent = "녹화 중 (REC)";
      statusBadge.className = "text-xs px-2.5 py-0.5 rounded-full bg-red-950 text-red-300 font-semibold border border-red-700 rec-pulse";

      document.getElementById('resultCard').classList.add('hidden');

      captureStream.getVideoTracks()[0].onended = () => {
        if (isRecordingActive) handleRecordToggle();
      };

    } catch (err) {
      alert("화면 녹화 시작 실패: " + err.message);
    }
  } else {
    if (mediaRecorder && mediaRecorder.state !== 'inactive') {
      mediaRecorder.stop();
    }
    isRecordingActive = false;
    isPaused = false;

    const btnRec = document.getElementById('btnRec');
    btnRec.className = "px-6 py-3 rounded-xl font-bold text-sm bg-red-600 hover:bg-red-700 active:scale-95 text-white shadow-[0_4px_15px_rgba(255,0,0,0.4)] transition-all flex items-center space-x-2 cursor-pointer";
    document.getElementById('btnRecText').textContent = "녹화 시작 (REC)";

    const btnPause = document.getElementById('btnPause');
    btnPause.disabled = true;
    btnPause.textContent = "❚❚ 일시정지";
    btnPause.className = "px-4 py-3 rounded-xl font-bold text-sm bg-neutral-800 text-neutral-500 cursor-not-allowed transition-all";

    const statusBadge = document.getElementById('statusBadge');
    statusBadge.textContent = "녹화 완료";
    statusBadge.className = "text-xs px-2.5 py-0.5 rounded-full bg-neutral-800 text-green-400 font-semibold border border-neutral-700";
  }
}

function handlePauseToggle() {
  if (!mediaRecorder || !isRecordingActive) return;
  const btnPause = document.getElementById('btnPause');
  const statusBadge = document.getElementById('statusBadge');

  if (mediaRecorder.state === 'recording') {
    mediaRecorder.pause();
    isPaused = true;
    pauseStartTime = performance.now();
    btnPause.textContent = "▶ 녹화 재개";
    btnPause.className = "px-4 py-3 rounded-xl font-bold text-sm bg-yellow-600 hover:bg-yellow-700 text-white cursor-pointer";
    statusBadge.textContent = "일시 정지";
    statusBadge.className = "text-xs px-2.5 py-0.5 rounded-full bg-yellow-950 text-yellow-300 font-semibold border border-yellow-700";
  } else if (mediaRecorder.state === 'paused') {
    mediaRecorder.resume();
    isPaused = false;
    pausedTotalTime += (performance.now() - pauseStartTime);
    btnPause.textContent = "❚❚ 일시정지";
    btnPause.className = "px-4 py-3 rounded-xl font-bold text-sm bg-neutral-700 hover:bg-neutral-600 text-white cursor-pointer";
    statusBadge.textContent = "녹화 중 (REC)";
    statusBadge.className = "text-xs px-2.5 py-0.5 rounded-full bg-red-950 text-red-300 font-semibold border border-red-700 rec-pulse";
  }
}

// 4. 실시간 테스트 벤치 (60FPS 모션)
const canvas = document.getElementById('motionCanvas');
const ctx = canvas.getContext('2d');
let ballX = 15;
let ballSpeed = 3.5;
let lastFpsTime = performance.now();
let frames = 0;

function drawBenchMotion(time) {
  frames++;
  if (time - lastFpsTime >= 1000) {
    document.getElementById('fpsDisplay').textContent = `${frames} FPS`;
    frames = 0;
    lastFpsTime = time;
  }

  ctx.clearRect(0, 0, canvas.width, canvas.height);

  ctx.fillStyle = '#ff4444';
  ctx.beginPath();
  ctx.arc(ballX, 25, 9, 0, Math.PI * 2);
  ctx.fill();

  ctx.save();
  ctx.translate(canvas.width / 2, 50);
  ctx.rotate(time / 160);
  ctx.fillStyle = '#00e5ff';
  ctx.fillRect(-18, -2, 36, 4);
  ctx.fillRect(-2, -18, 4, 36);
  ctx.restore();

  ballX += ballSpeed;
  if (ballX > canvas.width - 15 || ballX < 15) {
    ballSpeed = -ballSpeed;
  }

  requestAnimationFrame(drawBenchMotion);
}
requestAnimationFrame(drawBenchMotion);

// 5. 비프음 싱크 테스트
let audioContext = null;
let beepInterval = null;
let isBeepActive = false;

function triggerBeep() {
  if (!audioContext) audioContext = new (window.AudioContext || window.webkitAudioContext)();
  const osc = audioContext.createOscillator();
  const gain = audioContext.createGain();
  osc.connect(gain);
  gain.connect(audioContext.destination);
  osc.frequency.value = 1000;
  gain.gain.value = 0.08;
  osc.start();
  osc.stop(audioContext.currentTime + 0.08);
}

function toggleBeepSound() {
  isBeepActive = !isBeepActive;
  const btn = document.getElementById('btnBeep');
  if (isBeepActive) {
    btn.textContent = "🔊 비프음 끄기";
    btn.className = "px-3 py-1.5 rounded-lg text-xs font-semibold bg-green-700 text-white cursor-pointer";
    triggerBeep();
    beepInterval = setInterval(triggerBeep, 1000);
  } else {
    btn.textContent = "🔈 1초 비프음 켜기";
    btn.className = "px-3 py-1.5 rounded-lg text-xs font-semibold bg-neutral-800 hover:bg-neutral-700 text-yellow-300 border border-neutral-700 cursor-pointer";
    clearInterval(beepInterval);
  }
}

// 6. 마우스 클릭 감지 테스트
let targetClickCount = 0;
function handleClickTarget() {
  targetClickCount++;
  const box = document.getElementById('clickTarget');
  const text = document.getElementById('clickTargetText');
  box.classList.add('bg-red-900/40', 'border-red-500');
  text.textContent = `🎯 마우스 클릭 감지됨! (누적: ${targetClickCount}회)`;
  setTimeout(() => {
    box.classList.remove('bg-red-900/40', 'border-red-500');
  }, 120);
}
