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
  submit: (id) => api.patch(`/programs/${id}/submit`),
  approve: (id) => api.patch(`/programs/${id}/approve`),
  reject: (id, reason) => api.patch(`/programs/${id}/reject`, { reason }),
  // Participation. join/withdraw are the youth side; participants/decide are the staff side.
  join: (id) => api.post(`/programs/${id}/join`),
  withdraw: (id) => api.delete(`/programs/${id}/join`),
  getParticipants: (id) => api.get(`/programs/${id}/participants`),
  decideParticipant: (id, youthId, decision, reason) =>
    api.patch(`/programs/${id}/participants/${youthId}`, { decision, reason }),
  getStats: (params) => api.get('/programs/stats', { params }),
};
