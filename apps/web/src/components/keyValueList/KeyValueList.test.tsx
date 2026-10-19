import { render, screen } from '@testing-library/react';
import { KeyValueList } from './KeyValueList';

describe('KeyValueList', () => {
  it('renders each label with its value', () => {
    render(
      <KeyValueList
        items={[
          { label: 'Branche active', value: 'develop' },
          { label: 'Modifiés', value: 4 },
        ]}
      />,
    );
    expect(screen.getByText('Branche active')).toBeInTheDocument();
    expect(screen.getByText('develop')).toBeInTheDocument();
    expect(screen.getByText('Modifiés')).toBeInTheDocument();
    expect(screen.getByText('4')).toBeInTheDocument();
  });
});
