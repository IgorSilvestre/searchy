export type QueryRequest = {
  phrase: string;
  dbUrl?: string;
  // Optional: previous conversation context for /explain
  context?: string;
};

export type QueryResponse = {
  rows: any[];
  rowCount: number;
  sql: string;
  truncated?: boolean;
};

export type ExplainResponse = {
  answer: string;
  references?: string[];
};
