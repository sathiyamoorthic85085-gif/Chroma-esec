import fs from 'fs';
import path from 'path';
import { getApp, getApps, initializeApp } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';

const firebaseConfigPath = path.resolve(process.cwd(), 'firebase-applet-config.json');
const firebaseConfig = JSON.parse(fs.readFileSync(firebaseConfigPath, 'utf8')) as {
  projectId: string;
};

const adminApp = getApps().length
  ? getApp()
  : initializeApp({
      projectId: firebaseConfig.projectId,
    });

export const adminAuth = getAuth(adminApp);
