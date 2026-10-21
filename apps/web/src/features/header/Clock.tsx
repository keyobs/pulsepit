import { useNow } from '@hooks/useNow';
import './clock.less';

const timeZone = (() => {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone;
  } catch {
    return undefined;
  }
})();

/** Date et heure locales de l'utilisateur (langue et fuseau du navigateur). */
export const Clock = () => {
  const now = useNow();
  return (
    <time className="pp-clock" dateTime={now.toISOString()} title={timeZone}>
      <span className="pp-clock-date">
        {now.toLocaleDateString(undefined, {
          weekday: 'long',
          day: 'numeric',
          month: 'long',
          year: 'numeric',
        })}
      </span>
      <span className="pp-clock-time">
        {now.toLocaleTimeString(undefined, {
          hour: '2-digit',
          minute: '2-digit',
          second: '2-digit',
        })}
      </span>
    </time>
  );
};
