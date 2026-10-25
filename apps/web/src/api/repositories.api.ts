import { LIST_REQUEST_TIMEOUT_MS } from '@constants/api';
import {
  BeaconMonitoringResponse,
  BranchesResponse,
  ChecksOperation,
  DeploymentsResponse,
  FetchResponse,
  ListRepositoriesResponse,
  MonitoringResponse,
  OriginResponse,
  OutdatedResponse,
  PackageResponse,
  PushResponse,
  WorkflowsResponse,
} from '@pulsepit/contracts';
import { apiRequest } from './client';
import type { PackageRef } from './types';

const BASE = '/repositories';

export const listRepositories = (signal?: AbortSignal) =>
  apiRequest(BASE, {
    schema: ListRepositoriesResponse,
    signal,
    timeoutMs: LIST_REQUEST_TIMEOUT_MS,
  });

export const fetchRepository = (path: string) =>
  apiRequest(`${BASE}/fetch`, {
    method: 'POST',
    body: { path },
    schema: FetchResponse,
  });

export const pushBranch = (path: string, branch: string, checksId?: string) =>
  apiRequest(`${BASE}/push`, {
    method: 'POST',
    body: checksId ? { path, branch, checksId } : { path, branch },
    schema: PushResponse,
  });

export const getBranches = (path: string) =>
  apiRequest(`${BASE}/branches`, { query: { path }, schema: BranchesResponse });

export const getOutdated = (path: string) =>
  apiRequest(`${BASE}/outdated`, {
    method: 'POST',
    body: { path },
    schema: OutdatedResponse,
  });

export const getPackage = (path: string, ref: PackageRef = 'head') =>
  apiRequest(`${BASE}/package`, {
    query: { path, ref },
    schema: PackageResponse,
  });

export const checkDeployments = (path: string, environment?: string) =>
  apiRequest(`${BASE}/monitoring`, {
    method: 'POST',
    body: environment === undefined ? { path } : { path, environment },
    schema: MonitoringResponse,
  });

export const getDeployments = (path: string) =>
  apiRequest(`${BASE}/deployments`, {
    query: { path },
    schema: DeploymentsResponse,
  });

export const getWorkflows = (path: string) =>
  apiRequest(`${BASE}/workflows`, {
    query: { path },
    schema: WorkflowsResponse,
  });

export const getOrigin = (path: string) =>
  apiRequest(`${BASE}/origin`, { query: { path }, schema: OriginResponse });

export const startChecks = (path: string, branch: string) =>
  apiRequest(`${BASE}/checks`, {
    method: 'POST',
    body: { path, branch },
    schema: ChecksOperation,
  });

export const getChecks = (path: string, id: string) =>
  apiRequest(`${BASE}/checks/${id}`, {
    query: { path },
    schema: ChecksOperation,
  });

export const cancelChecks = (path: string, id: string) =>
  apiRequest(`${BASE}/checks/${id}/cancel`, {
    method: 'POST',
    query: { path },
    schema: ChecksOperation,
  });

export const getBeaconMonitoring = () =>
  apiRequest('/monitoring', { schema: BeaconMonitoringResponse });
