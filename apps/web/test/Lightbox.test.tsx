import { describe, it, expect } from 'vitest';
import { screen, fireEvent } from '@testing-library/react';
import { renderWithApp } from './utils';
import { MediaGrid } from '../src/features/feed/MediaGrid';

const media = [
  { url: '/uploads/a.png', width: 10, height: 10, alt: '1h chart, steady climb' },
  { url: '/uploads/b.png', width: 10, height: 10, alt: '' },
];

describe('image viewer', () => {
  it('opens the clicked image with its description, steps with arrows, and closes with Escape', () => {
    renderWithApp(<MediaGrid media={media} />);
    fireEvent.click(screen.getByRole('button', { name: 'View image: 1h chart, steady climb' }));
    const viewer = screen.getByRole('dialog', { name: 'Image: 1h chart, steady climb' });
    expect(viewer).toHaveTextContent('1 / 2');
    expect(viewer).toHaveTextContent('1h chart, steady climb');
    expect(screen.getByRole('link', { name: 'Open original in a new tab' })).toHaveAttribute('href', '/uploads/a.png');
    fireEvent.keyDown(viewer, { key: 'ArrowRight' });
    expect(viewer).toHaveTextContent('2 / 2');
    fireEvent.click(screen.getByRole('button', { name: 'Next image' }));
    expect(viewer).toHaveTextContent('1 / 2');
    fireEvent(viewer, new Event('cancel', { cancelable: true }));
    expect(screen.queryByRole('dialog')).toBeNull();
  });
});
