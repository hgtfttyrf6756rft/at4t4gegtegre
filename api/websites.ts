import { getFirestore } from 'firebase-admin/firestore';
import type { VercelRequest, VercelResponse } from '@vercel/node';
import * as crypto from 'crypto';

// Helper to ensure Firebase is initialized for public access (where requireAuth isn't used)
const initFirebase = async () => {
    const { initializeApp, getApps, cert } = await import('firebase-admin/app');
    if (!getApps().length) {
        const projectId = process.env.FIREBASE_PROJECT_ID || 'ffresearchr';
        const clientEmail = process.env.FIREBASE_CLIENT_EMAIL || process.env.FIREBASE_ADMIN_CLIENT_EMAIL;
        const privateKey = (process.env.FIREBASE_PRIVATE_KEY || process.env.FIREBASE_ADMIN_PRIVATE_KEY || '').replace(/\\n/g, '\n');

        if (clientEmail && privateKey) {
            initializeApp({
                credential: cert({ projectId, clientEmail, privateKey })
            });
        }
    }
};

// Verify Firebase auth token
const verifyAuth = async (authHeader: string | string[] | undefined): Promise<string | null> => {
    if (!authHeader) return null;
    const tokenStr = Array.isArray(authHeader) ? authHeader[0] : authHeader;
    if (!tokenStr) return null;
    const idToken = tokenStr.startsWith('Bearer ') ? tokenStr.slice(7) : tokenStr;

    try {
        const { getAuth } = await import('firebase-admin/auth');
        const decoded = await getAuth().verifyIdToken(idToken);
        return decoded.uid;
    } catch {
        return null;
    }
};

export default async function handler(req: VercelRequest, res: VercelResponse) {
    // CORS configuration
    res.setHeader('Access-Control-Allow-Credentials', 'true');
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET,OPTIONS,PATCH,DELETE,POST,PUT');
    res.setHeader('Access-Control-Allow-Headers', 'X-CSRF-Token, X-Requested-With, Accept, Accept-Version, Content-Length, Content-MD5, Content-Type, Date, X-Api-Version, Authorization');

    if (req.method === 'OPTIONS') {
        return res.status(200).end();
    }

    const { op, slug, projectId, formId } = req.query;

    try {
        await initFirebase();
        const db = getFirestore();

        // ==================== WEBSITE OPERATIONS ====================

        // 1. SERVE WEBSITE (GET with op=serve OR just slug)
        // Access via: /api/websites?op=serve&slug=... (Rewrite from /w/:slug)
        if (op === 'serve' || (slug && req.method === 'GET' && !op)) {
            const targetSlug = (slug || '').toString();
            if (!targetSlug) return res.status(400).send('Missing slug');

            const doc = await db.collection('public_websites').doc(targetSlug).get();
            if (!doc.exists) return res.status(404).send('Website not found');

            const data = doc.data();

            // Support both direct HTML storage and blob URL
            let html: string;
            if (data?.html) {
                // HTML stored directly in Firestore
                html = data.html;
            } else if (data?.blobUrl) {
                // Legacy: fetch from blob storage
                const response = await fetch(data.blobUrl);
                if (!response.ok) return res.status(502).send('Failed to fetch content');
                html = await response.text();
            } else {
                return res.status(404).send('Content missing');
            }

            res.setHeader('Content-Type', 'text/html');
            res.setHeader('Cache-Control', 's-maxage=60, stale-while-revalidate=300');
            return res.status(200).send(html);
        }

        // 2. CREATE SHARE LINK (POST with op=create)
        if (op === 'create') {
            if (req.method !== 'POST') return res.status(405).json({ error: 'Method Not Allowed' });

            // Require Auth for creation
            const uid = await verifyAuth(req.headers.authorization || req.headers.Authorization);
            if (!uid) return res.status(401).json({ error: 'Unauthorized' });

            const { blobUrl, html, projectId: bodyProjectId, versionId, title, formId: bodyFormId, type } = req.body;

            // Either blobUrl or html must be provided
            if (!blobUrl && !html) return res.status(400).json({ error: 'Missing blobUrl or html' });

            const newSlug = crypto.randomBytes(4).toString('hex');

            await db.collection('public_websites').doc(newSlug).set({
                slug: newSlug,
                ...(blobUrl && { blobUrl }),
                ...(html && { html }), // Store HTML directly if provided
                projectId: bodyProjectId,
                versionId,
                title: title || 'Untitled Website',
                createdBy: uid,
                createdAt: new Date().toISOString(),
                // Optional fields for lead forms
                ...(bodyFormId && { formId: bodyFormId }),
                ...(type && { type }) // 'form' for lead forms, undefined for regular websites
            });

            return res.status(200).json({ slug: newSlug });
        }

        // 2b. UPDATE EXISTING WEBSITE (POST with op=update)
        if (op === 'update') {
            if (req.method !== 'POST') return res.status(405).json({ error: 'Method Not Allowed' });

            // Require Auth for update
            const uid = await verifyAuth(req.headers.authorization || req.headers.Authorization);
            if (!uid) return res.status(401).json({ error: 'Unauthorized' });

            const { slug: targetSlug, blobUrl, html, title, formId: bodyFormId, type } = req.body;

            if (!targetSlug) return res.status(400).json({ error: 'Missing slug' });
            if (!blobUrl && !html) return res.status(400).json({ error: 'Missing blobUrl or html' });

            // Verify the document exists and belongs to this user
            const existingDoc = await db.collection('public_websites').doc(targetSlug).get();
            if (!existingDoc.exists) return res.status(404).json({ error: 'Website not found' });

            const existingData = existingDoc.data();
            if (existingData?.createdBy !== uid) return res.status(403).json({ error: 'Forbidden' });

            // Update the document
            await db.collection('public_websites').doc(targetSlug).update({
                ...(blobUrl && { blobUrl }),
                ...(html && { html }),
                ...(title && { title }),
                ...(bodyFormId && { formId: bodyFormId }),
                ...(type && { type }),
                updatedAt: new Date().toISOString()
            });

            return res.status(200).json({ slug: targetSlug, updated: true });
        }

        // ==================== LEAD FORM OPERATIONS ====================

        // 3. SAVE FORM (POST, authenticated)
        // Save a new lead form to user's forms collection
        if (op === 'save-form' && req.method === 'POST') {
            const uid = await verifyAuth(req.headers.authorization || req.headers.Authorization);
            if (!uid) {
                return res.status(401).json({ error: 'Unauthorized' });
            }

            const { form } = req.body;
            if (!form || !form.id) {
                return res.status(400).json({ error: 'Missing form data' });
            }

            // Save form to users/{uid}/forms/{formId}
            await db.collection('users').doc(uid).collection('forms').doc(form.id).set({
                ...form,
                ownerUid: uid,
                savedAt: Date.now()
            });

            return res.status(200).json({ success: true, formId: form.id });
        }

        // 4. LIST FORMS (GET, authenticated)
        // Get all forms for the authenticated user's project
        if (op === 'list-forms' && req.method === 'GET') {
            const uid = await verifyAuth(req.headers.authorization || req.headers.Authorization);
            if (!uid) {
                return res.status(401).json({ error: 'Unauthorized' });
            }

            const targetProjectId = (projectId || '').toString();

            // Fetch forms from user's forms subcollection
            let formsSnapshot;
            if (targetProjectId) {
                // Note: Removing orderBy here to avoid needing a composite index (projectId + createdAt)
                formsSnapshot = await db.collection('users').doc(uid).collection('forms')
                    .where('projectId', '==', targetProjectId)
                    .limit(100)
                    .get();
            } else {
                formsSnapshot = await db.collection('users').doc(uid).collection('forms')
                    .orderBy('createdAt', 'desc')
                    .limit(100)
                    .get();
            }

            const forms = formsSnapshot.docs.map(doc => doc.data());

            // Sort in memory since we removed the database sort for the filtered query
            if (targetProjectId) {
                forms.sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
            }

            return res.status(200).json({ forms });
        }

        // 5. SUBMIT LEAD (POST, public - no auth required)
        // Called from public lead form websites - saves under the form
        if (op === 'submit' && req.method === 'POST') {
            const { formId: bodyFormId, slug: bodySlug, data, formTitle, projectId: bodyProjectId } = req.body;

            if (!bodyFormId || !bodySlug || !data) {
                return res.status(400).json({ error: 'Missing required fields: formId, slug, data' });
            }

            // Validate the slug exists in public_websites and get the owner
            const websiteDoc = await db.collection('public_websites').doc(bodySlug).get();
            if (!websiteDoc.exists) {
                return res.status(404).json({ error: 'Form not found' });
            }

            const websiteData = websiteDoc.data();
            const ownerUid = websiteData?.createdBy;

            if (!ownerUid) {
                return res.status(400).json({ error: 'Form owner not found' });
            }

            const leadId = `lead-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
            const leadData = {
                id: leadId,
                formId: bodyFormId,
                formTitle: formTitle || 'Lead Form',
                projectId: bodyProjectId || websiteData?.projectId || '',
                slug: bodySlug,
                data,
                submittedAt: Date.now(),
                ipAddress: req.headers['x-forwarded-for'] || req.headers['x-real-ip'] || 'unknown',
                userAgent: req.headers['user-agent'] || 'unknown',
                createdAt: new Date().toISOString()
            };

            // Save lead to users/{ownerUid}/forms/{formId}/leads/{leadId}
            await db.collection('users').doc(ownerUid).collection('forms').doc(bodyFormId).collection('leads').doc(leadId).set(leadData);

            // Also update the form's lead count
            const formRef = db.collection('users').doc(ownerUid).collection('forms').doc(bodyFormId);
            const formDoc = await formRef.get();
            if (formDoc.exists) {
                const currentCount = formDoc.data()?.leadCount || 0;
                await formRef.update({ leadCount: currentCount + 1, lastLeadAt: Date.now() });
            }

            return res.status(200).json({ success: true, leadId });
        }

        // 6. LIST LEADS (GET, authenticated)
        // Get all leads for a specific form or all leads for a project
        if ((op === 'list-leads' || op === 'get-leads') && req.method === 'GET') {
            const uid = await verifyAuth(req.headers.authorization || req.headers.Authorization);
            if (!uid) {
                return res.status(401).json({ error: 'Unauthorized' });
            }

            const targetFormId = (formId || '').toString();
            const targetProjectId = (projectId || '').toString();

            let leads: any[] = [];

            if (targetFormId) {
                // Get leads for a specific form
                const leadsSnapshot = await db.collection('users').doc(uid).collection('forms').doc(targetFormId).collection('leads')
                    .orderBy('submittedAt', 'desc')
                    .limit(500)
                    .get();
                leads = leadsSnapshot.docs.map(doc => doc.data());
            } else if (targetProjectId) {
                // Get all leads across all forms for a project
                const formsSnapshot = await db.collection('users').doc(uid).collection('forms')
                    .where('projectId', '==', targetProjectId)
                    .get();

                for (const formDoc of formsSnapshot.docs) {
                    const formLeadsSnapshot = await formDoc.ref.collection('leads')
                        .orderBy('submittedAt', 'desc')
                        .limit(100)
                        .get();
                    leads.push(...formLeadsSnapshot.docs.map(doc => doc.data()));
                }

                // Sort all leads by submittedAt
                leads.sort((a, b) => b.submittedAt - a.submittedAt);
                leads = leads.slice(0, 500);
            } else {
                return res.status(400).json({ error: 'Missing formId or projectId' });
            }

            return res.status(200).json({ leads });
        }

        // 7. DELETE LEAD (DELETE, authenticated)
        if (op === 'delete-lead' && req.method === 'DELETE') {
            const uid = await verifyAuth(req.headers.authorization || req.headers.Authorization);
            if (!uid) {
                return res.status(401).json({ error: 'Unauthorized' });
            }

            const { leadId, formId: deleteFormId } = req.body;
            if (!leadId || !deleteFormId) {
                return res.status(400).json({ error: 'Missing leadId or formId' });
            }

            // Delete the lead from the form's leads subcollection
            const leadRef = db.collection('users').doc(uid).collection('forms').doc(deleteFormId).collection('leads').doc(leadId);
            const leadDoc = await leadRef.get();

            if (!leadDoc.exists) {
                return res.status(404).json({ error: 'Lead not found' });
            }

            await leadRef.delete();

            // Update form's lead count
            const formRef = db.collection('users').doc(uid).collection('forms').doc(deleteFormId);
            const formDoc = await formRef.get();
            if (formDoc.exists) {
                const currentCount = formDoc.data()?.leadCount || 0;
                if (currentCount > 0) {
                    await formRef.update({ leadCount: currentCount - 1 });
                }
            }

            return res.status(200).json({ success: true });
        }

        // 8. DELETE FORM (DELETE, authenticated)
        if (op === 'delete-form' && req.method === 'DELETE') {
            const uid = await verifyAuth(req.headers.authorization || req.headers.Authorization);
            if (!uid) {
                return res.status(401).json({ error: 'Unauthorized' });
            }

            const { formId: deleteFormId } = req.body;
            if (!deleteFormId) {
                return res.status(400).json({ error: 'Missing formId' });
            }

            const formRef = db.collection('users').doc(uid).collection('forms').doc(deleteFormId);

            // Delete all leads in the form first
            const leadsSnapshot = await formRef.collection('leads').get();
            const batch = db.batch();
            leadsSnapshot.docs.forEach(doc => batch.delete(doc.ref));
            await batch.commit();

            // Delete the form
            await formRef.delete();

            return res.status(200).json({ success: true });
        }

        // 9. GET FORM INFO (GET, public)
        // Used by form websites to get form configuration
        if (op === 'form-info' && req.method === 'GET') {
            const targetFormId = (formId || '').toString();
            if (!targetFormId) {
                return res.status(400).json({ error: 'Missing formId' });
            }

            // Look up form in public_websites by searching for matching formId
            const websitesSnapshot = await db.collection('public_websites')
                .where('formId', '==', targetFormId)
                .where('type', '==', 'form')
                .limit(1)
                .get();

            if (websitesSnapshot.empty) {
                return res.status(404).json({ error: 'Form not found' });
            }

            const data = websitesSnapshot.docs[0].data();

            return res.status(200).json({
                formId: targetFormId,
                title: data.title || 'Lead Form',
                projectId: data.projectId
            });
        }

        // ==================== CUSTOM DOMAIN OPERATIONS ====================

        const VERCEL_API_TOKEN = process.env.VERCEL_API_TOKEN || '';
        const VERCEL_PROJECT_ID = process.env.VERCEL_PROJECT_ID || '';

        // 9.5. DOMAIN LOOKUP (GET with op=domain-lookup)
        // Used by middleware to resolve custom domain to slug
        if (op === 'domain-lookup' && req.method === 'GET') {
            const domain = (req.query.domain || '').toString();
            if (!domain) {
                return res.status(400).json({ error: 'Missing domain' });
            }

            // Query Firestore for a document with this customDomain
            try {
                const snapshot = await db
                    .collection('public_websites')
                    .where('customDomain', '==', domain)
                    .where('domainVerified', '==', true)
                    .limit(1)
                    .get();

                if (snapshot.empty) {
                    // Also try without verification check (domain might be pending)
                    const pendingSnapshot = await db
                        .collection('public_websites')
                        .where('customDomain', '==', domain)
                        .limit(1)
                        .get();

                    if (pendingSnapshot.empty) {
                        return res.status(404).json({ error: 'Domain not found' });
                    }

                    // Found pending domain
                    const docId = pendingSnapshot.docs[0].id;
                    return res.status(200).json({
                        slug: docId,
                        verified: false
                    });
                }

                // Found verified domain
                const docId = snapshot.docs[0].id;
                return res.status(200).json({
                    slug: docId,
                    verified: true
                });
            } catch (err: any) {
                console.error('Domain lookup error:', err);
                return res.status(500).json({ error: 'Domain lookup failed' });
            }
        }


        // 10. ADD CUSTOM DOMAIN (POST with op=add-domain)
        if (op === 'add-domain' && req.method === 'POST') {
            const uid = await verifyAuth(req.headers.authorization || req.headers.Authorization);
            if (!uid) return res.status(401).json({ error: 'Unauthorized' });

            if (!VERCEL_API_TOKEN || !VERCEL_PROJECT_ID) {
                return res.status(500).json({ error: 'Vercel API not configured' });
            }

            const { domain, websiteSlug } = req.body;
            if (!domain || !websiteSlug) {
                return res.status(400).json({ error: 'Missing domain or websiteSlug' });
            }

            // Validate domain format
            const domainRegex = /^(?:[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?\.)+[a-zA-Z]{2,}$/;
            if (!domainRegex.test(domain)) {
                return res.status(400).json({ error: 'Invalid domain format' });
            }

            // Verify the website exists and belongs to this user
            const websiteDoc = await db.collection('public_websites').doc(websiteSlug).get();
            if (!websiteDoc.exists) {
                return res.status(404).json({ error: 'Website not found' });
            }
            const websiteData = websiteDoc.data();
            if (websiteData?.createdBy !== uid) {
                return res.status(403).json({ error: 'Forbidden' });
            }

            // Call Vercel API to add domain
            try {
                const vercelRes = await fetch(
                    `https://api.vercel.com/v10/projects/${VERCEL_PROJECT_ID}/domains`,
                    {
                        method: 'POST',
                        headers: {
                            'Authorization': `Bearer ${VERCEL_API_TOKEN}`,
                            'Content-Type': 'application/json'
                        },
                        body: JSON.stringify({ name: domain })
                    }
                );

                const vercelData = await vercelRes.json();

                if (!vercelRes.ok) {
                    return res.status(vercelRes.status).json({
                        error: vercelData?.error?.message || 'Failed to add domain to Vercel'
                    });
                }

                // Store domain mapping in Firestore
                await db.collection('public_websites').doc(websiteSlug).update({
                    customDomain: domain,
                    domainVerified: vercelData.verified || false,
                    verificationDetails: vercelData.verification || null,
                    domainAddedAt: new Date().toISOString()
                });

                return res.status(200).json({
                    success: true,
                    domain,
                    verified: vercelData.verified || false,
                    verification: vercelData.verification || null,
                    apexName: vercelData.apexName
                });
            } catch (err: any) {
                console.error('Vercel API error:', err);
                return res.status(500).json({ error: 'Failed to add domain' });
            }
        }

        // 11. CHECK DOMAIN STATUS (GET with op=check-domain)
        if (op === 'check-domain' && req.method === 'GET') {
            const uid = await verifyAuth(req.headers.authorization || req.headers.Authorization);
            if (!uid) return res.status(401).json({ error: 'Unauthorized' });

            if (!VERCEL_API_TOKEN || !VERCEL_PROJECT_ID) {
                return res.status(500).json({ error: 'Vercel API not configured' });
            }

            const targetSlug = (slug || '').toString();
            if (!targetSlug) return res.status(400).json({ error: 'Missing slug' });

            // Get website doc
            const websiteDoc = await db.collection('public_websites').doc(targetSlug).get();
            if (!websiteDoc.exists) {
                return res.status(404).json({ error: 'Website not found' });
            }
            const websiteData = websiteDoc.data();
            if (websiteData?.createdBy !== uid) {
                return res.status(403).json({ error: 'Forbidden' });
            }

            const domain = websiteData?.customDomain;
            if (!domain) {
                return res.status(200).json({ hasDomain: false });
            }

            // Check domain status with Vercel
            try {
                const vercelRes = await fetch(
                    `https://api.vercel.com/v9/projects/${VERCEL_PROJECT_ID}/domains/${domain}`,
                    {
                        headers: {
                            'Authorization': `Bearer ${VERCEL_API_TOKEN}`
                        }
                    }
                );

                if (!vercelRes.ok) {
                    // Domain might have been removed from Vercel
                    return res.status(200).json({
                        hasDomain: true,
                        domain,
                        verified: false,
                        error: 'Domain not found in Vercel'
                    });
                }

                const vercelData = await vercelRes.json();

                // Update Firestore if verification status changed
                if (vercelData.verified !== websiteData.domainVerified) {
                    await db.collection('public_websites').doc(targetSlug).update({
                        domainVerified: vercelData.verified,
                        verificationDetails: vercelData.verification || null
                    });
                }

                return res.status(200).json({
                    hasDomain: true,
                    domain,
                    verified: vercelData.verified,
                    verification: vercelData.verification || null
                });
            } catch (err: any) {
                console.error('Vercel API error:', err);
                return res.status(500).json({ error: 'Failed to check domain status' });
            }
        }

        // 12. REMOVE CUSTOM DOMAIN (DELETE with op=remove-domain)
        // Follows Vercel best practice: remove from project AND platform
        if (op === 'remove-domain' && req.method === 'DELETE') {
            const uid = await verifyAuth(req.headers.authorization || req.headers.Authorization);
            if (!uid) return res.status(401).json({ error: 'Unauthorized' });

            if (!VERCEL_API_TOKEN || !VERCEL_PROJECT_ID) {
                return res.status(500).json({ error: 'Vercel API not configured' });
            }

            const { domain, websiteSlug } = req.body;
            if (!domain || !websiteSlug) {
                return res.status(400).json({ error: 'Missing domain or websiteSlug' });
            }

            // Verify the website exists and belongs to this user
            const websiteDoc = await db.collection('public_websites').doc(websiteSlug).get();
            if (!websiteDoc.exists) {
                return res.status(404).json({ error: 'Website not found' });
            }
            const websiteData = websiteDoc.data();
            if (websiteData?.createdBy !== uid) {
                return res.status(403).json({ error: 'Forbidden' });
            }

            try {
                // Step 1: Remove domain from project
                const projectRemoveRes = await fetch(
                    `https://api.vercel.com/v9/projects/${VERCEL_PROJECT_ID}/domains/${domain}`,
                    {
                        method: 'DELETE',
                        headers: {
                            'Authorization': `Bearer ${VERCEL_API_TOKEN}`
                        }
                    }
                );

                if (!projectRemoveRes.ok && projectRemoveRes.status !== 404) {
                    console.warn('Vercel project domain removal warning:', await projectRemoveRes.json());
                }

                // Step 2: Also remove domain from Vercel platform (complete cleanup)
                const platformRemoveRes = await fetch(
                    `https://api.vercel.com/v6/domains/${domain}`,
                    {
                        method: 'DELETE',
                        headers: {
                            'Authorization': `Bearer ${VERCEL_API_TOKEN}`
                        }
                    }
                );

                if (!platformRemoveRes.ok && platformRemoveRes.status !== 404) {
                    // This is expected if domain was added externally, log but don't fail
                    console.warn('Vercel platform domain removal info:', platformRemoveRes.status);
                }

                // Step 3: Remove domain from Firestore
                await db.collection('public_websites').doc(websiteSlug).update({
                    customDomain: null,
                    domainVerified: null,
                    verificationDetails: null,
                    domainAddedAt: null
                });

                return res.status(200).json({ success: true });
            } catch (err: any) {
                console.error('Vercel API error:', err);
                return res.status(500).json({ error: 'Failed to remove domain' });
            }
        }

        // 13. VERIFY DOMAIN (POST with op=verify-domain)
        // Explicitly trigger domain verification check with Vercel
        if (op === 'verify-domain' && req.method === 'POST') {
            const uid = await verifyAuth(req.headers.authorization || req.headers.Authorization);
            if (!uid) return res.status(401).json({ error: 'Unauthorized' });

            if (!VERCEL_API_TOKEN || !VERCEL_PROJECT_ID) {
                return res.status(500).json({ error: 'Vercel API not configured' });
            }

            const { domain, websiteSlug } = req.body;
            if (!domain || !websiteSlug) {
                return res.status(400).json({ error: 'Missing domain or websiteSlug' });
            }

            // Verify the website exists and belongs to this user
            const websiteDoc = await db.collection('public_websites').doc(websiteSlug).get();
            if (!websiteDoc.exists) {
                return res.status(404).json({ error: 'Website not found' });
            }
            const websiteData = websiteDoc.data();
            if (websiteData?.createdBy !== uid) {
                return res.status(403).json({ error: 'Forbidden' });
            }

            try {
                // Call Vercel verify endpoint to trigger verification check
                const verifyRes = await fetch(
                    `https://api.vercel.com/v9/projects/${VERCEL_PROJECT_ID}/domains/${domain}/verify`,
                    {
                        method: 'POST',
                        headers: {
                            'Authorization': `Bearer ${VERCEL_API_TOKEN}`
                        }
                    }
                );

                const verifyData = await verifyRes.json();

                // Update Firestore with latest verification status
                await db.collection('public_websites').doc(websiteSlug).update({
                    domainVerified: verifyData.verified || false,
                    verificationDetails: verifyData.verification || null
                });

                return res.status(200).json({
                    verified: verifyData.verified || false,
                    verification: verifyData.verification || null,
                    domain
                });
            } catch (err: any) {
                console.error('Vercel API error:', err);
                return res.status(500).json({ error: 'Failed to verify domain' });
            }
        }

        return res.status(400).json({ error: 'Invalid operation' });

    } catch (error: any) {
        console.error('Websites API Error:', error);
        return res.status(500).json({ error: 'Internal Server Error' });
    }
}
