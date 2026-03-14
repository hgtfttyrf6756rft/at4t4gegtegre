import { GoogleGenAI } from "@google/genai";
import admin from 'firebase-admin';

// Initialize Firebase Admin if not already initialized
if (!admin.apps.length) {
    let credential = undefined;

    const projectId = process.env.FIREBASE_PROJECT_ID;
    const clientEmail = process.env.FIREBASE_CLIENT_EMAIL;
    let privateKey = process.env.FIREBASE_PRIVATE_KEY;

    if (projectId && clientEmail && privateKey) {
        if (!privateKey.includes('-----BEGIN PRIVATE KEY-----')) {
            try {
                const decoded = Buffer.from(privateKey, 'base64').toString('utf8');
                if (decoded.includes('-----BEGIN PRIVATE KEY-----')) {
                    privateKey = decoded;
                }
            } catch (e) {
                console.warn('Failed to decode base64 FIREBASE_PRIVATE_KEY');
            }
        }
        privateKey = privateKey.replace(/\\n/g, '\n');

        credential = admin.credential.cert({
            projectId,
            clientEmail,
            privateKey
        });
    }

    admin.initializeApp({
        credential,
        storageBucket: process.env.FIREBASE_STORAGE_BUCKET || 'roist-7ab64.appspot.com',
    });
}

export default async function handler(req: any, res: any) {
    // Only allow POST requests for provisioning tokens
    if (req.method !== 'POST') {
        return res.status(405).json({ message: 'Method Not Allowed' });
    }

    try {
        // Authenticate the user via Firebase Auth token
        const authHeader = req.headers.authorization;
        if (!authHeader || !authHeader.startsWith('Bearer ')) {
            return res.status(401).json({ message: 'Unauthorized: Missing or invalid token' });
        }

        const idToken = authHeader.split('Bearer ')[1];
        const decodedToken = await admin.auth().verifyIdToken(idToken);

        // Ensure ONLY the designated admin can request an ephemeral token
        if (decodedToken.email !== 'contact.mngrm@gmail.com') {
            return res.status(403).json({ message: 'Forbidden: Admin access only' });
        }

        const apiKey = process.env.GEMINI_API_KEY || process.env.VITE_GEMINI_API_KEY;
        if (!apiKey) {
            console.error('GEMINI_API_KEY is not configured');
            return res.status(500).json({ message: 'Server configuration error' });
        }

        const ai = new GoogleGenAI({ apiKey });

        // Create an ephemeral token that expires in 30 minutes, 
        // valid for starting only 1 session within the next 1 minute.
        const expireTime = new Date(Date.now() + 30 * 60 * 1000).toISOString();
        const newSessionExpireTime = new Date(Date.now() + 1 * 60 * 1000).toISOString();

        const token = await (ai as any).authTokens.create({
            config: {
                uses: 5, // Allow reconnections for session resumption
                expireTime: expireTime,
                newSessionExpireTime: newSessionExpireTime,
                liveConnectConstraints: {
                    model: 'gemini-2.5-flash-native-audio-preview-12-2025',
                    config: {
                        temperature: 0.7,
                        responseModalities: ['AUDIO'],
                        sessionResumption: {},
                        contextWindowCompression: {
                            slidingWindow: {}
                        }
                    }
                },
                httpOptions: {
                    apiVersion: 'v1alpha'
                }
            }
        });

        return res.status(200).json({ token: token.name });

    } catch (error: any) {
        console.error('Error generating ephemeral token:', error);
        return res.status(500).json({ message: 'Internal Server Error', error: error.message });
    }
}
