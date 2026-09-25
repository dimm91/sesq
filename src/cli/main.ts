#!/usr/bin/env node
import { existsSync, readFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { createInterface, type Interface } from "node:readline/promises";
import { fileURLToPath } from "node:url";
import type { SessionAdapter } from "../adapters/adapter.js";
import { AGENT_IDS, createAdapter } from "../adapters/registry.js";
import { runConfigCommand, type CommandResult } from "../config/commands.js";
import { resolvePaths } from "../config/effective.js";
import { getConfigPath, loadConfig } from "../config/load.js";
import { createCommandRunner, runDoctorChecks } from "../doctor/checks.js";
import { formatDoctorReport } from "../doctor/report.js";
import {
  formatMissingFolderPrompt,
  formatResumeConfirmation,
  formatUnarchiveConfirmation,
  parseYesNo,
} from "../resume/confirm.js";
import { resolveResumeCwd } from "../resume/cwd.js";
import { type LaunchResult, runNativeCommand } from "../resume/launch.js";
import { searchSessions, type SearchMatch } from "../search/engine.js";
import { dedupeMatches } from "../sessions/dedupe.js";
import { filterByPath, filterBySince, parseSinceDuration } from "../sessions/filter.js";
import type { SessionRecord } from "../sessions/model.js";
import { sortMatches } from "../sessions/sort.js";
import { parseArguments } from "./arguments.js";
import { runInteractiveLoop } from "./interactive.js";
import { formatProgressLine, formatSummaryLine } from "../ui/progress.js";
import { formatFooter, getPageInfo, getPageItems, pageIndexForOrdinal, resolvePageSize } from "../ui/pagination.js";
import { formatAgentName, formatResult } from "../ui/results.js";

const EXIT_SUCCESS = 0;
const EXIT_NO_RESULTS = 1;
const EXIT_INVALID_USAGE = 2;
const EXIT_FATAL_ERROR = 3;
const EXIT_INTERRUPTED = 130;

const HELP_TEXT = `sesq - search local Codex and Claude Code sessions and resume the right one

Usage:
  sesq "search text" [options]
  sesq config [path | set <key> <value>]
  sesq doctor

Search modes:
  (default)              Match every word in the query, in any order, across any message
  -r, --regex            Treat the query as a regular expression
  -F, --fixed            Match the query as a literal phrase (no word splitting)
  -s, --case-sensitive   Case-sensitive matching (only together with --regex)

Filters:
  -a, --agent <name>     Limit to one agent: codex or claude
  -p, --path <text>      Limit to sessions whose folder contains this text
      --since <window>   Limit to sessions modified within this window, e.g. 30d, 12h, 2w

Resume:
  -c, --cwd <mode>       "current" to resume from the current folder, "original" for the session's own folder

Display:
      --page-size <n>    Results per page (minimum 5, default 5)
      --no-preview       Hide the snippet preview

Commands:
  config                 Show the effective configuration, its location, or change a setting
  doctor                 Check agents, executables, session folders and unreadable files (read-only)

Other:
  -h, --help             Show this help message
      --version          Show the installed version
`;

function readPackageVersion(): string {
  const currentDir = path.dirname(fileURLToPath(import.meta.url));
  const packageJsonPath = path.join(currentDir, "..", "..", "package.json");
  const packageJson = JSON.parse(readFileSync(packageJsonPath, "utf8")) as { version: string };
  return packageJson.version;
}

async function* mergeWithProgress(
  adapters: SessionAdapter[],
  onError: (sourcePath: string, error: Error) => void,
  onProgress: (counts: Record<string, number>) => void,
): AsyncGenerator<SessionRecord> {
  const counts: Record<string, number> = {};
  let lastRender = Date.now();

  for (const adapter of adapters) {
    counts[adapter.agent] = 0;
    if (!(await adapter.isAvailable())) {
      continue;
    }
    for await (const session of adapter.discoverSessions(onError)) {
      counts[adapter.agent] += 1;
      const now = Date.now();
      if (now - lastRender > 150) {
        onProgress({ ...counts });
        lastRender = now;
      }
      yield session;
    }
  }

  onProgress({ ...counts });
}

function createProgressReporter(enabled: boolean): { report: (counts: Record<string, number>) => void; shown: () => boolean } {
  const startedAt = Date.now();
  let shown = false;

  return {
    report: (counts: Record<string, number>) => {
      if (!enabled) {
        return;
      }
      if (!shown) {
        if (Date.now() - startedAt < 300) {
          return;
        }
        shown = true;
      }
      const line = formatProgressLine(
        Object.entries(counts).map(([agent, count]) => ({ agent: formatAgentName(agent as "codex" | "claude"), count })),
      );
      process.stdout.write(`\r\x1b[K${line}`);
    },
    shown: () => shown,
  };
}

function describeLaunchFailure(agent: string, executable: string, result: LaunchResult, action: string): string {
  if (result.errorCode === "ENOENT") {
    return [
      `Fatal error: could not ${action} — the "${executable}" executable was not found.`,
      `Set its location with: sesq config set ${agent}.executable /path/to/${executable}`,
      "Run `sesq doctor` to check your setup.",
    ].join("\n");
  }
  return `Fatal error: could not ${action} (${result.error ?? `exit code ${result.exitCode}`}).`;
}

interface ResumePlan {
  session: SessionRecord;
  adapter: SessionAdapter;
  needsUnarchive: boolean;
  cwd: string;
}

// A leftover phantom "Enter" from the previous question() can resolve the next
// one instantly with an empty answer before the user can type anything — a
// real keypress can't arrive this fast, so treat a near-instant empty answer
// as noise and ask again for a real one.
const PHANTOM_ANSWER_THRESHOLD_MS = 50;

async function askRobust(rl: Interface, query: string): Promise<string> {
  const startedAt = Date.now();
  const first = await rl.question(query);
  if (first.trim() === "" && Date.now() - startedAt < PHANTOM_ANSWER_THRESHOLD_MS) {
    return rl.question(query);
  }
  return first;
}

async function resolveCwdInteractively(
  session: SessionRecord,
  mode: "original" | "current",
  rl: Interface,
): Promise<string | null> {
  const resolution = resolveResumeCwd(session, mode);
  if (resolution.status === "resolved") {
    return resolution.cwd;
  }

  const choice = (await askRobust(rl, `\n${formatMissingFolderPrompt(resolution.originalCwd)}\n> `)).trim();

  if (choice === "1") {
    return process.cwd();
  }
  if (choice === "2") {
    const chosen = (await askRobust(rl, "Folder path: ")).trim();
    if (!chosen || !existsSync(chosen)) {
      process.stderr.write(`Error: folder "${chosen}" does not exist.\n`);
      return null;
    }
    return chosen;
  }
  return null;
}

function writeResult(result: CommandResult): void {
  process.stdout.write(result.stdout);
  process.stderr.write(result.stderr);
  process.exitCode = result.exitCode;
}

async function runSubcommand(name: "config" | "doctor", rest: string[]): Promise<void> {
  if (rest.includes("--help") || rest.includes("-h")) {
    process.stdout.write(HELP_TEXT);
    process.exitCode = EXIT_SUCCESS;
    return;
  }

  const home = os.homedir();

  if (name === "config") {
    writeResult(await runConfigCommand(rest, { home, env: process.env }));
    return;
  }

  if (rest.length > 0) {
    process.stderr.write("Error: `sesq doctor` takes no arguments.\n");
    process.exitCode = EXIT_INVALID_USAGE;
    return;
  }
  const report = await runDoctorChecks({
    home,
    env: process.env,
    version: readPackageVersion(),
    nodeVersion: process.version,
    platform: `${process.platform} ${process.arch}`,
    run: createCommandRunner(),
  });
  process.stdout.write(formatDoctorReport(report));
  process.exitCode = report.issueCount > 0 ? 1 : EXIT_SUCCESS;
}

async function main(argv: string[]): Promise<void> {
  if (argv[0] === "config" || argv[0] === "doctor") {
    await runSubcommand(argv[0], argv.slice(1));
    return;
  }

  const parsed = parseArguments(argv);

  if (!parsed.ok) {
    process.stderr.write(`Error: ${parsed.error}\n`);
    process.exitCode = EXIT_INVALID_USAGE;
    return;
  }

  const args = parsed.args;

  if (args.help) {
    process.stdout.write(HELP_TEXT);
    process.exitCode = EXIT_SUCCESS;
    return;
  }
  if (args.version) {
    process.stdout.write(`${readPackageVersion()}\n`);
    process.exitCode = EXIT_SUCCESS;
    return;
  }

  let sinceMs: number | null = null;
  if (args.since) {
    const sinceResult = parseSinceDuration(args.since);
    if (!sinceResult.ok) {
      process.stderr.write(`Error: ${sinceResult.error}\n`);
      process.exitCode = EXIT_INVALID_USAGE;
      return;
    }
    sinceMs = sinceResult.ms;
  }

  const isOutputTty = Boolean(process.stdout.isTTY);
  const isInputTty = Boolean(process.stdin.isTTY);
  const colorEnabled = isOutputTty && !process.env.NO_COLOR;

  const home = os.homedir();
  const loadedConfig = await loadConfig(getConfigPath(home));
  if (!loadedConfig.ok) {
    process.stderr.write(`Error: ${loadedConfig.error}\n`);
    process.exitCode = EXIT_INVALID_USAGE;
    return;
  }
  const config = loadedConfig.config;
  const resolvedPaths = resolvePaths(config, process.env, home);

  const enabledAgents = AGENT_IDS.filter((agent) => config.agents[agent].enabled);
  if (args.agent && !enabledAgents.includes(args.agent)) {
    process.stderr.write(`Error: the "${args.agent}" agent is disabled in the configuration.\n`);
    process.exitCode = EXIT_INVALID_USAGE;
    return;
  }
  if (enabledAgents.length === 0) {
    process.stderr.write("Error: all agents are disabled in the configuration.\n");
    process.exitCode = EXIT_INVALID_USAGE;
    return;
  }
  const adapters = enabledAgents
    .filter((agent) => !args.agent || agent === args.agent)
    .map((agent) => createAdapter(agent, config, resolvedPaths));
  const filesWithErrors = new Set<string>();
  const progress = createProgressReporter(isOutputTty);

  const sessions = mergeWithProgress(
    adapters,
    (sourcePath) => filesWithErrors.add(sourcePath),
    (counts) => progress.report(counts),
  );

  const outcome = await searchSessions(sessions, {
    query: args.query,
    useRegex: args.useRegex,
    fixed: args.fixed,
    caseSensitive: args.caseSensitive,
    timeBudgetMs: args.useRegex && !args.fixed ? undefined : Number.POSITIVE_INFINITY,
  });

  if (progress.shown()) {
    process.stdout.write("\r\x1b[K");
  }

  if (outcome.error) {
    process.stderr.write(`Error: ${outcome.error}\n`);
    process.exitCode = EXIT_INVALID_USAGE;
    return;
  }

  let matches: SearchMatch[] = outcome.matches;
  if (args.path) {
    matches = filterByPath(matches, args.path);
  }
  if (sinceMs !== null) {
    matches = filterBySince(matches, sinceMs);
  }
  matches = sortMatches(dedupeMatches(matches));

  if (outcome.timedOut) {
    process.stderr.write("Warning: the regular expression search hit its time limit, so the results may be incomplete.\n");
  }

  const unreadableCount = filesWithErrors.size;
  if (unreadableCount > 0) {
    process.stderr.write(
      `Warning: ${unreadableCount} session file${unreadableCount === 1 ? "" : "s"} could not be fully read. Run \`sesq doctor\` for details.\n`,
    );
  }

  if (matches.length === 0) {
    process.stdout.write("No results.\n");
    process.stdout.write(`${formatSummaryLine({ sessionsScanned: outcome.sessionsScanned, matches: 0, unreadable: unreadableCount })}\n`);
    process.exitCode = EXIT_NO_RESULTS;
    return;
  }

  const displayOptions = { color: colorEnabled, showPreview: args.showPreview && config.showPreview };

  if (!isOutputTty || !isInputTty) {
    for (const [index, match] of matches.entries()) {
      process.stdout.write(`${formatResult(index + 1, match, displayOptions)}\n\n`);
    }
    process.stdout.write(
      `${formatSummaryLine({ sessionsScanned: outcome.sessionsScanned, matches: matches.length, unreadable: unreadableCount })}\n`,
    );
    if (!isInputTty) {
      process.stdout.write("Non-interactive session — run sesq in a terminal to select and resume a session.\n");
    }
    process.exitCode = EXIT_SUCCESS;
    return;
  }

  const pageSize = resolvePageSize(args.pageSize ?? config.pageSize);
  const cwdMode = args.cwd ?? config.defaultCwd;
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  rl.on("SIGINT", () => {
    process.stdout.write("\n");
    process.exit(EXIT_INTERRUPTED);
  });

  const renderPage = (pageIndex: number): number => {
    const info = getPageInfo(matches.length, pageSize, pageIndex);
    const pageItems = getPageItems(matches, pageSize, info.pageIndex);
    process.stdout.write("\n");
    pageItems.forEach((match, offset) => {
      process.stdout.write(`${formatResult(info.startOrdinal + offset, match, displayOptions)}\n\n`);
    });
    process.stdout.write(`${formatFooter(info)}\n`);
    return info.pageIndex;
  };

  let plan: ResumePlan | null = null;
  let pageIndex = 0;

  while (plan === null) {
    const outcomeOfLoop = await runInteractiveLoop({
      totalCount: matches.length,
      initialPageIndex: pageIndex,
      renderPage,
      showMessage: (message) => process.stdout.write(`${message}\n`),
      readLine: async () => {
        try {
          return await askRobust(rl, "> ");
        } catch {
          return null;
        }
      },
    });

    if (outcomeOfLoop.type === "quit") {
      rl.close();
      process.exitCode = EXIT_SUCCESS;
      return;
    }

    pageIndex = pageIndexForOrdinal(outcomeOfLoop.ordinal, pageSize);

    const selectedSession = matches[outcomeOfLoop.ordinal - 1].session;
    const adapter = adapters.find((a) => a.agent === selectedSession.agent);
    if (!adapter) {
      rl.close();
      process.stderr.write(`Fatal error: no adapter available for agent "${selectedSession.agent}".\n`);
      process.exitCode = EXIT_FATAL_ERROR;
      return;
    }

    const needsUnarchive = selectedSession.archived === true && adapter.buildUnarchiveCommand !== undefined;
    const confirmationPrompt = `\n${needsUnarchive ? formatUnarchiveConfirmation() : formatResumeConfirmation(selectedSession)}`;

    if (!parseYesNo(await askRobust(rl, confirmationPrompt))) {
      process.stdout.write("Cancelled.\n");
      continue;
    }

    const cwd = await resolveCwdInteractively(selectedSession, cwdMode, rl);
    if (cwd === null) {
      process.stdout.write("Cancelled.\n");
      continue;
    }

    plan = { session: selectedSession, adapter, needsUnarchive, cwd };
  }

  rl.close();

  if (plan.needsUnarchive && plan.adapter.buildUnarchiveCommand) {
    const unarchiveResult = await runNativeCommand(plan.adapter.buildUnarchiveCommand(plan.session), plan.cwd);
    if (!unarchiveResult.ok) {
      process.stderr.write(
        `${describeLaunchFailure(plan.adapter.agent, config.agents[plan.adapter.agent].executable, unarchiveResult, "restore the archived session")}\n`,
      );
      process.exitCode = EXIT_FATAL_ERROR;
      return;
    }
  }

  const resumeResult = await runNativeCommand(plan.adapter.buildResumeCommand(plan.session), plan.cwd);
  if (!resumeResult.ok && resumeResult.error) {
    process.stderr.write(
      `${describeLaunchFailure(plan.adapter.agent, config.agents[plan.adapter.agent].executable, resumeResult, `launch ${plan.adapter.agent}`)}\n`,
    );
    process.exitCode = EXIT_FATAL_ERROR;
    return;
  }
  process.exitCode = resumeResult.exitCode ?? EXIT_SUCCESS;
}

main(process.argv.slice(2)).catch((error: unknown) => {
  process.stderr.write(`Fatal error: ${(error as Error).message}\n`);
  process.exitCode = EXIT_FATAL_ERROR;
});
