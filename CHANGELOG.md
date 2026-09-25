# Changelog

## 0.1.0 (2026-09-25)

First release.

- Search Codex and Claude Code sessions from one command: session id, title, folder, prompts and answers.
- Default word search (case/accent-insensitive, any order), `--fixed` phrase search and guarded `--regex` search.
- Paginated interactive results with global numbering, snippets with highlighted matches, and `--agent`, `--path` and `--since` filters.
- Resume through the agent's own command, always after an explicit confirmation, with original/current folder handling and Codex restore of archived sessions.
- `sesq config` and `~/.config/sesq/config.json` for executables, session folders, page size and defaults.
- `sesq doctor`, a read-only health check.
- Local only: no network code, read-only access to session files, no shell execution.
