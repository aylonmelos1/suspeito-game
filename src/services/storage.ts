
import NodeCache from 'node-cache';
import sqlite3 from 'sqlite3';
import { open, Database } from 'sqlite';
import log from '../log';
import path from 'path';

// Cache Configuration: Standard TTL 24h
const CACHE_TTL = 86400;

// Interface for Room Data
export interface RoomData {
    code: string;
    players: any[]; // We store the full player array/map as JSON
    last_updated: number;
}

export class StorageService {
    private static cache = new NodeCache({ stdTTL: CACHE_TTL, checkperiod: 3600 });
    private static db: Database | null = null;
    private static dbPath = path.join(__dirname, '../../database.sqlite');

    /**
     * Initialize the Storage Service
     * Opens SQLite connection and loads active rooms into cache
     */
    static async initialize() {
        try {
            this.db = await open({
                filename: this.dbPath,
                driver: sqlite3.Database
            });

            await this.db.exec(`
                CREATE TABLE IF NOT EXISTS rooms (
                    code TEXT PRIMARY KEY,
                    data TEXT, -- JSON string of room data
                    last_updated INTEGER
                )
            `);

            log.info('💾 SQLite Database initialized');

            // Load all active rooms into cache on startup
            const rooms = await this.db.all('SELECT * FROM rooms');
            let count = 0;
            for (const row of rooms) {
                try {
                    const data = JSON.parse(row.data);
                    this.cache.set(`room:${row.code}`, data);
                    count++;
                } catch (e) {
                    log.error(`❌ Failed to parse room ${row.code}`, e);
                }
            }
            log.info(`💾 Loaded ${count} rooms from disk to cache`);

        } catch (error) {
            log.error('❌ Failed to initialize StorageService', error);
        }
    }

    /**
     * Get Room Data
     * Tries Cache first, then DB (though DB should be in cache if initialized)
     */
    static async getRoom(code: string): Promise<RoomData | null> {
        // 1. Try Cache
        const cached = this.cache.get<RoomData>(`room:${code}`);
        if (cached) return cached;

        // 2. Try DB (Fallback if cache evicted or missed init)
        if (this.db) {
            const row = await this.db.get('SELECT * FROM rooms WHERE code = ?', code);
            if (row) {
                try {
                    const data = JSON.parse(row.data);
                    this.cache.set(`room:${code}`, data);
                    return data;
                } catch (e) {
                    log.error(`❌ DB Corrupt for room ${code}`);
                }
            }
        }
        return null;
    }

    /**
     * Save Room Data
     * Writes to Cache immediately (Sync)
     * Writes to DB asynchronously (Fire & Forget)
     */
    static saveRoom(roomCode: string, data: RoomData): void {
        // 1. Update Cache
        this.cache.set(`room:${roomCode}`, data);

        // 2. Async Write to DB
        if (this.db) {
            const json = JSON.stringify(data);
            const now = Date.now();

            this.db.run(
                `INSERT OR REPLACE INTO rooms (code, data, last_updated) VALUES (?, ?, ?)`,
                roomCode, json, now
            ).catch(err => {
                log.error(`❌ Failed to persist room ${roomCode}`, err);
            });
        }
    }

    /**
     * Delete Room
     * Removes from Cache and DB
     */
    static async deleteRoom(roomCode: string): Promise<void> {
        this.cache.del(`room:${roomCode}`);
        if (this.db) {
            await this.db.run('DELETE FROM rooms WHERE code = ?', roomCode);
        }
    }
}
