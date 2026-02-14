/**
 * Suspeito PWA Logic - Premium Edition
 */

const DB_NAME = 'SuspeitoDB';
const DB_VERSION = 1;
const STORE_NAME = 'gameState';

/**
 * Modal customizado para confirm/alert
 */
function customConfirm(message, confirmText = 'Confirmar', cancelText = 'Cancelar') {
    return new Promise((resolve) => {
        const overlay = document.getElementById('custom-modal-overlay');
        const msgEl = document.getElementById('custom-modal-message');
        const btnConfirm = document.getElementById('custom-modal-confirm');
        const btnCancel = document.getElementById('custom-modal-cancel');
        const buttonsDiv = document.querySelector('.custom-modal-buttons');

        msgEl.textContent = message;
        btnConfirm.textContent = confirmText;
        btnCancel.textContent = cancelText;
        buttonsDiv.classList.remove('alert-mode');

        // Mostrar
        overlay.classList.add('visible');

        function cleanup() {
            overlay.classList.remove('visible');
            btnConfirm.removeEventListener('click', onConfirm);
            btnCancel.removeEventListener('click', onCancel);
        }

        function onConfirm() { cleanup(); resolve(true); }
        function onCancel() { cleanup(); resolve(false); }

        btnConfirm.addEventListener('click', onConfirm);
        btnCancel.addEventListener('click', onCancel);
    });
}

function customAlert(message, buttonText = 'Ok') {
    return new Promise((resolve) => {
        const overlay = document.getElementById('custom-modal-overlay');
        const msgEl = document.getElementById('custom-modal-message');
        const btnConfirm = document.getElementById('custom-modal-confirm');
        const buttonsDiv = document.querySelector('.custom-modal-buttons');

        msgEl.textContent = message;
        btnConfirm.textContent = buttonText;
        buttonsDiv.classList.add('alert-mode');

        overlay.classList.add('visible');

        function cleanup() {
            overlay.classList.remove('visible');
            btnConfirm.removeEventListener('click', onOk);
        }

        function onOk() { cleanup(); resolve(); }
        btnConfirm.addEventListener('click', onOk);
    });
}

const app = {
    db: null,
    data: null, // table.json content
    state: {
        eliminated: {}, // { "Nome do Item": true }
        guesses: {
            suspeito: null,
            arma: null,
            local: null
        }
    },

    // Socket.io
    socket: null,
    currentRoom: null,
    isSecretMode: false,
    gameMode: null, // 'offline' | 'friends'

    // Activity Log
    activityLog: [],

    // Identity
    identity: {
        userId: null,
        nickname: ''
    },

    // Timer
    timerInterval: null,
    timerState: {
        running: false,
        start: null,
        elapsed: 0
    },

    init() {
        console.log('[INIT] Iniciando app...');

        // Verificar versão ANTES de tudo
        this.checkVersion().then(shouldReload => {
            if (shouldReload) return; // Vai recarregar, não faz mais nada
            this._startApp();
        });
    },

    _startApp() {
        // Ler modo do localStorage (definido pelo lobby/index.html)
        this.gameMode = localStorage.getItem('suspeito_game_mode') || 'offline';
        console.log('[INIT] Modo de jogo:', this.gameMode);

        this.loadData().then(() => {
            console.log('[INIT] Dados carregados, abrindo DB...');
            this.openDB().then(() => this.loadState().then(() => {
                console.log('[INIT] State carregado:', JSON.stringify(this.state));
                console.log('[INIT] Identity:', JSON.stringify(this.identity));

                // Garantir que identity existe
                if (!this.identity.userId) {
                    this.identity.userId = crypto.randomUUID();
                    console.log('[INIT] Novo userId gerado:', this.identity.userId);
                    this.saveState();
                }

                this.render();
                this.updateHeader();
                console.log('[INIT] Render e header atualizados');

                // Se modo "friends", inicializar Socket e entrar na sala
                if (this.gameMode === 'friends') {
                    console.log('[INIT] Modo friends - iniciando socket...');
                    this.initSocket();
                    this.autoJoinRoom();
                    // Mostrar botão sair da sala
                    const leaveBtn = document.getElementById('btn-leave');
                    if (leaveBtn) leaveBtn.classList.remove('hidden');
                } else {
                    console.log('[INIT] Modo offline - sem socket');
                }
            })).catch(e => console.error('[INIT] Erro:', e));
        }).catch(e => console.error('[INIT] Erro ao carregar dados:', e));
    },

    async checkVersion() {
        try {
            const response = await fetch('/api/version', { cache: 'no-store' });
            if (!response.ok) return false;

            const { version } = await response.json();
            const savedVersion = localStorage.getItem('suspeito_app_version');
            console.log('[VERSION] Servidor:', version, '| Local:', savedVersion);

            if (savedVersion && savedVersion !== version) {
                console.log('[VERSION] ⚠️ Nova versão detectada! Atualizando...');

                // 1. Desregistrar Service Workers
                if ('serviceWorker' in navigator) {
                    const registrations = await navigator.serviceWorker.getRegistrations();
                    for (const reg of registrations) {
                        await reg.unregister();
                        console.log('[VERSION] SW desregistrado');
                    }
                }

                // 2. Limpar todos os caches
                if ('caches' in window) {
                    const cacheNames = await caches.keys();
                    for (const name of cacheNames) {
                        await caches.delete(name);
                        console.log('[VERSION] Cache deletado:', name);
                    }
                }

                // 3. Salvar nova versão e recarregar
                localStorage.setItem('suspeito_app_version', version);
                console.log('[VERSION] Recarregando...');
                window.location.reload();
                return true;
            }

            // Salvar versão (primeira vez ou mesma versão)
            localStorage.setItem('suspeito_app_version', version);
            return false;
        } catch (e) {
            console.warn('[VERSION] Erro ao verificar versão (offline?):', e);
            return false;
        }
    },

    // Auto-entrar na sala usando dados do localStorage (definidos no lobby)
    autoJoinRoom() {
        const roomCode = localStorage.getItem('suspeito_room_code');
        const nickname = localStorage.getItem('suspeito_nickname');
        const isSpyMode = localStorage.getItem('suspeito_spy_mode') === 'true';
        console.log('[AUTO-JOIN] roomCode:', roomCode, 'nickname:', nickname, 'spyMode:', isSpyMode);

        if (!roomCode || !nickname) {
            console.warn('[AUTO-JOIN] Dados incompletos, abortando');
            return;
        }

        this.identity.nickname = nickname;
        this.isSecretMode = isSpyMode;
        this.saveState();

        // Aguardar conexão do socket
        if (this.socket && this.socket.connected) {
            this._emitJoin(roomCode, nickname, isSpyMode);
        } else if (this.socket) {
            this.socket.on('connect', () => {
                this._emitJoin(roomCode, nickname, isSpyMode);
            });
        }
    },

    _emitJoin(roomCode, nickname, isSpyMode) {
        console.log('[SOCKET] Emitindo join_room:', { roomCode, nickname, isSpyMode, userId: this.identity.userId });
        this.socket.emit('join_room', {
            roomCode,
            nickname,
            isSecret: isSpyMode,
            userId: this.identity.userId
        });
    },

    async loadData() {
        console.log('[LOAD-DATA] Carregando dados...');
        try {
            const response = await fetch('/api/tabela');
            if (!response.ok) throw new Error('API Error');
            this.data = await response.json();
            console.log('[LOAD-DATA] Dados da API carregados:', Object.keys(this.data));
        } catch (e) {
            console.warn('[LOAD-DATA] API falhou, usando JSON estático', e);
            const response = await fetch('table.json');
            this.data = await response.json();
            console.log('[LOAD-DATA] Dados do JSON carregados:', Object.keys(this.data));
        }
    },

    initSocket() {
        console.log('[SOCKET] Inicializando Socket.IO...');
        this.socket = io();

        this.socket.on('connect', () => {
            console.log('[SOCKET] 🔌 Conectado ao servidor, id:', this.socket.id);
        });

        this.socket.on('disconnect', (reason) => {
            console.log('[SOCKET] ❌ Desconectado:', reason);
        });

        this.socket.on('connect_error', (error) => {
            console.error('[SOCKET] Erro de conexão:', error);
        });

        this.socket.on('notification', (data) => {
            console.log('[SOCKET] Notificação:', data);
            this.showToast(data.message, data.type);
            if (navigator.vibrate) navigator.vibrate([50, 50, 50]);
        });

        this.socket.on('room_joined', (data) => {
            console.log('[SOCKET] Entrou na sala:', data);
            this.currentRoom = data.roomCode;

            if (data.timerState) {
                this.syncTimer(data.timerState);
            }

            this.showToast(`Entrou na sala ${data.roomCode} (${data.mode})`, 'success');
        });

        this.socket.on('timer_sync', (state) => {
            console.log('[SOCKET] Timer sync:', state);
            this.syncTimer(state);
        });
    },

    syncTimer(state) {
        this.timerState = state;
        this.renderTimer();

        if (this.timerInterval) clearInterval(this.timerInterval);

        if (state.running) {
            this.timerInterval = setInterval(() => this.renderTimer(), 1000);
        }
    },

    renderTimer() {
        const timerEl = document.getElementById('game-timer');
        if (!timerEl) return;

        let totalSeconds = Math.floor(this.timerState.elapsed / 1000);

        if (this.timerState.running && this.timerState.start) {
            const currentSession = Math.floor((Date.now() - this.timerState.start) / 1000);
            totalSeconds += currentSession;
        }

        const minutes = Math.floor(totalSeconds / 60).toString().padStart(2, '0');
        const seconds = (totalSeconds % 60).toString().padStart(2, '0');
        timerEl.textContent = `${minutes}:${seconds}`;

        // Visual feedback if running
        if (this.timerState.running) {
            timerEl.classList.add('running');
        } else {
            timerEl.classList.remove('running');
        }
    },

    toggleTimer() {
        if (navigator.vibrate) navigator.vibrate(20);

        if (this.gameMode === 'offline') {
            const now = Date.now();
            if (this.timerState.running) {
                // PAUSE
                const diff = now - (this.timerState.start || now);
                this.timerState.elapsed += diff;
                this.timerState.running = false;
                this.timerState.start = null;
            } else {
                // PLAY
                this.timerState.running = true;
                this.timerState.start = now;
            }
            this.syncTimer(this.timerState);
            this.saveState(); // Persistir estado do timer no offline
        } else {
            // Online / Friends
            if (!this.socket || !this.currentRoom) return;
            this.socket.emit('timer_toggle');
        }
    },

    startTimer(startTime) {
        // Deprecated in favor of syncTimer
    },

    emitGameAction(action, detail) {
        if (this.socket && this.currentRoom) {
            this.socket.emit('game_action', {
                action,
                detail
            });
        }
    },

    showToast(message, type = 'info') {
        const container = document.getElementById('toast-container');
        const toast = document.createElement('div');
        toast.className = `toast ${type}`;
        toast.textContent = message;

        container.appendChild(toast);

        setTimeout(() => {
            toast.style.animation = 'fadeOut 0.3s ease-out forwards';
            setTimeout(() => toast.remove(), 300);
        }, 4000);
    },

    openDB() {
        return new Promise((resolve, reject) => {
            const request = indexedDB.open(DB_NAME, DB_VERSION);

            request.onupgradeneeded = (event) => {
                const db = event.target.result;
                if (!db.objectStoreNames.contains(STORE_NAME)) {
                    db.createObjectStore(STORE_NAME, { keyPath: 'id' });
                }
            };

            request.onsuccess = (event) => {
                this.db = event.target.result;
                resolve();
            };

            request.onerror = (event) => {
                reject('IndexedDB error: ' + event.target.errorCode);
            };
        });
    },

    saveState() {
        if (!this.db) return;
        const tx = this.db.transaction(STORE_NAME, 'readwrite');
        const store = tx.objectStore(STORE_NAME);
        store.put({
            id: 'current',
            ...this.state,
            identity: this.identity,
            timerState: this.timerState // Salvar estado do timer
        });
    },

    async loadState() {
        if (!this.db) return;
        return new Promise((resolve) => {
            const tx = this.db.transaction(STORE_NAME, 'readonly');
            const store = tx.objectStore(STORE_NAME);
            const request = store.get('current');

            request.onsuccess = (event) => {
                const result = event.target.result;
                if (result) {
                    const guesses = result.guesses || { suspeito: null, arma: null, local: null };

                    // Migração: corrigir key 'suspeitos' → 'suspeito'
                    if (guesses.suspeitos !== undefined) {
                        guesses.suspeito = guesses.suspeitos;
                        delete guesses.suspeitos;
                        console.log('[LOAD-STATE] Migrado guesses.suspeitos → guesses.suspeito');
                    }

                    this.state = {
                        eliminated: result.eliminated || {},
                        guesses
                    };
                    if (result.identity) {
                        this.identity = result.identity;
                    }
                    if (result.timerState && this.gameMode === 'offline') {
                        // Restaurar timer no offline
                        this.syncTimer(result.timerState);
                    }
                }
                resolve();
            };

            request.onerror = () => resolve();
        });
    },

    render() {
        if (!this.data) return;
        this.renderList('suspeitos', 'list-suspeitos');
        this.renderList('arma', 'list-arma');
        this.renderList('local', 'list-local');
    },

    renderList(key, containerId) {
        const container = document.getElementById(containerId);
        if (!container) return;
        container.innerHTML = '';

        const items = this.data[key];
        if (!items) return;

        items.forEach(item => {
            const el = document.createElement('div');
            el.className = 'item-card';
            el.textContent = item;

            if (this.state.eliminated[item]) {
                el.classList.add('eliminated');
            }

            if (this.isGuess(item)) {
                el.classList.add('selected-guess');
            }

            el.onclick = () => this.toggleItem(item);
            container.appendChild(el);
        });
    },

    getGenericAction(type) {
        const phrases = {
            elimination: [
                'riscou algo da lista',
                'fez uma nova descoberta',
                'encontrou uma pista',
                'eliminou uma possibilidade'
            ],
            suspicion: [
                'tem uma nova suspeita',
                'está desconfiado de alguém',
                'mudou de ideia sobre o caso',
                'está analisando novas evidências'
            ],
            restore: [
                'revisou suas anotações',
                'corrigiu um erro',
                'voltou atrás em uma decisão'
            ],
            removeSuspicion: [
                'descartou uma suspeita',
                'mudou de ideia',
                'repensou o caso'
            ]
        };

        const list = phrases[type] || ['fez algo'];
        return list[Math.floor(Math.random() * list.length)];
    },

    toggleItem(item) {
        console.log('[TOGGLE] Item:', item, '| Eliminado?', !!this.state.eliminated[item]);
        if (navigator.vibrate) navigator.vibrate(10);

        if (this.state.eliminated[item]) {
            delete this.state.eliminated[item];
            this.addActivity('restore', item);
            this.emitGameAction(this.getGenericAction('restore'), '');
        } else {
            this.state.eliminated[item] = true;
            this.addActivity('eliminate', item);
            this.emitGameAction(this.getGenericAction('elimination'), '');
        }
        this.saveState();
        this.render();
    },

    isGuess(item) {
        return Object.values(this.state.guesses).includes(item);
    },

    updateHeader() {
        const { suspeito, arma, local } = this.state.guesses;
        this.updateSlot('guess-suspeito', suspeito);
        this.updateSlot('guess-arma', arma);
        this.updateSlot('guess-local', local);
    },

    updateSlot(elementId, value) {
        const el = document.getElementById(elementId);
        if (!el) return;
        const parent = el.parentElement;

        if (value) {
            el.textContent = value;
            parent.classList.add('filled');
        } else {
            el.textContent = '?';
            parent.classList.remove('filled');
        }
    },

    // Modal Logic
    currentModalType: null,

    openSelectionModal(type) {
        if (navigator.vibrate) navigator.vibrate(15);
        this.currentModalType = type;

        let jsonKey = type;
        if (type === 'suspeito') jsonKey = 'suspeitos';

        const modal = document.getElementById('selection-modal');
        const listContainer = document.getElementById('modal-list');
        const title = document.getElementById('modal-title');

        title.textContent = `Escolher ${type.charAt(0).toUpperCase() + type.slice(1)}`;
        listContainer.innerHTML = '';

        const noneBtn = document.createElement('div');
        noneBtn.className = 'modal-item';
        noneBtn.textContent = '--- Remover Seleção ---';
        noneBtn.style.color = '#8a9bbd';
        noneBtn.onclick = () => {
            this.setGuess(type, null);
            this.closeModal();
        };
        listContainer.appendChild(noneBtn);

        if (this.data && this.data[jsonKey]) {
            this.data[jsonKey].forEach(item => {
                const el = document.createElement('div');
                el.className = 'modal-item';
                el.textContent = item;
                el.onclick = () => {
                    this.setGuess(type, item);
                    this.closeModal();
                };
                listContainer.appendChild(el);
            });
        }

        modal.classList.add('visible');
    },

    closeModal() {
        document.getElementById('selection-modal').classList.remove('visible');
        this.currentModalType = null;
    },

    setGuess(type, value) {
        if (navigator.vibrate) navigator.vibrate([10, 30, 10]);
        // O JSON usa 'suspeitos' mas o state usa 'suspeito'
        let stateKey = type === 'suspeitos' ? 'suspeito' : type;

        if (value) {
            this.addActivity('guess', `${value} (${type})`);
            this.emitGameAction(this.getGenericAction('suspicion'), '');
        } else {
            this.addActivity('unguess', type);
            this.emitGameAction(this.getGenericAction('removeSuspicion'), '');
        }

        this.state.guesses[stateKey] = value;
        this.saveState();
        this.updateHeader();
        this.render();
    },

    // ===== SIDEBAR =====

    toggleSidebar() {
        const sidebar = document.getElementById('sidebar');
        const overlay = document.getElementById('sidebar-overlay');
        const isOpen = sidebar.classList.contains('open');

        if (isOpen) {
            sidebar.classList.remove('open');
            overlay.classList.remove('visible');
        } else {
            sidebar.classList.add('open');
            overlay.classList.add('visible');
        }
    },

    addActivity(type, detail) {
        const icons = {
            eliminate: '❌',
            restore: '✅',
            guess: '🔍',
            unguess: '✖️',
            reset: '🔄',
            join: '🟢',
            leave: '🟠'
        };

        const labels = {
            eliminate: 'Eliminou',
            restore: 'Restaurou',
            guess: 'Suspeita de',
            unguess: 'Removeu suspeita de',
            reset: 'Resetou o jogo',
            join: 'Entrou na sala',
            leave: 'Saiu da sala'
        };

        const now = new Date();
        const time = now.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });

        this.activityLog.unshift({
            icon: icons[type] || '•',
            label: labels[type] || type,
            detail: detail || '',
            time
        });

        // Limitar a 50 itens
        if (this.activityLog.length > 50) this.activityLog.pop();

        this.renderActivityLog();
    },

    renderActivityLog() {
        const container = document.getElementById('activity-log');
        if (!container) return;

        if (this.activityLog.length === 0) {
            container.innerHTML = '<p class="activity-empty">Nenhuma atividade ainda...</p>';
            return;
        }

        container.innerHTML = this.activityLog.map(entry => `
            <div class="activity-item">
                <span class="activity-icon">${entry.icon}</span>
                <div class="activity-text">
                    <strong>${entry.label}</strong> ${entry.detail}
                    <span class="activity-time">${entry.time}</span>
                </div>
            </div>
        `).join('');
    },

    async leaveRoom() {
        console.log('[LEAVE] Tentando sair da sala...');
        const confirmed = await customConfirm('Deseja sair da sala?', 'Sair', 'Cancelar');
        if (!confirmed) return;

        console.log('[LEAVE] Confirmado. Limpando dados...');
        localStorage.removeItem('suspeito_game_mode');
        localStorage.removeItem('suspeito_room_code');
        localStorage.removeItem('suspeito_nickname');
        localStorage.removeItem('suspeito_spy_mode');

        if (this.socket) {
            console.log('[LEAVE] Desconectando socket...');
            this.socket.disconnect();
        }

        if (this.timerInterval) clearInterval(this.timerInterval);

        console.log('[LEAVE] Redirecionando para /...');
        window.location.href = '/';
    },

    async resetGame() {
        console.log('[RESET] Tentando resetar jogo...');
        const confirmed = await customConfirm(
            'Tem certeza que deseja apagar tudo e começar uma nova partida?',
            'Resetar',
            'Cancelar'
        );
        if (!confirmed) return;
        console.log('[RESET] Confirmado. Resetando state...');

        try {
            if (navigator.vibrate) navigator.vibrate(50);
            this.state = {
                eliminated: {},
                guesses: { suspeito: null, arma: null, local: null }
            };
            console.log('[RESET] State resetado:', JSON.stringify(this.state));
            this.emitGameAction('resetou', 'o jogo');

            // Zerar timer
            if (this.socket && this.currentRoom) {
                this.socket.emit('timer_reset');
            } else {
                // Offline reset
                this.timerState = { running: false, start: null, elapsed: 0 };
                this.syncTimer(this.timerState);
            }

            this.saveState();
            console.log('[RESET] State salvo');
        } catch (e) {
            console.error('[RESET] Erro ao resetar:', e);
        }

        // Limpar dados da sala e voltar ao lobby
        console.log('[RESET] Limpando localStorage...');
        localStorage.removeItem('suspeito_game_mode');
        localStorage.removeItem('suspeito_room_code');
        localStorage.removeItem('suspeito_nickname');
        localStorage.removeItem('suspeito_spy_mode');
        console.log('[RESET] Redirecionando para /...');
        window.location.href = '/';
    }
};

document.addEventListener('DOMContentLoaded', () => {
    app.init();
});
