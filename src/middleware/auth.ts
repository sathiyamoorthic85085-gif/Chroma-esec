import type { NextFunction, Request, Response } from 'express';
import { getUserBySessionToken, syncFirebaseUserToDb } from '../db/repository.ts';
import { adminAuth } from '../lib/firebase-admin.ts';
import type { UserProfile, UserRole } from '../types.ts';

export interface AuthenticatedRequest extends Request {
  user?: UserProfile;
  sessionToken?: string;
}

export function extractBearerToken(req: Request): string | null {
  const auth = req.headers.authorization;
  if (!auth || !auth.startsWith('Bearer ')) return null;
  const token = auth.slice(7).trim();
  return token.length > 0 ? token : null;
}

export async function resolveUserFromToken(token: string): Promise<UserProfile | null> {
  // 1. Check PostgreSQL session tokens (credential-based login)
  const sessionUser = await getUserBySessionToken(token);
  if (sessionUser) return sessionUser;

  // 2. Verify Firebase Auth ID Token (Google Sign-In)
  try {
    const decoded = await adminAuth.verifyIdToken(token);
    if (!decoded.email) return null;
    const synced = await syncFirebaseUserToDb({
      uid: decoded.uid,
      email: decoded.email,
      displayName: decoded.name || decoded.email.split('@')[0],
    });
    return synced;
  } catch {
    return null;
  }
}

export async function requireAuth(
  req: AuthenticatedRequest,
  res: Response,
  next: NextFunction
): Promise<void> {
  const token = extractBearerToken(req);
  if (!token) {
    res.status(401).json({ error: 'Authentication required.' });
    return;
  }

  try {
    const user = await resolveUserFromToken(token);
    if (!user) {
      res.status(401).json({ error: 'Session expired or invalid. Please sign in again.' });
      return;
    }

    if (user.status !== 'approved') {
      res.status(403).json({
        error:
          user.status === 'pending'
            ? 'Your account is awaiting HOD approval. You will receive an email intimation once approved.'
            : 'Your account access was declined by the HOD.',
        accountStatus: user.status,
      });
      return;
    }

    req.user = user;
    req.sessionToken = token;
    next();
  } catch (error) {
    console.error('Auth verification error:', error);
    res.status(500).json({ error: 'Unable to verify authentication.' });
  }
}

export function requireRoles(...roles: UserRole[]) {
  return (req: AuthenticatedRequest, res: Response, next: NextFunction): void => {
    if (!req.user) {
      res.status(401).json({ error: 'Authentication required.' });
      return;
    }
    if (!roles.includes(req.user.role)) {
      res.status(403).json({ error: 'You do not have permission for this module.' });
      return;
    }
    next();
  };
}
