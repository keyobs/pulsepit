import { GIT_TREE_QUERY } from '@api/queryClient';
import { getGitTree } from '@api/repositories.api';
import { useQuery } from '@tanstack/react-query';

export const useGitTree = (path: string) =>
  useQuery({
    queryKey: [GIT_TREE_QUERY, path],
    queryFn: () => getGitTree(path),
    staleTime: 0,
  });
