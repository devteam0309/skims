import { useState, useCallback, useEffect, useRef } from 'react';
import { motion, AnimatePresence, useReducedMotion } from 'framer-motion';
import { CheckCircle2, XCircle, AlertCircle, Info, X } from 'lucide-react';

let toastFn = null;

/*
 * Messages raised before the Toaster has mounted are held rather than dropped.
 *
 * Some are raised from a mount effect rather than a user action — the login page reports an
 * expired session that way — and React runs a child's effects before those of a later sibling,
 * which is where <Toaster /> sits. Anything raised in that window would otherwise vanish, and the
 * session notice is exactly the message a user needs to understand why they are back at login.
 */
const pending = [];

const emit = (type, message, options) => {
  if (toastFn) toastFn(type, message, options);
  else pending.push([type, message, options]);
};

export const toast = {
  success: (message, options) => emit('success', message, options),
  error: (message, options) => emit('error', message, options),
  warning: (message, options) => emit('warning', message, options),
  info: (message, options) => emit('info', message, options),
};

const ICONS = {
  success: CheckCircle2,
  error: XCircle,
  warning: AlertCircle,
  info: Info,
};

/* Tones match StatusBadge — warning was yellow, which belongs to no tone in the vocabulary. */
const COLORS = {
  success: 'bg-green-50 border-green-200 text-green-800 dark:bg-emerald-950/60 dark:border-emerald-800 dark:text-emerald-200',
  error: 'bg-red-50 border-red-200 text-red-800 dark:bg-red-950/60 dark:border-red-800 dark:text-red-200',
  warning: 'bg-amber-50 border-amber-200 text-amber-800 dark:bg-amber-950/60 dark:border-amber-800 dark:text-amber-200',
  info: 'bg-blue-50 border-blue-200 text-blue-800 dark:bg-blue-950/60 dark:border-blue-800 dark:text-blue-200',
};

const ICON_COLORS = {
  success: 'text-green-500 dark:text-emerald-400',
  error: 'text-red-500 dark:text-red-400',
  warning: 'text-amber-500 dark:text-amber-400',
  info: 'text-blue-500 dark:text-blue-400',
};

let nextId = 0;

export function Toaster() {
  const [toasts, setToasts] = useState([]);
  const timers = useRef(new Map());
  const reduceMotion = useReducedMotion();

  const dismiss = useCallback((id) => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
    const timer = timers.current.get(id);
    if (timer) { clearTimeout(timer); timers.current.delete(id); }
  }, []);

  const addToast = useCallback((type, message, options = {}) => {
    /*
     * A monotonic counter, not Date.now().
     *
     * Two toasts raised in the same millisecond — a mutation reporting success and a follow-up,
     * or a bulk action's per-item messages — were given the same id. React then saw duplicate
     * keys, and dismissing either one (by click or by timeout) removed both, so a message could
     * vanish before it had been read.
     */
    const id = ++nextId;
    setToasts((prev) => [...prev, { id, type, message, ...options }]);

    const timer = setTimeout(() => {
      setToasts((prev) => prev.filter((t) => t.id !== id));
      timers.current.delete(id);
    }, options.duration || 4000);
    timers.current.set(id, timer);
  }, []);

  /*
   * Registered in an effect rather than assigned during render, and cleared on unmount, so a
   * timer cannot outlive the component and call setState on a dead tree.
   */
  useEffect(() => {
    toastFn = addToast;
    // Anything raised before this point is delivered now, in the order it was raised.
    if (pending.length) pending.splice(0).forEach((args) => addToast(...args));

    const scheduled = timers.current;
    return () => {
      if (toastFn === addToast) toastFn = null;
      scheduled.forEach(clearTimeout);
      scheduled.clear();
    };
  }, [addToast]);

  return (
    /*
     * Every success and failure message in the app arrives here, and none of it was announced:
     * the region had no live semantics at all, so a screen reader user got no confirmation that
     * a budget saved or an approval failed. Errors interrupt (assertive); everything else waits
     * for a pause (polite).
     */
    <div
      className="pointer-events-none fixed right-4 top-4 z-[100] flex w-full max-w-sm flex-col gap-2"
      aria-label="Notifications"
    >
      <AnimatePresence>
        {toasts.map((t) => {
          const Icon = ICONS[t.type];
          const assertive = t.type === 'error';
          return (
            <motion.div
              key={t.id}
              role={assertive ? 'alert' : 'status'}
              aria-live={assertive ? 'assertive' : 'polite'}
              initial={reduceMotion ? { opacity: 0 } : { opacity: 0, x: 100, scale: 0.9 }}
              animate={{ opacity: 1, x: 0, scale: 1 }}
              exit={reduceMotion ? { opacity: 0 } : { opacity: 0, x: 100, scale: 0.9 }}
              className={`pointer-events-auto flex items-start gap-3 rounded-xl border p-4 shadow-lg ${COLORS[t.type]}`}
            >
              <Icon size={18} aria-hidden="true" className={`mt-0.5 shrink-0 ${ICON_COLORS[t.type]}`} />
              <p className="flex-1 text-sm font-medium">{t.message}</p>
              <button
                type="button"
                onClick={() => dismiss(t.id)}
                aria-label="Dismiss notification"
                className="shrink-0 rounded opacity-60 transition-opacity hover:opacity-100"
              >
                <X size={14} aria-hidden="true" />
              </button>
            </motion.div>
          );
        })}
      </AnimatePresence>
    </div>
  );
}
