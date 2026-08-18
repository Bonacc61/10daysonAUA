import { describe, it, expect } from 'vitest';
import { bookUrlForActivity } from './exploreItems';
import { ACTIVITIES } from './activities';

const byId = (id: string) => ACTIVITIES.find((a) => a.id === id)!;

describe('bookUrlForActivity', () => {
  it('gives Flamingo the operator link, with no affiliate parameter on it', () => {
    const r = bookUrlForActivity(byId('flamingo-renaissance'));
    expect(r).not.toBeNull();
    expect(r!.url).toBe('https://renaissancearuba.idaypass.com/');
    expect(r!.url).not.toContain('medium=link');
    expect(r!.affiliate).toBe(false);
  });

  it('still adds the affiliate parameter to a Viator-linked activity', () => {
    const r = bookUrlForActivity({ ...byId('antilla-wreck-dive'),
      viator_item_url: 'https://viator.com/tours/x?pid=P00302487&mcid=42383' });
    expect(r!.affiliate).toBe(true);
    expect(r!.url).toContain('medium=link');
    expect(r!.url).toContain('pid=P00302487');
  });

  it('gives a free activity no link at all', () => {
    expect(bookUrlForActivity(byId('eagle-beach-morning'))).toBeNull();
  });
});
