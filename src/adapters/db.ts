export type RelationKind = 'table' | 'view';

export type ColumnMeta = {
  name: string;
  type: string;
  pk?: boolean;
  fk?: { ref: string; refColumn?: string };
  indexed?: boolean;
  nullable?: boolean;
};

export type RelationCard = {
  name: string; // schema-qualified
  kind: RelationKind;
  purpose?: string;
  columns: ColumnMeta[];
  join_hints: string[]; // "a.user_id -> public.users.id"
  row_estimate?: number;
};

export type ExecutionResult = { rows: any[]; rowCount: number };

export interface IntrospectionAdapter {
  testConnection(): Promise<void>;
  listRelations(): Promise<{ name: string; kind: RelationKind }[]>;
  describeRelation(name: string): Promise<RelationCard>;
  listRelationships(): Promise<Array<{ from: string; column: string; to: string; toColumn: string }>>;
  setTimeoutMs(ms: number): Promise<void>;
  runSelect(sql: string, params?: any[]): Promise<ExecutionResult>;
}

