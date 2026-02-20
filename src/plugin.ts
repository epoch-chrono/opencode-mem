#!/usr/bin/env node

// Early SQLite configuration for macOS.
// Must run BEFORE any bun:sqlite Database is created in this process,
// otherwise Apple's default SQLite (which lacks extension support) gets locked in.
if (process.platform === "darwin") {
  const { Database } = await import("bun:sqlite");
  const { existsSync, readFileSync } = await import("node:fs");
  const { execSync } = await import("node:child_process");
  const { join } = await import("node:path");
  const { homedir } = await import("node:os");

  try {
    let sqlitePath: string | null = null;
    let sqliteSource = "auto";
    let customPath: string | undefined;

    // Read config for sqlite settings (lightweight parse, no dependency on config.ts)
    const configPaths = [
      join(homedir(), ".config", "opencode", "opencode-mem.jsonc"),
      join(homedir(), ".config", "opencode", "opencode-mem.json"),
    ];
    for (const p of configPaths) {
      if (existsSync(p)) {
        try {
          const raw = readFileSync(p, "utf-8");
          // Strip single-line and multi-line comments for JSONC support
          const json = raw.replace(/\/\/.*$/gm, "").replace(/\/\*[\s\S]*?\*\//g, "");
          const cfg = JSON.parse(json);
          customPath = cfg.customSqlitePath;
          sqliteSource = cfg.sqliteSource || "auto";
        } catch {}
        break;
      }
    }

    // 1) Custom path (highest priority)
    if (customPath) {
      const expanded = customPath.startsWith("~/")
        ? join(homedir(), customPath.slice(2))
        : customPath;
      if (existsSync(expanded)) sqlitePath = expanded;
    }

    // 2) mise
    if (!sqlitePath && (sqliteSource === "auto" || sqliteSource === "mise")) {
      try {
        const misePath = execSync("mise where sqlite 2>/dev/null", {
          encoding: "utf-8",
          timeout: 5000,
        }).trim();
        if (misePath) {
          const lib = join(misePath, "lib", "libsqlite3.dylib");
          if (existsSync(lib)) sqlitePath = lib;
        }
      } catch {}
    }

    // 3) Homebrew
    if (!sqlitePath && (sqliteSource === "auto" || sqliteSource === "brew")) {
      try {
        const brewPrefix = execSync("brew --prefix sqlite 2>/dev/null", {
          encoding: "utf-8",
          timeout: 5000,
        }).trim();
        if (brewPrefix) {
          const lib = join(brewPrefix, "lib", "libsqlite3.dylib");
          if (existsSync(lib)) sqlitePath = lib;
        }
      } catch {}
    }

    // 4) Common Homebrew paths
    if (!sqlitePath) {
      for (const p of [
        "/opt/homebrew/opt/sqlite/lib/libsqlite3.dylib",
        "/usr/local/opt/sqlite/lib/libsqlite3.dylib",
      ]) {
        if (existsSync(p)) {
          sqlitePath = p;
          break;
        }
      }
    }

    if (sqlitePath) {
      Database.setCustomSQLite(sqlitePath);
    }
  } catch {
    // Silently continue — connection-manager will handle with full diagnostics
  }
}

const { OpenCodeMemPlugin } = await import("./index.js");
export { OpenCodeMemPlugin };
export default OpenCodeMemPlugin;
