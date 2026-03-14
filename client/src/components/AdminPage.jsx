import React, { useState, useEffect } from 'react';
import { deleteUser, getLatestResults, getSiteContent, runMatching, saveSiteContent } from '../api';
import { useUser } from '../App';

export default function AdminPage() {
  const { signedInUser, users, loadUsers, currentUser, setCurrentUser } = useUser();
  const [results, setResults] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [matchingErrorDetails, setMatchingErrorDetails] = useState([]);
  const [validationDiagnostics, setValidationDiagnostics] = useState([]);
  const [lastRun, setLastRun] = useState(null);
  const [deletingUserId, setDeletingUserId] = useState(null);
  const [activeTab, setActiveTab] = useState('matching');
  const [contentForm, setContentForm] = useState({
    hero_title: '',
    hero_body: '',
    signed_out_callout: '',
    signed_in_callout: '',
    home_blocks: []
  });
  const [contentLoading, setContentLoading] = useState(true);
  const [contentSaving, setContentSaving] = useState(false);
  const [contentMessage, setContentMessage] = useState('');

  useEffect(() => {
    loadLatest();
    loadContent();
  }, []);

  async function loadLatest() {
    try {
      const data = await getLatestResults();
      if (data) {
        setLastRun(data);
        setResults(data.result_json);
      }
    } catch (e) {
      // No results yet
    }
  }

  async function handleRun() {
    setLoading(true);
    setError('');
    setMatchingErrorDetails([]);
    setValidationDiagnostics([]);
    try {
      const data = await runMatching();
      setResults(data);
      setLastRun({ run_at: new Date().toISOString() });
    } catch (e) {
      setError(e.message);
      setMatchingErrorDetails(Array.isArray(e.details) ? e.details : []);
      setValidationDiagnostics(Array.isArray(e.validationDiagnostics) ? e.validationDiagnostics : []);
      setResults(null);
    }
    setLoading(false);
  }

  async function handleDeleteUser(user) {
    const confirmed = window.confirm(`Delete ${user.name} (${user.email})? This cannot be undone.`);
    if (!confirmed) return;

    setDeletingUserId(user.id);
    setError('');

    try {
      await deleteUser(user.id);

      if (currentUser?.id === user.id) {
        setCurrentUser(signedInUser);
      }

      await loadUsers(signedInUser?.id, signedInUser);
    } catch (e) {
      setError(e.message);
    } finally {
      setDeletingUserId(null);
    }
  }

  async function loadContent() {
    setContentLoading(true);
    try {
      const data = await getSiteContent();
      setContentForm({
        hero_title: data.hero_title || '',
        hero_body: data.hero_body || '',
        signed_out_callout: data.signed_out_callout || '',
        signed_in_callout: data.signed_in_callout || '',
        home_blocks: parseBlocksForEditor(data.home_blocks)
      });
    } catch (e) {
      setError(e.message);
    } finally {
      setContentLoading(false);
    }
  }

  function handleContentChange(field, value) {
    setContentForm(prev => ({ ...prev, [field]: value }));
  }

  function handleBlockChange(index, field, value) {
    setContentForm(prev => ({
      ...prev,
      home_blocks: prev.home_blocks.map((block, blockIndex) =>
        blockIndex === index ? { ...block, [field]: value } : block
      )
    }));
  }

  function handleAddBlock() {
    setContentForm(prev => ({
      ...prev,
      home_blocks: [...prev.home_blocks, { title: '', itemsText: '' }]
    }));
  }

  function handleRemoveBlock(index) {
    setContentForm(prev => ({
      ...prev,
      home_blocks: prev.home_blocks.filter((_, blockIndex) => blockIndex !== index)
    }));
  }

  async function handleSaveContent(e) {
    e.preventDefault();
    setContentSaving(true);
    setContentMessage('');
    setError('');

    try {
      await saveSiteContent({
        hero_title: contentForm.hero_title,
        hero_body: contentForm.hero_body,
        signed_out_callout: contentForm.signed_out_callout,
        signed_in_callout: contentForm.signed_in_callout,
        home_blocks: JSON.stringify(
          contentForm.home_blocks.map((block) => ({
            title: block.title,
            items: splitLines(block.itemsText)
          }))
        )
      });
      setContentMessage('Website text updated.');
    } catch (e) {
      setError(e.message);
    } finally {
      setContentSaving(false);
    }
  }

  return (
    <div>
      <h2 style={{ margin: '0 0 16px', fontSize: '18px', color: '#2c3e50' }}>
        Admin
      </h2>

      <div style={tabRow}>
        <button
          onClick={() => setActiveTab('matching')}
          style={{
            ...tabButton,
            ...(activeTab === 'matching' ? activeTabButton : null)
          }}
        >
          Matching
        </button>
        <button
          onClick={() => setActiveTab('users')}
          style={{
            ...tabButton,
            ...(activeTab === 'users' ? activeTabButton : null)
          }}
        >
          User Management
        </button>
        <button
          onClick={() => setActiveTab('content')}
          style={{
            ...tabButton,
            ...(activeTab === 'content' ? activeTabButton : null)
          }}
        >
          Website Text
        </button>
      </div>

      {activeTab === 'users' ? (
        <div style={card}>
          {error && <div style={errorBox}>{error}</div>}
          <h3 style={sectionTitle}>User Management</h3>
          <table style={tableStyle}>
            <thead>
              <tr>
                <th style={th}>Name</th>
                <th style={th}>Email</th>
                <th style={th}>Role</th>
                <th style={th}>Action</th>
              </tr>
            </thead>
            <tbody>
              {users.map((user) => {
                const isSelf = user.id === signedInUser?.id;

                return (
                  <tr key={user.id}>
                    <td style={td}>{user.name}</td>
                    <td style={td}>{user.email}</td>
                    <td style={td}>{user.is_admin ? 'Admin' : 'User'}</td>
                    <td style={td}>
                      {isSelf ? (
                        <span style={{ color: '#999', fontSize: '12px' }}>Current admin</span>
                      ) : (
                        <button
                          onClick={() => handleDeleteUser(user)}
                          disabled={deletingUserId === user.id}
                          style={{
                            ...deleteButton,
                            opacity: deletingUserId === user.id ? 0.7 : 1,
                            cursor: deletingUserId === user.id ? 'default' : 'pointer'
                          }}
                        >
                          {deletingUserId === user.id ? 'Deleting...' : 'Delete'}
                        </button>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      ) : activeTab === 'content' ? (
        <div style={card}>
          {error && <div style={errorBox}>{error}</div>}
          {contentMessage && <div style={successBox}>{contentMessage}</div>}
          <h3 style={sectionTitle}>Homepage Copy</h3>
          {contentLoading ? (
            <div style={{ color: '#888' }}>Loading website text...</div>
          ) : (
            <form onSubmit={handleSaveContent} style={{ display: 'grid', gap: '16px' }}>
              <Field
                label="Hero Title"
                value={contentForm.hero_title}
                onChange={(value) => handleContentChange('hero_title', value)}
              />
              <TextAreaField
                label="Hero Description"
                value={contentForm.hero_body}
                onChange={(value) => handleContentChange('hero_body', value)}
              />
              <TextAreaField
                label="Signed Out Callout"
                value={contentForm.signed_out_callout}
                onChange={(value) => handleContentChange('signed_out_callout', value)}
              />
              <TextAreaField
                label="Signed In Callout"
                value={contentForm.signed_in_callout}
                onChange={(value) => handleContentChange('signed_in_callout', value)}
              />
              <div style={{ display: 'grid', gap: '12px' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '12px' }}>
                  <span style={fieldLabel}>Homepage Text Blocks</span>
                  <button type="button" onClick={handleAddBlock} style={addButton}>
                    Add Block
                  </button>
                </div>
                {contentForm.home_blocks.map((block, index) => (
                  <div key={index} style={blockCard}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '12px' }}>
                      <strong style={{ color: '#2c3e50' }}>Block {index + 1}</strong>
                      <button type="button" onClick={() => handleRemoveBlock(index)} style={removeButton}>
                        Remove Block
                      </button>
                    </div>
                    <Field
                      label="Block Title"
                      value={block.title}
                      onChange={(value) => handleBlockChange(index, 'title', value)}
                    />
                    <TextAreaField
                      label="Block Bullet Points"
                      help="One line per bullet."
                      value={block.itemsText}
                      onChange={(value) => handleBlockChange(index, 'itemsText', value)}
                    />
                  </div>
                ))}
              </div>
              <div>
                <button
                  type="submit"
                  disabled={contentSaving}
                  style={{
                    padding: '10px 18px',
                    backgroundColor: contentSaving ? '#95a5a6' : '#2980b9',
                    color: 'white',
                    border: 'none',
                    borderRadius: '4px',
                    cursor: contentSaving ? 'default' : 'pointer',
                    fontSize: '14px',
                    fontWeight: 600
                  }}
                >
                  {contentSaving ? 'Saving...' : 'Save Website Text'}
                </button>
              </div>
            </form>
          )}
        </div>
      ) : (
        <div style={card}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '16px', marginBottom: '16px' }}>
            <button
              onClick={handleRun}
              disabled={loading}
              style={{
                padding: '12px 24px',
                backgroundColor: loading ? '#95a5a6' : '#27ae60',
                color: 'white',
                border: 'none',
                borderRadius: '6px',
                cursor: loading ? 'default' : 'pointer',
                fontSize: '16px',
                fontWeight: 600
              }}
            >
              {loading ? 'Running...' : 'Run Matching Algorithm'}
            </button>
            {lastRun && (
              <span style={{ fontSize: '13px', color: '#888' }}>
                Last run: {new Date(lastRun.run_at).toLocaleString()}
              </span>
            )}
          </div>

          {error && <div style={errorBox}>{error}</div>}
          {validationDiagnostics.length > 0 && (
            <div style={diagnosticsWrap}>
              <div style={diagnosticsSummary}>
                Matching stopped before any swaps were attempted because one or more current schedules are already invalid.
                A blocked-period message means a user&apos;s existing clerkship placement already occupies a period they marked as blocked.
              </div>
              {validationDiagnostics.map((diagnostic) => (
                <div key={diagnostic.userId} style={diagnosticCard}>
                  <div style={{ display: 'grid', gap: '4px' }}>
                    <strong style={{ color: '#2c3e50' }}>
                      {diagnostic.userName} (User {diagnostic.userId})
                    </strong>
                    {diagnostic.email ? (
                      <span style={{ fontSize: '12px', color: '#7f8c8d' }}>{diagnostic.email}</span>
                    ) : null}
                  </div>
                  <div>
                    <div style={diagnosticLabel}>Problems</div>
                    <ul style={diagnosticList}>
                      {diagnostic.errors.map((detail, index) => (
                        <li key={index}>{detail}</li>
                      ))}
                    </ul>
                  </div>
                  <div>
                    <div style={diagnosticLabel}>Current Schedule</div>
                    <div style={chipRow}>
                      {diagnostic.schedule.map((entry) => (
                        <span key={`${entry.clerkship}-${entry.start}`} style={infoChip}>
                          {entry.clerkship} at {entry.start}{entry.isImmobile ? ' (Locked)' : ''}
                        </span>
                      ))}
                    </div>
                  </div>
                  <div>
                    <div style={diagnosticLabel}>Blocked Periods</div>
                    <div style={chipRow}>
                      {diagnostic.blockedPeriods.length > 0 ? (
                        diagnostic.blockedPeriods.map((period) => (
                          <span key={period} style={blockedChip}>{period}</span>
                        ))
                      ) : (
                        <span style={emptyText}>No blocked periods</span>
                      )}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
          {validationDiagnostics.length === 0 && matchingErrorDetails.length > 1 && (
            <div style={diagnosticsWrap}>
              <div style={diagnosticLabel}>All reported issues</div>
              <ul style={diagnosticList}>
                {matchingErrorDetails.map((detail, index) => (
                  <li key={index}>{detail}</li>
                ))}
              </ul>
            </div>
          )}

          {results && (
            <div>
              {results.summary && (
                <div style={{
                  display: 'flex',
                  gap: '16px',
                  marginBottom: '20px',
                  flexWrap: 'wrap'
                }}>
                  <StatBox label="Total Desires" value={results.summary.totalDesires} color="#2980b9" />
                  <StatBox label="Free Moves" value={results.summary.freeMoves} color="#27ae60" />
                  <StatBox label="Swaps Found" value={results.summary.swaps} color="#e67e22" />
                  <StatBox label="Unmet Desires" value={results.summary.unmet} color="#e74c3c" />
                </div>
              )}

              {results.freeMoves && results.freeMoves.length > 0 && (
                <div style={{ marginBottom: '20px' }}>
                  <h3 style={sectionTitle}>Free Moves (Open Availability)</h3>
                  <table style={tableStyle}>
                    <thead>
                      <tr>
                        <th style={th}>User</th>
                        <th style={th}>Clerkship</th>
                        <th style={th}>From</th>
                        <th style={th}>To</th>
                      </tr>
                    </thead>
                    <tbody>
                      {results.freeMoves.map((m, i) => (
                        <tr key={i}>
                          <td style={td}>{m.userName}</td>
                          <td style={td}><strong>{m.clerkship}</strong></td>
                          <td style={td}>{m.from}</td>
                          <td style={td}>{m.to}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}

              {results.swaps && results.swaps.length > 0 && (
                <div style={{ marginBottom: '20px' }}>
                  <h3 style={sectionTitle}>Swaps</h3>
                  {results.swaps.map((swap, i) => (
                    <div key={i} style={{
                      backgroundColor: '#fef9e7',
                      border: '1px solid #f9e79f',
                      borderRadius: '6px',
                      padding: '16px',
                      marginBottom: '12px'
                    }}>
                      <div style={{ fontWeight: 600, marginBottom: '8px', color: '#d68910' }}>
                        {swap.type}
                      </div>
                      <table style={tableStyle}>
                        <thead>
                          <tr>
                            <th style={th}>User</th>
                            <th style={th}>Clerkship</th>
                            <th style={th}>From</th>
                            <th style={th}>To</th>
                          </tr>
                        </thead>
                        <tbody>
                          {swap.participants.map((p, j) => (
                            <tr key={j}>
                              <td style={td}>{p.userName}</td>
                              <td style={td}><strong>{p.clerkship}</strong></td>
                              <td style={td}>{p.from}</td>
                              <td style={td}>{p.to}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  ))}
                </div>
              )}

              {results.unmet && results.unmet.length > 0 && (
                <div>
                  <h3 style={sectionTitle}>Unmet Desires</h3>
                  <table style={tableStyle}>
                    <thead>
                      <tr>
                        <th style={th}>User</th>
                        <th style={th}>Clerkship</th>
                        <th style={th}>Wanted From</th>
                        <th style={th}>Wanted To</th>
                      </tr>
                    </thead>
                    <tbody>
                      {results.unmet.map((d, i) => (
                        <tr key={i}>
                          <td style={td}>{d.userName}</td>
                          <td style={td}><strong>{d.clerkship}</strong></td>
                          <td style={td}>{d.from}</td>
                          <td style={td}>{d.to}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}

              {results.freeMoves?.length === 0 && results.swaps?.length === 0 && results.unmet?.length === 0 && (
                <div style={{ color: '#888', padding: '20px', textAlign: 'center' }}>
                  No desires submitted yet. Users need to add desired moves first.
                </div>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function Field({ label, value, onChange }) {
  return (
    <label style={fieldWrap}>
      <span style={fieldLabel}>{label}</span>
      <input value={value} onChange={(e) => onChange(e.target.value)} style={inputStyle} />
    </label>
  );
}

function TextAreaField({ label, help, value, onChange }) {
  return (
    <label style={fieldWrap}>
      <span style={fieldLabel}>{label}</span>
      {help ? <span style={helpText}>{help}</span> : null}
      <textarea value={value} onChange={(e) => onChange(e.target.value)} rows={4} style={textAreaStyle} />
    </label>
  );
}

function StatBox({ label, value, color }) {
  return (
    <div style={{
      padding: '16px 24px',
      backgroundColor: 'white',
      border: `2px solid ${color}`,
      borderRadius: '8px',
      textAlign: 'center',
      minWidth: '120px'
    }}>
      <div style={{ fontSize: '28px', fontWeight: 700, color }}>{value}</div>
      <div style={{ fontSize: '12px', color: '#666', marginTop: '4px' }}>{label}</div>
    </div>
  );
}

function splitLines(value) {
  return value
    .split(/\r?\n/)
    .map(line => line.trim())
    .filter(Boolean);
}

function parseBlocksForEditor(value) {
  try {
    const parsed = JSON.parse(value || '[]');
    if (!Array.isArray(parsed)) return [];

    return parsed.map((block) => ({
      title: typeof block?.title === 'string' ? block.title : '',
      itemsText: Array.isArray(block?.items) ? block.items.join('\n') : ''
    }));
  } catch {
    return [];
  }
}

const card = { backgroundColor: 'white', padding: '24px', borderRadius: '8px', boxShadow: '0 1px 3px rgba(0,0,0,0.1)' };
const errorBox = { padding: '8px 16px', backgroundColor: '#fde8e8', color: '#e74c3c', borderRadius: '4px', marginBottom: '12px' };
const successBox = { padding: '8px 16px', backgroundColor: '#e8f8e8', color: '#27ae60', borderRadius: '4px', marginBottom: '12px' };
const sectionTitle = { margin: '0 0 8px', fontSize: '15px', color: '#2c3e50' };
const tableStyle = { width: '100%', borderCollapse: 'collapse' };
const th = { padding: '10px 12px', textAlign: 'left', borderBottom: '2px solid #eee', fontSize: '13px', color: '#555' };
const td = { padding: '10px 12px', borderBottom: '1px solid #f0f0f0', fontSize: '13px' };
const deleteButton = { padding: '6px 12px', backgroundColor: '#e74c3c', color: 'white', border: 'none', borderRadius: '4px', fontSize: '12px' };
const tabRow = { display: 'flex', gap: '8px', marginBottom: '16px' };
const tabButton = { padding: '10px 16px', backgroundColor: '#ecf0f1', color: '#2c3e50', border: '1px solid #d5dbdb', borderRadius: '6px', cursor: 'pointer', fontSize: '14px', fontWeight: 600 };
const activeTabButton = { backgroundColor: '#2c3e50', color: 'white', borderColor: '#2c3e50' };
const fieldWrap = { display: 'grid', gap: '6px' };
const fieldLabel = { fontSize: '13px', fontWeight: 600, color: '#2c3e50' };
const helpText = { fontSize: '12px', color: '#7f8c8d' };
const inputStyle = { padding: '10px 12px', border: '1px solid #d5dbdb', borderRadius: '4px', fontSize: '14px' };
const textAreaStyle = { padding: '10px 12px', border: '1px solid #d5dbdb', borderRadius: '4px', fontSize: '14px', resize: 'vertical', fontFamily: 'inherit' };
const blockCard = { display: 'grid', gap: '12px', padding: '16px', border: '1px solid #e5e7eb', borderRadius: '8px', backgroundColor: '#fafbfc' };
const addButton = { padding: '8px 12px', backgroundColor: '#27ae60', color: 'white', border: 'none', borderRadius: '4px', cursor: 'pointer', fontSize: '12px', fontWeight: 600 };
const removeButton = { padding: '6px 10px', backgroundColor: '#e74c3c', color: 'white', border: 'none', borderRadius: '4px', cursor: 'pointer', fontSize: '12px' };
const diagnosticsWrap = { display: 'grid', gap: '12px', marginBottom: '20px' };
const diagnosticsSummary = { padding: '12px 14px', backgroundColor: '#fff8e1', border: '1px solid #f5deb3', borderRadius: '6px', color: '#7d5a16', fontSize: '13px', lineHeight: 1.6 };
const diagnosticCard = { display: 'grid', gap: '12px', padding: '16px', border: '1px solid #f1c7c5', borderRadius: '8px', backgroundColor: '#fffafa' };
const diagnosticLabel = { fontSize: '12px', fontWeight: 700, color: '#7f8c8d', textTransform: 'uppercase', letterSpacing: '0.04em', marginBottom: '6px' };
const diagnosticList = { margin: 0, paddingLeft: '18px', color: '#2c3e50', fontSize: '13px', lineHeight: 1.6 };
const chipRow = { display: 'flex', flexWrap: 'wrap', gap: '6px' };
const infoChip = { padding: '4px 10px', backgroundColor: '#eef6fb', color: '#1f5f8b', borderRadius: '999px', fontSize: '12px' };
const blockedChip = { padding: '4px 10px', backgroundColor: '#fde8e8', color: '#b42318', borderRadius: '999px', fontSize: '12px' };
const emptyText = { color: '#95a5a6', fontSize: '12px' };
