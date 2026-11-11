const { app, BrowserWindow } = require('electron');
const path = require('path');

// Importa e inicia o servidor local em background
require('./server.js');
const automacao = require('./automacao.js');

let mainWindow;

function createWindow() {
    mainWindow = new BrowserWindow({
        width: 1280,
        height: 800,
        icon: path.join(__dirname, 'icon.ico'),
        autoHideMenuBar: true,
        title: "Miwra Automator",
        webPreferences: {
            nodeIntegration: false,
            contextIsolation: true
        }
    });

    // Dá um tempo curto para o express escutar a porta 3000
    setTimeout(() => {
        mainWindow.loadURL('http://localhost:3000');
    }, 1000);
    
    // Previne mudar o título original
    mainWindow.on('page-title-updated', (e) => {
        e.preventDefault();
    });
}

app.whenReady().then(createWindow);

app.on('window-all-closed', async () => {
    console.log("Fechando o aplicativo. Forçando limpeza de memória e processos em segundo plano...");
    try {
        await automacao.stopDaemon();
    } catch(e) {}
    
    if (process.platform !== 'darwin') {
        app.quit();
        setTimeout(() => process.exit(0), 500); // Garante a morte do processo principal após meio segundo
    }
});
