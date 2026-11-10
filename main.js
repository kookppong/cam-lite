const { app, BrowserWindow, ipcMain, desktopCapturer, shell } = require('electron');
const path = require('path');

let mainWindow;

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 620,
    height: 820,
    minWidth: 500,
    minHeight: 700,
    title: "수지캠 (SuziCam) v0.1.0-test",
    backgroundColor: "#12131a",
    icon: path.join(__dirname, 'icon.png'),
    webPreferences: {
      nodeIntegration: true,
      contextIsolation: false
    }
  });

  // 메뉴바 숨김 (깔끔한 녹화기 전용 앱 창)
  mainWindow.setMenuBarVisibility(false);

  mainWindow.loadFile('index.html');

  // 외부 링크 클릭 시 기본 브라우저에서 열기
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url);
    return { action: 'deny' };
  });

  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

// 화면 목록 요청 IPC
ipcMain.handle('get-sources', async () => {
  const sources = await desktopCapturer.getSources({ types: ['window', 'screen'] });
  return sources.map(source => ({
    id: source.id,
    name: source.name,
    thumbnail: source.thumbnail.toDataURL()
  }));
});

app.whenReady().then(createWindow);

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) createWindow();
});
