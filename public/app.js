const socket = io();
const terminal = document.getElementById('terminal');
const form = document.getElementById('config-form');
const btnStart = document.getElementById('btn-start');
const btnApproveOnly = document.getElementById('btn-approve-only');
const btnStop = document.getElementById('btn-stop');
const btnLive = document.getElementById('btn-live');
const modal = document.getElementById('live-modal');
const closeModal = document.getElementById('close-modal');
const liveScreen = document.getElementById('live-screen');
const statusDot = document.getElementById('status-dot');
const statusText = document.getElementById('status-text');
const runsSlider = document.getElementById('runsPerDay');
const runsValue = document.getElementById('runs-value');
const runsHelp = document.getElementById('runs-help');
const btnAddAccount = document.getElementById('btn-add-account');
const accountsContainer = document.getElementById('accounts-container');

const accountTemplate = document.getElementById('account-template');

// Função para salvar estado no localStorage
function saveConfigToStorage() {
    const entries = Array.from(document.querySelectorAll('.account-entry'));
    const accounts = entries.map(entry => ({
        email: entry.querySelector('.account-email').value,
        password: entry.querySelector('.account-password').value,
        active: entry.querySelector('.account-active').checked
    }));
    localStorage.setItem('miwra_accounts', JSON.stringify(accounts));
    localStorage.setItem('miwra_runs', runsSlider.value);
    localStorage.setItem('miwra_simultaneous', document.getElementById('simultaneous-execution').checked);
}

function updateRemoveButtons() {
    const entries = accountsContainer.querySelectorAll('.account-entry');
    entries.forEach(entry => {
        const btn = entry.querySelector('.btn-remove-account');
        if (entries.length > 1) {
            btn.style.display = 'block';
        } else {
            btn.style.display = 'none';
        }
    });
}

function createAccountEntry(data = {email: '', password: '', active: true}) {
    const clone = accountTemplate.content.cloneNode(true);
    const entry = clone.querySelector('.account-entry');
    
    entry.querySelector('.account-email').value = data.email;
    entry.querySelector('.account-password').value = data.password;
    entry.querySelector('.account-active').checked = data.active;
    
    entry.querySelector('.btn-remove-account').addEventListener('click', function() {
        entry.remove();
        updateRemoveButtons();
        saveConfigToStorage();
    });
    
    // Auto-save ao digitar ou clicar
    entry.addEventListener('input', saveConfigToStorage);
    entry.addEventListener('change', saveConfigToStorage);
    
    accountsContainer.appendChild(entry);
    updateRemoveButtons();
}

function loadConfigFromStorage() {
    accountsContainer.innerHTML = '';
    const saved = localStorage.getItem('miwra_accounts');
    if (saved) {
        try {
            const accounts = JSON.parse(saved);
            if (accounts.length > 0) {
                accounts.forEach(acc => createAccountEntry(acc));
            } else {
                createAccountEntry({email: 'vendalachef@gmail.com', password: '33bnpyu9sm', active: true});
            }
        } catch(e) {
            createAccountEntry({email: 'vendalachef@gmail.com', password: '33bnpyu9sm', active: true});
        }
    } else {
        createAccountEntry({email: 'vendalachef@gmail.com', password: '33bnpyu9sm', active: true});
    }
    
    const savedRuns = localStorage.getItem('miwra_runs');
    if (savedRuns) {
        runsSlider.value = savedRuns;
        runsSlider.dispatchEvent(new Event('input'));
    }
    
    const savedSimul = localStorage.getItem('miwra_simultaneous');
    if (savedSimul !== null) {
        document.getElementById('simultaneous-execution').checked = savedSimul === 'true';
    }
}

btnAddAccount.addEventListener('click', () => {
    createAccountEntry({email: '', password: '', active: true});
    saveConfigToStorage();
});

// Inicializa a tela com o salvamento
loadConfigFromStorage();
document.getElementById('simultaneous-execution').addEventListener('change', saveConfigToStorage);
runsSlider.addEventListener('change', saveConfigToStorage);

// Atualiza o texto do slider
runsSlider.addEventListener('input', (e) => {
    const val = e.target.value;
    runsValue.textContent = `${val}x`;
    
    const horas = 24 / val;
    let intervalo = '';
    if (Number.isInteger(horas)) {
        intervalo = `O robô rodará a cada ${horas} horas.`;
    } else {
        intervalo = `O robô rodará a cada ${horas.toFixed(1)} horas.`;
    }
    runsHelp.textContent = intervalo;
});

// Função para adicionar linha no terminal com cores baseadas no texto
function appendLog(msg) {
    const line = document.createElement('div');
    line.className = 'log-line';
    
    const msgLower = msg.toLowerCase();
    if (msgLower.includes('erro') || msgLower.includes('falhou') || msgLower.includes('❌') || msgLower.includes('🛑')) {
        line.classList.add('error');
    } else if (msgLower.includes('⚠️') || msgLower.includes('atenção')) {
        line.classList.add('warn');
    } else if (msgLower.includes('✅') || msgLower.includes('✓') || msgLower.includes('sucesso')) {
        line.classList.add('success');
    }
    
    line.textContent = msg;
    terminal.appendChild(line);
    
    // Auto scroll para o final
    terminal.scrollTop = terminal.scrollHeight;
}

// Escuta eventos do servidor
socket.on('connect', () => {
    statusDot.classList.add('online');
    statusText.textContent = 'Conectado ao Servidor';
    checkStatus();
});

socket.on('disconnect', () => {
    statusDot.className = 'dot';
    statusText.textContent = 'Servidor Offline';
    setUIState(false);
});

socket.on('log-history', (history) => {
    // Limpa logs iniciais
    const systemLogs = terminal.querySelectorAll('.system:not(:first-child)');
    systemLogs.forEach(l => l.remove());
    
    history.forEach(log => appendLog(log));
});

socket.on('terminal-log', (msg) => {
    appendLog(msg);
});

socket.on('live-screen', (base64) => {
    if (modal.style.display === 'flex') {
        liveScreen.src = `data:image/jpeg;base64,${base64}`;
    }
});

btnLive.addEventListener('click', () => {
    modal.style.display = 'flex';
});

closeModal.addEventListener('click', () => {
    modal.style.display = 'none';
});

window.addEventListener('click', (e) => {
    if (e.target === modal) {
        modal.style.display = 'none';
    }
});

// Funções de API
async function checkStatus() {
    try {
        const res = await fetch('/api/status');
        const data = await res.json();
        setUIState(data.isRunning);
    } catch (e) {
        console.error('Erro ao checar status', e);
    }
}

function setUIState(isRunning) {
    if (isRunning) {
        btnStart.style.display = 'none';
        btnApproveOnly.style.display = 'none';
        btnStop.style.display = 'block';
        btnLive.style.display = 'block';
        statusDot.className = 'dot running';
        statusText.textContent = 'Robô em Execução';
        
        // Desabilita inputs
        document.querySelectorAll('.account-email, .account-password').forEach(el => el.disabled = true);
        btnAddAccount.disabled = true;
        document.querySelectorAll('.btn-remove-account').forEach(el => el.disabled = true);
        document.getElementById('simultaneous-execution').disabled = true;
        runsSlider.disabled = true;
    } else {
        btnStart.style.display = 'block';
        btnApproveOnly.style.display = 'block';
        btnStop.style.display = 'none';
        btnLive.style.display = 'none';
        modal.style.display = 'none';
        if (socket.connected) {
            statusDot.className = 'dot online';
            statusText.textContent = 'Pronto para Iniciar';
        }
        
        // Habilita inputs
        document.querySelectorAll('.account-email, .account-password').forEach(el => el.disabled = false);
        btnAddAccount.disabled = false;
        document.querySelectorAll('.btn-remove-account').forEach(el => el.disabled = false);
        document.getElementById('simultaneous-execution').disabled = false;
        runsSlider.disabled = false;
    }
}

// Eventos de Botão
function getConfig(mode = 'full') {
    const activeAccounts = Array.from(document.querySelectorAll('.account-entry'))
        .filter(entry => entry.querySelector('.account-active').checked)
        .map(entry => {
            return {
                email: entry.querySelector('.account-email').value,
                password: entry.querySelector('.account-password').value
            };
        });

    if (activeAccounts.length === 0) {
        throw new Error('Nenhuma conta ativada! Marque a caixinha "Ativa" em pelo menos uma conta para iniciar.');
    }

    return {
        accounts: activeAccounts,
        executionStyle: document.getElementById('simultaneous-execution').checked ? 'simultaneous' : 'sequential',
        runsPerDay: runsSlider.value,
        mode: mode
    };
}

btnApproveOnly.addEventListener('click', async () => {
    try {
        const response = await fetch('/api/start', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(getConfig('approveOnly'))
        });
        if (!response.ok) throw new Error(await response.text());
        checkStatus();
    } catch (err) {
        alert('Erro ao iniciar: ' + err.message);
    }
});

form.addEventListener('submit', async (e) => {
    e.preventDefault();
    let config;
    try {
        config = getConfig('full');
    } catch(err) {
        alert(err.message);
        return;
    }
    
    try {
        const res = await fetch('/api/start', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(config)
        });
        
        if (res.ok) {
            setUIState(true);
            appendLog('>>>> COMANDO ENVIADO: INICIAR ROBÔ <<<<');
        } else {
            const data = await res.json();
            alert(data.error);
        }
    } catch (e) {
        alert('Erro de conexão com o servidor.');
    }
});

btnStop.addEventListener('click', async () => {
    try {
        appendLog('>>>> COMANDO ENVIADO: SOLICITANDO PARADA <<<<');
        const res = await fetch('/api/stop', { method: 'POST' });
        
        if (res.ok) {
            setUIState(false);
        } else {
            const data = await res.json();
            alert(data.error);
        }
    } catch (e) {
        alert('Erro de conexão com o servidor.');
    }
});
