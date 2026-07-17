import { describe, expect, it } from 'bun:test';
import { classifyHerdrEvent } from '../herdr-agent-status';

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
