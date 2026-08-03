// Main place to adjust Attendance/Leave dashboard thresholds, labels, and
// leave type keyword matching.
// Changing these values should not require database changes.
// If new source columns are needed, update import mapping separately.

export const lateCountWarningThreshold = 5;
export const totalLateMinutesWarningThreshold = 300;
export const averageLateMinutesReferenceLine = 30;
export const lateCountReferenceLine = 30;
export const maxHorizontalBarRows = 20;
export const defaultExcludeCancelledLeave = true;
export const dashboardBackHref = '/';
export const dashboardBackLabel = 'Back to Main App';

export const sickLeaveKeywords = ['sick', 'ลาป่วย'];
export const personalLeaveKeywords = ['personal', 'ลากิจ'];
export const vacationLeaveKeywords = ['vacation', 'annual', 'ลาพักผ่อน'];
export const cancelledLeaveKeywords = [
  'cancelled',
  'canceled',
  'cancel',
  'ยกเลิก',
];

export const dashboardLabels = {
  lateCount: 'Late Count',
  totalLateMins: 'Total Late Mins',
  lateStaffCount: 'Late Staff Count',
  avgLateMinutes: 'Avg Late Minutes',
  headCountLateOverThreshold: 'Head Count Late > 5 Times',
  headCountTimeOverThreshold: 'Head Count Time Total > 300',
  sickLeaveUsedDays: 'Sick Leave Used (Days)',
  personalLeaveUsedDays: 'Personal Leave Used (Days)',
  vacationLeaveUsedDays: 'Vacation Leave Used (Days)',
};
