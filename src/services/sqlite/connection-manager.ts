import { Database } from "bun:sqlite";
import * as sqliteVec from "sqlite-vec";
import { existsSync, mkdirSync, statSync } from "node:fs";
import { dirname, join } from "node:path";
import { execSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { log } from "../logger.js";
import { CONFIG } from "../../config.js";

interface SqliteDiscoveryResult {
  path: string;
  source: string;
}

function findSqliteFromMise(): SqliteDiscoveryResult | null {
  try {
    const misePath = execSync("mise where sqlite 2>/dev/null", {
      encoding: "utf-8",
      timeout: 5000,
    }).trim();

    if (!misePath) return null;

    const libName = process.platform === "darwin" ? "libsqlite3.dylib" : "libsqlite3.so";
    const libPath = join(misePath, "lib", libName);

    if (existsSync(libPath)) {
      return { path: libPath, source: "mise" };
    }
  } catch {
    // mise not installed or sqlite not available via mise
  }
  return null;
}

function findSqliteFromBrew(): SqliteDiscoveryResult | null {
  try {
    const brewPrefix = execSync("brew --prefix sqlite 2>/dev/null", {
      encoding: "utf-8",
      timeout: 5000,
    }).trim();

    if (!brewPrefix) return null;

    const libName = process.platform === "darwin" ? "libsqlite3.dylib" : "libsqlite3.so";
    const libPath = join(brewPrefix, "lib", libName);

    if (existsSync(libPath)) {
      return { path: libPath, source: "brew" };
    }
  } catch {
    // brew not installed or sqlite not available via brew
  }
  return null;
}

function findSqliteFromCommonPaths(): SqliteDiscoveryResult | null {
  const commonPaths = [
    "/opt/homebrew/opt/sqlite/lib/libsqlite3.dylib",
    "/usr/local/opt/sqlite/lib/libsqlite3.dylib",
  ];

  for (const p of commonPaths) {
    if (existsSync(p)) {
      return { path: p, source: "common path" };
    }
  }
  return null;
}

function discoverSqlite(): SqliteDiscoveryResult | null {
  const customPath = CONFIG.customSqlitePath;

  if (customPath) {
    if (!existsSync(customPath)) {
      throw new Error(
        `Custom SQLite library not found at: ${customPath}\n` +
          `Please verify the path in your config.`
      );
    }
    return { path: customPath, source: "custom config" };
  }

  const sqliteSource = CONFIG.sqliteSource;

  if (sqliteSource === "mise") {
    return findSqliteFromMise();
  }

  if (sqliteSource === "brew") {
    return findSqliteFromBrew();
  }

  // "auto" mode: try mise -> brew -> common paths
  return findSqliteFromMise() ?? findSqliteFromBrew() ?? findSqliteFromCommonPaths();
}

export class ConnectionManager {
  private connections: Map<string, Database> = new Map();
  private sqliteConfigured = false;

  private configureSqlite(): void {
    if (this.sqliteConfigured) return;

    if (process.platform === "darwin") {
      const result = discoverSqlite();

      if (result) {
        try {
          Database.setCustomSQLite(result.path);
          log(`Using SQLite from ${result.source}`, { path: result.path });
        } catch (error) {
          const errorStr = String(error);
          if (errorStr.includes("SQLite already loaded")) {
            log(`SQLite already loaded, skipping setCustomSQLite`, {
              attemptedPath: result.path,
              source: result.source,
            });
          } else {
            throw new Error(
              `Failed to load SQLite library from ${result.source}: ${error}\n` +
                `Path: ${result.path}`
            );
          }
        }
      } else {
        throw new Error(
          `macOS detected but no compatible SQLite library found.\n\n` +
            `Apple's default SQLite does not support extension loading.\n` +
            `Please install SQLite via one of the following methods:\n\n` +
            `Option 1 - Using mise (recommended):\n` +
            `  mise use -g sqlite\n\n` +
            `Option 2 - Using Homebrew:\n` +
            `  brew install sqlite\n\n` +
            `Option 3 - Manual configuration:\n` +
            `  Add to ~/.config/opencode/opencode-mem.jsonc:\n` +
            `  {\n` +
            `    "customSqlitePath": "/path/to/libsqlite3.dylib"\n` +
            `  }\n\n` +
            `You can also set "sqliteSource" to "mise" or "brew" in the config\n` +
            `to force a specific discovery method.`
        );
      }
    }

    this.sqliteConfigured = true;
  }

  private loadSqliteVecExtension(db: Database): void {
    // First, try the official sqliteVec.load() which uses getLoadablePath() internally
    try {
      sqliteVec.load(db);
      return;
    } catch (officialError) {
      const errMsg = String(officialError);
      // If it's an "Unsupported platform" error, this is the known bug in
      // sqlite-vec@0.1.7-alpha.2 where validPlatform() uses "macos"/"aarch64"/"x86_64"
      // instead of Node.js values "darwin"/"arm64"/"x64".
      // Fall through to our manual loading logic.
      if (!errMsg.includes("Unsupported platform")) {
        // Some other error (e.g. extension loading disabled) — rethrow
        throw officialError;
      }
      log("sqlite-vec validPlatform bug detected, using manual extension loading", {
        platform: process.platform,
        arch: process.arch,
        error: errMsg,
      });
    }

    // Manual fallback: construct the path ourselves, bypassing the broken validPlatform check.
    // The platform-specific packages use Node.js naming (darwin, arm64, x64),
    // so we build the path directly.
    const plat = process.platform;
    const arch = process.arch;
    const suffix = plat === "win32" ? "dll" : plat === "darwin" ? "dylib" : "so";
    const os = plat === "win32" ? "windows" : plat;
    const packageName = `sqlite-vec-${os}-${arch}`;

    // Resolve relative to the sqlite-vec package directory
    const sqliteVecDir = dirname(fileURLToPath(import.meta.resolve("sqlite-vec")));
    const extensionPath = join(sqliteVecDir, "..", packageName, `vec0.${suffix}`);

    log("Loading sqlite-vec extension manually", { extensionPath, packageName });

    if (!statSync(extensionPath, { throwIfNoEntry: false })) {
      throw new Error(
        `sqlite-vec native extension not found at: ${extensionPath}\n` +
          `Platform: ${plat}-${arch}, expected package: ${packageName}\n\n` +
          `Try reinstalling dependencies:\n` +
          `  bun install`
      );
    }

    db.loadExtension(extensionPath);
  }

  private initDatabase(db: Database): void {
    db.run("PRAGMA busy_timeout = 5000");
    db.run("PRAGMA journal_mode = WAL");
    db.run("PRAGMA synchronous = NORMAL");
    db.run("PRAGMA cache_size = -64000");
    db.run("PRAGMA temp_store = MEMORY");
    db.run("PRAGMA foreign_keys = ON");

    try {
      this.loadSqliteVecExtension(db);
    } catch (error) {
      throw new Error(
        `Failed to load sqlite-vec extension: ${error}\n\n` +
          `This usually means either:\n` +
          `1. The sqlite-vec platform package is not installed (try: bun install)\n` +
          `2. SQLite extension loading is disabled (macOS default SQLite)\n\n` +
          `On macOS, you need a SQLite build with extension support:\n` +
          `  - Install via mise: mise use -g sqlite\n` +
          `  - Install via brew: brew install sqlite\n` +
          `  - Or set "customSqlitePath" in ~/.config/opencode/opencode-mem.jsonc`
      );
    }

    this.migrateSchema(db);
  }

  private migrateSchema(db: Database): void {
    try {
      const columns = db.prepare("PRAGMA table_info(memories)").all() as any[];
      const hasTags = columns.some((c) => c.name === "tags");

      if (!hasTags && columns.length > 0) {
        db.run("ALTER TABLE memories ADD COLUMN tags TEXT");
      }

      db.run(`
        CREATE VIRTUAL TABLE IF NOT EXISTS vec_tags USING vec0(
          memory_id TEXT PRIMARY KEY,
          embedding float32[${CONFIG.embeddingDimensions}] distance_metric=cosine
        )
      `);
    } catch (error) {
      log("Schema migration error", { error: String(error) });
    }
  }

  getConnection(dbPath: string): Database {
    if (this.connections.has(dbPath)) {
      return this.connections.get(dbPath)!;
    }

    this.configureSqlite();

    const dir = dirname(dbPath);
    if (!existsSync(dir)) {
      mkdirSync(dir, { recursive: true });
    }

    const db = new Database(dbPath);
    this.initDatabase(db);
    this.connections.set(dbPath, db);

    return db;
  }

  closeConnection(dbPath: string): void {
    const db = this.connections.get(dbPath);
    if (db) {
      db.run("PRAGMA wal_checkpoint(TRUNCATE)");
      db.close();
      this.connections.delete(dbPath);
    }
  }

  closeAll(): void {
    for (const [path, db] of this.connections) {
      try {
        db.run("PRAGMA wal_checkpoint(TRUNCATE)");
        db.close();
      } catch (error) {
        log("Error closing database", { path, error: String(error) });
      }
    }
    this.connections.clear();
  }

  checkpointAll(): void {
    for (const [path, db] of this.connections) {
      try {
        db.run("PRAGMA wal_checkpoint(PASSIVE)");
      } catch (error) {
        log("Error checkpointing database", { path, error: String(error) });
      }
    }
  }
}

export const connectionManager = new ConnectionManager();
