const { app, BrowserWindow, ipcMain, desktopCapturer, screen, session } = require('electron');
const path = require('path');

let mainWin = null;
let areaWin = null;

function createMainWindow() {
  mainWin = new BrowserWindow({
    width: 520,
    height: 760,
    minWidth: 460,
    minHeight: 560,
    title: '수지캠 (SuziCam) v0.1.0-test',
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

// ── 다중 모니터(서브모니터 포함) 전체 영역 선택 오버레이 ──
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

  // 드래그된 영역이 속한 모니터 탐색
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
