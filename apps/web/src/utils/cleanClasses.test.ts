import { cleanClasses } from './cleanClasses';

describe('cleanClasses', () => {
  it('joins the given class names', () => {
    expect(cleanClasses('pp-button', 'primary')).toBe('pp-button primary');
  });

  it('ignores false, null, undefined and empty values', () => {
    expect(cleanClasses('pp-chip', false, null, undefined, '', 'ok')).toBe(
      'pp-chip ok',
    );
  });

  it('returns an empty string when nothing is given', () => {
    expect(cleanClasses()).toBe('');
  });
});
