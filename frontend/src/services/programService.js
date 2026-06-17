import api from './api';

export const programService = {
  getAll: (params) => api.get('/programs', { params }),
  getById: (id) => api.get(`/programs/${id}`),
  create: (data) => api.post('/programs', data),
  update: (id, data) => api.put(`/programs/${id}`, data),
  updateStatus: (id, status) => api.patch(`/programs/${id}/status`, { status }),
  delete: (id) => api.delete(`/programs/${id}`),
  addMilestone: (id, data) => api.post(`/programs/${id}/milestones`, data),
  updateMilestone: (id, milestoneId, data) => api.put(`/programs/${id}/milestones/${milestoneId}`, data),
  getStats: (params) => api.get('/programs/stats', { params }),
};
