import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { Preview } from './Preview';

describe('the form preview', () => {
  function listed() {
    render(<Preview />);
    return screen.getAllByRole('listitem').map((item) => item.textContent);
  }

  it('lists every field in the order the form asks them', () => {
    const fields = listed();

    expect(fields.length).toBe(13);
    expect(fields[0]).toBe('First name');
    expect(fields[9]).toBe('Date of birth');
    expect(screen.getByText('What the tablet asks, in order. All 13 are required.')).toBeDefined();
  });

  it('marks a dropdown and shows its codes, since those are picked and not typed', () => {
    const dropdowns = listed().filter((text) => text?.includes('Dropdown'));

    expect(dropdowns.length).toBe(2);
    expect(dropdowns[0]).toContain('Province');
    expect(dropdowns[0]).toContain('AB · BC');
    expect(dropdowns[0]).toContain('ON');
  });
});
