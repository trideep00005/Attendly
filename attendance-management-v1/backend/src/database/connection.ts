import Database from 'better-sqlite3';
import fs from 'node:fs';
import path from 'node:path';
import { DATABASE_PATH } from '../config/database.config.js';
import { BASE_SCHEMA_SQL } from './schema.js';
import { runDatabaseMigrations } from './migrations.js';

fs.mkdirSync(path.dirname(DATABASE_PATH), { recursive: true });

const db = new Database(DATABASE_PATH);
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');
db.pragma('busy_timeout = 5000');
db.exec(BASE_SCHEMA_SQL);
runDatabaseMigrations(db);

export default db;
