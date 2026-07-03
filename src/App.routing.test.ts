import { describe, it, expect } from 'vitest';
import { shareIdFromPath } from './App';

describe('shareIdFromPath', () => {
  it('extracts the slug from /i/<id>', () => {
    expect(shareIdFromPath('/i/Ab3xZ9qK')).toBe('Ab3xZ9qK');
  });
  it('tolerates a trailing slash', () => {
    expect(shareIdFromPath('/i/Ab3xZ9qK/')).toBe('Ab3xZ9qK');
  });
  it('returns null for non-share paths', () => {
    expect(shareIdFromPath('/itinerary')).toBeNull();
    expect(shareIdFromPath('/')).toBeNull();
  });
  it('returns null for a malformed share path', () => {
    expect(shareIdFromPath('/i/')).toBeNull();
    expect(shareIdFromPath('/i/ab/cd')).toBeNull();
  });
});
