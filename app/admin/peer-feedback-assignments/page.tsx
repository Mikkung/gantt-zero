'use client';

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { supabase } from '../../../utils/supabase';
import type { AssessmentPeriod, Profile } from '../../../types';

type PeerFeedbackAssignment = {
  reviewer_employee_id: string;
  reviewee_name: string;
  round: string;
  due_at: string;
  active: string;
};

const emptyAssignment: PeerFeedbackAssignment = {
  reviewer_employee_id: '',
  reviewee_name: '',
  round: '',
  due_at: '',
  active: 'true',
};

function getPeriodRound(period: AssessmentPeriod) {
  if (period.year && period.cycle_name) {
    return `${period.year}-${period.cycle_name}`.trim();
  }
  if (period.title) return period.title.trim();
  if (period.cycle_name) return period.cycle_name.trim();
  if (period.year) return String(period.year);
  return '';
}

function formatDateOnly(value: string | null | undefined) {
  return value ? value.slice(0, 10) : '';
}

export default function AdminPeerFeedbackAssignmentsPage() {
  const router = useRouter();
  const [profile, setProfile] = useState<Profile | null>(null);
  const [profiles, setProfiles] = useState<Profile[]>([]);
  const [periods, setPeriods] = useState<AssessmentPeriod[]>([]);
  const [rows, setRows] = useState<PeerFeedbackAssignment[]>([]);
  const [defaultFormUrl, setDefaultFormUrl] = useState('');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const profileNames = useMemo(
    () =>
      profiles
        .map((candidate) => candidate.display_name)
        .filter(Boolean)
        .sort((a, b) => a.localeCompare(b)),
    [profiles],
  );

  const periodOptions = useMemo(
    () =>
      periods
        .map((period) => ({
          id: period.id,
          round: getPeriodRound(period),
          due_at: formatDateOnly(period.self_end_at),
          label: [
            getPeriodRound(period),
            period.status === 'self_open' ? 'self_open' : period.status,
            formatDateOnly(period.self_end_at)
              ? `due ${formatDateOnly(period.self_end_at)}`
              : null,
          ]
            .filter(Boolean)
            .join(' · '),
          status: period.status,
        }))
        .filter((period) => period.round)
        .sort((a, b) => {
          if (a.status === 'self_open' && b.status !== 'self_open') return -1;
          if (a.status !== 'self_open' && b.status === 'self_open') return 1;
          return a.round.localeCompare(b.round);
        }),
    [periods],
  );

  const defaultPeriodOption = useMemo(
    () =>
      periodOptions.find((period) => period.status === 'self_open') ??
      periodOptions[0] ??
      null,
    [periodOptions],
  );

  useEffect(() => {
    const init = async () => {
      setLoading(true);
      setErrorMessage(null);

      const {
        data: { session },
      } = await supabase.auth.getSession();

      if (!session?.access_token || !session.user.email) {
        router.push('/login');
        return;
      }

      const { data: profileRows, error: profileError } = await supabase
        .from('profiles')
        .select('*')
        .eq('email', session.user.email)
        .limit(1);

      if (profileError) {
        setErrorMessage(profileError.message);
        setLoading(false);
        return;
      }

      const currentProfile = (profileRows?.[0] ?? null) as Profile | null;
      setProfile(currentProfile);

      if (currentProfile?.role !== 'admin') {
        setLoading(false);
        return;
      }

      const [assignmentResponse, profilesResult, periodsResult] =
        await Promise.all([
          fetch('/api/admin/peer-feedback-assignments', {
            headers: {
              Authorization: `Bearer ${session.access_token}`,
            },
          }),
          supabase.from('profiles').select('*').order('display_name', {
            ascending: true,
          }),
          supabase
            .from('assessment_periods')
            .select('*')
            .order('self_start_at', { ascending: false }),
        ]);

      const assignmentPayload = await assignmentResponse.json();
      if (!assignmentResponse.ok) {
        setErrorMessage(
          assignmentPayload.error ?? 'Cannot load peer feedback assignments.',
        );
        setLoading(false);
        return;
      }

      if (profilesResult.error) {
        setErrorMessage(profilesResult.error.message);
        setLoading(false);
        return;
      }

      if (periodsResult.error) {
        setErrorMessage(periodsResult.error.message);
        setLoading(false);
        return;
      }

      setRows((assignmentPayload.rows ?? []) as PeerFeedbackAssignment[]);
      setDefaultFormUrl(assignmentPayload.config?.default_form_url ?? '');
      setProfiles((profilesResult.data ?? []) as Profile[]);
      setPeriods((periodsResult.data ?? []) as AssessmentPeriod[]);
      setLoading(false);
    };

    void init();
  }, [router]);

  const updateRow = (
    index: number,
    patch: Partial<PeerFeedbackAssignment>,
  ) => {
    setRows((prev) =>
      prev.map((row, rowIndex) =>
        rowIndex === index ? { ...row, ...patch } : row,
      ),
    );
  };

  const addRow = () => {
    setRows((prev) => [
      ...prev,
      {
        ...emptyAssignment,
        round: defaultPeriodOption?.round ?? '',
        due_at: defaultPeriodOption?.due_at ?? '',
        active: 'true',
      },
    ]);
  };

  const updateRound = (index: number, round: string) => {
    const periodOption = periodOptions.find((period) => period.round === round);
    updateRow(index, {
      round,
      due_at: periodOption?.due_at ?? rows[index]?.due_at ?? '',
    });
  };

  const removeRow = (index: number) => {
    if (!window.confirm('Remove this assignment row?')) return;
    setRows((prev) => prev.filter((_, rowIndex) => rowIndex !== index));
  };

  const saveRows = async () => {
    setSaving(true);
    setMessage(null);
    setErrorMessage(null);

    const {
      data: { session },
    } = await supabase.auth.getSession();

    if (!session?.access_token) {
      router.push('/login');
      return;
    }

    const response = await fetch('/api/admin/peer-feedback-assignments', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${session.access_token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        rows,
        config: { default_form_url: defaultFormUrl },
      }),
    });

    const payload = await response.json();
    if (!response.ok) {
      setErrorMessage(payload.error ?? 'Cannot save peer feedback assignments.');
      setSaving(false);
      return;
    }

    setRows((payload.rows ?? []) as PeerFeedbackAssignment[]);
    setDefaultFormUrl(payload.config?.default_form_url ?? '');
    setMessage('บันทึก Assignment สำเร็จ');
    setSaving(false);
  };

  if (loading) {
    return <div style={{ padding: 24, color: '#64748b' }}>Loading...</div>;
  }

  if (profile?.role !== 'admin') {
    return (
      <main style={{ minHeight: '100vh', padding: 24, background: '#f1f5f9' }}>
        <section className="summary-card" style={{ maxWidth: 720 }}>
          <h1 style={{ marginTop: 0 }}>Peer Feedback Assignment</h1>
          <p>หน้านี้สำหรับผู้ดูแลระบบเท่านั้น</p>
          <Link href="/" className="btn btn-secondary">
            Back
          </Link>
        </section>
      </main>
    );
  }

  return (
    <main style={{ minHeight: '100vh', padding: 24, background: '#f1f5f9' }}>
      <section
        className="summary-card"
        style={{ maxWidth: 1180, margin: '0 auto', background: '#ffffff' }}
      >
        <div
          style={{
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'flex-start',
            gap: 16,
            marginBottom: 16,
          }}
        >
          <div>
            <div className="app-logo-text-sub">ISE Work Tracker</div>
            <h1 style={{ margin: '4px 0', fontSize: 24 }}>
              Peer Feedback Assignment
            </h1>
            <p style={{ margin: 0, color: '#64748b' }}>
              กำหนดว่าแต่ละคนต้องประเมินใคร และใช้ลิงก์แบบประเมินเดียวกันทุกคน
            </p>
          </div>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            <Link href="/" className="btn btn-secondary">
              Back to tasks
            </Link>
            <button type="button" className="btn btn-secondary" onClick={addRow}>
              + Add Assignment
            </button>
            <button
              type="button"
              className="btn btn-primary"
              onClick={saveRows}
              disabled={saving}
            >
              {saving ? 'Saving...' : 'Save Assignments'}
            </button>
          </div>
        </div>

        <div
          style={{
            borderRadius: 10,
            border: '1px solid #e2e8f0',
            background: '#f8fafc',
            padding: 10,
            color: '#475569',
            fontSize: 13,
            marginBottom: 12,
          }}
        >
          ข้อมูลนี้จะถูกบันทึกลงไฟล์ <code>data/peer-feedback-assignments.csv</code>{' '}
          และจะไปแสดงในหน้า <code>/employee/peer-feedback</code> ของ reviewer
          ตามค่า <code>reviewer_employee_id</code> ที่ตรงกับ{' '}
          <code>profiles.display_name</code> โดยใช้ default form link ด้านล่าง
          และจะแสดงเฉพาะเมื่อ <code>round</code> ตรงกับ self evaluation period
          ที่เปิดอยู่
        </div>

        <div
          style={{
            borderRadius: 12,
            border: '1px solid #e2e8f0',
            background: '#ffffff',
            padding: 12,
            marginBottom: 12,
          }}
        >
          <label className="field-label">Default peer feedback form link</label>
          <input
            className="input"
            value={defaultFormUrl}
            onChange={(event) => setDefaultFormUrl(event.target.value)}
            placeholder="https://forms.example.com/peer-feedback"
          />
          <div className="field-label-small">
            Link นี้จะถูกใช้กับ assignment ทุกคน ถ้าว่าง หน้า employee จะแสดง
            "ยังไม่มีลิงก์แบบประเมิน"
          </div>
          {defaultPeriodOption && (
            <div className="field-label-small">
              Default assignment period: {defaultPeriodOption.label}
            </div>
          )}
        </div>

        {errorMessage && (
          <div className="login-error" style={{ marginBottom: 12 }}>
            {errorMessage}
          </div>
        )}
        {message && (
          <div className="login-message" style={{ marginBottom: 12 }}>
            {message}
          </div>
        )}

        <div style={{ overflowX: 'auto' }}>
          <table
            style={{
              borderCollapse: 'collapse',
              minWidth: 1040,
              width: '100%',
              fontSize: 13,
            }}
          >
            <thead>
              <tr style={{ background: '#f8fafc', color: '#64748b' }}>
                <th style={{ padding: 8, textAlign: 'left' }}>Reviewer</th>
                <th style={{ padding: 8, textAlign: 'left' }}>
                  คนที่ต้องประเมิน
                </th>
                <th style={{ padding: 8, textAlign: 'left' }}>Round</th>
                <th style={{ padding: 8, textAlign: 'left' }}>Due</th>
                <th style={{ padding: 8, textAlign: 'left' }}>Active</th>
                <th style={{ padding: 8, textAlign: 'left' }}>Action</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row, index) => (
                <tr key={index} style={{ borderTop: '1px solid #e2e8f0' }}>
                  <td style={{ padding: 8, verticalAlign: 'top' }}>
                    <input
                      className="input"
                      list="peer-feedback-reviewers"
                      value={row.reviewer_employee_id}
                      onChange={(event) =>
                        updateRow(index, {
                          reviewer_employee_id: event.target.value,
                        })
                      }
                      placeholder="profiles.display_name"
                    />
                    <div className="field-label-small">
                      เลือกจากรายชื่อหรือพิมพ์เองได้
                    </div>
                  </td>
                  <td style={{ padding: 8, verticalAlign: 'top' }}>
                    <input
                      className="input"
                      list="peer-feedback-reviewees"
                      value={row.reviewee_name}
                      onChange={(event) =>
                        updateRow(index, { reviewee_name: event.target.value })
                      }
                      placeholder="Reviewee name"
                    />
                    <div className="field-label-small">
                      เลือกจากรายชื่อหรือพิมพ์เองได้
                    </div>
                  </td>
                  <td style={{ padding: 8, verticalAlign: 'top' }}>
                    <input
                      className="input"
                      list="peer-feedback-rounds"
                      value={row.round}
                      onChange={(event) =>
                        updateRound(index, event.target.value)
                      }
                      placeholder="2026-H1"
                    />
                  </td>
                  <td style={{ padding: 8, verticalAlign: 'top' }}>
                    <input
                      className="input"
                      list="peer-feedback-due-dates"
                      value={row.due_at}
                      onChange={(event) =>
                        updateRow(index, { due_at: event.target.value })
                      }
                      placeholder="2026-08-31"
                    />
                  </td>
                  <td style={{ padding: 8, verticalAlign: 'top' }}>
                    <select
                      className="select"
                      value={row.active}
                      onChange={(event) =>
                        updateRow(index, { active: event.target.value })
                      }
                    >
                      <option value="true">true</option>
                      <option value="false">false</option>
                    </select>
                  </td>
                  <td style={{ padding: 8, verticalAlign: 'top' }}>
                    <button
                      type="button"
                      className="btn btn-ghost"
                      onClick={() => removeRow(index)}
                    >
                      Remove
                    </button>
                  </td>
                </tr>
              ))}
              {rows.length === 0 && (
                <tr>
                  <td colSpan={6} style={{ padding: 16, color: '#64748b' }}>
                    ยังไม่มี assignment กด Add Assignment เพื่อเริ่มตั้งค่า
                  </td>
                </tr>
              )}
            </tbody>
          </table>
          <datalist id="peer-feedback-reviewers">
            {profileNames.map((name) => (
              <option key={`reviewer-${name}`} value={name} />
            ))}
          </datalist>
          <datalist id="peer-feedback-reviewees">
            {profileNames.map((name) => (
              <option key={`reviewee-${name}`} value={name} />
            ))}
          </datalist>
          <datalist id="peer-feedback-rounds">
            {periodOptions.map((period) => (
              <option key={`round-${period.id}`} value={period.round}>
                {period.label}
              </option>
            ))}
          </datalist>
          <datalist id="peer-feedback-due-dates">
            {periodOptions
              .filter((period) => period.due_at)
              .map((period) => (
                <option key={`due-${period.id}`} value={period.due_at}>
                  {period.label}
                </option>
              ))}
          </datalist>
        </div>
      </section>
    </main>
  );
}
