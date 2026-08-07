import { cloneElement, isValidElement } from 'react';
import { AlertCircle } from 'lucide-react';

/**
 * Shared form primitives.
 *
 * `Field` was written for the create-program form and immediately wanted to exist on every other
 * form in the app: each one had the same defects it was built to fix — a bare <label> with no
 * htmlFor, a control with no id, and an error message in a loose <p> with no programmatic link to
 * the field it described. Clicking a label focused nothing, and assistive tech announced a column
 * of unlabelled inputs.
 *
 * Keeping one copy here means a form gains correct labelling by using the component, rather than
 * by each author remembering six aria attributes.
 */

/**
 * The one input skin. Exported rather than re-declared per page so that focus, dark mode and the
 * invalid state cannot drift apart between forms — several pages previously styled inputs with no
 * dark: variant at all, and relied on a global CSS rule to rescue the background colour.
 */
export const control =
  'mt-1 w-full rounded-xl border border-gray-300 bg-white px-4 py-2.5 text-sm text-gray-900 outline-none transition-colors placeholder:text-gray-400 focus:border-navy-700 focus:ring-2 focus:ring-navy-700/20 dark:border-gray-600 dark:bg-gray-700 dark:text-gray-100 aria-[invalid=true]:border-red-500';

/** Label, control, hint and error as one unit. */
export function Field({ id, label, required, optional, hint, error, children }) {
  const hintId = hint ? `${id}-hint` : undefined;
  const errorId = error ? `${id}-error` : undefined;

  return (
    <div>
      <label htmlFor={id} className="form-label">
        {label}
        {required && <span className="text-red-600" aria-hidden="true"> *</span>}
        {required && <span className="sr-only"> (required)</span>}
        {optional && <span className="font-normal text-gray-500"> (optional)</span>}
      </label>

      {/* Cloned so each control inherits its id and aria wiring without every call site
          repeating six attributes. */}
      {isValidElement(children)
        ? cloneElement(children, {
            id,
            'aria-required': required || undefined,
            'aria-invalid': error ? 'true' : undefined,
            'aria-describedby': [errorId, hintId].filter(Boolean).join(' ') || undefined,
          })
        : children}

      {hint && <p id={hintId} className="field-hint">{hint}</p>}
      {error && (
        <p id={errorId} className="field-error" role="alert">
          <AlertCircle size={12} aria-hidden="true" className="shrink-0" />
          {error.message}
        </p>
      )}
    </div>
  );
}

/**
 * The note explaining what the asterisk means. Required-field marking is a convention the form
 * assumes the reader already knows; on a government system with first-time users that assumption
 * is worth one line of text.
 */
export function RequiredNote() {
  return (
    <p className="meta-text mt-2">
      <span aria-hidden="true">*</span> indicates a required field.
    </p>
  );
}

export default Field;
