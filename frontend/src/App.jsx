import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { Toaster } from './components/ui/toaster';
import useAuthStore from './store/authStore';
import ErrorBoundary from './components/shared/ErrorBoundary';
import DashboardLayout from './components/layout/DashboardLayout';
import PublicLayout from './components/layout/PublicLayout';

// Auth pages
import Login from './pages/auth/Login';
import Register from './pages/auth/Register';
import ForgotPassword from './pages/auth/ForgotPassword';
import ResetPassword from './pages/auth/ResetPassword';
import VerifyEmail from './pages/auth/VerifyEmail';

// Dashboard
import Dashboard from './pages/dashboard/Dashboard';

// Programs
import Programs from './pages/programs/Programs';
import ProgramCreate from './pages/programs/ProgramCreate';
import ProgramDetail from './pages/programs/ProgramDetail';
import ProgramEdit from './pages/programs/ProgramEdit';

// Funds
import Budgets from './pages/funds/Budgets';
import Expenses from './pages/funds/Expenses';
import Liquidations from './pages/funds/Liquidations';

// Documents
import Documents from './pages/documents/Documents';

// Reports
import Reports from './pages/reports/Reports';

// Monitoring
import Monitoring from './pages/monitoring/Monitoring';

// Analytics
import Analytics from './pages/analytics/Analytics';

// Users
import Users from './pages/users/Users';
import UserProfile from './pages/users/UserProfile';

// Notifications
import Notifications from './pages/notifications/Notifications';

// Youth
import Youth from './pages/youth/Youth';

// Public
import PublicPortal from './pages/public/PublicPortal';

// Announcements
import Announcements from './pages/announcements/Announcements';

// Hidden reference
import SystemReference from './pages/SystemReference';

// Audit Logs
import AuditLogs from './pages/admin/AuditLogs';

import { STAFF, PROGRAM_EDITORS, REPORTERS, EDITOR_ROLES as CONTENT_EDITORS, ADMIN_ROLES } from './utils/constants';

const ProtectedRoute = ({ children, roles, fallback = '/dashboard' }) => {
  const { isAuthenticated, user } = useAuthStore();
  if (!isAuthenticated) return <Navigate to="/login" replace />;
  if (roles && !roles.includes(user?.role)) return <Navigate to={fallback} replace />;
  return children;
};

const PublicRoute = ({ children }) => {
  const { isAuthenticated } = useAuthStore();
  if (isAuthenticated) return <Navigate to="/dashboard" replace />;
  return children;
};

export default function App() {
  return (
    <ErrorBoundary>
    <BrowserRouter>
      <Toaster />
      <Routes>
        {/* Auth routes */}
        <Route path="/login" element={<PublicRoute><Login /></PublicRoute>} />
        <Route path="/register" element={<PublicRoute><Register /></PublicRoute>} />
        <Route path="/forgot-password" element={<PublicRoute><ForgotPassword /></PublicRoute>} />
        <Route path="/reset-password/:token" element={<PublicRoute><ResetPassword /></PublicRoute>} />
        <Route path="/verify-email/:token" element={<VerifyEmail />} />

        {/* Public portal */}
        <Route path="/portal" element={<PublicLayout><PublicPortal /></PublicLayout>} />

        {/* Protected dashboard routes — public_user is redirected to /portal */}
        <Route path="/" element={<ProtectedRoute roles={STAFF} fallback="/portal"><DashboardLayout /></ProtectedRoute>}>
          <Route index element={<Navigate to="/dashboard" replace />} />
          <Route path="dashboard" element={<Dashboard />} />
          <Route path="programs" element={<Programs />} />
          <Route path="programs/new" element={<ProtectedRoute roles={PROGRAM_EDITORS}><ProgramCreate /></ProtectedRoute>} />
          <Route path="programs/:id" element={<ProgramDetail />} />
          <Route path="programs/:id/edit" element={<ProtectedRoute roles={PROGRAM_EDITORS}><ProgramEdit /></ProtectedRoute>} />
          <Route path="budgets" element={<Budgets />} />
          <Route path="expenses" element={<Expenses />} />
          <Route path="liquidations" element={<Liquidations />} />
          <Route path="documents" element={<Documents />} />
          <Route path="reports" element={<ProtectedRoute roles={REPORTERS}><Reports /></ProtectedRoute>} />
          <Route path="monitoring" element={<Monitoring />} />
          <Route path="analytics" element={<ProtectedRoute roles={REPORTERS}><Analytics /></ProtectedRoute>} />
          <Route path="users" element={<ProtectedRoute roles={ADMIN_ROLES}><Users /></ProtectedRoute>} />
          <Route path="profile" element={<UserProfile />} />
          <Route path="notifications" element={<Notifications />} />
          <Route path="youth" element={<Youth />} />
          <Route path="announcements" element={<ProtectedRoute roles={CONTENT_EDITORS}><Announcements /></ProtectedRoute>} />
          <Route path="audit-logs" element={<ProtectedRoute roles={ADMIN_ROLES}><AuditLogs /></ProtectedRoute>} />
        </Route>

        {/* Hidden system reference — no nav link, manual URL only */}
        <Route path="/ref" element={<ProtectedRoute><SystemReference /></ProtectedRoute>} />

        <Route path="*" element={
          <div className="min-h-screen flex items-center justify-center bg-gray-50">
            <div className="text-center">
              <p className="text-6xl font-black text-navy-900">404</p>
              <p className="text-xl font-semibold text-gray-700 mt-2">Page not found</p>
              <p className="text-sm text-gray-400 mt-1">The page you're looking for doesn't exist.</p>
              <a href="/dashboard" className="mt-6 inline-block px-5 py-2.5 bg-navy-900 text-white rounded-xl text-sm font-semibold hover:bg-navy-800 transition-colors">Go to Dashboard</a>
            </div>
          </div>
        } />
      </Routes>
    </BrowserRouter>
    </ErrorBoundary>
  );
}
