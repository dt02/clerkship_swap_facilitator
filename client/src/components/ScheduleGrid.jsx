import React from 'react';
import { CLERKSHIPS, ALL_PERIODS, getOccupiedPeriods } from '../constants';

export default function ScheduleGrid({ entries, blocked, onToggleImmobile, onRemove, onToggleBlocked }) {
  // Build occupation map: period+year -> { clerkship, isStart, spanWidth }
  const occupationByYear = { 1: {}, 2: {} };
  const startCells = { 1: {}, 2: {} };

  for (const entry of entries) {
    const occupied = getOccupiedPeriods(entry.clerkship, entry.start_period);
    const def = CLERKSHIPS[entry.clerkship];
    for (let i = 0; i < occupied.length; i++) {
      occupationByYear[entry.year][occupied[i]] = {
        clerkship: entry.clerkship,
        color: def?.color || '#95a5a6',
        isStart: i === 0,
        span: occupied.length,
        isImmobile: entry.is_immobile
      };
    }
    startCells[entry.year][entry.start_period] = entry.clerkship;
  }

  const blockedSet = new Set(blocked.map(b => `${b.year}-${b.period}`));

  return (
    <div style={{ overflowX: 'auto' }}>
      <div style={{ fontSize: '11px', color: '#888', marginBottom: '4px' }}>
        Click any empty cell to block/unblock it
      </div>
      {[1, 2].map(year => (
        <div key={year} style={{ marginBottom: '16px' }}>
          <h3 style={{ margin: '0 0 8px', fontSize: '15px', color: '#2c3e50' }}>Year {year}</h3>
          <div style={{
            display: 'grid',
            gridTemplateColumns: `80px repeat(${ALL_PERIODS.length}, minmax(48px, 1fr))`,
            gap: '1px',
            backgroundColor: '#ddd',
            borderRadius: '6px',
            overflow: 'hidden',
            fontSize: '11px'
          }}>
            {/* Header row */}
            <div style={headerCell}>Period</div>
            {ALL_PERIODS.map(p => (
              <div key={p} style={headerCell}>{p}</div>
            ))}

            {/* Schedule row */}
            <div style={{ ...dataCell, fontWeight: 600, backgroundColor: '#f8f9fa' }}>Schedule</div>
            {ALL_PERIODS.map(p => {
              const occ = occupationByYear[year][p];
              const isBlocked = blockedSet.has(`${year}-${p}`);

              if (occ && !occ.isStart) {
                // Part of a multi-period clerkship but not the start - skip (handled by colspan)
                return null;
              }

              if (occ && occ.isStart) {
                return (
                  <div key={p} style={{
                    ...dataCell,
                    gridColumn: `span ${occ.span}`,
                    backgroundColor: occ.color,
                    color: 'white',
                    fontWeight: 600,
                    fontSize: '10px',
                    position: 'relative',
                    cursor: 'default',
                    textAlign: 'center',
                    padding: '4px 2px'
                  }}>
                    <div>{occ.clerkship}</div>
                    <div style={{ display: 'flex', justifyContent: 'center', gap: '4px', marginTop: '2px' }}>
                      {occ.isImmobile && (
                        <span title="Immobile" style={{ fontSize: '10px' }}>LOCKED</span>
                      )}
                    </div>
                    <div style={{ display: 'flex', justifyContent: 'center', gap: '2px', marginTop: '2px' }}>
                      <button
                        onClick={(e) => { e.stopPropagation(); onToggleImmobile(occ.clerkship); }}
                        title={occ.isImmobile ? 'Unlock' : 'Lock'}
                        style={tinyBtn}
                      >
                        {occ.isImmobile ? 'Unlock' : 'Lock'}
                      </button>
                      <button
                        onClick={(e) => { e.stopPropagation(); onRemove(occ.clerkship); }}
                        title="Remove"
                        style={{ ...tinyBtn, backgroundColor: 'rgba(0,0,0,0.3)' }}
                      >
                        Remove
                      </button>
                    </div>
                  </div>
                );
              }

              return (
                <div
                  key={p}
                  onClick={() => onToggleBlocked && onToggleBlocked(p, year)}
                  title={isBlocked ? 'Click to unblock' : 'Click to block'}
                  style={{
                    ...dataCell,
                    backgroundColor: isBlocked ? '#fde8e8' : 'white',
                    color: isBlocked ? '#e74c3c' : '#bbb',
                    fontSize: '10px',
                    cursor: 'pointer',
                    userSelect: 'none'
                  }}
                  onMouseEnter={e => {
                    if (!isBlocked) e.currentTarget.style.backgroundColor = '#fff3f3';
                  }}
                  onMouseLeave={e => {
                    e.currentTarget.style.backgroundColor = isBlocked ? '#fde8e8' : 'white';
                  }}
                >
                  {isBlocked ? 'BLOCKED' : '-'}
                </div>
              );
            })}
          </div>
        </div>
      ))}
    </div>
  );
}

const headerCell = {
  padding: '8px 4px',
  backgroundColor: '#34495e',
  color: 'white',
  textAlign: 'center',
  fontWeight: 600
};

const dataCell = {
  padding: '8px 4px',
  backgroundColor: 'white',
  textAlign: 'center',
  display: 'flex',
  flexDirection: 'column',
  justifyContent: 'center',
  alignItems: 'center',
  minHeight: '60px'
};

const tinyBtn = {
  padding: '1px 4px',
  fontSize: '9px',
  backgroundColor: 'rgba(255,255,255,0.3)',
  color: 'white',
  border: 'none',
  borderRadius: '2px',
  cursor: 'pointer'
};
