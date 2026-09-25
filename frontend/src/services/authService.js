import api from './api';

export const authService = {
  login: (data) => api.post('/auth/login', data),
  register: (data) => api.post('/auth/register', data),
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
