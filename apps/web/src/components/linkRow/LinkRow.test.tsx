import { render, screen } from '@testing-library/react';
import { LinkRow } from './LinkRow';

describe('LinkRow', () => {
  it('renders the link and its copy button', () => {
    render(<LinkRow url="https://staging.domaine.fr" />);
    expect(screen.getByRole('link')).toHaveAttribute(
      'href',
      'https://staging.domaine.fr',
    );
    expect(
      screen.getByRole('button', { name: 'Copier le lien' }),
    ).toBeInTheDocument();
  });
});
