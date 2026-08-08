export const formatCurrency = (amount) => {
  const formatted = new Intl.NumberFormat('en-PH', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(amount || 0);
  return `₱${formatted}`;
};

export const formatDate = (date, options = {}) => {
  if (!date) return 'N/A';
  return new Intl.DateTimeFormat('en-PH', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    ...options,
  }).format(new Date(date));
};

export const formatDatetime = (date) => {
  if (!date) return 'N/A';
  return new Intl.DateTimeFormat('en-PH', {
    year: 'numeric', month: 'short', day: 'numeric',
    hour: '2-digit', minute: '2-digit',
  }).format(new Date(date));
};

/**
 * Calendar age in whole years. Mirrors backend/src/utils/age.js — the registration form and the
 * server's eligibility check must agree, or the form accepts someone the server then refuses.
 *
 * Replaces `Math.floor(elapsed / (365.25 * 24 * 60 * 60 * 1000))`, which used a 365.25-day year
 * rather than a calendar one. That drifts by a day either side of a birthday depending on how
 * leap days fall, and floors to the wrong integer: someone who turned 18 today read as 17.
 * From March 2027 the same drift starts flipping eligibility decisions in both directions.
 *
 * UTC throughout, because 'YYYY-MM-DD' from a date input parses as UTC midnight and reading it
 * back with local getters would shift the day.
 */
export const calculateAge = (birthDate, now = new Date()) => {
  if (!birthDate) return null;
  const born = birthDate instanceof Date ? birthDate : new Date(birthDate);
  if (Number.isNaN(born.getTime())) return null;

  const ref = now instanceof Date ? now : new Date(now);
  let age = ref.getUTCFullYear() - born.getUTCFullYear();

  const monthDiff = ref.getUTCMonth() - born.getUTCMonth();
  if (monthDiff < 0 || (monthDiff === 0 && ref.getUTCDate() < born.getUTCDate())) age -= 1;

  return age;
};

export const YOUTH_MIN_AGE = 15;
export const YOUTH_MAX_AGE = 30;

export const formatFileSize = (bytes) => {
  if (!bytes) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB'];
  let i = 0;
  while (bytes >= 1024 && i < units.length - 1) { bytes /= 1024; i++; }
  return `${bytes.toFixed(1)} ${units[i]}`;
};

export const truncate = (str, maxLength = 60) => {
  if (!str) return '';
  return str.length > maxLength ? str.slice(0, maxLength) + '...' : str;
};

export const getInitials = (firstName, lastName) => {
  return `${(firstName || '')[0] || ''}${(lastName || '')[0] || ''}`.toUpperCase();
};

export const slugify = (text) => {
  return text.toLowerCase().replace(/[^\w ]+/g, '').replace(/ +/g, '-');
};

export const getRelativeTime = (date) => {
  if (!date) return '';
  const diff = Date.now() - new Date(date).getTime();
  const seconds = Math.floor(diff / 1000);
  if (seconds < 60) return 'just now';
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `${days}d ago`;
  return formatDate(date);
};
