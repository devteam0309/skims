import { Component } from 'react';
import { AlertTriangle } from 'lucide-react';

/**
 * Last-resort crash screen.
 *
 * The one screen a user meets at the worst possible moment, and the only one in the app with no
 * dark variants — so a crash in dark mode flashed a full-bleed white page. It also offered a
 * single action, "Reload page", which does nothing for the case where the stored state or route
 * is what crashes: the reload lands on the same page and breaks again. There is now a way back
 * to a known-good route.
 */
export default class ErrorBoundary extends Component {
  constructor(props) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error) {
    return { hasError: true, error };
  }

  componentDidCatch(error, info) {
    console.error('ErrorBoundary caught:', error, info);
  }

  render() {
    if (!this.state.hasError) return this.props.children;

    return (
      <div className="flex min-h-screen items-center justify-center bg-gray-50 p-4 dark:bg-gray-900">
        <div
          // Announced, because this replaces the whole page with no other signal that anything
          // changed.
          role="alert"
          className="w-full max-w-md rounded-2xl border border-gray-200 bg-white p-8 text-center shadow-sm dark:border-gray-700 dark:bg-gray-800"
        >
          <span className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-full bg-red-50 dark:bg-red-500/15">
            <AlertTriangle size={28} className="text-red-500 dark:text-red-400" aria-hidden="true" />
          </span>
          <h1 className="mb-2 text-xl font-bold text-gray-900 dark:text-white">Something went wrong</h1>
          <p className="mb-6 text-sm text-gray-500 dark:text-gray-400">
            An unexpected error occurred. Reloading usually fixes it — if it happens again, go back
            to the dashboard and report it to your administrator.
          </p>

          <div className="flex flex-col-reverse gap-3 sm:flex-row sm:justify-center">
            {/*
              A plain anchor, not a react-router Link: the router is inside the tree that just
              crashed, so navigating through it may re-enter the same failure. A full page load
              discards the broken state entirely.
            */}
            <a
              href="/dashboard"
              className="rounded-xl border border-gray-300 px-5 py-2.5 text-sm font-medium text-gray-700 transition-colors hover:bg-gray-50 dark:border-gray-600 dark:text-gray-300 dark:hover:bg-gray-700"
            >
              Back to dashboard
            </a>
            <button
              type="button"
              onClick={() => window.location.reload()}
              className="rounded-xl bg-navy-900 px-5 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-navy-800"
            >
              Reload page
            </button>
          </div>

          {import.meta.env.DEV && this.state.error && (
            <pre className="mt-6 max-h-40 overflow-auto rounded-lg bg-red-50 p-3 text-left text-xs text-red-600 dark:bg-red-950/40 dark:text-red-300">
              {this.state.error.toString()}
            </pre>
          )}
        </div>
      </div>
    );
  }
}
