const BASE = '/api';
const SESSION_USER_ID_KEY = 'clerkship-swaps-session-user-id';

export function getSessionUserId() {
  return window.localStorage.getItem(SESSION_USER_ID_KEY);
}

export function setSessionUserId(userId) {
  if (userId) {
    window.localStorage.setItem(SESSION_USER_ID_KEY, String(userId));
  } else {
    window.localStorage.removeItem(SESSION_USER_ID_KEY);
  }
}

export function clearSessionUserId() {
  window.localStorage.removeItem(SESSION_USER_ID_KEY);
}

async function request(url, options = {}) {
  const sessionUserId = getSessionUserId();
  const headers = {
    'Content-Type': 'application/json',
    ...(sessionUserId ? { 'x-user-id': sessionUserId } : {}),
    ...(options.headers || {})
  };

  const res = await fetch(`${BASE}${url}`, {
    headers,
    ...options,
    body: options.body ? JSON.stringify(options.body) : undefined
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: res.statusText }));
    throw new Error(err.error || `HTTP ${res.status}`);
  }
  return res.json();
}

// Users
export const getCurrentUser = () => request('/users/me');
export const loginByEmail = (email) => request('/users/login', { method: 'POST', body: { email } });
export const getUsers = () => request('/users');
export const createUser = (name, email) => request('/users', { method: 'POST', body: { name, email } });
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
