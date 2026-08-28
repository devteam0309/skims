import { forwardRef, useId } from 'react';
import { control } from './FormField';

/**
 * Type-or-pick control.
 *
 * The review panel's finding was that several fields forced a choice from a fixed list, so
 * anything the list did not anticipate had to be filed under "Other" — which erased the very
 * detail the user was trying to record. A program that is genuinely none of the ten offered
 * categories became indistinguishable from every other unusual program, and a member who
 * identifies outside male/female was recorded as "other".
 *
 * This is a plain <input> backed by a native <datalist>: the suggestions drop down exactly as a
 * select would, and anything else can simply be typed. Native rather than a custom popup because
 * the browser already gives us keyboard navigation, filtering as you type, and correct screen
 * reader semantics — a hand-rolled listbox would have to re-earn all three, and the one in this
 * codebase that does (BarangaySelect) needed a portal and its own click-outside handling.
 *
 * Free text has a cost: two people can enter "Peace and Order" and "peace_and_order" for the same
 * thing. The suggestion list is what keeps that rare — it puts the established value one keystroke
 * away — and every consumer matches case-insensitively so the two at least filter together.
 */
const ComboInput = forwardRef(function ComboInput(
  { options = [], placeholder, className = '', ...props },
  ref
) {
  const listId = `${useId()}-options`;

  return (
    <>
      <input
        ref={ref}
        list={listId}
        type="text"
        autoComplete="off"
        placeholder={placeholder}
        className={`${control} ${className}`}
        {...props}
      />
      <datalist id={listId}>
        {options.map((o) => {
          const value = typeof o === 'string' ? o : o.value;
          const label = typeof o === 'string' ? o : o.label;
          // The visible text is the label, but the value is what lands in the field — so the
          // stored value stays the established one when a suggestion is picked.
          return <option key={value} value={label ?? value} />;
        })}
      </datalist>
    </>
  );
});

export default ComboInput;
