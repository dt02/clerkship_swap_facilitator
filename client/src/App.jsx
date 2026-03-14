import React, { useState, useEffect, createContext, useContext } from 'react';
import { BrowserRouter, Routes, Route, NavLink, Navigate } from 'react-router-dom';
import {
  clearSessionToken,
  createUser,
  getCurrentUser,
  getSessionToken,
  getUsers,
  loginUser,
  logoutUser,
  setSessionToken
} from './api';
import SchedulePage from './components/SchedulePage';
import DesiredMovesPage from './components/DesiredMovesPage';
import AvailabilityPage from './components/AvailabilityPage';
import AdminPage from './components/AdminPage';
import HomePage, { HomeBlocks, HomeHero, useHomeContent } from './components/HomePage';

export const UserContext = createContext(null);

export function useUser() {
  return useContext(UserContext);
}

function App() {
  const { content: homeContent, blocks: homeBlocks } = useHomeContent();
  const [users, setUsers] = useState([]);
  const [signedInUser, setSignedInUser] = useState(null);
  const [selectedUser, setSelectedUser] = useState(null);
  const [authTab, setAuthTab] = useState('sign-in');
  const [loginEmail, setLoginEmail] = useState('');
  const [loginPassword, setLoginPassword] = useState('');
  const [newName, setNewName] = useState('');
  const [newEmail, setNewEmail] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [error, setError] = useState('');
  const [authLoading, setAuthLoading] = useState(true);

  useEffect(() => {
    restoreSession();
  }, []);

  async function restoreSession() {
    if (!getSessionToken()) {
      setAuthLoading(false);
      return;
    }

    try {
      const user = await getCurrentUser();
      await finishSignIn(user);
    } catch (e) {
      clearSessionToken();
      setSignedInUser(null);
      setSelectedUser(null);
      setUsers([]);
    } finally {
      setAuthLoading(false);
    }
  }

  async function loadUsers(preferredSelectedUserId = null, actor = signedInUser) {
    if (!actor?.is_admin) {
      const onlyUser = actor || selectedUser || signedInUser;
      setUsers(onlyUser ? [onlyUser] : []);
      if (onlyUser) setSelectedUser(onlyUser);
      return;
    }

    const data = await getUsers();
    setUsers(data);

    const nextSelectedUser =
      data.find(u => u.id === preferredSelectedUserId) ||
      data.find(u => u.id === selectedUser?.id) ||
      data.find(u => u.id === actor.id) ||
      data[0] ||
      null;

    setSelectedUser(nextSelectedUser);
  }

  async function finishSignIn(user) {
    setError('');
    setSignedInUser(user);

    if (user.is_admin) {
      await loadUsers(user.id, user);
    } else {
      setUsers([user]);
      setSelectedUser(user);
    }
  }

  function applyUserUpdate(updatedUser) {
    setSignedInUser(prev => (prev?.id === updatedUser.id ? updatedUser : prev));
    setSelectedUser(prev => (prev?.id === updatedUser.id ? updatedUser : prev));
    setUsers(prev => {
      if (!prev.length) return [updatedUser];
      const found = prev.some(user => user.id === updatedUser.id);
      if (!found) return [...prev, updatedUser];
      return prev.map(user => (user.id === updatedUser.id ? updatedUser : user));
    });
  }

  async function handleSignIn(e) {
    e.preventDefault();
    setError('');

    try {
      const data = await loginUser(loginEmail, loginPassword);
      setSessionToken(data.sessionToken);
      await finishSignIn(data.user);
      setLoginEmail('');
      setLoginPassword('');
    } catch (e) {
      setError(e.message);
    }
  }

  async function handleCreate(e) {
    e.preventDefault();
    setError('');

    try {
      const data = await createUser(newName, newEmail, newPassword);
      setSessionToken(data.sessionToken);
      await finishSignIn(data.user);
      setNewName('');
      setNewEmail('');
      setNewPassword('');
    } catch (e) {
      setError(e.message);
    }
  }

  async function handleSignOut() {
    try {
      await logoutUser();
    } catch {
      // Clearing the local token is enough to end the client session.
    }

    clearSessionToken();
    setSignedInUser(null);
    setSelectedUser(null);
    setUsers([]);
    setError('');
    setAuthTab('sign-in');
  }

  const navLinks = [
    { to: '/', label: 'Home' },
    { to: '/schedule', label: 'Schedule' },
    { to: '/desires', label: 'Desired Moves' },
    { to: '/availability', label: 'Availability' },
    ...(signedInUser?.is_admin ? [{ to: '/admin', label: 'Admin / Matching' }] : [])
  ];

  return (
    <UserContext.Provider
      value={{
        signedInUser,
        currentUser: selectedUser,
        setCurrentUser: setSelectedUser,
        applyUserUpdate,
        users,
        loadUsers
      }}
    >
      <BrowserRouter>
        <div style={{ fontFamily: 'system-ui, -apple-system, sans-serif', minHeight: '100vh', backgroundColor: '#f5f6fa' }}>
          <header style={headerStyle}>
            <h1 style={{ margin: 0, fontSize: '20px', fontWeight: 600 }}>Clerkship Swap Facilitator</h1>

            {signedInUser ? (
              <div style={{ display: 'flex', alignItems: 'center', gap: '12px', flexWrap: 'wrap', justifyContent: 'flex-end' }}>
                {signedInUser.is_admin ? (
                  <>
                    <span style={{ fontSize: '13px', color: '#d6eaf8' }}>
                      Signed in as {signedInUser.name} (Admin)
                    </span>
                    <select
                      value={selectedUser?.id || ''}
                      onChange={(e) => {
                        const userId = parseInt(e.target.value, 10);
                        const user = users.find(u => u.id === userId);
                        setSelectedUser(user || null);
                      }}
                      style={selectStyle}
                    >
                      {users.map(u => (
                        <option key={u.id} value={u.id}>
                          {u.name}{u.is_admin ? ' (Admin)' : ''}
                        </option>
                      ))}
                    </select>
                  </>
                ) : (
                  <span style={{ fontSize: '13px', color: '#d6eaf8' }}>
                    Signed in as {signedInUser.name}
                  </span>
                )}

                <button onClick={handleSignOut} style={secondaryButton}>
                  Sign Out
                </button>
              </div>
            ) : (
              <div style={{ fontSize: '13px', color: '#d6eaf8' }}>
                Sign in with your email and password or create a new account.
              </div>
            )}
          </header>

          {signedInUser && (
            <nav style={navStyle}>
              {navLinks.map(link => (
                <NavLink
                  key={link.to}
                  to={link.to}
                  end={link.to === '/'}
                  style={({ isActive }) => ({
                    padding: '12px 20px',
                    textDecoration: 'none',
                    color: isActive ? '#2980b9' : '#555',
                    borderBottom: isActive ? '3px solid #2980b9' : '3px solid transparent',
                    fontWeight: isActive ? 600 : 400,
                    fontSize: '14px'
                  })}
                >
                  {link.label}
                </NavLink>
              ))}
            </nav>
          )}

          <main style={{ padding: '24px', maxWidth: '1400px', margin: '0 auto' }}>
            {authLoading ? (
              <div style={emptyStateStyle}>Loading session...</div>
            ) : !signedInUser ? (
              <div style={{ display: 'grid', gap: '16px' }}>
                <HomeHero content={homeContent} signedInUser={null} currentUser={null} showSignedOutCallout={false} />
                <div style={authCard}>
                  <div style={authTabRow}>
                    <button
                      onClick={() => setAuthTab('sign-in')}
                      style={{
                        ...authTabButton,
                        ...(authTab === 'sign-in' ? activeAuthTabButton : null)
                      }}
                    >
                      Sign In
                    </button>
                    <button
                      onClick={() => setAuthTab('create-user')}
                      style={{
                        ...authTabButton,
                        ...(authTab === 'create-user' ? activeAuthTabButton : null)
                      }}
                    >
                      Create User
                    </button>
                  </div>

                  {authTab === 'sign-in' ? (
                    <>
                      <h2 style={sectionTitle}>Sign In</h2>
                      <form onSubmit={handleSignIn} style={formStyle}>
                        <input
                          placeholder="Email"
                          type="email"
                          value={loginEmail}
                          onChange={e => setLoginEmail(e.target.value)}
                          required
                          style={inputStyle}
                        />
                        <input
                          placeholder="Password"
                          type="password"
                          value={loginPassword}
                          onChange={e => setLoginPassword(e.target.value)}
                          style={inputStyle}
                        />
                        <button type="submit" style={primaryButton}>Sign In</button>
                      </form>
                      <p style={helperText}>
                        Older accounts created before passwords existed can leave the password blank once, then create one from the Home page.
                      </p>
                    </>
                  ) : (
                    <>
                      <h2 style={sectionTitle}>Create User</h2>
                      <p style={{ color: '#666', margin: '0 0 12px' }}>
                        New users can create a regular account here and will be signed in automatically.
                      </p>
                      {homeContent.signed_out_callout ? (
                        <div style={warningBox}>
                          {homeContent.signed_out_callout}
                        </div>
                      ) : null}
                      <form onSubmit={handleCreate} style={formStyle}>
                        <input
                          placeholder="Name"
                          value={newName}
                          onChange={e => setNewName(e.target.value)}
                          required
                          style={inputStyle}
                        />
                        <input
                          placeholder="Email"
                          type="email"
                          value={newEmail}
                          onChange={e => setNewEmail(e.target.value)}
                          required
                          style={inputStyle}
                        />
                        <input
                          placeholder="Password"
                          type="password"
                          value={newPassword}
                          onChange={e => setNewPassword(e.target.value)}
                          required
                          style={inputStyle}
                        />
                        <button type="submit" style={primaryButton}>Create Account</button>
                      </form>
                    </>
                  )}
                  {error && <div style={{ ...errorBox, gridColumn: '1 / -1' }}>{error}</div>}
                </div>
                <HomeBlocks blocks={homeBlocks} />
              </div>
            ) : !selectedUser ? (
              <div style={emptyStateStyle}>Select a user to continue.</div>
            ) : (
              <>
                {error && <div style={errorBox}>{error}</div>}
                <Routes>
                  <Route path="/" element={<HomePage />} />
                  <Route path="/schedule" element={<SchedulePage />} />
                  <Route path="/desires" element={<DesiredMovesPage />} />
                  <Route path="/availability" element={<AvailabilityPage />} />
                  <Route
                    path="/admin"
                    element={signedInUser.is_admin ? <AdminPage /> : <Navigate to="/" replace />}
                  />
                </Routes>
              </>
            )}
          </main>
        </div>
      </BrowserRouter>
    </UserContext.Provider>
  );
}

const headerStyle = {
  backgroundColor: '#2c3e50',
  color: 'white',
  padding: '12px 24px',
  display: 'flex',
  justifyContent: 'space-between',
  alignItems: 'center',
  gap: '16px',
  flexWrap: 'wrap'
};

const navStyle = {
  backgroundColor: 'white',
  borderBottom: '1px solid #ddd',
  padding: '0 24px',
  display: 'flex',
  gap: '0'
};

const authCard = {
  backgroundColor: 'white',
  borderRadius: '8px',
  boxShadow: '0 1px 3px rgba(0,0,0,0.1)',
  padding: '24px'
};

const authTabRow = {
  display: 'flex',
  gap: '8px',
  marginBottom: '16px'
};

const authTabButton = {
  padding: '10px 16px',
  backgroundColor: '#ecf0f1',
  color: '#2c3e50',
  border: '1px solid #d5dbdb',
  borderRadius: '6px',
  cursor: 'pointer',
  fontSize: '14px',
  fontWeight: 600
};

const activeAuthTabButton = {
  backgroundColor: '#2c3e50',
  color: 'white',
  borderColor: '#2c3e50'
};

const sectionTitle = {
  margin: '0 0 16px',
  fontSize: '18px',
  color: '#2c3e50'
};

const formStyle = {
  display: 'flex',
  flexDirection: 'column',
  gap: '12px'
};

const inputStyle = {
  padding: '10px 12px',
  borderRadius: '4px',
  border: '1px solid #bdc3c7',
  fontSize: '14px'
};

const selectStyle = {
  padding: '6px 12px',
  borderRadius: '4px',
  border: 'none',
  fontSize: '14px',
  minWidth: '220px'
};

const primaryButton = {
  padding: '10px 16px',
  backgroundColor: '#2980b9',
  color: 'white',
  border: 'none',
  borderRadius: '4px',
  cursor: 'pointer',
  fontSize: '14px',
  fontWeight: 600
};

const secondaryButton = {
  padding: '8px 14px',
  backgroundColor: '#95a5a6',
  color: 'white',
  border: 'none',
  borderRadius: '4px',
  cursor: 'pointer',
  fontSize: '13px'
};

const emptyStateStyle = {
  textAlign: 'center',
  padding: '48px',
  color: '#888',
  fontSize: '16px'
};

const errorBox = {
  padding: '8px 16px',
  backgroundColor: '#fde8e8',
  color: '#e74c3c',
  borderRadius: '4px',
  marginBottom: '12px'
};

const warningBox = {
  padding: '12px 16px',
  backgroundColor: '#fde8e8',
  color: '#b42318',
  border: '1px solid #f5c2c0',
  borderRadius: '6px',
  marginBottom: '12px',
  fontSize: '13px',
  lineHeight: 1.6
};

const helperText = {
  color: '#666',
  margin: '12px 0 0',
  fontSize: '13px'
};

export default App;
