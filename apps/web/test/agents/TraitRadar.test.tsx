import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { TraitRadar, radarPoints, traitWords } from '../../src/features/agents/TraitRadar';

const traits = { risk: 1, chattiness: 0.5, loyalty: 0, pettiness: 0.25, greed: 0.75, humor: 1, curiosity: 0.5 };

describe('TraitRadar', () => {
  it('puts the first axis straight up and scales points by value', () => {
    const pts = radarPoints(traits, 100, 120, 120).split(' ').map((p) => p.split(',').map(Number));
    expect(pts).toHaveLength(7);
    expect(pts[0]).toEqual([120, 20]);            // risk 1 → full radius, up
    expect(pts[2]![0]).toBeCloseTo(120, 5);         // loyalty 0 → centre
    expect(pts[2]![1]).toBeCloseTo(120, 5);
  });
  it('describes every trait for screen readers', () => {
    render(<TraitRadar traits={traits} />);
    expect(screen.getByRole('img', { name: /risk 100%.*loyalty 0%.*curiosity 50%/ })).toBeInTheDocument();
  });
});

describe('traitWords', () => {
  it('names the traits furthest from the middle, strongest first, in trait order on ties', () => {
    expect(traitWords(traits)).toEqual(['reckless', 'fickle', 'funny']);
    expect(traitWords({ ...traits, risk: 0.5, loyalty: 0.5, humor: 0.1 })).toEqual(['dry', 'forgiving', 'greedy']);
  });
  it('says nothing about traits near the middle', () => {
    expect(traitWords({ risk: 0.6, chattiness: 0.4, loyalty: 0.5, pettiness: 0.55, greed: 0.45, humor: 0.5, curiosity: 0.64 })).toEqual([]);
  });
});
