# sesq

Search your local [Codex](https://github.com/openai/codex) and [Claude Code](https://www.anthropic.com/claude-code) conversations from one command, pick the right one, and resume it exactly where you left off.

```bash
sesq "authentication error"
```

> **Status:** early release (0.1.x).

Both agents keep their conversations on disk, but each uses different folders and formats, and their built-in pickers mostly search by name, id or recency. `sesq` searches inside prompts and answers of every agent at once, shows the results together (newest first), and hands the chosen session back to the agent's own `resume` command.

Everything runs locally. No conversation, query or metadata ever leaves your machine.

## Requirements

- Node.js 20 or later
- macOS or Linux (Windows is not supported yet)
- Codex and/or Claude Code installed, to resume their sessions. Searching only needs their session files.

GitHub Copilot CLI is planned but **not supported in 0.1**.

## Install

```bash
npx @dmr01/sesq "text to search"
# or
npm install --global @dmr01/sesq
sesq "text to search"
```

The package is called `@dmr01/sesq`; the command it installs is `sesq`.

## Usage

```bash
sesq "authentication error"              # every word must appear, any order, case/accent-insensitive
sesq "TypeError:.*undefined" --regex     # regular expression (case-insensitive by default)
sesq "ERR_[0-9]{4}" -r --case-sensitive  # regex, case-sensitive
sesq "final price" --fixed               # the exact phrase, no word splitting
sesq "login" --agent claude              # only one agent
sesq "login" --path ~/projects/store     # only sessions whose folder contains this text
sesq "login" --since 30d                 # modified in the last 30 days (also 12h, 2w)
sesq "secret" --no-preview               # hide snippets, e.g. while sharing your screen
sesq "login" --cwd current               # resume from the current folder
```

| Option | Alias | Meaning |
| --- | --- | --- |
| `--regex` | `-r` | Treat the query as a regular expression |
| `--fixed` | `-F` | Match the query as one literal phrase |
| `--case-sensitive` | `-s` | Case-sensitive matching (only with `--regex`) |
| `--agent <codex\|claude>` | `-a` | Limit to one agent |
| `--path <text>` | `-p` | Limit to sessions whose folder contains the text |
| `--since <window>` | | `30d`, `12h`, `2w`, ... |
| `--cwd <current\|original>` | `-c` | Folder to resume from (default: the session's own folder) |
| `--page-size <n>` | | Results per page (minimum 5) |
| `--no-preview` | | Hide the snippet in results |

### What is searched

The session id, title, original folder, your prompts and the assistant's visible answers. System instructions, reasoning, tool calls and tool output are excluded.

- **Default mode:** every word must appear somewhere in the same session, in any order, even in different messages. Case and accents are ignored (`autenticacion` finds `Autenticación`).
- **Regex mode:** patterns are checked before running and rejected if they contain shapes known to cause catastrophic backtracking (for example `(a+)+`). This is a heuristic guard, not a full RE2 engine.
- Results from all agents are merged into one list, newest modification first. A session that shows up twice is listed once.

### Choosing a session

```
Results 1-5 of 18 · Page 1 of 4

[Enter] next · [p] previous · [1-18] select · [q] quit
>
```

Type a result number from any page to select it, `Enter` for the next page, `p` for the previous one, `q` (or `Ctrl+C`) to quit. Selecting a session never launches anything by itself:

```
Agent:  Claude Code
Title:  Fix the login form
Folder: /Users/alex/projects/store

Resume this session? [y/N]:
```

Only an explicit `y` resumes. Anything else, including a bare `Enter`, goes back to the results list.

- If the session's original folder no longer exists, you can use the current folder, type another one, or cancel. `sesq` never creates the missing folder.
- An archived Codex session is marked `[ARCHIVED]`. Resuming it first runs `codex unarchive <id>` and only continues with `codex resume <id>` if that succeeds. This is the only thing `sesq` does that changes the state of a session, and only after you confirm.

### Non-interactive use

When output is piped, or input is not a terminal, `sesq` prints every result with no colors, progress line or prompts, and never resumes anything.

| Exit code | Meaning |
| --- | --- |
| `0` | Success |
| `1` | Valid search, no results (for `doctor`: problems found) |
| `2` | Invalid usage, query or configuration |
| `3` | Fatal error |
| `130` | Cancelled with `Ctrl+C` |

If the resumed agent runs and exits, `sesq` exits with the agent's exit code.

## Configuration

No configuration is required. Settings live in `~/.config/sesq/config.json` and only the values you change are stored.

```bash
sesq config                                   # effective settings and where each value comes from
sesq config path                              # location of the config file
sesq config set pageSize 10
sesq config set defaultCwd current
sesq config set codex.executable /path/to/codex
sesq config set claude.enabled false
sesq config set codex.sessionsPath null       # back to automatic detection
```

| Key | Default |
| --- | --- |
| `pageSize` | `5` (minimum 5) |
| `defaultCwd` | `original` (or `current`) |
| `includeArchived` | `true` |
| `showPreview` | `true` |
| `codex.enabled`, `claude.enabled` | `true` |
| `codex.executable`, `claude.executable` | `codex`, `claude` |
| `codex.sessionsPath`, `codex.archivedSessionsPath`, `claude.sessionsPath` | automatic |

Session folders are found automatically: `~/.codex/sessions` and `~/.codex/archived_sessions` (or `$CODEX_HOME`), and `~/.claude/projects` (or `$CLAUDE_CONFIG_DIR`). An explicit path in the config wins over the environment variable, which wins over the default. `sesq config` labels every value as `default`, `environment` or `custom`.

If `codex` is not on your `PATH` (for example when it only ships inside the Codex desktop app), point `codex.executable` at it.

### `sesq doctor`

```bash
sesq doctor
```

A read-only health check: versions, executables found, session folders and permissions, how many sessions each agent has, files that could not be read, ids that appear in several files with diverging histories, and whether `resume` and `unarchive` are available. It never prints prompts or answers, and exits with `1` when it finds problems.

To search for the literal word "doctor" or "config", write `sesq -- doctor`.

## Privacy and safety

- **Local only.** The package has no network code and no telemetry. An automated test scans the built code for network APIs.
- **Read-only.** Session files are only ever read. The one thing `sesq` writes is its own config file, and only when you run `sesq config set`.
- **No shell.** Agent commands run with an argument list, never through a shell, so ids and paths cannot inject commands.
- **No content in errors.** Warnings and `doctor` report counts, paths and reasons, never the text of a conversation.
- `--no-preview` hides snippets in results.

## Known limitations

- Copilot CLI and Windows are not supported yet.
- The regex guard is heuristic. As a safety net, a regex search stops scanning after 10 seconds and warns that results may be incomplete; that limit cannot interrupt a single match that is already running.
- Codex has no stored title, so the title is the first line of your first prompt. When a session starts with content injected by the app, that title can look odd.
- Codex internal review threads (sub-agent sessions) and Claude Code sub-agent messages are not listed as sessions of their own.
- Every search reads the session files directly, with no index. A synthetic collection of 4,000 sessions (650 MB) is searched in about 2 seconds using around 350 MB of memory.
- These formats belong to other products and can change without notice. Unknown fields are ignored and each file fails on its own without stopping the search.

## Development

```bash
npm install
npm test            # build + unit and CLI integration tests
npm run test:e2e    # drives the interactive flow through a pseudo-terminal with fake agents (needs python3)
npm run bench       # generates a large synthetic collection and measures a search
```

The end-to-end script replaces `claude` and `codex` with fake executables, so it never starts a real agent.

## License

MIT
