import { useEffect, useId, useRef } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { X } from 'lucide-react';

const FOCUSABLE =
  'a[href], button:not([disabled]), textarea:not([disabled]), input:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])';

/**
 * Dialog used for every create/edit flow in the app.
 *
 * The visual shell is close to what it was — it worked. What it lacked was dialog behaviour:
 *   - Focus stayed on the page behind, so a keyboard user tabbed straight out of the open
 *     dialog and started operating controls they could not see.
 *   - Escape did nothing, leaving the mouse as the only way out.
 *   - The background scrolled behind the overlay.
 *   - No role/aria-modal, so screen readers announced it as ordinary page content and offered
 *     no boundary to the surrounding page.
 *   - The close button was an unlabelled icon.
 *
 * Props are unchanged, so no caller needs touching.
 */
export default function Modal({ isOpen, onClose, title, children, size = 'md', footer }) {
  const sizes = {
    sm: 'max-w-md',
    md: 'max-w-lg',
    lg: 'max-w-2xl',
    xl: 'max-w-4xl',
    full: 'max-w-6xl',
  };

  const panelRef = useRef(null);
  const titleId = useId();

  // Escape to dismiss, and a tab loop so focus cannot leave the dialog while it is open.
  useEffect(() => {
    if (!isOpen) return undefined;

    const onKeyDown = (e) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        onClose?.();
        return;
      }
      if (e.key !== 'Tab') return;

      const nodes = panelRef.current?.querySelectorAll(FOCUSABLE);
      if (!nodes?.length) return;
      const first = nodes[0];
      const last = nodes[nodes.length - 1];

      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first.focus();
      }
    };

    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [isOpen, onClose]);

  // Hold the page still. Without this the list behind the dialog scrolls under the pointer,
  // and on iOS the page can end up scrolled somewhere else entirely once the dialog closes.
  useEffect(() => {
    if (!isOpen) return undefined;
    const previous = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => { document.body.style.overflow = previous; };
  }, [isOpen]);

  /*
   * Focus in on open, focus back to the trigger on close — deliberately one effect.
   * Splitting them across two effects meant the "restore" cleanup fired on *open* (React runs
   * the previous effect's cleanup before the next effect) and pulled focus straight back out
   * of the dialog onto the trigger behind the overlay.
   */
  useEffect(() => {
    if (!isOpen) return undefined;

    const trigger = document.activeElement;

    const focusFirst = () => {
      const panel = panelRef.current;
      if (!panel) return;
      // Prefer the first data-entry control so the user can start typing immediately. In DOM
      // order the close button comes first, and landing there invites dismissing the dialog
      // you just opened. Confirm-style dialogs with no fields fall back to the first control.
      const field = panel.querySelector('input:not([disabled]), select:not([disabled]), textarea:not([disabled])');
      const fallback = panel.querySelectorAll(FOCUSABLE)[0];
      (field || fallback || panel).focus?.();
    };

    // Focus synchronously — refs are attached by the time effects run — then verify on the next
    // frame, because the enter animation can otherwise land focus before the panel is composited.
    focusFirst();
    const raf = requestAnimationFrame(() => {
      if (!panelRef.current?.contains(document.activeElement)) focusFirst();
    });

    return () => {
      cancelAnimationFrame(raf);
      if (trigger?.isConnected) trigger.focus?.();
    };
  }, [isOpen]);

  return (
    <AnimatePresence>
      {isOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          {/* Backdrop blur removed: it is decorative, costs a compositing pass on every frame
              of the open animation, and made text behind the dialog shimmer on scroll. */}
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="absolute inset-0 bg-gray-900/50"
            onClick={onClose}
            aria-hidden="true"
          />
          <motion.div
            ref={panelRef}
            role="dialog"
            aria-modal="true"
            aria-labelledby={titleId}
            tabIndex={-1}
            initial={{ opacity: 0, scale: 0.98, y: 8 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.98, y: 8 }}
            transition={{ duration: 0.15, ease: 'easeOut' }}
            className={`relative flex max-h-[90vh] w-full flex-col rounded-2xl bg-white shadow-xl dark:bg-gray-800 ${sizes[size]}`}
          >
            <div className="flex items-center justify-between gap-4 border-b border-gray-200 px-6 py-4 dark:border-gray-700">
              <h2 id={titleId} className="text-base font-semibold text-gray-900 dark:text-white">
                {title}
              </h2>
              <button
                type="button"
                onClick={onClose}
                aria-label="Close dialog"
                className="-mr-1 shrink-0 rounded-lg p-1.5 text-gray-500 transition-colors hover:bg-gray-100 hover:text-gray-700 dark:text-gray-400 dark:hover:bg-gray-700"
              >
                <X size={18} aria-hidden="true" />
              </button>
            </div>

            <div className="flex-1 overflow-y-auto p-6">{children}</div>

            {footer && (
              <div className="rounded-b-2xl border-t border-gray-200 bg-gray-50 px-6 py-4 dark:border-gray-700 dark:bg-gray-900">
                {footer}
              </div>
            )}
          </motion.div>
        </div>
      )}
    </AnimatePresence>
  );
}
