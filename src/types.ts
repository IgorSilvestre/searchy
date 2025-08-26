export type QueryRequest = {
  phrase: string;
  dbUrl?: string;
};

export type QueryResponse = {
  rows: any[];
  rowCount: number;
  sql: string;
  truncated?: boolean;
};

