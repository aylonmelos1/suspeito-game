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
        suspected: {}, // { "Nome do Item": true } - itens destacados em roxo
        guesses: {
            suspeito: null,
            arma: null,
            local: null
        }
    },

    // Long Press
    _longPressTimer: null,
    _longPressTriggered: false,
    LONG_PRESS_DURATION: 500, // ms

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
                    this.identity.userId = (crypto.randomUUID ? crypto.randomUUID() : ([1e7] + -1e3 + -4e3 + -8e3 + -1e11).replace(/[018]/g, c => (c ^ crypto.getRandomValues(new Uint8Array(1))[0] & 15 >> c / 4).toString(16)));
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

            // Adicionar à sidebar se for um evento relevante (tem type)
            if (data.type && (data.type.startsWith('guess-') || data.type === 'game_event')) {
                this.addActivity(data.type, data.message);
            }

            if (navigator.vibrate) navigator.vibrate([50, 50, 50]);
        });

        this.socket.on('room_joined', (data) => {
            console.log('[SOCKET] Entrou na sala:', data);
            this.currentRoom = data.roomCode;
            this.updateRoomInfo(data.roomCode);

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

    emitGameAction(action, detail, style = null) {
        if (this.socket && this.currentRoom) {
            this.socket.emit('game_action', {
                action,
                detail,
                style
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
            suspected: this.state.suspected || {},
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
                        suspected: result.suspected || {},
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

            if (this.state.suspected[item]) {
                el.classList.add('suspected');
            }

            if (this.isGuess(item)) {
                el.classList.add('selected-guess');
            }

            // --- Long Press Detection (compatível com Samsung) ---
            let _startX = 0;
            let _startY = 0;

            const startPress = (e) => {
                this._longPressTriggered = false;

                // Guardar posição inicial do toque
                if (e.touches && e.touches.length > 0) {
                    _startX = e.touches[0].clientX;
                    _startY = e.touches[0].clientY;
                }

                this._longPressTimer = setTimeout(() => {
                    this._longPressTriggered = true;
                    this.toggleSuspected(item);
                }, this.LONG_PRESS_DURATION);
            };

            const endPress = (e) => {
                e.preventDefault(); // Evita que o Samsung dispare click fantasma
                clearTimeout(this._longPressTimer);
                if (!this._longPressTriggered) {
                    // Foi toque curto
                    this.toggleItem(item);
                }
            };

            const movePress = (e) => {
                // Cancelar long press se moveu mais de 10px (scroll)
                if (e.touches && e.touches.length > 0) {
                    const dx = Math.abs(e.touches[0].clientX - _startX);
                    const dy = Math.abs(e.touches[0].clientY - _startY);
                    if (dx > 10 || dy > 10) {
                        clearTimeout(this._longPressTimer);
                    }
                }
            };

            const cancelPress = () => {
                clearTimeout(this._longPressTimer);
            };

            // Touch events (mobile)
            el.addEventListener('touchstart', startPress, { passive: true });
            el.addEventListener('touchend', endPress);
            el.addEventListener('touchmove', movePress, { passive: true });
            el.addEventListener('touchcancel', cancelPress);

            // Mouse events (desktop)
            el.addEventListener('mousedown', startPress);
            el.addEventListener('mouseup', endPress);
            el.addEventListener('mouseleave', cancelPress);

            // Desabilitar context menu no long press
            el.addEventListener('contextmenu', (e) => e.preventDefault());

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

    toggleSuspected(item) {
        console.log('[SUSPECTED] Item:', item, '| Suspeito?', !!this.state.suspected[item]);
        if (navigator.vibrate) navigator.vibrate([15, 50, 15]);

        if (this.state.suspected[item]) {
            // Remover destaque roxo
            delete this.state.suspected[item];
            this.addActivity('unsuspect', item);
        } else {
            // Adicionar destaque roxo e remover eliminação se existir
            this.state.suspected[item] = true;
            if (this.state.eliminated[item]) {
                delete this.state.eliminated[item];
            }
            this.addActivity('suspect', item);
        }
        this.saveState();
        this.render();
    },

    toggleItem(item) {
        console.log('[TOGGLE] Item:', item, '| Eliminado?', !!this.state.eliminated[item]);
        if (navigator.vibrate) navigator.vibrate(10);

        // Se o item está suspected (roxo), toque curto remove o suspected
        if (this.state.suspected[item]) {
            delete this.state.suspected[item];
            this.addActivity('unsuspect', item);
            this.saveState();
            this.render();
            return;
        }

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

    // --- Lógica de Palpites (Guess) ---

    // Variáveis temporárias para o modal de palpite
    tempGuess: { suspeito: null, arma: null, local: null },
    selectingForGuess: null, // 'suspeito', 'arma', 'local' ou null

    openGuessModal() {
        if (navigator.vibrate) navigator.vibrate(30);

        // Copiar estado atual ou iniciar vazio
        this.tempGuess = { ...this.state.guesses };

        this.updateGuessModalUI();
        const modal = document.getElementById('guess-modal');
        modal.style.display = 'flex';
        // Pequeno delay para permitir renderização antes da transição CSS
        setTimeout(() => modal.classList.add('visible'), 10);
    },

    updateGuessModalUI() {
        const types = ['suspeito', 'arma', 'local'];
        types.forEach(type => {
            const btn = document.getElementById(`modal-guess-${type}`);
            const value = this.tempGuess[type];

            if (value) {
                btn.textContent = value;
                btn.classList.add('filled');
            } else {
                btn.textContent = 'Selecionar...';
                btn.classList.remove('filled');
            }
        });
    },

    openGuessSelection(type) {
        // Mapeia singular para plural (usado nas listas)
        const pluralMap = {
            'suspeito': 'suspeitos',
            'arma': 'armas',
            'local': 'locais'
        };

        this.selectingForGuess = type;
        this.openSelectionModal(pluralMap[type]);
    },

    // Sobrescrevendo/Adaptando selectItem para lidar com palpites
    handleItemSelection(value, type) {
        // Se estamos selecionando para o modal de palpite
        if (this.selectingForGuess) {
            this.tempGuess[this.selectingForGuess] = value;
            this.updateGuessModalUI();
            this.closeModal('selection-modal');
            this.selectingForGuess = null;
            return;
        }

        // Comportamento normal (header do jogo)
        this.setGuess(type, value);
        this.closeModal('selection-modal');
    },

    submitGuess(isFinal) {
        const { suspeito, arma, local } = this.tempGuess;

        if (!suspeito || !arma || !local) {
            this.showToast('Selecione todos os itens para o palpite!', 'error');
            if (navigator.vibrate) navigator.vibrate([50, 50, 50]);
            return;
        }

        const guessText = `${suspeito} com ${arma} em ${local}`;
        const style = isFinal ? 'guess-final' : 'guess-normal';
        const actionPrefix = isFinal ? '🏆 ACUSAÇÃO FINAL:' : '💬 Palpite:';

        // Enviar ação
        this.emitGameAction(actionPrefix, guessText, style);

        // Adicionar atividade localmente também
        this.addActivity(style, `${actionPrefix} ${guessText}`);

        this.showToast(isFinal ? 'Acusação registrada!' : 'Palpite registrado!', 'success');
        this.closeModal('guess-modal');

        // Atualizar estado principal também? Sim, sincronizar é bom UX.
        this.state.guesses = { ...this.tempGuess };
        this.saveState();
        this.updateHeader();
    },

    // --- Fim Lógica de Palpites ---

    openSelectionModal(type) {
        if (navigator.vibrate) navigator.vibrate(15);
        this.currentModalType = type;

        let jsonKey = type;
        // Normalização de chaves para acessar this.data (conforme table.json)
        if (type === 'suspeito') jsonKey = 'suspeitos'; // Vem do header (singular) -> JSON (plural)

        // Ajustes para chamadas vindas do Modal de Palpite (que usam plural)
        if (type === 'armas') jsonKey = 'arma'; // JSON usa 'arma' (singular)
        if (type === 'locais') jsonKey = 'local'; // JSON usa 'local' (singular)

        const modal = document.getElementById('selection-modal');
        const listContainer = document.getElementById('modal-list');
        const title = document.getElementById('modal-title');

        // Formatar título bonito
        let displayTitle = type;
        if (type === 'suspeitos') displayTitle = 'Suspeito';
        if (type === 'armas') displayTitle = 'Arma';
        if (type === 'locais') displayTitle = 'Local';

        title.textContent = `Escolher ${displayTitle.charAt(0).toUpperCase() + displayTitle.slice(1)}`;
        listContainer.innerHTML = '';

        const noneBtn = document.createElement('div');
        noneBtn.className = 'modal-item';
        noneBtn.textContent = '--- Remover Seleção ---';
        noneBtn.style.color = '#8a9bbd';
        noneBtn.onclick = () => {
            this.handleItemSelection(null, type);
        };
        listContainer.appendChild(noneBtn);

        if (this.data && this.data[jsonKey]) {
            this.data[jsonKey].forEach(item => {
                const el = document.createElement('div');
                el.className = 'modal-item';
                el.textContent = item;
                el.onclick = () => {
                    this.handleItemSelection(item, type);
                };
                listContainer.appendChild(el);
            });
        }

        modal.style.display = 'flex';
        // Pequeno delay para permitir renderização antes da transição CSS
        requestAnimationFrame(() => modal.classList.add('visible'));
    },

    closeModal(modalId = 'selection-modal') {
        const modal = document.getElementById(modalId);
        if (modal) {
            modal.classList.remove('visible');
            modal.style.display = 'none'; // Fallback para modals que usam display none
        }
    },

    setGuess(type, value) {
        if (navigator.vibrate) navigator.vibrate([10, 30, 10]);
        // O JSON usa 'suspeitos' mas o state usa 'suspeito'
        let stateKey = type === 'suspeitos' ? 'suspeito' : type;

        if (value) {
            this.addActivity('guess', `${value} (${type})`);

            // Envia ação com estilo visual para os outros
            const toastType = 'guess-' + stateKey;
            this.emitGameAction(this.getGenericAction('suspicion'), '', toastType);

            // Premium toast
            this.showToast(value, toastType);

        } else {
            this.addActivity('unguess', type);
            this.emitGameAction(this.getGenericAction('removeSuspicion'), '');
            this.showToast('Palpite removido', 'info');
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

    updateRoomInfo(roomCode) {
        const section = document.getElementById('room-info-section');
        const valueEl = document.getElementById('room-id-value');
        if (section && valueEl && roomCode) {
            valueEl.textContent = roomCode;
            section.classList.remove('hidden');
        }
    },

    async copyRoomId() {
        const roomCode = this.currentRoom;
        if (!roomCode) return;

        try {
            await navigator.clipboard.writeText(roomCode);
            this.showToast('ID da sala copiado!', 'success');
            if (navigator.vibrate) navigator.vibrate(10);

            // Feedback visual no botão
            const btn = document.getElementById('room-id-copy');
            if (btn) {
                btn.textContent = '✅';
                setTimeout(() => { btn.textContent = '📋'; }, 1500);
            }
        } catch (e) {
            // Fallback para navegadores que não suportam clipboard API
            const text = document.createElement('textarea');
            text.value = roomCode;
            document.body.appendChild(text);
            text.select();
            document.execCommand('copy');
            document.body.removeChild(text);
            this.showToast('ID da sala copiado!', 'success');
        }
    },

    addActivity(type, detail) {
        const icons = {
            eliminate: '❌',
            restore: '✅',
            guess: '🔍',
            unguess: '✖️',
            suspect: '🟣',
            unsuspect: '⚪',
            reset: '🔄',
            join: '🟢',
            leave: '🟠',
            'guess-normal': '💬',
            'guess-final': '🏆',
            'game_event': '📢'
        };

        const labels = {
            eliminate: 'Eliminou',
            restore: 'Restaurou',
            guess: 'Suspeita de',
            unguess: 'Removeu suspeita de',
            suspect: 'Destacou',
            unsuspect: 'Removeu destaque de',
            reset: 'Resetou o jogo',
            join: 'Entrou na sala',
            leave: 'Saiu da sala',
            'guess-normal': '', // Label vazio pois a mensagem já contém o contexto
            'guess-final': '',
            'game_event': ''
        };

        const now = new Date();
        const time = now.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });

        this.activityLog.unshift({
            type, // Guardar tipo para CSS
            icon: icons[type] || '•',
            label: labels[type] !== undefined ? labels[type] : type,
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
            <div class="activity-item ${entry.type || ''}">
                <span class="activity-icon">${entry.icon}</span>
                <div class="activity-text">
                    ${entry.label ? `<strong>${entry.label}</strong> ` : ''}${entry.detail}
                    <span class="activity-time">${entry.time}</span>
                </div>
            </div>
        `).join('');
    },

    async checkForUpdates() {
        console.log('[UPDATE] Verificando atualizações...');
        const btn = document.querySelector('button[onclick="app.checkForUpdates()"]');
        const icon = btn ? btn.querySelector('.sidebar-btn-icon') : null;

        // Feedback visual
        if (icon) icon.classList.add('spinning');
        this.showToast('Verificando atualizações...', 'info');

        try {
            // 1. Force fetch of version para testar conexão
            const response = await fetch('/api/version?t=' + Date.now(), { cache: 'no-store' });
            if (response.ok) {
                const data = await response.json();
                console.log('[UPDATE] Server version:', data.version);
            }

            // 2. Unregister SW
            if ('serviceWorker' in navigator) {
                const registrations = await navigator.serviceWorker.getRegistrations();
                for (const reg of registrations) {
                    await reg.unregister();
                    console.log('[UPDATE] SW Desregistrado');
                }
            }

            // 3. Clear Caches
            if ('caches' in window) {
                const keys = await caches.keys();
                for (const key of keys) {
                    await caches.delete(key);
                    console.log('[UPDATE] Cache deletado:', key);
                }
            }

            this.showToast('Atualizando app...', 'success');

            // 4. Reload smoothly
            setTimeout(() => {
                window.location.reload();
            }, 1000);

        } catch (e) {
            console.error('[UPDATE] Erro:', e);
            this.showToast('Erro ao atualizar. Verifique sua conexão.', 'error');
            if (icon) icon.classList.remove('spinning');
        }
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

    async clearMarks() {
        const confirmed = await customConfirm(
            'Limpar todas as marcações e palpites?',
            'Limpar',
            'Cancelar'
        );
        if (!confirmed) return;

        if (navigator.vibrate) navigator.vibrate(30);

        this.state = {
            eliminated: {},
            suspected: {},
            guesses: { suspeito: null, arma: null, local: null }
        };

        // Zerar timer
        if (this.socket && this.currentRoom) {
            this.socket.emit('timer_reset');
        } else {
            this.timerState = { running: false, start: null, elapsed: 0 };
            this.syncTimer(this.timerState);
        }

        this.saveState();
        this.render();
        this.updateHeader();
        this.addActivity('reset', 'Marcações limpas');
        this.toggleSidebar();
        this.showToast('Marcações limpas!', 'success');
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
                suspected: {},
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
