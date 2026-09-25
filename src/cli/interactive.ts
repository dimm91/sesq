export type LoopOutcome = { type: "select"; ordinal: number } | { type: "quit" };

export interface InteractiveLoopParams {
  totalCount: number;
  initialPageIndex: number;
  renderPage: (pageIndex: number) => number;
  showMessage: (message: string) => void;
  readLine: () => Promise<string | null>;
}

export async function runInteractiveLoop(params: InteractiveLoopParams): Promise<LoopOutcome> {
  let pageIndex = params.initialPageIndex;

  while (true) {
    pageIndex = params.renderPage(pageIndex);

    const raw = await params.readLine();
    if (raw === null) {
      return { type: "quit" };
    }

    const input = raw.trim();

    if (input === "") {
      pageIndex += 1;
      continue;
    }
    if (input.toLowerCase() === "p") {
      pageIndex -= 1;
      continue;
    }
    if (input.toLowerCase() === "q") {
      return { type: "quit" };
    }

    const ordinal = Number(input);
    if (Number.isInteger(ordinal) && ordinal >= 1 && ordinal <= params.totalCount) {
      return { type: "select", ordinal };
    }

    params.showMessage(`Invalid input: "${raw}". Press Enter, "p", "q", or a number between 1 and ${params.totalCount}.`);
  }
}
