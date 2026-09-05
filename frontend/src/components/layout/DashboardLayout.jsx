import { useState } from 'react';
import { Outlet, useLocation } from 'react-router-dom';
import Sidebar from './Sidebar';
import Header from './Header';

export default function DashboardLayout() {
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const { pathname } = useLocation();

  return (
    /*
     * `fixed inset-0`, not `h-screen`.
     *
     * `h-screen` is 100vh, which is a *size*, not a promise that the document cannot scroll. The
     * shell stayed in normal flow, so anything that made it — or its content — taller than the
     * visual viewport gave the document a scrollbar of its own, and the sidebar, being a static
     * flex item inside that shell, scrolled away with the page. Measured on /dashboard and
     * /analytics, where Recharts pushed the document 74px and 400px past the viewport.
     *
     * Taking the shell out of flow removes the failure mode rather than the symptom: a fixed box
     * contributes nothing to document height, so the window has nothing to scroll no matter what
     * any chart library does inside it. The sidebar cannot move, and both scroll containers that
     * should exist still do — `main` below, and the sidebar's own nav.
     */
    <div className="fixed inset-0 flex overflow-hidden bg-gray-50 dark:bg-gray-900">
      {/* Keyboard users previously had to tab through every sidebar link on each page before
          reaching the content. Visible only when focused. */}
      <a href="#main-content" className="skip-to-content">Skip to main content</a>

      <Sidebar isOpen={sidebarOpen} onClose={() => setSidebarOpen(false)} />

      <div className="flex min-w-0 flex-1 flex-col overflow-hidden">
        <Header onMenuClick={() => setSidebarOpen(true)} />
        {/*
          `key={pathname}` resets the scroll container on navigation. Without it the new page
          inherited the previous page's scroll offset, so moving from a long list to a short
          one could land the user mid-page on content they had not scrolled to.
        */}
        <main
          id="main-content"
          tabIndex={-1}
          key={pathname}
          className="flex-1 overflow-y-auto p-4 focus:outline-none lg:p-6"
        >
          <Outlet />
        </main>
      </div>
    </div>
  );
}
