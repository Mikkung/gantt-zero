'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import type { ChangeEvent } from 'react';
import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';
import type {
  AssessmentPeriod,
  PeerReviewImport,
  PeerReviewResult,
  Profile,
} from '../../../../../types';
import {
  PEER_REVIEW_COLUMNS,
  PEER_REVIEW_TEMPLATE_FILENAME,
  buildPeerReviewSummaries,
  createPeerReviewTemplateCsv,
  parsePeerReviewCsv,
  validatePeerReviewRows,
  type PeerReviewValidationRow,
} from '../../../../../utils/peerReview';
import { supabase } from '../../../../../utils/supabase';

function formatDateTime(value: string | null | undefined) {
  if (!value) return '-';
  return new Intl.DateTimeFormat('th-TH', {
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(new Date(value));
}

export default function PeerReviewImportPage() {
  const router = useRouter();
  const params = useParams<{ period_id: string }>();
  const periodId = params.period_id;

  const [sessionUserId, setSessionUserId] = useState<string | null>(null);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [profiles, setProfiles] = useState<Profile[]>([]);
  const [period, setPeriod] = useState<AssessmentPeriod | null>(null);
  const [imports, setImports] = useState<PeerReviewImport[]>([]);
  const [fileName, setFileName] = useState<string | null>(null);
  const [replaceExisting, setReplaceExisting] = useState(false);
  const [missingColumns, setMissingColumns] = useState<string[]>([]);
  const [previewRows, setPreviewRows] = useState<PeerReviewValidationRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [importing, setImporting] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const isAdmin = profile?.role === 'admin';
  const validRows = useMemo(
    () => previewRows.filter((row) => row.normalized && !row.errors.length),
    [previewRows],
  );
  const invalidRows = useMemo(
    () => previewRows.filter((row) => row.errors.length),
    [previewRows],
  );
  const warningRows = useMemo(
    () => previewRows.filter((row) => row.warnings.length && !row.errors.length),
    [previewRows],
  );

  const loadData = useCallback(async () => {
    const [periodResult, importsResult, profilesResult] = await Promise.all([
      supabase.from('assessment_periods').select('*').eq('id', periodId).single(),
      supabase
        .from('peer_review_imports')
        .select('*')
        .eq('period_id', periodId)
        .order('imported_at', { ascending: false }),
      supabase.from('profiles').select('*').order('display_name', { ascending: true }),
    ]);

    if (periodResult.error) throw periodResult.error;
    if (importsResult.error) throw importsResult.error;
    if (profilesResult.error) throw profilesResult.error;

    setPeriod(periodResult.data as AssessmentPeriod);
    setImports((importsResult.data ?? []) as PeerReviewImport[]);
    setProfiles((profilesResult.data ?? []) as Profile[]);
  }, [periodId]);

  useEffect(() => {
    const init = async () => {
      setLoading(true);
      setErrorMessage(null);

      try {
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

        if (profileError) throw profileError;

        const currentProfile = (profileRows?.[0] ?? null) as Profile | null;
        setProfile(currentProfile);

        if (currentProfile?.role === 'admin') {
          await loadData();
        }
      } catch (error) {
        setErrorMessage(
          error instanceof Error ? error.message : 'Cannot load peer review import.',
        );
      } finally {
        setLoading(false);
      }
    };

    init();
  }, [loadData, router]);

  const handleFileChange = async (
    event: ChangeEvent<HTMLInputElement>,
  ) => {
    const file = event.target.files?.[0];
    setMessage(null);
    setErrorMessage(null);
    setPreviewRows([]);
    setMissingColumns([]);

    if (!file) return;

    setFileName(file.name);

    try {
      const text = await file.text();
      const parsed = parsePeerReviewCsv(text);
      setMissingColumns(parsed.missingColumns);
      setPreviewRows(validatePeerReviewRows(parsed.rows, profiles));
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : 'Cannot read CSV file.');
    }
  };

  const downloadTemplate = () => {
    const csv = createPeerReviewTemplateCsv();
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');

    link.href = url;
    link.download = PEER_REVIEW_TEMPLATE_FILENAME;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  };

  const recomputeSummaries = async () => {
    const [importsResult, resultsResult] = await Promise.all([
      supabase
        .from('peer_review_imports')
        .select('id,status')
        .eq('period_id', periodId),
      supabase.from('peer_review_results').select('*').eq('period_id', periodId),
    ]);

    if (importsResult.error) throw importsResult.error;
    if (resultsResult.error) throw resultsResult.error;

    const activeImportIds = new Set(
      ((importsResult.data ?? []) as Pick<PeerReviewImport, 'id' | 'status'>[])
        .filter((row) => row.status === 'imported')
        .map((row) => row.id),
    );
    const activeRows = ((resultsResult.data ?? []) as PeerReviewResult[]).filter(
      (row) => activeImportIds.has(row.import_id),
    );
    const summaryRows = buildPeerReviewSummaries(periodId, activeRows);

    await supabase.from('peer_review_summaries').delete().eq('period_id', periodId);

    if (summaryRows.length > 0) {
      const { error } = await supabase
        .from('peer_review_summaries')
        .upsert(summaryRows, { onConflict: 'period_id,employee_id' });
      if (error) throw error;
    }
  };

  const importRows = async () => {
    if (!isAdmin || !sessionUserId || !validRows.length) return;

    setImporting(true);
    setMessage(null);
    setErrorMessage(null);

    try {
      if (replaceExisting) {
        const { error: updateError } = await supabase
          .from('peer_review_imports')
          .update({ status: 'replaced' })
          .eq('period_id', periodId)
          .eq('status', 'imported');
        if (updateError) throw updateError;

        const { error: resultsDeleteError } = await supabase
          .from('peer_review_results')
          .delete()
          .eq('period_id', periodId);
        if (resultsDeleteError) throw resultsDeleteError;

        const { error: summariesDeleteError } = await supabase
          .from('peer_review_summaries')
          .delete()
          .eq('period_id', periodId);
        if (summariesDeleteError) throw summariesDeleteError;
      }

      const { data: importData, error: importError } = await supabase
        .from('peer_review_imports')
        .insert({
          period_id: periodId,
          source_file_name: fileName,
          imported_by: sessionUserId,
          row_count: previewRows.length,
          valid_row_count: validRows.length,
          invalid_row_count: invalidRows.length,
          status: 'imported',
          notes: warningRows.length
            ? `${warningRows.length} valid rows have profile-match warnings.`
            : null,
        })
        .select('*')
        .single();

      if (importError) throw importError;

      const importRow = importData as PeerReviewImport;
      const resultRows = validRows
        .map((row) => row.normalized)
        .filter((row): row is NonNullable<typeof row> => !!row)
        .map((row) => ({
          ...row,
          import_id: importRow.id,
          period_id: periodId,
        }));

      const { error: resultsError } = await supabase
        .from('peer_review_results')
        .insert(resultRows);
      if (resultsError) throw resultsError;

      await recomputeSummaries();
      await loadData();

      setMessage('นำเข้าสำเร็จ');
    } catch (error) {
      setErrorMessage(
        error instanceof Error ? error.message : 'Cannot import peer review rows.',
      );
    } finally {
      setImporting(false);
    }
  };

  if (loading) {
    return <div style={{ padding: 24, color: '#64748b' }}>Loading...</div>;
  }

  if (!isAdmin) {
    return (
      <main style={{ minHeight: '100vh', padding: 24, background: '#f1f5f9' }}>
        <section className="summary-card" style={{ maxWidth: 720 }}>
          <h1 style={{ marginTop: 0 }}>นำเข้า Peer Review</h1>
          <p>หน้านี้สำหรับผู้ดูแลระบบเท่านั้น</p>
          <Link href="/admin/assessment-periods" className="btn btn-secondary">
            Back
          </Link>
        </section>
      </main>
    );
  }

  return (
    <main style={{ minHeight: '100vh', padding: 24, background: '#f1f5f9' }}>
      <div style={{ maxWidth: 1180, margin: '0 auto' }}>
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
            <h1 style={{ margin: '4px 0', fontSize: 24 }}>นำเข้า Peer Review</h1>
            <p style={{ margin: 0, color: '#64748b' }}>
              {period?.title ?? '-'} · CSV exported from Excel/SharePoint
            </p>
          </div>
          <Link href="/admin/assessment-periods" className="btn btn-secondary">
            Back to periods
          </Link>
        </header>

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

        <section
          style={{
            display: 'grid',
            gridTemplateColumns: 'minmax(320px, 420px) minmax(0, 1fr)',
            gap: 16,
          }}
        >
          <div className="summary-card" style={{ background: '#ffffff' }}>
            <h2 style={{ marginTop: 0, fontSize: 18 }}>ไฟล์ Peer Review</h2>
            <label className="field-label">รูปแบบไฟล์ที่รองรับ</label>
            <div style={{ color: '#64748b', fontSize: 13, marginBottom: 10 }}>
              CSV เท่านั้นใน Phase นี้ โดย export จาก Excel ได้โดยตรง
            </div>
            <div
              style={{
                borderRadius: 10,
                border: '1px solid #e2e8f0',
                background: '#f8fafc',
                padding: 10,
                marginBottom: 12,
                fontSize: 13,
                color: '#475569',
              }}
            >
              <div>
                ใช้ Template นี้เพื่อจัดรูปแบบข้อมูลก่อนนำเข้า ระบบรองรับไฟล์
                CSV ที่มีคอลัมน์ตามที่กำหนด
              </div>
              <div style={{ marginTop: 4 }}>
                หากข้อมูลมาจาก Excel บน SharePoint ให้ Export หรือ Save As
                เป็น CSV ก่อนนำเข้า
              </div>
              <button
                type="button"
                className="btn btn-secondary"
                style={{ marginTop: 10 }}
                onClick={downloadTemplate}
              >
                ดาวน์โหลด Template CSV
              </button>
            </div>
            <input
              className="input"
              type="file"
              accept=".csv,text/csv"
              onChange={handleFileChange}
            />

            <label
              style={{
                display: 'flex',
                gap: 8,
                alignItems: 'center',
                marginTop: 12,
                fontSize: 13,
              }}
            >
              <input
                type="checkbox"
                checked={replaceExisting}
                onChange={(event) => setReplaceExisting(event.target.checked)}
              />
              แทนที่ข้อมูล Peer Review เดิมของรอบนี้
            </label>

            <div
              style={{
                marginTop: 14,
                borderTop: '1px solid #e2e8f0',
                paddingTop: 12,
              }}
            >
              <h3 style={{ margin: '0 0 8px', fontSize: 15 }}>
                Expected CSV columns
              </h3>
              <div style={{ color: '#64748b', fontSize: 12, lineHeight: 1.6 }}>
                {PEER_REVIEW_COLUMNS.join(', ')}
              </div>
            </div>

            <button
              type="button"
              className="btn btn-primary"
              style={{ marginTop: 14 }}
              disabled={!validRows.length || importing}
              onClick={importRows}
            >
              {importing ? 'Importing...' : 'นำเข้าข้อมูล'}
            </button>
          </div>

          <div className="summary-card" style={{ background: '#ffffff' }}>
            <h2 style={{ marginTop: 0, fontSize: 18 }}>
              ตรวจสอบข้อมูลก่อนนำเข้า
            </h2>
            {missingColumns.length > 0 && (
              <div
                style={{
                  borderRadius: 10,
                  border: '1px solid #fed7aa',
                  background: '#fffbeb',
                  color: '#92400e',
                  padding: 10,
                  marginBottom: 12,
                  fontSize: 13,
                }}
              >
                Missing optional/expected columns: {missingColumns.join(', ')}
              </div>
            )}
            <div
              style={{
                display: 'grid',
                gridTemplateColumns: 'repeat(3, minmax(0, 1fr))',
                gap: 10,
                marginBottom: 12,
              }}
            >
              <div className="summary-card">
                <div className="summary-title">จำนวนรายการทั้งหมด</div>
                <div className="summary-value">{previewRows.length}</div>
              </div>
              <div className="summary-card">
                <div className="summary-title">จำนวนรายการที่ถูกต้อง</div>
                <div className="summary-value">{validRows.length}</div>
              </div>
              <div className="summary-card">
                <div className="summary-title">จำนวนรายการที่ไม่ถูกต้อง</div>
                <div className="summary-value">{invalidRows.length}</div>
              </div>
            </div>

            <div style={{ overflow: 'auto', maxHeight: 360 }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
                <thead>
                  <tr style={{ color: '#64748b', textAlign: 'left' }}>
                    <th style={{ padding: 8 }}>Row</th>
                    <th style={{ padding: 8 }}>EmployeeName</th>
                    <th style={{ padding: 8 }}>Overall</th>
                    <th style={{ padding: 8 }}>Status</th>
                    <th style={{ padding: 8 }}>ข้อผิดพลาด</th>
                  </tr>
                </thead>
                <tbody>
                  {previewRows.slice(0, 50).map((row) => (
                    <tr key={row.rowIndex} style={{ borderTop: '1px solid #e2e8f0' }}>
                      <td style={{ padding: 8 }}>{row.rowIndex}</td>
                      <td style={{ padding: 8 }}>
                        {row.raw.EmployeeName || '-'}
                        {row.warnings.length > 0 && (
                          <div style={{ color: '#92400e', fontSize: 12 }}>
                            {row.warnings.join('; ')}
                          </div>
                        )}
                      </td>
                      <td style={{ padding: 8 }}>{row.raw.OverallScore || '-'}</td>
                      <td style={{ padding: 8 }}>
                        {row.errors.length ? 'Invalid' : 'Valid'}
                      </td>
                      <td style={{ padding: 8, color: '#b91c1c' }}>
                        {row.errors.join('; ') || '-'}
                      </td>
                    </tr>
                  ))}
                  {!previewRows.length && (
                    <tr>
                      <td colSpan={5} style={{ padding: 16, color: '#64748b' }}>
                        Upload a CSV file to preview peer review rows.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
            {previewRows.length > 50 && (
              <div style={{ color: '#64748b', fontSize: 12, marginTop: 8 }}>
                Showing first 50 rows only.
              </div>
            )}
          </div>
        </section>

        <section
          className="summary-card"
          style={{ background: '#ffffff', overflow: 'auto', marginTop: 16 }}
        >
          <h2 style={{ marginTop: 0, fontSize: 18 }}>Current imported batches</h2>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
            <thead>
              <tr style={{ color: '#64748b', textAlign: 'left' }}>
                <th style={{ padding: 8 }}>File</th>
                <th style={{ padding: 8 }}>Imported at</th>
                <th style={{ padding: 8 }}>Status</th>
                <th style={{ padding: 8 }}>Rows</th>
                <th style={{ padding: 8 }}>Valid</th>
                <th style={{ padding: 8 }}>Invalid</th>
                <th style={{ padding: 8 }}>Notes</th>
              </tr>
            </thead>
            <tbody>
              {imports.map((row) => (
                <tr key={row.id} style={{ borderTop: '1px solid #e2e8f0' }}>
                  <td style={{ padding: 8 }}>{row.source_file_name || '-'}</td>
                  <td style={{ padding: 8 }}>{formatDateTime(row.imported_at)}</td>
                  <td style={{ padding: 8 }}>{row.status}</td>
                  <td style={{ padding: 8 }}>{row.row_count}</td>
                  <td style={{ padding: 8 }}>{row.valid_row_count}</td>
                  <td style={{ padding: 8 }}>{row.invalid_row_count}</td>
                  <td style={{ padding: 8 }}>{row.notes || '-'}</td>
                </tr>
              ))}
              {!imports.length && (
                <tr>
                  <td colSpan={7} style={{ padding: 16, color: '#64748b' }}>
                    No peer review imports yet.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </section>
      </div>
    </main>
  );
}
