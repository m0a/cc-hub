import { describe, expect, test } from 'bun:test';
import { herdrPaneCommand, indexHerdrAgentPanes } from '../../src/services/herdr';

describe('HerdrService agent identity', () => {
  test('uses agent.list instead of the foreground process name', () => {
    const agents = indexHerdrAgentPanes([{
      pane_id: 'w1:p1',
      agent: 'codex',
      agent_status: 'blocked',
      agent_session: {
        kind: 'id',
        value: 'codex-session-id',
      },
    }]);
    const pane = agents.get('w1:p1');

    expect(pane).toMatchObject({
      agent: 'codex',
      sessionId: 'codex-session-id',
      status: 'blocked',
    });
    expect(herdrPaneCommand('node-MainThread', pane)).toBe('codex');
  });
});
