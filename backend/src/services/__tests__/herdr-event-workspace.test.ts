import { describe, expect, it } from 'bun:test';
import { eventWorkspaceId } from '../herdr-client';

/**
 * herdr's pane lifecycle subscriptions can't be filtered server-side
 * (protocol 16), so each HerdrControlSession filters received events by
 * workspace before reconciling. These fixtures are verbatim captures from a
 * live herdr 0.7.4 socket — the workspace id sits in a different place per
 * event shape.
 */
describe('eventWorkspaceId', () => {
  it('reads pane_created events (workspace nested in data.pane)', () => {
    const ev = {
      data: {
        pane: {
          agent_status: 'unknown',
          cwd: '/home/m0a',
          focused: false,
          pane_id: 'w1W:p1',
          tab_id: 'w1W:t1',
          workspace_id: 'w1W',
        },
        type: 'pane_created',
      },
      event: 'pane_created',
    };
    expect(eventWorkspaceId(ev)).toBe('w1W');
  });

  it('reads pane_closed events (workspace directly in data)', () => {
    const ev = {
      data: { pane_id: 'w1N:p2', type: 'pane_closed', workspace_id: 'w1N' },
      event: 'pane_closed',
    };
    expect(eventWorkspaceId(ev)).toBe('w1N');
  });

  it('prefers the direct data.workspace_id over the nested pane one', () => {
    const ev = {
      data: { workspace_id: 'w2', pane: { workspace_id: 'w3' } },
      event: 'pane_closed',
    };
    expect(eventWorkspaceId(ev)).toBe('w2');
  });

  it('returns null when no workspace is present (caller fails open)', () => {
    expect(eventWorkspaceId({ event: 'pane_created' })).toBeNull();
    expect(eventWorkspaceId({ data: {} })).toBeNull();
    expect(eventWorkspaceId({ data: { pane: {} } })).toBeNull();
    expect(eventWorkspaceId({ data: 'not-an-object' })).toBeNull();
    expect(eventWorkspaceId({ data: { workspace_id: 42 } })).toBeNull();
  });
});
