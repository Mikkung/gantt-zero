// app/account/page.tsx
'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { supabase } from '../../utils/supabase';

export default function AccountPage() {
  const router = useRouter();

  const [loading, setLoading] = useState(true);
  const [currentEmail, setCurrentEmail] = useState<string | null>(null);

  const [password, setPassword] = useState('');
  const [passwordConfirm, setPasswordConfirm] = useState('');
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  // โหลด session + email ปัจจุบัน
  useEffect(() => {
    const load = async () => {
      const {
        data: { session },
        error,
      } = await supabase.auth.getSession();

      if (error) {
        console.error('getSession error:', error);
        setError('Cannot read auth session.');
        setLoading(false);
        return;
      }

      const user = session?.user;
      if (!user) {
        router.push('/login');
        return;
      }

      setCurrentEmail(user.email ?? null);
      setLoading(false);
    };

    load();
  }, [router]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setMessage(null);

    if (!password || password.length < 8) {
      setError('Password should be at least 8 characters.');
      return;
    }
    if (password !== passwordConfirm) {
      setError('Passwords do not match.');
      return;
    }

    const { error } = await supabase.auth.updateUser({ password });

    if (error) {
      console.error('updateUser error:', error);
      setError(error.message);
    } else {
      setMessage('Password updated successfully.');
      setPassword('');
      setPasswordConfirm('');
    }
  };

  if (loading) {
    return (
      <div
        style={{
          minHeight: '100vh',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          background: '#f1f5f9',
          color: '#64748b',
          fontSize: 14,
        }}
      >
        Loading account…
      </div>
    );
  }

  return (
    <div
      style={{
        minHeight: '100vh',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        background: 'radial-gradient(circle at top, #e0f2fe, #e2e8f0)',
      }}
    >
      <div
        style={{
          width: 420,
          maxWidth: '90vw',
          background: '#ffffff',
          borderRadius: 24,
          padding: 24,
          boxShadow: '0 18px 60px rgba(15,23,42,0.22)',
        }}
      >
        <div style={{ marginBottom: 16 }}>
          <div
            style={{
              width: 40,
              height: 40,
              borderRadius: '999px',
              background: '#fee2e2',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              fontSize: 12,
              fontWeight: 700,
              color: '#b91c1c',
              marginBottom: 8,
            }}
          >
            ISE
          </div>
          <h1
            style={{
              margin: 0,
              fontSize: 22,
              fontWeight: 700,
              color: '#0f172a',
            }}
          >
            Account settings
          </h1>
          <p
            style={{
              margin: '4px 0 0',
              fontSize: 13,
              color: '#64748b',
            }}
          >
            Signed in as <strong>{currentEmail}</strong>
          </p>
        </div>

        <form onSubmit={handleSubmit}>
          <div style={{ marginBottom: 12 }}>
            <div
              style={{
                fontSize: 12,
                fontWeight: 600,
                color: '#0f172a',
                marginBottom: 4,
              }}
            >
              New password
            </div>
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              style={{
                width: '100%',
                borderRadius: 999,
                border: '1px solid #e2e8f0',
                padding: '8px 12px',
                fontSize: 13,
              }}
            />
          </div>

          <div style={{ marginBottom: 16 }}>
            <div
              style={{
                fontSize: 12,
                fontWeight: 600,
                color: '#0f172a',
                marginBottom: 4,
              }}
            >
              Confirm new password
            </div>
            <input
              type="password"
              value={passwordConfirm}
              onChange={(e) => setPasswordConfirm(e.target.value)}
              style={{
                width: '100%',
                borderRadius: 999,
                border: '1px solid #e2e8f0',
                padding: '8px 12px',
                fontSize: 13,
              }}
            />
          </div>

          {error && (
            <div
              style={{
                marginBottom: 10,
                fontSize: 12,
                color: '#b91c1c',
              }}
            >
              {error}
            </div>
          )}
          {message && (
            <div
              style={{
                marginBottom: 10,
                fontSize: 12,
                color: '#16a34a',
              }}
            >
              {message}
            </div>
          )}

          <div
            style={{
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
              marginTop: 8,
            }}
          >
            <button
              type="button"
              onClick={() => router.push('/')}
              style={{
                background: 'transparent',
                border: 'none',
                fontSize: 12,
                color: '#64748b',
                textDecoration: 'underline',
                cursor: 'pointer',
              }}
            >
              ⟵ Back to app
            </button>

            <button
              type="submit"
              style={{
                border: 'none',
                borderRadius: 999,
                padding: '8px 16px',
                fontSize: 13,
                fontWeight: 600,
                background: '#b91c1c',
                color: '#ffffff',
                cursor: 'pointer',
              }}
            >
              Update password
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
