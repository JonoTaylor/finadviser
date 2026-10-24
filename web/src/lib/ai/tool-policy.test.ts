import { describe, expect, it } from 'vitest';
import { isRecordChangingAdviserTool } from './tool-policy';

describe('adviser record-change reporting', () => {
  it('recognises explicitly audited financial reads', () => {
    expect(isRecordChangingAdviserTool('get_owner_tax_computation')).toBe(false);
    expect(isRecordChangingAdviserTool('research_merchant')).toBe(false);
  });
  it('treats mutations and unknown names conservatively instead of inferring permission from prefixes', () => {
    for (const name of ['auto_categorize', 'remember', 'update_owner_tax_profile', 'get_unknown_future_tool', '']) {
      expect(isRecordChangingAdviserTool(name)).toBe(true);
    }
  });
});
