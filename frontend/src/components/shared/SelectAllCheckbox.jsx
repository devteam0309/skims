import { useEffect, useRef } from 'react';

/**
 * Header checkbox for a bulk-selection table column.
 *
 * `indeterminate` is a DOM property with no HTML attribute, so it can only be set through a ref.
 * Without it the header box reads as fully unchecked while a subset of the page is selected — and
 * clicking it then selects everything rather than clearing, which is the wrong default to guess at
 * on controls that approve money or archive records.
 */
export default function SelectAllCheckbox({ checked, indeterminate, onChange, disabled, label }) {
  const ref = useRef(null);

  useEffect(() => {
    if (ref.current) ref.current.indeterminate = indeterminate;
  }, [indeterminate]);

  return (
    <input
      ref={ref}
      type="checkbox"
      checked={checked}
      onChange={onChange}
      disabled={disabled}
      aria-label={label}
      className="h-4 w-4 rounded border-gray-300 accent-navy-700 disabled:opacity-40"
    />
  );
}
