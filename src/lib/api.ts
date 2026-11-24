import type {
  ActivePowerBoostAlert,
  AttendancePersonType,
  AttendanceRecordItem,
  BootstrapStatus,
  CallParticipantInfo,
  ChatAttachmentPayload,
  ChatAttachmentType,
  ChatMessageItem,
  CommunityCategory,
  CommunityItem,
  DeduplicateReport,
  DepartmentStaff,
  DepartmentStudent,
  EmailIntimation,
  MonthlyAttendanceTrendsPayload,
  OtherDepartmentStaff,
  ParsedPreviewResponse,
  PowerBoostAcknowledgementItem,
  PowerBoostEngagementSummary,
  ServerTimePayload,
  TimetableSlot,
  UploadBatch,
  UploadModule,
  UserProfile,
  UserRole,
} from '../types';

export class ApiError extends Error {
  status: number;
  accountStatus?: string;

  constructor(message: string, status: number, accountStatus?: string) {
    super(message);
    this.status = status;
    this.accountStatus = accountStatus;
  }
}

async function requestJson<T>(
  url: string,
  options: RequestInit = {},
  token?: string | null
): Promise<T> {
  const headers: Record<string, string> = {
    ...(options.headers as Record<string, string> | undefined),
  };

  if (token) {
    headers['Authorization'] = `Bearer ${token}`;
  }
  if (!(options.body instanceof FormData) && !headers['Content-Type']) {
    headers['Content-Type'] = 'application/json';
  }

  const res = await fetch(url, { ...options, headers });
  const data = await res.json().catch(() => ({}));

  if (!res.ok) {
    throw new ApiError(
      data.error || `Request failed (${res.status})`,
      res.status,
      data.accountStatus
    );
  }
  return data as T;
}

export const api = {
  // Server Time
  getServerTime: () => requestJson<ServerTimePayload>('/api/server-time'),

  // Auth & Onboarding
  getBootstrapStatus: () => requestJson<BootstrapStatus>('/api/auth/bootstrap-status'),

  syncFirebaseLogin: (idToken: string) =>
    requestJson<{ token: string; user: UserProfile }>(
      '/api/auth/firebase-sync',
      { method: 'POST' },
      idToken
    ),

  bootstrapHod: (payload: {
    fullName: string;
    email: string;
    password: string;
    department: string;
  }) =>
    requestJson<{ token: string; user: UserProfile }>('/api/auth/bootstrap-hod', {
      method: 'POST',
      body: JSON.stringify(payload),
    }),

  register: (payload: {
    fullName: string;
    email: string;
    password: string;
    role: UserRole;
    department: string;
    staffOrRollId: string;
    yearOfStudy: string;
    section: string;
    phone: string;
  }) =>
    requestJson<{ user: UserProfile; message: string }>('/api/auth/register', {
      method: 'POST',
      body: JSON.stringify(payload),
    }),

  login: (email: string, password: string) =>
    requestJson<{ token: string; user: UserProfile }>('/api/auth/login', {
      method: 'POST',
      body: JSON.stringify({ email, password }),
    }),

  logout: (token: string) =>
    requestJson<{ ok: boolean }>('/api/auth/logout', { method: 'POST' }, token),

  getMe: (token: string) => requestJson<{ user: UserProfile }>('/api/auth/me', {}, token),

  checkRegistrationStatus: (email: string) =>
    requestJson<{
      fullName: string;
      email: string;
      role: UserRole;
      department: string;
      status: 'pending' | 'approved' | 'rejected';
      approvedBy: string | null;
      approvedAt: string | null;
      createdAt: string;
      intimation: {
        subject: string;
        body: string;
        deliveryStatus: string;
        deliveryDetail: string;
        createdAt: string;
      } | null;
    }>(`/api/auth/registration-status?email=${encodeURIComponent(email)}`),

  // HOD Governance & Deduplication
  getRegistrations: (token: string) =>
    requestJson<{ registrations: UserProfile[] }>('/api/hod/registrations', {}, token),

  approveRegistration: (token: string, id: number) =>
    requestJson<{ user: UserProfile; intimation: EmailIntimation }>(
      `/api/hod/registrations/${id}/approve`,
      { method: 'POST' },
      token
    ),

  rejectRegistration: (token: string, id: number) =>
    requestJson<{ user: UserProfile }>(
      `/api/hod/registrations/${id}/reject`,
      { method: 'POST' },
      token
    ),

  getIntimations: (token: string) =>
    requestJson<{ intimations: EmailIntimation[] }>('/api/hod/intimations', {}, token),

  updateSettings: (
    token: string,
    payload: { academicTimezone?: string; departmentName?: string }
  ) =>
    requestJson<{
      academicTimezone: string;
      departmentName: string;
      serverTime: ServerTimePayload;
    }>(
      '/api/hod/settings',
      { method: 'PATCH', body: JSON.stringify(payload) },
      token
    ),

  runDeduplicate: (token: string) =>
    requestJson<DeduplicateReport>('/api/hod/deduplicate', { method: 'POST' }, token),

  // Directories & Timetable
  getStudents: (token: string) =>
    requestJson<{ students: DepartmentStudent[] }>('/api/records/students', {}, token),

  getDepartmentStaff: (token: string) =>
    requestJson<{ staff: DepartmentStaff[] }>('/api/records/department-staff', {}, token),

  getOtherDepartmentStaff: (token: string) =>
    requestJson<{ staff: OtherDepartmentStaff[] }>(
      '/api/records/other-department-staff',
      {},
      token
    ),

  getTimetable: (token: string) =>
    requestJson<{ serverTime: ServerTimePayload; slots: TimetableSlot[] }>(
      '/api/records/timetable',
      {},
      token
    ),

  getUploadBatches: (token: string) =>
    requestJson<{ batches: UploadBatch[] }>('/api/records/batches', {}, token),

  // Document Ingestion
  parseDocument: (token: string, targetModule: UploadModule, file: File) => {
    const fd = new FormData();
    fd.append('targetModule', targetModule);
    fd.append('document', file);
    return requestJson<ParsedPreviewResponse>(
      '/api/uploads/parse',
      { method: 'POST', body: fd },
      token
    );
  },

  commitDocumentRows: (
    token: string,
    payload: {
      targetModule: UploadModule;
      originalFilename: string;
      fileType: string;
      rows: Record<string, string | number | boolean>[];
    }
  ) =>
    requestJson<{
      ok: boolean;
      recordsInserted: number;
      recordsUpdated: number;
      message: string;
    }>('/api/uploads/commit', { method: 'POST', body: JSON.stringify(payload) }, token),

  downloadTemplate: async (
    token: string,
    module: UploadModule,
    format: 'xlsx' | 'pdf' | 'csv'
  ) => {
    const res = await fetch(`/api/templates/${module}/${format}`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!res.ok) {
      throw new Error('Could not download sample template.');
    }
    const blob = await res.blob();
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `ChromaGrade_${module}_template.${format}`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  },

  // WhatsApp-Style Communities & Messaging
  getCommunities: (token: string) =>
    requestJson<{ communities: CommunityItem[]; canCreateCommunity: boolean }>(
      '/api/communities',
      {},
      token
    ),

  createCommunity: (
    token: string,
    payload: {
      name: string;
      description: string;
      category: CommunityCategory;
      announcementOnly: boolean;
    }
  ) =>
    requestJson<{ community: CommunityItem }>(
      '/api/communities',
      { method: 'POST', body: JSON.stringify(payload) },
      token
    ),

  updateCommunity: (
    token: string,
    id: number,
    payload: {
      name?: string;
      description?: string;
      category?: CommunityCategory;
      announcementOnly?: boolean;
    }
  ) =>
    requestJson<{ ok: boolean }>(
      `/api/communities/${id}`,
      { method: 'PATCH', body: JSON.stringify(payload) },
      token
    ),

  deleteCommunity: (token: string, id: number) =>
    requestJson<{ ok: boolean }>(`/api/communities/${id}`, { method: 'DELETE' }, token),

  createCommunityGroup: (
    token: string,
    communityId: number,
    payload: {
      name: string;
      description: string;
      groupType: 'announcements' | 'group';
      onlyAdminsCanPost: boolean;
    }
  ) =>
    requestJson<{ group: unknown }>(
      `/api/communities/${communityId}/groups`,
      { method: 'POST', body: JSON.stringify(payload) },
      token
    ),

  updateCommunityGroup: (
    token: string,
    groupId: number,
    payload: { name?: string; description?: string; onlyAdminsCanPost?: boolean }
  ) =>
    requestJson<{ group: unknown }>(
      `/api/communities/groups/${groupId}`,
      { method: 'PATCH', body: JSON.stringify(payload) },
      token
    ),

  deleteCommunityGroup: (token: string, groupId: number) =>
    requestJson<{ ok: boolean }>(
      `/api/communities/groups/${groupId}`,
      { method: 'DELETE' },
      token
    ),

  getGroupMessages: (token: string, groupId: number) =>
    requestJson<{ messages: ChatMessageItem[] }>(
      `/api/communities/groups/${groupId}/messages`,
      {},
      token
    ),

  sendGroupMessage: (
    token: string,
    groupId: number,
    payload: {
      content?: string;
      replyToId?: number | null;
      attachmentType?: ChatAttachmentType;
      attachment?: ChatAttachmentPayload | null;
      powerBoostEnabled?: boolean;
      powerBoostIntervalMinutes?: number;
      powerBoostDurationHours?: number;
      powerBoostActionUrl?: string;
    }
  ) =>
    requestJson<{ message: ChatMessageItem }>(
      `/api/communities/groups/${groupId}/messages`,
      { method: 'POST', body: JSON.stringify(payload) },
      token
    ),

  uploadChatAttachment: (token: string, groupId: number, file: File) => {
    const fd = new FormData();
    fd.append('file', file);
    return requestJson<{
      attachmentType: ChatAttachmentType;
      attachment: ChatAttachmentPayload;
    }>(
      `/api/communities/groups/${groupId}/attachments`,
      { method: 'POST', body: fd },
      token
    );
  },

  fetchChatAttachmentBlobUrl: async (
    token: string,
    fileKey: string,
    fileName?: string
  ): Promise<string> => {
    const qs = fileName ? `?name=${encodeURIComponent(fileName)}` : '';
    const res = await fetch(`/api/communities/attachments/${encodeURIComponent(fileKey)}${qs}`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!res.ok) {
      throw new Error('Could not load chat attachment.');
    }
    const blob = await res.blob();
    return URL.createObjectURL(blob);
  },

  downloadChatAttachment: async (token: string, fileKey: string, fileName: string) => {
    const qs = `?name=${encodeURIComponent(fileName)}&download=1`;
    const res = await fetch(`/api/communities/attachments/${encodeURIComponent(fileKey)}${qs}`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!res.ok) {
      throw new Error('Could not download attachment.');
    }
    const blob = await res.blob();
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = fileName || 'attachment';
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  },

  getActivePowerBoostAlerts: (token: string) =>
    requestJson<{ alerts: ActivePowerBoostAlert[] }>(
      '/api/communities/power-boost/active',
      {},
      token
    ),

  getPowerBoostStats: (token: string, groupId?: number) => {
    const suffix =
      typeof groupId === 'number' && Number.isFinite(groupId) ? `?groupId=${groupId}` : '';
    return requestJson<PowerBoostEngagementSummary>(
      `/api/communities/power-boost/stats${suffix}`,
      {},
      token
    );
  },

  acknowledgePowerBoost: (token: string, messageId: number, responseNote?: string) =>
    requestJson<{ ok: boolean; acknowledgement: PowerBoostAcknowledgementItem }>(
      `/api/communities/messages/${messageId}/acknowledge`,
      { method: 'POST', body: JSON.stringify({ responseNote: responseNote ?? '' }) },
      token
    ),

  stopPowerBoost: (token: string, messageId: number) =>
    requestJson<{ ok: boolean }>(
      `/api/communities/messages/${messageId}/power-boost/stop`,
      { method: 'POST' },
      token
    ),

  getActiveCalls: (token: string) =>
    requestJson<{ activeCalls: Record<string, CallParticipantInfo[]> }>(
      '/api/communities/calls/active',
      {},
      token
    ),

  updateChatMessage: (
    token: string,
    messageId: number,
    payload: { content?: string; isPinned?: boolean }
  ) =>
    requestJson<{ message: ChatMessageItem }>(
      `/api/communities/messages/${messageId}`,
      { method: 'PATCH', body: JSON.stringify(payload) },
      token
    ),

  deleteChatMessage: (token: string, messageId: number) =>
    requestJson<{ ok: boolean }>(
      `/api/communities/messages/${messageId}`,
      { method: 'DELETE' },
      token
    ),

  // Dual-Camera Timetable Attendance
  getTodayAttendance: (token: string) =>
    requestJson<{
      serverTime: ServerTimePayload;
      todaySlots: TimetableSlot[];
      allSlots: TimetableSlot[];
      records: AttendanceRecordItem[];
    }>('/api/attendance/today', {}, token),

  getAttendanceHistory: (
    token: string,
    params?: { date?: string; personType?: AttendancePersonType }
  ) => {
    const qs = new URLSearchParams();
    if (params?.date) qs.set('date', params.date);
    if (params?.personType) qs.set('personType', params.personType);
    const suffix = qs.toString() ? `?${qs.toString()}` : '';
    return requestJson<{ records: AttendanceRecordItem[] }>(
      `/api/attendance/history${suffix}`,
      {},
      token
    );
  },

  verifyAndMarkAttendance: (
    token: string,
    payload: {
      personType: AttendancePersonType;
      personIdentifier: string;
      personName: string;
      timetableSlotId: number | null;
      periodNumber: number;
      subjectCode: string;
      subjectName: string;
      yearOfStudy: string;
      section: string;
      roomNo: string;
      faceImageData: string;
      environmentImageData: string;
    }
  ) =>
    requestJson<{
      approved: boolean;
      verification: {
        faceDetected: boolean;
        faceConfidence: number;
        spoofSuspected: boolean;
        environmentVerified: boolean;
        environmentLabel: string;
        approvedForAttendance: boolean;
        summary: string;
      };
      record: AttendanceRecordItem;
    }>(
      '/api/attendance/verify-and-mark',
      { method: 'POST', body: JSON.stringify(payload) },
      token
    ),

  exportAttendance: async (
    token: string,
    format: 'csv' | 'pdf',
    params?: {
      date?: string;
      month?: string;
      personType?: AttendancePersonType;
      scope?: 'date' | 'month' | 'all_dates';
    }
  ) => {
    const qs = new URLSearchParams();
    if (params?.date) qs.set('date', params.date);
    if (params?.month) qs.set('month', params.month);
    if (params?.personType) qs.set('personType', params.personType);
    if (params?.scope) qs.set('scope', params.scope);
    const suffix = qs.toString() ? `?${qs.toString()}` : '';
    const res = await fetch(`/api/attendance/export/${format}${suffix}`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!res.ok) {
      let message = 'Could not export attendance log.';
      try {
        const err = await res.json();
        if (err?.error) message = err.error;
      } catch {
        // Ignore parse failure
      }
      throw new Error(message);
    }
    const blob = await res.blob();
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    const scopeSlug = params?.personType || 'all';
    if (params?.scope === 'month') {
      const monthSlug = params?.month || new Date().toISOString().slice(0, 7);
      a.download = `ChromaGrade_Monthly_Summary_${monthSlug}_${scopeSlug}.${format}`;
    } else {
      const dateSlug = params?.scope === 'all_dates' ? 'all_dates' : params?.date || 'today';
      a.download = `ChromaGrade_Attendance_${dateSlug}_${scopeSlug}.${format}`;
    }
    a.href = url;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  },

  getMonthlyAttendanceTrends: (
    token: string,
    params?: { month?: string; personType?: AttendancePersonType }
  ) => {
    const qs = new URLSearchParams();
    if (params?.month) qs.set('month', params.month);
    if (params?.personType) qs.set('personType', params.personType);
    const suffix = qs.toString() ? `?${qs.toString()}` : '';
    return requestJson<MonthlyAttendanceTrendsPayload>(
      `/api/attendance/monthly-trends${suffix}`,
      {},
      token
    );
  },
};
