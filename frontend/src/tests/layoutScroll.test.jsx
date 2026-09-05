/*
 * The navigation must not scroll away with the page.
 *
 * jsdom does no layout — scrollHeight is always 0 — so this cannot measure the bug directly. What
 * it can do is pin the two structural properties the fix depends on, which is what a regression
 * would actually change:
 *
 *   1. the staff shell is taken OUT OF FLOW (`fixed inset-0`), so nothing inside it can give the
 *      document a scrollbar of its own;
 *   2. the youth and public headers, which do live in normal document flow, are `sticky`.
 *
 * The real behaviour was verified in a browser: before the fix, /dashboard pushed the document
 * 74px past the viewport and /analytics 400px, and the sidebar moved by exactly that much. After
 * it, window scroll is 0 on every page at every zoom level, while `main` and the sidebar's own
 * nav keep their internal scrollbars.
 *
 * `h-screen` is the trap this guards against. It sets a height of 100vh but leaves the shell in
 * flow, so it is a size rather than a promise — and it reads as correct until something inside
 * grows past the viewport.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

vi.mock('../store/authStore', () => ({
  default: (selector) => {
    const state = {
      user: { firstName: 'Test', lastName: 'User', role: 'sk_chairperson' },
      isAuthenticated: true,
      logout: vi.fn(),
    };
    return typeof selector === 'function' ? selector(state) : state;
  },
}));

import DashboardLayout from '../components/layout/DashboardLayout';
import YouthLayout from '../components/layout/YouthLayout';
import PublicLayout from '../components/layout/PublicLayout';

/*
 * DashboardLayout pulls in Header, which reads the unread-notification count through React Query,
 * so the provider is part of rendering it at all. Retries off and queries disabled: this asserts
 * structure, and a layout test should not depend on a network call resolving.
 */
const wrap = (ui) => {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false, enabled: false, gcTime: 0 } },
  });
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter>{ui}</MemoryRouter>
    </QueryClientProvider>,
  );
};

beforeEach(() => { document.body.innerHTML = ''; });

describe('staff shell cannot scroll the document', () => {
  const shellOf = (container) => container.querySelector('div');

  it('is fixed to the viewport rather than merely 100vh tall', () => {
    const { container } = wrap(<DashboardLayout />);
    const shell = shellOf(container);
    expect(shell.className).toMatch(/\bfixed\b/);
    expect(shell.className).toMatch(/\binset-0\b/);
  });

  it('does not use h-screen, which leaves the shell in flow', () => {
    const { container } = wrap(<DashboardLayout />);
    expect(shellOf(container).className).not.toMatch(/\bh-screen\b/);
  });

  it('clips its own overflow so only the inner regions scroll', () => {
    const { container } = wrap(<DashboardLayout />);
    expect(shellOf(container).className).toMatch(/\boverflow-hidden\b/);
  });

  it('keeps main as the scroll container for page content', () => {
    const { container } = wrap(<DashboardLayout />);
    const main = container.querySelector('#main-content');
    expect(main).not.toBeNull();
    expect(main.className).toMatch(/overflow-y-auto/);
  });
});

describe('the sidebar scrolls internally, not with the page', () => {
  it('gives its nav its own scroll area', async () => {
    const { default: Sidebar } = await import('../components/layout/Sidebar');
    const { container } = wrap(<Sidebar isOpen={false} onClose={() => {}} />);
    const nav = container.querySelector('nav');
    expect(nav).not.toBeNull();
    expect(nav.className).toMatch(/overflow-y-auto/);
    // flex-1 is what bounds the nav between the brand header and the sign-out footer; without it
    // the nav has no height to scroll within and the whole aside grows instead.
    expect(nav.className).toMatch(/\bflex-1\b/);
  });
});

/*
 * These two are ordinary document flow on purpose — a portal page is a long read and should
 * scroll as one — so the header has to hold its own position instead.
 */
describe('youth and public navigation stays put while the page scrolls', () => {
  it('youth header is sticky to the top', () => {
    const { container } = wrap(<YouthLayout><p>content</p></YouthLayout>);
    const header = container.querySelector('header');
    expect(header.className).toMatch(/\bsticky\b/);
    expect(header.className).toMatch(/\btop-0\b/);
  });

  it('public portal header is sticky to the top', () => {
    const { container } = wrap(<PublicLayout><p>content</p></PublicLayout>);
    const header = container.querySelector('header');
    expect(header.className).toMatch(/\bsticky\b/);
    expect(header.className).toMatch(/\btop-0\b/);
  });

  it('both headers sit above page content so nothing scrolls over them', () => {
    const youth = wrap(<YouthLayout><p>content</p></YouthLayout>);
    const pub = wrap(<PublicLayout><p>content</p></PublicLayout>);
    for (const c of [youth.container, pub.container]) {
      expect(c.querySelector('header').className).toMatch(/\bz-\d+\b/);
    }
  });
});
