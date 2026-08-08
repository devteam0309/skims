import { describe, it, expect, afterEach } from 'vitest';
import { render, screen, act, cleanup, waitForElementToBeRemoved } from '@testing-library/react';
import { Toaster, toast } from '../components/ui/toaster';

afterEach(cleanup);

describe('Toaster', () => {
  it('renders a message raised after mount', async () => {
    render(<Toaster />);
    await act(async () => { toast.success('Budget created'); });
    expect(screen.getByText('Budget created')).toBeInTheDocument();
  });

  /*
   * Registration moved from render into an effect, which meant anything raised before the Toaster
   * mounted was silently dropped. That is not hypothetical: the login page reports an expired
   * session from a mount effect, and React runs a child's effects before those of a later sibling
   * — which is where <Toaster /> sits. Messages raised early are queued and flushed on mount.
   */
  it('delivers a message raised before it mounted', async () => {
    toast.error('Your session has expired. Please sign in again.');
    await act(async () => { render(<Toaster />); });
    expect(screen.getByText('Your session has expired. Please sign in again.')).toBeInTheDocument();
  });

  /*
   * Ids came from Date.now(), so two messages raised in the same millisecond shared one id.
   * React saw duplicate keys, and dismissing either removed both — a message could disappear
   * before it had been read.
   */
  it('dismisses only the message that was dismissed', async () => {
    render(<Toaster />);
    await act(async () => {
      toast.success('12 expenses approved');
      toast.warning('3 skipped');
    });
    expect(screen.getAllByRole('button', { name: 'Dismiss notification' })).toHaveLength(2);

    // Dismissing by id: with a shared id this removed both, so the second message vanished
    // before it could be read.
    await act(async () => {
      screen.getAllByRole('button', { name: 'Dismiss notification' })[0].click();
    });

    // AnimatePresence keeps the dismissed node mounted for its exit animation, so this waits for
    // the removal rather than asserting on the frame right after the click.
    await waitForElementToBeRemoved(() => screen.queryByText('12 expenses approved'));
    expect(screen.getByText('3 skipped')).toBeInTheDocument();
  });

  it('announces errors assertively and everything else politely', async () => {
    render(<Toaster />);
    await act(async () => {
      toast.error('Delete failed');
      toast.success('Saved');
    });
    expect(screen.getByText('Delete failed').closest('[role]')).toHaveAttribute('role', 'alert');
    expect(screen.getByText('Saved').closest('[role]')).toHaveAttribute('role', 'status');
  });
});
