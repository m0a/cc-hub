import { describe, expect, it } from 'bun:test';
import { classifyHerdrEvent, paneSetRequiresResubscribe } from '../herdr-agent-status';

/**
 * herdr sends event names in two namings on one socket (verified live against
 * herdr 0.7.4 / protocol 16): the per-pane `pane.agent_status_changed`
 * subscription echoes the dotted subscription type, while the global lifecycle
 * bus uses snake_case. The watcher compared everything against dotted names, so
 * the lifecycle branch never matched and new panes stopped getting an
 * agent-status subscription. These lock the observed wire names in.
 */
describe('classifyHerdrEvent', () => {
  it('classifies the dotted per-pane status event', () => {
    // report-agent on a live pane emits exactly this envelope name.
    expect(classifyHerdrEvent('pane.agent_status_changed')).toBe('status');
    // A future snake_case form from the global bus must classify the same.
    expect(classifyHerdrEvent('pane_agent_status_changed')).toBe('status');
  });

  it('classifies the snake_case lifecycle events herdr actually sends', () => {
    // workspace.create / pane close emit these snake_case names on the bus.
    expect(classifyHerdrEvent('pane_created')).toBe('lifecycle');
    expect(classifyHerdrEvent('pane_closed')).toBe('lifecycle');
    expect(classifyHerdrEvent('pane_exited')).toBe('lifecycle');
    expect(classifyHerdrEvent('pane_agent_detected')).toBe('lifecycle');
  });

  it('still classifies dotted lifecycle names (normalization is symmetric)', () => {
    expect(classifyHerdrEvent('pane.created')).toBe('lifecycle');
    expect(classifyHerdrEvent('pane.agent_detected')).toBe('lifecycle');
  });

  it('ignores unrelated events and non-strings', () => {
    expect(classifyHerdrEvent('pane_focused')).toBe('ignore');
    expect(classifyHerdrEvent('layout_updated')).toBe('ignore');
    expect(classifyHerdrEvent('')).toBe('ignore');
    expect(classifyHerdrEvent(undefined)).toBe('ignore');
    expect(classifyHerdrEvent(null)).toBe('ignore');
    expect(classifyHerdrEvent(42)).toBe('ignore');
  });
});

/**
 * The resubscribe gate, keyed off `pane.list` (ground truth) rather than the
 * event payload. herdr replays lifecycle events on every subscribe, and its
 * replay buffer can hold a phantom `pane_created` for a pane that no longer
 * exists anywhere in `pane.list` (observed live: `w2N:p1`). Resubscribing on
 * such an event reopened a stream that drew the same phantom — a self-sustaining
 * ~2.5/s loop. Diffing the real pane set makes phantoms and echoes no-ops.
 */
describe('paneSetRequiresResubscribe', () => {
  const subscribed = new Set(['w1:p1', 'w1:p2']);

  it('does not resubscribe when the live pane set is unchanged', () => {
    // The loop driver: a snapshot/phantom event leaves pane.list identical.
    expect(paneSetRequiresResubscribe(new Set(['w1:p1', 'w1:p2']), subscribed, true)).toBe(false);
  });

  it('ignores a phantom pane that pane.list never reports', () => {
    // pane.list still returns exactly the subscribed set even though herdr
    // replayed pane_created for a phantom — no resubscribe, loop broken.
    const listAfterPhantom = new Set(['w1:p1', 'w1:p2']);
    expect(paneSetRequiresResubscribe(listAfterPhantom, subscribed, true)).toBe(false);
  });

  it('resubscribes when a pane is genuinely added or removed', () => {
    expect(paneSetRequiresResubscribe(new Set(['w1:p1', 'w1:p2', 'w1:p3']), subscribed, true)).toBe(true);
    expect(paneSetRequiresResubscribe(new Set(['w1:p1']), subscribed, true)).toBe(true);
  });

  it('resubscribes on a same-size membership swap', () => {
    // p2 closed and p3 opened between polls — size matches, members differ.
    expect(paneSetRequiresResubscribe(new Set(['w1:p1', 'w1:p3']), subscribed, true)).toBe(true);
  });

  it('always subscribes when there is no live subscription (startup / after a drop)', () => {
    expect(paneSetRequiresResubscribe(subscribed, subscribed, false)).toBe(true);
    expect(paneSetRequiresResubscribe(new Set(), new Set(), false)).toBe(true);
  });
});
