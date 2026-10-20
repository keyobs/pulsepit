import { z } from 'zod';
import { ScanError } from './repositories.js';

export const DeploymentEvidence = z.object({
  job: z.string(),
  source: z.enum([
    'environment',
    'job_name',
    'step_name',
    'action',
    'command',
    'reusable_workflow',
  ]),
  confidence: z.enum(['declared', 'heuristic', 'unknown']),
  message: z.string(),
});

export type DeploymentEvidence = z.infer<typeof DeploymentEvidence>;

export const GithubEnvironment = z.object({
  job: z.string(),
  name: z.string(),
  isDynamic: z.boolean(),
  url: z.string().nullable(),
  urlExpression: z.string().nullable(),
});

export type GithubEnvironment = z.infer<typeof GithubEnvironment>;

export const GithubWorkflowAnalysis = z.object({
  name: z.string(),
  on: z.array(z.string()),
  branches: z.array(z.string()),
  branchFilters: z.record(
    z.string(),
    z.object({ include: z.array(z.string()), exclude: z.array(z.string()) }),
  ),
  jobs: z.array(z.string()),
  environments: z.array(GithubEnvironment),
  deployment: z.object({
    status: z.enum([
      'environment_declared',
      'suspected',
      'unknown',
      'not_detected',
    ]),
    evidence: z.array(DeploymentEvidence),
  }),
});

export type GithubWorkflowAnalysis = z.infer<typeof GithubWorkflowAnalysis>;

export const GithubWorkflowAnalysisError = z.object({
  code: z.enum([
    'INVALID_YAML',
    'INVALID_WORKFLOW',
    'FILE_TOO_LARGE',
    'READ_FAILED',
  ]),
  message: z.string(),
});

export type GithubWorkflowAnalysisError = z.infer<
  typeof GithubWorkflowAnalysisError
>;

const githubSuccess = z.object({
  analysis: GithubWorkflowAnalysis,
  analysisError: z.null(),
});

const githubFailure = z.object({
  analysis: z.null(),
  analysisError: GithubWorkflowAnalysisError,
});

export const GithubWorkflowResult = z.union([githubSuccess, githubFailure]);

export type GithubWorkflowResult = z.infer<typeof GithubWorkflowResult>;

export const WorkflowEntry = z.union([
  githubSuccess.extend({
    provider: z.literal('github-actions'),
    file: z.string(),
  }),
  githubFailure.extend({
    provider: z.literal('github-actions'),
    file: z.string(),
  }),
  z.object({ provider: z.literal('gitlab-ci'), file: z.string() }),
]);

export type WorkflowEntry = z.infer<typeof WorkflowEntry>;

export const WorkflowsResponse = z.object({
  path: z.string(),
  workflows: z.array(WorkflowEntry),
  errors: z.array(ScanError),
});

export type WorkflowsResponse = z.infer<typeof WorkflowsResponse>;
