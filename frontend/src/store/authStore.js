import { create } from 'zustand';
import { persist } from 'zustand/middleware';

const useAuthStore = create(
  persist(
    (set, get) => ({
      user: null,
      isAuthenticated: false,

      setAuth: (user) => set({ user, isAuthenticated: true }),

      updateUser: (userData) => set({ user: { ...get().user, ...userData } }),

      logout: () => {
        set({ user: null, isAuthenticated: false });
        localStorage.removeItem('auth-storage');
      },

      hasRole: (...roles) => {
        const user = get().user;
        return user && roles.includes(user.role);
      },

      isAdmin: () => {
        const user = get().user;
        return user && ['super_admin', 'provincial_admin', 'municipal_admin'].includes(user.role);
      },
    }),
    {
      name: 'auth-storage',
      partialize: (state) => ({ user: state.user, isAuthenticated: state.isAuthenticated }),
    }
  )
);

export default useAuthStore;
