import { formatAgentName } from "../ui/results.js";
import type { AgentDiagnosis, DoctorReport, PathCheck } from "./checks.js";

const LABEL_WIDTH = 18;
const MAX_LISTED = 10;

function row(label: string, value: string): string {
  return `  ${`${label}:`.padEnd(LABEL_WIDTH)}${value}`;
}

function formatPath(check: PathCheck): string {
  const source = check.detail ? `${check.source}: ${check.detail}` : check.source;
  const state = !check.exists ? "missing" : check.readable ? "readable" : "not readable";
  return `${check.path} (${source}, ${state})`;
}

function formatExecutable(agent: AgentDiagnosis): string {
  const { configured, resolvedPath, version } = agent.executable;
  if (!resolvedPath) {
    return `${configured} (not found)`;
  }
  return `${resolvedPath}${version ? ` (${version})` : ""}`;
}

function formatAgent(agent: AgentDiagnosis): string[] {
  const lines = [formatAgentName(agent.agent), row("Enabled", agent.enabled ? "yes" : "no")];
  if (!agent.enabled) {
    return lines;
  }

  lines.push(row("Executable", formatExecutable(agent)));
  for (const check of agent.paths) {
    lines.push(row(check.label, formatPath(check)));
  }
  const archived = agent.archivedCount !== null ? ` (${agent.archivedCount} archived)` : "";
  lines.push(row("Sessions found", `${agent.sessionCount}${archived}`));
  lines.push(row("Unreadable files", String(agent.unreadable.length)));
  lines.push(row("Duplicate ids", String(agent.duplicates.length)));
  lines.push(row("Resume command", agent.resumeAvailable ? "available" : "not available"));
  if (agent.restoreAvailable !== null) {
    lines.push(row("Restore archived", agent.restoreAvailable ? "available" : "not available"));
  }

  for (const file of agent.unreadable.slice(0, MAX_LISTED)) {
    lines.push(`    unreadable: ${file.path} (${file.reason})`);
  }
  for (const duplicate of agent.duplicates.slice(0, MAX_LISTED)) {
    const kind = duplicate.compatible ? "same history" : "CONFLICTING histories";
    lines.push(`    duplicate ${duplicate.id} (${kind}): ${duplicate.files.join(", ")}`);
  }
  for (const note of agent.notes) {
    lines.push(`  ${note}`);
  }
  for (const issue of agent.issues) {
    lines.push(`  ! ${issue}`);
  }

  return lines;
}

export function formatDoctorReport(report: DoctorReport): string {
  const configState = report.configError
    ? "invalid"
    : report.configExists
      ? "found"
      : "not found, using defaults";

  const lines = [
    "SesQ doctor",
    "",
    "Environment",
    row("SesQ version", report.version),
    row("Node.js", report.nodeVersion),
    row("Platform", report.platform),
    row("Config file", `${report.configPath} (${configState})`),
  ];
  if (report.configError) {
    lines.push(`  ! ${report.configError}`);
  }

  for (const agent of report.agents) {
    lines.push("", ...formatAgent(agent));
  }

  lines.push(
    "",
    report.issueCount === 0
      ? "No problems found."
      : `${report.issueCount} problem${report.issueCount === 1 ? "" : "s"} found.`,
  );

  return `${lines.join("\n")}\n`;
}
