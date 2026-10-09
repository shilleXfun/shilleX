import { useState } from 'react';
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { Dialog } from '../src/components/ui/Dialog';

function Harness({ onClose }: { onClose: () => void }) {
  const [open, setOpen] = useState(true);
  return <Dialog open={open} onClose={() => { onClose(); setOpen(false); }} title="Report">body</Dialog>;
}

describe('Dialog', () => {
  it('calls onClose exactly once when closed with the close button', () => {
    const onClose = vi.fn();
    render(<Harness onClose={onClose} />);
    fireEvent.click(screen.getByRole('button', { name: 'Close' }));
    expect(onClose).toHaveBeenCalledTimes(1);
  });
  it('still reports a close that did not come from the parent (e.g. a form with method="dialog")', () => {
    const onClose = vi.fn();
    render(<Dialog open onClose={onClose} title="Report">body</Dialog>);
    const d = document.querySelector('dialog')!;
    d.close();
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});
