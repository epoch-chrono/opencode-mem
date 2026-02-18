# OpenCode Memory (Fork)

> **This is a fork of [opencode-mem](https://github.com/tickernelz/opencode-mem)** with improved SQLite dependency management for macOS. See [What changed in this fork](#what-changed-in-this-fork) for details.

[![license](https://img.shields.io/npm/l/opencode-mem.svg)](https://www.npmjs.com/package/opencode-mem)

![OpenCode Memory Banner](.github/banner.png)

A persistent memory system for AI coding agents that enables long-term context retention across sessions using local vector database technology.

## Visual Overview

**Project Memory Timeline:**

![Project Memory Timeline](.github/screenshot-project-memory.png)

**User Profile Viewer:**

![User Profile Viewer](.github/screenshot-user-profile.png)

## Core Features

Local vector database with SQLite, persistent project memories, automatic user profile learning, unified memory-prompt timeline, full-featured web UI, intelligent prompt-based memory extraction, multi-provider AI support (OpenAI, Anthropic), 12+ local embedding models, smart deduplication, and built-in privacy protection.

## Getting Started

Add to your OpenCode configuration at `~/.config/opencode/opencode.json`:

```jsonc
{
  "plugin": ["@epoch-chrono/opencode-mem"],
}
```

The plugin downloads automatically on next startup. On macOS, you need SQLite installed via **mise** or **Homebrew** (see [macOS SQLite Setup](#macos-sqlite-setup) below).

## Usage Examples

```typescript
memory({ mode: "add", content: "Project uses microservices architecture" });
memory({ mode: "search", query: "architecture decisions" });
memory({ mode: "profile" });
memory({ mode: "list", limit: 10 });
```

Access the web interface at `http://127.0.0.1:4747` for visual memory browsing and management.

## What changed in this fork

The original `opencode-mem` plugin relies on `bun:sqlite`, which on macOS loads Apple's built-in SQLite. Apple's SQLite is compiled with `SQLITE_OMIT_LOAD_EXTENSION`, which prevents loading the `sqlite-vec` extension required for vector search. The original plugin attempted to work around this with `Database.setCustomSQLite()` and hardcoded Homebrew paths, but this approach proved unreliable across different setups (see [#1](https://github.com/tickernelz/opencode-mem/issues/1), [#23](https://github.com/tickernelz/opencode-mem/issues/23)).

This fork replaces the hardcoded path approach with **dynamic SQLite discovery**:

- **mise support** — detects SQLite installed via `mise use -g sqlite`
- **brew support** — detects SQLite via `brew --prefix sqlite` (dynamic, not hardcoded)
- **`sqliteSource` config option** — force a specific discovery method (`"auto"`, `"mise"`, or `"brew"`)
- **Better diagnostics** — logs which SQLite was found and from where
- **Improved error messages** — guides users to install SQLite via mise or brew

### Discovery priority (auto mode)

1. `customSqlitePath` in config (manual override, always takes precedence)
2. `mise where sqlite` (dynamic detection)
3. `brew --prefix sqlite` (dynamic detection)
4. Common Homebrew paths as fallback

## macOS SQLite Setup

Apple's default SQLite does **not** support extension loading. You need SQLite from an external source.

### Option 1 — mise (recommended)

```bash
mise use -g sqlite
```

Verify:

```bash
ls "$(mise where sqlite)/lib/libsqlite3.dylib"
```

### Option 2 — Homebrew

```bash
brew install sqlite
```

Verify:

```bash
ls "$(brew --prefix sqlite)/lib/libsqlite3.dylib"
```

### Option 3 — Manual path

If auto-detection doesn't work, set the path explicitly in `~/.config/opencode/opencode-mem.jsonc`:

```jsonc
{
  "customSqlitePath": "/path/to/libsqlite3.dylib",
}
```

### Forcing a specific source

You can force the plugin to only look for SQLite from a specific source:

```jsonc
{
  "sqliteSource": "mise"   // only look for mise-installed sqlite
  // or
  "sqliteSource": "brew"   // only look for brew-installed sqlite
  // or
  "sqliteSource": "auto"   // try mise, then brew, then common paths (default)
}
```

> **Note:** Linux users typically don't need any of this — the system SQLite usually supports extension loading out of the box.

## Configuration Essentials

Configure at `~/.config/opencode/opencode-mem.jsonc`:

```jsonc
{
  "storagePath": "~/.opencode-mem/data",
  "userEmailOverride": "user@example.com",
  "userNameOverride": "John Doe",

  // macOS SQLite (see "macOS SQLite Setup" section above)
  "sqliteSource": "auto",
  // "customSqlitePath": "/opt/homebrew/opt/sqlite/lib/libsqlite3.dylib",

  "embeddingModel": "Xenova/nomic-embed-text-v1",
  "webServerEnabled": true,
  "webServerPort": 4747,

  "autoCaptureEnabled": true,
  "autoCaptureLanguage": "auto",
  "memoryProvider": "openai-chat",
  "memoryModel": "gpt-4o-mini",
  "memoryApiUrl": "https://api.openai.com/v1",
  "memoryApiKey": "sk-...",
  "memoryTemperature": 0.3,

  "showAutoCaptureToasts": true,
  "showUserProfileToasts": true,
  "showErrorToasts": true,

  "userProfileAnalysisInterval": 10,
  "maxMemories": 10,

  "compaction": {
    "enabled": true,
    "memoryLimit": 10,
  },
  "chatMessage": {
    "enabled": true,
    "maxMemories": 3,
    "excludeCurrentSession": true,
    "maxAgeDays": undefined,
    "injectOn": "first",
  },
}
```

**API Key Formats:**

```jsonc
"memoryApiKey": "sk-..."
"memoryApiKey": "file://~/.config/opencode/api-key.txt"
"memoryApiKey": "env://OPENAI_API_KEY"
```

Full documentation available in this README.

## Development & Contribution

Build and test locally:

```bash
bun install
bun run build
bun run typecheck
bun run format
```

This project is actively seeking contributions to become the definitive memory plugin for AI coding agents. Whether you are fixing bugs, adding features, improving documentation, or expanding embedding model support, your contributions are critical. The codebase is well-structured and ready for enhancement. If you hit a blocker or have improvement ideas, submit a pull request - we review and merge contributions quickly.

## License & Links

MIT License - see LICENSE file

- **This fork**: https://github.com/epoch-chrono/opencode-mem
- **Original repository**: https://github.com/tickernelz/opencode-mem
- **OpenCode Platform**: https://opencode.ai

Inspired by [opencode-supermemory](https://github.com/supermemoryai/opencode-supermemory)
