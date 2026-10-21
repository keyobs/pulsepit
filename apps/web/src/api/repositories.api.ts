import { LIST_REQUEST_TIMEOUT_MS } from '@constants/api';
import {
  BranchesResponse,
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

export const pushBranch = (path: string, branch: string) =>
  apiRequest(`${BASE}/push`, {
    method: 'POST',
    body: { path, branch },
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

export const checkDeployments = (path: string) =>
  apiRequest(`${BASE}/monitoring`, {
    method: 'POST',
    body: { path },
    schema: MonitoringResponse,
  });

export const getWorkflows = (path: string) =>
  apiRequest(`${BASE}/workflows`, {
    query: { path },
    schema: WorkflowsResponse,
  });

export const getOrigin = (path: string) =>
  apiRequest(`${BASE}/origin`, { query: { path }, schema: OriginResponse });
