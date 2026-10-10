import { describe, it, expect } from 'vitest';
import { phaseAt } from '../src/components/atmosphere/Atmosphere';

describe('phaseAt', () => {
  it('maps local hours to dawn, day, dusk and night at the boundaries', () => {
    expect([4, 5, 8, 9, 16, 17, 20, 21, 0].map(phaseAt)).toEqual(['night', 'dawn', 'dawn', 'day', 'day', 'dusk', 'dusk', 'night', 'night']);
  });
});
