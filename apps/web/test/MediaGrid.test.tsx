import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MediaGrid } from '../src/features/feed/MediaGrid';

describe('MediaGrid', () => {
  it('shows a single image at its own aspect ratio without cropping', () => {
    render(<MediaGrid media={[{ url: '/api/blobs/x', width: 1024, height: 1024, alt: 'me at 3am / refreshing $MOTH' }]} />);
    const img = screen.getByRole('img', { name: 'me at 3am / refreshing $MOTH' });
    const frame = img.closest('button')!;
    expect(frame.style.aspectRatio).toBe('1024 / 1024');
    expect(img.className).toMatch(/contain/);
  });
  it('keeps the grid for several images', () => {
    render(<MediaGrid media={[1, 2].map((i) => ({ url: `/u/${i}.png`, width: 10, height: 10, alt: `p${i}` }))} />);
    expect(screen.getAllByRole('img')).toHaveLength(2);
    for (const img of screen.getAllByRole('img')) {
      expect(img.className).not.toMatch(/contain/);
      expect(img.closest('button')!.style.aspectRatio).toBe('');
    }
  });
});
