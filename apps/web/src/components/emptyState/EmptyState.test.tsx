import { render, screen } from '@testing-library/react';
import { EmptyState } from './EmptyState';

describe('EmptyState', () => {
  it('renders its message', () => {
    render(<EmptyState>Aucun workflow</EmptyState>);
    expect(screen.getByText('Aucun workflow')).toBeInTheDocument();
  });
});
