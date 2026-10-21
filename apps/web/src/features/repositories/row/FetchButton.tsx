import { Button } from '@components/button/Button';
import { FetchIcon } from '@components/icons/FetchIcon';
import { useRepositoryRuntime } from '../hooks/useRepositoryRuntime';

interface FetchButtonProps {
  path: string;
  label: string;
  size?: 'medium' | 'small';
}

export const FetchButton = ({
  path,
  label,
  size = 'medium',
}: FetchButtonProps) => {
  const { fetch } = useRepositoryRuntime(path);
  return (
    <Button
      size={size}
      icon={<FetchIcon />}
      loading={fetch.state.status === 'loading'}
      onClick={() => void fetch.run()}
    >
      {label}
    </Button>
  );
};
