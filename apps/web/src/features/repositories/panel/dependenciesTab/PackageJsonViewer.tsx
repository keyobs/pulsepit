import { EmptyState } from '@components/emptyState/EmptyState';
import { Spinner } from '@components/spinner/Spinner';
import { usePackageManifest } from '@hooks/usePackageManifest';
import { describeApiError } from '@utils/describeApiError';
import { useEffect } from 'react';
import './packageJsonViewer.less';

interface PackageJsonViewerProps {
  path: string;
}

/** Contenu du package.json de HEAD, lu depuis Git (les modifications non commitées sont ignorées). */
export const PackageJsonViewer = ({ path }: PackageJsonViewerProps) => {
  const { data, status, error, run } = usePackageManifest(path);

  useEffect(() => {
    void run('head');
  }, [run]);

  if (status === 'error')
    return <EmptyState>{describeApiError(error)}</EmptyState>;
  if (!data) {
    return (
      <EmptyState>
        <Spinner /> Lecture du package.json…
      </EmptyState>
    );
  }
  return (
    <pre className="pp-package-json-viewer">
      {JSON.stringify(data.manifest, null, 2)}
    </pre>
  );
};
