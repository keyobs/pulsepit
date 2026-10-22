import type { LocalBranch } from '@api/types';

const REASON_LABELS: Record<string, string> = {
  DIRECT_PUSH_FORBIDDEN: 'Push direct interdit',
  INVALID_PUSH_POLICY: 'Politique de push invalide',
  CHECK_RUNNER_UNAVAILABLE: 'Contrôles requis non exécutables',
  CHECK_CONTEXT_MISMATCH: 'Contexte local incompatible avec les contrôles',
  CHECK_FAILED: 'Contrôles requis en échec',
  GIT_STATE_UNAVAILABLE: 'État Git illisible',
  POLICY_UNCONFIGURED: 'Politique de push non configurée',
  POLICY_INCOMPLETE: 'Politique de push partiellement inconnue',
};

export interface PushAvailability {
  canAttempt: boolean;
  reason: string | null;
}

/** Disponibilité du push déduite de l'évaluation du back ; sans donnée, le back tranche au push. */
export function getPushAvailability(
  branch: LocalBranch | undefined,
): PushAvailability {
  if (!branch) return { canAttempt: true, reason: null };
  const { canAttempt, reasons } = branch.pushAssessment;
  const code = reasons[0]?.code;
  return { canAttempt, reason: code ? (REASON_LABELS[code] ?? null) : null };
}
