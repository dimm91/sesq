export interface AdapterProgress {
  agent: string;
  count: number;
}

export function formatProgressLine(progress: AdapterProgress[]): string {
  return `Searching: ${progress.map((p) => `${p.agent} ${p.count}`).join(" · ")}`;
}

export interface SummaryParams {
  sessionsScanned: number;
  matches: number;
  unreadable: number;
}

export function formatSummaryLine(params: SummaryParams): string {
  const sessionsPart = `${params.sessionsScanned} session${params.sessionsScanned === 1 ? "" : "s"} scanned`;
  const matchesPart = `${params.matches} result${params.matches === 1 ? "" : "s"}`;
  const unreadablePart =
    params.unreadable > 0 ? ` · ${params.unreadable} unreadable file${params.unreadable === 1 ? "" : "s"}` : "";
  return `${sessionsPart} · ${matchesPart}${unreadablePart}`;
}
