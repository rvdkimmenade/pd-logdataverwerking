export interface LdvCoreAttributes {
  'dpl.core.processing_activity_id': string;
  'dpl.core.data_subject_id': string;
  'dpl.core.data_subject_id_type': string;
  'dpl.core.foreign_operation.processor'?: string;
}

export interface PdCandidateAttributes {
  'dpl.pd.case_id'?: string;
  'dpl.pd.case_type'?: string;
  'dpl.pd.service_id'?: string;
  'dpl.pd.channel'?:
    | 'web'
    | 'balie'
    | 'telefoon'
    | 'post'
    | 'batch'
    | 'api'
    | 'intern'
    | 'overig';
  'dpl.pd.data_source'?: string;
  'dpl.pd.data_destination'?: string;
}

export type LdvAttributes = LdvCoreAttributes &
  PdCandidateAttributes &
  Record<string, unknown>;
export interface LdvResource {
  attributes: Record<string, unknown>;
}
export interface LdvLogRecord {
  trace_id: string;
  span_id: string;
  parent_span_id?: string;
  name: string;
  start_time: number;
  end_time: number;
  status: 'Unset' | 'Ok' | 'Error';
  resource?: LdvResource;
  attributes: LdvAttributes;
}
export interface LdvEnvelope {
  event_id: string;
  schema_version: '1.0';
  source_application: string;
  responsible_party: string;
  created_at: string;
  payload: LdvLogRecord;
}
export type IssueCode =
  | 'SCHEMA_INVALID'
  | 'TIME_ORDER'
  | 'TIME_PRECISION'
  | 'ZERO_ID'
  | 'DEMO_SUBJECT_REQUIRED'
  | 'DEMO_CASE_REQUIRED';
export interface ValidationIssue {
  layer: 'schema' | 'semantic' | 'policy';
  code: IssueCode;
  path: string;
}
export type ValidationResult<T> =
  { valid: true; value: T } | { valid: false; issues: ValidationIssue[] };
export interface ValidationOptions {
  policy?: 'synthetic-demo';
}
