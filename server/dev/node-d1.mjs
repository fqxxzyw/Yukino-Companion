// A small D1-compatible adapter over node:sqlite (Node 24+). It is used only
// by the local development server and tests. Production uses the real D1
// binding; no SQLite file or Node API is ever bundled into the Worker.
import {DatabaseSync} from 'node:sqlite';

class LocalStatement {
  constructor(db, sql) {
    this.db = db;
    this.sql = sql;
    this.args = [];
  }
  bind(...args) {
    this.args = args;
    return this;
  }
  async first(column) {
    const row = this.db.prepare(this.sql).get(...this.args);
    if (!row) return null;
    return column ? row[column] : row;
  }
  async all() {
    const results = this.db.prepare(this.sql).all(...this.args);
    return {results, success: true, meta: {changes: 0}};
  }
  async run() {
    const statement = this.db.prepare(this.sql);
    if (/\breturning\b/i.test(this.sql)) {
      const results = statement.all(...this.args);
      return {results, success: true, meta: {changes: results.length}};
    }
    const result = statement.run(...this.args);
    return {
      success: true,
      results: [],
      meta: {
        changes: Number(result.changes || 0),
        last_row_id: Number(result.lastInsertRowid || 0),
      },
    };
  }
}

export class NodeD1 {
  constructor(filename = ':memory:') {
    this.sqlite = new DatabaseSync(filename);
    this.sqlite.exec('PRAGMA foreign_keys = ON;');
    this.sqlite.exec('PRAGMA journal_mode = WAL;');
  }
  prepare(sql) {
    if (typeof sql !== 'string' || !sql.trim()) throw new Error('empty SQL');
    return new LocalStatement(this.sqlite, sql);
  }
  async batch(statements) {
    if (!Array.isArray(statements)) throw new Error('batch expects an array');
    this.sqlite.exec('BEGIN IMMEDIATE;');
    try {
      const results = [];
      for (const statement of statements) results.push(await statement.run());
      this.sqlite.exec('COMMIT;');
      return results;
    } catch (error) {
      try { this.sqlite.exec('ROLLBACK;'); } catch { /* transaction may already be closed */ }
      throw error;
    }
  }
  exec(sql) {
    this.sqlite.exec(sql);
  }
  async applyMigrations(sqlText) {
    this.sqlite.exec(sqlText);
  }
  close() {
    this.sqlite.close();
  }
}

export function migrate(db, migrations) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      name TEXT PRIMARY KEY,
      applied_at INTEGER NOT NULL
    );
  `);
  const list = Array.isArray(migrations) ? migrations : [{name: '0001_init', sql: migrations}];
  for (const migration of list) {
    const applied = db.sqlite.prepare('SELECT 1 AS ok FROM schema_migrations WHERE name = ?').get(migration.name);
    if (applied) continue;
    db.exec(migration.sql);
    db.sqlite.prepare('INSERT INTO schema_migrations(name, applied_at) VALUES(?, ?)').run(migration.name, Date.now());
  }
}
