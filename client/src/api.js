const BASE = '/api';
const SESSION_TOKEN_KEY = 'clerkship-swaps-session-token';

export function getSessionToken() {
  return window.localStorage.getItem(SESSION_TOKEN_KEY);
}

export function setSessionToken(sessionToken) {
  if (sessionToken) {
    window.localStorage.setItem(SESSION_TOKEN_KEY, String(sessionToken));
  } else {
    window.localStorage.removeItem(SESSION_TOKEN_KEY);
  }
}

export function clearSessionToken() {
  window.localStorage.removeItem(SESSION_TOKEN_KEY);
}

async function request(url, options = {}) {
  const sessionToken = getSessionToken();
  const headers = {
    'Content-Type': 'application/json',
    ...(sessionToken ? { 'x-session-token': sessionToken } : {}),
    ...(options.headers || {})
  };

  const res = await fetch(`${BASE}${url}`, {
    headers,
    ...options,
    body: options.body ? JSON.stringify(options.body) : undefined
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: res.statusText }));
    const error = new Error(err.error || `HTTP ${res.status}`);
    error.details = Array.isArray(err.details) ? err.details : [];
    error.validationDiagnostics = Array.isArray(err.validationDiagnostics) ? err.validationDiagnostics : [];
    throw error;
  }
  return res.json();
}

// Users
export const getCurrentUser = () => request('/users/me');
export const loginUser = (email, password) => request('/users/login', { method: 'POST', body: { email, password } });
export const logoutUser = () => request('/users/logout', { method: 'POST' });
export const getUsers = () => request('/users');
export const createUser = (name, email, password) => request('/users', { method: 'POST', body: { name, email, password } });
export const updatePassword = (userId, currentPassword, newPassword) =>
  request(`/users/${userId}/password`, { method: 'PUT', body: { current_password: currentPassword, new_password: newPassword } });
export const deleteUser = (id) => request(`/users/${id}`, { method: 'DELETE' });

// Schedule
export const getSchedule = (userId) => request(`/users/${userId}/schedule`);
export const saveSchedule = (userId, entries) => request(`/users/${userId}/schedule`, { method: 'PUT', body: { entries } });
export const toggleImmobile = (userId, entryId, isImmobile) =>
  request(`/users/${userId}/schedule/${entryId}`, { method: 'PATCH', body: { is_immobile: isImmobile } });

// Blocked periods
export const getBlocked = (userId) => request(`/users/${userId}/blocked`);
export const saveBlocked = (userId, blocked) => request(`/users/${userId}/blocked`, { method: 'PUT', body: { blocked } });

// Desired moves
export const getDesires = (userId) => request(`/users/${userId}/desires`);
export const addDesire = (userId, desire) => request(`/users/${userId}/desires`, { method: 'POST', body: desire });
export const reorderDesires = (userId, desireIds) =>
  request(`/users/${userId}/desires/reorder`, { method: 'PUT', body: { desireIds } });
export const removeDesire = (userId, desireId) => request(`/users/${userId}/desires/${desireId}`, { method: 'DELETE' });

// Availability
export const getAvailability = () => request('/availability');
export const saveAvailability = (entries) => request('/availability', { method: 'PUT', body: { entries } });
export const patchAvailability = (id, spots) => request(`/availability/${id}`, { method: 'PATCH', body: { spots } });

// Matching
export const runMatching = () => request('/matching/run', { method: 'POST' });
export const getLatestResults = () => request('/matching/results');

// Site content
export const getSiteContent = () => request('/site-content');
export const saveSiteContent = (content) => request('/site-content', { method: 'PUT', body: { content } });
