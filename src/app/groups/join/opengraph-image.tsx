import { ImageResponse } from 'next/og';

// Metadata image routes receive route params but never searchParams, so the
// invite code (?code=) is not visible here. The card stays generic; the
// group name and member count live in the page's og:title / og:description.
export const alt = 'You’re invited to a group on Splittr';
export const size = { width: 1200, height: 630 };
export const contentType = 'image/png';

const GREEN = '#4ade80';

export default function GroupInviteOpengraphImage() {
  return new ImageResponse(
    (
      <div
        style={{
          width: '100%',
          height: '100%',
          display: 'flex',
          flexDirection: 'column',
          justifyContent: 'space-between',
          padding: '80px 96px',
          backgroundColor: '#0b0b0d',
          backgroundImage:
            'radial-gradient(circle at 78% 30%, rgba(74,222,128,0.28) 0%, rgba(74,222,128,0.08) 32%, rgba(11,11,13,0) 62%)',
          color: '#fff',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 20 }}>
          {/* Brand mark: the split disc from src/app/icon.svg */}
          <svg width="64" height="64" viewBox="14 10 36 44">
            <path fill={GREEN} d="M43.31 20.69A16 16 0 0 0 20.69 43.31Z" transform="translate(-1.2 -4.2)" />
            <path fill={GREEN} d="M43.31 20.69A16 16 0 0 1 20.69 43.31Z" transform="translate(1.2 4.2)" />
          </svg>
          <div
            style={{
              fontSize: 56,
              fontWeight: 700,
              letterSpacing: -2,
              lineHeight: 1.1,
              paddingBottom: 4,
              backgroundImage: 'linear-gradient(90deg, #86efac 0%, #4ade80 50%, #22c55e 100%)',
              backgroundClip: 'text',
              color: 'transparent',
            }}
          >
            Splittr
          </div>
        </div>
        <div style={{ display: 'flex', flexDirection: 'column' }}>
          <div style={{ fontSize: 80, fontWeight: 700, letterSpacing: -2, lineHeight: 1.1 }}>
            You&apos;re invited to a group
          </div>
          <div style={{ marginTop: 24, fontSize: 34, color: 'rgba(255,255,255,0.6)' }}>
            Sign in to join and keep your bills together.
          </div>
        </div>
      </div>
    ),
    size,
  );
}
