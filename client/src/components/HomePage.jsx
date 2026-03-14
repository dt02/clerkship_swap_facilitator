import React, { useEffect, useState } from 'react';
import { getSiteContent } from '../api';
import { useUser } from '../App';

const fallbackBlocks = [
  {
    title: 'How To Fill Out Your Information',
    items: [
      'Open the Schedule tab and enter each clerkship at its current start period and year.',
      'Mark any Blocked Periods where you cannot move a clerkship.',
      'If a clerkship cannot be moved at all, mark it as immobile in the schedule grid.',
      'Go to Desired Moves and add the clerkships you want moved, along with the destination period and year.'
    ]
  },
  {
    title: 'What Preferences Mean',
    items: [
      'Your current schedule is the source of truth for where each clerkship starts.',
      'Blocked periods tell the system where a resulting schedule would be unacceptable.',
      'Desired moves are requests, not guarantees. They are only applied if the result stays valid.',
      'Admins can review all users, clean up accounts, and run the matching algorithm once everyone has entered data.'
    ]
  },
  {
    title: 'How The Algorithm Works',
    items: [
      'It first looks for free moves into open availability.',
      "It then searches for valid swap groups where everyone's requested destination is freed up by the same batch.",
      'Swap groups are capped at 3 users, so the system will not execute 4-way or 5-way chains.',
      'Every proposed result is checked against blocked periods and schedule constraints before being accepted.'
    ]
  }
];

const fallbackContent = {
  hero_title: 'Coordinate clerkship swaps with a shared, structured process',
  hero_body:
    'This site helps students record their current clerkship schedule, mark blocked periods, request preferred moves, and lets an admin run a matching pass that finds direct openings and compatible swap chains.',
  signed_out_callout:
    'Sign in or create an account below to start entering your schedule and preferences.',
  signed_in_callout:
    'You are signed in and can use the tabs above to enter schedules, add desired moves, and review availability.',
  home_blocks: JSON.stringify(fallbackBlocks)
};

function parseBlocks(value) {
  try {
    const parsed = JSON.parse(value);
    if (!Array.isArray(parsed)) return fallbackBlocks;

    return parsed.map((block) => ({
      title: typeof block?.title === 'string' ? block.title : '',
      items: Array.isArray(block?.items) ? block.items.filter(item => typeof item === 'string') : []
    }));
  } catch {
    return fallbackBlocks;
  }
}

export function useHomeContent() {
  const [content, setContent] = useState(fallbackContent);

  useEffect(() => {
    let isMounted = true;

    async function loadContent() {
      try {
        const data = await getSiteContent();
        if (isMounted) {
          setContent({ ...fallbackContent, ...data });
        }
      } catch {
        if (isMounted) {
          setContent(fallbackContent);
        }
      }
    }

    loadContent();
    return () => {
      isMounted = false;
    };
  }, []);

  const blocks = parseBlocks(content.home_blocks).filter(
    (block) => block.title.trim() || block.items.some(item => item.trim())
  );

  return { content, blocks };
}

export function HomeHero({ content, signedInUser, currentUser }) {
  return (
    <div style={heroCard}>
      <div style={eyebrow}>Clerkship Swap Facilitator</div>
      <h2 style={{ margin: '0 0 12px', fontSize: '28px', color: '#1f2d3d' }}>
        {content.hero_title}
      </h2>
      <p style={lead}>{content.hero_body}</p>
      <div style={callout}>
        {signedInUser
          ? `${currentUser ? `Viewing ${currentUser.name}'s workspace. ` : ''}${content.signed_in_callout}`
          : content.signed_out_callout}
      </div>
    </div>
  );
}

export function HomeBlocks({ blocks }) {
  return (
    <div style={grid}>
      {blocks.map((block, index) => (
        <section key={index} style={card}>
          <h3 style={title}>{block.title || `Section ${index + 1}`}</h3>
          <ul style={list}>
            {block.items.map((item, itemIndex) => (
              <li key={itemIndex}>{item}</li>
            ))}
          </ul>
        </section>
      ))}
    </div>
  );
}

export default function HomePage() {
  const { signedInUser, currentUser } = useUser();
  const { content, blocks } = useHomeContent();

  return (
    <div style={{ display: 'grid', gap: '16px' }}>
      <HomeHero content={content} signedInUser={signedInUser} currentUser={currentUser} />
      <HomeBlocks blocks={blocks} />
    </div>
  );
}

const heroCard = {
  backgroundColor: 'white',
  borderRadius: '10px',
  boxShadow: '0 1px 3px rgba(0,0,0,0.1)',
  padding: '28px'
};

const eyebrow = {
  fontSize: '12px',
  fontWeight: 700,
  letterSpacing: '0.08em',
  textTransform: 'uppercase',
  color: '#2980b9',
  marginBottom: '8px'
};

const lead = {
  fontSize: '15px',
  lineHeight: 1.6,
  color: '#4a5568',
  margin: 0
};

const callout = {
  marginTop: '16px',
  padding: '12px 14px',
  backgroundColor: '#ebf5fb',
  borderRadius: '8px',
  color: '#21618c',
  fontSize: '14px'
};

const grid = {
  display: 'grid',
  gap: '16px',
  gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))'
};

const card = {
  backgroundColor: 'white',
  borderRadius: '10px',
  boxShadow: '0 1px 3px rgba(0,0,0,0.1)',
  padding: '22px'
};

const title = {
  margin: '0 0 12px',
  fontSize: '18px',
  color: '#2c3e50'
};

const list = {
  margin: 0,
  paddingLeft: '18px',
  color: '#4a5568',
  lineHeight: 1.7,
  fontSize: '14px'
};
