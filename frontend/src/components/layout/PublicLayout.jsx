import { Link } from 'react-router-dom';
import { LayoutDashboard, LogIn, LogOut } from 'lucide-react';
import useAuthStore from '../../store/authStore';
import { confirm } from '../../utils/confirm';

export default function PublicLayout({ children }) {
  const { isAuthenticated, logout } = useAuthStore();

  const handleLogout = async () => {
    const result = await confirm.logout();
    if (result.isConfirmed) logout();
  };

  return (
    <div className="min-h-screen bg-gray-50">
      <header className="bg-navy-900 text-white shadow-lg">
        <div className="max-w-7xl mx-auto px-4 py-4 flex items-center justify-between">
          <Link to="/portal" className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-lg overflow-hidden bg-white">
              <img src="/main_logo.jfif" alt="SKIMS" className="w-full h-full object-contain" />
            </div>
            <div>
              <div className="font-bold text-lg leading-tight">SKIMS</div>
              <div className="text-navy-300 text-xs">Sangguniang Kabataan — Marinduque</div>
            </div>
          </Link>
          <nav className="hidden md:flex items-center gap-6 text-sm">
            <Link to="/portal" className="text-navy-300 hover:text-white transition-colors">Home</Link>
            <a href="#programs" className="text-navy-300 hover:text-white transition-colors">Programs</a>
            <a href="#budget" className="text-navy-300 hover:text-white transition-colors">Budget</a>
            <a href="#announcements" className="text-navy-300 hover:text-white transition-colors">Announcements</a>
          </nav>
          {isAuthenticated ? (
            <div className="flex items-center gap-2">
              <Link to="/dashboard"
                className="flex items-center gap-2 bg-gold-500 text-navy-900 px-4 py-2 rounded-lg text-sm font-semibold hover:bg-gold-400 transition-colors">
                <LayoutDashboard size={15} />
                Dashboard
              </Link>
              <button onClick={handleLogout}
                className="flex items-center gap-2 border border-navy-600 text-navy-300 px-4 py-2 rounded-lg text-sm font-semibold hover:bg-navy-800 hover:text-white transition-colors">
                <LogOut size={15} />
                Sign Out
              </button>
            </div>
          ) : (
            <Link to="/login"
              className="flex items-center gap-2 bg-gold-500 text-navy-900 px-4 py-2 rounded-lg text-sm font-semibold hover:bg-gold-400 transition-colors">
              <LogIn size={15} />
              Login
            </Link>
          )}
        </div>
      </header>
      <main>{children}</main>
      <footer className="bg-navy-900 text-white mt-16 py-8">
        <div className="max-w-7xl mx-auto px-4 text-center">
          <p className="text-navy-300 text-sm">
            © {new Date().getFullYear()} SKIMS — Sangguniang Kabataan Integrated Program and Fund Management System
          </p>
          <p className="text-navy-400 text-xs mt-1">Marinduque, Philippines</p>
        </div>
      </footer>
    </div>
  );
}
