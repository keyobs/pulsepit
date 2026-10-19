import { useCallback, useEffect, useRef, useState } from 'react';

function copyWithSelection(text: string): boolean {
  const field = document.createElement('textarea');
  field.value = text;
  field.style.position = 'fixed';
  field.style.opacity = '0';
  document.body.appendChild(field);
  field.select();
  let copied = false;
  try {
    copied = document.execCommand('copy');
  } catch {
    copied = false;
  }
  field.remove();
  return copied;
}

/** Copie du texte dans le presse-papiers, avec repli si l'API est refusée. */
export function useClipboard(resetDelayMs = 1500) {
  const [copied, setCopied] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  useEffect(() => () => clearTimeout(timer.current), []);

  const copy = useCallback(
    async (text: string): Promise<boolean> => {
      let success = false;
      try {
        await navigator.clipboard.writeText(text);
        success = true;
      } catch {
        success = copyWithSelection(text);
      }
      if (success) {
        setCopied(true);
        clearTimeout(timer.current);
        timer.current = setTimeout(() => setCopied(false), resetDelayMs);
      }
      return success;
    },
    [resetDelayMs],
  );

  return { copy, copied };
}
