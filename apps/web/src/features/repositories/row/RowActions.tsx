import { Button } from '@components/button/Button';
import { FetchButton } from './FetchButton';
import { OpenInEditorButton } from './OpenInEditorButton';
import './rowActions.less';

interface RowActionsProps {
  path: string;
  expanded: boolean;
  onToggle: () => void;
}

export const RowActions = ({ path, expanded, onToggle }: RowActionsProps) => (
  <div className="pp-row-actions">
    <FetchButton path={path} label="Fetch" size="small" />
    <OpenInEditorButton path={path} />
    <Button size="small" aria-expanded={expanded} onClick={onToggle}>
      {expanded ? 'Fermer' : 'Détails'}
    </Button>
  </div>
);
