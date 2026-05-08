import { IssueType } from '../types';

export class RetryableError extends Error {
  constructor(
    message: string,
    public readonly issueType?: IssueType
  ) {
    super(message);
    this.name = 'RetryableError';
  }
}

export class PipelineHaltError extends Error {
  constructor(
    message: string,
    public readonly issueType: IssueType
  ) {
    super(message);
    this.name = 'PipelineHaltError';
  }
}

export class MaxRetriesExhaustedError extends Error {
  constructor(
    message: string,
    public readonly issueType: IssueType = 'SYNC_EXHAUSTED'
  ) {
    super(message);
    this.name = 'MaxRetriesExhaustedError';
  }
}
