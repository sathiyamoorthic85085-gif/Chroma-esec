export type UserRole =
  | 'hod'
  | 'class_advisor'
  | 'dept_staff'
  | 'other_dept_staff'
  | 'student'
  | 'class_rep';

export type AccountStatus = 'pending' | 'approved' | 'rejected';

export type UploadModule =
  | 'department_students'
  | 'department_staff'
  | 'other_department_staff'
  | 'class_representatives'
  | 'timetable';

export interface UserProfile {
  id: number;
  uid: string | null;
  fullName: string;
  email: string;
  role: UserRole;
  department: string;
  staffOrRollId: string;
  yearOfStudy: string;
  section: string;
  phone: string;
  status: AccountStatus;
  approvedBy: string | null;
  approvedAt: string | null;
  createdAt: string;
}

export interface ServerTimePayload {
  serverUtcIso: string;
  serverEpochMs: number;
  academicTimezone: string;
  departmentName: string;
  isoDate: string; // YYYY-MM-DD in server academic timezone
  formattedDate: string;
  formattedTime: string;
  weekday: string;
  minutesSinceMidnight: number;
  isAcademicDay: boolean;
  activePeriod: {
    periodNumber: number;
    label: string;
    startTime: string;
    endTime: string;
    minutesRemaining: number;
  } | null;
  nextPeriod: {
    periodNumber: number;
    label: string;
    startTime: string;
    endTime: string;
    startsInMinutes: number;
  } | null;
  scheduleState: 'in_session' | 'break' | 'before_hours' | 'after_hours' | 'weekend';
}

export interface DepartmentStudent {
  id: number;
  rollNo: string;
  fullName: string;
  email: string;
  department: string;
  yearOfStudy: string;
  section: string;
  phone: string;
  isClassRep: boolean;
  crResponsibility: string;
  advisorName: string;
  cgpa: string;
  sourceBatchId: number | null;
  sourceFilename: string | null;
  createdAt: string;
}

export interface DepartmentStaff {
  id: number;
  employeeId: string;
  fullName: string;
  email: string;
  department: string;
  designation: string;
  specialization: string;
  phone: string;
  isClassAdvisor: boolean;
  advisingClass: string;
  sourceBatchId: number | null;
  sourceFilename: string | null;
  createdAt: string;
}

export interface OtherDepartmentStaff {
  id: number;
  employeeId: string;
  fullName: string;
  email: string;
  homeDepartment: string;
  handlingSubject: string;
  designation: string;
  phone: string;
  visitingDays: string;
  sourceBatchId: number | null;
  sourceFilename: string | null;
  createdAt: string;
}

export interface TimetableSlot {
  id: number;
  department: string;
  yearOfStudy: string;
  section: string;
  dayOfWeek: string;
  periodNumber: number;
  startTime: string;
  endTime: string;
  subjectCode: string;
  subjectName: string;
  facultyName: string;
  facultyType: 'department' | 'other_department';
  roomNo: string;
  sourceBatchId: number | null;
  createdAt: string;
}

export interface UploadBatch {
  id: number;
  targetModule: UploadModule;
  originalFilename: string;
  fileType: string;
  recordsInserted: number;
  recordsUpdated: number;
  uploadedByName: string;
  uploadedByRole: string;
  createdAt: string;
}

export interface EmailIntimation {
  id: number;
  recipientEmail: string;
  recipientName: string;
  role: UserRole;
  subject: string;
  body: string;
  deliveryStatus: 'sent_smtp' | 'recorded_in_portal';
  deliveryDetail: string;
  triggeredByName: string;
  createdAt: string;
}

export interface ParsedPreviewResponse {
  targetModule: UploadModule;
  originalFilename: string;
  fileType: string;
  totalRows: number;
  validRows: Record<string, string | number | boolean>[];
  warnings: string[];
  columns: string[];
}

export interface BootstrapStatus {
  hodExists: boolean;
  envPasscodeConfigured: boolean;
  departmentName: string;
  academicTimezone: string;
}

// ============================================================
// WhatsApp-Style Communities & Messaging Types
// ============================================================
export type CommunityCategory =
  | 'department'
  | 'academic_class'
  | 'faculty_council'
  | 'announcement'
  | 'general';

export interface CommunityGroupItem {
  id: number;
  communityId: number;
  name: string;
  description: string;
  groupType: 'announcements' | 'group' | 'direct';
  onlyAdminsCanPost: boolean;
  createdByUserId: number | null;
  messageCount: number;
  lastMessagePreview: string | null;
  lastMessageAt: string | null;
  createdAt: string;
}

export interface CommunityItem {
  id: number;
  name: string;
  description: string;
  department: string;
  category: CommunityCategory;
  announcementOnly: boolean;
  createdByUserId: number | null;
  createdByName: string;
  memberCount: number;
  canManage: boolean;
  groups: CommunityGroupItem[];
  createdAt: string;
  updatedAt: string;
}

export type ChatAttachmentType =
  | 'none'
  | 'document'
  | 'photo'
  | 'contact'
  | 'location'
  | 'voice'
  | 'shared_link'
  | 'call_invite';

export interface ChatAttachmentPayload {
  // Document / Photo / Voice file reference
  fileKey?: string;
  fileName?: string;
  mimeType?: string;
  fileSize?: number;
  durationSec?: number;
  // Contact card
  contactName?: string;
  contactRole?: string;
  contactDepartment?: string;
  contactId?: string;
  contactEmail?: string;
  contactPhone?: string;
  // Live location
  latitude?: number;
  longitude?: number;
  accuracyMeters?: number;
  locationLabel?: string;
  isLiveLocation?: boolean;
  // Shared external link (Instagram, YouTube, Google Form, Web)
  url?: string;
  title?: string;
  sourceApp?: string;
  // Call invite (Audio / Group Video Meet)
  callMode?: 'audio' | 'video';
  callRoomId?: string;
}

export interface PowerBoostAcknowledgementItem {
  id: number;
  messageId: number;
  userId: number;
  userName: string;
  userRole: string;
  responseNote: string;
  acknowledgedAt: string;
}

export interface ChatMessageItem {
  id: number;
  groupId: number;
  senderUserId: number | null;
  senderName: string;
  senderRole: string;
  content: string;
  messageType: 'text' | 'announcement' | 'system' | 'call_invite';
  attachmentType: ChatAttachmentType;
  attachment: ChatAttachmentPayload | null;
  powerBoostEnabled: boolean;
  powerBoostIntervalMinutes: number;
  powerBoostExpiresAt: string | null;
  powerBoostActionUrl: string;
  acknowledgements: PowerBoostAcknowledgementItem[];
  acknowledgedByMe: boolean;
  replyToId: number | null;
  isPinned: boolean;
  editedAt: string | null;
  createdAt: string;
}

export interface ActivePowerBoostAlert {
  messageId: number;
  groupId: number;
  groupName: string;
  communityName: string;
  senderUserId: number | null;
  senderName: string;
  senderRole: string;
  content: string;
  powerBoostIntervalMinutes: number;
  powerBoostExpiresAt: string | null;
  powerBoostActionUrl: string;
  createdAt: string;
}

export interface PowerBoostMessageStatItem {
  messageId: number;
  groupId: number;
  groupName: string;
  communityId: number;
  communityName: string;
  senderName: string;
  senderRole: string;
  content: string;
  isFormRequest: boolean;
  powerBoostActionUrl: string;
  powerBoostIntervalMinutes: number;
  status: 'active' | 'expired' | 'stopped';
  studentAcknowledgements: number;
  staffAcknowledgements: number;
  totalAcknowledgements: number;
  pendingStudents: number;
  studentCompletionRate: number;
  acknowledgements: PowerBoostAcknowledgementItem[];
  createdAt: string;
}

export interface PowerBoostEngagementSummary {
  totalTargetStudents: number;
  enrolledStudentCount: number;
  approvedStudentAccountCount: number;
  totalBoostedMessages: number;
  activeBoostedMessages: number;
  formRequestMessages: number;
  noticeMessages: number;
  totalStudentAcknowledgements: number;
  formStudentCompletions: number;
  noticeStudentAcknowledgements: number;
  uniqueStudentsEngaged: number;
  totalPendingStudentResponses: number;
  averageStudentCompletionRate: number;
  messages: PowerBoostMessageStatItem[];
}

export interface CallParticipantInfo {
  socketId: string;
  userId: number;
  fullName: string;
  role: string;
  callMode: 'audio' | 'video';
  micMuted: boolean;
  cameraOff: boolean;
  screenSharing: boolean;
  handRaised: boolean;
}

export interface SharedContentPayload {
  title: string;
  text: string;
  url: string;
}

// ============================================================
// Dual-Camera Live Timetable Attendance Types
// ============================================================
export type AttendancePersonType = 'student' | 'faculty';

export interface AttendanceRecordItem {
  id: number;
  attendanceDate: string;
  dayOfWeek: string;
  periodNumber: number;
  timetableSlotId: number | null;
  subjectCode: string;
  subjectName: string;
  department: string;
  yearOfStudy: string;
  section: string;
  roomNo: string;
  personType: AttendancePersonType;
  personIdentifier: string;
  personName: string;
  markedByName: string;
  status: 'present' | 'late' | 'rejected';
  faceImageData: string;
  environmentImageData: string;
  faceDetected: boolean;
  faceConfidence: number;
  environmentVerified: boolean;
  environmentLabel: string;
  verificationSummary: string;
  serverTimestamp: string;
  createdAt: string;
}

export interface MonthlyAttendanceDayPoint {
  date: string;
  day: number;
  label: string;
  present: number;
  rejected: number;
  studentsPresent: number;
  facultyPresent: number;
  total: number;
  verificationRate: number | null;
}

export interface MonthlyAttendanceTrendsPayload {
  month: string;
  monthLabel: string;
  departmentName: string;
  totalRecords: number;
  totalPresent: number;
  totalRejected: number;
  studentPresent: number;
  facultyPresent: number;
  activeDays: number;
  overallRate: number;
  days: MonthlyAttendanceDayPoint[];
}

export interface DeduplicateReport {
  studentsCleaned: number;
  deptStaffCleaned: number;
  otherStaffCleaned: number;
  timetableCleaned: number;
  attendanceCleaned: number;
  totalRemoved: number;
  message: string;
}

export const ROLE_LABELS: Record<UserRole, string> = {
  hod: 'Head of Department (HOD)',
  class_advisor: 'Class Advisor',
  dept_staff: 'Department Staff',
  other_dept_staff: 'Other Department Staff',
  student: 'Student',
  class_rep: 'Class Representative',
};

export const MODULE_LABELS: Record<UploadModule, string> = {
  department_students: 'Department Students',
  department_staff: 'Department Staff',
  other_department_staff: 'Other Department Staff',
  class_representatives: 'Class Representatives',
  timetable: 'Department Timetable',
};
