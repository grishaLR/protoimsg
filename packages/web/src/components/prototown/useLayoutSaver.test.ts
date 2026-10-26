import { describe, expect, it } from 'vitest';
import { canSaveLayouts } from './useLayoutSaver';

describe('canSaveLayouts', () => {
  it('needs the layout collection scope', () => {
    expect(canSaveLayouts(['atproto', 'repo:app.protoimsg.town.layout'])).toBe(true);
    expect(canSaveLayouts(['repo:app.protoimsg.town.layout?action=create'])).toBe(true);
    expect(canSaveLayouts(['atproto', 'repo:equipment.rpg.item'])).toBe(false);
    expect(canSaveLayouts(['repo:app.protoimsg.town.layoutx'])).toBe(false);
    expect(canSaveLayouts([])).toBe(false);
  });
});
