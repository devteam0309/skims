import axios from 'axios';

const api = axios.create({
  baseURL: '/api',
  timeout: 30000,
  withCredentials: true,
  headers: { 'Content-Type': 'application/json' },
});

let isRefreshing = false;
let refreshQueue = []; // callbacks waiting for a new token

const processQueue = (error) => {
  refreshQueue.forEach((cb) => (error ? cb.reject(error) : cb.resolve()));
  refreshQueue = [];
};

api.interceptors.response.use(
  (response) => response,
  async (error) => {
    const original = error.config;

    // Only attempt refresh on 401s that haven't already been retried
    if (error.response?.status === 401 && !original._retry) {
      // Don't loop on the refresh endpoint itself
      if (original.url === '/auth/refresh' || original.url === '/auth/login') {
        localStorage.removeItem('auth-storage');
        window.location.href = '/login';
        return Promise.reject(error.response?.data || error);
      }

      if (isRefreshing) {
        // Queue this request until the refresh completes
        return new Promise((resolve, reject) => {
          refreshQueue.push({ resolve, reject });
        }).then(() => api(original)).catch(() => Promise.reject(error.response?.data || error));
      }

      original._retry = true;
      isRefreshing = true;

      try {
        await axios.post('/api/auth/refresh', {}, { withCredentials: true });
        processQueue(null);
        return api(original);
      } catch (refreshError) {
        processQueue(refreshError);
        localStorage.removeItem('auth-storage');
        /*
         * A code, not the server's text. This previously forwarded whatever message came back
         * straight into the URL, and the login page rendered it verbatim — so a hand-crafted
         * link could put any message into the app's own error toast on the real domain. The
         * login page resolves these against LOGIN_NOTICES and ignores anything else.
         */
        const serverMessage = error.response?.data?.message || '';
        const reason = /deactivat|inactive|disabled|suspend/i.test(serverMessage)
          ? 'account_inactive'
          : 'session_expired';
        setTimeout(() => { window.location.href = `/login?reason=${reason}`; }, 100);
        return Promise.reject(error.response?.data || error);
      } finally {
        isRefreshing = false;
      }
    }

    /*
     * The status travels with the body. Rejecting with the response body alone left callers with
     * a message and no way to tell a 403 from a 404 — so a program in another municipality and a
     * program that never existed arrived identically, and the detail page reported both as
     * "may have been deleted". Additive: existing consumers read `.message` as before.
     */
    const status = error.response?.status;
    const body = error.response?.data;
    if (body && typeof body === 'object') return Promise.reject(Object.assign({ status }, body));
    return Promise.reject(error);
  }
);

export default api;
