/**
 * The centred card used by forgot-password, reset-password and verify-email.
 *
 * All three had drifted apart while pretending to be the same screen — different heading weights,
 * one missing its `text-gray-900` so the title inherited a different colour, different paddings.
 * One copy keeps them identical.
 *
 * These screens are deliberately light-on-navy in both themes: they render before the app knows
 * who the user is, and therefore before any stored theme preference is available.
 */
export default function AuthCard({ icon: Icon, title, subtitle, children }) {
  return (
    <div className="flex min-h-screen items-center justify-center bg-gradient-to-br from-navy-950 to-navy-900 p-4">
      <div className="w-full max-w-md rounded-2xl bg-white p-8 shadow-2xl">
        <div className="mb-8 text-center">
          {Icon && (
            <span className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-full bg-navy-100">
              <Icon size={24} className="text-navy-700" aria-hidden="true" />
            </span>
          )}
          <h1 className="text-2xl font-bold text-gray-900">{title}</h1>
          {subtitle && <p className="mt-1 text-sm text-gray-500">{subtitle}</p>}
        </div>
        {children}
      </div>
    </div>
  );
}
