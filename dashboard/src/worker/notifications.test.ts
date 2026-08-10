import { describe, expect, it } from 'vitest';
import { buildReportButton } from './notifications';

describe('buildReportButton', () => {
  it('links the assignment DM button to its report round', () => {
    const roundId = '8a7a1732-38e3-43ff-9cfa-c8af6bbf01a5';

    expect(buildReportButton(roundId, '完了報告')).toEqual({
      type: 1,
      components: [{
        type: 2,
        style: 1,
        label: '完了報告',
        custom_id: `task-report:open:${roundId}`,
      }],
    });
  });
});
