import { clsx } from 'clsx';
import { forwardRef } from 'react';

const buttonVariants = {
  default: 'bg-navy-900 text-white hover:bg-navy-800',
  destructive: 'bg-red-600 text-white hover:bg-red-700',
  outline: 'border border-gray-200 bg-white text-gray-700 hover:bg-gray-50',
  secondary: 'bg-gray-100 text-gray-900 hover:bg-gray-200',
  ghost: 'text-gray-600 hover:bg-gray-100',
  link: 'text-navy-700 underline-offset-4 hover:underline',
};

const buttonSizes = {
  default: 'h-10 px-4 py-2',
  sm: 'h-8 rounded-lg px-3 text-xs',
  lg: 'h-11 rounded-xl px-8',
  icon: 'h-9 w-9',
};

const Button = forwardRef(({ className, variant = 'default', size = 'default', disabled, children, ...props }, ref) => {
  return (
    <button
      ref={ref}
      disabled={disabled}
      className={clsx(
        'inline-flex items-center justify-center gap-2 rounded-xl text-sm font-semibold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-navy-700 disabled:pointer-events-none disabled:opacity-50',
        buttonVariants[variant],
        buttonSizes[size],
        className
      )}
      {...props}
    >
      {children}
    </button>
  );
});
Button.displayName = 'Button';

export { Button };
