const { chromium } = require('playwright');

const HORA_EM_MS = 60 * 60 * 1000;
let INTERVALO_EXECUCAO = 8 * HORA_EM_MS; // Por padrão 8h (pode ser alterado)
let currentMode = 'full';
let currentExecutionStyle = 'simultaneous';

let accountsList = [];
let isRunning = false;
let abortRequested = false;
let currentBrowsers = [];
let screenInterval = null;

// Redireciona o console.log para o painel web, além de manter no terminal
const originalLog = console.log;
let webLogCallback = null;
let webSocketIo = null;
console.log = (...args) => {
    originalLog(...args);
    if (webLogCallback) {
        webLogCallback(args.join(' '));
    }
};

async function runCycle(limiteHorario, account, index) {
    const logPrefix = `[${account.email.split('@')[0]}]`;
    const logInfo = (msg) => console.log(`${logPrefix} ${msg}`);
    
    const localStep = async (msg, fn) => {
        logInfo(`\n▶ ${msg}...`);
        await fn();
        logInfo(`✓ Concluído: ${msg}`);
    };

    logInfo(`\n=========================================================`);
    logInfo(`🤖 INICIANDO NOVO CICLO DE GERAÇÃO - ${new Date().toLocaleString()}`);
    logInfo(`=========================================================`);
    
    let browser;
    try {
        try {
            browser = await chromium.launch({ headless: false, channel: 'chrome', args: ['--start-maximized'] });
        } catch(e) {
            logInfo("⚠️ Google Chrome não encontrado. Usando Microsoft Edge...");
            browser = await chromium.launch({ headless: false, channel: 'msedge', args: ['--start-maximized'] });
        }
        currentBrowsers.push(browser);
        const context = await browser.newContext({ viewport: null });
        const page = await context.newPage();
        
        if (index === 0) {
            if (screenInterval) clearInterval(screenInterval);
            screenInterval = setInterval(async () => {
                if (webSocketIo && !page.isClosed()) {
                    try {
                        const buffer = await page.screenshot({ type: 'jpeg', quality: 30 });
                        webSocketIo.emit('live-screen', buffer.toString('base64'));
                    } catch(e) {}
                }
            }, 2000);
        }


        await localStep(`Acessar página de login`, async () => {
            await page.goto('https://miwra.space/controle-ed.html');
        });

        await localStep(`Fazer login como ${account.email}`, async () => {
            await page.locator('input[type="email"]').first().fill(account.email);
            await page.locator('input[type="password"]').first().fill(account.password);
            await page.locator('button[type="submit"], button:has-text("Entrar")').first().click();
            
            // Aguarda ou o login ter sucesso (Modelos e Copies) ou a mensagem de erro aparecer
            const result = await Promise.race([
                page.waitForSelector('text=Modelos e Copies', { timeout: 30000 }).then(() => 'sucesso'),
                page.waitForSelector('.erro', { state: 'visible', timeout: 30000 }).then(async (el) => {
                    const errorText = await el.textContent();
                    return `erro: ${errorText}`;
                }).catch(() => 'timeout') // caso não apareça nenhum dos dois
            ]);

            if (result.startsWith('erro:')) {
                throw new Error(`Falha no login - Mensagem do site: ${result.replace('erro: ', '')}`);
            } else if (result === 'timeout') {
                throw new Error(`Falha no login - O painel não carregou em 30 segundos.`);
            }
        });

      if (currentMode !== 'approveOnly') {

        await localStep("Abrir seção Modelos e Copies", async () => {
            const modelosTitle = page.locator('text=Modelos e Copies').first();
            await modelosTitle.click();
            await page.waitForTimeout(2000);
        });



        await localStep("Ir direto para aba Trends e sortear Copy > 100k views", async () => {
            logInfo("   - Clicando na aba 'Trends / EM ALTA' na parte superior...");
            const trendsTab = page.locator('text=/Trends|EM ALTA/i').first();
            await trendsTab.click();
            
            logInfo("   - Aguardando carregamento da lista de Trends (até 15s)...");
            await page.locator('text=/views/i').first().waitFor({ state: 'visible', timeout: 15000 }).catch(() => null);
            await page.waitForTimeout(3000); // tempo extra pro DOM estabilizar
            
            logInfo("   - Escaneando copys (buscando apenas os com > 100k views)...");
            
            const resultado = await page.evaluate(() => {
                const allDivs = Array.from(document.querySelectorAll('div, article, section, li'));
                let elegiveis = [];

                for (let div of allDivs) {
                    const text = div.innerText || div.textContent || "";
                    
                    // Condição para ser considerado um "Card" contendo o texto da view
                    if (text.toLowerCase().includes('views') && text.length >= 20 && text.length < 800) {
                        
                        // Evita duplicatas se pegar divs pais e filhos com o mesmo texto de views
                        if (elegiveis.some(e => e.text === text || text.includes(e.text))) continue;

                        // Regex robusto ignorando espaços (ex: 1.6M VIEWS, 1.6 M views, 328 K views)
                        const isM = /[\d\.,]+\s*M\s*views/i.test(text);
                        const matchK = text.match(/([\d\.,]+)\s*K\s*views/i);
                        let isKOver100 = false;
                        
                        if (matchK) {
                            const num = parseFloat(matchK[1].replace(',', '.'));
                            if (num >= 100) isKOver100 = true;
                        }

                        if (isM || isKOver100) {
                            // Acha todos os botões/elementos clicáveis no card
                            const btns = Array.from(div.querySelectorAll('button, a, [role="button"], .cursor-pointer, .btn'));
                            // Pega o que tem ícone de play (svg)
                            let playBtn = btns.find(b => b.querySelector('svg')) || btns[0];

                            // Se for apenas uma <div> azul sem classes de botão, procura o SVG direto
                            if (!playBtn) {
                                const svgs = Array.from(div.querySelectorAll('svg'));
                                if (svgs.length > 0) {
                                    // Pode ter o fogo antes do play, pega o último SVG disponível
                                    playBtn = svgs.reverse().find(s => s.parentElement)?.parentElement;
                                }
                            }
                            
                            if (playBtn) {
                                elegiveis.push({ btn: playBtn, text: text.replace(/\n/g, ' ') });
                            }
                        }
                    }
                }
                
                if (elegiveis.length === 0) return { error: true, message: "Nenhuma copy > 100k views encontrada na tela." };
                
                const randomIndex = Math.floor(Math.random() * elegiveis.length);
                const sorteado = elegiveis[randomIndex];
                
                sorteado.btn.click();
                
                return { success: true, total: elegiveis.length, text: sorteado.text };
            });
            
            if (resultado.error) {
                logInfo("   ⚠️ " + resultado.message + " Usando a primeira copy da lista como emergência.");
                const fallbackBtn = page.locator('button:has(svg)').first();
                await fallbackBtn.waitFor({ state: 'visible', timeout: 5000 }).catch(()=>null);
                await fallbackBtn.click({ force: true });
            } else {
                logInfo(`   - 💎 Foram validadas ${resultado.total} copys virais (>100k views) na página!`);
                logInfo(`   - 🎲 Sorteada aleatoriamente: [${resultado.text.substring(0, 100)}...]`);
                logInfo(`   - Botão azul clicado com sucesso!`);
            }
            
            await page.waitForTimeout(3000);
        });

        await localStep("Configurar Copy e marcar todos os perfis", async () => {
            logInfo("   - Clicando no botão 'Todos' para selecionar tudo...");
            const btnTodos = page.getByRole('button', { name: 'Todos', exact: true }).first();
            await btnTodos.waitFor({ state: 'visible', timeout: 10000 }).catch(() => null);
            await btnTodos.click({ force: true }).catch(() => null);
            await page.waitForTimeout(2000); 
        });

        await localStep("Confirmar e Gerar Vídeos", async () => {
            logInfo("   - Procurando botão de 'Gerar X vídeos'...");
            const gerarBtn = page.getByRole('button', { name: /Gerar.*vídeos/i }).first();
            await gerarBtn.waitFor({ state: 'visible', timeout: 15000 });
            await gerarBtn.click();
            
            logInfo("   - Aguardando 5 segundos para verificar se a notificação aparece...");
            await page.waitForTimeout(5000);
        });
            
      } // fim do bloco if mode !== approveOnly

        await localStep("Acessar fila de aprovações", async () => {
            logInfo("   - Sistema pode estar lento. Aguardando carregamento das notificações (25s)...");
            await page.waitForTimeout(25000);
            logInfo("   - Procurando notificação de fila pendente no topo da tela...");
            
            let clicouNotificacao = false;
            for (let i = 0; i < 5; i++) {
                clicouNotificacao = await page.evaluate(() => {
                    const els = Array.from(document.querySelectorAll('*'));
                    
                    // Prioridade 1: Clicar em toast de sucesso se existir
                    const toasts = Array.from(document.querySelectorAll('div, button, a')).filter(el => {
                         const txt = (el.innerText || "").toLowerCase();
                         return txt.includes('vídeos gerados') || txt.includes('fila') || txt.includes('processando');
                    });
                    for (const toast of toasts) {
                        if (toast.click) { toast.click(); return true; }
                    }

                    // Prioridade 2: Procurar o badge no topo, EXCLUINDO modais de facebook ou perfil
                    for (const el of els) {
                        const rect = el.getBoundingClientRect();
                        if (rect.top < 100 && /^\s*\d+\s*$/.test(el.textContent) && el.children.length === 0) {
                            if(rect.width > 0 && rect.height > 0) {
                                let target = el;
                                if (el.closest('button')) target = el.closest('button');
                                else if (el.closest('a')) target = el.closest('a');
                                
                                // Verifica se tem relação com facebook (ignora)
                                const outerHTML = (target.outerHTML || "").toLowerCase();
                                if (outerHTML.includes('facebook') || outerHTML.includes('perfil') || outerHTML.includes('avatar')) {
                                    continue;
                                }
                                
                                target.click();
                                return true;
                            }
                        }
                    }
                    return false;
                });
                
                if (clicouNotificacao) break;
                await page.waitForTimeout(2000);
            }

            if (clicouNotificacao) {
                logInfo("   - Notificação da fila encontrada e clicada! Indo direto para as aprovações...");
                await page.waitForTimeout(2000);
            } else {
                logInfo("   - Notificação não está pronta. Iniciando pausa de 3 minutos (180 segundos) para aguardar a geração...");
                await page.waitForTimeout(180000);
            }
        });

        logInfo("\n🚀 === INICIANDO O LOOP DE APROVAÇÃO === 🚀");
        await page.evaluate(() => { document.body.style.zoom = "80%"; });

        let loopCount = 1;
        while (true) {
            if (abortRequested) {
                logInfo("\n🛑 Solicitação de parada recebida pelo Dashboard! Encerrando o ciclo atual...");
                break;
            }
            try {
                // === INTERRUPÇÃO DE HORÁRIO ===
                // Se bater o horário da próxima geração agendada, nós abortamos a fila atual!
                if (Date.now() >= limiteHorario) {
                    logInfo(`\n⏰ ATENÇÃO: O horário agendado para a próxima geração diária chegou!`);
                    logInfo(`   - Abortando as aprovações restantes. Clicando em 'Fechar'...`);
                    const fecharBtn = page.getByText('Fechar', { exact: true }).last();
                    await fecharBtn.click({ force: true }).catch(() => null);
                    await page.waitForTimeout(2000);
                    logInfo(`   - Pop-up fechado. Preparando para reiniciar o processo natural...`);
                    break; // Sai do loop infinito para que o navegador feche e o próximo ciclo comece
                }

                logInfo(`\n--- Buscando item da fila ---`);
                try {
                    const statusNode = page.locator('text=/\\d+ de \\d+ esperando/i').first();
                    await statusNode.waitFor({ state: 'visible', timeout: 3000 });
                    const statusText = await statusNode.textContent();
                    logInfo(`📊 Status lido na tela: ${statusText.trim().split('·')[0].trim()}`); 
                } catch (err) {}

                logInfo("Aguardando aparecer imagem ('usar esta'), vídeo ('confirmar'), erro ('Regerar') OU fila vazia...");
                
                const imgLocator = page.getByText(/usar esta/i).first();
                const videoLocator = page.getByText(/confirmar/i).first();
                // O botão Regerar fica no rodapé. Como a palavra também aparece no texto do erro, usamos .last() para pegar o botão!
                const errorLocator = page.getByText('Regerar', { exact: true }).last(); 
                const emptyLocator = page.getByText(/Nada esperando decisão agora/i).first();
                
                // Timeout de 20 minutos (1.200.000 ms) para considerar a fila oficialmente finalizada
                const TEMPO_OCIOSO = 20 * 60 * 1000;
                
                const element = await Promise.race([
                    imgLocator.waitFor({ state: 'visible', timeout: TEMPO_OCIOSO }).then(() => imgLocator),
                    videoLocator.waitFor({ state: 'visible', timeout: TEMPO_OCIOSO }).then(() => videoLocator),
                    errorLocator.waitFor({ state: 'visible', timeout: TEMPO_OCIOSO }).then(() => errorLocator),
                    emptyLocator.waitFor({ state: 'visible', timeout: TEMPO_OCIOSO }).then(() => emptyLocator)
                ]).catch(() => null); // Se estourar o tempo, retorna nulo
                
                if (!element) {
                    logInfo(`🛑 20 MINUTOS OCIOSOS DETECTADOS! Nenhuma aprovação ou erro apareceu. A fila realmente acabou.`);
                    logInfo(`💤 Encerrando a sessão do Playwright e entrando em repouso até o próximo horário.`);
                    break; // Sai do loop e desliga o navegador
                }
                
                const texto = await element.textContent();
                
                if (texto.toLowerCase().includes('regerar')) {
                    const hasTooManyRegenerations = await page.getByText(/regerada [3-9][x×]/i).count() > 0;
                    
                    if (hasTooManyRegenerations) {
                        logInfo(`⚠️ Muitas tentativas de regeração detectadas na mesma cena! Clicando em 'Cancelar geração'...`);
                        await page.waitForTimeout(1000);
                        const btnCancelar = page.getByText('Cancelar geração', { exact: true }).first();
                        page.once('dialog', dialog => dialog.accept());
                        await btnCancelar.click({ force: true }).catch(() => null);
                        logInfo(`❌ Geração cancelada com sucesso.`);
                        await page.waitForTimeout(3000);
                        continue;
                    }

                    logInfo(`⚠️ ERRO DETECTADO! Clicando no botão 'Regerar' no rodapé...`);
                    await page.waitForTimeout(1000);
                    await element.click({ force: true });
                    logInfo(`⏳ Aguardando a geração ser reiniciada...`);
                    await page.waitForTimeout(5000);
                    continue;
                } else if (texto.toLowerCase().includes('nada esperando')) {
                    logInfo(`👀 Aviso de fila vazia detectado! Mas pode haver mais escondidos...`);
                    const fecharBtn = page.getByText('Fechar', { exact: true }).last();
                    await fecharBtn.click({ force: true }).catch(() => null);
                    logInfo(`➡️ Fechamos a janela e continuaremos vigiando por até 20 minutos...`);
                    continue; // Não dá break! Apenas volta pro loop e espera.
                } else {
                    logInfo(`[Encontrado na tela]: "${texto.trim()}"`);
                }
                
                await page.waitForTimeout(1000); 
                // Tenta clicar usando o próprio locator, que recarrega o elemento da tela se ele piscar
                await element.first().click({ force: true });
                
                logInfo("Botão clicado com sucesso! Avançando para o próximo...");
                await page.waitForTimeout(3000);
                loopCount++;
            } catch (e) {
                logInfo(`\n⚠️ Ops, o botão piscou ou sumiu na hora do clique: ${e.message}`);
                logInfo("👀 Verificando se a fila ainda está na tela...");
                
                try {
                    const aindaTemFila = await page.locator('text=/\\d+ de \\d+ esperando/i').first().isVisible({ timeout: 5000 });
                    if (aindaTemFila) {
                        logInfo("   - A fila AINDA ESTÁ NA TELA! Ele não vai desistir. Retomando...");
                        await page.waitForTimeout(2000);
                        continue; // Volta para o começo do loop, perdoa o erro e tenta o próximo!
                    } else {
                        logInfo("   - O painel sumiu mesmo. Fila concluída!");
                        break;
                    }
                } catch(fatalErr) {
                     break;
                }
            }
        }
        logInfo(`\n✅ Ciclo finalizado com sucesso!`);
    } catch (e) {
        logInfo(`\n❌ Erro crítico no ciclo: ${e.message}`);
    } finally {
        if (browser) {
            logInfo(`Fechando navegador e limpando memória...`);
            if (index === 0 && screenInterval) {
                clearInterval(screenInterval);
                screenInterval = null;
            }
            await browser.close();
            currentBrowsers = currentBrowsers.filter(b => b !== browser);
        }
    }
}

// Loop contínuo de controle do Daemon
async function daemonLoop() {
    while (isRunning) {
        const startTime = Date.now();
        const limiteHorario = startTime + INTERVALO_EXECUCAO;
        
        if (abortRequested) break;
        
        if (currentExecutionStyle === 'simultaneous') {
            console.log(`\n[GERAL] 🚀 Executando ${accountsList.length} contas SIMULTANEAMENTE (com intervalo de segurança no início).`);
            const promises = accountsList.map(async (account, index) => {
                if (index > 0) {
                    console.log(`[GERAL] ⏳ Aguardando ${index * 12} segundos para iniciar o navegador da conta ${index + 1} (evitando roubo de foco)...`);
                    await new Promise(r => setTimeout(r, index * 12000));
                }
                if (abortRequested) return;
                
                console.log(`\n=========================================================`);
                console.log(`[GERAL] 👤 Iniciando conta ${index + 1} de ${accountsList.length}: ${account.email}`);
                console.log(`=========================================================`);
                return runCycle(limiteHorario, account, index);
            });
            await Promise.all(promises);
        } else {
            console.log(`\n[GERAL] 🚀 Executando ${accountsList.length} contas de forma SEQUENCIAL.`);
            for (let i = 0; i < accountsList.length; i++) {
                if (abortRequested) break;
                const account = accountsList[i];
                console.log(`\n=========================================================`);
                console.log(`[GERAL] 👤 Iniciando conta ${i + 1} de ${accountsList.length}: ${account.email}`);
                console.log(`=========================================================`);
                
                await runCycle(limiteHorario, account, i);
                
                if (abortRequested) break;
                
                if (i < accountsList.length - 1 && !abortRequested) {
                    console.log(`\n[GERAL] ⏳ Pausando 10 segundos antes de ir para a próxima conta...`);
                    await new Promise(r => setTimeout(r, 10000));
                }
            }
        }
        
        if (abortRequested) break;
        
        const timeElapsed = Date.now() - startTime;
        const timeLeft = INTERVALO_EXECUCAO - timeElapsed;
        
        if (currentMode === 'approveOnly') {
             console.log(`\n[GERAL] 🛑 Modo 'Limpar Fila' concluído com sucesso. Desligando robô imediatamente...`);
             break;
        }

        if (timeLeft > 0) {
            console.log(`\n[GERAL] 💤 Fila concluída! O robô vai dormir por aproximadamente ${Math.round(timeLeft/60000)} minutos até o próximo horário.`);
            
            // Espera customizada que pode ser interrompida pelo Dashboard
            let waited = 0;
            while (waited < timeLeft && isRunning && !abortRequested) {
                await new Promise(r => setTimeout(r, 1000));
                waited += 1000;
            }
        }
        
        if (isRunning && !abortRequested) {
            console.log(`\n[GERAL] 🔄 Horário atingido! O robô está despertando para o próximo turno...`);
        }
    }
    console.log("[GERAL] ⏹️ Daemon finalizado completamente.");
    isRunning = false;
}

module.exports = {
    startDaemon: (config, logger, io) => {
        if (isRunning) return false;
        accountsList = config.accounts && config.accounts.length > 0 ? config.accounts : [{ email: 'vendalachef@gmail.com', password: '33bnpyu9sm' }];
        
        const runsPerDay = parseInt(config.runsPerDay) || 3;
        INTERVALO_EXECUCAO = (24 / runsPerDay) * HORA_EM_MS;
        
        webLogCallback = logger;
        webSocketIo = io;
        isRunning = true;
        abortRequested = false;
        currentMode = config.mode || 'full';
        currentExecutionStyle = config.executionStyle || 'simultaneous';
        console.log(`[GERAL] 🚀 Iniciando robô em modo: ${currentMode === 'approveOnly' ? 'LIMPAR FILA' : 'COMPLETO'} com execução ${currentExecutionStyle === 'simultaneous' ? 'SIMULTÂNEA' : 'SEQUENCIAL'}.`);
        daemonLoop(); // Não aguardamos, ele roda em background
        return true;
    },
    stopDaemon: async () => {
        if (!isRunning) return false;
        console.log("[GERAL] 🛑 Parando o robô...");
        abortRequested = true;
        for (const browser of currentBrowsers) {
            try { await browser.close(); } catch(e){}
        }
        currentBrowsers = [];
        isRunning = false;
        return true;
    },
    getStatus: () => isRunning
};
