import { useToast } from './useToast';

/** Messages affichés quand on copie un lien ou qu'on clique dessus sans Ctrl. */
export function useLinkFeedback() {
  const { showToast } = useToast();
  return {
    onBlockedClick: () => showToast('Ctrl+clic pour ouvrir le lien'),
    onCopied: () => showToast('Lien copié'),
    onCopyError: () => showToast('Copie impossible'),
  };
}
