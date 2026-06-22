export interface IndexRunStats {
  totalFiles: number;
  newFiles: number;
  modifiedFiles: number;
  unchangedFiles: number;
  deletedFiles: number;
  removedFiles: number;
  skippedEmptyFiles: number;
  skippedSmallFiles: number;
  totalChunks: number;
  finalCount: number;
  manifestStatus: "ok" | "missing" | "corrupt";
  rebuildPerformed: boolean;
  batchesFlushed: number;
  extractionFailures: number;
  extractionErrors: Array<{ filePath: string; error: string }>;
}

export interface IndexStatusSummary {
  manifestStatus: "ok" | "missing" | "corrupt";
  manifestEntries: number;
  upToDateFiles: number;
  pendingFiles: number;
  lastIndexedAt?: number;
  rebuildRequired: boolean;
  storeChunkCount: number;
  manifestExpectedChunks: number;
}

export function createIndexStats(
  totalFiles: number,
  manifestStatus: IndexRunStats["manifestStatus"],
): IndexRunStats {
  return {
    totalFiles,
    newFiles: 0,
    modifiedFiles: 0,
    unchangedFiles: 0,
    deletedFiles: 0,
    removedFiles: 0,
    skippedEmptyFiles: 0,
    skippedSmallFiles: 0,
    totalChunks: 0,
    finalCount: 0,
    manifestStatus,
    rebuildPerformed: false,
    batchesFlushed: 0,
    extractionFailures: 0,
    extractionErrors: [],
  };
}
