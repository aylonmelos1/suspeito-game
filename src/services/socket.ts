import { Server, Socket } from 'socket.io';
import log from '../log';
import { StorageService, RoomData } from './storage';

interface Player {
    id: string; // Socket ID
    nickname: string;
    roomCode: string;
    isSecret: boolean;
    userId: string; // Persistent Client UUID
}

export class SocketService {
    private static io: Server;
    // Map de socketId -> roomCode para desconexões rápidas
    private static socketMap = new Map<string, { roomCode: string, userId: string, nickname: string }>();

    static initialize(io: Server) {
        this.io = io;
        log.info('🔌 Socket.io initialized');

        this.io.on('connection', (socket: Socket) => {
            log.info(`🔌 New connection: ${socket.id}`);

            socket.on('join_room', (data: { roomCode: string, nickname: string, isSecret: boolean, userId?: string }) => {
                this.handleJoinRoom(socket, data);
            });

            socket.on('game_action', (data: { action: string, detail: string }) => {
                this.handleGameAction(socket, data);
            });

            socket.on('disconnect', () => {
                this.handleDisconnect(socket);
            });
        });
    }

    private static async handleJoinRoom(socket: Socket, data: { roomCode: string, nickname: string, isSecret: boolean, userId?: string }) {
        const { roomCode, nickname, isSecret, userId } = data;
        const code = roomCode.toUpperCase().trim();
        const finalUserId = userId || socket.id;

        log.info(`👤 Join request: ${nickname} (userId: ${finalUserId}, socketId: ${socket.id}) -> room ${code}`);

        // Limpar fantasmas antes de adicionar o novo
        await this.pruneInactivePlayers(code);

        // Get Room or Create
        let roomData = await StorageService.getRoom(code);
        if (!roomData) {
            roomData = {
                code,
                players: [],
                last_updated: Date.now()
            };
            log.info(`🏠 Room created: ${code}`);
        }

        // Verificar se o jogador já está na sala (reconexão pelo userId)
        const existingIdx = roomData.players.findIndex((p: Player) => p.userId === finalUserId);
        if (existingIdx >= 0) {
            // Atualizar o socketId do jogador existente
            const oldSocketId = roomData.players[existingIdx].id;
            roomData.players[existingIdx].id = socket.id;
            roomData.players[existingIdx].nickname = nickname;
            roomData.players[existingIdx].isSecret = isSecret;
            log.info(`🔄 Player ${nickname} reconnected: ${oldSocketId} -> ${socket.id}`);
        } else {
            // Novo jogador
            const player: Player = {
                id: socket.id,
                nickname,
                roomCode: code,
                isSecret,
                userId: finalUserId
            };
            roomData.players.push(player);
        }

        roomData.last_updated = Date.now();

        // Save
        StorageService.saveRoom(code, roomData);

        // Salvar no socketMap para desconexões
        this.socketMap.set(socket.id, { roomCode: code, userId: finalUserId, nickname });

        // Join Socket Room
        socket.join(code);

        // Notify others
        if (!isSecret) {
            socket.to(code).emit('notification', {
                message: `${nickname} entrou na sala!`,
                type: 'info'
            });
        }

        // Confirm Join
        socket.emit('room_joined', {
            roomCode: code,
            playerCount: roomData.players.length,
            mode: isSecret ? 'SECRET' : 'PUBLIC'
        });

        log.info(`✅ ${nickname} (${isSecret ? 'Secret' : 'Public'}) joined room ${code} — ${roomData.players.length} players`);
    }

    private static async handleGameAction(socket: Socket, data: { action: string, detail: string }) {
        const rooms = Array.from(socket.rooms);
        const gameRoomCode = rooms.find(r => r !== socket.id);

        if (!gameRoomCode) {
            log.warn(`[game_action] Socket ${socket.id} not in any game room`);
            return;
        }

        // Verificar player no storage
        const roomData = await StorageService.getRoom(gameRoomCode);
        if (!roomData) {
            log.warn(`[game_action] Room ${gameRoomCode} not found in storage`);
            return;
        }

        const player = roomData.players.find((p: Player) => p.id === socket.id);
        if (!player) {
            log.warn(`[game_action] Player with socketId ${socket.id} not found in room ${gameRoomCode}. Players: ${JSON.stringify(roomData.players.map((p: Player) => ({ id: p.id, nickname: p.nickname })))}`);
            return;
        }

        log.debug(`🎮 Action in ${gameRoomCode}: ${player.nickname} ${data.action} ${data.detail}`);

        if (!player.isSecret) {
            socket.to(gameRoomCode).emit('notification', {
                message: `${player.nickname} ${data.action} ${data.detail}`,
                type: 'game_event'
            });
        } else {
            log.debug(`🕵️ Secret action by ${player.nickname} ignored for broadcast`);
        }
    }

    private static async handleDisconnect(socket: Socket) {
        const mapping = this.socketMap.get(socket.id);
        if (!mapping) {
            log.debug(`🔌 Socket ${socket.id} disconnected (no room mapping)`);
            return;
        }

        const { roomCode, nickname } = mapping;
        this.socketMap.delete(socket.id);

        log.info(`🔌 ${nickname} disconnected from room ${roomCode}`);

        // Notificar outros na sala
        socket.to(roomCode).emit('notification', {
            message: `${nickname} saiu da sala`,
            type: 'warning'
        });

        // Remover player da room data
        const roomData = await StorageService.getRoom(roomCode);
        if (roomData) {
            roomData.players = roomData.players.filter((p: Player) => p.id !== socket.id);
            roomData.last_updated = Date.now();
            StorageService.saveRoom(roomCode, roomData);
            log.info(`🏠 Room ${roomCode} now has ${roomData.players.length} players`);
        }
    }

    /**
     * Remove jogadores cujo socketId não está mais conectado no server.
     * Útil para limpar "fantasmas" que o evento disconnect não pegou (crash, restart).
     */
    private static async pruneInactivePlayers(roomCode: string) {
        const roomData = await StorageService.getRoom(roomCode);
        if (!roomData || !roomData.players) return;

        const initialCount = roomData.players.length;
        const activeSockets = await this.io.in(roomCode).fetchSockets();
        const activeSocketIds = new Set(activeSockets.map(s => s.id));

        roomData.players = roomData.players.filter((p: Player) => {
            // Se o socketID do player não está na lista de sockets ativos da sala, remove
            // Mas cuidado: se ele acabou de entrar, ele deve estar na lista.
            // O fetchSockets() retorna os sockets conectados.
            return activeSocketIds.has(p.id);
        });

        if (roomData.players.length !== initialCount) {
            log.info(`🧹 Pruned ${initialCount - roomData.players.length} ghost players from room ${roomCode}`);
            roomData.last_updated = Date.now();
            StorageService.saveRoom(roomCode, roomData);

            // Atualizar quem sobrou
            this.io.to(roomCode).emit('room_joined', {
                roomCode: roomCode,
                playerCount: roomData.players.length,
                mode: 'PUBLIC' // Simplificação, idealmente preservaria o modo do user
            });
        }
    }
}
