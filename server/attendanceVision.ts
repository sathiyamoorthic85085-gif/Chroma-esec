import { GoogleGenAI, Type } from '@google/genai';

export interface DualCameraVerificationResult {
  faceDetected: boolean;
  faceConfidence: number;
  spoofSuspected: boolean;
  environmentVerified: boolean;
  environmentLabel: string;
  approvedForAttendance: boolean;
  summary: string;
}

let cachedClient: GoogleGenAI | null = null;

function getGeminiClient(): GoogleGenAI {
  const apiKey = process.env.GEMINI_API_KEY?.trim();
  if (!apiKey) {
    throw new Error(
      'GEMINI_API_KEY is not configured on the server. Set it in Settings > Secrets to enable live camera attendance detection.'
    );
  }
  if (!cachedClient) {
    cachedClient = new GoogleGenAI({
      apiKey,
      httpOptions: {
        headers: {
          'User-Agent': 'aistudio-build',
        },
      },
    });
  }
  return cachedClient;
}

function stripDataUrl(dataUrl: string): { mimeType: string; data: string } {
  const match = /^data:(image\/(?:jpeg|jpg|png|webp));base64,([A-Za-z0-9+/=\s]+)$/i.exec(
    dataUrl.trim()
  );
  if (!match) {
    throw new Error('Captured camera images must be valid base64 JPEG, PNG, or WebP frames.');
  }
  const mimeType = match[1].toLowerCase() === 'image/jpg' ? 'image/jpeg' : match[1].toLowerCase();
  const data = match[2].replace(/\s+/g, '');
  if (data.length < 200) {
    throw new Error('Captured camera frame is empty or too small.');
  }
  return { mimeType, data };
}

export async function verifyDualCameraAttendance(params: {
  faceImageData: string;
  environmentImageData: string;
  registeredFaceImageData?: string | null;
  registeredEnvironmentImageData?: string | null;
  geofenceSummary?: string;
  personType: 'student' | 'faculty';
  personName: string;
  subjectName: string;
  roomNo: string;
}): Promise<DualCameraVerificationResult> {
  const faceImg = stripDataUrl(params.faceImageData);
  const envImg = stripDataUrl(params.environmentImageData);
  const regFaceImg = params.registeredFaceImageData
    ? (() => {
        try {
          return stripDataUrl(params.registeredFaceImageData);
        } catch {
          return null;
        }
      })()
    : null;
  const regEnvImg = params.registeredEnvironmentImageData
    ? (() => {
        try {
          return stripDataUrl(params.registeredEnvironmentImageData);
        } catch {
          return null;
        }
      })()
    : null;

  const ai = getGeminiClient();

  const parts: Array<
    { inlineData: { mimeType: string; data: string } } | { text: string }
  > = [
    { inlineData: { mimeType: faceImg.mimeType, data: faceImg.data } },
    { inlineData: { mimeType: envImg.mimeType, data: envImg.data } },
  ];

  const promptLines = [
    `You are an academic attendance verification vision inspector for ChromaGrade.`,
    `Inspect the LIVE camera photos provided:`,
    `1) FIRST IMAGE (Live Face Capture): Must clearly show a live human face of the ${params.personType} (${params.personName}). Check if a real human face is visible, clearly framed, and NOT a photo of another phone/monitor screen or blank wall.`,
    `2) SECOND IMAGE (Live Work/Classroom Environment Capture): Must show a real surrounding classroom, laboratory, lecture hall, office, desk, whiteboard, computer workstation, or institutional study/work environment (expected context: ${params.subjectName} · Room ${params.roomNo || 'Campus'}).`,
  ];

  if (regFaceImg) {
    parts.push({ inlineData: { mimeType: regFaceImg.mimeType, data: regFaceImg.data } });
    promptLines.push(
      `3) REGISTERED FACE BASELINE (Image ${parts.length}): Compare the Live Face Capture (Image 1) against this student's registered enrollment face photo. Reject if it clearly appears to be a completely different person.`
    );
  }

  if (regEnvImg) {
    parts.push({ inlineData: { mimeType: regEnvImg.mimeType, data: regEnvImg.data } });
    promptLines.push(
      `4) REGISTERED CLASSROOM ENVIRONMENT BASELINE (Image ${parts.length}): Compare the Live Environment Capture (Image 2) against the student's registered classroom environment at the HOD-pinned campus location. Confirm it is a genuine matching classroom/academic space.`
    );
  }

  if (params.geofenceSummary) {
    promptLines.push(`GPS Geofence Context: ${params.geofenceSummary}`);
  }

  promptLines.push(
    `Return strict JSON matching the schema.`,
    `Set approvedForAttendance = true ONLY if faceDetected is true, spoofSuspected is false, and environmentVerified is true (and identity/environment matches registered baselines when provided).`,
    `Keep summary under 25 words in plain, factual language.`
  );

  parts.push({ text: promptLines.join('\n') });

  const response = await ai.models.generateContent({
    model: 'gemini-4-hydrogen',
    contents: {
      parts,
    },
    config: {
      responseMimeType: 'application/json',
      responseSchema: {
        type: Type.OBJECT,
        properties: {
          faceDetected: {
            type: Type.BOOLEAN,
            description: 'True if a clear human face is visible in Image 1 (and matches registered face when provided).',
          },
          faceConfidence: {
            type: Type.INTEGER,
            description: 'Confidence score 0-100 for face presence and identity clarity.',
          },
          spoofSuspected: {
            type: Type.BOOLEAN,
            description: 'True if Image 1 appears to be a photo of a screen, printed picture, or occluded.',
          },
          environmentVerified: {
            type: Type.BOOLEAN,
            description: 'True if Image 2 clearly shows a classroom, lab, desk, office, or academic work environment.',
          },
          environmentLabel: {
            type: Type.STRING,
            description: 'Short label describing the detected work environment in Image 2.',
          },
          approvedForAttendance: {
            type: Type.BOOLEAN,
            description: 'True only when both live face and work environment checks pass.',
          },
          summary: {
            type: Type.STRING,
            description: 'Concise factual verification note.',
          },
        },
        required: [
          'faceDetected',
          'faceConfidence',
          'spoofSuspected',
          'environmentVerified',
          'environmentLabel',
          'approvedForAttendance',
          'summary',
        ],
      },
    },
  });

  const rawText = (response.text ?? '').trim();
  if (!rawText) {
    throw new Error('Vision verification returned an empty response.');
  }

  const parsed = JSON.parse(rawText) as DualCameraVerificationResult;
  const faceConfidence = Math.max(0, Math.min(100, Math.round(Number(parsed.faceConfidence) || 0)));
  const approved = Boolean(
    parsed.faceDetected && !parsed.spoofSuspected && parsed.environmentVerified
  );

  return {
    faceDetected: Boolean(parsed.faceDetected),
    faceConfidence,
    spoofSuspected: Boolean(parsed.spoofSuspected),
    environmentVerified: Boolean(parsed.environmentVerified),
    environmentLabel: String(parsed.environmentLabel || 'Academic Environment').slice(0, 80),
    approvedForAttendance: approved,
    summary: String(
      parsed.summary ||
        (approved
          ? 'Live face and academic work environment verified.'
          : 'Live face or work environment verification did not pass.')
    ).slice(0, 220),
  };
}
