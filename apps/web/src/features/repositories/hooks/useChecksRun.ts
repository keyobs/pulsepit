import { cancelChecks, getChecks, startChecks } from '@api/repositories.api';
import type { ChecksOperation } from '@api/types';
import { useToast } from '@hooks/useToast';
import { describeApiError } from '@utils/describeApiError';
import { useCallback, useEffect, useRef, useState } from 'react';

const POLL_INTERVAL_MS = 1500;
const isActive = (operation: ChecksOperation) =>
  operation.status === 'queued' ||
  operation.status === 'running' ||
  operation.push?.status === 'running';

/** Lance les contrôles d'une branche, suit l'opération jusqu'à son état final et permet l'annulation. */
export function useChecksRun(path: string, onSettled: () => void) {
  const { showToast } = useToast();
  const [operation, setOperation] = useState<ChecksOperation | null>(null);
  const [isStarting, setIsStarting] = useState(false);
  const settledRef = useRef(onSettled);
  const operationId = operation?.id;
  const active = operation ? isActive(operation) : false;

  useEffect(() => {
    settledRef.current = onSettled;
  }, [onSettled]);

  useEffect(() => {
    if (!operationId || !active) return;
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout>;
    const poll = async () => {
      try {
        const next = await getChecks(path, operationId);
        if (cancelled) return;
        setOperation(next);
        if (isActive(next)) timer = setTimeout(poll, POLL_INTERVAL_MS);
        else settledRef.current();
      } catch (error) {
        if (cancelled) return;
        showToast(
          `Suivi des contrôles impossible : ${describeApiError(error)}`,
        );
        setOperation(null);
      }
    };
    timer = setTimeout(poll, POLL_INTERVAL_MS);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [operationId, active, path, showToast]);

  const start = useCallback(
    async (branch: string) => {
      setIsStarting(true);
      try {
        setOperation(await startChecks(path, branch));
      } catch (error) {
        showToast(
          `Contrôles de ${branch} refusés : ${describeApiError(error)}`,
        );
      } finally {
        setIsStarting(false);
      }
    },
    [path, showToast],
  );

  const cancel = useCallback(async () => {
    if (!operationId) return;
    try {
      setOperation(await cancelChecks(path, operationId));
      settledRef.current();
    } catch (error) {
      showToast(`Annulation impossible : ${describeApiError(error)}`);
    }
  }, [path, operationId, showToast]);

  return { operation, isStarting, isRunning: active, start, cancel };
}
