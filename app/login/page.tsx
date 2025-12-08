// app/login/page.tsx
'use client';

import { FormEvent, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { supabase } from '../../utils/supabase';

export default function LoginPage() {
  const router = useRouter();

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setMessage(null);
    setError(null);

    try {
      if (!email || !password) {
        setError('Please enter both email and password.');
        return;
      }

      // 🔐 Log in
      const { data, error } = await supabase.auth.signInWithPassword({
        email,
        password,
      });

      if (error) {
        setError(error.message); // เช่น Invalid login credentials
        return;
      }

      if (data.user) {
        const user = data.user;

        // 👇 เช็คว่ามี profile อยู่แล้วหรือยัง ถ้ามีแล้ว "ไม่ต้องทำอะไร"
        const {
          data: existingProfile,
          error: profileCheckError,
        } = await supabase
          .from('profiles')
          .select('id')
          .eq('id', user.id)
          .maybeSingle();

        if (!profileCheckError && !existingProfile) {
          // ➜ ยังไม่มี profile: สร้างใหม่ (role default = 'user' ใน DB)
          const displayName =
            (user.user_metadata as any)?.full_name ||
            user.email?.split('@')[0] ||
            'User';

          await supabase.from('profiles').insert({
            id: user.id,
            email: user.email,
            display_name: displayName,
          });
        }
      }

      setMessage('Signed in successfully, redirecting…');
      router.push('/');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div
      style={{
        minHeight: '100vh',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        background:
          'radial-gradient(circle at top left, #fee2e2, #eef2ff 40%, #f1f5f9)',
        padding: '16px',
      }}
    >
      <div
        style={{
          width: '100%',
          maxWidth: 420,
          background: '#ffffff',
          borderRadius: 40,
          padding: '22px 24px 18px',
          boxShadow: '0 22px 50px -18px rgba(15,23,42,0.4)',
          border: '1px solid #e2e8f0',
        }}
      >
        {/* Logo + title */}
        <div
          style={{
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            textAlign: 'center',
            gap: 6,
          }}
        >
          <div
            style={{
              width: 40,
              height: 40,
              borderRadius: 16,
              background: '#fbeaec',
              color: '#8b2332',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              fontWeight: 700,
              fontSize: 14,
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
            ISE Work Tracker
          </h1>
          <p
            style={{
              margin: 0,
              fontSize: 13,
              color: '#64748b',
            }}
          >
            Sign in with your work account to manage projects &amp; timelines.
          </p>
          <p
            style={{
              margin: 0,
              marginTop: 4,
              fontSize: 11,
              color: '#9ca3af',
            }}
          >
            If you don&apos;t have an account, please contact the admin.
          </p>
        </div>

        {/* form */}
        <form
          onSubmit={handleSubmit}
          style={{
            marginTop: 18,
            display: 'grid',
            rowGap: 10,
          }}
        >
          <div>
            <div className="field-label">Work email</div>
            <input
              className="input"
              type="email"
              autoComplete="email"
              placeholder="you@company.com"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
            />
          </div>

          <div>
            <div className="field-label">Password</div>
            <input
              className="input"
              type="password"
              autoComplete="current-password"
              placeholder="••••••••"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
            />
          </div>

          {error && (
            <p
              style={{
                fontSize: 12,
                color: '#b91c1c',
                margin: '2px 0 0',
              }}
            >
              {error}
            </p>
          )}
          {message && (
            <p
              style={{
                fontSize: 12,
                color: '#15803d',
                margin: '2px 0 0',
              }}
            >
              {message}
            </p>
          )}

          <button
            type="submit"
            className="btn btn-primary"
            style={{ width: '100%', marginTop: 6 }}
            disabled={loading}
          >
            {loading ? 'Please wait…' : 'Log in'}
          </button>
        </form>

        {/* footer row */}
        <div
          style={{
            marginTop: 10,
            fontSize: 12,
            color: '#64748b',
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
          }}
        >
          <span>Access is limited to internal accounts only.</span>
          <Link
            href="/"
            style={{ color: '#8b2332', textDecoration: 'none' }}
          >
            Back to app
          </Link>
        </div>
      </div>
    </div>
  );
}
