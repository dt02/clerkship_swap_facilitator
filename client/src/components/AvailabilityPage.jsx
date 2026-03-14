import React, { useState, useEffect } from 'react';
import { getAvailability, patchAvailability } from '../api';
import { CLERKSHIPS, CLERKSHIP_NAMES } from '../constants';

export default function AvailabilityPage() {
  const [availability, setAvailability] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [editingId, setEditingId] = useState(null);
  const [editValue, setEditValue] = useState('');

  useEffect(() => {
    loadData();
  }, []);

  async function loadData() {
    setLoading(true);
    try {
      const data = await getAvailability();
      setAvailability(data);
    } catch (e) {
      setError(e.message);
    }
    setLoading(false);
  }

  async function handleSave(id) {
    try {
      await patchAvailability(id, parseInt(editValue) || 0);
      setEditingId(null);
      loadData();
    } catch (e) {
      setError(e.message);
    }
  }

  if (loading) return <div>Loading...</div>;

  // Group availability by clerkship
  const grouped = {};
  for (const row of availability) {
    if (!grouped[row.clerkship]) grouped[row.clerkship] = {};
    if (!grouped[row.clerkship][row.year]) grouped[row.clerkship][row.year] = [];
    grouped[row.clerkship][row.year].push(row);
  }

  return (
    <div>
      <h2 style={{ margin: '0 0 8px', fontSize: '18px', color: '#2c3e50' }}>
        Clerkship Availability
      </h2>
      <p style={{ color: '#666', fontSize: '13px', margin: '0 0 16px' }}>
        Click any number to edit. These represent available spots per period across all users.
      </p>

      {error && <div style={errorBox}>{error}</div>}

      {CLERKSHIP_NAMES.map(clerkship => {
        const def = CLERKSHIPS[clerkship];
        const data = grouped[clerkship] || {};

        return (
          <div key={clerkship} style={{
            backgroundColor: 'white',
            borderRadius: '8px',
            boxShadow: '0 1px 3px rgba(0,0,0,0.1)',
            marginBottom: '12px',
            overflow: 'hidden'
          }}>
            <div style={{
              backgroundColor: def.color,
              color: 'white',
              padding: '10px 16px',
              fontSize: '14px',
              fontWeight: 600
            }}>
              {clerkship} - {def.fullName} ({def.length} period{def.length > 1 ? 's' : ''})
            </div>

            {[1, 2].map(year => {
              const validStarts = def.validStarts[year] || [];
              if (validStarts.length === 0) return (
                <div key={year} style={{ padding: '8px 16px', fontSize: '12px', color: '#999' }}>
                  Year {year}: Not available
                </div>
              );

              const yearData = data[year] || [];

              return (
                <div key={year} style={{ padding: '8px 16px' }}>
                  <div style={{ fontSize: '12px', fontWeight: 600, color: '#555', marginBottom: '6px' }}>
                    Year {year}
                  </div>
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: '4px' }}>
                    {validStarts.map(period => {
                      const row = yearData.find(r => r.period === period);
                      const spots = row?.spots ?? 0;
                      const isEditing = editingId === row?.id;

                      return (
                        <div key={period} style={{
                          display: 'flex',
                          flexDirection: 'column',
                          alignItems: 'center',
                          padding: '4px 8px',
                          backgroundColor: spots > 0 ? '#e8f8e8' : '#f8f8f8',
                          borderRadius: '4px',
                          minWidth: '48px'
                        }}>
                          <span style={{ fontSize: '10px', color: '#888' }}>{period}</span>
                          {isEditing ? (
                            <input
                              type="number"
                              min="0"
                              value={editValue}
                              onChange={e => setEditValue(e.target.value)}
                              onBlur={() => handleSave(row.id)}
                              onKeyDown={e => { if (e.key === 'Enter') handleSave(row.id); if (e.key === 'Escape') setEditingId(null); }}
                              autoFocus
                              style={{ width: '36px', textAlign: 'center', fontSize: '14px', border: '1px solid #3498db', borderRadius: '2px', padding: '2px' }}
                            />
                          ) : (
                            <span
                              onClick={() => { if (row) { setEditingId(row.id); setEditValue(String(spots)); } }}
                              style={{
                                fontSize: '16px',
                                fontWeight: 600,
                                color: spots > 0 ? '#27ae60' : '#ccc',
                                cursor: 'pointer',
                                minWidth: '24px',
                                textAlign: 'center'
                              }}
                              title="Click to edit"
                            >
                              {spots}
                            </span>
                          )}
                        </div>
                      );
                    })}
                  </div>
                </div>
              );
            })}
          </div>
        );
      })}
    </div>
  );
}

const errorBox = { padding: '8px 16px', backgroundColor: '#fde8e8', color: '#e74c3c', borderRadius: '4px', marginBottom: '12px' };
