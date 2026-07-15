'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { getCurrentAssessmentPeriod, getEmployeeId } from '../../../utils/assessment';
import { supabase } from '../../../utils/supabase';
import type { AssessmentPeriod, Profile } from '../../../types';

function formatDateTime(value: string | null | undefined) {
  if (!value) return '-';
  return new Intl.DateTimeFormat('th-TH', {
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(new Date(value));
}

export default function EmployeeAssessmentPage() {
  const router = useRouter();
  const [profile, setProfile] = useState<Profile | null>(null);
  const [period, setPeriod] = useState<AssessmentPeriod | null>(null);
  const [loading, setLoading] = useState(true);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  useEffect(() => {
    const init = async () => {
      setLoading(true);
      const {
        data: { session },
      } = await supabase.auth.getSession();

      if (!session?.user) {
        router.push('/login');
        return;
      }

      const { data: profileRows, error: profileError } = await supabase
        .from('profiles')
        .select('*')
        .eq('email', session.user.email ?? '')
        .limit(1);

      if (profileError) {
        setErrorMessage(profileError.message);
        setLoading(false);
        return;
      }

      const currentProfile = (profileRows?.[0] ?? null) as Profile | null;
      setProfile(currentProfile);

      const { data: periodRows, error: periodsError } = await supabase
        .from('assessment_periods')
        .select('*')
        .eq('status', 'self_open')
        .order('self_start_at', { ascending: false });

      if (periodsError) {
        setErrorMessage(periodsError.message);
        setLoading(false);
        return;
      }

      setPeriod(getCurrentAssessmentPeriod((periodRows ?? []) as AssessmentPeriod[]));
      setLoading(false);
    };

    init();
  }, [router]);

  const employeeId = getEmployeeId(profile);

  if (loading) {
    return <div style={{ padding: 24, color: '#64748b' }}>Loading...</div>;
  }

  return (
    <main style={{ minHeight: '100vh', padding: 24, background: '#f1f5f9' }}>
      <section
        className="summary-card"
        style={{ maxWidth: 760, margin: '0 auto', background: '#ffffff' }}
      >
        <div className="app-logo-text-sub">ISE Work Tracker</div>
        <h1 style={{ margin: '4px 0 8px', fontSize: 24 }}>
          Self Evaluation
        </h1>
        <p style={{ marginTop: 0, color: '#64748b' }}>
          แบบประเมินตนเองสำหรับภาระงานและคุณลักษณะการปฏิบัติงาน
        </p>

        {errorMessage && <div className="login-error">{errorMessage}</div>}

        {!period ? (
          <div
            style={{
              borderRadius: 12,
              border: '1px solid #e2e8f0',
              background: '#f8fafc',
              padding: 16,
              marginTop: 16,
            }}
          >
            <h2 style={{ marginTop: 0, fontSize: 18 }}>
              ขณะนี้ยังไม่อยู่ในช่วงเวลาการประเมินตนเอง
            </h2>
            <p style={{ color: '#64748b', marginBottom: 0 }}>
              There is no active self-evaluation period at this time.
            </p>
          </div>
        ) : (
          <div
            style={{
              borderRadius: 12,
              border: '1px solid #bbf7d0',
              background: '#ecfdf5',
              padding: 16,
              marginTop: 16,
            }}
          >
            <h2 style={{ marginTop: 0, fontSize: 18 }}>{period.title}</h2>
            <p style={{ color: '#475569' }}>
              Employee: <strong>{employeeId || '-'}</strong>
            </p>
            <p style={{ color: '#475569' }}>
              Open from {formatDateTime(period.self_start_at)} to{' '}
              {formatDateTime(period.self_end_at)}
            </p>
            <Link
              href={`/employee/assessment/${period.id}`}
              className="btn btn-primary"
            >
              Start / Continue
            </Link>
          </div>
        )}

        <div style={{ marginTop: 16 }}>
          <Link href="/" className="btn btn-secondary">
            Back to tasks
          </Link>
        </div>
      </section>
    </main>
  );
}
