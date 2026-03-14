
import React, { useEffect, useState } from 'react';

// Types for Google Picker API
declare global {
    interface Window {
        gapi: any;
        google: any;
    }
}

interface GooglePickerButtonProps {
    clientId: string;
    apiKey: string;
    appId?: string; // Cloud project number (optional but recommended)
    onFileSelected?: (file: { id: string; name: string; url: string; mimeType: string }, accessToken: string) => void;
    onFilesSelected?: (files: Array<{ id: string; name: string; url: string; mimeType: string }>, accessToken: string) => void;
    onError?: (error: any) => void;
    allowedMimeTypes?: string; // e.g., 'image/png,application/pdf'
    viewId?: string; // 'DOCS' | 'SPREADSHEETS' | 'DOCUMENTS' | 'DOCS_IMAGES' | 'DOCS_VIDEOS'
    multiselect?: boolean;
    label?: string;
    className?: string;
    disabled?: boolean;
    children?: React.ReactNode;
}

export const GooglePickerButton: React.FC<GooglePickerButtonProps> = ({
    clientId,
    apiKey,
    appId,
    onFileSelected,
    onFilesSelected,
    onError,
    allowedMimeTypes,
    viewId = 'DOCS',
    multiselect = false,
    label = 'Select from Google Drive',
    className = 'px-4 py-2 bg-blue-600 text-white rounded hover:bg-blue-700 transition-colors flex items-center gap-2',
    disabled = false,
    children,
}) => {
    const [pickerInited, setPickerInited] = useState(false);
    const [gisInited, setGisInited] = useState(false);
    const [tokenClient, setTokenClient] = useState<any>(null);
    const [accessToken, setAccessToken] = useState<string | null>(null);

    // Load Google API scripts
    useEffect(() => {
        const loadGapi = () => {
            if (window.google?.picker) {
                onPickerApiLoad();
                return;
            }

            if (window.gapi) {
                window.gapi.load('picker', onPickerApiLoad);
            } else {
                const existing = document.querySelector('script[src="https://apis.google.com/js/api.js"]');
                if (existing) {
                    existing.addEventListener('load', () => window.gapi.load('picker', onPickerApiLoad));
                    return;
                }
                const script = document.createElement('script');
                script.src = 'https://apis.google.com/js/api.js';
                script.async = true;
                script.defer = true;
                script.onload = () => window.gapi.load('picker', onPickerApiLoad);
                document.body.appendChild(script);
            }
        };

        const loadGis = () => {
            if (window.google?.accounts?.oauth2) {
                onGisLoaded();
            } else {
                const existing = document.querySelector('script[src="https://accounts.google.com/gsi/client"]');
                if (existing) {
                    existing.addEventListener('load', onGisLoaded);
                    return;
                }
                const script = document.createElement('script');
                script.src = 'https://accounts.google.com/gsi/client';
                script.async = true;
                script.defer = true;
                script.onload = onGisLoaded;
                document.body.appendChild(script);
            }
        };

        loadGapi();
        loadGis();
    }, []);

    const onPickerApiLoad = () => {
        setPickerInited(true);
    };

    // Load token from storage on mount
    useEffect(() => {
        const storedToken = localStorage.getItem('google_drive_access_token');
        const storedExpiry = localStorage.getItem('google_drive_token_expiry');

        if (storedToken && storedExpiry) {
            const now = Date.now();
            if (now < parseInt(storedExpiry)) {
                console.log('Restoring cached Google Drive token');
                setAccessToken(storedToken);
            } else {
                console.log('Cached Google Drive token expired');
                localStorage.removeItem('google_drive_access_token');
                localStorage.removeItem('google_drive_token_expiry');
            }
        }
    }, []);

    const onGisLoaded = () => {
        try {
            if (!window.google?.accounts?.oauth2) return;

            const client = window.google.accounts.oauth2.initTokenClient({
                client_id: clientId,
                scope: 'https://www.googleapis.com/auth/drive.file',
                callback: (response: any) => {
                    if (response.error !== undefined) {
                        console.error('GIS Error:', response);
                        onError?.(response);
                        return;
                    }
                    const token = response.access_token;
                    const expiresIn = response.expires_in || 3599; // Default 1h
                    const expiryTime = Date.now() + (expiresIn * 1000);

                    console.log(`Token acquired, expires in ${expiresIn}s`);
                    setAccessToken(token);

                    // Persist to localStorage
                    localStorage.setItem('google_drive_access_token', token);
                    localStorage.setItem('google_drive_token_expiry', expiryTime.toString());

                    createPicker(token);
                },
            });
            setTokenClient(client);
            setGisInited(true);
        } catch (err) {
            console.error('GIS Init Error:', err);
            onError?.(err);
        }
    };

    const handleAuthClick = () => {
        // If we already have a valid access token, just open the picker directly
        if (accessToken) {
            createPicker(accessToken);
            return;
        }

        if (!tokenClient) return;

        // No token or expired -> Request new one
        tokenClient.requestAccessToken({ prompt: '' });
    };

    const createPicker = (token: string) => {
        // Check global namespace directly to avoid stale closure state issues
        const isPickerLoaded = !!(window.google && window.google.picker);

        // If the Picker API is not loaded but gapi exists, try to load it now
        if (!isPickerLoaded && window.gapi && window.gapi.load) {
            console.log('Picker API not loaded yet, attempting to load now...');
            window.gapi.load('picker', () => {
                console.log('Picker API loaded on-demand');
                setPickerInited(true);
                // Recursively call createPicker with the token - now safe because global check will pass
                createPicker(token);
            });
            return;
        }

        if (!isPickerLoaded) {
            console.error('Google Picker API not loaded yet (gapi missing or load failed)');
            onError?.(new Error('Google Picker API not loaded yet. Please refresh and try again.'));
            return;
        }
        if (!token) {
            console.error('No access token provided');
            return;
        }
        if (!apiKey) {
            console.error('No API Key provided');
            onError?.(new Error('No API Key provided'));
            return;
        }

        console.log('Building Picker with API Key:', apiKey.substring(0, 8) + '...', 'Origin:', window.location.origin, 'AppId:', appId);

        if (!appId) {
            console.warn('Google Picker: AppId (Project Number) is missing. drive.file scope grants may fail.');
        } else if (!/^\d+$/.test(appId)) {
            console.error('Google Picker: AppId must be a numeric string (Project Number), but got:', appId, '. drive.file grants WILL fail.');
        }

        try {
            const googleViewId = window.google.picker.ViewId[viewId] || window.google.picker.ViewId.DOCS;

            const view = new window.google.picker.DocsView(googleViewId);

            // With drive.file scope, must use LIST mode (no thumbnails available)
            if (window.google.picker.DocsViewMode?.LIST) {
                view.setMode(window.google.picker.DocsViewMode.LIST);
            }

            if (allowedMimeTypes) {
                view.setMimeTypes(allowedMimeTypes);
            }

            const pickerCallback = async (data: any) => {
                if (data.action === window.google.picker.Action.PICKED) {
                    const docs = data.docs;

                    if (onFilesSelected) {
                        const selectedFiles = docs.map((doc: any) => ({
                            id: doc[window.google.picker.Document.ID],
                            name: doc[window.google.picker.Document.NAME],
                            url: doc[window.google.picker.Document.URL],
                            mimeType: doc[window.google.picker.Document.MIME_TYPE],
                        }));
                        console.log('Picker selected files (batch):', selectedFiles.length, 'AppId used:', appId);
                        onFilesSelected(selectedFiles, token);
                    } else {
                        // Legacy single-file callback (iterated)
                        for (const doc of docs) {
                            const fileId = doc[window.google.picker.Document.ID];
                            const fileName = doc[window.google.picker.Document.NAME];
                            const fileUrl = doc[window.google.picker.Document.URL];
                            const mimeType = doc[window.google.picker.Document.MIME_TYPE];

                            console.log('Picker selected file:', fileId, 'AppId used:', appId);

                            onFileSelected?.({
                                id: fileId,
                                name: fileName,
                                url: fileUrl,
                                mimeType: mimeType,
                            }, token);
                        }
                    }
                }
            };

            const pickerBuilder = new window.google.picker.PickerBuilder()
                .setOAuthToken(token)
                .setDeveloperKey(apiKey)
                .addView(view)
                .setCallback(pickerCallback);

            if (appId) {
                pickerBuilder.setAppId(appId);
            }

            if (multiselect) {
                pickerBuilder.enableFeature(window.google.picker.Feature.MULTISELECT_ENABLED);
            }

            const picker = pickerBuilder.build();
            picker.setVisible(true);
        } catch (err) {
            console.error('Create Picker Error:', err);
            onError?.(err);
        }
    };



    const isReady = pickerInited && gisInited;

    return (
        <button
            type="button"
            onClick={handleAuthClick}
            disabled={disabled || !isReady}
            className={className}
        >
            {children || (
                <>
                    {/* Google Drive Icon */}
                    <svg className="w-4 h-4" viewBox="0 0 87.3 78" xmlns="http://www.w3.org/2000/svg">
                        <path d="m6.6 66.85 3.85 6.65c.8 1.4 1.95 2.5 3.3 3.3l13.75-23.8h-27.5c0 1.55.4 3.1 1.2 4.5z" fill="#0066da" />
                        <path d="m43.65 25-13.75-23.8c-1.35.8-2.5 1.9-3.3 3.3l-25.4 44a9.06 9.06 0 0 0 -1.2 4.5h27.5z" fill="#00ac47" />
                        <path d="m73.55 76.8c1.35-.8 2.5-1.9 3.3-3.3l1.6-2.75 7.65-13.25c.8-1.4 1.2-2.95 1.2-4.5h-27.502l5.852 11.5z" fill="#ea4335" />
                        <path d="m43.65 25 13.75-23.8c-1.35-.8-2.9-1.2-4.5-1.2h-18.5c-1.6 0-3.15.45-4.5 1.2z" fill="#00832d" />
                        <path d="m59.8 53h-32.3l-13.75 23.8c1.35.8 2.9 1.2 4.5 1.2h50.8c1.6 0 3.15-.45 4.5-1.2z" fill="#2684fc" />
                        <path d="m73.4 26.5-12.75 22h13.75l12.75-22h-13.75z" fill="#ffba00" />
                    </svg>
                    <span>{label}</span>
                </>
            )}
        </button>
    );
};
