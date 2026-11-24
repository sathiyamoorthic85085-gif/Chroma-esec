import nodemailer from 'nodemailer';
import type { UserRole } from '../src/types.ts';
import { ROLE_LABELS } from '../src/types.ts';

export interface ApprovalEmailParams {
  recipientEmail: string;
  recipientName: string;
  role: UserRole;
  department: string;
  staffOrRollId: string;
  approvedByName: string;
  portalUrl: string;
}

export interface EmailDispatchResult {
  subject: string;
  body: string;
  deliveryStatus: 'sent_smtp' | 'recorded_in_portal';
  deliveryDetail: string;
}

export async function dispatchApprovalIntimationEmail(
  params: ApprovalEmailParams
): Promise<EmailDispatchResult> {
  const roleLabel = ROLE_LABELS[params.role] || params.role;
  const subject = `ChromaGrade Access Approved — Sign In With Your Registered Credentials`;
  const body = [
    `Dear ${params.recipientName},`,
    ``,
    `Your ChromaGrade portal registration for the ${params.department} department has been approved by ${params.approvedByName} (Head of Department).`,
    ``,
    `Account Details:`,
    `• Registered Email: ${params.recipientEmail}`,
    `• Assigned Role: ${roleLabel}`,
    `• Department: ${params.department}`,
    params.staffOrRollId ? `• ID / Register Number: ${params.staffOrRollId}` : null,
    ``,
    `You may now enter the ChromaGrade application using the email address and password you created during registration.`,
    params.portalUrl ? `Portal URL: ${params.portalUrl}` : null,
    ``,
    `Regards,`,
    `ChromaGrade Academic Administration`,
  ]
    .filter((line): line is string => line !== null)
    .join('\n');

  const smtpHost = process.env.SMTP_HOST?.trim();
  const smtpUser = process.env.SMTP_USER?.trim();
  const smtpPass = process.env.SMTP_PASS?.trim();
  const smtpPort = Number(process.env.SMTP_PORT || 587);
  const smtpFrom = process.env.SMTP_FROM?.trim() || smtpUser || 'no-reply@chromagrade.edu';

  if (smtpHost && smtpUser && smtpPass) {
    try {
      const transporter = nodemailer.createTransport({
        host: smtpHost,
        port: Number.isFinite(smtpPort) ? smtpPort : 587,
        secure: smtpPort === 465,
        auth: {
          user: smtpUser,
          pass: smtpPass,
        },
      });

      const info = await transporter.sendMail({
        from: smtpFrom,
        to: params.recipientEmail,
        subject,
        text: body,
      });

      return {
        subject,
        body,
        deliveryStatus: 'sent_smtp',
        deliveryDetail: `Delivered via SMTP (${info.messageId})`,
      };
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'SMTP error';
      return {
        subject,
        body,
        deliveryStatus: 'recorded_in_portal',
        deliveryDetail: `Recorded in portal outbox (SMTP fallback: ${msg})`,
      };
    }
  }

  return {
    subject,
    body,
    deliveryStatus: 'recorded_in_portal',
    deliveryDetail: 'Recorded in portal intimation ledger (configure SMTP_* env vars for external email relay)',
  };
}
