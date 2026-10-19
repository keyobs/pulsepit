export interface GithubEnvironment {
  job: string;
  name: string;
  isDynamic: boolean;
  url: string | null;
  urlExpression: string | null;
}

export interface DeploymentEvidence {
  job: string;
  source:
    | 'environment'
    | 'job_name'
    | 'step_name'
    | 'action'
    | 'command'
    | 'reusable_workflow';
  confidence: 'declared' | 'heuristic' | 'unknown';
  message: string;
}

export interface GithubDeploymentAnalysis {
  environments: GithubEnvironment[];
  deployment: {
    status: 'environment_declared' | 'suspected' | 'unknown' | 'not_detected';
    evidence: DeploymentEvidence[];
  };
}

export class InvalidDeploymentMetadata extends Error {}

function object(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function deploymentName(value: unknown): boolean {
  return (
    typeof value === 'string' &&
    /(?:^|[^a-z0-9])deploy(?:ment|ing)?(?:$|[^a-z0-9])/i.test(value)
  );
}

function environment(job: string, value: unknown): GithubEnvironment {
  const name =
    typeof value === 'string' ? value : object(value) ? value.name : undefined;
  const rawUrl = object(value) ? value.url : undefined;
  if (typeof name !== 'string' || !name.trim()) {
    throw new InvalidDeploymentMetadata(
      'Job environments must declare a non-empty name.',
    );
  }
  if (rawUrl !== undefined && typeof rawUrl !== 'string') {
    throw new InvalidDeploymentMetadata(
      'Job environment URLs must be strings.',
    );
  }
  let url: string | null = null;
  let urlExpression: string | null = null;
  if (typeof rawUrl === 'string') {
    if (rawUrl.includes('${{')) urlExpression = rawUrl;
    else {
      try {
        const parsed = new URL(rawUrl);
        if (
          !['http:', 'https:'].includes(parsed.protocol) ||
          parsed.username ||
          parsed.password
        )
          throw new Error('Unsupported URL.');
        url = parsed.href;
      } catch {
        throw new InvalidDeploymentMetadata(
          'Static environment URLs must use HTTP or HTTPS without embedded credentials.',
        );
      }
    }
  }
  return { job, name, isDynamic: name.includes('${{'), url, urlExpression };
}

export function inspectGithubDeployments(
  jobs: Record<string, unknown>,
): GithubDeploymentAnalysis {
  const environments: GithubEnvironment[] = [];
  const evidence: DeploymentEvidence[] = [];
  for (const [job, definition] of Object.entries(jobs)) {
    if (!object(definition)) continue;
    if (definition.environment !== undefined) {
      environments.push(environment(job, definition.environment));
      evidence.push({
        job,
        source: 'environment',
        confidence: 'declared',
        message: 'The job declares a GitHub environment.',
      });
    }
    if (deploymentName(job) || deploymentName(definition.name)) {
      evidence.push({
        job,
        source: 'job_name',
        confidence: 'heuristic',
        message: 'The job name suggests a deployment.',
      });
    }
    if (typeof definition.uses === 'string') {
      evidence.push({
        job,
        source: 'reusable_workflow',
        confidence: 'unknown',
        message: 'The reusable workflow content has not been inspected.',
      });
      if (deploymentName(definition.uses.split('@')[0])) {
        evidence.push({
          job,
          source: 'reusable_workflow',
          confidence: 'heuristic',
          message: 'The reusable workflow name suggests a deployment.',
        });
      }
    }
    if (!Array.isArray(definition.steps)) continue;
    for (const step of definition.steps) {
      if (!object(step)) continue;
      if (deploymentName(step.name)) {
        evidence.push({
          job,
          source: 'step_name',
          confidence: 'heuristic',
          message: 'A step name suggests a deployment.',
        });
      }
      if (
        typeof step.uses === 'string' &&
        deploymentName(step.uses.split('@')[0])
      ) {
        evidence.push({
          job,
          source: 'action',
          confidence: 'heuristic',
          message: 'An action name suggests a deployment.',
        });
      }
      // This is a text hint, not shell evaluation. Never expose command bodies,
      // which may contain tokens or other private values.
      if (
        typeof step.run === 'string' &&
        /\b(?:(?:npm|pnpm|yarn)(?:\s+run)?\s+deploy(?:[:\w-]*)|(?:vercel|netlify|wrangler)\s+deploy)\b/i.test(
          step.run,
        )
      ) {
        evidence.push({
          job,
          source: 'command',
          confidence: 'heuristic',
          message: 'A step contains a deployment-like command.',
        });
      }
    }
  }
  const status = environments.length
    ? 'environment_declared'
    : evidence.some((item) => item.confidence === 'heuristic')
      ? 'suspected'
      : evidence.some((item) => item.confidence === 'unknown')
        ? 'unknown'
        : 'not_detected';
  return { environments, deployment: { status, evidence } };
}
