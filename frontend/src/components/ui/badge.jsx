import { clsx } from 'clsx';

const badgeVariants = {
  default: 'bg-navy-900 text-white',
  secondary: 'bg-gray-100 text-gray-800',
  destructive: 'bg-red-100 text-red-700',
  success: 'bg-green-100 text-green-700',
  warning: 'bg-yellow-100 text-yellow-700',
  outline: 'border border-gray-200 text-gray-700',
};

export function Badge({ className, variant = 'default', children, ...props }) {
  return (
    <span
      className={clsx(
        'inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-semibold transition-colors',
        badgeVariants[variant],
        className
      )}
      {...props}
    >
      {children}
    </span>
  );
}
