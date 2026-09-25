import { parseArgs } from "node:util";

export type AgentFilter = "codex" | "claude";

export interface CliArguments {
  help: boolean;
  version: boolean;
  query: string;
  agent: AgentFilter | null;
  useRegex: boolean;
  fixed: boolean;
  caseSensitive: boolean;
  path: string | null;
  since: string | null;
  cwd: "original" | "current" | null;
  pageSize: number | undefined;
  showPreview: boolean;
}

export type ParseResult = { ok: true; args: CliArguments } | { ok: false; error: string };

const HELP_OR_VERSION_ARGS: CliArguments = {
  help: false,
  version: false,
  query: "",
  agent: null,
  useRegex: false,
  fixed: false,
  caseSensitive: false,
  path: null,
  since: null,
  cwd: null,
  pageSize: undefined,
  showPreview: true,
};

export function parseArguments(argv: string[]): ParseResult {
  let values: Record<string, string | boolean | undefined>;
  let positionals: string[];

  try {
    const result = parseArgs({
      args: argv,
      allowPositionals: true,
      options: {
        help: { type: "boolean", short: "h" },
        version: { type: "boolean" },
        regex: { type: "boolean", short: "r" },
        agent: { type: "string", short: "a" },
        fixed: { type: "boolean", short: "F" },
        "case-sensitive": { type: "boolean", short: "s" },
        path: { type: "string", short: "p" },
        cwd: { type: "string", short: "c" },
        since: { type: "string" },
        "page-size": { type: "string" },
        "no-preview": { type: "boolean" },
      },
    });
    values = result.values;
    positionals = result.positionals;
  } catch (error) {
    return { ok: false, error: (error as Error).message };
  }

  if (values.help) {
    return { ok: true, args: { ...HELP_OR_VERSION_ARGS, help: true } };
  }
  if (values.version) {
    return { ok: true, args: { ...HELP_OR_VERSION_ARGS, version: true } };
  }

  if (values.agent !== undefined && values.agent !== "codex" && values.agent !== "claude") {
    return { ok: false, error: `Invalid --agent value "${values.agent}". Expected "codex" or "claude".` };
  }

  if (values["case-sensitive"] && !values.regex) {
    return { ok: false, error: "--case-sensitive only applies together with --regex." };
  }

  if (values.cwd !== undefined && values.cwd !== "current" && values.cwd !== "original") {
    return { ok: false, error: `Invalid --cwd value "${values.cwd}". Expected "current" or "original".` };
  }

  let pageSize: number | undefined;
  if (values["page-size"] !== undefined) {
    const parsedSize = Number(values["page-size"]);
    if (!Number.isInteger(parsedSize) || parsedSize < 5) {
      return { ok: false, error: "--page-size must be an integer of at least 5." };
    }
    pageSize = parsedSize;
  }

  if (positionals.length === 0) {
    return { ok: false, error: 'Missing search query. Usage: sesq "search text"' };
  }
  if (positionals.length > 1) {
    return { ok: false, error: 'Too many arguments. Wrap your search text in quotes: sesq "search text"' };
  }

  return {
    ok: true,
    args: {
      help: false,
      version: false,
      query: positionals[0],
      agent: (values.agent as AgentFilter | undefined) ?? null,
      useRegex: Boolean(values.regex),
      fixed: Boolean(values.fixed),
      caseSensitive: Boolean(values["case-sensitive"]),
      path: (values.path as string | undefined) ?? null,
      since: (values.since as string | undefined) ?? null,
      cwd: (values.cwd as "original" | "current" | undefined) ?? null,
      pageSize,
      showPreview: !values["no-preview"],
    },
  };
}
