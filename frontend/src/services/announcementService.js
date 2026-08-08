import api from './api';

/**
 * Announcements were the one domain whose endpoints were declared inline inside the page
 * component, so the calls were invisible to anything else that might need them — including the
 * public portal, which reads the same collection.
 */
export const announcementService = {
  getAll: (params) => api.get('/announcements', { params }),
  getById: (id) => api.get(`/announcements/${id}`),
  create: (data) => api.post('/announcements', data),
  update: (id, data) => api.put(`/announcements/${id}`, data),
  delete: (id) => api.delete(`/announcements/${id}`),
};

export default announcementService;
