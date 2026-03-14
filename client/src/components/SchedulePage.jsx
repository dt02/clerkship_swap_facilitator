import React, { useState, useEffect, useCallback } from 'react';
import { useUser } from '../App';
import { getSchedule, saveSchedule, getBlocked, saveBlocked } from '../api';
import {
  CLERKSHIPS,
  CLERKSHIP_NAMES,
  SCHEDULE_YEARS,
  formatAcademicYear,
  formatPeriodYear,
  getOccupiedPeriods,
  getPeriodsForYear
} from '../constants';
import ScheduleGrid from './ScheduleGrid';

export default function SchedulePage() {
  const { currentUser } = useUser();
  const [entries, setEntries] = useState([]);
  const [blocked, setBlocked] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');

  // Add clerkship form
  const [addClerkship, setAddClerkship] = useState('');
  const [addPeriod, setAddPeriod] = useState('');
  const [addYear, setAddYear] = useState(0);

  // Blocked period form
  const [blockPeriod, setBlockPeriod] = useState('');
  const [blockYear, setBlockYear] = useState(0);

  const loadData = useCallback(async () => {
    if (!currentUser) return;
    setLoading(true);
    try {
      const [sched, bl] = await Promise.all([
        getSchedule(currentUser.id),
        getBlocked(currentUser.id)
      ]);
      setEntries(sched);
      setBlocked(bl);
    } catch (e) {
      setError(e.message);
    }
    setLoading(false);
  }, [currentUser]);

  useEffect(() => { loadData(); }, [loadData]);

  if (!currentUser) return null;

  async function handleAddClerkship(e) {
    e.preventDefault();
    setError('');
    setSuccess('');

    // Check if already scheduled
    if (entries.find(en => en.clerkship === addClerkship)) {
      setError(`${addClerkship} is already on your schedule. Remove it first to reschedule.`);
      return;
    }

    // Check valid start
    const def = CLERKSHIPS[addClerkship];
    const validStarts = def?.validStarts[addYear] || [];
    if (!validStarts.includes(addPeriod)) {
      setError(`${addClerkship} cannot start at ${addPeriod} in ${formatAcademicYear(addYear)}`);
      return;
    }

    // Check overlap with existing entries
    const newOccupied = getOccupiedPeriods(addClerkship, addPeriod);
    for (const existing of entries) {
      if (existing.year !== parseInt(addYear)) continue;
      const existingOccupied = getOccupiedPeriods(existing.clerkship, existing.start_period);
      const overlap = newOccupied.some(p => existingOccupied.includes(p));
      if (overlap) {
        setError(`${addClerkship} at ${addPeriod} overlaps with ${existing.clerkship}`);
        return;
      }
    }

    const newEntries = [...entries.map(e => ({
      clerkship: e.clerkship,
      start_period: e.start_period,
      year: e.year,
      is_immobile: e.is_immobile
    })), {
      clerkship: addClerkship,
      start_period: addPeriod,
      year: parseInt(addYear),
      is_immobile: false
    }];

    try {
      const result = await saveSchedule(currentUser.id, newEntries);
      setEntries(result);
      setSuccess(`Added ${addClerkship} at ${formatPeriodYear(addPeriod, addYear)}`);
      setAddClerkship('');
      setAddPeriod('');
    } catch (e) {
      setError(e.message);
    }
  }

  async function handleRemoveClerkship(clerkship) {
    const newEntries = entries
      .filter(e => e.clerkship !== clerkship)
      .map(e => ({
        clerkship: e.clerkship,
        start_period: e.start_period,
        year: e.year,
        is_immobile: e.is_immobile
      }));

    try {
      const result = await saveSchedule(currentUser.id, newEntries);
      setEntries(result);
      setSuccess(`Removed ${clerkship}`);
    } catch (e) {
      setError(e.message);
    }
  }

  async function handleToggleImmobile(clerkship) {
    const newEntries = entries.map(e => ({
      clerkship: e.clerkship,
      start_period: e.start_period,
      year: e.year,
      is_immobile: e.clerkship === clerkship ? !e.is_immobile : e.is_immobile
    }));

    try {
      const result = await saveSchedule(currentUser.id, newEntries);
      setEntries(result);
    } catch (e) {
      setError(e.message);
    }
  }

  async function handleAddBlocked(e) {
    e.preventDefault();
    const newBlocked = [...blocked.map(b => ({ period: b.period, year: b.year })),
      { period: blockPeriod, year: parseInt(blockYear) }];
    try {
      const result = await saveBlocked(currentUser.id, newBlocked);
      setBlocked(result);
      setBlockPeriod('');
    } catch (e) {
      setError(e.message);
    }
  }

  async function handleRemoveBlocked(period, year) {
    const newBlocked = blocked
      .filter(b => !(b.period === period && b.year === year))
      .map(b => ({ period: b.period, year: b.year }));
    try {
      const result = await saveBlocked(currentUser.id, newBlocked);
      setBlocked(result);
    } catch (e) {
      setError(e.message);
    }
  }

  async function handleToggleBlocked(period, year) {
    const isAlreadyBlocked = blocked.some(b => b.period === period && b.year === year);
    const newBlocked = isAlreadyBlocked
      ? blocked.filter(b => !(b.period === period && b.year === year)).map(b => ({ period: b.period, year: b.year }))
      : [...blocked.map(b => ({ period: b.period, year: b.year })), { period, year }];
    try {
      const result = await saveBlocked(currentUser.id, newBlocked);
      setBlocked(result);
    } catch (e) {
      setError(e.message);
    }
  }

  // Get valid periods for the selected clerkship/year
  const validPeriods = addClerkship
    ? (CLERKSHIPS[addClerkship]?.validStarts[addYear] || [])
    : [];
  const blockedPeriodsForYear = getPeriodsForYear(blockYear);

  return (
    <div>
      <h2 style={{ margin: '0 0 16px', fontSize: '18px', color: '#2c3e50' }}>
        Schedule for {currentUser.name}
      </h2>

      {error && <div style={{ padding: '8px 16px', backgroundColor: '#fde8e8', color: '#e74c3c', borderRadius: '4px', marginBottom: '12px' }}>{error}</div>}
      {success && <div style={{ padding: '8px 16px', backgroundColor: '#e8f8e8', color: '#27ae60', borderRadius: '4px', marginBottom: '12px' }}>{success}</div>}

      {/* Schedule Grid */}
      <ScheduleGrid
        entries={entries}
        blocked={blocked}
        onToggleImmobile={handleToggleImmobile}
        onRemove={handleRemoveClerkship}
        onToggleBlocked={handleToggleBlocked}
      />

      {/* Add clerkship form */}
      <div style={{ marginTop: '24px', display: 'flex', gap: '24px', flexWrap: 'wrap' }}>
        <div style={{
          backgroundColor: 'white',
          padding: '20px',
          borderRadius: '8px',
          boxShadow: '0 1px 3px rgba(0,0,0,0.1)',
          flex: '1',
          minWidth: '300px'
        }}>
          <h3 style={{ margin: '0 0 12px', fontSize: '15px', color: '#2c3e50' }}>Add Clerkship</h3>
          <form onSubmit={handleAddClerkship} style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
            <select value={addClerkship} onChange={e => { setAddClerkship(e.target.value); setAddPeriod(''); }}
              style={inputStyle} required>
              <option value="">Select clerkship...</option>
              {CLERKSHIP_NAMES.filter(c => !entries.find(e => e.clerkship === c)).map(c => (
                <option key={c} value={c}>{c} - {CLERKSHIPS[c].fullName}</option>
              ))}
            </select>
            <div style={{ display: 'flex', gap: '10px' }}>
              <select value={addYear} onChange={e => { setAddYear(parseInt(e.target.value)); setAddPeriod(''); }}
                style={{ ...inputStyle, flex: '1' }}>
                {SCHEDULE_YEARS.map((year) => (
                  <option key={year} value={year}>{formatAcademicYear(year)}</option>
                ))}
              </select>
              <select value={addPeriod} onChange={e => setAddPeriod(e.target.value)}
                style={{ ...inputStyle, flex: '1' }} required>
                <option value="">Start period...</option>
                {validPeriods.map(p => (
                  <option key={p} value={p}>{p}</option>
                ))}
              </select>
            </div>
            <button type="submit" style={btnPrimary}>Add to Schedule</button>
          </form>
        </div>

        {/* Blocked periods */}
        <div style={{
          backgroundColor: 'white',
          padding: '20px',
          borderRadius: '8px',
          boxShadow: '0 1px 3px rgba(0,0,0,0.1)',
          flex: '1',
          minWidth: '300px'
        }}>
          <h3 style={{ margin: '0 0 12px', fontSize: '15px', color: '#2c3e50' }}>Blocked Periods</h3>
          <form onSubmit={handleAddBlocked} style={{ display: 'flex', gap: '10px', marginBottom: '12px' }}>
            <select value={blockYear} onChange={e => setBlockYear(parseInt(e.target.value))}
              style={{ ...inputStyle, flex: '1' }}>
              {SCHEDULE_YEARS.map((year) => (
                <option key={year} value={year}>{formatAcademicYear(year)}</option>
              ))}
            </select>
            <select value={blockPeriod} onChange={e => setBlockPeriod(e.target.value)}
              style={{ ...inputStyle, flex: '1' }} required>
              <option value="">Period...</option>
              {blockedPeriodsForYear.map(p => (
                <option key={p} value={p}>{p}</option>
              ))}
            </select>
            <button type="submit" style={{ ...btnPrimary, backgroundColor: '#e74c3c' }}>Block</button>
          </form>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px' }}>
            {blocked.map((b, i) => (
              <span key={i} style={{
                padding: '4px 10px',
                backgroundColor: '#fde8e8',
                borderRadius: '12px',
                fontSize: '12px',
                display: 'flex',
                alignItems: 'center',
                gap: '6px'
              }}>
                {formatPeriodYear(b.period, b.year)}
                <button onClick={() => handleRemoveBlocked(b.period, b.year)}
                  style={{ border: 'none', background: 'none', cursor: 'pointer', color: '#e74c3c', fontWeight: 'bold', padding: '0' }}>
                  x
                </button>
              </span>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

const inputStyle = {
  padding: '8px 12px',
  borderRadius: '4px',
  border: '1px solid #ddd',
  fontSize: '14px'
};

const btnPrimary = {
  padding: '8px 16px',
  backgroundColor: '#2980b9',
  color: 'white',
  border: 'none',
  borderRadius: '4px',
  cursor: 'pointer',
  fontSize: '14px',
  fontWeight: 500
};
