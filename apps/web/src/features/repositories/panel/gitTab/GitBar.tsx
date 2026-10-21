import type { Repository } from '@api/types';
import { FetchButton } from '../../row/FetchButton';
import { PushGroup } from './PushGroup';
import './gitBar.less';

interface GitBarProps {
  repository: Repository;
}

/** Fetch à gauche, actions de push regroupées à droite. */
export const GitBar = ({ repository }: GitBarProps) => (
  <div className="pp-git-bar">
    <FetchButton path={repository.path} label="Fetch All" />
    <PushGroup repository={repository} />
  </div>
);
