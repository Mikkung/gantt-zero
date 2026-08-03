'use client';

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import {
  DEFAULT_SCORE_LEVEL_VALUES,
  normalizeScoreLevelValues,
} from '../../../utils/scoring';
import { supabase } from '../../../utils/supabase';
import type { AssessmentPeriod, AssessmentPeriodStatus, Profile } from '../../../types';

const STATUS_OPTIONS: AssessmentPeriodStatus[] = [
  'draft',
  'self_open',
  'self_closed',
  'manager_open',
  'manager_closed',
  'completed',
];

type PeriodFormState = {
  title: string;
  year: string;
  cycle_name: string;
  self_start_at: string;
  self_end_at: string;
  manager_start_at: string;
  manager_end_at: string;
  status: AssessmentPeriodStatus;
  workload_factor: string;
  attribute_factor: string;
  score_level_values: Record<string, string>;
};

const emptyForm: PeriodFormState = {
  title: '',
  year: String(new Date().getFullYear()),
  cycle_name: '',
  self_start_at: '',
  self_end_at: '',
  manager_start_at: '',
  manager_end_at: '',
  status: 'draft',
  workload_factor: '0.7',
  attribute_factor: '0.3',
  score_level_values: {
    '1': String(DEFAULT_SCORE_LEVEL_VALUES['1']),
    '2': String(DEFAULT_SCORE_LEVEL_VALUES['2']),
    '3': String(DEFAULT_SCORE_LEVEL_VALUES['3']),
    '4': String(DEFAULT_SCORE_LEVEL_VALUES['4']),
    '5': String(DEFAULT_SCORE_LEVEL_VALUES['5']),
  },
};

function toDateTimeInput(value: string | null | undefined) {
  if (!value) return '';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  return date.toISOString().slice(0, 16);
}

function fromDateTimeInput(value: string) {
  return value ? new Date(value).toISOString() : null;
}

function formatDateTime(value: string | null | undefined) {
  if (!value) return '-';
  return new Intl.DateTimeFormat('th-TH', {
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(new Date(value));
}

export default function AssessmentPeriodsAdminPage() {
  const router = useRouter();
  const [profile, setProfile] = useState<Profile | null>(null);
  const [sessionUserId, setSessionUserId] = useState<string | null>(null);
  const [periods, setPeriods] = useState<AssessmentPeriod[]>([]);
  const [form, setForm] = useState<PeriodFormState>(emptyForm);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const isAdmin = profile?.role === 'admin';
  const factorTotal =
    Number(form.workload_factor || 0) + Number(form.attribute_factor || 0);
  const showFactorWarning =
    Number.isFinite(factorTotal) && Math.abs(factorTotal - 1) > 0.0001;

  const sortedPeriods = useMemo(
    () =>
      [...periods].sort((a, b) =>
        (b.created_at ?? '').localeCompare(a.created_at ?? ''),
      ),
    [periods],
  );

  const loadPeriods = async () => {
    const { data, error } = await supabase
      .from('assessment_periods')
      .select('*')
      .order('created_at', { ascending: false });

    if (error) {
      setErrorMessage(error.message);
      return;
    }

    setPeriods((data ?? []) as AssessmentPeriod[]);
  };

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

      setSessionUserId(session.user.id);

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

      if (currentProfile?.role === 'admin') {
        await loadPeriods();
      }

      setLoading(false);
    };

    init();
  }, [router]);

  const resetForm = () => {
    setEditingId(null);
    setForm(emptyForm);
    setMessage(null);
    setErrorMessage(null);
  };

  const startEdit = (period: AssessmentPeriod) => {
    const normalizedScores = normalizeScoreLevelValues(period.score_level_values);
    setEditingId(period.id);
    setForm({
      title: period.title,
      year: period.year ? String(period.year) : '',
      cycle_name: period.cycle_name ?? '',
      self_start_at: toDateTimeInput(period.self_start_at),
      self_end_at: toDateTimeInput(period.self_end_at),
      manager_start_at: toDateTimeInput(period.manager_start_at),
      manager_end_at: toDateTimeInput(period.manager_end_at),
      status: period.status,
      workload_factor: String(period.workload_factor ?? 0.7),
      attribute_factor: String(period.attribute_factor ?? 0.3),
      score_level_values: {
        '1': String(normalizedScores['1']),
        '2': String(normalizedScores['2']),
        '3': String(normalizedScores['3']),
        '4': String(normalizedScores['4']),
        '5': String(normalizedScores['5']),
      },
    });
    setMessage(null);
    setErrorMessage(null);
  };

  const savePeriod = async () => {
    setMessage(null);
    setErrorMessage(null);

    if (!form.title.trim()) {
      setErrorMessage('Please enter an assessment period title.');
      return;
    }

    if (form.self_start_at && form.self_end_at) {
      const startsAt = new Date(form.self_start_at).getTime();
      const endsAt = new Date(form.self_end_at).getTime();
      if (startsAt > endsAt) {
        setErrorMessage('วันที่เริ่มประเมินตนเองต้องมาก่อนวันที่สิ้นสุด');
        return;
      }
    }

    if (form.manager_start_at && form.manager_end_at) {
      const startsAt = new Date(form.manager_start_at).getTime();
      const endsAt = new Date(form.manager_end_at).getTime();
      if (startsAt > endsAt) {
        setErrorMessage(
          'วันที่เริ่มประเมินโดยผู้บริหารต้องมาก่อนวันที่สิ้นสุด',
        );
        return;
      }
    }

    const workloadFactor = Number(form.workload_factor);
    const attributeFactor = Number(form.attribute_factor);
    if (
      !Number.isFinite(workloadFactor) ||
      workloadFactor < 0 ||
      workloadFactor > 1 ||
      !Number.isFinite(attributeFactor) ||
      attributeFactor < 0 ||
      attributeFactor > 1
    ) {
      setErrorMessage('Workload and attribute factors must be between 0 and 1.');
      return;
    }

    const parsedScoreValues: Record<string, number> = {};
    for (const level of ['1', '2', '3', '4', '5']) {
      const parsed = Number(form.score_level_values[level]);
      if (!Number.isFinite(parsed) || parsed < 0 || parsed > 100) {
        setErrorMessage('Score level values must be numbers between 0 and 100.');
        return;
      }
      parsedScoreValues[level] = parsed;
    }

    setSaving(true);

    const payload = {
      title: form.title.trim(),
      year: form.year ? Number(form.year) : null,
      cycle_name: form.cycle_name.trim() || null,
      self_start_at: fromDateTimeInput(form.self_start_at),
      self_end_at: fromDateTimeInput(form.self_end_at),
      manager_start_at: fromDateTimeInput(form.manager_start_at),
      manager_end_at: fromDateTimeInput(form.manager_end_at),
      status: form.status,
      workload_factor: workloadFactor,
      attribute_factor: attributeFactor,
      score_level_values: parsedScoreValues,
    };

    const result = editingId
      ? await supabase
          .from('assessment_periods')
          .update(payload)
          .eq('id', editingId)
      : await supabase
          .from('assessment_periods')
          .insert({ ...payload, created_by: sessionUserId });

    setSaving(false);

    if (result.error) {
      setErrorMessage(result.error.message);
      return;
    }

    setMessage(editingId ? 'Assessment period updated.' : 'Assessment period created.');
    resetForm();
    await loadPeriods();
  };

  if (loading) {
    return <div style={{ padding: 24, color: '#64748b' }}>Loading...</div>;
  }

  if (!isAdmin) {
    return (
      <main style={{ minHeight: '100vh', padding: 24, background: '#f1f5f9' }}>
        <section className="summary-card" style={{ maxWidth: 720 }}>
          <h1 style={{ marginTop: 0 }}>Assessment Periods</h1>
          <p>หน้านี้สำหรับผู้ดูแลระบบเท่านั้น</p>
          <p style={{ color: '#64748b' }}>
            This page is available to administrators only.
          </p>
          <Link href="/" className="btn btn-secondary">
            Back to tasks
          </Link>
        </section>
      </main>
    );
  }

  return (
    <main style={{ minHeight: '100vh', padding: 24, background: '#f1f5f9' }}>
      <div style={{ maxWidth: 1120, margin: '0 auto' }}>
        <header
          style={{
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'flex-start',
            gap: 16,
            marginBottom: 18,
          }}
        >
          <div>
            <div className="app-logo-text-sub">ISE Work Tracker</div>
            <h1 style={{ margin: '4px 0', fontSize: 24 }}>
              Assessment Periods
            </h1>
            <p style={{ margin: 0, color: '#64748b' }}>
              ตั้งค่ารอบประเมินตนเองและช่วงเวลาที่พนักงานสามารถส่งข้อมูลได้
            </p>
          </div>
          <Link href="/" className="btn btn-secondary">
            Back to tasks
          </Link>
        </header>

        <section
          style={{
            display: 'grid',
            gridTemplateColumns: 'minmax(320px, 420px) minmax(0, 1fr)',
            gap: 16,
          }}
        >
          <div className="summary-card" style={{ background: '#ffffff' }}>
            <h2 style={{ marginTop: 0, fontSize: 18 }}>
              {editingId ? 'Edit period' : 'Create period'}
            </h2>

            <label className="field-label">Title</label>
            <input
              className="input"
              value={form.title}
              onChange={(event) =>
                setForm((current) => ({ ...current, title: event.target.value }))
              }
              placeholder="เช่น รอบประเมินภาระงาน 2569"
            />

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, marginTop: 10 }}>
              <div>
                <label className="field-label">Year</label>
                <input
                  className="input"
                  type="number"
                  value={form.year}
                  onChange={(event) =>
                    setForm((current) => ({ ...current, year: event.target.value }))
                  }
                />
              </div>
              <div>
                <label className="field-label">Cycle</label>
                <input
                  className="input"
                  value={form.cycle_name}
                  onChange={(event) =>
                    setForm((current) => ({
                      ...current,
                      cycle_name: event.target.value,
                    }))
                  }
                  placeholder="Mid-year / Annual"
                />
              </div>
            </div>

            <div style={{ marginTop: 10 }}>
              <label className="field-label">Self-evaluation starts</label>
              <input
                className="input"
                type="datetime-local"
                value={form.self_start_at}
                onChange={(event) =>
                  setForm((current) => ({
                    ...current,
                    self_start_at: event.target.value,
                  }))
                }
              />
            </div>

            <div style={{ marginTop: 10 }}>
              <label className="field-label">Self-evaluation ends</label>
              <input
                className="input"
                type="datetime-local"
                value={form.self_end_at}
                onChange={(event) =>
                  setForm((current) => ({
                    ...current,
                    self_end_at: event.target.value,
                  }))
                }
              />
            </div>

            <div style={{ marginTop: 10 }}>
              <label className="field-label">
                วันที่เริ่มประเมินโดยผู้บริหาร
              </label>
              <input
                className="input"
                type="datetime-local"
                value={form.manager_start_at}
                onChange={(event) =>
                  setForm((current) => ({
                    ...current,
                    manager_start_at: event.target.value,
                  }))
                }
              />
            </div>

            <div style={{ marginTop: 10 }}>
              <label className="field-label">
                วันที่สิ้นสุดประเมินโดยผู้บริหาร
              </label>
              <input
                className="input"
                type="datetime-local"
                value={form.manager_end_at}
                onChange={(event) =>
                  setForm((current) => ({
                    ...current,
                    manager_end_at: event.target.value,
                  }))
                }
              />
            </div>

            <div style={{ marginTop: 10 }}>
              <label className="field-label">Status</label>
              <select
                className="select"
                value={form.status}
                onChange={(event) =>
                  setForm((current) => ({
                    ...current,
                    status: event.target.value as AssessmentPeriodStatus,
                  }))
                }
              >
                {STATUS_OPTIONS.map((status) => (
                  <option key={status} value={status}>
                    {status}
                  </option>
                ))}
              </select>
            </div>

            <div
              style={{
                marginTop: 14,
                paddingTop: 12,
                borderTop: '1px solid #e2e8f0',
              }}
            >
              <h3 style={{ margin: '0 0 10px', fontSize: 15 }}>
                การตั้งค่าคะแนน
              </h3>

              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
                <div>
                  <label className="field-label">สัดส่วนคะแนนภาระงาน</label>
                  <input
                    className="input"
                    type="number"
                    min={0}
                    max={1}
                    step={0.01}
                    value={form.workload_factor}
                    onChange={(event) =>
                      setForm((current) => ({
                        ...current,
                        workload_factor: event.target.value,
                      }))
                    }
                  />
                </div>
                <div>
                  <label className="field-label">สัดส่วนคะแนนคุณลักษณะ</label>
                  <input
                    className="input"
                    type="number"
                    min={0}
                    max={1}
                    step={0.01}
                    value={form.attribute_factor}
                    onChange={(event) =>
                      setForm((current) => ({
                        ...current,
                        attribute_factor: event.target.value,
                      }))
                    }
                  />
                </div>
              </div>

              {showFactorWarning && (
                <div
                  style={{
                    marginTop: 8,
                    borderRadius: 8,
                    border: '1px solid #fed7aa',
                    background: '#fffbeb',
                    color: '#92400e',
                    padding: '7px 9px',
                    fontSize: 12,
                  }}
                >
                  ผลรวมของสัดส่วนคะแนนไม่เท่ากับ 1.00
                </div>
              )}

              <label className="field-label" style={{ marginTop: 12 }}>
                ค่าคะแนนตามระดับ
              </label>
              {[5, 4, 3, 2, 1].map((level) => (
                <div
                  key={level}
                  style={{
                    display: 'grid',
                    gridTemplateColumns: '80px 1fr',
                    gap: 8,
                    alignItems: 'center',
                    marginTop: 6,
                  }}
                >
                  <div style={{ fontSize: 13, color: '#475569' }}>
                    ระดับ {level}
                  </div>
                  <input
                    className="input"
                    type="number"
                    min={0}
                    max={100}
                    step={0.01}
                    value={form.score_level_values[String(level)]}
                    onChange={(event) =>
                      setForm((current) => ({
                        ...current,
                        score_level_values: {
                          ...current.score_level_values,
                          [String(level)]: event.target.value,
                        },
                      }))
                    }
                  />
                </div>
              ))}
            </div>

            {errorMessage && (
              <div className="login-error" style={{ marginTop: 10 }}>
                {errorMessage}
              </div>
            )}
            {message && (
              <div className="login-message" style={{ marginTop: 10 }}>
                {message}
              </div>
            )}

            <div style={{ display: 'flex', gap: 8, marginTop: 14 }}>
              <button
                type="button"
                className="btn btn-primary"
                onClick={savePeriod}
                disabled={saving}
              >
                {saving ? 'Saving...' : 'Save'}
              </button>
              {editingId && (
                <button
                  type="button"
                  className="btn btn-secondary"
                  onClick={resetForm}
                >
                  Cancel
                </button>
              )}
            </div>
          </div>

          <div className="summary-card" style={{ background: '#ffffff', overflow: 'auto' }}>
            <h2 style={{ marginTop: 0, fontSize: 18 }}>Periods</h2>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
              <thead>
                <tr style={{ color: '#64748b', textAlign: 'left' }}>
                  <th style={{ padding: 8 }}>Title</th>
                  <th style={{ padding: 8 }}>Status</th>
                  <th style={{ padding: 8 }}>Self period</th>
                  <th style={{ padding: 8 }} />
                </tr>
              </thead>
              <tbody>
                {sortedPeriods.map((period) => (
                  <tr key={period.id} style={{ borderTop: '1px solid #e2e8f0' }}>
                    <td style={{ padding: 8 }}>
                      <div style={{ fontWeight: 600 }}>{period.title}</div>
                      <div style={{ color: '#64748b', fontSize: 12 }}>
                        {period.year ?? '-'} · {period.cycle_name || '-'}
                      </div>
                    </td>
                    <td style={{ padding: 8 }}>{period.status}</td>
                    <td style={{ padding: 8, color: '#475569' }}>
                      {formatDateTime(period.self_start_at)}
                      <br />
                      {formatDateTime(period.self_end_at)}
                    </td>
                    <td style={{ padding: 8, textAlign: 'right' }}>
                      <Link
                        href={`/admin/assessment-periods/${period.id}/submissions`}
                        className="btn btn-secondary"
                        style={{ marginRight: 6 }}
                      >
                        Submissions
                      </Link>
                      <Link
                        href={`/admin/assessment-periods/${period.id}/manager-evaluations`}
                        className="btn btn-secondary"
                        style={{ marginRight: 6 }}
                      >
                        Manager
                      </Link>
                      <Link
                        href={`/admin/assessment-periods/${period.id}/manager-assignments`}
                        className="btn btn-secondary"
                        style={{ marginRight: 6 }}
                      >
                        จัดผู้ประเมิน
                      </Link>
                      <Link
                        href={`/admin/assessment-periods/${period.id}/peer-review-import`}
                        className="btn btn-secondary"
                        style={{ marginRight: 6 }}
                      >
                        Peer Review
                      </Link>
                      <Link
                        href={`/admin/assessment-periods/${period.id}/export-summary`}
                        className="btn btn-primary"
                        style={{ marginRight: 6 }}
                      >
                        สรุปผลและ Export
                      </Link>
                      <button
                        type="button"
                        className="btn btn-secondary"
                        onClick={() => startEdit(period)}
                      >
                        Edit
                      </button>
                    </td>
                  </tr>
                ))}
                {!sortedPeriods.length && (
                  <tr>
                    <td colSpan={4} style={{ padding: 16, color: '#64748b' }}>
                      No assessment periods yet.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </section>
      </div>
    </main>
  );
}
