import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { act, render, renderHook, screen } from '@testing-library/react';
vi.mock('motion/react', async (importOriginal) => ({ ...(await importOriginal<typeof import('motion/react')>()), useReducedMotion: vi.fn(() => false) }));
import { useReducedMotion } from 'motion/react';
import { Tick } from '../src/components/ui/Tick';
import { Sparkline, sparkPath } from '../src/components/ui/Sparkline';
import { useFlipList } from '../src/components/ui/FlipList';
import { MOTION_MAX, claimMotion, motionsRunning, resetMotionBudget } from '../src/lib/motionBudget';

beforeEach(() => { resetMotionBudget(); vi.mocked(useReducedMotion).mockReturnValue(false); });
afterEach(() => { vi.useRealTimers(); });
const cell = (c: HTMLElement) => c.firstElementChild as HTMLElement;

describe('Tick', () => {
  it('flashes up when the number rises and down when it falls, for 600 ms', () => {
    vi.useFakeTimers();
    const { container, rerender } = render(<Tick value={1} />);
    expect(cell(container)).not.toHaveAttribute('data-flash');
    rerender(<Tick value={2} />);
    expect(cell(container)).toHaveAttribute('data-flash', 'up');
    rerender(<Tick value={1} />);
    expect(cell(container)).toHaveAttribute('data-flash', 'down');
    act(() => { vi.advanceTimersByTime(600); });
    expect(cell(container)).not.toHaveAttribute('data-flash');
  });
  it('shows the new value without a flash under reduced motion', () => {
    vi.mocked(useReducedMotion).mockReturnValue(true);
    const fmt = (n: number) => `${n} SOL`;
    const { container, rerender } = render(<Tick value={1} format={fmt} />);
    rerender(<Tick value={2} format={fmt} />);
    expect(cell(container)).not.toHaveAttribute('data-flash');
    expect(screen.getByText('2 SOL')).toBeInTheDocument(); // the screen-reader copy of the new value
  });
  it('does not flash while the page is hidden', () => {
    const hidden = vi.spyOn(Document.prototype, 'visibilityState', 'get').mockReturnValue('hidden');
    const { container, rerender } = render(<Tick value={1} />);
    rerender(<Tick value={2} />);
    expect(cell(container)).not.toHaveAttribute('data-flash');
    hidden.mockRestore();
  });
  it('runs at most eight flashes at once: the newest win', () => {
    const many = (d: number) => <>{Array.from({ length: 10 }, (_, i) => <Tick key={i} value={i + d} />)}</>;
    const { container, rerender } = render(many(0));
    rerender(many(1));
    expect([...container.children].map((c) => c.hasAttribute('data-flash'))).toEqual([false, false, true, true, true, true, true, true, true, true]);
    expect(motionsRunning()).toBe(MOTION_MAX);
  });
});

describe('motion budget', () => {
  it('ends the oldest effect when a ninth starts, and frees a slot on release', () => {
    const stops = Array.from({ length: 9 }, () => vi.fn());
    const releases = stops.map((s) => claimMotion(s)!);
    expect(stops[0]).toHaveBeenCalledOnce();
    expect(motionsRunning()).toBe(8);
    releases[8]!();
    expect(motionsRunning()).toBe(7);
  });
});

describe('Sparkline', () => {
  it('needs two points for a line', () => {
    expect(sparkPath([], 56, 18)).toBeNull();
    expect(sparkPath([1], 56, 18)).toBeNull();
  });
  it('spans the box from the first point to the last, the highest value at the top', () => {
    expect(sparkPath([1, 3, 2], 56, 18)).toBe('M0.00,16.50 L28.00,1.50 L56.00,9.00');
  });
  it('draws a flat series through the middle', () => {
    expect(sparkPath([2, 2], 56, 18)).toBe('M0.00,9.00 L56.00,9.00');
  });
  it('names itself and says which way it went; an empty one keeps its size', () => {
    render(<><Sparkline points={[1, 2]} label="LAMP rising" /><Sparkline points={[]} label="LAMP, no trades yet" /></>);
    expect(screen.getByRole('img', { name: 'LAMP rising' })).toHaveAttribute('data-dir', 'up');
    expect(screen.getByRole('img', { name: 'LAMP, no trades yet' })).toHaveStyle({ width: '56px', height: '18px' });
  });
});

describe('Sparkline motion budget', () => {
  it('holds one slot while it draws in, and one while it eases to new points', () => {
    vi.useFakeTimers();
    const { rerender } = render(<Sparkline points={[1, 2]} label="LAMP" />);
    expect(motionsRunning()).toBe(1);
    act(() => { vi.advanceTimersByTime(800); });
    expect(motionsRunning()).toBe(0);
    rerender(<Sparkline points={[1, 2, 3]} label="LAMP" />);
    expect(motionsRunning()).toBe(1);
    act(() => { vi.advanceTimersByTime(400); });
    expect(motionsRunning()).toBe(0);
  });
  it('moves nothing under reduced motion or while the page is hidden', () => {
    vi.mocked(useReducedMotion).mockReturnValue(true);
    const { rerender, unmount } = render(<Sparkline points={[1, 2]} label="LAMP" />);
    rerender(<Sparkline points={[1, 3]} label="LAMP" />);
    expect(motionsRunning()).toBe(0);
    unmount();
    vi.mocked(useReducedMotion).mockReturnValue(false);
    const hidden = vi.spyOn(Document.prototype, 'visibilityState', 'get').mockReturnValue('hidden');
    render(<Sparkline points={[1, 2]} label="LAMP" />);
    expect(motionsRunning()).toBe(0);
    hidden.mockRestore();
  });
  it('is cut short, drawn at once, when eight newer effects need the slots', () => {
    const { container } = render(<Sparkline points={[1, 2]} label="LAMP" />);
    const drawing = container.querySelector('path');
    act(() => { for (let i = 0; i < MOTION_MAX; i++) claimMotion(() => undefined); });
    expect(motionsRunning()).toBe(MOTION_MAX);
    // The line is redrawn in place at its final shape (a fresh path that does not draw in).
    expect(container.querySelector('path')).not.toBe(drawing);
  });
});

describe('useFlipList', () => {
  it('marks rows that changed places for 3 s, but not rows pushed down by a new arrival', () => {
    vi.useFakeTimers();
    const { result, rerender } = renderHook(({ ids }) => useFlipList(ids), { initialProps: { ids: ['a', 'b', 'c'] } });
    expect(result.current.size).toBe(0);
    rerender({ ids: ['new', 'a', 'b', 'c'] });
    expect(result.current.size).toBe(0);
    rerender({ ids: ['new', 'b', 'a', 'c'] });
    expect(Object.fromEntries(result.current)).toEqual({ b: 'up', a: 'down' });
    act(() => { vi.advanceTimersByTime(3000); });
    expect(result.current.size).toBe(0);
  });
});
