import { render, screen } from '@testing-library/react';
import { LabeledCell } from './LabeledCell';

describe('LabeledCell', () => {
  it('renders the label and its content', () => {
    render(<LabeledCell label="Versions">main 1.0.0</LabeledCell>);
    expect(screen.getByText('Versions')).toBeInTheDocument();
    expect(screen.getByText('main 1.0.0')).toBeInTheDocument();
  });
});
