import React, { useState, useEffect, useCallback } from 'react';
import { useUser } from '../App';
import { getDesires, addDesire, removeDesire, reorderDesires, getSchedule } from '../api';
import { CLERKSHIPS, SCHEDULE_YEARS, formatAcademicYear, formatPeriodYear } from '../constants';

export default function DesiredMovesPage() {
  const { currentUser } = useUser();
  const [desires, setDesires] = useState([]);
  const [schedule, setSchedule] = useState([]);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');

  const [clerkship, setClerkship] = useState('');
  const [toPeriod, setToPeriod] = useState('');
  const [toYear, setToYear] = useState(0);

  const loadData = useCallback(async () => {
    if (!currentUser) return;
    try {
      const [des, sched] = await Promise.all([
        getDesires(currentUser.id),
        getSchedule(currentUser.id)
      ]);
      setDesires(des);
      setSchedule(sched);
    } catch (e) {
      setError(e.message);
    }
  }, [currentUser]);

  useEffect(() => { loadData(); }, [loadData]);

  if (!currentUser) return null;

  // Only show clerkships that are on the user's schedule
  const scheduledClerkships = schedule.map(e => e.clerkship);

  // Get current position of selected clerkship
  const currentEntry = schedule.find(e => e.clerkship === clerkship);

  // Valid destinations for selected clerkship + year
  const validDestinations = clerkship
    ? (CLERKSHIPS[clerkship]?.validStarts[toYear] || [])
    : [];

  async function handleAdd(e) {
    e.preventDefault();
    setError('');
    setSuccess('');

    if (!currentEntry) {
      setError('Selected clerkship is not on your schedule');
      return;
    }

    try {
      await addDesire(currentUser.id, {
        clerkship,
        from_period: currentEntry.start_period,
        from_year: currentEntry.year,
        to_period: toPeriod,
        to_year: parseInt(toYear)
      });
      setSuccess(`Added desired move for ${clerkship}`);
      setClerkship('');
      setToPeriod('');
      loadData();
    } catch (e) {
      setError(e.message);
    }
  }

  async function handleRemove(desireId) {
    try {
      await removeDesire(currentUser.id, desireId);
      loadData();
    } catch (e) {
      setError(e.message);
    }
  }

  async function handleMove(desireId, direction) {
    const index = desires.findIndex((desire) => desire.id === desireId);
    const swapIndex = index + direction;
    if (index === -1 || swapIndex < 0 || swapIndex >= desires.length) {
      return;
    }

    const reordered = [...desires];
    [reordered[index], reordered[swapIndex]] = [reordered[swapIndex], reordered[index]];

    try {
      const updated = await reorderDesires(currentUser.id, reordered.map((desire) => desire.id));
      setDesires(updated);
    } catch (e) {
      setError(e.message);
    }
  }

  return (
    <div>
      <h2 style={{ margin: '0 0 16px', fontSize: '18px', color: '#2c3e50' }}>
        Desired Moves for {currentUser.name}
      </h2>

      {error && <div style={errorBox}>{error}</div>}
      {success && <div style={successBox}>{success}</div>}

      {/* Current desires */}
      <div style={card}>
        <h3 style={cardTitle}>Current Desired Moves</h3>
        <p style={{ color: '#666', margin: '0 0 12px', fontSize: '13px' }}>
          Use the arrow buttons to rank your requests. Higher-priority requests are favored when your own desires conflict.
        </p>
        {desires.length === 0 ? (
          <p style={{ color: '#888', margin: 0 }}>No desired moves yet. Add one below.</p>
        ) : (
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead>
              <tr>
                <th style={th}>Priority</th>
                <th style={th}>Clerkship</th>
                <th style={th}>From</th>
                <th style={th}>To</th>
                <th style={th}>Action</th>
              </tr>
            </thead>
            <tbody>
              {desires.map((d, index) => (
                <tr key={d.id}>
                  <td style={td}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                      <strong>#{index + 1}</strong>
                      <div style={{ display: 'flex', gap: '4px' }}>
                        <button
                          type="button"
                          onClick={() => handleMove(d.id, -1)}
                          disabled={index === 0}
                          style={priorityButton}
                        >
                          Up
                        </button>
                        <button
                          type="button"
                          onClick={() => handleMove(d.id, 1)}
                          disabled={index === desires.length - 1}
                          style={priorityButton}
                        >
                          Down
                        </button>
                      </div>
                    </div>
                  </td>
                  <td style={td}><strong>{d.clerkship}</strong></td>
                  <td style={td}>{formatPeriodYear(d.from_period, d.from_year)}</td>
                  <td style={td}>{formatPeriodYear(d.to_period, d.to_year)}</td>
                  <td style={td}>
                    <button onClick={() => handleRemove(d.id)} style={removeBtn}>Remove</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {/* Add desire form */}
      <div style={{ ...card, marginTop: '16px' }}>
        <h3 style={cardTitle}>Add Desired Move</h3>
        <p style={{ color: '#666', margin: '0 0 12px', fontSize: '13px' }}>
          New requests are added at the bottom of your priority list.
        </p>
        {scheduledClerkships.length === 0 ? (
          <p style={{ color: '#888', margin: 0 }}>You need to add clerkships to your schedule first.</p>
        ) : (
          <form onSubmit={handleAdd} style={{ display: 'flex', flexDirection: 'column', gap: '12px', maxWidth: '500px' }}>
            <div>
              <label style={labelStyle}>Clerkship to Move</label>
              <select value={clerkship} onChange={e => { setClerkship(e.target.value); setToPeriod(''); }} style={inputStyle} required>
                <option value="">Select clerkship...</option>
                {scheduledClerkships.map(c => {
                  const entry = schedule.find(e => e.clerkship === c);
                  return (
                    <option key={c} value={c}>
                      {c} (currently at {formatPeriodYear(entry.start_period, entry.year)})
                    </option>
                  );
                })}
              </select>
            </div>

            {currentEntry && (
              <div style={{ padding: '8px 12px', backgroundColor: '#f0f0f0', borderRadius: '4px', fontSize: '13px' }}>
                Currently at: <strong>{formatPeriodYear(currentEntry.start_period, currentEntry.year)}</strong>
              </div>
            )}

            <div style={{ display: 'flex', gap: '10px' }}>
              <div style={{ flex: 1 }}>
                <label style={labelStyle}>Destination Year</label>
                <select value={toYear} onChange={e => { setToYear(parseInt(e.target.value)); setToPeriod(''); }} style={inputStyle}>
                  {SCHEDULE_YEARS.map((year) => (
                    <option key={year} value={year}>{formatAcademicYear(year)}</option>
                  ))}
                </select>
              </div>
              <div style={{ flex: 1 }}>
                <label style={labelStyle}>Destination Period</label>
                <select value={toPeriod} onChange={e => setToPeriod(e.target.value)} style={inputStyle} required>
                  <option value="">Select period...</option>
                  {validDestinations.map(p => (
                    <option key={p} value={p}>{p}</option>
                  ))}
                </select>
              </div>
            </div>

            <button type="submit" style={btnPrimary}>Add Desired Move</button>
          </form>
        )}
      </div>
    </div>
  );
}

const card = { backgroundColor: 'white', padding: '20px', borderRadius: '8px', boxShadow: '0 1px 3px rgba(0,0,0,0.1)' };
const cardTitle = { margin: '0 0 12px', fontSize: '15px', color: '#2c3e50' };
const errorBox = { padding: '8px 16px', backgroundColor: '#fde8e8', color: '#e74c3c', borderRadius: '4px', marginBottom: '12px' };
const successBox = { padding: '8px 16px', backgroundColor: '#e8f8e8', color: '#27ae60', borderRadius: '4px', marginBottom: '12px' };
const th = { padding: '10px 12px', textAlign: 'left', borderBottom: '2px solid #eee', fontSize: '13px', color: '#555' };
const td = { padding: '10px 12px', borderBottom: '1px solid #f0f0f0', fontSize: '13px' };
const inputStyle = { padding: '8px 12px', borderRadius: '4px', border: '1px solid #ddd', fontSize: '14px', width: '100%', boxSizing: 'border-box' };
const labelStyle = { display: 'block', fontSize: '12px', color: '#555', marginBottom: '4px', fontWeight: 600 };
const btnPrimary = { padding: '10px 20px', backgroundColor: '#2980b9', color: 'white', border: 'none', borderRadius: '4px', cursor: 'pointer', fontSize: '14px', fontWeight: 500 };
const removeBtn = { padding: '4px 12px', backgroundColor: '#e74c3c', color: 'white', border: 'none', borderRadius: '4px', cursor: 'pointer', fontSize: '12px' };
const priorityButton = { padding: '4px 8px', backgroundColor: '#ecf0f1', color: '#2c3e50', border: '1px solid #d5dbdb', borderRadius: '4px', cursor: 'pointer', fontSize: '11px' };
