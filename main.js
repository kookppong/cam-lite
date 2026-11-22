const { app, BrowserWindow, ipcMain, desktopCapturer, screen, session } = require('electron');
const path = require('path');

let mainWin = null;
let areaWin = null;

function createMainWindow() {
  mainWin = new BrowserWindow({
    width: 520,
    height: 720,
    minWidth: 440,
    minHeight: 520,
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
ipcMain.on('win-close', () => { mainWin?.close(); });

app.whenReady().then(() => {
  // [Electron 28+] 브라우저 화면 공유 선택창 없이 기본 모니터와 시스템 오디오를 바로 연결
  if (session && session.defaultSession && session.defaultSession.setDisplayMediaRequestHandler) {
    session.defaultSession.setDisplayMediaRequestHandler((request, callback) => {
      desktopCapturer.getSources({ types: ['screen'] }).then((sources) => {
        callback({ video: sources[0], audio: 'loopback' });
      }).catch(() => {
        callback({});
      });
    });
  }

  createMainWindow();
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
