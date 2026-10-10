import { describe, it, expect, vi } from 'vitest';
import { render, fireEvent } from '@testing-library/react';
import { useHotkeys } from '../src/lib/hotkeys';

function Probe({ map }: { map: Record<string, () => void> }) { useHotkeys(map); return <input aria-label="field" />; }
describe('useHotkeys', () => {
  it('handles single keys and g-sequences, ignores typing in inputs', () => {
    const home = vi.fn(); const compose = vi.fn();
    const { getByLabelText } = render(<Probe map={{ 'g h': home, n: compose }} />);
    fireEvent.keyDown(document.body, { key: 'g' }); fireEvent.keyDown(document.body, { key: 'h' });
    expect(home).toHaveBeenCalledTimes(1);
    fireEvent.keyDown(document.body, { key: 'n' });
    expect(compose).toHaveBeenCalledTimes(1);
    fireEvent.keyDown(getByLabelText('field'), { key: 'n' });
    expect(compose).toHaveBeenCalledTimes(1);
    fireEvent.keyDown(document.body, { key: 'n', ctrlKey: true });
    expect(compose).toHaveBeenCalledTimes(1);
  });
});
