import api from './api';

export const documentService = {
  getAll: (params) => api.get('/documents', { params }),
  getById: (id) => api.get(`/documents/${id}`),
  upload: (data) => api.post('/documents', data, { headers: { 'Content-Type': 'multipart/form-data' } }),
  update: (id, data) => api.put(`/documents/${id}`, data),
  archive: (id) => api.patch(`/documents/${id}/archive`),
  bulkArchive: (ids) => api.patch('/documents/bulk-archive', { ids }),
  unarchive: (id) => api.patch(`/documents/${id}/unarchive`),
  replaceFile: (id, data) => api.patch(`/documents/${id}/replace-file`, data, { headers: { 'Content-Type': 'multipart/form-data' } }),
  trackDownload: (id) => api.post(`/documents/${id}/download`),
  serve: (id) => api.get(`/documents/${id}/serve`, { responseType: 'blob' }),
  serveVersion: (id, version) => api.get(`/documents/${id}/versions/${version}/serve`, { responseType: 'blob' }),
  delete: (id) => api.delete(`/documents/${id}`),
  getStats: (params) => api.get('/documents/stats', { params }),
};

export const notificationService = {
  getAll: (params) => api.get('/notifications', { params }),
  getUnreadCount: () => api.get('/notifications/unread-count'),
  markAsRead: (id) => api.put(`/notifications/${id}/read`),
  markAllAsRead: () => api.put('/notifications/read-all'),
  delete: (id) => api.delete(`/notifications/${id}`),
};

export const dashboardService = {
  get: (params) => api.get('/dashboard', { params }),
  getMunicipalityComparison: () => api.get('/dashboard/municipality-comparison'),
};

export const reportService = {
  generatePrograms: (params) => api.get('/reports/programs', { params, responseType: params.format !== 'json' ? 'blob' : 'json' }),
  generateFinancial: (params) => api.get('/reports/financial', { params, responseType: params.format !== 'json' ? 'blob' : 'json' }),
  generateYouth: (params) => api.get('/reports/youth', { params }),
  downloadTemplate: (name) => api.get(`/reports/template/${name}`, { responseType: 'blob' }),
};

export const analyticsService = {
  getFundUtilization: (params) => api.get('/analytics/fund-utilization', { params }),
  getProgramSuccess: (params) => api.get('/analytics/program-success', { params }),
  getYouthEngagement: (params) => api.get('/analytics/youth-engagement', { params }),
};

export const municipalityService = {
  getAll: () => api.get('/municipalities'),
  getById: (id) => api.get(`/municipalities/${id}`),
  getBarangays: (id) => api.get(`/municipalities/${id}/barangays`),
};

export const monitoringService = {
  getOverview: (params) => api.get('/monitoring/overview', { params }),
  getMunicipalityReport: () => api.get('/monitoring/municipalities'),
  getComplianceStatus: (params) => api.get('/monitoring/compliance', { params }),
  getTimeline: (params) => api.get('/monitoring/timeline', { params }),
};

export const publicService = {
  getPrograms: (params) => api.get('/public/programs', { params }),
  getAnnouncements: (params) => api.get('/public/announcements', { params }),
  getBudgetSummary: (params) => api.get('/public/budget', { params }),
  getDocuments: (params) => api.get('/public/documents', { params }),
  getMunicipalities: () => api.get('/public/municipalities'),
  getStats: () => api.get('/public/stats'),
};

export const youthService = {
  getAll: (params) => api.get('/youth', { params }),
  getById: (id) => api.get(`/youth/${id}`),
  checkDuplicate: (params) => api.get('/youth/duplicate-check', { params }),
  create: (data) => api.post('/youth', data),
  update: (id, data) => api.put(`/youth/${id}`, data),
  delete: (id) => api.delete(`/youth/${id}`),
};

export const userService = {
  getAll: (params) => api.get('/users', { params }),
  getById: (id) => api.get(`/users/${id}`),
  approve: (id) => api.put(`/users/${id}/approve`),
  reject: (id, reason) => api.put(`/users/${id}/reject`, { reason }),
  updateRole: (id, data) => api.put(`/users/${id}/role`, data),
  toggleStatus: (id) => api.put(`/users/${id}/toggle-status`),
  delete: (id) => api.delete(`/users/${id}`),
  getPending: () => api.get('/users/pending'),
};
