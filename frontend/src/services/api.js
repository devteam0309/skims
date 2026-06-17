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
        const message = error.response?.data?.message || 'Session expired. Please log in again.';
        setTimeout(() => { window.location.href = `/login?reason=${encodeURIComponent(message)}`; }, 100);
        return Promise.reject(error.response?.data || error);
      } finally {
        isRefreshing = false;
      }
    }

    return Promise.reject(error.response?.data || error);
  }
);

export default api;
