import api from './api';

export const authService = {
  login: (data) => api.post('/auth/login', data),
  /*
   * Multipart when the applicant attaches identity documents. The header matters: this client's
   * default is application/json, and axios turns a FormData body into JSON under that header —
   * dropping the files without an error.
   */
  register: (data) => api.post('/auth/register', data, data instanceof FormData
    ? { headers: { 'Content-Type': 'multipart/form-data' } }
    : undefined),
  logout: () => api.post('/auth/logout'),
  getMe: () => api.get('/auth/me'),
  updateProfile: (data) => api.put('/auth/me', data),
  updatePassword: (data) => api.put('/auth/password', data),
  forgotPassword: (email) => api.post('/auth/forgot-password', { email }),
  resetPassword: (token, password) => api.put(`/auth/reset-password/${token}`, { password }),
  verifyEmail: (token) => api.get(`/auth/verify-email/${token}`),
  /*
   * A REQUEST, not an update. The active address is untouched until an administrator approves it —
   * `updateProfile` above does not accept `email` and never did.
   */
  requestEmailChange: (data) => api.post('/auth/me/email-change', data),
  cancelEmailChange: () => api.delete('/auth/me/email-change'),
};
