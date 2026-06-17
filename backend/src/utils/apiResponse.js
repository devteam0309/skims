const successResponse = (res, statusCode = 200, message = 'Success', data = null, meta = null) => {
  const response = { success: true, message };
  if (data !== null) response.data = data;
  if (meta !== null) response.meta = meta;
  return res.status(statusCode).json(response);
};

const errorResponse = (res, statusCode = 500, message = 'Server Error', errors = null) => {
  const response = { success: false, message };
  if (errors !== null) response.errors = errors;
  return res.status(statusCode).json(response);
};

const paginatedResponse = (res, data, page, limit, total) => {
  const safeLimit = parseInt(limit) || 10;
  return res.status(200).json({
    success: true,
    data,
    meta: {
      page: Math.max(1, parseInt(page) || 1),
      limit: safeLimit,
      total,
      pages: Math.max(0, Math.ceil((total || 0) / safeLimit)),
    },
  });
};

// Centralised, defensive pagination. Clamps page >= 1 and limit to [1, maxLimit],
// so malformed/negative ?page or ?limit can never produce a negative/NaN skip
// (which previously caused 500s or silently returned unpaginated results).
const parsePagination = (query = {}, { defaultLimit = 10, maxLimit = 100 } = {}) => {
  const safePage = Math.max(1, parseInt(query.page) || 1);
  const safeLimit = Math.min(Math.max(1, parseInt(query.limit) || defaultLimit), maxLimit);
  return { safePage, safeLimit, skip: (safePage - 1) * safeLimit };
};

module.exports = { successResponse, errorResponse, paginatedResponse, parsePagination };
