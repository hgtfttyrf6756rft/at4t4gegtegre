import { useState, useEffect, useCallback, useRef } from 'react';
import { authFetch } from '../services/authFetch';
import { auth } from '../services/firebase';

export function useSocialConnections() {
    // LinkedIn
    const [linkedinConnected, setLinkedinConnected] = useState(false);
    const [linkedinProfile, setLinkedinProfile] = useState<any>(null);

    // X (Twitter)
    const [xConnected, setXConnected] = useState(false);
    const [xProfile, setXProfile] = useState<any>(null);

    // TikTok
    const [tiktokConnected, setTiktokConnected] = useState(false);
    const [tiktokCreatorInfo, setTiktokCreatorInfo] = useState<any>(null);
    const tiktokTokensRef = useRef<{ accessToken: string, refreshToken: string } | null>(null);

    // YouTube
    const [youtubeConnected, setYoutubeConnected] = useState(false);
    const [youtubeChannel, setYoutubeChannel] = useState<any>(null);

    // Facebook / Instagram
    const [facebookConnected, setFacebookConnected] = useState(false);
    const [facebookProfile, setFacebookProfile] = useState<any>(null);
    const [facebookStatusLoading, setFacebookStatusLoading] = useState(false);
    const facebookAccessTokenRef = useRef<string | null>(null);

    // Instagram Accounts (dynamically loaded after FB connect)
    const [igAccounts, setIgAccounts] = useState<any[]>([]);
    const [selectedIgId, setSelectedIgId] = useState<string>('');

    // Load TikTok stored tokens
    const loadStoredTiktokTokens = useCallback(async () => {
        try {
            const res = await authFetch('/api/social?op=tiktok-tokens-get', { method: 'GET' });
            if (res.ok) {
                const data = await res.json();
                if (data.accessToken && data.refreshToken) {
                    tiktokTokensRef.current = { accessToken: data.accessToken, refreshToken: data.refreshToken };
                    setTiktokConnected(true);
                    return true;
                }
            }
        } catch (e) {
            console.error('Failed to load stored TikTok tokens:', e);
        }
        setTiktokConnected(false);
        tiktokTokensRef.current = null;
        return false;
    }, []);

    const loadTiktokCreatorInfo = useCallback(async () => {
        if (!tiktokTokensRef.current?.accessToken) return;
        try {
            const res = await authFetch('/api/social?op=tiktok-creator-info', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ accessToken: tiktokTokensRef.current.accessToken }),
            });

            const data = await res.json().catch(() => ({}));
            if (!res.ok) {
                console.error('Failed to load TikTok creator info:', data?.error || res.statusText);
                setTiktokCreatorInfo(null);
                return;
            }

            // API returns the creator info object directly
            setTiktokCreatorInfo(data || null);
        } catch (e) {
            console.error('Failed to load TikTok creator info:', e);
            setTiktokCreatorInfo(null);
        }
    }, []);

    // Load FB stored tokens
    const loadStoredFacebookTokens = useCallback(async () => {
        try {
            const res = await authFetch('/api/social?op=fb-tokens-get', { method: 'GET' });
            if (res.ok) {
                const data = await res.json();
                if (data.accessToken) {
                    facebookAccessTokenRef.current = data.accessToken;
                    return true;
                }
            }
        } catch (e) {
            console.error('Failed to load stored FB tokens:', e);
        }
        facebookAccessTokenRef.current = null;
        return false;
    }, []);

    const refreshFacebookStatus = useCallback(async (manualResponse?: any) => {
        setFacebookStatusLoading(true);
        try {
            const FB = (window as any).FB;
            if (!FB) {
                setFacebookConnected(false);
                setFacebookProfile(null);
                facebookAccessTokenRef.current = null;
                return false;
            }

            const status = manualResponse || await new Promise<any>((resolve) => {
                FB.getLoginStatus((resp: any) => resolve(resp), true);
            });

            if (!manualResponse && status?.status === 'unknown' && window.location.protocol === 'http:' && facebookAccessTokenRef.current) {
                return true;
            }

            const isConnected = status?.status === 'connected' && Boolean(status?.authResponse?.accessToken);

            if (isConnected) {
                setFacebookConnected(true);
                facebookAccessTokenRef.current = status.authResponse.accessToken;
            } else {
                if (facebookAccessTokenRef.current) {
                    try {
                        const me = await new Promise<any>((resolve, reject) => {
                            FB.api('/me', { fields: 'name,email,picture', access_token: facebookAccessTokenRef.current }, (resp: any) => {
                                if (!resp || resp.error) reject(new Error(resp?.error?.message || 'Token invalid'));
                                else resolve(resp);
                            });
                        });
                        setFacebookConnected(true);
                        setFacebookProfile(me);
                        return true;
                    } catch (valErr) {
                        console.warn('[FB] Stored token invalidated:', valErr);
                        setFacebookConnected(false);
                        setFacebookProfile(null);
                        facebookAccessTokenRef.current = null;
                        return false;
                    }
                }
                setFacebookConnected(false);
                setFacebookProfile(null);
                facebookAccessTokenRef.current = null;
                return false;
            }

            const me = await new Promise<any>((resolve, reject) => {
                FB.api('/me', { fields: 'name,email,picture' }, (resp: any) => {
                    if (!resp || resp.error) reject(new Error(resp?.error?.message || 'Failed'));
                    else resolve(resp);
                });
            });

            setFacebookProfile(me);
            return true;
        } catch (e) {
            setFacebookConnected(false);
            setFacebookProfile(null);
            facebookAccessTokenRef.current = null;
            return false;
        } finally {
            setFacebookStatusLoading(false);
        }
    }, []);

    const checkLinkedinStatus = useCallback(async () => {
        try {
            const res = await authFetch('/api/social?op=linkedin-status');
            const data = await res.json().catch(() => ({}));
            setLinkedinConnected(!!data.connected);
            setLinkedinProfile(data.profile || null);
        } catch (e) {
            setLinkedinConnected(false);
            setLinkedinProfile(null);
        }
    }, []);

    const checkXStatus = useCallback(async () => {
        try {
            const res = await authFetch('/api/social?op=x-status');
            if (res.ok) {
                const data = await res.json();
                setXConnected(data.connected);
                if (data.profile) setXProfile(data.profile);
            }
        } catch (e) {
            setXConnected(false);
            setXProfile(null);
        }
    }, []);

    const checkYoutubeStatus = useCallback(async () => {
        try {
            const res = await authFetch('/api/google?op=youtube-status');
            const data = await res.json().catch(() => ({}));
            if (data.connected) {
                setYoutubeConnected(true);
                setYoutubeChannel(data.channel || null);
            } else {
                setYoutubeConnected(false);
                setYoutubeChannel(null);
            }
        } catch (e) {
            setYoutubeConnected(false);
            setYoutubeChannel(null);
        }
    }, []);

    const loadInstagramAccounts = useCallback(async () => {
        try {
            const fbUserAccessToken = facebookAccessTokenRef.current;
            if (!fbUserAccessToken) throw new Error('Facebook is not connected.');

            const res = await authFetch('/api/social?op=ig-accounts', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ fbUserAccessToken }),
            });
            const data = await res.json().catch(() => ({}));
            const accounts = Array.isArray(data?.accounts) ? data.accounts : [];
            setIgAccounts(accounts);
            if (!selectedIgId && accounts.length) {
                setSelectedIgId(String(accounts[0].igId));
            }
            return accounts;
        } catch (e) {
            console.error('Error loading IG accounts:', e);
            setIgAccounts([]);
            return [];
        }
    }, [selectedIgId]);

    // Initial load
    useEffect(() => {
        checkLinkedinStatus();
        checkXStatus();
        checkYoutubeStatus();

        loadStoredTiktokTokens().then(hasTokens => {
            if (hasTokens) loadTiktokCreatorInfo();
        });

        loadStoredFacebookTokens().then(hasToken => {
            refreshFacebookStatus().then(connected => {
                if (connected) {
                    loadInstagramAccounts();
                }
            });
        });
    }, [checkLinkedinStatus, checkXStatus, checkYoutubeStatus, loadStoredTiktokTokens, loadTiktokCreatorInfo, loadStoredFacebookTokens, refreshFacebookStatus, loadInstagramAccounts]);

    // Listen to oauth window messages
    useEffect(() => {
        const handleMessage = (event: MessageEvent) => {
            if (event.origin !== window.location.origin) return;
            if (event.data?.type === 'youtube:connected') checkYoutubeStatus();
            if (event.data?.type === 'x:connected') checkXStatus();
            if (event.data?.type === 'linkedin:connected') checkLinkedinStatus();
            if (event.data?.type === 'tiktok:connected') {
                loadStoredTiktokTokens().then(hasTokens => {
                    if (hasTokens) loadTiktokCreatorInfo();
                });
            }
            if (event.data?.type === 'facebook:connected') {
                loadStoredFacebookTokens().then(() => {
                    refreshFacebookStatus().then(connected => {
                        if (connected) loadInstagramAccounts();
                    });
                });
            }
        };
        window.addEventListener('message', handleMessage);
        return () => window.removeEventListener('message', handleMessage);
    }, [checkYoutubeStatus, checkXStatus, checkLinkedinStatus, loadStoredTiktokTokens, loadTiktokCreatorInfo, loadStoredFacebookTokens, refreshFacebookStatus, loadInstagramAccounts]);

    // Connection Handlers
    const handleLinkedinConnect = async () => {
        try {
            const res = await authFetch('/api/social?op=linkedin-auth-url');
            const data = await res.json().catch(() => ({}));
            if (data.url) {
                const popup = window.open(data.url, 'linkedin-auth', 'width=600,height=700');
                if (!popup) window.location.href = data.url;
            }
        } catch (e) {
            console.error('LinkedIn connect failed', e);
        }
    };

    const handleXConnect = async () => {
        try {
            const u = auth.currentUser;
            if (!u) return;
            const res = await authFetch(`/api/social?op=x-auth-url&uid=${u.uid}`);
            const data = await res.json().catch(() => ({}));
            if (data.url) {
                const width = 600;
                const height = 700;
                const left = window.screen.width / 2 - width / 2;
                const top = window.screen.height / 2 - height / 2;
                window.open(data.url, 'Connect X', `width=${width},height=${height},left=${left},top=${top}`);
            }
        } catch (e) {
            console.error('X connect failed', e);
        }
    };

    const handleYoutubeConnect = async () => {
        try {
            const res = await authFetch('/api/google?op=youtube-auth-url');
            const data = await res.json().catch(() => ({}));
            if (data.url) {
                window.open(data.url, 'YouTubeAuth', 'width=600,height=700');
            }
        } catch (e) {
            console.error('YouTube connect failed', e);
        }
    };

    const handleTiktokConnect = async () => {
        try {
            const res = await authFetch('/api/social?op=tiktok-auth-url');
            const data = await res.json().catch(() => ({}));
            if (data.url) {
                window.open(data.url, 'tiktok_auth', 'width=600,height=700');
            }
        } catch (e) {
            console.error('TikTok connect failed', e);
        }
    };

    const handleFacebookConnect = async () => {
        try {
            const FB = (window as any).FB;
            if (!FB) throw new Error('Facebook SDK is not loaded.');

            const loginResp = await new Promise<any>((resolve, reject) => {
                const configId = ((import.meta as any).env.VITE_FACEBOOK_CONFIG_ID || '').trim();
                FB.login(
                    (resp: any) => {
                        if (!resp?.authResponse?.accessToken) {
                            reject(new Error('Facebook login was cancelled or did not return an access token.'));
                            return;
                        }
                        resolve(resp);
                    },
                    configId ? { config_id: configId } : {
                        scope: 'public_profile,email,instagram_basic,instagram_content_publish,instagram_manage_insights,pages_manage_posts,pages_show_list,read_insights,pages_read_engagement',
                        return_scopes: true,
                        extras: JSON.stringify({ setup: { channel: 'IG_API_ONBOARDING' } })
                    }
                );
            });

            const connected = await refreshFacebookStatus(loginResp);

            if (connected && facebookAccessTokenRef.current) {
                try {
                    const exchangeRes = await authFetch('/api/social?op=fb-exchange-token', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ shortLivedToken: facebookAccessTokenRef.current })
                    });
                    if (exchangeRes.ok) {
                        const exchangeData = await exchangeRes.json();
                        if (exchangeData.accessToken) {
                            facebookAccessTokenRef.current = exchangeData.accessToken;
                        }
                    }
                } catch (e) { }
            }

            await loadInstagramAccounts();
        } catch (e) {
            console.error('Facebook connect failed', e);
        }
    };

    return {
        linkedinConnected, linkedinProfile, handleLinkedinConnect, checkLinkedinStatus,
        xConnected, xProfile, handleXConnect, checkXStatus,
        tiktokConnected, tiktokCreatorInfo, handleTiktokConnect,
        youtubeConnected, youtubeChannel, handleYoutubeConnect, checkYoutubeStatus,
        facebookConnected, facebookProfile, facebookStatusLoading, facebookAccessTokenRef, handleFacebookConnect,
        igAccounts, selectedIgId, setSelectedIgId, loadInstagramAccounts, refreshFacebookStatus
    };
}
