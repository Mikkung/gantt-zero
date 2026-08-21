'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { supabase } from '../../../utils/supabase';

type PeerFeedbackAssignment = {
  reviewee_name: string;
  form_url: string;
  round: string;
  due_at: string;
};

type PeerFeedbackResponse = {
  employee_id: string;
  active_self_period: {
    id: string;
    title: string;
    cycle_name: string | null;
    year: number | null;
  } | null;
  rows: PeerFeedbackAssignment[];
};

function formatDueDate(value: string) {
  if (!value) return '-';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;

  return new Intl.DateTimeFormat('th-TH', {
    dateStyle: 'medium',
    timeStyle: value.includes('T') ? 'short' : undefined,
  }).format(date);
}

export default function EmployeePeerFeedbackPage() {
  const router = useRouter();
  const [employeeId, setEmployeeId] = useState<string | null>(null);
  const [assignments, setAssignments] = useState<PeerFeedbackAssignment[]>([]);
  const [activeSelfPeriod, setActiveSelfPeriod] =
    useState<PeerFeedbackResponse['active_self_period']>(null);
  const [loading, setLoading] = useState(true);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [unauthorized, setUnauthorized] = useState(false);

  useEffect(() => {
    const loadAssignments = async () => {
      setLoading(true);
      setErrorMessage(null);
      setUnauthorized(false);

      const {
        data: { session },
      } = await supabase.auth.getSession();

      if (!session?.access_token) {
        router.push('/login');
        return;
      }

      const response = await fetch('/api/employee/peer-feedback', {
        headers: {
          Authorization: `Bearer ${session.access_token}`,
        },
      });

      if (response.status === 401) {
        router.push('/login');
        return;
      }

      if (response.status === 403) {
        setUnauthorized(true);
        setLoading(false);
        return;
      }

      const payload = await response.json();
      if (!response.ok) {
        setErrorMessage(payload.error ?? 'Cannot load peer feedback assignments.');
        setLoading(false);
        return;
      }

      const data = payload as PeerFeedbackResponse;
      setEmployeeId(data.employee_id);
      setActiveSelfPeriod(data.active_self_period);
      setAssignments(data.rows ?? []);
      setLoading(false);
    };

    void loadAssignments();
  }, [router]);

  if (loading) {
    return <div style={{ padding: 24, color: '#64748b' }}>Loading...</div>;
  }

  return (
    <main style={{ minHeight: '100vh', padding: 24, background: '#f1f5f9' }}>
      <section
        className="summary-card"
        style={{ maxWidth: 960, margin: '0 auto', background: '#ffffff' }}
      >
        <div className="app-logo-text-sub">ISE Work Tracker</div>
        <h1 style={{ margin: '4px 0 8px', fontSize: 24 }}>
          Peer Feedback Review
        </h1>
        <p style={{ marginTop: 0, color: '#64748b' }}>
          รายการนี้คือรายชื่อบุคคลที่คุณได้รับมอบหมายให้ประเมิน Peer Feedback
          กรุณากดปุ่มทำแบบประเมินตามรายชื่อที่ได้รับมอบหมาย
        </p>

        {employeeId && (
          <p style={{ color: '#475569', marginTop: 0 }}>
            Reviewer: <strong>{employeeId}</strong>
          </p>
        )}

        {unauthorized && (
          <div className="login-error">
            Unauthorized. Please contact the administrator.
          </div>
        )}

        {errorMessage && <div className="login-error">{errorMessage}</div>}

        {!unauthorized && !errorMessage && !activeSelfPeriod && (
          <div
            style={{
              borderRadius: 12,
              border: '1px solid #e2e8f0',
              background: '#f8fafc',
              padding: 16,
              marginTop: 16,
              color: '#475569',
            }}
          >
            ยังไม่อยู่ในช่วง Peer Feedback ของรอบ Self Evaluation
          </div>
        )}

        {!unauthorized &&
          !errorMessage &&
          activeSelfPeriod &&
          assignments.length === 0 && (
          <div
            style={{
              borderRadius: 12,
              border: '1px solid #e2e8f0',
              background: '#f8fafc',
              padding: 16,
              marginTop: 16,
              color: '#475569',
            }}
          >
            ยังไม่มีรายการ Peer Feedback ที่ต้องประเมิน
          </div>
        )}

        {!unauthorized && activeSelfPeriod && assignments.length > 0 && (
          <div
            style={{
              border: '1px solid #e2e8f0',
              borderRadius: 12,
              overflowX: 'auto',
              marginTop: 16,
            }}
          >
            <table
              style={{
                width: '100%',
                minWidth: 720,
                borderCollapse: 'collapse',
                fontSize: 13,
              }}
            >
              <thead>
                <tr style={{ background: '#f8fafc', color: '#64748b' }}>
                  <th style={{ padding: 10, textAlign: 'left' }}>
                    คนที่ต้องประเมิน
                  </th>
                  <th style={{ padding: 10, textAlign: 'left' }}>รอบ</th>
                  <th style={{ padding: 10, textAlign: 'left' }}>กำหนดส่ง</th>
                  <th style={{ padding: 10, textAlign: 'left' }}>แบบประเมิน</th>
                </tr>
              </thead>
              <tbody>
                {assignments.map((assignment) => (
                  <tr
                    key={`${assignment.round}:${assignment.reviewee_name}:${assignment.form_url}`}
                    style={{ borderTop: '1px solid #e2e8f0' }}
                  >
                    <td style={{ padding: 10 }}>
                      <div style={{ fontWeight: 600 }}>{assignment.reviewee_name}</div>
                    </td>
                    <td style={{ padding: 10 }}>{assignment.round || '-'}</td>
                    <td style={{ padding: 10 }}>
                      {formatDueDate(assignment.due_at)}
                    </td>
                    <td style={{ padding: 10 }}>
                      {assignment.form_url ? (
                        <a
                          href={assignment.form_url}
                          target="_blank"
                          rel="noreferrer"
                          className="btn btn-primary"
                        >
                          ทำแบบประเมิน
                        </a>
                      ) : (
                        <span
                          className="btn btn-secondary"
                          aria-disabled="true"
                          style={{
                            cursor: 'not-allowed',
                            opacity: 0.55,
                          }}
                        >
                          ยังไม่มีลิงก์แบบประเมิน
                        </span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        <div
          style={{
            marginTop: 16,
            borderRadius: 12,
            border: '1px solid #e2e8f0',
            background: '#f8fafc',
            padding: 12,
            color: '#475569',
            fontSize: 12,
          }}
        >
          Completion status is tracked in the external form response. This
          no-database MVP does not track opened_at or marked_done_at in this app.
        </div>

        <div style={{ marginTop: 16 }}>
          <Link href="/" className="btn btn-secondary">
            Back to tasks
          </Link>
        </div>
      </section>
    </main>
  );
}
