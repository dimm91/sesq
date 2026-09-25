export const MIN_PAGE_SIZE = 5;
export const DEFAULT_PAGE_SIZE = 5;

export function resolvePageSize(requested: number | undefined): number {
  if (requested === undefined) {
    return DEFAULT_PAGE_SIZE;
  }
  return Math.max(MIN_PAGE_SIZE, requested);
}

export interface PageInfo {
  pageIndex: number;
  totalPages: number;
  startOrdinal: number;
  endOrdinal: number;
  totalCount: number;
}

export function getPageInfo(totalCount: number, pageSize: number, pageIndex: number): PageInfo {
  const totalPages = Math.max(1, Math.ceil(totalCount / pageSize));
  const clampedIndex = Math.min(Math.max(0, pageIndex), totalPages - 1);
  const startOrdinal = totalCount === 0 ? 0 : clampedIndex * pageSize + 1;
  const endOrdinal = Math.min(totalCount, (clampedIndex + 1) * pageSize);
  return { pageIndex: clampedIndex, totalPages, startOrdinal, endOrdinal, totalCount };
}

export function pageIndexForOrdinal(ordinal: number, pageSize: number): number {
  return Math.floor((ordinal - 1) / pageSize);
}

export function getPageItems<T>(items: T[], pageSize: number, pageIndex: number): T[] {
  const { pageIndex: clampedIndex } = getPageInfo(items.length, pageSize, pageIndex);
  const start = clampedIndex * pageSize;
  return items.slice(start, start + pageSize);
}

export function formatFooter(info: PageInfo): string {
  if (info.totalCount === 0) {
    return "No results.";
  }
  return [
    `Results ${info.startOrdinal}-${info.endOrdinal} of ${info.totalCount} · Page ${info.pageIndex + 1} of ${info.totalPages}`,
    "",
    `[Enter] next · [p] previous · [1-${info.totalCount}] select · [q] quit`,
  ].join("\n");
}
