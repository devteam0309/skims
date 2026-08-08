import { useState } from 'react';
import { Outlet, useLocation } from 'react-router-dom';
import Sidebar from './Sidebar';
import Header from './Header';

export default function DashboardLayout() {
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const { pathname } = useLocation();

  return (
    <div className="flex h-screen overflow-hidden bg-gray-50 dark:bg-gray-900">
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
