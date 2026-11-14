const { app, BrowserWindow, ipcMain, desktopCapturer, screen } = require('electron');
const path = require('path');

let mainWin = null;
let areaWin = null;

function createMainWindow() {
  mainWin = new BrowserWindow({
    width: 480,
    height: 580,
    minWidth: 440,
    minHeight: 520,
    title: '수지캠 v0.1.0-test',
    backgroundColor: '#0f1015',
    frame: false,          // 커스텀 타이틀바
    resizable: false,
    webPreferences: {
      nodeIntegration: true,
      contextIsolation: false
    }
  });
  mainWin.loadFile('index.html');
  mainWin.on('closed', () => { mainWin = null; app.quit(); });
}

// 화면 소스 목록 반환 (공유 선택창 없이 바로)
ipcMain.handle('get-screen-sources', async () => {
  const sources = await desktopCapturer.getSources({
    types: ['screen'],
    thumbnailSize: { width: 0, height: 0 }
  });
  return sources.map(s => ({ id: s.id, name: s.name }));
});

// 영역 선택 오버레이 창 열기
ipcMain.handle('open-area-selector', () => {
  if (areaWin) { areaWin.close(); areaWin = null; }

  const { bounds } = screen.getPrimaryDisplay();

  areaWin = new BrowserWindow({
    x: bounds.x,
    y: bounds.y,
    width: bounds.width,
    height: bounds.height,
    frame: false,
    transparent: true,
    alwaysOnTop: true,
    skipTaskbar: true,
    fullscreen: true,
    webPreferences: {
      nodeIntegration: true,
      contextIsolation: false
    }
  });
  areaWin.loadFile('area-select.html');
  areaWin.setIgnoreMouseEvents(false);
  areaWin.on('closed', () => { areaWin = null; });
});

// 영역 선택 완료 → 메인 창으로 전달
ipcMain.on('area-confirmed', (_e, area) => {
  if (areaWin) { areaWin.close(); areaWin = null; }
  mainWin?.webContents.send('area-result', area);
});

// 영역 선택 취소
ipcMain.on('area-cancelled', () => {
  if (areaWin) { areaWin.close(); areaWin = null; }
});

// 창 컨트롤 (커스텀 타이틀바)
ipcMain.on('win-minimize', () => mainWin?.minimize());
ipcMain.on('win-close',    () => { mainWin?.close(); });

app.whenReady().then(createMainWindow);
app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });
