import { relations } from 'drizzle-orm';
import {
  boolean,
  integer,
  pgTable,
  serial,
  text,
  timestamp,
  uniqueIndex,
} from 'drizzle-orm/pg-core';

export const appSettings = pgTable('app_settings', {
  key: text('key').primaryKey(),
  value: text('value').notNull(),
});

export const users = pgTable('users', {
  id: serial('id').primaryKey(),
  uid: text('uid').unique(),
  fullName: text('full_name').notNull(),
  email: text('email').notNull().unique(),
  passwordHash: text('password_hash'),
  role: text('role').notNull(), // 'hod' | 'class_advisor' | 'dept_staff' | 'other_dept_staff' | 'student' | 'class_rep'
  department: text('department').notNull(),
  staffOrRollId: text('staff_or_roll_id').notNull().default(''),
  yearOfStudy: text('year_of_study').notNull().default(''),
  section: text('section').notNull().default(''),
  phone: text('phone').notNull().default(''),
  status: text('status').notNull().default('pending'), // 'pending' | 'approved' | 'rejected'
  approvedBy: text('approved_by'),
  approvedAt: text('approved_at'),
  transitBufferMinutes: integer('transit_buffer_minutes').notNull().default(15),
  createdAt: timestamp('created_at').defaultNow().notNull(),
});

export const sessions = pgTable('sessions', {
  token: text('token').primaryKey(),
  userId: integer('user_id')
    .references(() => users.id, { onDelete: 'cascade' })
    .notNull(),
  expiresAt: timestamp('expires_at').notNull(),
  createdAt: timestamp('created_at').defaultNow().notNull(),
});

export const emailIntimations = pgTable('email_intimations', {
  id: serial('id').primaryKey(),
  recipientEmail: text('recipient_email').notNull(),
  recipientName: text('recipient_name').notNull(),
  role: text('role').notNull(),
  subject: text('subject').notNull(),
  body: text('body').notNull(),
  deliveryStatus: text('delivery_status').notNull(),
  deliveryDetail: text('delivery_detail').notNull(),
  triggeredByName: text('triggered_by_name').notNull(),
  createdAt: timestamp('created_at').defaultNow().notNull(),
});

export const uploadBatches = pgTable('upload_batches', {
  id: serial('id').primaryKey(),
  targetModule: text('target_module').notNull(),
  originalFilename: text('original_filename').notNull(),
  fileType: text('file_type').notNull(),
  recordsInserted: integer('records_inserted').notNull().default(0),
  recordsUpdated: integer('records_updated').notNull().default(0),
  uploadedByName: text('uploaded_by_name').notNull(),
  uploadedByRole: text('uploaded_by_role').notNull(),
  createdAt: timestamp('created_at').defaultNow().notNull(),
});

export const departmentStudents = pgTable(
  'department_students',
  {
    id: serial('id').primaryKey(),
    rollNo: text('roll_no').notNull(),
    fullName: text('full_name').notNull(),
    email: text('email').notNull().default(''),
    department: text('department').notNull(),
    yearOfStudy: text('year_of_study').notNull(),
    section: text('section').notNull(),
    phone: text('phone').notNull().default(''),
    isClassRep: boolean('is_class_rep').notNull().default(false),
    crResponsibility: text('cr_responsibility').notNull().default(''),
    advisorName: text('advisor_name').notNull().default(''),
    cgpa: text('cgpa').notNull().default(''),
    sourceBatchId: integer('source_batch_id').references(() => uploadBatches.id, {
      onDelete: 'set null',
    }),
    createdAt: timestamp('created_at').defaultNow().notNull(),
  },
  (table) => [uniqueIndex('dept_students_roll_no_uidx').on(table.rollNo)]
);

export const departmentStaff = pgTable(
  'department_staff',
  {
    id: serial('id').primaryKey(),
    employeeId: text('employee_id').notNull(),
    fullName: text('full_name').notNull(),
    email: text('email').notNull().default(''),
    department: text('department').notNull(),
    designation: text('designation').notNull(),
    specialization: text('specialization').notNull().default(''),
    phone: text('phone').notNull().default(''),
    isClassAdvisor: boolean('is_class_advisor').notNull().default(false),
    advisingClass: text('advising_class').notNull().default(''),
    sourceBatchId: integer('source_batch_id').references(() => uploadBatches.id, {
      onDelete: 'set null',
    }),
    createdAt: timestamp('created_at').defaultNow().notNull(),
  },
  (table) => [uniqueIndex('dept_staff_emp_id_uidx').on(table.employeeId)]
);

export const otherDepartmentStaff = pgTable(
  'other_department_staff',
  {
    id: serial('id').primaryKey(),
    employeeId: text('employee_id').notNull(),
    fullName: text('full_name').notNull(),
    email: text('email').notNull().default(''),
    homeDepartment: text('home_department').notNull(),
    handlingSubject: text('handling_subject').notNull(),
    designation: text('designation').notNull().default('Assistant Professor'),
    phone: text('phone').notNull().default(''),
    visitingDays: text('visiting_days').notNull().default(''),
    sourceBatchId: integer('source_batch_id').references(() => uploadBatches.id, {
      onDelete: 'set null',
    }),
    createdAt: timestamp('created_at').defaultNow().notNull(),
  },
  (table) => [uniqueIndex('other_dept_staff_emp_id_uidx').on(table.employeeId)]
);

export const timetableSlots = pgTable(
  'timetable_slots',
  {
    id: serial('id').primaryKey(),
    department: text('department').notNull(),
    yearOfStudy: text('year_of_study').notNull(),
    section: text('section').notNull(),
    dayOfWeek: text('day_of_week').notNull(),
    periodNumber: integer('period_number').notNull(),
    startTime: text('start_time').notNull(),
    endTime: text('end_time').notNull(),
    subjectCode: text('subject_code').notNull(),
    subjectName: text('subject_name').notNull(),
    facultyName: text('faculty_name').notNull(),
    facultyType: text('faculty_type').notNull().default('department'),
    roomNo: text('room_no').notNull().default(''),
    sourceBatchId: integer('source_batch_id').references(() => uploadBatches.id, {
      onDelete: 'set null',
    }),
    createdAt: timestamp('created_at').defaultNow().notNull(),
  },
  (table) => [
    uniqueIndex('timetable_slot_unique_idx').on(
      table.department,
      table.yearOfStudy,
      table.section,
      table.dayOfWeek,
      table.periodNumber
    ),
  ]
);

// ============================================================
// WhatsApp-Style Communities, Groups & Real-Time Messages
// ============================================================
export const communities = pgTable(
  'communities',
  {
    id: serial('id').primaryKey(),
    name: text('name').notNull(),
    description: text('description').notNull().default(''),
    department: text('department').notNull(),
    category: text('category').notNull().default('department'), // 'department' | 'academic_class' | 'faculty_council' | 'announcement' | 'general'
    announcementOnly: boolean('announcement_only').notNull().default(false),
    createdByUserId: integer('created_by_user_id').references(() => users.id, {
      onDelete: 'set null',
    }),
    createdByName: text('created_by_name').notNull(),
    updatedAt: timestamp('updated_at').defaultNow().notNull(),
    createdAt: timestamp('created_at').defaultNow().notNull(),
  },
  (table) => [uniqueIndex('communities_dept_name_uidx').on(table.department, table.name)]
);

export const communityGroups = pgTable(
  'community_groups',
  {
    id: serial('id').primaryKey(),
    communityId: integer('community_id')
      .references(() => communities.id, { onDelete: 'cascade' })
      .notNull(),
    name: text('name').notNull(),
    description: text('description').notNull().default(''),
    groupType: text('group_type').notNull().default('group'), // 'announcements' | 'group' | 'direct'
    onlyAdminsCanPost: boolean('only_admins_can_post').notNull().default(false),
    createdByUserId: integer('created_by_user_id').references(() => users.id, {
      onDelete: 'set null',
    }),
    updatedAt: timestamp('updated_at').defaultNow().notNull(),
    createdAt: timestamp('created_at').defaultNow().notNull(),
  },
  (table) => [
    uniqueIndex('community_groups_comm_name_uidx').on(table.communityId, table.name),
  ]
);

export const communityMembers = pgTable(
  'community_members',
  {
    id: serial('id').primaryKey(),
    communityId: integer('community_id')
      .references(() => communities.id, { onDelete: 'cascade' })
      .notNull(),
    userId: integer('user_id')
      .references(() => users.id, { onDelete: 'cascade' })
      .notNull(),
    memberRole: text('member_role').notNull().default('member'), // 'owner' | 'admin' | 'member'
    joinedAt: timestamp('joined_at').defaultNow().notNull(),
  },
  (table) => [
    uniqueIndex('community_members_unique_idx').on(table.communityId, table.userId),
  ]
);

export const chatMessages = pgTable('chat_messages', {
  id: serial('id').primaryKey(),
  groupId: integer('group_id')
    .references(() => communityGroups.id, { onDelete: 'cascade' })
    .notNull(),
  senderUserId: integer('sender_user_id').references(() => users.id, {
    onDelete: 'set null',
  }),
  senderName: text('sender_name').notNull(),
  senderRole: text('sender_role').notNull(),
  content: text('content').notNull(),
  messageType: text('message_type').notNull().default('text'), // 'text' | 'announcement' | 'system' | 'call_invite'
  attachmentType: text('attachment_type').notNull().default('none'), // 'none' | 'document' | 'photo' | 'contact' | 'location' | 'voice' | 'shared_link' | 'call_invite'
  attachmentData: text('attachment_data').notNull().default(''), // JSON payload
  powerBoostEnabled: boolean('power_boost_enabled').notNull().default(false),
  powerBoostIntervalMinutes: integer('power_boost_interval_minutes').notNull().default(0),
  powerBoostExpiresAt: timestamp('power_boost_expires_at'),
  powerBoostActionUrl: text('power_boost_action_url').notNull().default(''),
  replyToId: integer('reply_to_id'),
  isPinned: boolean('is_pinned').notNull().default(false),
  editedAt: timestamp('edited_at'),
  createdAt: timestamp('created_at').defaultNow().notNull(),
});

export const messageAcknowledgements = pgTable(
  'message_acknowledgements',
  {
    id: serial('id').primaryKey(),
    messageId: integer('message_id')
      .references(() => chatMessages.id, { onDelete: 'cascade' })
      .notNull(),
    userId: integer('user_id')
      .references(() => users.id, { onDelete: 'cascade' })
      .notNull(),
    userName: text('user_name').notNull(),
    userRole: text('user_role').notNull(),
    responseNote: text('response_note').notNull().default(''),
    acknowledgedAt: timestamp('acknowledged_at').defaultNow().notNull(),
  },
  (table) => [
    uniqueIndex('msg_ack_message_user_uidx').on(table.messageId, table.userId),
  ]
);

// ============================================================
// Dual-Camera Timetable Attendance Records
// ============================================================
export const attendanceRecords = pgTable(
  'attendance_records',
  {
    id: serial('id').primaryKey(),
    attendanceDate: text('attendance_date').notNull(), // YYYY-MM-DD in server academic timezone
    dayOfWeek: text('day_of_week').notNull(),
    periodNumber: integer('period_number').notNull(),
    timetableSlotId: integer('timetable_slot_id').references(() => timetableSlots.id, {
      onDelete: 'set null',
    }),
    subjectCode: text('subject_code').notNull(),
    subjectName: text('subject_name').notNull(),
    department: text('department').notNull(),
    yearOfStudy: text('year_of_study').notNull().default(''),
    section: text('section').notNull().default(''),
    roomNo: text('room_no').notNull().default(''),
    personType: text('person_type').notNull(), // 'student' | 'faculty'
    personIdentifier: text('person_identifier').notNull(), // Roll No or Employee ID
    personName: text('person_name').notNull(),
    markedByUserId: integer('marked_by_user_id').references(() => users.id, {
      onDelete: 'set null',
    }),
    markedByName: text('marked_by_name').notNull(),
    status: text('status').notNull().default('present'), // 'present' | 'late' | 'rejected' | 'od' | 'absent'
    faceImageData: text('face_image_data').notNull(),
    environmentImageData: text('environment_image_data').notNull(),
    faceDetected: boolean('face_detected').notNull().default(false),
    faceConfidence: integer('face_confidence').notNull().default(0),
    environmentVerified: boolean('environment_verified').notNull().default(false),
    environmentLabel: text('environment_label').notNull().default(''),
    verificationSummary: text('verification_summary').notNull().default(''),
    serverTimestamp: text('server_timestamp').notNull(),
    createdAt: timestamp('created_at').defaultNow().notNull(),
  },
  (table) => [
    uniqueIndex('attendance_unique_daily_slot_person_idx').on(
      table.attendanceDate,
      table.periodNumber,
      table.personType,
      table.personIdentifier
    ),
  ]
);

// ============================================================
// Student Registration Biometric & Classroom Environment Baselines
// ============================================================
export const studentBiometricProfiles = pgTable(
  'student_biometric_profiles',
  {
    id: serial('id').primaryKey(),
    rollNo: text('roll_no').notNull(),
    email: text('email').notNull(),
    fullName: text('full_name').notNull(),
    department: text('department').notNull(),
    yearOfStudy: text('year_of_study').notNull().default(''),
    section: text('section').notNull().default(''),
    faceImageData: text('face_image_data').notNull(),
    environmentImageData: text('environment_image_data').notNull(),
    capturedLatitude: text('captured_latitude').notNull().default(''),
    capturedLongitude: text('captured_longitude').notNull().default(''),
    distanceMeters: integer('distance_meters'),
    locationVerified: boolean('location_verified').notNull().default(false),
    pinnedLocationLabel: text('pinned_location_label').notNull().default(''),
    createdAt: timestamp('created_at').defaultNow().notNull(),
    updatedAt: timestamp('updated_at').defaultNow().notNull(),
  },
  (table) => [uniqueIndex('student_biometric_roll_no_uidx').on(table.rollNo)]
);

// ============================================================
// Faculty Delay Alerts (Reported by Class Rep / Class Advisor / HOD)
// ============================================================
export const facultyDelayAlerts = pgTable('faculty_delay_alerts', {
  id: serial('id').primaryKey(),
  department: text('department').notNull(),
  yearOfStudy: text('year_of_study').notNull().default(''),
  section: text('section').notNull().default(''),
  dayOfWeek: text('day_of_week').notNull(),
  periodNumber: integer('period_number').notNull(),
  timetableSlotId: integer('timetable_slot_id').references(() => timetableSlots.id, {
    onDelete: 'set null',
  }),
  subjectCode: text('subject_code').notNull(),
  subjectName: text('subject_name').notNull(),
  roomNo: text('room_no').notNull().default(''),
  facultyName: text('faculty_name').notNull(),
  reportedByUserId: integer('reported_by_user_id').references(() => users.id, {
    onDelete: 'set null',
  }),
  reportedByName: text('reported_by_name').notNull(),
  reportedByRole: text('reported_by_role').notNull(),
  delayMinutes: integer('delay_minutes').notNull().default(10),
  note: text('note').notNull().default(''),
  status: text('status').notNull().default('active'), // 'active' | 'acknowledged' | 'resolved'
  acknowledgedByName: text('acknowledged_by_name').notNull().default(''),
  acknowledgedAt: timestamp('acknowledged_at'),
  createdAt: timestamp('created_at').defaultNow().notNull(),
});

// ============================================================
// OD & Leave Permission Requests (Students -> Advisor -> HOD; Faculty -> HOD)
// ============================================================
export const odLeaveRequests = pgTable('od_leave_requests', {
  id: serial('id').primaryKey(),
  requestType: text('request_type').notNull(), // 'od' | 'leave'
  applicantCategory: text('applicant_category').notNull(), // 'student' | 'faculty'
  applicantUserId: integer('applicant_user_id').references(() => users.id, {
    onDelete: 'set null',
  }),
  applicantName: text('applicant_name').notNull(),
  applicantRole: text('applicant_role').notNull(),
  rollOrEmployeeId: text('roll_or_employee_id').notNull(),
  mobileNumber: text('mobile_number').notNull().default(''),
  department: text('department').notNull(),
  yearOfStudy: text('year_of_study').notNull().default(''),
  section: text('section').notNull().default(''),
  fromDate: text('from_date').notNull(), // YYYY-MM-DD
  toDate: text('to_date').notNull(), // YYYY-MM-DD
  totalDays: integer('total_days').notNull().default(1),
  reason: text('reason').notNull(),
  customFieldsJson: text('custom_fields_json').notNull().default('{}'),
  documentFileKey: text('document_file_key').notNull().default(''),
  documentFileName: text('document_file_name').notNull().default(''),
  documentMimeType: text('document_mime_type').notNull().default(''),
  photoFileKey: text('photo_file_key').notNull().default(''),
  photoFileName: text('photo_file_name').notNull().default(''),
  photoMimeType: text('photo_mime_type').notNull().default(''),
  status: text('status').notNull().default('pending_advisor'), // 'pending_advisor' | 'pending_hod' | 'approved' | 'rejected'
  advisorStatus: text('advisor_status').notNull().default('pending'), // 'not_required' | 'pending' | 'approved' | 'rejected'
  advisorReviewedBy: text('advisor_reviewed_by').notNull().default(''),
  advisorRemarks: text('advisor_remarks').notNull().default(''),
  advisorReviewedAt: timestamp('advisor_reviewed_at'),
  hodStatus: text('hod_status').notNull().default('pending'), // 'pending' | 'approved' | 'rejected'
  hodReviewedBy: text('hod_reviewed_by').notNull().default(''),
  hodRemarks: text('hod_remarks').notNull().default(''),
  hodReviewedAt: timestamp('hod_reviewed_at'),
  attendanceMarkedStatus: text('attendance_marked_status').notNull().default(''), // '' | 'od' | 'absent'
  attendanceDaysMarked: integer('attendance_days_marked').notNull().default(0),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
});

export const communitiesRelations = relations(communities, ({ many }) => ({
  groups: many(communityGroups),
  members: many(communityMembers),
}));

export const communityGroupsRelations = relations(communityGroups, ({ one, many }) => ({
  community: one(communities, {
    fields: [communityGroups.communityId],
    references: [communities.id],
  }),
  messages: many(chatMessages),
}));

export const chatMessagesRelations = relations(chatMessages, ({ one }) => ({
  group: one(communityGroups, {
    fields: [chatMessages.groupId],
    references: [communityGroups.id],
  }),
}));

// ============================================================
// Academic Goal Tracker & Weekly History Logs
// ============================================================
export const academicGoals = pgTable(
  'academic_goals',
  {
    id: serial('id').primaryKey(),
    userId: integer('user_id')
      .references(() => users.id, { onDelete: 'cascade' })
      .notNull(),
    weeklyAttendanceTarget: integer('weekly_attendance_target').notNull().default(85),
    weeklyEngagementTarget: integer('weekly_engagement_target').notNull().default(80),
    lastCheckedInDate: text('last_checked_in_date').notNull().default(''),
    note: text('note').notNull().default(''),
    updatedAt: timestamp('updated_at').defaultNow().notNull(),
    createdAt: timestamp('created_at').defaultNow().notNull(),
  },
  (table) => [uniqueIndex('academic_goals_user_uidx').on(table.userId)]
);

export const academicGoalLogs = pgTable(
  'academic_goal_logs',
  {
    id: serial('id').primaryKey(),
    userId: integer('user_id')
      .references(() => users.id, { onDelete: 'cascade' })
      .notNull(),
    weekStart: text('week_start').notNull(), // YYYY-MM-DD (Monday)
    attendancePct: integer('attendance_pct').notNull().default(0),
    engagementPct: integer('engagement_pct').notNull().default(0),
    attendanceTarget: integer('attendance_target').notNull().default(85),
    engagementTarget: integer('engagement_target').notNull().default(80),
    checkInsCount: integer('check_ins_count').notNull().default(0),
    createdAt: timestamp('created_at').defaultNow().notNull(),
  },
  (table) => [uniqueIndex('academic_goal_logs_user_week_uidx').on(table.userId, table.weekStart)]
);

// ============================================================
// Academic Calendar Events
// ============================================================
export const academicCalendarEvents = pgTable('academic_calendar_events', {
  id: serial('id').primaryKey(),
  title: text('title').notNull(),
  eventDate: text('event_date').notNull(), // YYYY-MM-DD
  category: text('category').notNull().default('event'), // 'event' | 'exam' | 'deadline' | 'holiday'
  department: text('department').notNull(),
  yearOfStudy: text('year_of_study').notNull().default('All Years'),
  description: text('description').notNull().default(''),
  createdByName: text('created_by_name').notNull(),
  createdAt: timestamp('created_at').defaultNow().notNull(),
});

// ============================================================
// Automated Daily Archival Logs
// ============================================================
export const archivalLogs = pgTable('archival_logs', {
  id: serial('id').primaryKey(),
  archiveDate: text('archive_date').notNull(), // YYYY-MM-DD
  storagePath: text('storage_path').notNull(),
  attendanceCount: integer('attendance_count').notNull().default(0),
  studentsCount: integer('students_count').notNull().default(0),
  checksumSha256: text('checksum_sha256').notNull(),
  triggerType: text('trigger_type').notNull().default('scheduled'), // 'scheduled' | 'manual'
  status: text('status').notNull().default('completed'), // 'completed' | 'failed'
  createdAt: timestamp('created_at').defaultNow().notNull(),
});

// ============================================================
// Proactive Low-Attendance Risk Notifications Log
// ============================================================
export const attendanceRiskAlerts = pgTable('attendance_risk_alerts', {
  id: serial('id').primaryKey(),
  rollNo: text('roll_no').notNull(),
  studentName: text('student_name').notNull(),
  yearOfStudy: text('year_of_study').notNull().default(''),
  section: text('section').notNull().default(''),
  presentCount: integer('present_count').notNull().default(0),
  totalSessions: integer('total_sessions').notNull().default(0),
  cumulativeRate: integer('cumulative_rate').notNull().default(0),
  advisorNotified: boolean('advisor_notified').notNull().default(true),
  notifiedDate: text('notified_date').notNull(), // YYYY-MM-DD
  createdAt: timestamp('created_at').defaultNow().notNull(),
});

