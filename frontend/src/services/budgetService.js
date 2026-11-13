import api from './api';

export const budgetService = {
  getAll: (params) => api.get('/budgets', { params }),
  getById: (id) => api.get(`/budgets/${id}`),
  create: (data) => api.post('/budgets', data),
  update: (id, data) => api.put(`/budgets/${id}`, data),
  submit: (id) => api.patch(`/budgets/${id}/submit`),
  approve: (id) => api.patch(`/budgets/${id}/approve`),
  reject: (id, reason) => api.patch(`/budgets/${id}/reject`, { reason }),
  reopen: (id) => api.patch(`/budgets/${id}/reopen`),
  // Moves it to the recycle bin; restore brings it back; permanent destroys it (administrators).
  delete: (id) => api.delete(`/budgets/${id}`),
  getDeleted: (params) => api.get('/budgets/recycle-bin', { params }),
  restore: (id) => api.patch(`/budgets/${id}/restore`),
  permanentDelete: (id) => api.delete(`/budgets/${id}/permanent`),
  getSummary: (params) => api.get('/budgets/summary', { params }),
  // Every barangay's allocation, spending and remaining balance — the municipal reviewer's view.
  getBarangayPerformance: (params) => api.get('/budgets/barangay-performance', { params }),
};

export const expenseService = {
  getAll: (params) => api.get('/expenses', { params }),
  getById: (id) => api.get(`/expenses/${id}`),
  create: (data) => api.post('/expenses', data, { headers: { 'Content-Type': 'multipart/form-data' } }),
  update: (id, data) => api.put(`/expenses/${id}`, data),
  // The treasurer's act: send a prepared draft up for review.
  submit: (id) => api.patch(`/expenses/${id}/submit`),
  approve: (id) => api.patch(`/expenses/${id}/approve`),
  // The reviewer's acts. Each requires a reason on the route, not merely in the form.
  reject: (id, rejectionReason) => api.patch(`/expenses/${id}/reject`, { rejectionReason }),
  returnForCorrection: (id, returnReason) => api.patch(`/expenses/${id}/return`, { returnReason }),
  reverse: (id, reason) => api.patch(`/expenses/${id}/reverse`, { reason }),
  bulkApprove: (ids) => api.patch('/expenses/bulk-approve', { ids }),
  addAttachments: (id, data) => api.post(`/expenses/${id}/attachments`, data, { headers: { 'Content-Type': 'multipart/form-data' } }),
  // The file itself, through the authorised route — inline for preview, otherwise as a download.
  attachment: (id, attachmentId, { inline = false } = {}) =>
    api.get(`/expenses/${id}/attachments/${attachmentId}`, { params: inline ? { inline: 1 } : {}, responseType: 'blob' }),
  delete: (id) => api.delete(`/expenses/${id}`),
  getDeleted: (params) => api.get('/expenses/recycle-bin', { params }),
  restore: (id) => api.patch(`/expenses/${id}/restore`),
  permanentDelete: (id) => api.delete(`/expenses/${id}/permanent`),
  getSummary: (params) => api.get('/expenses/summary', { params }),
};

export const liquidationService = {
  getAll: (params) => api.get('/liquidations', { params }),
  getById: (id) => api.get(`/liquidations/${id}`),
  create: (data) => api.post('/liquidations', data, { headers: { 'Content-Type': 'multipart/form-data' } }),
  submit: (id) => api.patch(`/liquidations/${id}/submit`),
  approve: (id) => api.patch(`/liquidations/${id}/approve`),
  reject: (id, reason) => api.patch(`/liquidations/${id}/reject`, { reason }),
  returnForCorrection: (id, reason) => api.patch(`/liquidations/${id}/return`, { reason }),
  addAttachments: (id, data) => api.post(`/liquidations/${id}/attachments`, data, { headers: { 'Content-Type': 'multipart/form-data' } }),
  attachment: (id, attachmentId, { inline = false } = {}) =>
    api.get(`/liquidations/${id}/attachments/${attachmentId}`, { params: inline ? { inline: 1 } : {}, responseType: 'blob' }),
  delete: (id) => api.delete(`/liquidations/${id}`),
  getDeleted: (params) => api.get('/liquidations/recycle-bin', { params }),
  restore: (id) => api.patch(`/liquidations/${id}/restore`),
  permanentDelete: (id) => api.delete(`/liquidations/${id}/permanent`),
};
