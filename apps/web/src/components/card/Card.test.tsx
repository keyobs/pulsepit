import { render, screen } from '@testing-library/react';
import { Card } from './Card';

describe('Card', () => {
  it('renders the title, actions and children', () => {
    render(
      <Card title="production" actions={<button type="button">Ping</button>}>
        contenu
      </Card>,
    );
    expect(
      screen.getByRole('heading', { name: 'production' }),
    ).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Ping' })).toBeInTheDocument();
    expect(screen.getByText('contenu')).toBeInTheDocument();
  });

  it('omits the header when there is no title nor actions', () => {
    const { container } = render(<Card>seul</Card>);
    expect(container.querySelector('.pp-card-header')).toBeNull();
  });

  it('applies the alert tone', () => {
    const { container } = render(<Card tone="alert">x</Card>);
    expect(container.querySelector('.pp-card')).toHaveClass('alert');
  });
});
