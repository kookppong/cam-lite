const { app, BrowserWindow, ipcMain, desktopCapturer, screen, session } = require('electron');
const path = require('path');
const { spawn } = require('child_process');
const fs = require('fs');

let mainWin = null;
let areaWin = null;

function createMainWindow() {
  mainWin = new BrowserWindow({
    width: 520,
    height: 760,
    minWidth: 460,
    minHeight: 560,
    title: '수지캠 (SuziCam) v0.1.3-test',
    backgroundColor: '#0f1015',
    frame: false, // 커스텀 타이틀바
    resizable: true,
    webPreferences: {
      nodeIntegration: true,
      contextIsolation: false
    }
  });

  mainWin.loadFile('index.html');
  mainWin.on('closed', () => {
    mainWin = null;
    app.quit();
  });
}

// ── 창 제어 (최소화, 닫기) ──
ipcMain.on('win-minimize', () => {
  if (mainWin) mainWin.minimize();
});

ipcMain.on('win-close', () => {
  if (mainWin) mainWin.close();
});

// ── 모니터 화면 소스 목록 ──
ipcMain.handle('get-screen-sources', async () => {
  const sources = await desktopCapturer.getSources({
    types: ['screen'],
    thumbnailSize: { width: 0, height: 0 }
  });
  return sources.map(s => ({
    id: s.id,
    name: s.name,
    display_id: s.display_id
  }));
});

// ── 열려 있는 특정 프로그램 창 목록 (창 선택 모드용) ──
ipcMain.handle('get-window-sources', async () => {
  const sources = await desktopCapturer.getSources({
    types: ['window'],
    thumbnailSize: { width: 280, height: 160 },
    fetchWindowIcons: true
  });
  return sources.map(s => ({
    id: s.id,
    name: s.name,
    thumbnail: s.thumbnail.toDataURL()
  })).filter(s => s.name && !s.name.includes('수지캠') && !s.name.includes('area-select'));
});

// ══════════════════════════════════════════════════════
// ── FFmpeg 변환 엔진 ──
// ══════════════════════════════════════════════════════

/**
 * FFmpeg 바이너리 경로 결정
 * - 패키징된 앱: extraResources에 포함된 ffmpeg.exe
 * - 개발 모드: resources/ 폴더 또는 시스템 PATH
 */
function getFfmpegPath() {
  if (app.isPackaged) {
    const p = path.join(process.resourcesPath, 'ffmpeg.exe');
    if (fs.existsSync(p)) return p;
  }
  // 개발 모드: resources 폴더
  const devPath = path.join(__dirname, 'resources', 'ffmpeg.exe');
  if (fs.existsSync(devPath)) return devPath;
  // 시스템 PATH에서 찾기
  return 'ffmpeg';
}

/**
 * FFmpeg 사용 가능 여부 확인
 */
ipcMain.handle('check-ffmpeg', async () => {
  return new Promise((resolve) => {
    const ffmpegPath = getFfmpegPath();
    try {
      const proc = spawn(ffmpegPath, ['-version'], { windowsHide: true });
      let resolved = false;

      proc.on('close', (code) => {
        if (!resolved) { resolved = true; resolve(code === 0); }
      });
      proc.on('error', () => {
        if (!resolved) { resolved = true; resolve(false); }
      });

      // 타임아웃 3초
      setTimeout(() => {
        if (!resolved) {
          resolved = true;
          try { proc.kill(); } catch(e) {}
          resolve(false);
        }
      }, 3000);
    } catch(e) {
      resolve(false);
    }
  });
});

/**
 * WebM → H.264 MP4 변환
 * - CRF 22: 화면 녹화에 최적화된 고화질 (시각적으로 무손실에 가까움)
 * - preset veryfast: 빠른 인코딩 속도
 * - movflags +faststart: 타임라인 인덱스(moov atom)를 파일 앞에 배치 → 즉시 탐색 가능
 * - pix_fmt yuv420p: 최대 호환성
 */
ipcMain.handle('convert-to-mp4', async (event, { inputPath, outputPath, durationMs }) => {
  return new Promise((resolve, reject) => {
    const ffmpegPath = getFfmpegPath();

    const args = [
      '-y',                        // 덮어쓰기
      '-i', inputPath,             // 입력 파일
      '-c:v', 'libx264',          // H.264 코덱
      '-crf', '22',               // 화질 레벨 (낮을수록 고화질, 22는 화면녹화에 최적)
      '-preset', 'veryfast',      // 인코딩 속도 (빠름, 화질 유지)
      '-pix_fmt', 'yuv420p',      // 최대 호환성
      '-c:a', 'aac',              // 오디오 AAC
      '-b:a', '192k',             // 오디오 비트레이트
      '-movflags', '+faststart',  // moov atom을 파일 앞으로 → 즉시 탐색
      outputPath
    ];

    console.log(`[FFmpeg] 변환 시작: ${inputPath} → ${outputPath}`);
    const proc = spawn(ffmpegPath, args, { windowsHide: true });
    let stderr = '';

    proc.stderr.on('data', (data) => {
      const text = data.toString();
      stderr += text;

      // 진행률 파싱 → 렌더러에 전송
      const timeMatch = text.match(/time=(\d+):(\d+):(\d+)\.(\d+)/);
      if (timeMatch && durationMs > 0) {
        const h = parseInt(timeMatch[1]);
        const m = parseInt(timeMatch[2]);
        const s = parseInt(timeMatch[3]);
        const cs = parseInt(timeMatch[4]); // centiseconds
        const currentMs = (h * 3600 + m * 60 + s) * 1000 + cs * 10;
        const percent = Math.min(99, Math.round((currentMs / durationMs) * 100));
        mainWin?.webContents.send('ffmpeg-progress', percent);
      }
    });

    proc.on('close', (code) => {
      if (code === 0) {
        console.log('[FFmpeg] 변환 완료');
        mainWin?.webContents.send('ffmpeg-progress', 100);
        resolve({ success: true, path: outputPath });
      } else {
        const errMsg = stderr.slice(-500);
        console.error(`[FFmpeg] 변환 실패 (code ${code}):`, errMsg);
        reject(new Error(`FFmpeg error (code ${code}): ${errMsg}`));
      }
    });

    proc.on('error', (err) => {
      console.error('[FFmpeg] 실행 오류:', err.message);
      reject(new Error(`FFmpeg not found or cannot execute: ${err.message}`));
    });
  });
});

// ══════════════════════════════════════════════════════
// ── 다중 모니터 영역 선택 오버레이 ──
// ══════════════════════════════════════════════════════

ipcMain.handle('open-area-selector', () => {
  if (areaWin) {
    try { areaWin.close(); } catch(e) {}
    areaWin = null;
  }

  // 모든 연결된 모니터의 가상 데스크톱 총합 영역 계산
  const displays = screen.getAllDisplays();
  let minX = 0, minY = 0, maxX = 0, maxY = 0;
  
  displays.forEach((display, idx) => {
    const { x, y, width, height } = display.bounds;
    if (idx === 0) {
      minX = x; minY = y; maxX = x + width; maxY = y + height;
    } else {
      if (x < minX) minX = x;
      if (y < minY) minY = y;
      if (x + width > maxX) maxX = x + width;
      if (y + height > maxY) maxY = y + height;
    }
  });

  const totalW = maxX - minX;
  const totalH = maxY - minY;

  areaWin = new BrowserWindow({
    x: minX,
    y: minY,
    width: totalW,
    height: totalH,
    frame: false,
    transparent: true,
    alwaysOnTop: true,
    skipTaskbar: true,
    resizable: false,
    enableLargerThanScreen: true,
    webPreferences: {
      nodeIntegration: true,
      contextIsolation: false
    }
  });

  areaWin.loadFile('area-select.html');
  areaWin.setIgnoreMouseEvents(false);
  areaWin.on('closed', () => { areaWin = null; });
});

// 영역 선택 완료 → 모니터 매칭 및 상대 좌표 계산하여 메인 창 전달
ipcMain.on('area-confirmed', (_e, area) => {
  if (areaWin) {
    try { areaWin.close(); } catch(e) {}
    areaWin = null;
  }

  const targetDisplay = screen.getDisplayMatching(area);
  
  const relativeArea = {
    x: Math.max(0, area.x - targetDisplay.bounds.x),
    y: Math.max(0, area.y - targetDisplay.bounds.y),
    w: area.w,
    h: area.h,
    displayId: targetDisplay.id.toString(),
    displayName: targetDisplay.label || `모니터 (${targetDisplay.bounds.width}×${targetDisplay.bounds.height})`
  };

  mainWin?.webContents.send('area-result', relativeArea);
});

// 영역 선택 취소
ipcMain.on('area-cancelled', () => {
  if (areaWin) {
    try { areaWin.close(); } catch(e) {}
    areaWin = null;
  }
});

app.whenReady().then(() => {
  createMainWindow();
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
