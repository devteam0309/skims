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
  delete: (id) => api.delete(`/budgets/${id}`),
  getSummary: (params) => api.get('/budgets/summary', { params }),
};

export const expenseService = {
  getAll: (params) => api.get('/expenses', { params }),
  getById: (id) => api.get(`/expenses/${id}`),
  create: (data) => api.post('/expenses', data, { headers: { 'Content-Type': 'multipart/form-data' } }),
  update: (id, data) => api.put(`/expenses/${id}`, data),
  approve: (id) => api.patch(`/expenses/${id}/approve`),
  bulkApprove: (ids) => api.patch('/expenses/bulk-approve', { ids }),
  delete: (id) => api.delete(`/expenses/${id}`),
  getSummary: (params) => api.get('/expenses/summary', { params }),
};

export const liquidationService = {
  getAll: (params) => api.get('/liquidations', { params }),
  getById: (id) => api.get(`/liquidations/${id}`),
  create: (data) => api.post('/liquidations', data, { headers: { 'Content-Type': 'multipart/form-data' } }),
  submit: (id) => api.patch(`/liquidations/${id}/submit`),
  approve: (id) => api.patch(`/liquidations/${id}/approve`),
  reject: (id, reason) => api.patch(`/liquidations/${id}/reject`, { reason }),
  delete: (id) => api.delete(`/liquidations/${id}`),
};
