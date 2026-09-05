import useAuthStore from '../store/authStore';

// ─── DATA ────────────────────────────────────────────────────────────────────

const SYSTEM = {
  name: 'SKIMS',
  full: 'Sangguniang Kabataan Integrated Program and Fund Management System',
  version: '1.0.0',
  context: 'SK (Sangguniang Kabataan) governance platform for 4 municipalities in Marinduque, Philippines.',
  municipalities: ['Boac (BOA)', 'Gasan (GAS)', 'Mogpog (MOG)', 'Santa Cruz (STC)'],
};

const STACK = [
  { layer: 'Database', tech: 'MongoDB + Mongoose 8', note: 'Atlas / local; soft-delete via deletedAt' },
  { layer: 'Backend', tech: 'Node.js 18+ / Express 4', note: 'REST API; express-async-handler; express-validator' },
  { layer: 'Auth', tech: 'JWT (jsonwebtoken) + bcryptjs', note: 'httpOnly cookie + Bearer fallback; 15-min access token + 30-day DB-backed refresh token' },
  { layer: 'File Storage', tech: 'Cloudinary', note: 'skims/documents & skims/avatars folders; memoryStorage multer' },
  { layer: 'Email', tech: 'Nodemailer', note: 'Verification, approval, reset, approval notifications' },
  { layer: 'Security', tech: 'Helmet, HPP, express-mongo-sanitize, express-rate-limit', note: 'CSP, XSS, HPP, NoSQL injection, rate limiting' },
  { layer: 'Logging', tech: 'Winston + Morgan', note: 'File + console; Morgan for HTTP request logs' },
  { layer: 'PDF Reports', tech: 'PDFKit', note: 'Program, financial, youth reports' },
  { layer: 'Excel Reports', tech: 'ExcelJS', note: 'Financial and youth export' },
  { layer: 'Cron', tech: 'node-cron', note: 'Daily deadline reminders (08:00), compliance check (every 6h)' },
  { layer: 'Frontend', tech: 'React 18 + Vite 5', note: 'SPA; manualChunks bundle splitting' },
  { layer: 'Routing', tech: 'React Router DOM 6', note: 'Protected + Public routes; ProtectedRoute component' },
  { layer: 'State', tech: 'Zustand + TanStack React Query 5', note: 'Auth store (persisted); server state via React Query' },
  { layer: 'Forms', tech: 'React Hook Form + Zod', note: 'Schema-based validation on create/edit forms' },
  { layer: 'Charts', tech: 'Recharts', note: 'Bar, pie, line charts in dashboard, monitoring, analytics' },
  { layer: 'UI', tech: 'Tailwind CSS 3 + Radix UI', note: 'Custom navy/gold palette; dark mode throughout' },
  { layer: 'Confirmations', tech: 'SweetAlert2 11', note: 'Centralized confirm utility at utils/confirm.js' },
  { layer: 'Animations', tech: 'Framer Motion 10', note: 'Page transitions, card entrances' },
  { layer: 'Tests', tech: 'Jest + Supertest + mongodb-memory-server', note: 'Integration tests; run: npm test from backend/' },
];

const ROLES = [
  { role: 'super_admin', label: 'Super Administrator', scope: 'All municipalities', autoApproved: false, canAssign: 'All 8 roles' },
  { role: 'provincial_admin', label: 'Provincial SK Fed. Admin', scope: 'All municipalities', autoApproved: false, canAssign: 'All except super_admin' },
  // routes/users.js authorizes PUT /:id/role for super_admin and provincial_admin only, so a
  // municipal_admin cannot assign any role. The controller's ASSIGNABLE_ROLES still carries a
  // municipal_admin entry, but the route rejects the request before it is ever consulted — this
  // table previously reported that unreachable entry as though it were the behaviour.
  { role: 'municipal_admin', label: 'Municipal SK Fed. Admin', scope: 'Own municipality', autoApproved: false, canAssign: '— (route-gated)' },
  { role: 'sk_chairperson', label: 'SK Chairperson', scope: 'Own municipality', autoApproved: false, canAssign: '—' },
  { role: 'sk_treasurer', label: 'SK Treasurer', scope: 'Own municipality', autoApproved: false, canAssign: '—' },
  { role: 'sk_secretary', label: 'SK Secretary', scope: 'Own municipality', autoApproved: false, canAssign: '—' },
  { role: 'sk_kagawad', label: 'SK Kagawad', scope: 'Own municipality', autoApproved: false, canAssign: '—' },
  { role: 'dilg_representative', label: 'DILG Representative', scope: 'All municipalities (read)', autoApproved: false, canAssign: '—' },
];

const ROLE_GROUPS = [
  { name: 'ADMINS', roles: 'super_admin, provincial_admin, municipal_admin', use: 'Most admin actions, user management, delete operations' },
  { name: 'FINANCE_STAFF', roles: 'ADMINS + sk_chairperson, sk_treasurer', use: 'Create budgets, expenses, liquidations' },
  { name: 'STAFF', roles: 'FINANCE_STAFF + sk_secretary, sk_kagawad, dilg_representative', use: 'Dashboard, monitoring, read access' },
  { name: 'EDITORS', roles: 'ADMINS + sk_chairperson, sk_secretary', use: 'Create/edit programs' },
  { name: 'REPORTERS', roles: 'ADMINS + sk_chairperson, sk_treasurer, dilg_representative', use: 'Reports, analytics, expense/budget approval' },
  { name: 'YOUTH_REGISTRARS', roles: 'ADMINS + sk_chairperson', use: 'Register new youth members' },
  { name: 'YOUTH_EDITORS', roles: 'ADMINS + sk_chairperson, sk_secretary, sk_kagawad', use: 'Update/delete youth members' },
  { name: 'DOC_UPLOADERS', roles: 'ADMINS + sk_chairperson, sk_treasurer, sk_secretary, sk_kagawad', use: 'Upload documents' },
  { name: 'DOC_EDITORS', roles: 'ADMINS + sk_chairperson, sk_secretary', use: 'Archive/unarchive/replace documents' },
];

const AUTH_FLOW = [
  { step: '1', label: 'Register', detail: 'POST /api/auth/register — SELF_ASSIGNABLE_ROLES only (sk_chairperson, sk_treasurer, sk_secretary, sk_kagawad, dilg_representative, youth). Anything else is a 400, not a silent downgrade. Youth self-approve; all others: isApproved=false, isEmailVerified=false.' },
  { step: '2', label: 'Email Verification', detail: 'Verification email sent on register. GET /api/auth/verify-email/:token sets isEmailVerified=true. POST /api/auth/resend-verification to re-send (5/15min rate limit).' },
  { step: '3', label: 'Admin Approval', detail: 'Admin → Users → Pending tab (super_admin only) → Approve or Reject with reason. Youth skip this step. Approval sends email notification.' },
  { step: '4', label: 'Login', detail: 'POST /api/auth/login (20/15min IP rate limit) — checks: isEmailVerified → isActive → isApproved → issues JWT in httpOnly cookie (+ Bearer fallback). Also issues refreshToken.' },
  { step: '5', label: 'Protected Requests', detail: 'protect middleware: cookie/Bearer token → JWT verify → user lookup → isEmailVerified → isActive → isApproved → req.user. authorize(...roles) checks role.' },
  { step: '6', label: 'Token Refresh', detail: 'POST /api/auth/refresh — validates refreshToken cookie, issues new access token.' },
  { step: '7', label: 'Password Reset', detail: 'POST /api/auth/forgot-password (5/15min limit) → email with token. PUT /api/auth/reset-password/:token.' },
  { step: '8', label: 'Logout', detail: 'POST /api/auth/logout — clears httpOnly cookie, clears refreshToken in DB.' },
];

const FINANCIAL_FLOW = [
  { step: '1', label: 'Budget', detail: 'Create (draft) → Submit → Approve (admin/DILG). Provides the spending envelope per municipality per fiscal year. Compound unique index: (municipality, fiscalYear, deletedAt=null).' },
  { step: '2', label: 'Program', detail: 'Create program tied to municipality. Optionally link to approved budget via budgetRef. Track milestones, target beneficiaries, status (planned→ongoing→completed/delayed/cancelled).' },
  { step: '3', label: 'Expense', detail: 'Record expense (type: PR/PO/DR/IAR/SI/DV/OR) against a budget+program. Pending → Approved. Approving updates Budget.disbursedAmount + Program.actualExpenses. Self-approval blocked.' },
  { step: '4', label: 'Liquidation', detail: 'Liquidation report (draft → submit → under_review → approve/reject). Tracks full document chain: PR→PO→DR→Inspection→Invoice→DV→OR. variance = totalAmount − liquidatedAmount.' },
];

const DOC_WORKFLOW = [
  'Upload → title, category, municipality (forced from user), optional program/fiscalYear/tags/isPublic',
  'Edit metadata (title, description, tags, isPublic, fiscalYear)',
  'Replace file — creates version history entry (previousVersions array)',
  'Archive / Unarchive — sets isArchived flag, removed from default list view',
  'Download — POST /api/documents/:id/download (trackDownload) or GET /api/documents/:id/serve (streams/redirects to Cloudinary)',
  'Delete (soft) — sets deletedAt; ADMINS only',
  'Download history capped to last 100 entries via $slice',
];

const MODELS = [
  {
    name: 'User',
    key_fields: 'firstName, lastName, email, password, role, municipality, barangay, isActive, isApproved, isEmailVerified, avatar, refreshToken, loginAttempts, lockUntil, deletedAt',
    notes: 'password: select:false; complexity validator (upper+num+special); fullName virtual; bcrypt hash on pre-save',
  },
  {
    name: 'Municipality',
    key_fields: 'name, code, province, region, totalBarangays',
    notes: '4 municipalities in Marinduque: BOA, GAS, MOG, STC',
  },
  {
    name: 'Barangay',
    key_fields: 'name, municipality (ref)',
    notes: '178 total barangays across 4 municipalities',
  },
  {
    name: 'Program',
    key_fields: 'title, description, objectives[], category, status, municipality, budgetRef, budget(Number), actualExpenses, startDate, endDate, targetParticipants, actualParticipants, milestones[], completionRate, isPublic, deletedAt',
    notes: 'completionRate auto-computed from milestones in pre-save. status: planned|ongoing|delayed|completed|cancelled. 11 categories.',
  },
  {
    name: 'Budget',
    key_fields: 'title, fiscalYear, municipality, totalBudget, disbursedAmount, remainingBalance, allocations[], status, approvedBy, approvedAt, createdBy, deletedAt',
    notes: 'remainingBalance auto-computed pre-save. Unique: (municipality, fiscalYear) where deletedAt=null. status: draft|pending_approval|approved|rejected|revised.',
  },
  {
    name: 'Expense',
    key_fields: 'referenceNumber (EXP-YYYY-NNNNN), type, title, amount, program, budget, municipality, vendor, transactionDate, status, approvedBy, attachments[], isLiquidated, liquidationId, deletedAt',
    notes: 'referenceNumber from atomic Counter. EXPENSE_TYPES: purchase_request|purchase_order|delivery_receipt|inspection_acceptance_report|sales_invoice|disbursement_voucher|official_receipt.',
  },
  {
    name: 'Liquidation',
    key_fields: 'referenceNumber (LIQ-YYYY-NNNNN), title, program, budget, municipality, expenses[], totalAmount, liquidatedAmount, variance, status, submittedBy, dueDate, documents[], rejectionReason, deletedAt',
    notes: 'Mongoose validator: liquidatedAmount ≤ totalAmount. status: draft|submitted|under_review|approved|rejected|returned.',
  },
  {
    name: 'Document',
    key_fields: 'title, category, fileName, originalName, fileUrl(Cloudinary), fileType, fileSize, municipality, program, uploadedBy, fiscalYear, tags[], isPublic, isArchived, version, previousVersions[], downloadCount, downloadHistory[], deletedAt',
    notes: '14 document categories. fileUrl is Cloudinary URL. downloadHistory capped at 100 entries.',
  },
  {
    name: 'YouthMember',
    key_fields: 'firstName, lastName, birthDate, gender, municipality, barangay, educationalAttainment, occupation, isRegisteredVoter, programParticipations[], isActive, registeredBy, deletedAt',
    notes: 'age virtual (15-30 enforced on create). educationalAttainment: elementary|high_school|college|vocational|graduate|out_of_school.',
  },
  {
    name: 'Announcement',
    key_fields: 'title, content, type, municipality, author, isPublic, isPinned, publishedAt, expiresAt, eventDate, eventLocation',
    notes: 'type: announcement|event|deadline|notice. Municipality-scoped or province-wide.',
  },
  {
    name: 'Notification',
    key_fields: 'recipient, type, title, message, relatedResource, relatedId, isRead, expiresAt',
    notes: '90-day TTL via pre-save hook. insertMany: use Notification.createWithExpiry() — bypasses pre-save.',
  },
  {
    name: 'AuditLog',
    key_fields: 'user, action, resource, resourceId, oldValues, newValues, details, ipAddress, municipality, status, errorMessage',
    notes: '7-year TTL. Required on all financial mutations + role changes + document ops. municipality field required for scoped reporting.',
  },
  {
    name: 'Counter',
    key_fields: 'name (unique), seq',
    notes: 'Atomic reference number generation via findOneAndUpdate $inc. Keys: expense-YYYY, liquidation-YYYY.',
  },
];

const API_ENDPOINTS = [
  {
    group: 'Auth — /api/auth',
    routes: [
      { method: 'POST', path: '/register', auth: 'None', roles: '—', note: 'registerValidation; SELF_ASSIGNABLE_ROLES only' },
      { method: 'POST', path: '/login', auth: 'None', roles: '—', note: 'loginLimiter 20/15min; loginValidation; sets httpOnly cookie' },
      { method: 'POST', path: '/refresh', auth: 'None', roles: '—', note: 'Validates refreshToken cookie; issues new access token' },
      { method: 'POST', path: '/logout', auth: 'protect', roles: 'Any', note: 'Clears cookie + DB refreshToken' },
      { method: 'GET', path: '/me', auth: 'protect', roles: 'Any', note: 'Returns current user' },
      { method: 'PUT', path: '/me', auth: 'protect', roles: 'Any', note: 'Update profile; avatar uploaded to Cloudinary skims/avatars' },
      { method: 'PUT', path: '/password', auth: 'protect', roles: 'Any', note: 'Change password (requires currentPassword)' },
      { method: 'GET', path: '/verify-email/:token', auth: 'None', roles: '—', note: 'Token from email; sets isEmailVerified=true; idempotent' },
      { method: 'POST', path: '/forgot-password', auth: 'None', roles: '—', note: 'emailLimiter 5/15min; no user-existence leak' },
      { method: 'PUT', path: '/reset-password/:token', auth: 'None', roles: '—', note: '' },
      { method: 'POST', path: '/resend-verification', auth: 'None', roles: '—', note: 'emailLimiter 5/15min' },
    ],
  },
  {
    group: 'Users — /api/users',
    routes: [
      { method: 'GET', path: '/', auth: 'protect', roles: 'ADMINS', note: 'municipal_admin scoped to own municipality; MAX_LIMIT=100' },
      { method: 'GET', path: '/pending', auth: 'protect', roles: 'ADMINS', note: 'Pending approvals; paginated; municipal_admin scoped' },
      { method: 'GET', path: '/:id', auth: 'protect', roles: 'Any', note: 'non-admin cannot see other municipality users; sensitive fields stripped' },
      { method: 'PUT', path: '/:id/approve', auth: 'protect', roles: 'ADMINS', note: 'Sets isApproved=true; sends email' },
      { method: 'PUT', path: '/:id/reject', auth: 'protect', roles: 'ADMINS', note: 'Sets isApproved=false with reason; sends email' },
      { method: 'PUT', path: '/:id/role', auth: 'protect', roles: 'super_admin, provincial_admin', note: 'ASSIGNABLE_ROLES hierarchy enforced' },
      { method: 'PUT', path: '/:id/toggle-status', auth: 'protect', roles: 'ADMINS', note: 'Toggles isActive' },
      { method: 'DELETE', path: '/:id', auth: 'protect', roles: 'super_admin', note: 'Soft-delete (deletedAt)' },
    ],
  },
  {
    group: 'Programs — /api/programs',
    routes: [
      { method: 'GET', path: '/stats', auth: 'protect', roles: 'Any', note: 'Municipality-scoped for non-admins' },
      { method: 'GET', path: '/', auth: 'protect', roles: 'Any', note: 'Scoped; search, status, category filters; pagination MAX_LIMIT=100' },
      { method: 'GET', path: '/:id', auth: 'protect', roles: 'Any', note: 'Municipality scope enforced for non-admins' },
      { method: 'POST', path: '/', auth: 'protect', roles: 'EDITORS', note: 'programValidation; ALLOWED_CREATE_FIELDS; municipality forced from user' },
      { method: 'PUT', path: '/:id', auth: 'protect', roles: 'EDITORS', note: 'ALLOWED_UPDATE_FIELDS whitelist; municipality scope' },
      { method: 'PATCH', path: '/:id/status', auth: 'protect', roles: 'EDITORS', note: 'statusValidation; municipality scope' },
      { method: 'POST', path: '/:id/milestones', auth: 'protect', roles: 'EDITORS', note: 'milestoneValidation; municipality scope' },
      { method: 'PUT', path: '/:id/milestones/:milestoneId', auth: 'protect', roles: 'EDITORS', note: 'ALLOWED_MILESTONE_FIELDS whitelist' },
      { method: 'DELETE', path: '/:id', auth: 'protect', roles: 'ADMINS', note: 'Soft-delete' },
    ],
  },
  {
    group: 'Budgets — /api/budgets',
    routes: [
      { method: 'GET', path: '/summary', auth: 'protect', roles: 'Any', note: 'Scoped for non-admins' },
      { method: 'GET', path: '/', auth: 'protect', roles: 'Any', note: 'Scoped; MAX_LIMIT=100' },
      { method: 'GET', path: '/:id', auth: 'protect', roles: 'Any', note: 'Municipality scope enforced' },
      { method: 'POST', path: '/', auth: 'protect', roles: 'FINANCE_STAFF', note: 'budgetValidation; ALLOWED_CREATE_FIELDS; municipality forced from user' },
      { method: 'PUT', path: '/:id', auth: 'protect', roles: 'FINANCE_STAFF', note: 'Pipeline update recalculates remainingBalance atomically; AuditLog' },
      { method: 'PATCH', path: '/:id/submit', auth: 'protect', roles: 'sk_chairperson, sk_treasurer, municipal_admin', note: 'draft→pending_approval; atomic conditional update' },
      { method: 'PATCH', path: '/:id/approve', auth: 'protect', roles: 'ADMINS + dilg_representative', note: 'pending_approval→approved; AuditLog; email notification' },
      { method: 'PATCH', path: '/:id/reject', auth: 'protect', roles: 'ADMINS + dilg_representative', note: 'AuditLog; email notification' },
      { method: 'PATCH', path: '/:id/reopen', auth: 'protect', roles: 'FINANCE_STAFF', note: 'approved/rejected→draft' },
      { method: 'DELETE', path: '/:id', auth: 'protect', roles: 'super_admin, provincial_admin', note: 'Soft-delete' },
    ],
  },
  {
    group: 'Expenses — /api/expenses',
    routes: [
      { method: 'GET', path: '/summary', auth: 'protect', roles: 'REPORTERS', note: 'Scoped for non-admins' },
      { method: 'GET', path: '/', auth: 'protect', roles: 'Any', note: 'Scoped; MAX_LIMIT=100' },
      { method: 'GET', path: '/:id', auth: 'protect', roles: 'Any', note: 'Municipality scope enforced' },
      { method: 'POST', path: '/', auth: 'protect', roles: 'FINANCE_STAFF', note: 'expenseValidation; Cloudinary upload (max 10 attachments); budget status checked; AuditLog' },
      { method: 'PUT', path: '/:id', auth: 'protect', roles: 'ADMINS + sk_treasurer', note: 'ALLOWED_UPDATE_FIELDS; municipality scope; AuditLog' },
      { method: 'PATCH', path: '/:id/approve', auth: 'protect', roles: 'REPORTERS', note: 'pending→approved; self-approval blocked; updates Budget.disbursedAmount + Program.actualExpenses; AuditLog; email' },
      { method: 'DELETE', path: '/:id', auth: 'protect', roles: 'ADMINS', note: 'Soft-delete; blocked if approved/liquidated' },
    ],
  },
  {
    group: 'Liquidations — /api/liquidations',
    routes: [
      { method: 'GET', path: '/', auth: 'protect', roles: 'Any', note: 'Scoped; MAX_LIMIT=100' },
      { method: 'GET', path: '/:id', auth: 'protect', roles: 'Any', note: 'Municipality scope enforced' },
      { method: 'POST', path: '/', auth: 'protect', roles: 'FINANCE_STAFF', note: 'Cloudinary upload (max 20 documents); municipality forced from user; AuditLog' },
      { method: 'PATCH', path: '/:id/submit', auth: 'protect', roles: 'FINANCE_STAFF', note: 'draft→submitted; AuditLog; email' },
      { method: 'PATCH', path: '/:id/approve', auth: 'protect', roles: 'REPORTERS', note: 'submitted→approved; AuditLog; email' },
      { method: 'PATCH', path: '/:id/reject', auth: 'protect', roles: 'REPORTERS', note: 'requires rejectionReason; AuditLog; email' },
      { method: 'DELETE', path: '/:id', auth: 'protect', roles: 'ADMINS', note: 'Soft-delete; blocked if approved' },
    ],
  },
  {
    group: 'Documents — /api/documents',
    routes: [
      { method: 'GET', path: '/stats', auth: 'protect', roles: 'Any', note: 'Count by category' },
      { method: 'GET', path: '/', auth: 'protect', roles: 'Any', note: 'Scoped; isArchived filter; MAX_LIMIT=100' },
      { method: 'GET', path: '/:id', auth: 'protect', roles: 'Any', note: 'Municipality scope via (doc.municipality?._id || doc.municipality)?.toString()' },
      { method: 'POST', path: '/', auth: 'protect', roles: 'DOC_UPLOADERS', note: 'Single file upload → Cloudinary skims/documents; field whitelist; tags JSON.parse try-catch; AuditLog' },
      { method: 'PUT', path: '/:id', auth: 'protect', roles: 'DOC_EDITORS', note: 'Metadata update; municipality scope' },
      { method: 'PATCH', path: '/:id/archive', auth: 'protect', roles: 'DOC_EDITORS', note: 'AuditLog' },
      { method: 'PATCH', path: '/:id/unarchive', auth: 'protect', roles: 'DOC_EDITORS', note: '' },
      { method: 'PATCH', path: '/:id/replace-file', auth: 'protect', roles: 'DOC_EDITORS', note: 'Creates previousVersions entry; increments version; Cloudinary re-upload' },
      { method: 'POST', path: '/:id/download', auth: 'optionalAuth', roles: 'Any', note: 'trackDownload — increments count, appends downloadHistory ($slice -100)' },
      { method: 'GET', path: '/:id/serve', auth: 'optionalAuth', roles: 'Any', note: 'Returns Cloudinary URL (redirect or direct); private docs require auth' },
      { method: 'DELETE', path: '/:id', auth: 'protect', roles: 'ADMINS', note: 'Soft-delete; AuditLog' },
    ],
  },
  {
    group: 'Youth — /api/youth',
    routes: [
      { method: 'GET', path: '/duplicate-check', auth: 'protect', roles: 'Any', note: 'Check by firstName+lastName+birthDate before register; ReDoS-safe escapeRegex' },
      { method: 'GET', path: '/', auth: 'protect', roles: 'Any', note: 'Scoped; search, gender, education, barangay filters; MAX_LIMIT=100' },
      { method: 'GET', path: '/:id', auth: 'protect', roles: 'Any', note: 'Municipality scope enforced' },
      { method: 'POST', path: '/', auth: 'protect', roles: 'YOUTH_REGISTRARS', note: 'youthValidation; ALLOWED_CREATE_FIELDS; municipality forced from user; age 15-30 enforced' },
      { method: 'PUT', path: '/:id', auth: 'protect', roles: 'YOUTH_EDITORS', note: 'ALLOWED_UPDATE_FIELDS; municipality scope' },
      { method: 'DELETE', path: '/:id', auth: 'protect', roles: 'YOUTH_EDITORS', note: 'Soft-delete; municipality scope' },
    ],
  },
  {
    group: 'Announcements — /api/announcements',
    routes: [
      { method: 'GET', path: '/', auth: 'protect', roles: 'Any', note: 'Scoped + province-wide; type filter; pagination' },
      { method: 'GET', path: '/:id', auth: 'protect', roles: 'Any', note: 'Municipality scope enforced' },
      { method: 'POST', path: '/', auth: 'protect', roles: 'EDITORS', note: 'municipality from user; AuditLog' },
      { method: 'PUT', path: '/:id', auth: 'protect', roles: 'EDITORS', note: 'Municipality scope' },
      { method: 'DELETE', path: '/:id', auth: 'protect', roles: 'ADMINS', note: 'AuditLog' },
    ],
  },
  {
    group: 'Monitoring — /api/monitoring',
    routes: [
      { method: 'GET', path: '/overview', auth: 'protect', roles: 'STAFF', note: 'Delayed programs, upcoming deadlines (7 days); scoped' },
      { method: 'GET', path: '/municipalities', auth: 'protect', roles: 'STAFF', note: 'Multi-municipality comparison report' },
      { method: 'GET', path: '/compliance', auth: 'protect', roles: 'STAFF', note: 'Compliance score based on pending liquidations, overdue programs, missing docs' },
      { method: 'GET', path: '/timeline', auth: 'protect', roles: 'STAFF', note: 'Program timeline data; scoped' },
    ],
  },
  {
    group: 'Dashboard — /api/dashboard',
    routes: [
      { method: 'GET', path: '/', auth: 'protect', roles: 'STAFF', note: 'KPIs, recentPrograms, recentExpenses, programsByStatus, monthlyExpenses; scoped' },
      { method: 'GET', path: '/municipality-comparison', auth: 'protect', roles: 'REPORTERS', note: 'Cross-municipality KPI comparison' },
    ],
  },
  {
    group: 'Reports — /api/reports',
    routes: [
      { method: 'GET', path: '/programs', auth: 'protect', roles: 'REPORTERS', note: 'PDF + Excel; municipalityScope(); REPORT_LIMIT=1000' },
      { method: 'GET', path: '/financial', auth: 'protect', roles: 'REPORTERS', note: 'PDF + Excel; ₱ formatting via formatPHP()' },
      { method: 'GET', path: '/youth', auth: 'protect', roles: 'REPORTERS', note: 'PDF + Excel' },
      { method: 'GET', path: '/template/:name', auth: 'protect', roles: 'REPORTERS', note: 'Blank document templates (PR, PO, etc.)' },
    ],
  },
  {
    group: 'Analytics — /api/analytics',
    routes: [
      { method: 'GET', path: '/fund-utilization', auth: 'protect', roles: 'REPORTERS', note: 'Monthly expense aggregation by year; scopeAnalytics()' },
      { method: 'GET', path: '/program-success', auth: 'protect', roles: 'REPORTERS', note: 'Success rate by category; avgCompletionRate' },
      { method: 'GET', path: '/youth-engagement', auth: 'protect', roles: 'REPORTERS', note: 'byGender, byEducation, byMunicipality breakdowns' },
    ],
  },
  {
    group: 'Notifications — /api/notifications',
    routes: [
      { method: 'GET', path: '/', auth: 'protect', roles: 'Any', note: 'Own notifications only; MAX_LIMIT=100' },
      { method: 'PATCH', path: '/:id/read', auth: 'protect', roles: 'Any', note: 'Ownership enforced via findOneAndUpdate({_id, recipient})' },
      { method: 'PATCH', path: '/read-all', auth: 'protect', roles: 'Any', note: 'Marks all as read for current user' },
      { method: 'DELETE', path: '/:id', auth: 'protect', roles: 'Any', note: 'Ownership enforced via findOne({_id, recipient})' },
    ],
  },
  {
    group: 'Public — /api/public (no auth)',
    routes: [
      { method: 'GET', path: '/programs', auth: 'None', roles: '—', note: 'isPublic=true, not-deleted; MAX_LIMIT=100' },
      { method: 'GET', path: '/announcements', auth: 'None', roles: '—', note: 'isPublic=true; MAX_LIMIT=100' },
      { method: 'GET', path: '/budget', auth: 'None', roles: '—', note: 'Aggregated budget summary per municipality' },
      { method: 'GET', path: '/documents', auth: 'None', roles: '—', note: 'isPublic=true, not-archived, not-deleted; fileUrl stripped from response' },
      { method: 'GET', path: '/documents/:id/download', auth: 'None', roles: '—', note: 'isPublic check; streams file or redirects to Cloudinary; 302/404' },
      { method: 'GET', path: '/municipalities', auth: 'None', roles: '—', note: 'All 4 municipalities' },
      { method: 'GET', path: '/stats', auth: 'None', roles: '—', note: 'Aggregate counts: programs, youth, documents, municipalities' },
    ],
  },
  {
    group: 'Other',
    routes: [
      { method: 'GET', path: '/api/municipalities', auth: 'protect', roles: 'Any', note: 'All municipalities with barangay counts' },
      { method: 'GET', path: '/api/municipalities/:id/barangays', auth: 'protect', roles: 'Any', note: 'Barangays for a municipality' },
      { method: 'GET', path: '/api/audit-logs', auth: 'protect', roles: 'ADMINS', note: 'Paginated; municipality scoped; MAX_LIMIT=100' },
      { method: 'GET', path: '/api/health', auth: 'None', roles: '—', note: 'Returns status:ok, uptime, timestamp. NODE_ENV intentionally excluded.' },
    ],
  },
];

const FRONTEND_ROUTES = [
  { path: '/portal', roles: 'Everyone', note: 'Public portal — programs, budget, documents, announcements. Login button shows Dashboard if authenticated.' },
  { path: '/login', roles: 'Unauthenticated only', note: 'Redirects to /dashboard if logged in. Reads ?reason param from 401 interceptor.' },
  { path: '/register', roles: 'Unauthenticated only', note: '' },
  { path: '/forgot-password', roles: 'Unauthenticated only', note: '' },
  { path: '/reset-password/:token', roles: 'Unauthenticated only', note: '' },
  { path: '/verify-email/:token', roles: 'Anyone', note: 'No auth required — works from email link' },
  { path: '/dashboard', roles: 'STAFF', note: 'Non-staff roles are redirected to their own home' },
  { path: '/programs', roles: 'STAFF', note: '' },
  { path: '/programs/new', roles: 'PROGRAM_EDITORS', note: '' },
  { path: '/programs/:id', roles: 'STAFF', note: '' },
  { path: '/programs/:id/edit', roles: 'PROGRAM_EDITORS', note: '' },
  { path: '/budgets', roles: 'STAFF', note: '' },
  { path: '/expenses', roles: 'STAFF', note: '' },
  { path: '/liquidations', roles: 'STAFF', note: '' },
  { path: '/documents', roles: 'STAFF', note: '' },
  { path: '/youth', roles: 'STAFF', note: '' },
  { path: '/reports', roles: 'REPORTERS', note: '' },
  { path: '/analytics', roles: 'REPORTERS', note: '' },
  { path: '/monitoring', roles: 'STAFF', note: '' },
  { path: '/announcements', roles: 'EDITOR_ROLES', note: 'Admin announcement management (create/edit/pin)' },
  { path: '/users', roles: 'ADMIN_ROLES', note: 'User management + pending approvals' },
  { path: '/profile', roles: 'Any authenticated', note: 'Edit name, avatar, contact; change password' },
  { path: '/notifications', roles: 'Any authenticated', note: '' },
  { path: '/audit-logs', roles: 'ADMIN_ROLES', note: '' },
  { path: '/ref', roles: 'Any authenticated', note: 'This page — no nav link, manual URL only' },
];

const PERMISSIONS_TABLE = [
  { module: 'Dashboard', access: 'STAFF' },
  { module: 'Programs — View', access: 'STAFF' },
  { module: 'Programs — Create/Edit/Status/Milestones', access: 'EDITORS (ADMINS + sk_chairperson + sk_secretary)' },
  { module: 'Programs — Delete', access: 'ADMINS' },
  { module: 'Budgets — View', access: 'STAFF' },
  { module: 'Budgets — Create/Update', access: 'FINANCE_STAFF' },
  { module: 'Budgets — Submit', access: 'sk_chairperson, sk_treasurer, municipal_admin' },
  { module: 'Budgets — Approve/Reject', access: 'ADMINS + dilg_representative' },
  { module: 'Budgets — Delete', access: 'super_admin, provincial_admin' },
  { module: 'Expenses — View', access: 'STAFF' },
  { module: 'Expenses — Create', access: 'FINANCE_STAFF' },
  { module: 'Expenses — Update', access: 'ADMINS + sk_treasurer' },
  { module: 'Expenses — Approve', access: 'REPORTERS (self-approval blocked)' },
  { module: 'Expenses — Delete', access: 'ADMINS (blocked if approved/liquidated)' },
  { module: 'Liquidations — View', access: 'STAFF' },
  { module: 'Liquidations — Create/Submit', access: 'FINANCE_STAFF' },
  { module: 'Liquidations — Approve/Reject', access: 'REPORTERS' },
  { module: 'Liquidations — Delete', access: 'ADMINS' },
  { module: 'Documents — View', access: 'STAFF' },
  { module: 'Documents — Upload', access: 'DOC_UPLOADERS (all SK roles except dilg)' },
  { module: 'Documents — Edit metadata', access: 'DOC_EDITORS (ADMINS + sk_chairperson + sk_secretary)' },
  { module: 'Documents — Archive/Unarchive', access: 'DOC_EDITORS' },
  { module: 'Documents — Delete', access: 'ADMINS' },
  { module: 'Youth — View', access: 'STAFF' },
  { module: 'Youth — Register', access: 'YOUTH_REGISTRARS (ADMINS + sk_chairperson)' },
  { module: 'Youth — Edit/Delete', access: 'YOUTH_EDITORS (ADMINS + sk_chairperson + sk_secretary + sk_kagawad)' },
  { module: 'Reports & Analytics', access: 'REPORTERS' },
  { module: 'Monitoring', access: 'STAFF' },
  { module: 'Announcements — View', access: 'STAFF' },
  { module: 'Announcements — Create/Edit', access: 'EDITORS' },
  { module: 'Announcements — Delete', access: 'ADMINS' },
  { module: 'User Management / Approvals', access: 'ADMINS' },
  { module: 'User Role Assignment', access: 'super_admin, provincial_admin' },
  { module: 'User Delete', access: 'super_admin only' },
  { module: 'Audit Logs', access: 'ADMINS' },
  { module: 'Public Portal', access: 'Everyone — no login required' },
];

const TEST_ACCOUNTS = [
  { role: 'super_admin', email: 'superadmin@skims.gov.ph', password: 'Admin@123', municipality: '—' },
  { role: 'provincial_admin', email: 'provincial@skims.gov.ph', password: 'Admin@123', municipality: '—' },
  { role: 'municipal_admin', email: 'municipal@boac.gov.ph', password: 'Admin@123', municipality: 'Boac' },
  { role: 'sk_chairperson', email: 'juan@boac.gov.ph', password: 'Admin@123', municipality: 'Boac' },
  { role: 'sk_treasurer', email: 'maria@boac.gov.ph', password: 'Admin@123', municipality: 'Boac' },
  { role: 'sk_secretary', email: 'ana@gasan.gov.ph', password: 'Admin@123', municipality: 'Gasan' },
  { role: 'sk_chairperson', email: 'pedro@stac.gov.ph', password: 'Admin@123', municipality: 'Santa Cruz' },
  { role: 'dilg_representative', email: 'dilg@marinduque.gov.ph', password: 'Admin@123', municipality: '—' },
];

const KNOWN_GAPS = [
  { severity: 'High', item: 'No MFA (multi-factor authentication)' },
  { severity: 'Medium', item: 'Access token (15-min) cannot be revoked mid-life; the 30-day refresh token is DB-backed and revoked on logout, so a compromised access token is valid for at most 15 minutes.' },
  { severity: 'Medium', item: 'No server-side input sanitization middleware beyond Mongoose validators (express-validator only on auth + program + budget + expense + youth routes).' },
  { severity: 'Info', item: 'Allocation limits are enforced at expense creation (per-program and per-category caps block overspend); cross-budget aggregate reporting is still display-only.' },
  { severity: 'Medium', item: 'Program.budget is a Number field, not a FK ref to Budget model — programmatic budget linkage is via budgetRef but budget figure is a separate number.' },
  { severity: 'Info', item: 'Cloudinary credentials in .env — rotate at cloudinary.com if .env was ever committed to git (CLOUDINARY_API_KEY, CLOUDINARY_API_SECRET).' },
];

const CRON_JOBS = [
  { schedule: '0 8 * * *', description: 'Daily 08:00 — sendDeadlineReminders() — notifies SK officials of programs due within 7 days' },
  { schedule: '0 */6 * * *', description: 'Every 6 hours — checkComplianceAlerts() — generates in-app notifications for overdue programs and pending liquidations' },
];

const SECURITY_MEASURES = [
  'httpOnly JWT cookie (+ Bearer header fallback for API clients)',
  'Refresh token stored in DB; cleared on logout',
  'Password: bcrypt rounds=12; complexity: uppercase + number + special char required',
  'protect middleware: re-checks isEmailVerified + isActive + isApproved on every request',
  'Rate limiting: login 20/15min, email endpoints 5/15min',
  'Helmet with explicit CSP (directives set in server.js)',
  'express-mongo-sanitize (NoSQL injection prevention)',
  'HPP (HTTP Parameter Pollution prevention)',
  'All create/update handlers use ALLOWED_FIELDS whitelist (mass assignment prevention)',
  'All approval flows: atomic findOneAndUpdate({_id, status:expected}) — race condition prevention',
  'Municipality scoping: all non-admin list/create/update/delete ops scoped to own municipality',
  'Self-approval blocked on expenses (createdBy !== approver)',
  'Role assignment hierarchy: ASSIGNABLE_ROLES map prevents privilege escalation',
  'Self-assignable roles on register: limited to sk_* + dilg + youth; anything else is rejected',
  'ReDoS protection: escapeRegex() on all $regex search inputs',
  'HTML injection prevention in emails: esc() escapes user-controlled values in HTML templates',
  'Duplicate key error: field name only, no conflicting value echoed (prevents email enumeration)',
  'JSON.parse wrapped in try-catch (document tags field)',
  'MAX_LIMIT = 100 cap on all paginated endpoints (prevents DoS via ?limit=999999)',
  'AuditLog: all financial mutations, role changes, document operations',
  'AuditLog TTL: 7 years (Philippine government archive standard)',
  'Notification TTL: 90 days',
  '/api/health: no environment info leaked',
  'MIME type + extension validation on file uploads (must match)',
  'File serving: restricted to /uploads/avatar static; all documents via Cloudinary authenticated URLs',
];

// ─── COMPONENT ───────────────────────────────────────────────────────────────

const Section = ({ title, children }) => (
  <div className="mb-12">
    <h2 className="text-base font-bold text-navy-900 dark:text-navy-100 uppercase tracking-wider border-b border-navy-200 dark:border-navy-700 pb-2 mb-4">{title}</h2>
    {children}
  </div>
);

const Table = ({ headers, rows }) => (
  <div className="overflow-x-auto rounded-xl border border-gray-200 dark:border-gray-700">
    <table className="w-full text-xs">
      <thead className="bg-gray-50 dark:bg-gray-800 border-b border-gray-200 dark:border-gray-700">
        <tr>
          {headers.map((h) => (
            <th key={h} className="text-left px-3 py-2.5 font-semibold text-gray-600 dark:text-gray-300 whitespace-nowrap">{h}</th>
          ))}
        </tr>
      </thead>
      <tbody className="divide-y divide-gray-100 dark:divide-gray-700 bg-white dark:bg-gray-900">
        {rows}
      </tbody>
    </table>
  </div>
);

const Pill = ({ text, color = 'gray' }) => {
  const c = {
    gray: 'bg-gray-100 text-gray-700 dark:bg-gray-700 dark:text-gray-300',
    navy: 'bg-navy-100 text-navy-800 dark:bg-navy-900 dark:text-navy-200',
    green: 'bg-green-100 text-green-700',
    red: 'bg-red-100 text-red-700',
    yellow: 'bg-yellow-100 text-yellow-800',
    orange: 'bg-orange-100 text-orange-700',
  };
  return <span className={`inline-block px-1.5 py-0.5 rounded text-xs font-medium ${c[color]}`}>{text}</span>;
};

// ─── DATA FLOW DIAGRAM (DFD) ───────────────────────────────────────────────────
// Structured-analysis notation: external entities, processes, data stores, data flows.
// Theme-aware SVG colors are driven by the scoped <style> block in <SystemDFD/>
// (the app uses Tailwind darkMode:'class', so `.dark .dfd-*` overrides apply).

// External entity — square-cornered rectangle (source/sink of data)
const E = ({ x, y, w = 150, h = 50, lines }) => (
  <g>
    <rect x={x} y={y} width={w} height={h} className="dfd-entity" strokeWidth="1.5" />
    {lines.map((l, i) => (
      <text key={i} x={x + w / 2} y={y + h / 2 + 4 - (lines.length - 1) * 6 + i * 12}
        fontSize="11" textAnchor="middle" className="dfd-entity-t">{l}</text>
    ))}
  </g>
);

// Process — numbered rounded rectangle (Gane–Sarson) that transforms data
const P = ({ x, y, w = 224, h = 60, num, lines }) => (
  <g>
    <rect x={x} y={y} width={w} height={h} rx="10" className="dfd-proc" strokeWidth="1.5" />
    <line x1={x} y1={y + 20} x2={x + w} y2={y + 20} className="dfd-proc-line" strokeWidth="1.1" />
    <text x={x + 10} y={y + 14} fontSize="10" className="dfd-proc-num">{num}</text>
    {lines.map((l, i) => (
      <text key={i} x={x + w / 2} y={y + 38 + i * 12 - (lines.length - 1) * 6}
        fontSize="11" textAnchor="middle" className="dfd-proc-t">{l}</text>
    ))}
  </g>
);

// Data store — open-ended rectangle with an id compartment
const S = ({ x, y, w = 182, h = 36, id, label }) => (
  <g>
    <rect x={x} y={y} width="30" height={h} className="dfd-store" strokeWidth="1.4" />
    <line x1={x + 30} y1={y} x2={x + w} y2={y} className="dfd-store-line" strokeWidth="1.4" />
    <line x1={x + 30} y1={y + h} x2={x + w} y2={y + h} className="dfd-store-line" strokeWidth="1.4" />
    <text x={x + 15} y={y + h / 2 + 4} fontSize="10" textAnchor="middle" className="dfd-store-id">{id}</text>
    <text x={x + 38} y={y + h / 2 + 4} fontSize="10.5" className="dfd-store-t">{label}</text>
  </g>
);

// Data flow — arrow (optionally double-headed / dashed for read-only)
const Arr = ({ d, both, dashed }) => (
  <path d={d} className="dfd-flow" strokeWidth="1.4" fill="none"
    strokeDasharray={dashed ? '4 3' : undefined}
    markerEnd="url(#dfd-ah)" markerStart={both ? 'url(#dfd-ah)' : undefined} />
);

// Flow label with a small background chip for legibility over crossing lines
const Lbl = ({ x, y, anchor = 'middle', lines }) => {
  const w = Math.max(...lines.map((l) => l.length)) * 4.5 + 8;
  const bx = anchor === 'middle' ? x - w / 2 : anchor === 'end' ? x - w : x;
  return (
    <g>
      <rect x={bx} y={y - 9} width={w} height={lines.length * 11 + 2} rx="2" className="dfd-lbl-bg" opacity="0.92" />
      {lines.map((l, i) => (
        <text key={i} x={x} y={y + 2 + i * 11} fontSize="8.5" textAnchor={anchor} className="dfd-lbl-t">{l}</text>
      ))}
    </g>
  );
};

const DFD_STYLE = `
  .dfd-svg text { font-family: inherit; }
  .dfd-entity { fill:#eef2f7; stroke:#5b7995; }
  .dark .dfd-entity { fill:#243b53; stroke:#829ab1; }
  .dfd-entity-t { fill:#243b53; font-weight:600; }
  .dark .dfd-entity-t { fill:#dbe5f0; }
  .dfd-proc { fill:#ffffff; stroke:#334e68; }
  .dark .dfd-proc { fill:#16283b; stroke:#7f9cb8; }
  .dfd-proc-line { stroke:#cbd8e6; }
  .dark .dfd-proc-line { stroke:#3a536b; }
  .dfd-proc-num { fill:#486581; font-weight:700; }
  .dark .dfd-proc-num { fill:#9fb3c8; }
  .dfd-proc-t { fill:#1e3a5f; font-weight:600; }
  .dark .dfd-proc-t { fill:#e7eef6; }
  .dfd-store { fill:#eaf7f1; stroke:#0f9d6b; }
  .dark .dfd-store { fill:#08312a; stroke:#12b886; }
  .dfd-store-line { stroke:#0f9d6b; }
  .dark .dfd-store-line { stroke:#12b886; }
  .dfd-store-id { fill:#08795a; font-weight:700; }
  .dark .dfd-store-id { fill:#5eead4; }
  .dfd-store-t { fill:#0b6b4f; font-weight:600; }
  .dark .dfd-store-t { fill:#99f6e0; }
  .dfd-flow { stroke:#8aa0b4; }
  .dark .dfd-flow { stroke:#64748b; }
  .dfd-arrow { fill:#8aa0b4; }
  .dark .dfd-arrow { fill:#64748b; }
  .dfd-lbl-bg { fill:#ffffff; }
  .dark .dfd-lbl-bg { fill:#1f2937; }
  .dfd-lbl-t { fill:#5b6b7b; }
  .dark .dfd-lbl-t { fill:#9aa8b6; }
`;

// Textual flow index — guarantees completeness independent of arrow density
const DFD_PROCESSES = [
  { id: '1.0', name: 'Authenticate & Manage Users', entities: 'SK Official, Administrator', stores: 'D1 Users, D10 Audit Logs', out: 'Email (verification/approval)' },
  { id: '2.0', name: 'Manage Programs', entities: 'SK Official (EDITORS)', stores: 'D2 Programs', out: '—' },
  { id: '3.0', name: 'Manage Budgets & Expenses', entities: 'SK Official (FINANCE), DILG (approve)', stores: 'D3 Budgets, D4 Expenses, D10 Audit Logs', out: 'Email (approval)' },
  { id: '4.0', name: 'Process Liquidations', entities: 'SK Official (FINANCE), DILG (approve)', stores: 'D4 Expenses (read), D5 Liquidations, D10 Audit Logs', out: 'Email (approve/reject)' },
  { id: '5.0', name: 'Manage Documents', entities: 'SK Official (DOC), Public (download)', stores: 'D6 Documents, D10 Audit Logs', out: 'Cloudinary (files)' },
  { id: '6.0', name: 'Register Youth Members', entities: 'SK Official (YOUTH)', stores: 'D7 Youth Members, D10 Audit Logs', out: '—' },
  { id: '7.0', name: 'Generate Reports & Analytics', entities: 'Administrator, DILG', stores: 'reads D2, D3, D4, D5, D7', out: 'PDF / Excel' },
  { id: '8.0', name: 'Serve Public Portal & Notifications', entities: 'Public Citizen', stores: 'reads D2, D3, D6, D8 · writes D9 Notifications', out: 'Email (deadline/compliance alerts)' },
];

const DFD_STORES = [
  'D1 Users', 'D2 Programs', 'D3 Budgets', 'D4 Expenses', 'D5 Liquidations',
  'D6 Documents', 'D7 Youth Members', 'D8 Announcements', 'D9 Notifications', 'D10 Audit Logs',
];

const DFD_ENTITIES = [
  { name: 'SK Officials', note: 'Chairperson, Treasurer, Secretary, Kagawad — data entry & requests' },
  { name: 'Administrators', note: 'Super / Provincial / Municipal — approvals, roles, monitoring' },
  { name: 'DILG Representative', note: 'Reviews & approves budgets / expenses / liquidations; reads reports' },
  { name: 'Public Citizens', note: 'Read-only transparency portal — programs, budget, documents' },
  { name: 'Email / SMTP Service', note: 'External sink — verification, approval, reset & alert emails' },
];

const SystemDFD = () => (
  <div className="space-y-6">
    <style>{DFD_STYLE}</style>

    {/* Shared arrowhead marker (global id, referenced by both diagrams) */}
    <svg width="0" height="0" className="absolute" aria-hidden="true">
      <defs>
        <marker id="dfd-ah" markerWidth="9" markerHeight="9" refX="7" refY="3" orient="auto" markerUnits="userSpaceOnUse">
          <path d="M0,0 L7,3 L0,6 Z" className="dfd-arrow" />
        </marker>
      </defs>
    </svg>

    {/* Notation legend */}
    <div className="flex flex-wrap items-center gap-4 text-[11px] text-gray-500 dark:text-gray-400 bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-xl px-4 py-3">
      <span className="font-semibold text-gray-600 dark:text-gray-300">Notation:</span>
      <span className="flex items-center gap-1.5"><span className="inline-block w-5 h-3.5 border-[1.5px] border-navy-500 bg-navy-50 dark:bg-navy-900/50 dark:border-navy-400"></span>External Entity</span>
      <span className="flex items-center gap-1.5"><span className="inline-block w-5 h-3.5 rounded-md border-[1.5px] border-navy-700 bg-white dark:bg-navy-900 dark:border-navy-300"></span>Process</span>
      <span className="flex items-center gap-1.5"><span className="inline-block w-5 h-3.5 border-y-[1.5px] border-l-[1.5px] border-emerald-500 bg-emerald-50 dark:bg-emerald-900/30"></span>Data Store</span>
      <span className="flex items-center gap-1.5"><span className="text-gray-400 text-sm leading-none">→</span>Data Flow</span>
      <span className="flex items-center gap-1.5"><span className="text-gray-400 text-sm leading-none tracking-tighter">--→</span>Read-only Flow</span>
    </div>

    {/* ── Level 0: Context Diagram ── */}
    <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 p-4">
      <p className="text-xs font-bold text-gray-700 dark:text-gray-200 mb-1">Level 0 — Context Diagram</p>
      <p className="text-[11px] text-gray-400 dark:text-gray-500 mb-3">The whole system as a single process (0) with its external entities and top-level data flows.</p>
      <div className="overflow-x-auto">
        <svg viewBox="0 0 820 560" width="100%" style={{ minWidth: 620, maxWidth: 820 }} className="dfd-svg mx-auto">
          {/* Entities */}
          <E x={30} y={250} w={150} h={60} lines={['SK Officials']} />
          <E x={640} y={250} w={150} h={60} lines={['Public', 'Citizens']} />
          <E x={335} y={38} w={150} h={56} lines={['Administrators']} />
          <E x={335} y={468} w={150} h={56} lines={['DILG', 'Representative']} />
          <E x={40} y={452} w={150} h={56} lines={['Email / SMTP', 'Service']} />
          {/* Central process */}
          <P x={310} y={232} w={200} h={96} num="0" lines={['SKIMS', 'Integrated', 'Management System']} />

          {/* SK Officials ↔ system */}
          <Arr d="M180,268 L306,268" />
          <Lbl x={244} y={260} lines={['login · program / finance', '/ youth data · documents']} />
          <Arr d="M306,300 L182,300" />
          <Lbl x={245} y={312} lines={['dashboards · reports · alerts']} />

          {/* Public ↔ system */}
          <Arr d="M640,268 L514,268" />
          <Lbl x={576} y={260} lines={['public info request']} />
          <Arr d="M514,300 L638,300" />
          <Lbl x={576} y={312} lines={['public programs · budget', '· documents']} />

          {/* Administrators ↔ system */}
          <Arr d="M388,94 L388,230" />
          <Lbl x={382} y={150} anchor="end" lines={['approvals ·', 'user & role mgmt']} />
          <Arr d="M432,230 L432,94" />
          <Lbl x={438} y={150} anchor="start" lines={['pending reqs ·', 'audit logs']} />

          {/* DILG ↔ system */}
          <Arr d="M388,466 L388,330" />
          <Lbl x={382} y={402} anchor="end" lines={['budget / liq.', 'approvals']} />
          <Arr d="M432,330 L432,466" />
          <Lbl x={438} y={402} anchor="start" lines={['financial &', 'monitoring reports']} />

          {/* system → Email */}
          <Arr d="M312,318 L190,452" />
          <Lbl x={252} y={392} lines={['verification /', 'notification emails']} />
        </svg>
      </div>
    </div>

    {/* ── Level 1 DFD ── */}
    <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 p-4">
      <p className="text-xs font-bold text-gray-700 dark:text-gray-200 mb-1">Level 1 — Decomposition</p>
      <p className="text-[11px] text-gray-400 dark:text-gray-500 mb-3">Major processes (center), external entities (left), and data stores (right). Dashed arrows are read-only flows.</p>
      <div className="overflow-x-auto">
        <svg viewBox="0 0 1000 760" width="100%" style={{ minWidth: 760, maxWidth: 1000 }} className="dfd-svg mx-auto">
          {/* External entities (left) */}
          <E x={18} y={40} w={150} h={48} lines={['Administrators']} />
          <E x={18} y={236} w={150} h={52} lines={['SK Officials']} />
          <E x={18} y={352} w={150} h={50} lines={['DILG Rep']} />
          <E x={18} y={560} w={150} h={48} lines={['Public Citizens']} />
          <E x={18} y={672} w={150} h={44} lines={['Email / SMTP']} />

          {/* Processes (center) */}
          <P x={388} y={40} num="1.0" lines={['Authenticate &', 'Manage Users']} />
          <P x={388} y={118} num="2.0" lines={['Manage Programs']} />
          <P x={388} y={196} num="3.0" lines={['Manage Budgets', '& Expenses']} />
          <P x={388} y={286} num="4.0" lines={['Process Liquidations']} />
          <P x={388} y={376} num="5.0" lines={['Manage Documents']} />
          <P x={388} y={466} num="6.0" lines={['Register Youth']} />
          <P x={388} y={556} num="7.0" lines={['Reports & Analytics']} />
          <P x={388} y={646} num="8.0" lines={['Public Portal &', 'Notifications']} />

          {/* Data stores (right) */}
          <S x={804} y={50} id="D1" label="Users" />
          <S x={804} y={128} id="D2" label="Programs" />
          <S x={804} y={196} id="D3" label="Budgets" />
          <S x={804} y={240} id="D4" label="Expenses" />
          <S x={804} y={298} id="D5" label="Liquidations" />
          <S x={804} y={386} id="D6" label="Documents" />
          <S x={804} y={476} id="D7" label="Youth Members" />
          <S x={804} y={566} id="D8" label="Announcements" />
          <S x={804} y={650} id="D9" label="Notifications" />
          <S x={804} y={712} id="D10" label="Audit Logs" />

          {/* Process ↔ store (right side) */}
          <Arr d="M612,66 L802,68" both />
          <Lbl x={708} y={58} lines={['credentials · profiles']} />
          <Arr d="M612,146 L802,146" both />
          <Lbl x={708} y={138} lines={['program records']} />
          <Arr d="M612,214 L802,214" both />
          <Lbl x={706} y={206} lines={['allocations']} />
          <Arr d="M612,236 L802,258" both />
          <Lbl x={712} y={252} lines={['expense records']} />
          <Arr d="M612,316 L802,316" both />
          <Lbl x={708} y={308} lines={['liquidation reports']} />
          <Arr d="M612,406 L802,404" both />
          <Lbl x={708} y={398} lines={['document metadata']} />
          <Arr d="M612,496 L802,494" both />
          <Lbl x={708} y={488} lines={['youth records']} />
          <Arr d="M612,662 L802,584" dashed />
          <Lbl x={716} y={624} lines={['announcements']} />
          <Arr d="M612,680 L802,668" both />
          <Lbl x={708} y={692} lines={['notifications']} />

          {/* Reports (7.0) aggregate reads */}
          <Arr d="M612,570 L802,258" dashed />
          <Arr d="M612,580 L802,316" dashed />
          <Arr d="M612,590 L802,494" dashed />
          <Lbl x={706} y={540} lines={['aggregate reads']} />

          {/* Audit trail writes (representative — see flow index for all writers) */}
          <Arr d="M612,690 L802,724" dashed />
          <Lbl x={742} y={702} lines={['audit trail']} />

          {/* Administrators → processes */}
          <Arr d="M168,58 L386,58" />
          <Lbl x={278} y={50} lines={['approve users · roles']} />
          <Arr d="M168,80 L386,574" dashed />
          <Lbl x={276} y={470} lines={['monitor / view']} />

          {/* SK Officials fan-out (create / update) */}
          <Arr d="M168,258 L386,64" />
          <Arr d="M168,260 L386,140" />
          <Arr d="M168,262 L386,220" />
          <Arr d="M168,264 L386,310" />
          <Arr d="M168,266 L386,400" />
          <Arr d="M168,268 L386,490" />
          <Lbl x={262} y={250} lines={['create / update', 'records']} />

          {/* DILG → processes / reports */}
          <Arr d="M168,368 L386,226" />
          <Lbl x={264} y={300} lines={['approve', 'budget / expense']} />
          <Arr d="M168,382 L386,312" />
          <Lbl x={264} y={356} lines={['approve liq.']} />
          <Arr d="M386,586 L168,392" />
          <Lbl x={266} y={452} lines={['financial reports']} />

          {/* Public ↔ portal */}
          <Arr d="M168,580 L386,662" />
          <Lbl x={266} y={634} lines={['portal request']} />
          <Arr d="M386,684 L168,600" />
          <Lbl x={266} y={694} lines={['public info']} />

          {/* Notifications → Email */}
          <Arr d="M386,700 L170,700" />
          <Lbl x={282} y={686} lines={['emails']} />
        </svg>
      </div>
    </div>

    {/* ── Flow index (textual completeness) ── */}
    <div className="grid md:grid-cols-3 gap-4">
      <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 p-4">
        <p className="text-xs font-bold text-navy-800 dark:text-navy-200 mb-2">External Entities</p>
        <ul className="space-y-1.5">
          {DFD_ENTITIES.map((e) => (
            <li key={e.name} className="text-[11px] text-gray-600 dark:text-gray-300">
              <span className="font-semibold">{e.name}</span>
              <span className="block text-gray-400 dark:text-gray-500">{e.note}</span>
            </li>
          ))}
        </ul>
      </div>
      <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 p-4 md:col-span-2">
        <p className="text-xs font-bold text-navy-800 dark:text-navy-200 mb-2">Processes → Data Stores &amp; Outputs</p>
        <div className="overflow-x-auto">
          <table className="w-full text-[11px]">
            <thead className="text-gray-500 dark:text-gray-400 border-b border-gray-200 dark:border-gray-700">
              <tr>
                <th className="text-left py-1 pr-2 font-semibold whitespace-nowrap">#</th>
                <th className="text-left py-1 pr-2 font-semibold">Process</th>
                <th className="text-left py-1 pr-2 font-semibold">Data Stores</th>
                <th className="text-left py-1 font-semibold">External Output</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100 dark:divide-gray-700">
              {DFD_PROCESSES.map((p) => (
                <tr key={p.id}>
                  <td className="py-1 pr-2 font-mono text-navy-600 dark:text-navy-300 align-top">{p.id}</td>
                  <td className="py-1 pr-2 text-gray-700 dark:text-gray-200 align-top">{p.name}</td>
                  <td className="py-1 pr-2 text-emerald-700 dark:text-emerald-400 align-top">{p.stores}</td>
                  <td className="py-1 text-gray-500 dark:text-gray-400 align-top">{p.out}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="text-[10px] text-gray-400 dark:text-gray-500 mt-2">
          Data stores: {DFD_STORES.join(' · ')}. Files for D6 are stored in Cloudinary; D10 (Audit Logs) is written by processes 1, 3, 4, 5 &amp; 8 for every financial mutation, role change and document operation.
        </p>
      </div>
    </div>
  </div>
);

export default function SystemReference() {
  const { user } = useAuthStore();

  return (
    <div className="min-h-screen bg-gray-50 dark:bg-gray-950">
      <div className="max-w-6xl mx-auto px-6 py-10">

        {/* Header */}
        <div className="mb-10">
          <div className="flex items-center gap-3 mb-1">
            <div className="w-9 h-9 rounded-lg overflow-hidden bg-white border border-gray-200 shadow-sm">
              <img src="/main_logo.jfif" alt="SKIMS" className="w-full h-full object-contain" />
            </div>
            <div>
              <h1 className="text-2xl font-bold text-gray-900 dark:text-white">{SYSTEM.full}</h1>
              <p className="text-xs text-gray-400">{SYSTEM.name} v{SYSTEM.version} · Internal System Reference · No navigation link</p>
            </div>
          </div>
          <div className="ml-12 mt-2 text-xs text-gray-500 dark:text-gray-400">
            Viewing as <span className="font-semibold text-navy-700 dark:text-navy-300">{user?.firstName} {user?.lastName}</span> ({user?.role})
            &nbsp;·&nbsp; {SYSTEM.context}
          </div>
          <div className="ml-12 mt-1 text-xs text-gray-400">
            Municipalities: {SYSTEM.municipalities.join(' · ')}
          </div>
        </div>

        {/* Tech Stack */}
        <Section title="Technology Stack">
          <Table
            headers={['Layer', 'Technology', 'Notes']}
            rows={STACK.map((s) => (
              <tr key={s.layer}>
                <td className="px-3 py-2 font-medium text-gray-700 dark:text-gray-200 whitespace-nowrap">{s.layer}</td>
                <td className="px-3 py-2 font-mono text-navy-700 dark:text-navy-300 whitespace-nowrap">{s.tech}</td>
                <td className="px-3 py-2 text-gray-500 dark:text-gray-400">{s.note}</td>
              </tr>
            ))}
          />
        </Section>

        {/* Data Flow Diagram (DFD) */}
        <Section title="Data Flow Diagram (DFD)">
          <p className="text-xs text-gray-500 dark:text-gray-400 mb-4">
            Structured-analysis DFD showing how data moves through SKIMS — external entities (sources/sinks), processes (transformations), data stores, and labeled data flows. Level 0 (Context) gives the high-level overview; Level 1 decomposes the system into its major processes. Diagrams scroll horizontally on small screens.
          </p>
          <SystemDFD />
        </Section>

        {/* Roles */}
        <Section title="Roles &amp; Scope">
          <Table
            headers={['Role Key', 'Display Name', 'Data Scope', 'Auto-Approved', 'Can Assign']}
            rows={ROLES.map((r) => (
              <tr key={r.role} className={r.role === user?.role ? 'bg-navy-50 dark:bg-navy-900/30' : ''}>
                <td className="px-3 py-2 font-mono text-navy-700 dark:text-navy-300">{r.role}</td>
                <td className="px-3 py-2 font-medium text-gray-800 dark:text-gray-100">{r.label}</td>
                <td className="px-3 py-2 text-gray-500 dark:text-gray-400">{r.scope}</td>
                <td className="px-3 py-2">
                  {r.autoApproved
                    ? <Pill text="Yes — on register" color="green" />
                    : <Pill text="No — admin required" color="yellow" />}
                </td>
                <td className="px-3 py-2 text-gray-500 dark:text-gray-400">{r.canAssign}</td>
              </tr>
            ))}
          />
          <div className="mt-4">
            <p className="text-xs font-semibold text-gray-600 dark:text-gray-300 mb-2">Role Groups (backend/src/constants/roles.js + frontend/src/utils/constants.js)</p>
            <Table
              headers={['Group Name', 'Roles Included', 'Used For']}
              rows={ROLE_GROUPS.map((g) => (
                <tr key={g.name}>
                  <td className="px-3 py-2 font-mono text-green-700 dark:text-green-400">{g.name}</td>
                  <td className="px-3 py-2 text-gray-600 dark:text-gray-300">{g.roles}</td>
                  <td className="px-3 py-2 text-gray-500 dark:text-gray-400">{g.use}</td>
                </tr>
              ))}
            />
          </div>
        </Section>

        {/* Auth Flow */}
        <Section title="Authentication Flow">
          <div className="space-y-2 mb-4">
            {AUTH_FLOW.map((s) => (
              <div key={s.step} className="flex gap-3 bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 p-3">
                <div className="w-6 h-6 rounded-full bg-navy-900 text-white text-xs font-bold flex items-center justify-center flex-shrink-0">{s.step}</div>
                <div>
                  <p className="font-semibold text-gray-900 dark:text-white text-xs">{s.label}</p>
                  <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">{s.detail}</p>
                </div>
              </div>
            ))}
          </div>
          <div className="bg-yellow-50 dark:bg-yellow-900/20 border border-yellow-200 dark:border-yellow-800 rounded-xl p-3 text-xs text-yellow-800 dark:text-yellow-300">
            <strong>protect</strong> re-checks isEmailVerified + isActive + isApproved on every protected request. JWT in httpOnly cookie; Bearer header fallback. 15-min access token, refreshed via a 30-day DB-backed refresh token that is revoked on logout.
          </div>
        </Section>

        {/* Financial Flow */}
        <Section title="Financial Workflow">
          <div className="flex flex-wrap gap-2 mb-4 bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 p-4">
            {['Purchase Request', 'Purchase Order', 'Delivery Receipt', 'Inspection Report', 'Sales Invoice', 'Disbursement Voucher', 'Official Receipt', 'Liquidation'].map((s, i, arr) => (
              <span key={s} className="flex items-center gap-1 text-xs">
                <span className="bg-navy-100 dark:bg-navy-900 text-navy-800 dark:text-navy-200 px-2 py-0.5 rounded font-medium">{s}</span>
                {i < arr.length - 1 && <span className="text-gray-400">→</span>}
              </span>
            ))}
          </div>
          <div className="space-y-2 mb-4">
            {FINANCIAL_FLOW.map((s) => (
              <div key={s.step} className="flex gap-3 bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 p-3">
                <div className="w-6 h-6 rounded-full bg-yellow-400 text-navy-900 text-xs font-bold flex items-center justify-center flex-shrink-0">{s.step}</div>
                <div>
                  <p className="font-semibold text-gray-900 dark:text-white text-xs">{s.label}</p>
                  <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">{s.detail}</p>
                </div>
              </div>
            ))}
          </div>
          <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 p-4">
            <p className="text-xs font-semibold text-gray-600 dark:text-gray-300 mb-2">Document Management Flow</p>
            <ul className="space-y-1">
              {DOC_WORKFLOW.map((d, i) => (
                <li key={i} className="text-xs text-gray-500 dark:text-gray-400 flex gap-2"><span className="text-navy-400">→</span>{d}</li>
              ))}
            </ul>
          </div>
        </Section>

        {/* API Endpoints */}
        <Section title="Backend API Endpoints">
          <div className="space-y-4">
            {API_ENDPOINTS.map((group) => (
              <div key={group.group}>
                <p className="text-xs font-bold text-gray-700 dark:text-gray-200 mb-1.5">{group.group}</p>
                <Table
                  headers={['Method', 'Path', 'Auth', 'Roles', 'Notes']}
                  rows={group.routes.map((r, i) => (
                    <tr key={i}>
                      <td className="px-3 py-2">
                        <Pill text={r.method} color={r.method === 'GET' ? 'navy' : r.method === 'DELETE' ? 'red' : r.method === 'POST' ? 'green' : 'orange'} />
                      </td>
                      <td className="px-3 py-2 font-mono text-gray-700 dark:text-gray-300 whitespace-nowrap">{r.path}</td>
                      <td className="px-3 py-2 text-gray-500 dark:text-gray-400 whitespace-nowrap">{r.auth}</td>
                      <td className="px-3 py-2 text-gray-600 dark:text-gray-400">{r.roles}</td>
                      <td className="px-3 py-2 text-gray-400 dark:text-gray-500 italic">{r.note}</td>
                    </tr>
                  ))}
                />
              </div>
            ))}
          </div>
        </Section>

        {/* Data Models */}
        <Section title="Data Models">
          <div className="space-y-3">
            {MODELS.map((m) => (
              <div key={m.name} className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 p-4">
                <p className="font-bold text-sm text-navy-800 dark:text-navy-200 mb-1">{m.name}</p>
                <p className="text-xs text-gray-600 dark:text-gray-300 mb-1"><span className="font-medium text-gray-500 dark:text-gray-400">Fields: </span>{m.key_fields}</p>
                <p className="text-xs text-gray-400 dark:text-gray-500 italic">{m.notes}</p>
              </div>
            ))}
          </div>
        </Section>

        {/* Frontend Routes */}
        <Section title="Frontend Routes">
          <Table
            headers={['Path', 'Allowed Roles', 'Notes']}
            rows={FRONTEND_ROUTES.map((r) => (
              <tr key={r.path} className={r.path === '/ref' ? 'bg-navy-50 dark:bg-navy-900/30' : ''}>
                <td className="px-3 py-2 font-mono text-navy-700 dark:text-navy-300 whitespace-nowrap">{r.path}</td>
                <td className="px-3 py-2 text-gray-600 dark:text-gray-300">{r.roles}</td>
                <td className="px-3 py-2 text-gray-400 dark:text-gray-500 italic">{r.note}</td>
              </tr>
            ))}
          />
        </Section>

        {/* Module Permissions */}
        <Section title="Module Permissions Matrix">
          <Table
            headers={['Module / Action', 'Allowed Roles']}
            rows={PERMISSIONS_TABLE.map((p) => (
              <tr key={p.module}>
                <td className="px-3 py-2 font-medium text-gray-800 dark:text-gray-100">{p.module}</td>
                <td className="px-3 py-2 text-gray-500 dark:text-gray-400">{p.access}</td>
              </tr>
            ))}
          />
        </Section>

        {/* Security Measures */}
        <Section title="Security Measures Implemented">
          <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 p-4">
            <ul className="space-y-1">
              {SECURITY_MEASURES.map((s, i) => (
                <li key={i} className="text-xs text-gray-600 dark:text-gray-300 flex gap-2">
                  <span className="text-green-500 flex-shrink-0">✓</span>{s}
                </li>
              ))}
            </ul>
          </div>
        </Section>

        {/* Cron Jobs */}
        <Section title="Background Jobs (node-cron)">
          <div className="space-y-2">
            {CRON_JOBS.map((c) => (
              <div key={c.schedule} className="flex gap-3 bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 p-3">
                <code className="text-xs bg-gray-100 dark:bg-gray-700 text-gray-700 dark:text-gray-300 px-2 py-0.5 rounded whitespace-nowrap self-start">{c.schedule}</code>
                <p className="text-xs text-gray-600 dark:text-gray-300">{c.description}</p>
              </div>
            ))}
          </div>
        </Section>

        {/* Test Accounts */}
        <Section title="Test Accounts (post-seed)">
          <Table
            headers={['Role', 'Email', 'Password', 'Municipality']}
            rows={TEST_ACCOUNTS.map((a) => (
              <tr key={a.email}>
                <td className="px-3 py-2 font-mono text-navy-700 dark:text-navy-300">{a.role}</td>
                <td className="px-3 py-2 text-gray-700 dark:text-gray-200">{a.email}</td>
                <td className="px-3 py-2 font-mono text-gray-500 dark:text-gray-400">{a.password}</td>
                <td className="px-3 py-2 text-gray-500 dark:text-gray-400">{a.municipality}</td>
              </tr>
            ))}
          />
          <p className="text-xs text-gray-400 dark:text-gray-500 mt-2">Re-seed: <code className="bg-gray-100 dark:bg-gray-800 px-1 rounded">cd backend && npm run seed</code> — wipes all data and rebuilds from seeder.</p>
        </Section>

        {/* Known Gaps */}
        <Section title="Known Remaining Gaps">
          <div className="space-y-2">
            {KNOWN_GAPS.map((g, i) => (
              <div key={i} className="flex gap-3 bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 p-3">
                <Pill
                  text={g.severity}
                  color={g.severity === 'High' ? 'red' : g.severity === 'Medium' ? 'orange' : g.severity === 'Low' ? 'yellow' : 'gray'}
                />
                <p className="text-xs text-gray-600 dark:text-gray-300">{g.item}</p>
              </div>
            ))}
          </div>
        </Section>

        {/* Confirm Dialogs */}
        <Section title="SweetAlert2 Confirm Utilities (frontend/src/utils/confirm.js)">
          <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 p-4">
            <p className="text-xs text-gray-500 dark:text-gray-400 mb-2">Import: <code className="bg-gray-100 dark:bg-gray-700 px-1 rounded">{'import { confirm } from \'../../utils/confirm\''}</code></p>
            <div className="flex flex-wrap gap-2">
              {['confirm.delete()', 'confirm.create()', 'confirm.save()', 'confirm.submit()', 'confirm.approve()', 'confirm.reject()', 'confirm.archive()', 'confirm.upload()', 'confirm.financial()', 'confirm.statusChange()', 'confirm.logout()', 'confirm.register()', 'confirm.password()'].map((f) => (
                <code key={f} className="text-xs bg-navy-50 dark:bg-navy-900/40 text-navy-700 dark:text-navy-300 px-2 py-0.5 rounded">{f}</code>
              ))}
            </div>
            <p className="text-xs text-gray-400 dark:text-gray-500 mt-2">All return a Promise. Check <code className="bg-gray-100 dark:bg-gray-700 px-1 rounded">result.isConfirmed</code> before executing the action. Never use <code className="bg-gray-100 dark:bg-gray-700 px-1 rounded">window.confirm()</code>.</p>
          </div>
        </Section>

        <p className="text-xs text-gray-300 dark:text-gray-600 text-center mt-8 pb-4">
          SKIMS · Sangguniang Kabataan Integrated Program and Fund Management System · Internal Reference · No nav link · /ref
        </p>
      </div>
    </div>
  );
}
