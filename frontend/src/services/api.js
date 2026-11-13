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

/*
 * No file route answers "204 No Content", yet a browser with a download manager's extension
 * installed (IDM is the common one) hands the page exactly that once the extension takes a PDF
 * over. The empty body used to become a blank preview or an empty saved file with no reason
 * given; it was found that way on the owner's own machine during the browser walkthrough.
 */
export const FILE_INTERCEPTED_MESSAGE = 'The file arrived empty. A download manager in this browser (such as IDM) may have taken it over — turn off its browser integration for this site and try again.';

api.interceptors.response.use(
  (response) => {
    if (response.config?.responseType === 'blob' && response.status === 204) {
      return Promise.reject({ status: 204, message: FILE_INTERCEPTED_MESSAGE });
    }
    return response;
  },
  async (error) => {
    const original = error.config;

    // Only attempt refresh on 401s that haven't already been retried
    if (error.response?.status === 401 && !original._retry) {
      /*
       * A rejected sign-in is the caller's to report, not this interceptor's to act on.
       *
       * It used to share a branch with a dead refresh token and was answered with
       * `window.location.href = '/login'` — a full navigation to the page the user is already
       * standing on. That reloaded the whole app, and the "Invalid credentials" toast the login
       * form raises was wiped before it could be read: the password was simply wrong, and the
       * screen just blinked. There is no session to clear and nowhere to send them.
       */
      if (original.url === '/auth/login') {
        return Promise.reject(Object.assign({ status: 401 }, error.response?.data));
      }

      // A refresh that fails means the session really is gone. Clear it and send them to sign in
      // — but not if they are already there, since that is the reload this branch used to cause.
      if (original.url === '/auth/refresh') {
        localStorage.removeItem('auth-storage');
        if (window.location.pathname !== '/login') {
          window.location.href = '/login?reason=session_expired';
        }
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
    /*
     * A file request asks for a blob, so its error body arrives as a Blob too — and spreading a Blob
     * yields nothing, which turned "Not authorized to view this expense" into a bare failure. The
     * JSON inside is read back out so file errors say why, like every other request.
     */
    if (typeof Blob !== 'undefined' && body instanceof Blob) {
      try {
        const parsed = JSON.parse(await body.text());
        return Promise.reject(Object.assign({ status }, parsed));
      } catch {
        return Promise.reject({ status, message: status === 404 ? 'File not found' : 'The file could not be opened' });
      }
    }
    if (body && typeof body === 'object') return Promise.reject(Object.assign({ status }, body));
    return Promise.reject(error);
  }
);

export default api;
