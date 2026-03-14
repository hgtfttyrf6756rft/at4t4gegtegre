
import React, { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { LiveServerMessage, Modality, StartSensitivity, EndSensitivity, FunctionDeclaration } from '@google/genai';
import { createPcmBlob, decode, decodeAudioData } from '../services/audioUtils';
import {
    generateWebsiteTool,
    editWebsiteTool,
    generateResearchReportTool,
    switchToBuilderTool,
    toggleDarkModeTool,
    switchTabTool,
    openLibraryTool,
    closeLibraryTool,
    scrollToSectionTool,
    playGameTool,
    toggleCodeViewTool,
    toggleFullscreenTool,
    clearWorkspaceTool,
    toggleSectionTool,
    startNewResearchTool,
    saveWorkTool,
    describeScreenTool,
    zoomTool,
    copyContentTool,
    setVoiceSpeedTool,
    streamWebsiteCode,
    refineWebsiteCode,
    performDeepResearch,
    analyzeDocument,
    generateImage,
    extractImageColors,
    queryWidget,
    fetchRemoteJobs,
    generateNoteSuggestions,
    generateInitialNodes,
    searchYoutubeVideos,
    analyzeYoutubeVideo,
    generateSocialCampaign,
    generateStructuredBlogPost,
    generateVeoVideo,
    getPexelsImage,
    generateSingleSpeakerAudio
} from '../services/geminiService';
import { storageService } from '../services/storageService';
import { contextService } from '../services/contextService';
import { ResearchReport, SavedProject, SavedWebsiteVersion, DynamicSection, Slide, ThemePalette, DualTheme, NoteNode, JobListing, YoutubeVideo, VideoAnalysis, SocialCampaign, BlogPost, VideoPost, ResearchProject, SavedResearch } from '../types';
import { GoogleGenAI } from '@google/genai';
import { Library } from './Library';
import { NoteMap } from './NoteMap';
import ReactMarkdown from 'react-markdown';
import { createVideoFromText, pollVideoUntilComplete, downloadVideoBlob } from '../services/soraService';
import { createVoiceoverVideoWithCreatomate } from '../services/creatomateService';
import { checkUsageLimit, incrementUsage, UsageType } from '../services/usageService';
import { UsageLimitModal } from './UsageLimitModal';
import { SharedReportAssistant } from './SharedReportAssistant';
import { useCredits } from '../hooks/useCredits';
import * as creditService from '../services/creditService';
import type { CreditOperation } from '../services/creditService';
import { InsufficientCreditsModal } from './InsufficientCreditsModal';
import { auth } from '../services/firebase';

// Simple debounce utility to prevent rapid successive calls
function debounce<T extends (...args: any[]) => void>(
    func: T,
    wait: number
): (...args: Parameters<T>) => void {
    let timeout: NodeJS.Timeout;
    return (...args: Parameters<T>) => {
        clearTimeout(timeout);
        timeout = setTimeout(() => func(...args), wait);
    };
}

// --- TOPIC WIDGET RENDERER (Non-game interactive HTML) ---
const TopicWidgetRenderer: React.FC<{ html: string; isDarkMode: boolean }> = ({ html, isDarkMode }) => {
    if (!html) return null;

    return (
        <div className="my-10 animate-fade-in">
            <div className="flex items-center gap-3 mb-4 px-2">
                <div className="relative flex h-3 w-3">
                    <span className={`absolute inline-flex h-full w-full rounded-full ${isDarkMode ? 'bg-indigo-400/60' : 'bg-indigo-500/50'}`}></span>
                    <span className={`relative inline-flex rounded-full h-3 w-3 ${isDarkMode ? 'bg-indigo-400' : 'bg-indigo-600'}`}></span>
                </div>
                <span className={`text-sm font-bold uppercase tracking-widest ${isDarkMode ? 'text-indigo-300' : 'text-indigo-700'}`}>
                    Interactive Widget
                </span>
            </div>

            <div className={`w-full h-[560px] rounded-2xl overflow-hidden shadow-2xl border ${isDarkMode ? 'border-indigo-500/20' : 'border-indigo-500/10'}`}>
                <iframe
                    srcDoc={html}
                    className="w-full h-full border-0 bg-transparent"
                    title="Interactive Topic Widget"
                    sandbox="allow-scripts allow-popups allow-forms allow-modals"
                    referrerPolicy="origin"
                />
            </div>
        </div>
    );
};

const EntityLogoWallRenderer: React.FC<{ content: any; isDarkMode: boolean; theme?: ThemePalette }> = ({ content, isDarkMode, theme }) => {
    const [images, setImages] = useState<Record<string, string>>({});

    const entities = useMemo(() => {
        const raw = (content?.entities || []) as any[];
        if (!Array.isArray(raw)) return [];
        return raw
            .map((e: any) => {
                const name = (e?.name || '').toString();
                const subtitle = (e?.subtitle || '').toString();
                const url = (e?.url || '').toString();
                const imageUrl = (e?.imageUrl || e?.image_url || '').toString();
                const imageQuery = (e?.imageQuery || e?.image_query || '').toString();
                return { name, subtitle, url, imageUrl, imageQuery };
            })
            .filter((e: any) => e.name);
    }, [content]);

    useEffect(() => {
        if (!entities || entities.length === 0) return;

        entities.forEach((e: any) => {
            const key = (e.url || e.name || '').toString();
            if (!key) return;
            if (e.imageUrl) return;
            if (images[key]) return;

            import('../services/imageSearchService').then(({ searchImages }) => {
                const query = (e.imageQuery || `${e.name} logo`).trim();
                searchImages(query, 1).then(results => {
                    if (results?.[0]?.thumbnail?.src) {
                        setImages(prev => ({ ...prev, [key]: results[0].thumbnail.src }));
                    }
                });
            });
        });
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [entities]);

    if (!entities || entities.length === 0) return null;

    return (
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-4">
            {entities.map((e: any, i: number) => {
                const key = (e.url || e.name || '').toString();
                const imgSrc = e.imageUrl || (key ? images[key] : undefined);

                const card = (
                    <div className={`rounded-xl overflow-hidden border ${isDarkMode ? 'bg-white/5 border-white/10' : 'bg-white border-gray-200'}`} style={theme ? { backgroundColor: theme.surface, borderColor: theme.secondary } : {}}>
                        <div className="h-24 bg-gray-100 dark:bg-gray-900 flex items-center justify-center">
                            {imgSrc ? (
                                <img src={imgSrc} alt={e.name} className="max-h-16 max-w-[80%] object-contain" />
                            ) : (
                                <div className="text-4xl opacity-20">🏷️</div>
                            )}
                        </div>
                        <div className="p-3">
                            <div className="text-sm font-semibold truncate" style={theme ? { color: theme.text } : {}}>{e.name}</div>
                            {e.subtitle ? (
                                <div className="text-xs opacity-60 mt-1 line-clamp-2" style={theme ? { color: theme.text } : {}}>{e.subtitle}</div>
                            ) : null}
                        </div>
                    </div>
                );

                return e.url ? (
                    <a key={i} href={e.url} target="_blank" rel="noopener noreferrer" className="block hover:opacity-90 transition-opacity">
                        {card}
                    </a>
                ) : (
                    <div key={i}>
                        {card}
                    </div>
                );
            })}
        </div>
    );
};

const KeyPeopleGalleryRenderer: React.FC<{ content: any; isDarkMode: boolean; theme?: ThemePalette }> = ({ content, isDarkMode, theme }) => {
    const [images, setImages] = useState<Record<string, string>>({});

    const people = useMemo(() => {
        const raw = (content?.people || []) as any[];
        if (!Array.isArray(raw)) return [];
        return raw
            .map((p: any) => {
                const name = (p?.name || '').toString();
                const role = (p?.role || '').toString();
                const whyRelevant = (p?.whyRelevant || p?.why_relevant || '').toString();
                const url = (p?.url || p?.link || '').toString();
                const imageUrl = (p?.imageUrl || p?.image_url || '').toString();
                const imageQuery = (p?.imageQuery || p?.image_query || '').toString();
                return { name, role, whyRelevant, url, imageUrl, imageQuery };
            })
            .filter((p: any) => p.name);
    }, [content]);

    useEffect(() => {
        if (!people || people.length === 0) return;

        people.forEach((p: any) => {
            const key = (p.url || p.name || '').toString();
            if (!key) return;
            if (p.imageUrl) return;
            if (images[key]) return;

            import('../services/imageSearchService').then(({ searchImages }) => {
                const query = (p.imageQuery || `${p.name} portrait`).trim();
                searchImages(query, 1).then(results => {
                    if (results?.[0]?.thumbnail?.src) {
                        setImages(prev => ({ ...prev, [key]: results[0].thumbnail.src }));
                    }
                });
            });
        });
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [people]);

    if (!people || people.length === 0) return null;

    return (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            {people.map((p: any, i: number) => {
                const key = (p.url || p.name || '').toString();
                const imgSrc = p.imageUrl || (key ? images[key] : undefined);

                return (
                    <div key={i} className={`rounded-xl overflow-hidden border ${isDarkMode ? 'bg-white/5 border-white/10' : 'bg-white border-gray-200'}`} style={theme ? { backgroundColor: theme.surface, borderColor: theme.secondary } : {}}>
                        <div className="h-52 bg-gray-200 dark:bg-gray-800">
                            {imgSrc ? (
                                <img src={imgSrc} alt={p.name} className="w-full h-full object-cover" />
                            ) : (
                                <div className="w-full h-full flex items-center justify-center text-5xl opacity-20">🧑‍💼</div>
                            )}
                        </div>
                        <div className="p-6">
                            <div className="flex items-start justify-between gap-3">
                                <div className="min-w-0">
                                    <div className="text-lg font-bold truncate" style={theme ? { color: theme.text } : {}}>{p.name}</div>
                                    {p.role ? (
                                        <div className="text-xs uppercase tracking-widest opacity-60 mt-1" style={theme ? { color: theme.text } : {}}>{p.role}</div>
                                    ) : null}
                                </div>
                                {p.url ? (
                                    <a href={p.url} target="_blank" rel="noopener noreferrer" className="text-xs font-bold uppercase tracking-widest text-blue-500 hover:underline flex-shrink-0">
                                        Link →
                                    </a>
                                ) : null}
                            </div>
                            {p.whyRelevant ? (
                                <p className="text-sm opacity-80 mt-4 leading-relaxed" style={theme ? { color: theme.text } : {}}>{p.whyRelevant}</p>
                            ) : null}
                        </div>
                    </div>
                );
            })}
        </div>
    );
};

const ChartImageGalleryRenderer: React.FC<{ content: any; isDarkMode: boolean; theme?: ThemePalette }> = ({ content, isDarkMode, theme }) => {
    const [images, setImages] = useState<Record<string, string>>({});

    const items = useMemo(() => {
        const raw = (content?.images || []) as any[];
        if (!Array.isArray(raw)) return [];
        return raw
            .map((it: any) => {
                const caption = (it?.caption || '').toString();
                const sourceUrl = (it?.sourceUrl || it?.source_url || it?.url || '').toString();
                const imageUrl = (it?.imageUrl || it?.image_url || '').toString();
                const imageQuery = (it?.imageQuery || it?.image_query || '').toString();
                return { caption, sourceUrl, imageUrl, imageQuery };
            })
            .filter((it: any) => it.caption);
    }, [content]);

    useEffect(() => {
        if (!items || items.length === 0) return;

        items.forEach((it: any) => {
            const key = (it.sourceUrl || it.caption || '').toString();
            if (!key) return;
            if (it.imageUrl) return;
            if (images[key]) return;

            import('../services/imageSearchService').then(({ searchImages }) => {
                const query = (it.imageQuery || `${it.caption} chart`).trim();
                searchImages(query, 1).then(results => {
                    if (results?.[0]?.thumbnail?.src) {
                        setImages(prev => ({ ...prev, [key]: results[0].thumbnail.src }));
                    }
                });
            });
        });
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [items]);

    if (!items || items.length === 0) return null;

    return (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            {items.map((it: any, i: number) => {
                const key = (it.sourceUrl || it.caption || '').toString();
                const imgSrc = it.imageUrl || (key ? images[key] : undefined);

                return (
                    <div key={i} className={`flex flex-col rounded-xl overflow-hidden border ${isDarkMode ? 'bg-white/5 border-white/10' : 'bg-white border-gray-200'}`} style={theme ? { backgroundColor: theme.surface, borderColor: theme.secondary } : {}}>
                        <div className="h-56 bg-gray-200 dark:bg-gray-800 relative">
                            {imgSrc ? (
                                <img src={imgSrc} alt={it.caption} className="w-full h-full object-cover" />
                            ) : (
                                <div className="w-full h-full flex items-center justify-center text-5xl opacity-20">📈</div>
                            )}
                        </div>
                        <div className="p-6 flex-1 flex flex-col">
                            <div className="text-sm font-semibold mb-3" style={theme ? { color: theme.text } : {}}>{it.caption}</div>
                            {it.sourceUrl ? (
                                <a href={it.sourceUrl} target="_blank" rel="noopener noreferrer" className="text-xs font-bold uppercase tracking-widest text-blue-500 hover:underline mt-auto">
                                    View source →
                                </a>
                            ) : null}
                        </div>
                    </div>
                );
            })}
        </div>
    );
};

interface LogItem {
    id: string;
    type: 'thought' | 'tool' | 'model' | 'user' | 'system';
    text: string;
    timestamp: number;
}

type Mode = 'builder' | 'researcher' | 'notemap' | 'create';

interface BlogCreatorProps {
    currentProject?: ResearchProject;
    initialResearchTopic?: string | null;
    loadedResearch?: SavedResearch | null;
    loadedWebsiteVersion?: SavedWebsiteVersion | null;
    onBackToDashboard?: () => void;
    onProjectUpdate?: (project: ResearchProject) => void;
    onResearchCompleted?: (payload: { projectId: string; session: SavedResearch }) => void;
    isDarkMode?: boolean;
    toggleTheme?: () => void;
    isSubscribed?: boolean;
    onUpgrade?: () => void;
    onResearchLogsUpdate?: (logs: string[]) => void;
    researchDockOpenSeed?: number;
    isShareView?: boolean;
}

const promptHasLocationIntent = (text: string): boolean => {
    const normalized = (text || '').toLowerCase();
    return (
        normalized.includes(' near me') ||
        normalized.includes(' nearby') ||
        normalized.includes(' near-by') ||
        normalized.includes(' in my area') ||
        normalized.includes(' in my city') ||
        normalized.includes(' in my town') ||
        normalized.includes(' close by') ||
        normalized.includes(' close to me') ||
        normalized.includes(' around me') ||
        /^near me\b/.test(normalized) ||
        /^nearby\b/.test(normalized)
    );
};

// --- HELPER: GET GEOLOCATION ---
// --- HELPER: GET GEOLOCATION ---
const getGoogleMapsApiKey = (): string => {
    return (import.meta as any).env?.VITE_GOOGLE_MAPS_API_KEY ||
        (import.meta as any).env?.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY || '';
};

const getUserLocation = async (): Promise<{ lat: number, lng: number } | null> => {
    // 1. Try Browser Geolocation (Fastest, most accurate if allowed)
    const browserLocation = await new Promise<{ lat: number, lng: number } | null>((resolve) => {
        if (!navigator.geolocation) return resolve(null);
        navigator.geolocation.getCurrentPosition(
            (pos) => resolve({ lat: pos.coords.latitude, lng: pos.coords.longitude }),
            (err) => {
                console.warn("Browser geolocation failed or timed out:", err);
                resolve(null);
            },
            {
                enableHighAccuracy: false,
                timeout: 8000,
                maximumAge: 60000
            }
        );
    });

    if (browserLocation) return browserLocation;

    // 2. Fallback: Google Geolocation API (server-side inference via IP)
    try {
        const apiKey = getGoogleMapsApiKey();
        if (!apiKey) {
            console.warn("No Google Maps API key available for geolocation fallback.");
            return null;
        }

        console.log("Attempting Google Geolocation API fallback...");
        const response = await fetch(`https://www.googleapis.com/geolocation/v1/geolocate?key=${apiKey}`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ considerIp: true })
        });

        if (!response.ok) {
            throw new Error(`Geolocation API error: ${response.statusText}`);
        }

        const data = await response.json();
        if (data.location) {
            console.log("Google Geolocation API success:", data.location);
            return { lat: data.location.lat, lng: data.location.lng };
        }
    } catch (err) {
        console.error("All geolocation methods failed:", err);
    }

    return null;
};

// --- GOOGLE MAPS LOADER ---

let googleMapsLoadPromise: Promise<any> | null = null;

const loadGoogleMaps = (): Promise<any> => {
    if (googleMapsLoadPromise) return googleMapsLoadPromise;

    googleMapsLoadPromise = new Promise((resolve, reject) => {
        if (typeof window === 'undefined') {
            reject(new Error('Google Maps can only be loaded in a browser environment'));
            return;
        }

        const apiKey = getGoogleMapsApiKey();

        if (!apiKey) {
            console.warn('Google Maps API key is not set.');
            reject(new Error('Missing Google Maps API key'));
            return;
        }

        const g = window as any;
        if (g.google && g.google.maps && typeof g.google.maps.importLibrary === 'function') {
            resolve(g.google.maps);
            return;
        }

        // Official Bootstrap Loader
        // @ts-ignore
        (g => { var h, a, k, p = "The Google Maps JavaScript API", c = "google", l = "importLibrary", q = "__ib__", m = document, b = window; b = b[c] || (b[c] = {}); var d = b.maps || (b.maps = {}), r = new Set, e = new URLSearchParams, u = () => h || (h = new Promise(async (f, n) => { await (a = m.createElement("script")); e.set("libraries", [...r] + ""); for (k in g) e.set(k.replace(/[A-Z]/g, t => "_" + t[0].toLowerCase()), g[k]); e.set("callback", c + ".maps." + q); a.src = `https://maps.${c}apis.com/maps/api/js?` + e; d[q] = f; a.onerror = () => h = n(Error(p + " could not load.")); a.nonce = m.querySelector("script[nonce]")?.nonce || ""; m.head.append(a) })); d[l] ? console.warn(p + " only loads once. Ignoring:", g) : d[l] = (f, ...n) => r.add(f) && u().then(() => d[l](f, ...n)) })({
            key: apiKey,
            v: "weekly",
            libraries: "maps,marker,maps3d,geocoding",
        });

        // Wait for importLibrary to be defined
        const checkInterval = setInterval(() => {
            const g = window as any;
            if (g.google && g.google.maps && typeof g.google.maps.importLibrary === 'function') {
                clearInterval(checkInterval);
                resolve(g.google.maps);
            }
        }, 100);

        // Safety timeout
        setTimeout(() => {
            clearInterval(checkInterval);
            const g = window as any;
            if (g.google && g.google.maps && typeof g.google.maps.importLibrary === 'function') {
                resolve(g.google.maps);
            } else {
                // Even if it timed out, reject if not found. 
                // But typically the bootstrap loader sets up the stub immediately.
                // If the script fails to load, the error is caught within the bootstrap loader? 
                // The bootstrap loader defines d[l] immediately.
                // So actually we can just resolve g.google.maps immediately because importLibrary will handle the loading?
                // No, we need to return the 'google.maps' namespace object that HAS importLibrary.
                // The bootstrap loader ensures `google.maps.importLibrary` exists as a function (that triggers the load).

                // Let's rely on the fact that the IIFE above sets `google.maps.importLibrary`.
                if (g.google?.maps?.importLibrary) {
                    resolve(g.google.maps);
                } else {
                    reject(new Error("Google Maps Bootstrap failed to initialize importLibrary"));
                }
            }
        }, 5000);
    });

    return googleMapsLoadPromise;
};

// Google Maps component that focuses on the active location and shows a marker.
const MapWidget: React.FC<{
    locations: any[];
    activeLocationIndex: number;
    isDarkMode: boolean;
    userLocation?: { lat: number; lng: number };
}> = ({ locations, activeLocationIndex, isDarkMode, userLocation }) => {
    const mapContainerRef = useRef<HTMLDivElement | null>(null);
    const mapRef = useRef<any>(null);
    const markerRef = useRef<any>(null);

    // Initialize Google Map once when locations are available
    useEffect(() => {
        if (!mapContainerRef.current) return;

        let isMounted = true;

        loadGoogleMaps()
            .then(async (maps) => {
                if (!isMounted || !mapContainerRef.current) return;

                if (!mapRef.current) {
                    const first = locations[activeLocationIndex] || locations[0];
                    const firstLat = first ? parseFloat(String(first.lat)) : NaN;
                    const firstLng = first ? parseFloat(String(first.lng)) : NaN;
                    const hasCoords = !isNaN(firstLat) && !isNaN(firstLng);
                    const center = hasCoords
                        ? { lat: firstLat, lng: firstLng }
                        : (userLocation || { lat: 40.7128, lng: -74.006 }); // fallback to user or NYC

                    const { Map } = await maps.importLibrary("maps");
                    const { AdvancedMarkerElement } = await maps.importLibrary("marker");

                    const map = new Map(mapContainerRef.current, {
                        center,
                        zoom: hasCoords ? 15 : (userLocation ? 13 : 2),
                        mapId: 'DEMO_MAP_ID',
                        tilt: 0,
                        heading: 0,
                    });

                    mapRef.current = map;

                    if (hasCoords) {
                        const marker = new AdvancedMarkerElement({
                            map,
                            position: center,
                            title: first?.name || 'Selected location'
                        });
                        marker.addListener("click", () => {
                            map.setZoom(17);
                            map.setCenter(marker.position);
                        });
                        markerRef.current = marker;
                    }
                }
            })
            .catch((err) => {
                console.error('Google Maps init error:', err);
            });

        return () => {
            isMounted = false;
        };
    }, [locations, activeLocationIndex, userLocation]); // Added userLocation to dependencies

    // Respond to active location changes
    useEffect(() => {
        if (!mapRef.current) return;

        const loc = locations[activeLocationIndex] || locations[0];
        const lat = loc ? parseFloat(String(loc.lat)) : NaN;
        const lng = loc ? parseFloat(String(loc.lng)) : NaN;

        if (isNaN(lat) || isNaN(lng)) return;

        const newPos = { lat, lng };

        // Update center
        mapRef.current.setCenter(newPos);
        mapRef.current.setZoom(15);

        // Update or create marker
        if (markerRef.current) {
            markerRef.current.position = newPos;
            markerRef.current.title = loc.name || 'Selected location';
        } else {
            loadGoogleMaps().then(async (maps) => {
                const { AdvancedMarkerElement } = await maps.importLibrary("marker");
                if (mapRef.current) {
                    const marker = new AdvancedMarkerElement({
                        map: mapRef.current,
                        position: newPos,
                        title: loc.name || 'Selected location'
                    });
                    marker.addListener("click", () => {
                        if (mapRef.current) {
                            mapRef.current.setZoom(17);
                            mapRef.current.setCenter(marker.position);
                        }
                    });
                    markerRef.current = marker;
                }
            });
        }
    }, [locations, activeLocationIndex]);

    return (
        <div className="w-full h-[320px] md:h-[380px] rounded-xl overflow-hidden border border-white/10 bg-black/60">
            <div ref={mapContainerRef} className="w-full h-full" />
        </div>
    );
};

const GooglePlacesMap = MapWidget;

// --- 3D MAP RENDERER (Using Google Maps 3D Elements) ---
const PhotorealisticMap: React.FC<{
    locations: any[];
    activeLocationIndex: number;
    isDarkMode: boolean;
    theme?: ThemePalette;
    onError?: (error: Error) => void;
}> = ({ locations, activeLocationIndex, isDarkMode, theme, onError }) => {
    const mapContainerRef = useRef<HTMLDivElement>(null);
    const mapInstanceRef = useRef<any>(null); // Map3DElement
    const markersRef = useRef<any[]>([]); // Array of Marker3DInteractiveElement
    const [isMapReady, setIsMapReady] = useState(false);

    useEffect(() => {
        // Ensure libraries are loaded
        loadGoogleMaps().then(async (googleMaps) => {
            if (!mapContainerRef.current) return;

            // Wait for maps3d library to be available (it should be since we requested it)
            // But we need to access the class from google.maps.maps3d
            // Double check importLibrary exists
            if (typeof googleMaps.importLibrary !== 'function') {
                throw new Error("google.maps.importLibrary is not a function");
            }
            const { Map3DElement, Marker3DInteractiveElement } = await googleMaps.importLibrary("maps3d") as any;

            if (!mapInstanceRef.current) {
                // Initialize Map
                const map = new Map3DElement({
                    center: { lat: 0, lng: 0, altitude: 0 },
                    tilt: 60,
                    range: 1500, // Distance from center
                    heading: 0,
                    mode: 'HYBRID', // or 'SATELLITE'
                    mapId: 'DEMO_MAP_ID',
                    defaultUIHidden: false
                });

                // Append to container
                mapContainerRef.current!.appendChild(map);
                mapInstanceRef.current = map;
            }

            const map = mapInstanceRef.current;

            // Clear existing markers
            markersRef.current.forEach(marker => {
                marker.map = null;
            });
            markersRef.current = [];

            // Add Markers
            locations.forEach((loc, idx) => {
                if (loc.lat && loc.lng) {
                    const marker = new Marker3DInteractiveElement({
                        position: { lat: parseFloat(loc.lat), lng: parseFloat(loc.lng), altitude: 0 },
                        title: loc.name || `Location ${idx + 1}`,
                        label: String(idx + 1)
                    });

                    // Respond to click
                    marker.addEventListener('gmp-click', () => {
                        // Find the "Found Locations" list item and simulate click or just rely on parent passing activeLocationIndex?
                        // The parent needs to know we clicked THIS marker to update the active index.
                        // But we don't have a callback prop for `onMarkerClick` here in the interface currently,
                        // only `activeLocationIndex` is passed down. 
                        // To fix the "interaction" issue properly, we should probably add a callback callback to this component?
                        // However, the task is to "Make markers respond...".
                        // I will dispatch a custom event or log for now, but ideally I should add `onLocationSelect` prop.
                        // For now, I'll fly the map to the marker on click as a direct feedback.
                        map.flyCameraTo({
                            endCamera: {
                                center: { lat: parseFloat(loc.lat), lng: parseFloat(loc.lng), altitude: 0 },
                                tilt: 60,
                                range: 800
                            },
                            durationMillis: 2000
                        });
                    });

                    map.append(marker);
                    markersRef.current.push(marker);
                }
            });
            setIsMapReady(true);
        }).catch(err => {
            console.error("Failed to load Maps 3D", err);
            if (onError) onError(err);
        });

    }, [locations, onError]); // Re-run if locations change

    // Handle Active Location Change (FlyTo)
    useEffect(() => {
        const map = mapInstanceRef.current;

        if (map && locations[activeLocationIndex]) {
            const loc = locations[activeLocationIndex];
            if (loc.lat && loc.lng) {
                try {
                    const camera = {
                        center: { lat: parseFloat(loc.lat), lng: parseFloat(loc.lng), altitude: 0 },
                        tilt: 60,
                        range: 800,
                        heading: 0
                    };
                    map.flyCameraTo({
                        endCamera: camera,
                        durationMillis: 2000
                    });
                } catch (e) {
                    console.error("flyCameraTo failed:", e);
                }
            }
        }
    }, [activeLocationIndex, locations, isMapReady]);

    // Cleanup
    useEffect(() => {
        return () => {
            if (mapContainerRef.current && mapInstanceRef.current) {
                // mapContainerRef.current.removeChild(mapInstanceRef.current);
                // Cleanup might cause issues if React unmounts quickly, but standard DOM removal is safe.
                mapInstanceRef.current.remove();
                mapInstanceRef.current = null;
            }
        };
    }, []);

    return (
        <div className="relative w-full h-[400px] md:h-[500px] rounded-xl overflow-hidden shadow-2xl border border-white/10 group bg-black">
            <div ref={mapContainerRef} className="w-full h-full" />

            {/* Hint */}
            <div className="absolute top-4 right-4 bg-black/60 backdrop-blur-md px-3 py-1.5 rounded-full text-xs font-bold text-white/80 border border-white/10 opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none z-10">
                Hold Ctrl + Drag to tilt • Scroll to zoom
            </div>
        </div>
    );
};

// --- MAP WIDGET RENDERER ---
const MapWidgetRenderer: React.FC<{
    content: any;
    isDarkMode: boolean;
    theme?: ThemePalette;
    userLocation?: { lat: number; lng: number };
}> = ({ content, isDarkMode, theme, userLocation }) => {
    const [activeIndex, setActiveIndex] = useState(0);
    const [is3DMode, setIs3DMode] = useState(false);
    const [locations, setLocations] = useState<any[]>([]);

    useEffect(() => {
        const rawLocations = Array.isArray(content?.locations) ? content.locations : [];
        // Initial normalization
        const normalized = rawLocations.map((l: any) => ({
            ...l,
            lat: l.lat || l.latitude,
            lng: l.lng || l.long || l.longitude
        }));
        setLocations(normalized);

        // Geocode missing coordinates
        const missingCoordsIndices = normalized.map((l: any, i: number) => {
            const lat = parseFloat(String(l.lat));
            const lng = parseFloat(String(l.lng));
            return (isNaN(lat) || isNaN(lng)) && l.address ? i : -1;
        }).filter((i: number) => i !== -1);

        if (missingCoordsIndices.length > 0 && typeof window !== 'undefined') {
            console.log("Found locations with missing coords, attempting to geocode...", missingCoordsIndices.length);
            loadGoogleMaps().then(async (googleMaps) => {
                const { Geocoder } = await googleMaps.importLibrary("geocoding") as any;
                const geocoder = new Geocoder();

                missingCoordsIndices.forEach((idx: number) => {
                    const loc = normalized[idx];
                    geocoder.geocode({ address: loc.address }, (results: any, status: any) => {
                        if (status === 'OK' && results[0]) {
                            const { lat, lng } = results[0].geometry.location;
                            console.log(`Geocoded ${loc.name}:`, lat(), lng());
                            setLocations(prev => {
                                const next = [...prev];
                                next[idx] = { ...prev[idx], lat: lat(), lng: lng() };
                                return next;
                            });
                        } else {
                            console.warn(`Geocoding failed for ${loc.name}:`, status);
                        }
                    });
                });
            }).catch(err => console.error("Failed to load geocoder", err));
        }

    }, [content]);

    const validLocations = locations.filter((l: any) => {
        const lat = parseFloat(String(l.lat));
        const lng = parseFloat(String(l.lng));
        return !isNaN(lat) && !isNaN(lng);
    });

    if (content?.locations?.length > 0 && validLocations.length === 0 && !userLocation) {
        // Show loading or partial state if we are geocoding?
        // If validLocations is empty but we have raw locations, we might be waiting for geocode
        // But we should return null if it stays empty
    }

    // Derived state for 3D map capability
    const has3DMap = typeof window !== 'undefined' && validLocations.length > 0;

    return (
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
            {/* Map Column */}
            <div className="lg:col-span-3 mb-4 space-y-4 animate-fade-in">
                <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                        <span className="text-xl">🗺️</span>
                        <h4 className="font-bold text-sm uppercase tracking-widest opacity-70">Interactive Map View</h4>
                    </div>

                    {has3DMap && (
                        <div className={`flex p-1 rounded-lg border ${isDarkMode ? 'bg-black/40 border-white/10' : 'bg-white border-black/10'}`}>
                            <button
                                onClick={() => setIs3DMode(false)}
                                className={`px-3 py-1.5 text-xs font-bold rounded-md transition-all ${!is3DMode ? (isDarkMode ? 'bg-white text-black' : 'bg-black text-white') : 'opacity-70 hover:opacity-100'}`}
                            >
                                2D Map
                            </button>
                            <button
                                onClick={() => setIs3DMode(true)}
                                className={`px-3 py-1.5 text-xs font-bold rounded-md transition-all ${is3DMode ? (isDarkMode ? 'bg-white text-black' : 'bg-black text-white') : 'opacity-70 hover:opacity-100'}`}
                            >
                                3D View
                            </button>
                        </div>
                    )}
                </div>

                {is3DMode ? (
                    <PhotorealisticMap
                        locations={validLocations}
                        activeLocationIndex={activeIndex}
                        isDarkMode={isDarkMode}
                        theme={theme}
                        onError={(err) => {
                            console.warn("3D Map failed to load, falling back to 2D", err);
                            setIs3DMode(false);
                        }}
                    />
                ) : (
                    <GooglePlacesMap
                        locations={validLocations}
                        activeLocationIndex={activeIndex}
                        isDarkMode={isDarkMode}
                        userLocation={userLocation}
                    />
                )}
            </div>

            {/* Location List */}
            {locations.length > 0 && (
                <div className={`p-6 rounded-xl border col-span-1 lg:col-span-3 ${isDarkMode ? 'bg-white/5 border-white/10' : 'bg-white border-black/5'
                    }`} style={theme ? { backgroundColor: theme.surface, borderColor: theme.secondary } : {}}>
                    <div className="flex items-center gap-2 mb-4 opacity-70">
                        <span className="text-xl">📍</span>
                        <h4 className="font-bold text-sm uppercase tracking-widest">Found Locations</h4>
                    </div>

                    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
                        {locations.map((loc: any, idx: number) => {
                            const searchUrl = `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(loc.name + " " + (loc.address || ""))}`;

                            // Determine if this location is currently active in the 3D view
                            // We match based on object reference if possible, or try to match coordinates
                            let isSelected = false;
                            if (validLocations.length > 0 && activeIndex < validLocations.length) {
                                const activeLoc = validLocations[activeIndex];
                                isSelected = loc === activeLoc || (String(loc.lat) === String(activeLoc.lat) && String(loc.lng) === String(activeLoc.lng));
                            }

                            return (
                                <div
                                    key={idx}
                                    onClick={() => {
                                        console.log("Location card clicked:", loc);
                                        // If this location has coords, find its index in the valid list to fly to it
                                        const lat = parseFloat(String(loc.lat));
                                        const lng = parseFloat(String(loc.lng));
                                        if (!isNaN(lat) && !isNaN(lng)) {
                                            const validIdx = validLocations.findIndex(vl => {
                                                const vLat = parseFloat(String(vl.lat));
                                                const vLng = parseFloat(String(vl.lng));
                                                // Use a small epsilon for float comparison just in case, or string matching
                                                // String matching is safer if they came from same source
                                                // Also check if objects are identical
                                                return vl === loc || (
                                                    Math.abs(vLat - lat) < 0.0001 && Math.abs(vLng - lng) < 0.0001
                                                );
                                            });
                                            console.log("Found validIdx:", validIdx);
                                            if (validIdx !== -1) {
                                                setActiveIndex(validIdx);
                                                // Force 3D map to fly or 2D map to pan via prop update
                                            }
                                        } else {
                                            console.warn("Clicked location has invalid coords:", lat, lng);
                                        }
                                    }}
                                    className={`relative group p-4 rounded-lg border transition-all cursor-pointer ${isSelected
                                        ? (isDarkMode ? 'bg-white/10 border-blue-500/50 ring-1 ring-blue-500/30' : 'bg-black/5 border-blue-500/50 ring-1 ring-blue-500/30')
                                        : (isDarkMode ? 'bg-black/20 border-white/5 hover:bg-white/10' : 'bg-black/5 border-black/5 hover:bg-white')
                                        }`}
                                    style={theme ? {
                                        borderColor: isSelected ? theme.primary : theme.secondary,
                                        color: theme.text
                                    } : {}}
                                >
                                    <div className="flex justify-between items-start mb-2">
                                        <div className="font-bold text-lg leading-tight flex items-center gap-2">
                                            {isSelected && <span className="text-blue-500 animate-pulse">●</span>}
                                            {loc.name}
                                        </div>
                                        {loc.rating && (
                                            <span className="flex items-center gap-1 text-xs font-bold bg-yellow-500/20 text-yellow-500 px-2 py-1 rounded">
                                                ★ {loc.rating}
                                            </span>
                                        )}
                                    </div>
                                    <div className="text-sm opacity-60 mb-3 line-clamp-2">
                                        {loc.address || "Address unavailable"}
                                    </div>

                                    <div className="flex gap-3 mt-auto pt-2 border-t border-dashed border-gray-500/20">
                                        {loc.lat && loc.lng && (
                                            <button className={`text-xs font-bold uppercase tracking-wider flex items-center gap-1 hover:underline ${isDarkMode ? 'text-blue-400' : 'text-blue-600'
                                                }`} style={theme ? { color: theme.primary } : {}}>
                                                <span>Fly to Location</span>
                                            </button>
                                        )}
                                        <a
                                            href={searchUrl}
                                            target="_blank"
                                            rel="noreferrer"
                                            onClick={(e) => e.stopPropagation()}
                                            className="text-xs font-bold uppercase tracking-wider flex items-center gap-1 opacity-50 hover:opacity-100 hover:underline ml-auto"
                                        >
                                            Google Maps ↗
                                        </a>
                                    </div>
                                </div>
                            );
                        })}
                    </div>
                </div>
            )}
        </div>
    );
};

// --- CUSTOM CHART COMPONENT ---
// Robust parsing logic to handle "5.2 Billion", "10M", "5k", "100%"
const parseStatValue = (valueStr: string): number => {
    if (!valueStr) return 0;
    const clean = valueStr.toString().toLowerCase().replace(/,/g, '').trim();

    // Extract first numeric match
    const numberMatch = clean.match(/([\d.]+)/);
    if (!numberMatch) return 0;

    let num = parseFloat(numberMatch[0]);
    if (isNaN(num)) return 0;

    // Magnitude multipliers
    if (clean.includes('trillion') || clean.includes('tn')) num *= 1_000_000_000_000;
    else if (clean.includes('billion') || clean.includes('bn') || clean.endsWith('b')) num *= 1_000_000_000;
    else if (clean.includes('million') || clean.includes('mn') || clean.endsWith('m')) num *= 1_000_000;
    else if (clean.includes('thousand') || clean.endsWith('k')) num *= 1_000;
    // Note: Percentages usually stay as 0-100 scale, which is fine if not mixed with Billions (enforced by prompt).

    return num;
};

// ============================================
// GLASSMORPHISM DESIGN SYSTEM - Apple Inspired
// ============================================

const GlassCard: React.FC<{
    children: React.ReactNode;
    isDarkMode: boolean;
    theme?: ThemePalette;
    className?: string;
    intensity?: 'light' | 'medium' | 'strong';
    glow?: boolean;
}> = ({ children, isDarkMode, theme, className = '', intensity = 'medium', glow = false }) => {
    const intensityMap = {
        light: isDarkMode ? 'bg-[#1c1c1e]/60' : 'bg-white/50',
        medium: isDarkMode ? 'bg-[#1c1c1e]/80' : 'bg-white/70',
        strong: isDarkMode ? 'bg-[#1c1c1e]/90' : 'bg-white/85'
    };

    const glowStyle = glow ? {
        boxShadow: theme
            ? `0 0 80px -20px ${theme.primary}30, 0 20px 60px -20px rgba(0,0,0,0.3)`
            : isDarkMode
                ? '0 0 80px -20px rgba(0,113,227,0.2), 0 20px 60px -20px rgba(0,0,0,0.4)'
                : '0 0 60px -20px rgba(0,113,227,0.15), 0 20px 50px -20px rgba(0,0,0,0.1)'
    } : {};

    return (
        <div
            className={`
        relative overflow-hidden rounded-[20px]
        backdrop-blur-2xl backdrop-saturate-150
        border transition-all duration-300
        ${intensityMap[intensity]}
        ${isDarkMode
                    ? 'border-white/[0.06]'
                    : 'border-black/[0.04]'
                }
        ${className}
      `}
            style={{
                backgroundColor: theme ? `${theme.surface}${isDarkMode ? 'E8' : 'D9'}` : undefined,
                borderColor: theme ? `${theme.secondary}30` : undefined,
                ...glowStyle
            }}
        >
            {/* Subtle top highlight for depth */}
            <div
                className="absolute inset-x-0 top-0 h-px pointer-events-none"
                style={{
                    background: isDarkMode
                        ? 'linear-gradient(90deg, transparent, rgba(255,255,255,0.1), transparent)'
                        : 'linear-gradient(90deg, transparent, rgba(255,255,255,0.8), transparent)'
                }}
            />
            <div className="relative z-10">{children}</div>
        </div>
    );
};

const SimpleBarChart: React.FC<{ data: any[]; isDarkMode: boolean; theme?: ThemePalette }> = ({ data, isDarkMode, theme }) => {
    if (!Array.isArray(data) || data.length === 0) return null;

    const parsedData = data.map(item => ({
        ...item,
        numValue: parseStatValue(item.value)
    }));

    const sortedData = [...parsedData].sort((a, b) => b.numValue - a.numValue);
    const maxVal = Math.max(...sortedData.map(d => d.numValue)) || 100;

    return (
        <GlassCard isDarkMode={isDarkMode} theme={theme} className="p-6 md:p-8">
            <div className="flex flex-col gap-5">
                {sortedData.map((item, idx) => {
                    const widthPercentage = maxVal > 0 ? (item.numValue / maxVal) * 100 : 0;

                    return (
                        <div key={idx} className="relative group">
                            <div className="flex justify-between text-sm font-medium mb-2">
                                <span
                                    className="opacity-90 truncate pr-4 font-medium"
                                    style={{ color: theme?.text || (isDarkMode ? '#fff' : '#000') }}
                                >
                                    {item.label}
                                </span>
                                <span
                                    className="shrink-0 font-bold tabular-nums"
                                    style={{ color: theme?.primary || (isDarkMode ? '#fff' : '#000') }}
                                >
                                    {item.value}
                                </span>
                            </div>
                            <div
                                className="w-full h-2.5 rounded-full overflow-hidden"
                                style={{ backgroundColor: theme ? `${theme.secondary}25` : (isDarkMode ? 'rgba(255,255,255,0.1)' : 'rgba(0,0,0,0.08)') }}
                            >
                                <div
                                    className="h-full rounded-full transition-all duration-1000 ease-out relative overflow-hidden"
                                    style={{
                                        width: `${Math.max(widthPercentage, 2)}%`,
                                        background: theme
                                            ? `linear-gradient(90deg, ${theme.primary}, ${theme.accent})`
                                            : (isDarkMode ? 'linear-gradient(90deg, #818cf8, #c084fc)' : 'linear-gradient(90deg, #4f46e5, #7c3aed)')
                                    }}
                                >
                                    <div className="absolute inset-0 bg-gradient-to-r from-white/30 to-transparent" />
                                </div>
                            </div>
                        </div>
                    );
                })}
            </div>
        </GlassCard>
    );
};

// --- TRADINGVIEW CHART RENDERER ---
const TradingViewChartRenderer: React.FC<{ content: any; isDarkMode: boolean; theme?: ThemePalette }> = ({ content, isDarkMode, theme }) => {
    const container = useRef<HTMLDivElement>(null);
    const symbol = content?.symbol || "NASDAQ:AAPL";

    useEffect(() => {
        if (!container.current) return;

        // Clear previous script to avoid duplication on re-renders
        container.current.innerHTML = '';

        const script = document.createElement("script");
        script.src = "https://s3.tradingview.com/external-embedding/embed-widget-advanced-chart.js";
        script.type = "text/javascript";
        script.async = true;

        const bgColor = theme ? theme.surface : (isDarkMode ? "#0F0F0F" : "#FFFFFF");
        const gridColor = isDarkMode ? "rgba(242, 242, 242, 0.06)" : "rgba(0, 0, 0, 0.06)";
        const themeStr = isDarkMode ? "dark" : "light";

        script.innerHTML = JSON.stringify({
            "allow_symbol_change": true,
            "calendar": false,
            "details": true,
            "hide_side_toolbar": false,
            "hide_top_toolbar": false,
            "hide_legend": false,
            "hide_volume": false,
            "hotlist": false,
            "interval": "D",
            "locale": "en",
            "save_image": true,
            "style": "1",
            "symbol": symbol,
            "theme": themeStr,
            "timezone": "Etc/UTC",
            "backgroundColor": bgColor,
            "gridColor": gridColor,
            "watchlist": [],
            "withdateranges": true,
            "compareSymbols": [],
            "studies": [],
            "autosize": true
        });

        const widgetDiv = document.createElement("div");
        widgetDiv.className = "tradingview-widget-container__widget";
        widgetDiv.style.height = "calc(100% - 32px)";
        widgetDiv.style.width = "100%";

        const copyrightDiv = document.createElement("div");
        copyrightDiv.className = "tradingview-widget-copyright";
        copyrightDiv.innerHTML = `<a href="https://www.tradingview.com/" rel="noopener nofollow" target="_blank"><span class="blue-text">Track all markets on TradingView</span></a>`;

        container.current.appendChild(widgetDiv);
        container.current.appendChild(copyrightDiv);
        container.current.appendChild(script);

    }, [symbol, isDarkMode, theme]);

    return (
        <div className="w-full h-[500px] rounded-xl overflow-hidden border border-gray-700/50 shadow-2xl relative animate-fade-in" style={theme ? { borderColor: theme.secondary } : {}}>
            <div className="tradingview-widget-container h-full w-full" ref={container}>
            </div>
        </div>
    );
};

const isCareerTopic = (topic: string): boolean => {
    if (!topic) return false;
    const lower = topic.toLowerCase();
    const careerKeywords = [
        'job',
        'jobs',
        'career',
        'careers',
        'role',
        'roles',
        'position',
        'positions',
        'hiring',
        'recruit',
        'recruiting',
        'salary',
        'salaries',
        'vacancy',
        'vacancies',
        'internship',
        'internships'
    ];
    return careerKeywords.some(kw => lower.includes(kw));
};

// --- JOB BOARD RENDERER ---
const JobBoardRenderer: React.FC<{ initialJobs: JobListing[]; topic: string; isDarkMode: boolean; theme?: ThemePalette }> = ({ initialJobs, topic, isDarkMode, theme }) => {
    const [displayedJobs, setDisplayedJobs] = useState<JobListing[]>(initialJobs || []);
    const [loading, setLoading] = useState(false);

    // Reset local state if initialJobs or topic changes radically
    useEffect(() => {
        if (initialJobs) {
            setDisplayedJobs(initialJobs);
        }
    }, [initialJobs]);

    const handleLoadMore = async () => {
        setLoading(true);
        // Use tag heuristic to find relevant jobs. Filter out small stop words.
        const stopWords = new Set(['the', 'and', 'for', 'of', 'in', 'on', 'at', 'to', 'a', 'an', 'is', 'it']);
        const tag = topic.split(' ')
            .filter(w => !stopWords.has(w.toLowerCase()) && w.length > 2)
            .slice(0, 3)
            .join(' ');

        try {
            const newData = await fetchRemoteJobs({ tag: tag, count: 5 });

            if (newData && newData.jobs) {
                // Map API response to JobListing interface
                const mappedJobs: JobListing[] = newData.jobs.map((j: any) => ({
                    id: j.id ? String(j.id) : undefined,
                    title: j.jobTitle,
                    company: j.companyName,
                    location: j.jobGeo,
                    url: j.url,
                    type: j.jobType,
                    pubDate: j.pubDate,
                    salary: (j.salaryMin && j.salaryMax) ? `${j.salaryMin}-${j.salaryMax} ${j.salaryCurrency}` : undefined
                }));

                setDisplayedJobs(prev => {
                    // Deduplicate based on URL
                    const existingUrls = new Set(prev.map(j => j.url));
                    const newUnique = mappedJobs.filter(j => !existingUrls.has(j.url));
                    return [...prev, ...newUnique];
                });
            }
        } catch (e) {
            console.error("Failed to load more jobs", e);
        } finally {
            setLoading(false);
        }
    };

    if (!displayedJobs || displayedJobs.length === 0) return null;

    return (
        <div className="space-y-6">
            <div className="flex items-center gap-3 mb-4">
                <span className={`text-2xl ${isDarkMode ? 'text-white' : 'text-black'}`}>💼</span>
                <h3 className={`text-xl font-bold tracking-tight uppercase ${isDarkMode ? 'text-white' : 'text-gray-900'}`} style={theme ? { color: theme.primary } : {}}>
                    Open Career Opportunities
                </h3>
            </div>
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                {displayedJobs.map((job, idx) => (
                    <div key={idx} className={`p-5 rounded-xl border flex flex-col h-full transition-all hover:-translate-y-1 hover:shadow-lg ${isDarkMode
                        ? 'bg-white/5 border-white/10 hover:border-white/20'
                        : 'bg-white border-black/5 hover:border-black/10'
                        }`} style={theme ? { backgroundColor: theme.surface, borderColor: theme.secondary } : {}}>

                        <div className="flex items-start justify-between mb-2">
                            <span className={`text-xs font-bold uppercase tracking-wide px-2 py-0.5 rounded ${isDarkMode ? 'bg-white/10 text-white/70' : 'bg-black/5 text-black/70'
                                }`} style={theme ? { backgroundColor: theme.secondary + '33', color: theme.text } : {}}>
                                {job.type || 'Remote'}
                            </span>
                            {job.pubDate && (
                                <span className="text-[10px] opacity-50 font-mono">
                                    {new Date(job.pubDate).toLocaleDateString()}
                                </span>
                            )}
                        </div>

                        <h4 className="font-bold text-lg mb-1 leading-tight line-clamp-2" style={theme ? { color: theme.text } : {}}>
                            {job.title}
                        </h4>

                        <div className="text-sm font-medium opacity-70 mb-4" style={theme ? { color: theme.accent } : {}}>
                            {job.company}
                        </div>

                        <div className="flex items-center gap-2 mb-4 text-xs opacity-60">
                            <span>📍 {job.location}</span>
                            {job.salary && <span>💰 {job.salary}</span>}
                        </div>

                        <div className="mt-auto pt-4 border-t border-dashed border-gray-500/20">
                            <a
                                href={job.url}
                                target="_blank"
                                rel="noopener noreferrer"
                                className={`block w-full text-center py-2 rounded-lg text-sm font-bold transition-colors ${isDarkMode
                                    ? 'bg-white/10 hover:bg-white/20 text-white'
                                    : 'bg-black/5 hover:bg-black/10 text-black'
                                    }`}
                                style={theme ? { backgroundColor: theme.primary, color: theme.background } : {}}
                            >
                                Apply Now
                            </a>
                        </div>
                    </div>
                ))}
            </div>

            {/* Load More Button */}
            <div className="flex justify-center mt-6">
                <button
                    onClick={handleLoadMore}
                    disabled={loading}
                    className={`px-6 py-3 rounded-full font-bold text-sm tracking-wide uppercase transition-all flex items-center gap-2 ${isDarkMode
                        ? 'bg-white/10 hover:bg-white/20 text-white disabled:opacity-50'
                        : 'bg-black/5 hover:bg-black/10 text-black disabled:opacity-50'
                        }`}
                    style={theme ? { backgroundColor: theme.surface, color: theme.text, borderColor: theme.secondary, border: '1px solid' } : {}}
                >
                    {loading ? (
                        <>
                            <svg className="animate-spin h-4 w-4" viewBox="0 0 24 24"><circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" fill="none"></circle><path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path></svg>
                            Searching...
                        </>
                    ) : (
                        <>
                            Load More Opportunities
                            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M19 9l-7 7-7-7"></path></svg>
                        </>
                    )}
                </button>
            </div>
        </div>
    );
};

// --- VIDEO GALLERY RENDERER ---
const VideoGalleryRenderer: React.FC<{ videos?: YoutubeVideo[]; analysis?: VideoAnalysis; isDarkMode: boolean; theme?: ThemePalette }> = ({ videos, analysis, isDarkMode, theme }) => {
    if ((!videos || videos.length === 0) && !analysis) return null;

    return (
        <div className="space-y-6">
            <div className="flex items-center gap-3 mb-4">
                <span className={`text-2xl ${isDarkMode ? 'text-white' : 'text-black'}`}>▶️</span>
                <h3 className={`text-xl font-bold tracking-tight uppercase ${isDarkMode ? 'text-white' : 'text-gray-900'}`} style={theme ? { color: theme.primary } : {}}>
                    Deep Video Intelligence
                </h3>
            </div>

            {/* Analysis Text */}
            {analysis && (
                <div className={`p-6 rounded-xl border mb-6 ${isDarkMode ? 'bg-white/5 border-white/10' : 'bg-white border-black/5'}`} style={theme ? { backgroundColor: theme.surface, borderColor: theme.secondary } : {}}>
                    <h4 className="font-bold text-lg mb-3" style={theme ? { color: theme.text } : {}}>Video Analysis: {analysis.title}</h4>
                    <div className="prose prose-sm max-w-none whitespace-pre-wrap font-light leading-relaxed" style={theme ? { color: theme.text } : { color: isDarkMode ? '#d1d5db' : '#374151' }}>
                        {analysis.analysis}
                    </div>
                </div>
            )}

            {/* Video Grid */}
            {videos && videos.length > 0 && (
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                    {videos.map((video, idx) => (
                        <a key={idx} href={`https://www.youtube.com/watch?v=${video.id}`} target="_blank" rel="noopener noreferrer"
                            className={`group block p-3 rounded-xl border transition-all hover:scale-[1.02] hover:shadow-xl ${isDarkMode ? 'bg-white/5 border-white/10' : 'bg-white border-black/5'}`}
                            style={theme ? { backgroundColor: theme.surface, borderColor: theme.secondary } : {}}>
                            <div className="relative aspect-video rounded-lg overflow-hidden mb-3 bg-black">
                                <img src={video.thumbnail} alt={video.title} className="w-full h-full object-cover" />
                                <div className="absolute inset-0 flex items-center justify-center bg-black/30 opacity-0 group-hover:opacity-100 transition-opacity">
                                    <div className="w-10 h-10 rounded-full bg-white/20 backdrop-blur-sm flex items-center justify-center">
                                        <span className="text-white text-xl">▶</span>
                                    </div>
                                </div>
                                <div className="absolute bottom-2 right-2 px-1.5 py-0.5 rounded bg-black/80 text-white text-[10px] font-mono">
                                    {video.duration || 'VIDEO'}
                                </div>
                            </div>
                            <h4 className="font-bold text-sm leading-snug line-clamp-2 mb-1" style={theme ? { color: theme.text } : {}}>{video.title}</h4>
                            <div className="flex items-center justify-between text-[11px] opacity-70" style={theme ? { color: theme.accent } : {}}>
                                <span>{video.channel}</span>
                                <span>{video.publishedAt ? new Date(video.publishedAt).toLocaleDateString() : ''}</span>
                            </div>
                        </a>
                    ))}
                </div>
            )}
        </div>
    );
};

// --- RADAR CHART RENDERER (CSS/SVG) - Glassmorphism ---
const RadarChartRenderer: React.FC<{ content: any; isDarkMode: boolean; theme?: ThemePalette }> = ({ content, isDarkMode, theme }) => {
    if (!content?.axes || content.axes.length < 3) return null;

    const axes = content.axes;
    const numAxes = axes.length;
    const radius = 100;
    const center = 120;

    const getCoords = (value: number, i: number) => {
        const angle = (Math.PI * 2 * i) / numAxes - Math.PI / 2;
        return {
            x: center + (value / 100) * radius * Math.cos(angle),
            y: center + (value / 100) * radius * Math.sin(angle)
        };
    };

    const points = axes.map((ax: any, i: number) => {
        const { x, y } = getCoords(ax.value, i);
        return `${x},${y}`;
    }).join(' ');

    const webs = [25, 50, 75, 100].map(level => {
        return axes.map((_: any, i: number) => {
            const { x, y } = getCoords(level, i);
            return `${x},${y}`;
        }).join(' ');
    });

    const primaryColor = theme?.primary || (isDarkMode ? '#818cf8' : '#4f46e5');
    const accentColor = theme?.accent || (isDarkMode ? '#c084fc' : '#7c3aed');
    const strokeColor = theme?.secondary || (isDarkMode ? '#ffffff20' : '#00000015');

    return (
        <GlassCard isDarkMode={isDarkMode} theme={theme} className="p-8 md:p-10" glow>
            <div className="flex flex-col items-center">
                <svg width="280" height="280" viewBox="0 0 240 240" className="overflow-visible">
                    <defs>
                        <linearGradient id={`radarGrad-${primaryColor.replace('#', '')}`} x1="0%" y1="0%" x2="100%" y2="100%">
                            <stop offset="0%" stopColor={primaryColor} stopOpacity="0.6" />
                            <stop offset="100%" stopColor={accentColor} stopOpacity="0.3" />
                        </linearGradient>
                        <filter id="glow">
                            <feGaussianBlur stdDeviation="3" result="coloredBlur" />
                            <feMerge>
                                <feMergeNode in="coloredBlur" />
                                <feMergeNode in="SourceGraphic" />
                            </feMerge>
                        </filter>
                    </defs>

                    {axes.map((_: any, i: number) => {
                        const { x, y } = getCoords(100, i);
                        return <line key={i} x1={center} y1={center} x2={x} y2={y} stroke={strokeColor} strokeWidth="1" />;
                    })}

                    {webs.map((pointsStr, i) => (
                        <polygon key={i} points={pointsStr} fill="none" stroke={strokeColor} strokeWidth="1" />
                    ))}

                    <polygon
                        points={points}
                        fill={`url(#radarGrad-${primaryColor.replace('#', '')})`}
                        stroke={primaryColor}
                        strokeWidth="2.5"
                        filter="url(#glow)"
                    />

                    {axes.map((ax: any, i: number) => {
                        const { x, y } = getCoords(ax.value, i);
                        return (
                            <circle
                                key={`dot-${i}`}
                                cx={x}
                                cy={y}
                                r="4"
                                fill={primaryColor}
                                stroke={isDarkMode ? '#fff' : '#000'}
                                strokeWidth="1.5"
                            />
                        );
                    })}

                    {axes.map((ax: any, i: number) => {
                        const { x, y } = getCoords(120, i);
                        return (
                            <text
                                key={i}
                                x={x}
                                y={y}
                                textAnchor="middle"
                                dominantBaseline="middle"
                                fill={theme?.text || (isDarkMode ? '#fff' : '#000')}
                                fontSize="9"
                                fontWeight="600"
                                className="uppercase tracking-wider"
                            >
                                {ax.label}
                            </text>
                        );
                    })}
                </svg>

                <div className="mt-6 flex flex-wrap justify-center gap-4">
                    {axes.map((ax: any, i: number) => (
                        <div
                            key={i}
                            className="flex items-center gap-2 px-3 py-1.5 rounded-full text-xs font-medium"
                            style={{
                                backgroundColor: `${primaryColor}15`,
                                color: theme?.text || (isDarkMode ? '#fff' : '#000')
                            }}
                        >
                            <div
                                className="w-2 h-2 rounded-full"
                                style={{ background: `linear-gradient(135deg, ${primaryColor}, ${accentColor})` }}
                            />
                            <span className="opacity-70">{ax.label}:</span>
                            <span className="font-bold" style={{ color: primaryColor }}>{ax.value}</span>
                        </div>
                    ))}
                </div>
            </div>
        </GlassCard>
    );
};

// --- SWOT ANALYSIS RENDERER - Glassmorphism ---
const SwotAnalysisRenderer: React.FC<{ content: any; isDarkMode: boolean; theme?: ThemePalette }> = ({ content, isDarkMode, theme }) => {
    if (!content) return null;

    const sections = [
        { key: 'strengths', title: 'Strengths', icon: '💪', gradient: 'from-emerald-500 to-teal-600' },
        { key: 'weaknesses', title: 'Weaknesses', icon: '⚠️', gradient: 'from-amber-500 to-orange-600' },
        { key: 'opportunities', title: 'Opportunities', icon: '🚀', gradient: 'from-blue-500 to-indigo-600' },
        { key: 'threats', title: 'Threats', icon: '🛡️', gradient: 'from-red-500 to-rose-600' }
    ];

    return (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
            {sections.map(({ key, title, icon, gradient }) => (
                <GlassCard key={key} isDarkMode={isDarkMode} theme={theme} className="p-6 group hover:scale-[1.02] transition-transform duration-300">
                    <div className="flex items-center gap-3 mb-5">
                        <div className={`w-10 h-10 rounded-xl bg-gradient-to-br ${gradient} flex items-center justify-center text-lg shadow-lg`}>
                            {icon}
                        </div>
                        <h4
                            className="text-lg font-bold tracking-tight uppercase"
                            style={{ color: theme?.text || (isDarkMode ? '#fff' : '#000') }}
                        >
                            {title}
                        </h4>
                    </div>
                    <ul className="space-y-3">
                        {content[key]?.map((item: string, idx: number) => (
                            <li
                                key={idx}
                                className="flex items-start gap-3 text-sm leading-relaxed"
                                style={{ color: theme?.text || (isDarkMode ? '#e5e7eb' : '#374151'), opacity: 0.9 }}
                            >
                                <span
                                    className={`w-1.5 h-1.5 rounded-full mt-2 shrink-0 bg-gradient-to-br ${gradient}`}
                                />
                                {item}
                            </li>
                        ))}
                    </ul>
                </GlassCard>
            ))}
        </div>
    );
};

// --- PROCESS FLOW RENDERER - Glassmorphism ---
const ProcessFlowRenderer: React.FC<{ content: any; isDarkMode: boolean; theme?: ThemePalette }> = ({ content, isDarkMode, theme }) => {
    if (!content?.steps) return null;

    const primaryColor = theme?.primary || (isDarkMode ? '#818cf8' : '#4f46e5');
    const accentColor = theme?.accent || (isDarkMode ? '#c084fc' : '#7c3aed');

    return (
        <GlassCard isDarkMode={isDarkMode} theme={theme} className="p-6 md:p-8">
            <div className="space-y-0">
                {content.steps.map((step: any, i: number) => (
                    <div key={i} className="flex gap-5 group">
                        <div className="flex flex-col items-center">
                            <div
                                className="w-10 h-10 rounded-2xl flex items-center justify-center font-bold text-sm shrink-0 shadow-lg transition-transform group-hover:scale-110"
                                style={{
                                    background: `linear-gradient(135deg, ${primaryColor}, ${accentColor})`,
                                    color: '#fff'
                                }}
                            >
                                {i + 1}
                            </div>
                            {i < content.steps.length - 1 && (
                                <div
                                    className="w-0.5 flex-1 my-3 rounded-full min-h-[40px]"
                                    style={{
                                        background: `linear-gradient(to bottom, ${primaryColor}60, ${primaryColor}10)`
                                    }}
                                />
                            )}
                        </div>
                        <div className={`flex-1 pb-8 ${i === content.steps.length - 1 ? '' : ''}`}>
                            <h4
                                className="text-lg font-semibold mb-2"
                                style={{ color: theme?.primary || (isDarkMode ? '#fff' : '#111') }}
                            >
                                {step.title}
                            </h4>
                            <p
                                className="text-sm leading-relaxed"
                                style={{ color: theme?.text || (isDarkMode ? '#9ca3af' : '#4b5563'), opacity: 0.85 }}
                            >
                                {step.description}
                            </p>
                        </div>
                    </div>
                ))}
            </div>
        </GlassCard>
    );
};

// --- METRIC CARD GRID RENDERER - Glassmorphism ---
const MetricCardGridRenderer: React.FC<{ content: any; isDarkMode: boolean; theme?: ThemePalette }> = ({ content, isDarkMode, theme }) => {
    if (!content?.metrics) return null;

    const primaryColor = theme?.primary || (isDarkMode ? '#818cf8' : '#4f46e5');

    return (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            {content.metrics.map((m: any, i: number) => (
                <GlassCard
                    key={i}
                    isDarkMode={isDarkMode}
                    theme={theme}
                    className="p-5 md:p-6 hover:scale-[1.03] transition-all duration-300"
                    intensity="light"
                >
                    <div className="flex flex-col h-full">
                        <span
                            className="text-[10px] font-bold uppercase tracking-[0.15em] mb-3 opacity-60"
                            style={{ color: theme?.text || (isDarkMode ? '#9ca3af' : '#6b7280') }}
                        >
                            {m.label}
                        </span>
                        <div className="flex items-end gap-2 mt-auto">
                            <span
                                className="text-2xl md:text-3xl font-semibold tracking-tight tabular-nums"
                                style={{ color: primaryColor }}
                            >
                                {m.value}
                            </span>
                            {m.trend && m.trend !== 'neutral' && (
                                <span className={`text-[10px] font-bold mb-1 px-2 py-1 rounded-[16px] flex items-center gap-0.5 ${m.trend === 'up'
                                    ? 'bg-emerald-500/20 text-emerald-400'
                                    : 'bg-red-500/20 text-red-400'
                                    }`}>
                                    <span className="text-xs">{m.trend === 'up' ? '↑' : '↓'}</span>
                                    {m.trendValue}
                                </span>
                            )}
                        </div>
                    </div>
                </GlassCard>
            ))}
        </div>
    );
};

// --- TOP PICKS RENDERER - Glassmorphism ---
const TopPicksRenderer: React.FC<{ content: any; isDarkMode: boolean; theme?: ThemePalette }> = ({ content, isDarkMode, theme }) => {
    if (!content?.picks) return null;

    const primaryColor = theme?.primary || (isDarkMode ? '#818cf8' : '#4f46e5');
    const accentColor = theme?.accent || (isDarkMode ? '#c084fc' : '#7c3aed');

    return (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-5">
            {content.picks.map((pick: any, i: number) => (
                <GlassCard
                    key={i}
                    isDarkMode={isDarkMode}
                    theme={theme}
                    className="p-6 group hover:scale-[1.02] transition-all duration-300"
                    glow={i === 0}
                >
                    {pick.badge && (
                        <div
                            className="absolute top-3 right-3 z-20 max-w-[70%] text-[10px] font-bold uppercase tracking-wider text-right leading-tight"
                            style={{
                                color: isDarkMode ? (theme?.accent || '#c084fc') : (theme?.primary || '#4f46e5'),
                                textShadow: isDarkMode
                                    ? '0 2px 10px rgba(0,0,0,0.55)'
                                    : '0 1px 6px rgba(255,255,255,0.9)'
                            }}
                        >
                            {pick.badge}
                        </div>
                    )}

                    <div className="mb-5">
                        <div
                            className="w-12 h-12 rounded-2xl flex items-center justify-center text-lg font-bold mb-4 shadow-lg transition-transform group-hover:scale-110"
                            style={{
                                background: `linear-gradient(135deg, ${primaryColor}30, ${accentColor}20)`,
                                color: primaryColor,
                                border: `1px solid ${primaryColor}30`
                            }}
                        >
                            {i + 1}
                        </div>
                        <h4
                            className="text-xl font-bold leading-tight"
                            style={{ color: theme?.text || (isDarkMode ? '#fff' : '#111') }}
                        >
                            {pick.name}
                        </h4>
                    </div>

                    <p
                        className="text-sm leading-relaxed flex-1"
                        style={{ color: theme?.text || (isDarkMode ? '#9ca3af' : '#4b5563'), opacity: 0.85 }}
                    >
                        {pick.description}
                    </p>
                </GlassCard>
            ))}
        </div>
    );
};

// ============================================
// NEW ADVANCED DYNAMIC WIDGET RENDERERS (15)
// ============================================

// --- 1. SCENARIO SLIDER ("Sliding Doors") ---
const ScenarioSliderRenderer: React.FC<{ content: any; isDarkMode: boolean; theme?: ThemePalette }> = ({ content, isDarkMode, theme }) => {
    const [sliderValue, setSliderValue] = useState(50);
    if (!content?.scenarios || content.scenarios.length < 2) return null;

    const leftScenario = content.scenarios[0];
    const rightScenario = content.scenarios[1];
    const interpolate = (left: number, right: number) => left + (right - left) * (sliderValue / 100);

    return (
        <div className={`p-8 rounded-2xl border ${isDarkMode ? 'bg-gradient-to-br from-indigo-950/30 to-purple-950/30 border-indigo-500/20' : 'bg-gradient-to-br from-indigo-50 to-purple-50 border-indigo-200'}`} style={theme ? { backgroundColor: theme.surface, borderColor: theme.secondary } : {}}>
            <div className="text-center mb-8">
                <h4 className="text-lg font-bold uppercase tracking-widest mb-2 opacity-70" style={theme ? { color: theme.primary } : {}}>Scenario Comparison</h4>
                <p className="text-sm opacity-60" style={theme ? { color: theme.text } : {}}>{content.description || 'Drag the slider to compare outcomes'}</p>
            </div>

            <div className="grid grid-cols-2 gap-8 mb-8">
                <div className={`p-6 rounded-xl border-2 transition-all ${sliderValue < 50 ? 'ring-2 ring-blue-500 scale-[1.02]' : ''} ${isDarkMode ? 'bg-blue-900/20 border-blue-500/30' : 'bg-blue-50 border-blue-200'}`}>
                    <div className="text-4xl mb-3">{leftScenario.icon || '🅰️'}</div>
                    <h5 className="font-bold text-lg mb-2" style={theme ? { color: theme.primary } : {}}>{leftScenario.title}</h5>
                    <p className="text-sm opacity-70" style={theme ? { color: theme.text } : {}}>{leftScenario.description}</p>
                    {leftScenario.metrics && (
                        <div className="mt-4 space-y-2">
                            {leftScenario.metrics.map((m: any, i: number) => (
                                <div key={i} className="flex justify-between text-sm">
                                    <span className="opacity-60">{m.label}</span>
                                    <span className="font-mono font-bold" style={theme ? { color: theme.accent } : {}}>{m.value}</span>
                                </div>
                            ))}
                        </div>
                    )}
                </div>

                <div className={`p-6 rounded-xl border-2 transition-all ${sliderValue > 50 ? 'ring-2 ring-purple-500 scale-[1.02]' : ''} ${isDarkMode ? 'bg-purple-900/20 border-purple-500/30' : 'bg-purple-50 border-purple-200'}`}>
                    <div className="text-4xl mb-3">{rightScenario.icon || '🅱️'}</div>
                    <h5 className="font-bold text-lg mb-2" style={theme ? { color: theme.primary } : {}}>{rightScenario.title}</h5>
                    <p className="text-sm opacity-70" style={theme ? { color: theme.text } : {}}>{rightScenario.description}</p>
                    {rightScenario.metrics && (
                        <div className="mt-4 space-y-2">
                            {rightScenario.metrics.map((m: any, i: number) => (
                                <div key={i} className="flex justify-between text-sm">
                                    <span className="opacity-60">{m.label}</span>
                                    <span className="font-mono font-bold" style={theme ? { color: theme.accent } : {}}>{m.value}</span>
                                </div>
                            ))}
                        </div>
                    )}
                </div>
            </div>

            <div className="relative">
                <input
                    type="range"
                    min="0"
                    max="100"
                    value={sliderValue}
                    onChange={(e) => setSliderValue(Number(e.target.value))}
                    className="w-full h-3 rounded-full appearance-none cursor-pointer"
                    style={{
                        background: `linear-gradient(to right, ${theme?.primary || '#3b82f6'} 0%, ${theme?.accent || '#8b5cf6'} 100%)`,
                    }}
                />
                <div className="flex justify-between mt-2 text-xs font-bold uppercase tracking-widest opacity-50">
                    <span>{leftScenario.title}</span>
                    <span>{rightScenario.title}</span>
                </div>
            </div>
        </div>
    );
};

// --- 2. PARAMETER KNOBS ("What-If" Controls) ---
const ParameterKnobsRenderer: React.FC<{ content: any; isDarkMode: boolean; theme?: ThemePalette }> = ({ content, isDarkMode, theme }) => {
    const [values, setValues] = useState<Record<string, number>>(() => {
        const initial: Record<string, number> = {};
        content?.parameters?.forEach((p: any) => { initial[p.id] = p.default || 50; });
        return initial;
    });

    if (!content?.parameters) return null;

    const calculateOutput = () => {
        if (!content.formula) return content.baseOutput || 'Adjust parameters to see impact';
        let result = content.formula;
        Object.entries(values).forEach(([key, val]) => {
            result = result.replace(new RegExp(`\\{${key}\\}`, 'g'), String(val));
        });
        try { return eval(result); } catch { return result; }
    };

    return (
        <div className={`p-8 rounded-2xl border ${isDarkMode ? 'bg-gradient-to-br from-cyan-950/30 to-teal-950/30 border-cyan-500/20' : 'bg-gradient-to-br from-cyan-50 to-teal-50 border-cyan-200'}`} style={theme ? { backgroundColor: theme.surface, borderColor: theme.secondary } : {}}>
            <div className="flex items-center gap-3 mb-6">
                <span className="text-3xl">🎛️</span>
                <h4 className="text-lg font-bold uppercase tracking-widest" style={theme ? { color: theme.primary } : {}}>What-If Simulator</h4>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6 mb-8">
                {content.parameters.map((param: any) => (
                    <div key={param.id} className={`p-5 rounded-xl ${isDarkMode ? 'bg-white/5' : 'bg-white'}`}>
                        <div className="flex justify-between items-center mb-3">
                            <span className="text-sm font-medium opacity-80">{param.label}</span>
                            <span className="font-mono font-bold text-lg" style={theme ? { color: theme.accent } : {}}>
                                {param.prefix || ''}{values[param.id]}{param.suffix || ''}
                            </span>
                        </div>
                        <input
                            type="range"
                            min={param.min || 0}
                            max={param.max || 100}
                            step={param.step || 1}
                            value={values[param.id]}
                            onChange={(e) => setValues(prev => ({ ...prev, [param.id]: Number(e.target.value) }))}
                            className="w-full h-2 rounded-full appearance-none cursor-pointer"
                            style={{ background: theme ? `linear-gradient(to right, ${theme.primary}, ${theme.accent})` : undefined }}
                        />
                        <div className="flex justify-between text-[10px] mt-1 opacity-40">
                            <span>{param.minLabel || param.min}</span>
                            <span>{param.maxLabel || param.max}</span>
                        </div>
                    </div>
                ))}
            </div>

            <div className={`p-6 rounded-xl text-center ${isDarkMode ? 'bg-cyan-500/10 border border-cyan-500/30' : 'bg-cyan-100 border border-cyan-300'}`}>
                <div className="text-xs uppercase tracking-widest opacity-60 mb-2">Projected Outcome</div>
                <div className="text-3xl font-bold" style={theme ? { color: theme.primary } : {}}>{calculateOutput()}</div>
            </div>
        </div>
    );
};

// --- 3. VENN DIAGRAM (Dynamic Overlap) ---
const VennDiagramRenderer: React.FC<{ content: any; isDarkMode: boolean; theme?: ThemePalette }> = ({ content, isDarkMode, theme }) => {
    if (!content?.circles || content.circles.length < 2) return null;

    const circles = content.circles.slice(0, 3);
    const overlapPercentageRaw = typeof content.overlapStrength === 'number' ? content.overlapStrength : 50;
    const overlapPercentage = Math.max(0, Math.min(overlapPercentageRaw, 100));
    const baseOffset = 20 * (1 - overlapPercentage / 100);

    return (
        <div className={`p-8 rounded-2xl border ${isDarkMode ? 'bg-white/5 border-white/10' : 'bg-white border-gray-200'}`} style={theme ? { backgroundColor: theme.surface, borderColor: theme.secondary } : {}}>
            <div className="flex justify-center items-center min-h-[300px] relative">
                <svg viewBox="0 0 300 240" className="w-full max-w-lg">
                    <defs>
                        <filter id="glow"><feGaussianBlur stdDeviation="3" result="blur" /><feMerge><feMergeNode in="blur" /><feMergeNode in="SourceGraphic" /></feMerge></filter>
                    </defs>

                    {circles.map((circle: any, i: number) => {
                        const cx = i === 0 ? 100 : i === 1 ? 200 : 150;
                        const cy = i === 2 ? 140 : 80;

                        // Keep radius within a reasonable range so labels stay inside the viewBox
                        const baseRadius = 60;
                        const weightRadiusBoost = Math.min(20, (circle.weight || 0) * 0.1);
                        const radius = baseRadius + weightRadiusBoost;

                        const colors = [theme?.primary || '#3b82f6', theme?.accent || '#8b5cf6', theme?.secondary || '#10b981'];

                        // Fallback label if the model omitted it so every circle is named
                        const labelText = (circle.label && String(circle.label).trim())
                            ? String(circle.label).trim()
                            : i === 0
                                ? 'Segment A'
                                : i === 1
                                    ? 'Segment B'
                                    : 'Segment C';

                        // Clamp label Y positions so text is always visible within the SVG
                        const labelY = i === 2
                            ? Math.min(220, cy + radius + 14)
                            : Math.max(24, cy - radius - 10);

                        return (
                            <g key={i}>
                                <circle
                                    cx={cx - (i === 0 ? baseOffset : i === 1 ? -baseOffset : 0)}
                                    cy={cy}
                                    r={radius}
                                    fill={colors[i]}
                                    fillOpacity="0.3"
                                    stroke={colors[i]}
                                    strokeWidth="2"
                                    filter="url(#glow)"
                                    className="transition-all duration-500"
                                />
                                <text
                                    x={cx - (i === 0 ? baseOffset + 30 : i === 1 ? -baseOffset - 30 : 0)}
                                    y={labelY}
                                    textAnchor="middle"
                                    fill={theme?.text || (isDarkMode ? '#fff' : '#000')}
                                    className="text-xs font-bold uppercase"
                                >
                                    {labelText}
                                </text>
                            </g>
                        );
                    })}

                    {content.overlapLabel && (
                        <text x="150" y="100" textAnchor="middle" fill={theme?.primary || '#fff'} className="text-sm font-bold">
                            {content.overlapLabel}
                        </text>
                    )}
                </svg>
            </div>

            {content.insights && (
                <p className="mt-6 text-sm text-center opacity-70" style={theme ? { color: theme.text } : {}}>
                    {content.insights}
                </p>
            )}

            {content.analysis && (
                <p className="mt-6 text-sm text-center opacity-70" style={theme ? { color: theme.text } : {}}>
                    {content.analysis}
                </p>
            )}
        </div>
    );
};

// --- 4. SANKEY FLOW (Supply Chain / Journey) ---
const SankeyFlowRenderer: React.FC<{ content: any; isDarkMode: boolean; theme?: ThemePalette }> = ({ content, isDarkMode, theme }) => {
    if (!content?.nodes || !content?.flows) return null;

    return (
        <div className={`p-8 rounded-2xl border overflow-hidden ${isDarkMode ? 'bg-white/5 border-white/10' : 'bg-white border-gray-200'}`} style={theme ? { backgroundColor: theme.surface, borderColor: theme.secondary } : {}}>
            <div className="flex items-center gap-3 mb-6">
                <span className="text-3xl">🌊</span>
                <h4 className="text-lg font-bold uppercase tracking-widest" style={theme ? { color: theme.primary } : {}}>Flow Analysis</h4>
            </div>

            <div className="relative min-h-[200px]">
                <div className="flex justify-between items-stretch gap-4">
                    {content.nodes.map((stage: any, stageIdx: number) => (
                        <div key={stageIdx} className="flex-1 flex flex-col gap-2">
                            <div className="text-xs font-bold uppercase tracking-widest text-center opacity-50 mb-2">{stage.label}</div>
                            {stage.items?.map((item: any, itemIdx: number) => {
                                const flowValue = content.flows.find((f: any) => f.from === item.id)?.value || 50;
                                const height = Math.max(30, flowValue);
                                return (
                                    <div
                                        key={itemIdx}
                                        className={`rounded-lg p-3 flex items-center justify-between transition-all hover:scale-105 ${isDarkMode ? 'bg-white/10' : 'bg-gray-100'}`}
                                        style={{
                                            minHeight: height,
                                            borderLeft: `4px solid ${theme?.primary || '#3b82f6'}`,
                                            backgroundColor: theme ? theme.surface : undefined
                                        }}
                                    >
                                        <span className="text-sm font-medium">{item.label}</span>
                                        {item.value && <span className="text-xs font-mono opacity-60">{item.value}</span>}
                                    </div>
                                );
                            })}
                        </div>
                    ))}
                </div>

                {content.summary && (
                    <div className={`mt-6 p-4 rounded-xl text-center ${isDarkMode ? 'bg-amber-500/10 border border-amber-500/30' : 'bg-amber-50 border border-amber-200'}`}>
                        <span className="text-sm" style={theme ? { color: theme.text } : {}}>{content.summary}</span>
                    </div>
                )}
            </div>
        </div>
    );
};

// --- 5. BIAS RADAR (Spiderweb with Skew Detection) ---
const BiasRadarRenderer: React.FC<{ content: any; isDarkMode: boolean; theme?: ThemePalette }> = ({ content, isDarkMode, theme }) => {
    if (!content?.dimensions || content.dimensions.length < 3) return null;

    const dims = content.dimensions;
    const numDims = dims.length;
    const radius = 80;
    const center = 100;

    const getCoords = (value: number, i: number) => {
        const angle = (Math.PI * 2 * i) / numDims - Math.PI / 2;
        return {
            x: center + (value / 100) * radius * Math.cos(angle),
            y: center + (value / 100) * radius * Math.sin(angle)
        };
    };

    const idealPoints = dims.map((_: any, i: number) => {
        const { x, y } = getCoords(content.idealValue || 50, i);
        return `${x},${y}`;
    }).join(' ');

    const actualPoints = dims.map((d: any, i: number) => {
        const { x, y } = getCoords(d.value, i);
        return `${x},${y}`;
    }).join(' ');

    const maxSkew = Math.max(...dims.map((d: any) => Math.abs(d.value - (content.idealValue || 50))));
    const biasLevel = maxSkew > 30 ? 'High' : maxSkew > 15 ? 'Moderate' : 'Low';
    const biasColor = maxSkew > 30 ? '#ef4444' : maxSkew > 15 ? '#f59e0b' : '#10b981';

    return (
        <div className={`p-8 rounded-2xl border ${isDarkMode ? 'bg-white/5 border-white/10' : 'bg-white border-gray-200'}`} style={theme ? { backgroundColor: theme.surface, borderColor: theme.secondary } : {}}>
            <div className="flex items-center justify-between mb-6">
                <div className="flex items-center gap-3">
                    <span className="text-3xl">🕸️</span>
                    <h4 className="text-lg font-bold uppercase tracking-widest" style={theme ? { color: theme.primary } : {}}>Bias Detection</h4>
                </div>
                <div className={`px-4 py-2 rounded-full text-xs font-bold uppercase tracking-widest`} style={{ backgroundColor: biasColor + '20', color: biasColor }}>
                    {biasLevel} Bias Detected
                </div>
            </div>

            <div className="flex justify-center">
                <svg width="200" height="200" viewBox="0 0 200 200">
                    {[20, 40, 60, 80, 100].map((level) => (
                        <polygon
                            key={level}
                            points={dims.map((_: any, i: number) => {
                                const { x, y } = getCoords(level, i);
                                return `${x},${y}`;
                            }).join(' ')}
                            fill="none"
                            stroke={theme?.secondary || (isDarkMode ? '#ffffff20' : '#00000020')}
                            strokeWidth="1"
                        />
                    ))}

                    <polygon points={idealPoints} fill="none" stroke={theme?.accent || '#10b981'} strokeWidth="2" strokeDasharray="4,4" opacity="0.5" />
                    <polygon points={actualPoints} fill={biasColor} fillOpacity="0.2" stroke={biasColor} strokeWidth="2" />

                    {dims.map((d: any, i: number) => {
                        const { x, y } = getCoords(110, i);
                        return (
                            <text key={i} x={x} y={y} textAnchor="middle" dominantBaseline="middle" className="text-[10px] font-medium" fill={theme?.text || (isDarkMode ? '#fff' : '#000')}>
                                {d.label}
                            </text>
                        );
                    })}
                </svg>
            </div>

            {content.analysis && (
                <p className="mt-6 text-sm text-center opacity-70" style={theme ? { color: theme.text } : {}}>{content.analysis}</p>
            )}
        </div>
    );
};

// --- 6. INFLUENCE NETWORK (Force-Directed Graph) ---
const InfluenceNetworkRenderer: React.FC<{ content: any; isDarkMode: boolean; theme?: ThemePalette }> = ({ content, isDarkMode, theme }) => {
    const [hoveredNode, setHoveredNode] = useState<string | null>(null);

    if (!content?.nodes || !content?.connections) return null;

    const maxWeight = Math.max(...content.nodes.map((n: any) => n.weight || 1));

    return (
        <div className={`p-8 rounded-2xl border ${isDarkMode ? 'bg-gradient-to-br from-violet-950/30 to-fuchsia-950/30 border-violet-500/20' : 'bg-gradient-to-br from-violet-50 to-fuchsia-50 border-violet-200'}`} style={theme ? { backgroundColor: theme.surface, borderColor: theme.secondary } : {}}>
            <div className="flex items-center gap-3 mb-6">
                <span className="text-3xl">🔗</span>
                <h4 className="text-lg font-bold uppercase tracking-widest" style={theme ? { color: theme.primary } : {}}>Influence Network</h4>
            </div>

            <div className="relative min-h-[300px] flex items-center justify-center">
                <div className="relative w-full max-w-md aspect-square">
                    {content.nodes.map((node: any, i: number) => {
                        const angle = (2 * Math.PI * i) / content.nodes.length;
                        const radius = 40;
                        const x = 50 + radius * Math.cos(angle);
                        const y = 50 + radius * Math.sin(angle);
                        const size = 30 + (node.weight / maxWeight) * 40;
                        const isHovered = hoveredNode === node.id;

                        return (
                            <div
                                key={node.id}
                                className={`absolute transform -translate-x-1/2 -translate-y-1/2 rounded-full flex items-center justify-center cursor-pointer transition-all duration-300 ${isHovered ? 'z-20 scale-125' : 'z-10'}`}
                                style={{
                                    left: `${x}%`,
                                    top: `${y}%`,
                                    width: size,
                                    height: size,
                                    backgroundColor: theme?.primary || '#8b5cf6',
                                    boxShadow: isHovered ? `0 0 30px ${theme?.primary || '#8b5cf6'}` : 'none'
                                }}
                                onMouseEnter={() => setHoveredNode(node.id)}
                                onMouseLeave={() => setHoveredNode(null)}
                            >
                                <span className="text-white text-xs font-bold">{node.label?.substring(0, 2)}</span>
                            </div>
                        );
                    })}
                </div>
            </div>

            <div className="mt-6 grid grid-cols-2 md:grid-cols-4 gap-4">
                {content.nodes.map((node: any) => (
                    <div
                        key={node.id}
                        className={`p-3 rounded-lg text-center transition-all ${hoveredNode === node.id ? 'ring-2 ring-violet-500' : ''} ${isDarkMode ? 'bg-white/5' : 'bg-white'}`}
                        onMouseEnter={() => setHoveredNode(node.id)}
                        onMouseLeave={() => setHoveredNode(null)}
                    >
                        <div className="text-sm font-medium" style={theme ? { color: theme.text } : {}}>{node.label}</div>
                        <div className="text-xs opacity-50">Weight: {node.weight || 1}</div>
                    </div>
                ))}
            </div>
        </div>
    );
};

// --- 7. ROOT CAUSE TREE (Recursive Branches) ---
const RootCauseTreeRenderer: React.FC<{ content: any; isDarkMode: boolean; theme?: ThemePalette }> = ({ content, isDarkMode, theme }) => {
    const [expanded, setExpanded] = useState<Set<string>>(new Set(['root']));

    if (!content?.root) return null;

    const toggleNode = (id: string) => {
        setExpanded(prev => {
            const next = new Set(prev);
            if (next.has(id)) next.delete(id);
            else next.add(id);
            return next;
        });
    };

    const renderNode = (node: any, level: number = 0) => {
        const hasChildren = node.causes && node.causes.length > 0;
        const isExpanded = expanded.has(node.id);

        return (
            <div key={node.id} className="relative">
                <div
                    className={`flex items-center gap-3 p-4 rounded-xl mb-2 cursor-pointer transition-all hover:scale-[1.02] ${isDarkMode ? 'bg-white/5 hover:bg-white/10' : 'bg-gray-50 hover:bg-gray-100'}`}
                    style={{
                        marginLeft: level * 24,
                        borderLeft: `3px solid ${level === 0 ? (theme?.primary || '#ef4444') : (theme?.secondary || '#6b7280')}`
                    }}
                    onClick={() => hasChildren && toggleNode(node.id)}
                >
                    {hasChildren && (
                        <span className={`transition-transform ${isExpanded ? 'rotate-90' : ''}`}>▶</span>
                    )}
                    <div className="flex-1">
                        <div className="font-medium" style={theme ? { color: theme.text } : {}}>{node.label}</div>
                        {node.description && <div className="text-xs opacity-60 mt-1">{node.description}</div>}
                    </div>
                    {node.severity && (
                        <span className={`px-2 py-1 rounded text-xs font-bold ${node.severity === 'high' ? 'bg-red-500/20 text-red-500' :
                            node.severity === 'medium' ? 'bg-amber-500/20 text-amber-500' :
                                'bg-green-500/20 text-green-500'
                            }`}>
                            {node.severity}
                        </span>
                    )}
                </div>

                {hasChildren && isExpanded && (
                    <div className="animate-fade-in">
                        {node.causes.map((cause: any) => renderNode(cause, level + 1))}
                    </div>
                )}
            </div>
        );
    };

    return (
        <div className={`p-8 rounded-2xl border ${isDarkMode ? 'bg-white/5 border-white/10' : 'bg-white border-gray-200'}`} style={theme ? { backgroundColor: theme.surface, borderColor: theme.secondary } : {}}>
            <div className="flex items-center gap-3 mb-6">
                <span className="text-3xl">🌳</span>
                <h4 className="text-lg font-bold uppercase tracking-widest" style={theme ? { color: theme.primary } : {}}>Root Cause Analysis</h4>
            </div>
            {renderNode(content.root)}
        </div>
    );
};

// --- 8. SENTIMENT TIMELINE (EKG-Style) ---
const SentimentTimelineRenderer: React.FC<{ content: any; isDarkMode: boolean; theme?: ThemePalette }> = ({ content, isDarkMode, theme }) => {
    if (!content?.dataPoints || content.dataPoints.length < 2) return null;

    const points = content.dataPoints;
    const width = 600;
    const height = 200;
    const padding = 40;

    const xScale = (i: number) => padding + (i / (points.length - 1)) * (width - 2 * padding);
    const yScale = (value: number) => height - padding - ((value + 100) / 200) * (height - 2 * padding);

    const pathD = points.map((p: any, i: number) => {
        const x = xScale(i);
        const y = yScale(p.value);
        return i === 0 ? `M ${x} ${y}` : `L ${x} ${y}`;
    }).join(' ');

    return (
        <div className={`p-8 rounded-2xl border overflow-hidden ${isDarkMode ? 'bg-white/5 border-white/10' : 'bg-white border-gray-200'}`} style={theme ? { backgroundColor: theme.surface, borderColor: theme.secondary } : {}}>
            <div className="flex items-center gap-3 mb-6">
                <span className="text-3xl">💓</span>
                <h4 className="text-lg font-bold uppercase tracking-widest" style={theme ? { color: theme.primary } : {}}>Sentiment Analysis</h4>
            </div>

            <div className="overflow-x-auto">
                <svg viewBox={`0 0 ${width} ${height}`} className="w-full min-w-[500px]">
                    <line x1={padding} y1={height / 2} x2={width - padding} y2={height / 2} stroke={theme?.secondary || '#666'} strokeWidth="1" strokeDasharray="4,4" opacity="0.5" />
                    <text x={padding - 10} y={padding} textAnchor="end" className="text-[10px]" fill={theme?.text || (isDarkMode ? '#fff' : '#000')}>+100</text>
                    <text x={padding - 10} y={height - padding} textAnchor="end" className="text-[10px]" fill={theme?.text || (isDarkMode ? '#fff' : '#000')}>-100</text>

                    <defs>
                        <linearGradient id="sentimentGradient" x1="0%" y1="0%" x2="0%" y2="100%">
                            <stop offset="0%" stopColor="#10b981" />
                            <stop offset="50%" stopColor="#6b7280" />
                            <stop offset="100%" stopColor="#ef4444" />
                        </linearGradient>
                    </defs>

                    <path d={pathD} fill="none" stroke="url(#sentimentGradient)" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" />

                    {points.map((p: any, i: number) => {
                        const x = xScale(i);
                        const y = yScale(p.value);
                        const color = p.value > 20 ? '#10b981' : p.value < -20 ? '#ef4444' : '#6b7280';

                        return (
                            <g key={i}>
                                <circle cx={x} cy={y} r="6" fill={color} stroke={isDarkMode ? '#1f1f1f' : '#fff'} strokeWidth="2" />
                                {p.event && (
                                    <text x={x} y={height - 10} textAnchor="middle" className="text-[8px]" fill={theme?.text || (isDarkMode ? '#fff' : '#000')}>
                                        {p.date}
                                    </text>
                                )}
                            </g>
                        );
                    })}
                </svg>
            </div>

            {content.annotations && (
                <div className="mt-6 grid grid-cols-1 md:grid-cols-3 gap-4">
                    {content.annotations.map((a: any, i: number) => (
                        <div key={i} className={`p-3 rounded-lg ${isDarkMode ? 'bg-white/5' : 'bg-gray-50'}`}>
                            <div className="text-xs font-bold uppercase opacity-50">{a.date}</div>
                            <div className="text-sm mt-1" style={theme ? { color: theme.text } : {}}>{a.event}</div>
                        </div>
                    ))}
                </div>
            )}
        </div>
    );
};

// --- 9. INSIGHT CARDS (Tinder-Style Swipe) ---
const InsightCardsRenderer: React.FC<{ content: any; isDarkMode: boolean; theme?: ThemePalette }> = ({ content, isDarkMode, theme }) => {
    const [currentIndex, setCurrentIndex] = useState(0);
    const [saved, setSaved] = useState<number[]>([]);
    const [direction, setDirection] = useState<'left' | 'right' | null>(null);

    if (!content?.cards || content.cards.length === 0) return null;

    const handleSwipe = (dir: 'left' | 'right') => {
        setDirection(dir);
        if (dir === 'right') setSaved(prev => [...prev, currentIndex]);

        setTimeout(() => {
            setDirection(null);
            if (currentIndex < content.cards.length - 1) {
                setCurrentIndex(prev => prev + 1);
            }
        }, 300);
    };

    const currentCard = content.cards[currentIndex];
    const isComplete = currentIndex >= content.cards.length;

    return (
        <div className={`p-8 rounded-2xl border ${isDarkMode ? 'bg-gradient-to-br from-pink-950/30 to-rose-950/30 border-pink-500/20' : 'bg-gradient-to-br from-pink-50 to-rose-50 border-pink-200'}`} style={theme ? { backgroundColor: theme.surface, borderColor: theme.secondary } : {}}>
            <div className="flex items-center justify-between mb-6">
                <div className="flex items-center gap-3">
                    <span className="text-3xl">💡</span>
                    <h4 className="text-lg font-bold uppercase tracking-widest" style={theme ? { color: theme.primary } : {}}>Key Insights</h4>
                </div>
                <span className="text-sm opacity-50">{saved.length} saved</span>
            </div>

            {!isComplete ? (
                <>
                    <div className={`relative min-h-[200px] flex items-center justify-center transition-all duration-300 ${direction === 'left' ? '-translate-x-full opacity-0 rotate-[-10deg]' :
                        direction === 'right' ? 'translate-x-full opacity-0 rotate-[10deg]' : ''
                        }`}>
                        <div className={`w-full max-w-md p-8 rounded-2xl shadow-2xl ${isDarkMode ? 'bg-white/10' : 'bg-white'}`}>
                            {currentCard.icon && <div className="text-4xl mb-4">{currentCard.icon}</div>}
                            <h5 className="text-xl font-bold mb-3" style={theme ? { color: theme.primary } : {}}>{currentCard.title}</h5>
                            <p className="text-sm leading-relaxed opacity-80" style={theme ? { color: theme.text } : {}}>{currentCard.content}</p>
                            {currentCard.source && (
                                <div className="mt-4 text-xs opacity-50">Source: {currentCard.source}</div>
                            )}
                        </div>
                    </div>

                    <div className="flex justify-center gap-8 mt-8">
                        <button
                            onClick={() => handleSwipe('left')}
                            className="w-16 h-16 rounded-full flex items-center justify-center bg-red-500/20 text-red-500 text-2xl hover:bg-red-500 hover:text-white transition-all"
                        >
                            ✕
                        </button>
                        <button
                            onClick={() => handleSwipe('right')}
                            className="w-16 h-16 rounded-full flex items-center justify-center bg-green-500/20 text-green-500 text-2xl hover:bg-green-500 hover:text-white transition-all"
                        >
                            ✓
                        </button>
                    </div>

                    <div className="flex justify-center gap-1 mt-6">
                        {content.cards.map((_: any, i: number) => (
                            <div
                                key={i}
                                className={`w-2 h-2 rounded-full transition-all ${i === currentIndex ? 'w-6' : ''
                                    } ${i < currentIndex ? 'bg-green-500' : i === currentIndex ? (theme?.primary || 'bg-pink-500') : 'bg-gray-400/30'
                                    }`}
                                style={i === currentIndex ? { backgroundColor: theme?.primary } : {}}
                            />
                        ))}
                    </div>
                </>
            ) : (
                <div className="text-center py-12">
                    <div className="text-6xl mb-4">🎉</div>
                    <h5 className="text-xl font-bold mb-2" style={theme ? { color: theme.primary } : {}}>All Done!</h5>
                    <p className="opacity-60">You saved {saved.length} insights</p>
                </div>
            )}
        </div>
    );
};

// ============================================
// NEW ARTS & CULTURE WIDGET RENDERERS
// ============================================

// --- POETRY DISPLAY RENDERER ---
const PoetryDisplayRenderer: React.FC<{ content: any; isDarkMode: boolean; theme?: ThemePalette }> = ({ content, isDarkMode, theme }) => {
    if (!content?.lines) return null;

    const isHaiku = content.style === 'haiku';
    const isSonnet = content.style === 'sonnet';

    return (
        <div className={`p-10 rounded-2xl border relative overflow-hidden ${isDarkMode ? 'bg-zinc-900 border-zinc-800' : 'bg-stone-50 border-stone-200'}`} style={theme ? { backgroundColor: theme.surface, borderColor: theme.secondary } : {}}>
            <div className="absolute top-0 right-0 p-6 opacity-10 text-9xl font-serif">❝</div>

            <div className={`relative z-10 ${isHaiku ? 'text-center' : ''}`}>
                <h3 className="text-xl font-bold mb-1 font-serif" style={theme ? { color: theme.primary } : {}}>{content.title}</h3>
                <div className="text-sm opacity-60 mb-8 italic">by {content.author}</div>

                <div className={`space-y-3 font-serif text-lg leading-relaxed ${isSonnet ? 'pl-8 border-l-2 border-rose-500/30' : ''}`}>
                    {content.lines.map((line: string, i: number) => (
                        <p key={i} className="opacity-90" style={theme ? { color: theme.text } : {}}>{line}</p>
                    ))}
                </div>

                {content.annotation && (
                    <div className={`mt-8 p-4 rounded-lg text-sm italic opacity-80 ${isDarkMode ? 'bg-white/5' : 'bg-black/5'}`}>
                        Note: {content.annotation}
                    </div>
                )}
            </div>
        </div>
    );
};

// --- MUSIC PLAYER RENDERER ---
const MusicPlayerRenderer: React.FC<{ content: any; isDarkMode: boolean; theme?: ThemePalette }> = ({ content, isDarkMode, theme }) => {
    const [playing, setPlaying] = useState<number | null>(null);
    if (!content?.tracks) return null;

    return (
        <GlassCard isDarkMode={isDarkMode} theme={theme} className="p-0 overflow-hidden">
            <div className={`p-6 border-b ${isDarkMode ? 'border-white/10 bg-gradient-to-r from-emerald-900/40 to-teal-900/40' : 'border-black/5 bg-gradient-to-r from-emerald-50 to-teal-50'}`}>
                <div className="flex items-center gap-4">
                    <div className="w-16 h-16 rounded-lg shadow-lg bg-gradient-to-br from-emerald-400 to-teal-600 flex items-center justify-center text-3xl text-white">
                        🎵
                    </div>
                    <div>
                        <div className="text-xs font-bold uppercase tracking-widest opacity-60 mb-1">Playlist</div>
                        <h3 className="text-xl font-bold" style={theme ? { color: theme.text } : {}}>{content.playlistName || 'Recommended Tracks'}</h3>
                        <div className="text-sm opacity-60">{content.tracks.length} songs</div>
                    </div>
                </div>
            </div>

            <div className="divide-y divide-white/5">
                {content.tracks.map((track: any, i: number) => (
                    <div key={i} className={`p-4 flex items-center gap-4 hover:bg-white/5 transition-colors group ${playing === i ? 'bg-white/5' : ''}`}>
                        <div className="w-8 text-center text-sm opacity-40 font-mono">{i + 1}</div>
                        <div className="flex-1 min-w-0">
                            <div className={`font-medium truncate ${playing === i ? 'text-emerald-500' : ''}`} style={playing === i && theme ? { color: theme.primary } : {}}>{track.title}</div>
                            <div className="text-xs opacity-60 truncate">{track.artist} • {track.album || 'Single'}</div>
                        </div>
                        <button
                            onClick={() => setPlaying(playing === i ? null : i)}
                            className={`w-10 h-10 rounded-full flex items-center justify-center transition-all ${playing === i ? 'bg-emerald-500 text-white' : 'bg-white/10 hover:bg-white/20'}`}
                            style={playing === i && theme ? { backgroundColor: theme.primary } : {}}
                        >
                            {playing === i ? '⏸' : '▶'}
                        </button>
                    </div>
                ))}
            </div>
        </GlassCard>
    );
};

// --- ARTWORK GALLERY RENDERER ---
const ArtworkGalleryRenderer: React.FC<{ content: any; isDarkMode: boolean; theme?: ThemePalette }> = ({ content, isDarkMode, theme }) => {
    const [artImages, setArtImages] = useState<Record<number, string>>({});

    useEffect(() => {
        if (content?.works) {
            content.works.forEach((work: any, i: number) => {
                if (!work.imageUrl && !artImages[i]) {
                    import('../services/imageSearchService').then(({ searchImages }) => {
                        searchImages(`${work.title} by ${work.artist} artwork`, 1).then(results => {
                            if (results && results.length > 0) {
                                setArtImages(prev => ({ ...prev, [i]: results[0].thumbnail.src }));
                            }
                        });
                    });
                }
            });
        }
    }, [content?.works]);

    if (!content?.works) return null;

    return (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            {content.works.map((work: any, i: number) => (
                <div key={i} className={`group relative rounded-xl overflow-hidden shadow-2xl ${isDarkMode ? 'bg-black' : 'bg-white'}`}>
                    <div className="aspect-[3/4] overflow-hidden bg-gray-200 dark:bg-gray-800">
                        <img
                            src={work.imageUrl || artImages[i] || `https://placehold.co/600x800/1a1a1a/FFF?text=${encodeURIComponent(work.title)}`}
                            alt={work.title}
                            className="w-full h-full object-cover transition-transform duration-700 group-hover:scale-110"
                            onError={(e) => { (e.target as HTMLImageElement).src = 'https://placehold.co/600x800/1a1a1a/FFF?text=Art'; }}
                        />
                        <div className="absolute inset-0 bg-gradient-to-t from-black/90 via-black/20 to-transparent opacity-0 group-hover:opacity-100 transition-opacity duration-300 flex flex-col justify-end p-6">
                            <h4 className="text-white font-bold text-lg translate-y-4 group-hover:translate-y-0 transition-transform duration-300">{work.title}</h4>
                            <p className="text-white/80 text-sm translate-y-4 group-hover:translate-y-0 transition-transform duration-300 delay-75">{work.artist}, {work.year}</p>
                            {work.description && (
                                <p className="text-white/60 text-xs mt-2 line-clamp-2 translate-y-4 group-hover:translate-y-0 transition-transform duration-300 delay-100">{work.description}</p>
                            )}
                        </div>
                    </div>
                </div>
            ))}
        </div>
    );
};

// --- BOOK SHELF RENDERER ---
const BookShelfRenderer: React.FC<{ content: any; isDarkMode: boolean; theme?: ThemePalette }> = ({ content, isDarkMode, theme }) => {
    if (!content?.books) return null;

    return (
        <div className={`p-8 rounded-2xl border ${isDarkMode ? 'bg-[#2e2e2e] border-[#3e3e3e]' : 'bg-[#f5f5f0] border-[#e5e5e0]'}`} style={theme ? { backgroundColor: theme.surface, borderColor: theme.secondary } : {}}>
            <div className="flex items-center gap-3 mb-8 border-b pb-4 border-black/10 dark:border-white/10">
                <span className="text-3xl">📚</span>
                <h4 className="text-lg font-bold uppercase tracking-widest" style={theme ? { color: theme.primary } : {}}>Reading List</h4>
            </div>

            <div className="flex gap-6 overflow-x-auto pb-8 snap-x">
                {content.books.map((book: any, i: number) => (
                    <div key={i} className="snap-center shrink-0 w-[160px] group perspective-1000">
                        <div className="w-full aspect-[2/3] rounded-r-md rounded-l-sm shadow-xl mb-4 relative transform transition-transform duration-500 group-hover:-translate-y-2 group-hover:rotate-y-[-10deg] origin-left"
                            style={{ background: `linear-gradient(to right, #1a1a1a 0%, ${['#3b82f6', '#ef4444', '#10b981', '#f59e0b'][i % 4]} 5%, ${['#3b82f6', '#ef4444', '#10b981', '#f59e0b'][i % 4]} 100%)` }}>
                            <div className="absolute inset-y-0 left-0 w-2 bg-white/10 z-10"></div>
                            <div className="absolute inset-0 flex flex-col items-center justify-center p-4 text-center text-white">
                                <div className="text-xs opacity-70 mb-1">{book.author}</div>
                                <div className="font-serif font-bold leading-tight">{book.title}</div>
                            </div>
                        </div>
                        <div className="text-center">
                            <div className="font-bold text-sm truncate" style={theme ? { color: theme.text } : {}}>{book.title}</div>
                            <div className="text-xs opacity-60 truncate">{book.author}</div>
                            {book.rating && (
                                <div className="text-xs text-amber-500 mt-1">{'★'.repeat(Math.round(book.rating))}</div>
                            )}
                        </div>
                    </div>
                ))}
            </div>
        </div>
    );
};

// --- CREATIVE SHOWCASE RENDERER ---
const CreativeShowcaseRenderer: React.FC<{ content: any; isDarkMode: boolean; theme?: ThemePalette }> = ({ content, isDarkMode, theme }) => {
    if (!content?.items) return null;

    return (
        <div className="columns-1 md:columns-2 gap-6 space-y-6">
            {content.items.map((item: any, i: number) => (
                <div key={i} className={`break-inside-avoid rounded-2xl overflow-hidden border shadow-lg ${isDarkMode ? 'bg-zinc-900 border-zinc-800' : 'bg-white border-gray-100'}`}>
                    <div className="aspect-video bg-gray-100 dark:bg-gray-800 relative">
                        {item.imageUrl && (
                            <img src={item.imageUrl} alt={item.title} className="w-full h-full object-cover" />
                        )}
                        <div className="absolute top-3 right-3 bg-black/50 backdrop-blur-md text-white text-xs px-2 py-1 rounded-full">
                            {item.materials?.length || 0} materials
                        </div>
                    </div>
                    <div className="p-5">
                        <h4 className="font-bold text-lg mb-2" style={theme ? { color: theme.primary } : {}}>{item.title}</h4>
                        <p className="text-sm opacity-70 mb-4 leading-relaxed" style={theme ? { color: theme.text } : {}}>{item.description}</p>

                        {item.materials && (
                            <div className="flex flex-wrap gap-2">
                                {item.materials.map((mat: string, idx: number) => (
                                    <span key={idx} className={`text-[10px] px-2 py-1 rounded-md uppercase tracking-wider font-bold ${isDarkMode ? 'bg-white/10' : 'bg-black/5'}`}>
                                        {mat}
                                    </span>
                                ))}
                            </div>
                        )}
                    </div>
                </div>
            ))}
        </div>
    );
};

// ============================================
// NEW SCIENCE & DISCOVERY WIDGET RENDERERS
// ============================================

// --- PERIODIC ELEMENT RENDERER ---
const PeriodicElementRenderer: React.FC<{ content: any; isDarkMode: boolean; theme?: ThemePalette }> = ({ content, isDarkMode, theme }) => {
    const [elementImages, setElementImages] = useState<Record<string, string>>({});

    useEffect(() => {
        if (content?.elements) {
            content.elements.forEach((el: any) => {
                if (!elementImages[el.symbol]) {
                    import('../services/imageSearchService').then(({ searchImages }) => {
                        searchImages(`${el.name} element chemical sample`, 1).then(results => {
                            if (results && results.length > 0) {
                                setElementImages(prev => ({ ...prev, [el.symbol]: results[0].thumbnail.src }));
                            }
                        });
                    });
                }
            });
        }
    }, [content?.elements]);

    if (!content?.elements) return null;

    return (
        <div className="flex flex-wrap justify-center gap-4">
            {content.elements.map((el: any, i: number) => (
                <div key={i} className={`relative w-32 h-40 p-2 rounded-lg border-2 flex flex-col items-center justify-between transition-transform hover:scale-110 hover:z-10 cursor-pointer overflow-hidden ${isDarkMode ? 'bg-gray-900 border-gray-700' : 'bg-white border-gray-300'}`}
                    style={{ borderColor: theme?.primary }}>

                    {/* Background Image (Low Opacity) */}
                    {elementImages[el.symbol] && (
                        <div className="absolute inset-0 opacity-20 pointer-events-none">
                            <img src={elementImages[el.symbol]} alt={el.name} className="w-full h-full object-cover" />
                        </div>
                    )}

                    <div className="w-full flex justify-between text-[10px] font-mono opacity-60 z-10">
                        <span>{el.number}</span>
                        <span>{el.category?.substring(0, 1).toUpperCase()}</span>
                    </div>
                    <div className="text-4xl font-bold font-serif z-10" style={{ color: theme?.primary }}>{el.symbol}</div>
                    <div className="text-center z-10">
                        <div className="text-xs font-bold">{el.name}</div>
                        <div className="text-[9px] opacity-60 truncate max-w-full">{el.fact}</div>
                    </div>
                </div>
            ))}
        </div>
    );
};

// --- DISCOVERY TIMELINE RENDERER ---
const DiscoveryTimelineRenderer: React.FC<{ content: any; isDarkMode: boolean; theme?: ThemePalette }> = ({ content, isDarkMode, theme }) => {
    if (!content?.discoveries) return null;

    return (
        <div className={`p-8 rounded-2xl border ${isDarkMode ? 'bg-slate-900 border-slate-800' : 'bg-slate-50 border-slate-200'}`} style={theme ? { backgroundColor: theme.surface, borderColor: theme.secondary } : {}}>
            <div className="relative border-l-2 border-dashed ml-4 space-y-8" style={{ borderColor: theme?.primary || '#3b82f6' }}>
                {content.discoveries.map((d: any, i: number) => (
                    <div key={i} className="relative pl-8 group">
                        <div className="absolute -left-[9px] top-0 w-4 h-4 rounded-full border-4 border-white dark:border-slate-900 bg-blue-500 transition-transform group-hover:scale-150" style={{ backgroundColor: theme?.primary }}></div>
                        <div className="flex flex-col sm:flex-row sm:items-baseline gap-2 mb-1">
                            <span className="text-2xl font-bold font-mono" style={{ color: theme?.primary }}>{d.year}</span>
                            <h4 className="text-lg font-bold">{d.title}</h4>
                        </div>
                        <div className="text-sm font-medium opacity-80 mb-2">by {d.scientist}</div>
                        <div className={`p-4 rounded-xl text-sm leading-relaxed ${isDarkMode ? 'bg-white/5' : 'bg-white shadow-sm'}`}>
                            {d.significance}
                        </div>
                    </div>
                ))}
            </div>
        </div>
    );
};

// --- FORMULA DISPLAY RENDERER ---
const FormulaDisplayRenderer: React.FC<{ content: any; isDarkMode: boolean; theme?: ThemePalette }> = ({ content, isDarkMode, theme }) => {
    if (!content?.formulas) return null;

    return (
        <div className="grid grid-cols-1 gap-6">
            {content.formulas.map((f: any, i: number) => (
                <div key={i} className={`p-6 rounded-xl border ${isDarkMode ? 'bg-gray-900 border-gray-800' : 'bg-white border-gray-200 shadow-sm'}`}>
                    <div className="flex items-center gap-3 mb-4">
                        <span className="text-2xl">∑</span>
                        <h4 className="font-bold text-lg">{f.name}</h4>
                    </div>

                    <div className={`p-6 rounded-lg mb-4 text-center font-serif text-2xl overflow-x-auto ${isDarkMode ? 'bg-black/30' : 'bg-gray-50'}`}>
                        {f.latex}
                    </div>

                    <p className="text-sm opacity-80 mb-4">{f.explanation}</p>

                    {f.variables && (
                        <div className="grid grid-cols-2 gap-2 text-xs">
                            {f.variables.map((v: any, idx: number) => (
                                <div key={idx} className="flex items-center gap-2">
                                    <span className="font-mono font-bold opacity-60">{v.symbol}</span>
                                    <span>= {v.meaning}</span>
                                </div>
                            ))}
                        </div>
                    )}
                </div>
            ))}
        </div>
    );
};

// --- ANATOMY EXPLORER RENDERER ---
const AnatomyExplorerRenderer: React.FC<{ content: any; isDarkMode: boolean; theme?: ThemePalette }> = ({ content, isDarkMode, theme }) => {
    const [activePart, setActivePart] = useState<number | null>(null);
    if (!content?.parts) return null;

    return (
        <div className="flex flex-col md:flex-row gap-8 items-start">
            <div className="flex-1 grid grid-cols-1 gap-2">
                {content.parts.map((part: any, i: number) => (
                    <div
                        key={i}
                        onMouseEnter={() => setActivePart(i)}
                        onMouseLeave={() => setActivePart(null)}
                        className={`p-4 rounded-xl cursor-pointer transition-all border ${activePart === i ? 'ring-2 ring-blue-500 scale-[1.02]' : 'border-transparent'} ${isDarkMode ? 'bg-white/5 hover:bg-white/10' : 'bg-gray-50 hover:bg-gray-100'}`}
                    >
                        <div className="flex justify-between items-center mb-1">
                            <span className="font-bold">{part.name}</span>
                            <span className="text-[10px] uppercase tracking-wider opacity-50">{part.location}</span>
                        </div>
                        <div className={`text-sm opacity-70 transition-all ${activePart === i ? 'max-h-20' : 'max-h-0 overflow-hidden md:max-h-20'}`}>
                            {part.function}
                        </div>
                    </div>
                ))}
            </div>

            <div className={`w-full md:w-1/3 aspect-[3/4] rounded-2xl flex items-center justify-center relative overflow-hidden ${isDarkMode ? 'bg-blue-900/20' : 'bg-blue-50'}`}>
                <div className="absolute inset-0 opacity-10 bg-[url('https://www.transparenttextures.com/patterns/graphy.png')]"></div>
                <div className="text-center p-6">
                    <div className="text-6xl mb-4">🧬</div>
                    <div className="font-bold text-xl uppercase tracking-widest opacity-50">{content.system || 'System'}</div>
                    {activePart !== null && (
                        <div className="mt-8 animate-fade-in">
                            <div className="text-2xl font-bold text-blue-500">{content.parts[activePart].name}</div>
                            <div className="text-sm opacity-60 mt-2">Highlighting location...</div>
                        </div>
                    )}
                </div>
            </div>
        </div>
    );
};

// --- EXPERIMENT STEPS RENDERER ---
const ExperimentStepsRenderer: React.FC<{ content: any; isDarkMode: boolean; theme?: ThemePalette }> = ({ content, isDarkMode, theme }) => {
    if (!content?.steps) return null;

    return (
        <div className={`p-8 rounded-2xl border ${isDarkMode ? 'bg-amber-950/10 border-amber-900/20' : 'bg-amber-50 border-amber-100'}`} style={theme ? { backgroundColor: theme.surface, borderColor: theme.secondary } : {}}>
            <div className="flex items-center gap-3 mb-6">
                <span className="text-3xl">🧪</span>
                <h4 className="text-lg font-bold uppercase tracking-widest" style={theme ? { color: theme.primary } : {}}>Experiment Protocol</h4>
            </div>

            {content.materials && (
                <div className="mb-8 flex flex-wrap gap-2">
                    {content.materials.map((m: string, i: number) => (
                        <span key={i} className={`px-3 py-1 rounded-full text-xs font-bold border ${isDarkMode ? 'bg-black/20 border-white/10' : 'bg-white border-gray-200'}`}>
                            {m}
                        </span>
                    ))}
                </div>
            )}

            <div className="space-y-6">
                {content.steps.map((step: any, i: number) => (
                    <div key={i} className="flex gap-4">
                        <div className="flex flex-col items-center">
                            <div className={`w-8 h-8 rounded-full flex items-center justify-center font-bold text-sm ${isDarkMode ? 'bg-amber-500/20 text-amber-500' : 'bg-amber-100 text-amber-700'}`}>
                                {i + 1}
                            </div>
                            {i < content.steps.length - 1 && <div className="w-0.5 flex-1 bg-amber-500/20 my-2"></div>}
                        </div>
                        <div className="flex-1 pb-4">
                            <p className="font-medium mb-2">{step.instruction}</p>
                            {step.tip && (
                                <div className={`p-3 rounded-lg text-sm flex gap-2 ${isDarkMode ? 'bg-blue-900/20 text-blue-200' : 'bg-blue-50 text-blue-800'}`}>
                                    <span>💡</span>
                                    <span>{step.tip}</span>
                                </div>
                            )}
                        </div>
                    </div>
                ))}
            </div>

            {content.safetyNotes && (
                <div className={`mt-6 p-4 rounded-xl border border-red-500/30 ${isDarkMode ? 'bg-red-900/10' : 'bg-red-50'}`}>
                    <h5 className="text-red-500 font-bold text-sm uppercase tracking-widest mb-2">Safety First</h5>
                    <ul className="list-disc list-inside text-sm opacity-80 space-y-1">
                        {content.safetyNotes.map((note: string, i: number) => (
                            <li key={i}>{note}</li>
                        ))}
                    </ul>
                </div>
            )}
        </div>
    );
};

// ============================================
// NEW LOCAL & EVENTS WIDGET RENDERERS
// ============================================

// --- EVENT CALENDAR RENDERER ---
const EventCalendarRenderer: React.FC<{ content: any; isDarkMode: boolean; theme?: ThemePalette }> = ({ content, isDarkMode, theme }) => {
    if (!content?.events) return null;

    return (
        <div className={`p-6 rounded-2xl border ${isDarkMode ? 'bg-white/5 border-white/10' : 'bg-white border-gray-200'}`} style={theme ? { backgroundColor: theme.surface, borderColor: theme.secondary } : {}}>
            <div className="flex items-center gap-3 mb-6">
                <span className="text-3xl">📅</span>
                <h4 className="text-lg font-bold uppercase tracking-widest" style={theme ? { color: theme.primary } : {}}>Upcoming Events</h4>
            </div>

            <div className="space-y-4">
                {content.events.map((event: any, i: number) => (
                    <div key={i} className={`flex flex-col md:flex-row gap-4 p-4 rounded-xl border transition-all hover:scale-[1.01] ${isDarkMode ? 'bg-white/5 border-white/10 hover:bg-white/10' : 'bg-gray-50 border-gray-100 hover:bg-gray-100'}`}>
                        <div className={`flex flex-col items-center justify-center p-3 rounded-lg min-w-[80px] ${isDarkMode ? 'bg-white/10' : 'bg-white shadow-sm'}`}>
                            <span className="text-xs font-bold uppercase opacity-60">{new Date(event.date).toLocaleString('default', { month: 'short' })}</span>
                            <span className="text-2xl font-bold">{new Date(event.date).getDate()}</span>
                            <span className="text-xs opacity-60">{event.time}</span>
                        </div>
                        <div className="flex-1">
                            <div className="flex justify-between items-start">
                                <h5 className="font-bold text-lg" style={theme ? { color: theme.primary } : {}}>{event.name}</h5>
                                {event.price && <span className="text-xs font-bold px-2 py-1 rounded bg-green-500/20 text-green-600">{event.price}</span>}
                            </div>
                            <div className="flex items-center gap-2 text-sm opacity-70 mt-1">
                                <span>📍</span>
                                <span>{event.venue}</span>
                                {event.address && <span className="opacity-60">• {event.address}</span>}
                            </div>
                            {event.category && (
                                <div className="mt-3">
                                    <span className="text-[10px] px-2 py-1 rounded-full uppercase tracking-wider font-bold opacity-60 border border-current">{event.category}</span>
                                </div>
                            )}
                        </div>
                        {event.ticketUrl && (
                            <div className="flex items-center">
                                <a href={event.ticketUrl} target="_blank" rel="noopener noreferrer" className={`px-4 py-2 rounded-lg text-sm font-bold transition-colors ${isDarkMode ? 'bg-white text-black hover:bg-gray-200' : 'bg-black text-white hover:bg-gray-800'}`} style={theme ? { backgroundColor: theme.primary, color: theme.surface } : {}}>
                                    Get Tickets
                                </a>
                            </div>
                        )}
                    </div>
                ))}
            </div>
        </div>
    );
};

// --- VENUE CARDS RENDERER ---
const VenueCardsRenderer: React.FC<{ content: any; isDarkMode: boolean; theme?: ThemePalette }> = ({ content, isDarkMode, theme }) => {
    if (!content?.venues) return null;

    return (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
            {content.venues.map((venue: any, i: number) => (
                <div key={i} className={`group rounded-2xl overflow-hidden border shadow-lg transition-all hover:-translate-y-1 ${isDarkMode ? 'bg-zinc-900 border-zinc-800' : 'bg-white border-gray-100'}`}>
                    <div className="aspect-video bg-gray-200 dark:bg-gray-800 relative">
                        {venue.imageUrl ? (
                            <img src={venue.imageUrl} alt={venue.name} className="w-full h-full object-cover" />
                        ) : (
                            <div className="w-full h-full flex items-center justify-center text-4xl opacity-20">🏢</div>
                        )}
                        {venue.rating && (
                            <div className="absolute top-3 right-3 bg-white text-black px-2 py-1 rounded-lg font-bold text-xs shadow-lg flex items-center gap-1">
                                <span>★</span> {venue.rating}
                            </div>
                        )}
                    </div>
                    <div className="p-5">
                        <div className="flex justify-between items-start mb-2">
                            <h4 className="font-bold text-lg" style={theme ? { color: theme.primary } : {}}>{venue.name}</h4>
                            {venue.priceLevel && <span className="text-xs opacity-60 font-mono">{venue.priceLevel}</span>}
                        </div>
                        <div className="text-xs font-bold uppercase tracking-wider opacity-50 mb-3">{venue.category}</div>

                        <div className="space-y-2 text-sm opacity-80 mb-4">
                            <div className="flex items-start gap-2">
                                <span className="opacity-50">📍</span>
                                <span className="flex-1">{venue.address}</span>
                            </div>
                            {venue.hours && (
                                <div className="flex items-start gap-2">
                                    <span className="opacity-50">🕒</span>
                                    <span>{venue.hours}</span>
                                </div>
                            )}
                        </div>

                        {venue.highlights && (
                            <div className="flex flex-wrap gap-2 mt-4 pt-4 border-t border-dashed border-gray-200 dark:border-gray-700">
                                {venue.highlights.map((h: string, idx: number) => (
                                    <span key={idx} className="text-[10px] px-2 py-1 rounded bg-gray-100 dark:bg-white/10 opacity-80">{h}</span>
                                ))}
                            </div>
                        )}
                    </div>
                </div>
            ))}
        </div>
    );
};

// --- DIRECTIONS GUIDE RENDERER ---
const DirectionsGuideRenderer: React.FC<{ content: any; isDarkMode: boolean; theme?: ThemePalette }> = ({ content, isDarkMode, theme }) => {
    if (!content?.steps) return null;

    return (
        <div className={`p-6 rounded-2xl border ${isDarkMode ? 'bg-white/5 border-white/10' : 'bg-white border-gray-200'}`} style={theme ? { backgroundColor: theme.surface, borderColor: theme.secondary } : {}}>
            <div className="flex items-center justify-between mb-6">
                <div className="flex items-center gap-3">
                    <span className="text-3xl">🗺️</span>
                    <div>
                        <h4 className="text-lg font-bold uppercase tracking-widest" style={theme ? { color: theme.primary } : {}}>Getting There</h4>
                        <div className="text-xs opacity-60">To: {content.destination}</div>
                    </div>
                </div>
            </div>

            <div className="relative border-l-2 border-dashed ml-3 space-y-6" style={{ borderColor: theme?.primary || '#3b82f6' }}>
                {content.steps.map((step: any, i: number) => (
                    <div key={i} className="relative pl-8">
                        <div className={`absolute -left-[11px] top-0 w-6 h-6 rounded-full border-2 flex items-center justify-center text-[10px] ${isDarkMode ? 'bg-gray-900 border-gray-700' : 'bg-white border-gray-300'}`}>
                            {step.mode === 'walking' ? '🚶' : step.mode === 'transit' ? '🚌' : '🚗'}
                        </div>
                        <div className="font-medium">{step.instruction}</div>
                        <div className="flex gap-3 mt-1 text-xs opacity-60 font-mono">
                            {step.distance && <span>{step.distance}</span>}
                            {step.duration && <span>{step.duration}</span>}
                        </div>
                    </div>
                ))}
                <div className="relative pl-8">
                    <div className="absolute -left-[9px] top-0 w-5 h-5 rounded-full bg-red-500 border-2 border-white dark:border-gray-900"></div>
                    <div className="font-bold text-red-500">Arrive at {content.destination}</div>
                </div>
            </div>
        </div>
    );
};

// --- LOCAL SPOTLIGHT RENDERER ---
const LocalSpotlightRenderer: React.FC<{ content: any; isDarkMode: boolean; theme?: ThemePalette }> = ({ content, isDarkMode, theme }) => {
    if (!content?.features) return null;

    return (
        <div className={`p-8 rounded-2xl border overflow-hidden relative ${isDarkMode ? 'bg-indigo-950/30 border-indigo-500/20' : 'bg-indigo-50 border-indigo-100'}`} style={theme ? { backgroundColor: theme.surface, borderColor: theme.secondary } : {}}>
            <div className="absolute top-0 right-0 p-32 bg-indigo-500/10 rounded-full blur-3xl -mr-16 -mt-16"></div>

            <div className="relative z-10 mb-8 text-center">
                <div className="inline-block px-3 py-1 rounded-full text-xs font-bold uppercase tracking-widest mb-2 bg-indigo-500/20 text-indigo-500">
                    Neighborhood Guide
                </div>
                <h3 className="text-3xl font-bold font-serif" style={theme ? { color: theme.primary } : {}}>{content.area || 'Local Highlights'}</h3>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4 relative z-10">
                {content.features.map((feature: any, i: number) => (
                    <div key={i} className={`p-5 rounded-xl flex gap-4 transition-all hover:bg-white/10 ${isDarkMode ? 'bg-white/5' : 'bg-white/60'}`}>
                        <div className="w-20 h-20 rounded-lg bg-gray-200 dark:bg-gray-800 shrink-0 overflow-hidden">
                            {feature.imagePrompt ? (
                                <img src={`https://source.unsplash.com/random/200x200?${encodeURIComponent(feature.imagePrompt)}`} alt={feature.title} className="w-full h-full object-cover" />
                            ) : (
                                <div className="w-full h-full flex items-center justify-center text-2xl">📍</div>
                            )}
                        </div>
                        <div>
                            <div className="text-xs font-bold uppercase opacity-50 mb-1">{feature.type}</div>
                            <h4 className="font-bold mb-1">{feature.title}</h4>
                            <p className="text-sm opacity-70 line-clamp-2">{feature.description}</p>
                        </div>
                    </div>
                ))}
            </div>
        </div>
    );
};

// ============================================
// NEW EDUCATION WIDGET RENDERERS
// ============================================

// --- FLASHCARD DECK RENDERER ---
const FlashcardDeckRenderer: React.FC<{ content: any; isDarkMode: boolean; theme?: ThemePalette }> = ({ content, isDarkMode, theme }) => {
    const [currentIndex, setCurrentIndex] = useState(0);
    const [isFlipped, setIsFlipped] = useState(false);

    if (!content?.cards || content.cards.length === 0) return null;

    const nextCard = () => {
        setIsFlipped(false);
        setTimeout(() => setCurrentIndex((prev) => (prev + 1) % content.cards.length), 200);
    };

    const prevCard = () => {
        setIsFlipped(false);
        setTimeout(() => setCurrentIndex((prev) => (prev - 1 + content.cards.length) % content.cards.length), 200);
    };

    const currentCard = content.cards[currentIndex];

    return (
        <div className="flex flex-col items-center max-w-2xl mx-auto">
            <div className="w-full flex justify-between items-center mb-4 px-4">
                <h4 className="font-bold uppercase tracking-widest opacity-60">Study Deck</h4>
                <div className="text-sm font-mono">{currentIndex + 1} / {content.cards.length}</div>
            </div>

            <div
                className="w-full aspect-[3/2] perspective-1000 cursor-pointer group"
                onClick={() => setIsFlipped(!isFlipped)}
            >
                <div className={`relative w-full h-full transition-transform duration-500 transform-style-3d ${isFlipped ? 'rotate-y-180' : ''}`}>
                    {/* Front */}
                    <div className={`absolute inset-0 backface-hidden rounded-2xl shadow-xl p-8 flex flex-col items-center justify-center text-center border-2 ${isDarkMode ? 'bg-zinc-900 border-zinc-700' : 'bg-white border-gray-100'}`}>
                        <div className="text-xs font-bold uppercase tracking-widest opacity-40 mb-4">Question</div>
                        <div className="text-2xl md:text-3xl font-bold font-serif leading-tight" style={theme ? { color: theme.primary } : {}}>
                            {currentCard.front}
                        </div>
                        {currentCard.hint && (
                            <div className="mt-6 text-sm opacity-50 italic">Hint: {currentCard.hint}</div>
                        )}
                        <div className="absolute bottom-4 text-xs opacity-30 uppercase tracking-widest">Click to flip</div>
                    </div>

                    {/* Back */}
                    <div className={`absolute inset-0 backface-hidden rotate-y-180 rounded-2xl shadow-xl p-8 flex flex-col items-center justify-center text-center border-2 ${isDarkMode ? 'bg-blue-900/20 border-blue-500/30' : 'bg-blue-50 border-blue-200'}`}
                        style={theme ? { backgroundColor: theme.surface, borderColor: theme.primary } : {}}>
                        <div className="text-xs font-bold uppercase tracking-widest opacity-40 mb-4">Answer</div>
                        <div className="text-xl md:text-2xl leading-relaxed">
                            {currentCard.back}
                        </div>
                    </div>
                </div>
            </div>

            <div className="flex gap-4 mt-8">
                <button onClick={prevCard} className={`p-4 rounded-full transition-colors ${isDarkMode ? 'bg-white/10 hover:bg-white/20' : 'bg-gray-100 hover:bg-gray-200'}`}>
                    ← Prev
                </button>
                <button onClick={nextCard} className={`px-8 py-4 rounded-full font-bold text-white shadow-lg transition-transform hover:scale-105 active:scale-95`}
                    style={{ backgroundColor: theme?.primary || '#3b82f6' }}>
                    Next Card →
                </button>
            </div>
        </div>
    );
};

// --- QUIZ INTERACTIVE RENDERER ---
const QuizInteractiveRenderer: React.FC<{ content: any; isDarkMode: boolean; theme?: ThemePalette }> = ({ content, isDarkMode, theme }) => {
    const [answers, setAnswers] = useState<Record<number, number>>({});
    const [showResults, setShowResults] = useState(false);

    if (!content?.questions) return null;

    const calculateScore = () => {
        let correct = 0;
        content.questions.forEach((q: any, i: number) => {
            if (answers[i] === q.correct) correct++;
        });
        return Math.round((correct / content.questions.length) * 100);
    };

    return (
        <div className={`p-8 rounded-2xl border ${isDarkMode ? 'bg-white/5 border-white/10' : 'bg-white border-gray-200'}`} style={theme ? { backgroundColor: theme.surface, borderColor: theme.secondary } : {}}>
            <div className="text-center mb-8">
                <h3 className="text-2xl font-bold mb-2" style={theme ? { color: theme.primary } : {}}>{content.title || 'Knowledge Check'}</h3>
                <p className="opacity-60 text-sm">Test your understanding of the topic</p>
            </div>

            <div className="space-y-8">
                {content.questions.map((q: any, i: number) => {
                    const isAnswered = answers[i] !== undefined;
                    const isCorrect = answers[i] === q.correct;

                    return (
                        <div key={i} className={`p-6 rounded-xl transition-colors ${showResults ? (isCorrect ? 'bg-green-500/10 border border-green-500/20' : 'bg-red-500/10 border border-red-500/20') : (isDarkMode ? 'bg-black/20' : 'bg-gray-50')}`}>
                            <div className="flex gap-3 mb-4">
                                <span className="font-bold opacity-50">{i + 1}.</span>
                                <h5 className="font-bold text-lg">{q.question}</h5>
                            </div>

                            <div className="space-y-2 ml-6">
                                {q.options.map((opt: string, optIdx: number) => (
                                    <button
                                        key={optIdx}
                                        onClick={() => !showResults && setAnswers(prev => ({ ...prev, [i]: optIdx }))}
                                        disabled={showResults}
                                        className={`w-full text-left p-3 rounded-lg text-sm transition-all border ${answers[i] === optIdx
                                            ? (showResults
                                                ? (optIdx === q.correct ? 'bg-green-500 text-white border-green-600' : 'bg-red-500 text-white border-red-600')
                                                : 'bg-blue-500 text-white border-blue-600')
                                            : (showResults && optIdx === q.correct
                                                ? 'bg-green-500/20 border-green-500 text-green-600'
                                                : (isDarkMode ? 'bg-white/5 border-transparent hover:bg-white/10' : 'bg-white border-gray-200 hover:bg-gray-100'))
                                            }`}
                                        style={answers[i] === optIdx && !showResults && theme ? { backgroundColor: theme.primary, borderColor: theme.primary } : {}}
                                    >
                                        {opt}
                                    </button>
                                ))}
                            </div>

                            {showResults && q.explanation && (
                                <div className="mt-4 ml-6 text-sm opacity-70 italic">
                                    {isCorrect ? '✅' : '❌'} {q.explanation}
                                </div>
                            )}
                        </div>
                    );
                })}
            </div>

            {!showResults ? (
                <div className="mt-8 text-center">
                    <button
                        onClick={() => setShowResults(true)}
                        disabled={Object.keys(answers).length < content.questions.length}
                        className="px-8 py-3 rounded-full font-bold text-white shadow-lg disabled:opacity-50 disabled:cursor-not-allowed transition-transform hover:scale-105"
                        style={{ backgroundColor: theme?.primary || '#3b82f6' }}
                    >
                        Submit Answers
                    </button>
                </div>
            ) : (
                <div className="mt-8 text-center animate-fade-in">
                    <div className="text-4xl font-bold mb-2" style={{ color: calculateScore() > 70 ? '#10b981' : '#ef4444' }}>
                        {calculateScore()}%
                    </div>
                    <p className="opacity-60">
                        {calculateScore() > 70 ? 'Great job! You mastered this topic.' : 'Keep studying and try again!'}
                    </p>
                    <button
                        onClick={() => { setShowResults(false); setAnswers({}); }}
                        className="mt-4 text-sm underline opacity-60 hover:opacity-100"
                    >
                        Reset Quiz
                    </button>
                </div>
            )}
        </div>
    );
};

// --- CONCEPT MAP RENDERER ---
const ConceptMapRenderer: React.FC<{ content: any; isDarkMode: boolean; theme?: ThemePalette }> = ({ content, isDarkMode, theme }) => {
    if (!content?.nodes || !content?.connections) return null;

    return (
        <div className={`p-8 rounded-2xl border overflow-hidden ${isDarkMode ? 'bg-slate-900 border-slate-800' : 'bg-slate-50 border-slate-200'}`} style={theme ? { backgroundColor: theme.surface, borderColor: theme.secondary } : {}}>
            <div className="flex items-center gap-3 mb-6">
                <span className="text-3xl">🧠</span>
                <h4 className="text-lg font-bold uppercase tracking-widest" style={theme ? { color: theme.primary } : {}}>Concept Map</h4>
            </div>

            <div className="relative min-h-[400px] flex items-center justify-center">
                <div className="grid grid-cols-3 gap-12 relative z-10">
                    {content.nodes.map((node: any, i: number) => (
                        <div key={i} className={`p-4 rounded-xl border shadow-lg flex flex-col items-center text-center max-w-[150px] ${isDarkMode ? 'bg-slate-800 border-slate-700' : 'bg-white border-gray-200'}`}>
                            <div className="text-3xl mb-2">
                                {i === 0 ? '🎯' : ['⚡', '💡', '🔗', '⚙️', '💎'][i % 5]}
                            </div>
                            <div className="font-bold text-sm mb-1">{node.label}</div>
                            {node.description && <div className="text-[10px] opacity-60 leading-tight">{node.description}</div>}
                        </div>
                    ))}
                </div>

                {/* Background decorative connections */}
                <svg className="absolute inset-0 w-full h-full pointer-events-none opacity-20">
                    <path d="M100,200 Q200,100 300,200 T500,200" fill="none" stroke={theme?.primary || 'currentColor'} strokeWidth="2" strokeDasharray="5,5" />
                    <path d="M100,200 Q200,300 300,200" fill="none" stroke={theme?.primary || 'currentColor'} strokeWidth="2" strokeDasharray="5,5" />
                </svg>
            </div>

            <div className="text-center text-xs opacity-50 mt-4">
                Interactive graph visualization simplified for display
            </div>
        </div>
    );
};

// --- STUDY SCHEDULE RENDERER ---
const StudyScheduleRenderer: React.FC<{ content: any; isDarkMode: boolean; theme?: ThemePalette }> = ({ content, isDarkMode, theme }) => {
    if (!content?.blocks) return null;

    return (
        <div className={`p-6 rounded-2xl border ${isDarkMode ? 'bg-white/5 border-white/10' : 'bg-white border-gray-200'}`} style={theme ? { backgroundColor: theme.surface, borderColor: theme.secondary } : {}}>
            <div className="flex items-center gap-3 mb-6">
                <span className="text-3xl">⏱️</span>
                <h4 className="text-lg font-bold uppercase tracking-widest" style={theme ? { color: theme.primary } : {}}>Learning Plan</h4>
            </div>

            <div className="flex flex-col gap-3">
                {content.blocks.map((block: any, i: number) => {
                    const isBreak = block.type === 'break';
                    return (
                        <div key={i} className={`flex items-center gap-4 p-4 rounded-xl border-l-4 ${isBreak
                            ? (isDarkMode ? 'bg-white/5 border-gray-500' : 'bg-gray-50 border-gray-400')
                            : (isDarkMode ? 'bg-blue-900/10 border-blue-500' : 'bg-blue-50 border-blue-500')}`}
                            style={!isBreak && theme ? { borderColor: theme.primary, backgroundColor: theme.surface } : {}}
                        >
                        </div>
                    );
                })}
            </div>
        </div>
    );
};

// ============================================
// NEW LIFESTYLE WIDGET RENDERERS
// ============================================

// --- RECIPE CARD RENDERER ---
const RecipeCardRenderer: React.FC<{ content: any; isDarkMode: boolean; theme?: ThemePalette }> = ({ content, isDarkMode, theme }) => {
    const [imageUrl, setImageUrl] = useState<string | null>(content.imageUrl || null);

    useEffect(() => {
        if (!content.imageUrl && content.title) {
            // Try to find an image if none provided
            import('../services/imageSearchService').then(({ searchImages }) => {
                searchImages(`${content.title} food recipe`, 1).then(results => {
                    if (results && results.length > 0) {
                        setImageUrl(results[0].thumbnail.src);
                    }
                });
            });
        } else {
            setImageUrl(content.imageUrl);
        }
    }, [content.title, content.imageUrl]);

    if (!content?.ingredients || !content?.steps) return null;

    return (
        <div className={`rounded-2xl overflow-hidden border shadow-lg ${isDarkMode ? 'bg-stone-900 border-stone-800' : 'bg-white border-stone-200'}`} style={theme ? { backgroundColor: theme.surface, borderColor: theme.secondary } : {}}>
            <div className="relative h-64 bg-stone-200 dark:bg-stone-800">
                {imageUrl ? (
                    <img src={imageUrl} alt={content.title} className="w-full h-full object-cover" />
                ) : (
                    <div className="w-full h-full flex items-center justify-center text-6xl opacity-20">🍳</div>
                )}
                <div className="absolute bottom-0 left-0 right-0 p-6 bg-gradient-to-t from-black/80 to-transparent text-white">
                    <h3 className="text-3xl font-bold font-serif mb-2">{content.title}</h3>
                    <div className="flex gap-4 text-sm font-bold opacity-90">
                        {content.prepTime && <span>⏱️ {content.prepTime}</span>}
                        {content.servings && <span>🍽️ {content.servings} servings</span>}
                        {content.difficulty && <span>🔥 {content.difficulty}</span>}
                    </div>
                </div>
            </div>

            <div className="p-8 grid grid-cols-1 md:grid-cols-3 gap-8">
                <div className="md:col-span-1">
                    <h4 className="font-bold uppercase tracking-widest mb-4 opacity-60">Ingredients</h4>
                    <ul className="space-y-2 text-sm">
                        {content.ingredients.map((ing: any, i: number) => (
                            <li key={i} className="flex gap-2 pb-2 border-b border-dashed border-gray-200 dark:border-gray-800">
                                <span className="font-bold">{ing.amount}</span>
                                <span className="opacity-80">{ing.item}</span>
                            </li>
                        ))}
                    </ul>
                </div>

                <div className="md:col-span-2">
                    <h4 className="font-bold uppercase tracking-widest mb-4 opacity-60">Instructions</h4>
                    <div className="space-y-6">
                        {content.steps.map((step: any, i: number) => (
                            <div key={i} className="flex gap-4">
                                <div className={`w-8 h-8 rounded-full flex items-center justify-center font-bold text-sm shrink-0 ${isDarkMode ? 'bg-stone-800 text-stone-400' : 'bg-stone-100 text-stone-600'}`}>
                                    {i + 1}
                                </div>
                                <p className="leading-relaxed opacity-90 pt-1">{step.instruction}</p>
                            </div>
                        ))}
                    </div>
                </div>
            </div>

            {content.nutrition && (
                <div className={`p-4 flex justify-around text-center text-xs uppercase tracking-wider font-bold ${isDarkMode ? 'bg-stone-950' : 'bg-stone-50'}`}>
                    {Object.entries(content.nutrition).map(([key, val]: [string, any], i) => (
                        <div key={i}>
                            <div className="opacity-40 mb-1">{key}</div>
                            <div>{val}</div>
                        </div>
                    ))}
                </div>
            )}
        </div>
    );
};

// --- WORKOUT ROUTINE RENDERER ---
const WorkoutRoutineRenderer: React.FC<{ content: any; isDarkMode: boolean; theme?: ThemePalette }> = ({ content, isDarkMode, theme }) => {
    if (!content?.exercises) return null;

    return (
        <div className={`p-8 rounded-2xl border ${isDarkMode ? 'bg-neutral-900 border-neutral-800' : 'bg-neutral-50 border-neutral-200'}`} style={theme ? { backgroundColor: theme.surface, borderColor: theme.secondary } : {}}>
            <div className="flex justify-between items-start mb-8">
                <div>
                    <div className="flex items-center gap-3 mb-2">
                        <span className="text-3xl">💪</span>
                        <h4 className="text-2xl font-bold uppercase italic" style={theme ? { color: theme.primary } : {}}>{content.title || 'Workout'}</h4>
                    </div>
                    <div className="flex gap-3 text-xs font-bold uppercase tracking-wider opacity-60">
                        {content.duration && <span>⏱️ {content.duration}</span>}
                        {content.level && <span>📊 {content.level}</span>}
                    </div>
                </div>
                {content.focus && (
                    <div className="px-3 py-1 rounded-full border text-xs font-bold uppercase tracking-widest opacity-60">
                        Focus: {content.focus}
                    </div>
                )}
            </div>

            <div className="space-y-4">
                {content.exercises.map((ex: any, i: number) => (
                    <div key={i} className={`p-4 rounded-xl flex items-center gap-4 border-l-4 ${isDarkMode ? 'bg-white/5 border-white/20' : 'bg-white border-black/20'}`}
                        style={theme ? { borderColor: theme.primary } : {}}>
                        <div className="w-12 h-12 rounded-lg bg-gray-200 dark:bg-gray-800 flex items-center justify-center text-xl">
                            {['🏋️', '🏃', '🧘', '🤸'][i % 4]}
                        </div>
                        <div className="flex-1">
                            <h5 className="font-bold text-lg">{ex.name}</h5>
                            <div className="flex gap-4 text-sm opacity-70 font-mono mt-1">
                                {ex.sets && <span>{ex.sets} sets</span>}
                                {ex.reps && <span>{ex.reps} reps</span>}
                                {ex.rest && <span>{ex.rest} rest</span>}
                            </div>
                        </div>
                        {ex.notes && (
                            <div className="hidden md:block text-xs opacity-50 max-w-[150px] text-right">
                                {ex.notes}
                            </div>
                        )}
                    </div>
                ))}
            </div>
        </div>
    );
};

// --- NUTRITION BREAKDOWN RENDERER ---
const NutritionBreakdownRenderer: React.FC<{ content: any; isDarkMode: boolean; theme?: ThemePalette }> = ({ content, isDarkMode, theme }) => {
    if (!content?.macros) return null;

    const total = content.macros.reduce((acc: number, m: any) => acc + m.value, 0);

    return (
        <div className={`p-8 rounded-2xl border ${isDarkMode ? 'bg-white/5 border-white/10' : 'bg-white border-gray-200'}`} style={theme ? { backgroundColor: theme.surface, borderColor: theme.secondary } : {}}>
            <div className="flex items-center gap-3 mb-8">
                <span className="text-3xl">🥗</span>
                <h4 className="text-lg font-bold uppercase tracking-widest" style={theme ? { color: theme.primary } : {}}>Nutrition Facts</h4>
            </div>

            <div className="flex flex-col md:flex-row items-center gap-8">
                <div className="relative w-48 h-48 rounded-full border-8 border-gray-100 dark:border-gray-800 flex items-center justify-center">
                    <div className="text-center">
                        <div className="text-3xl font-bold">{content.calories}</div>
                        <div className="text-xs uppercase tracking-widest opacity-50">Calories</div>
                    </div>
                    {/* Simple SVG Donut Chart Overlay */}
                    <svg className="absolute inset-0 w-full h-full -rotate-90" viewBox="0 0 100 100">
                        {content.macros.map((m: any, i: number) => {
                            const offset = content.macros.slice(0, i).reduce((acc: number, curr: any) => acc + curr.value, 0);
                            const dashArray = (m.value / total) * 251.2; // 2 * PI * 40 (radius)
                            return (
                                <circle
                                    key={i}
                                    cx="50" cy="50" r="40"
                                    fill="none"
                                    stroke={m.color || ['#ef4444', '#3b82f6', '#eab308'][i % 3]}
                                    strokeWidth="8"
                                    strokeDasharray={`${dashArray} 251.2`}
                                    strokeDashoffset={-((offset / total) * 251.2)}
                                    className="opacity-80"
                                />
                            );
                        })}
                    </svg>
                </div>

                <div className="flex-1 w-full space-y-4">
                    {content.macros.map((m: any, i: number) => (
                        <div key={i}>
                            <div className="flex justify-between text-sm font-bold mb-1">
                                <span className="flex items-center gap-2">
                                    <span className="w-3 h-3 rounded-full" style={{ backgroundColor: m.color || ['#ef4444', '#3b82f6', '#eab308'][i % 3] }}></span>
                                    {m.label}
                                </span>
                                <span>{m.amount}</span>
                            </div>
                            <div className="w-full h-2 rounded-full bg-gray-100 dark:bg-gray-800 overflow-hidden">
                                <div
                                    className="h-full rounded-full"
                                    style={{
                                        width: `${(m.value / total) * 100}%`,
                                        backgroundColor: m.color || ['#ef4444', '#3b82f6', '#eab308'][i % 3]
                                    }}
                                ></div>
                            </div>
                        </div>
                    ))}
                </div>
            </div>
        </div>
    );
};

// --- HABIT TRACKER RENDERER ---
const HabitTrackerRenderer: React.FC<{ content: any; isDarkMode: boolean; theme?: ThemePalette }> = ({ content, isDarkMode, theme }) => {
    if (!content?.habits) return null;

    const days = ['M', 'T', 'W', 'T', 'F', 'S', 'S'];

    return (
        <div className={`p-6 rounded-2xl border ${isDarkMode ? 'bg-white/5 border-white/10' : 'bg-white border-gray-200'}`} style={theme ? { backgroundColor: theme.surface, borderColor: theme.secondary } : {}}>
            <div className="flex items-center gap-3 mb-6">
                <span className="text-3xl">✅</span>
                <h4 className="text-lg font-bold uppercase tracking-widest" style={theme ? { color: theme.primary } : {}}>Habit Builder</h4>
            </div>

            <div className="space-y-6">
                {content.habits.map((habit: any, i: number) => (
                    <div key={i}>
                        <div className="flex justify-between items-center mb-2">
                            <h5 className="font-bold">{habit.name}</h5>
                            <span className="text-xs opacity-50">{habit.streak} day streak 🔥</span>
                        </div>
                        <div className="flex justify-between gap-1">
                            {days.map((day, dIdx) => {
                                const isCompleted = habit.history && habit.history[dIdx];
                                return (
                                    <div key={dIdx} className="flex flex-col items-center gap-1 flex-1">
                                        <div className="text-[10px] opacity-40 font-mono">{day}</div>
                                        <div className={`w-full aspect-square rounded-md flex items-center justify-center transition-all ${isCompleted
                                            ? (isDarkMode ? 'bg-green-500/20 text-green-500' : 'bg-green-100 text-green-600')
                                            : (isDarkMode ? 'bg-white/5' : 'bg-gray-100')
                                            }`}>
                                            {isCompleted && <span className="text-xs">✓</span>}
                                        </div>
                                    </div>
                                );
                            })}
                        </div>
                    </div>
                ))}
            </div>
        </div>
    );
};

// ============================================
// EVERYDAY & LIFESTYLE WIDGET RENDERERS
// ============================================

// --- BUYING GUIDE RENDERER ---
const BuyingGuideRenderer: React.FC<{ content: any; isDarkMode: boolean; theme?: ThemePalette }> = ({ content, isDarkMode, theme }) => {
    if (!content?.products) return null;
    return (
        <div className={`p-6 rounded-2xl border ${isDarkMode ? 'bg-white/5 border-white/10' : 'bg-white border-gray-200'}`} style={theme ? { backgroundColor: theme.surface, borderColor: theme.secondary } : {}}>
            <div className="flex items-center gap-3 mb-6">
                <span className="text-3xl">🛒</span>
                <h4 className="text-lg font-bold uppercase tracking-widest" style={theme ? { color: theme.primary } : {}}>Buying Guide</h4>
            </div>
            <div className="grid gap-4">
                {content.products.map((p: any, i: number) => (
                    <div key={i} className={`p-4 rounded-xl border ${isDarkMode ? 'bg-black/20 border-white/5' : 'bg-gray-50 border-gray-100'}`}>
                        <div className="flex justify-between items-start mb-2">
                            <h5 className="font-bold text-base">{p.name}</h5>
                            <div className="flex items-center gap-2">
                                <span className="text-xl font-bold" style={theme ? { color: theme.primary } : {}}>{p.price}</span>
                                {p.rating && <span className="text-yellow-500">{'★'.repeat(Math.round(p.rating))}</span>}
                            </div>
                        </div>
                        {p.bestFor && <div className="text-xs opacity-60 mb-3">Best for: {p.bestFor}</div>}
                        <div className="grid grid-cols-2 gap-2 text-sm">
                            {p.pros?.map((pro: string, j: number) => <div key={j} className="text-green-500">✓ {pro}</div>)}
                            {p.cons?.map((con: string, j: number) => <div key={j} className="text-red-400">✗ {con}</div>)}
                        </div>
                    </div>
                ))}
            </div>
            {content.verdict && <div className={`mt-4 p-3 rounded-lg text-sm font-medium ${isDarkMode ? 'bg-blue-500/10 text-blue-400' : 'bg-blue-50 text-blue-700'}`}>💡 {content.verdict}</div>}
        </div>
    );
};

// --- STREAMING GUIDE RENDERER ---
const StreamingGuideRenderer: React.FC<{ content: any; isDarkMode: boolean; theme?: ThemePalette }> = ({ content, isDarkMode, theme }) => {
    if (!content?.platforms) return null;
    return (
        <div className={`p-6 rounded-2xl border ${isDarkMode ? 'bg-white/5 border-white/10' : 'bg-white border-gray-200'}`} style={theme ? { backgroundColor: theme.surface, borderColor: theme.secondary } : {}}>
            <div className="flex items-center gap-3 mb-4">
                <span className="text-3xl">📺</span>
                <div>
                    <h4 className="text-lg font-bold" style={theme ? { color: theme.primary } : {}}>{content.title}</h4>
                    {content.type && <span className="text-xs opacity-50 uppercase">{content.type}</span>}
                </div>
            </div>
            {content.synopsis && <p className="text-sm opacity-70 mb-4">{content.synopsis}</p>}
            <div className="grid gap-2">
                {content.platforms.map((p: any, i: number) => (
                    <div key={i} className={`flex justify-between items-center p-3 rounded-lg ${p.available ? (isDarkMode ? 'bg-green-500/10' : 'bg-green-50') : (isDarkMode ? 'bg-white/5' : 'bg-gray-50')}`}>
                        <span className="font-medium">{p.name}</span>
                        <div className="flex items-center gap-2 text-sm">
                            {p.available ? <span className="text-green-500">✓ Available</span> : <span className="opacity-40">Not available</span>}
                            {p.subscription && <span className="opacity-60">{p.subscription}</span>}
                            {p.rentPrice && <span className="font-bold">{p.rentPrice}</span>}
                        </div>
                    </div>
                ))}
            </div>
        </div>
    );
};

// --- GIFT IDEAS RENDERER ---
const GiftIdeasRenderer: React.FC<{ content: any; isDarkMode: boolean; theme?: ThemePalette }> = ({ content, isDarkMode, theme }) => {
    if (!content?.gifts) return null;
    return (
        <div className={`p-6 rounded-2xl border ${isDarkMode ? 'bg-white/5 border-white/10' : 'bg-white border-gray-200'}`} style={theme ? { backgroundColor: theme.surface, borderColor: theme.secondary } : {}}>
            <div className="flex items-center gap-3 mb-4">
                <span className="text-3xl">🎁</span>
                <div>
                    <h4 className="text-lg font-bold" style={theme ? { color: theme.primary } : {}}>Gift Ideas</h4>
                    <div className="text-xs opacity-50">{content.occasion} {content.recipient && `• For: ${content.recipient}`} {content.budget && `• Budget: ${content.budget}`}</div>
                </div>
            </div>
            <div className="grid sm:grid-cols-2 gap-4">
                {content.gifts.map((g: any, i: number) => (
                    <div key={i} className={`p-4 rounded-xl border ${isDarkMode ? 'bg-black/20 border-white/5' : 'bg-gray-50 border-gray-100'}`}>
                        <div className="flex justify-between items-start">
                            <h5 className="font-bold">{g.name}</h5>
                            <span className="text-sm font-bold" style={theme ? { color: theme.primary } : {}}>{g.price}</span>
                        </div>
                        {g.category && <div className="text-xs opacity-50 mt-1">{g.category}</div>}
                        {g.whyGreat && <p className="text-sm mt-2 opacity-70">{g.whyGreat}</p>}
                    </div>
                ))}
            </div>
        </div>
    );
};

// --- DIY PROJECT RENDERER ---
const DiyProjectRenderer: React.FC<{ content: any; isDarkMode: boolean; theme?: ThemePalette }> = ({ content, isDarkMode, theme }) => {
    if (!content?.steps) return null;
    return (
        <div className={`p-6 rounded-2xl border ${isDarkMode ? 'bg-white/5 border-white/10' : 'bg-white border-gray-200'}`} style={theme ? { backgroundColor: theme.surface, borderColor: theme.secondary } : {}}>
            <div className="flex items-center gap-3 mb-4">
                <span className="text-3xl">🔨</span>
                <div>
                    <h4 className="text-lg font-bold" style={theme ? { color: theme.primary } : {}}>{content.title || 'DIY Project'}</h4>
                    <div className="flex gap-3 text-xs opacity-60 mt-1">
                        {content.difficulty && <span className="capitalize">{content.difficulty}</span>}
                        {content.time && <span>⏱ {content.time}</span>}
                        {content.cost && <span>💰 {content.cost}</span>}
                    </div>
                </div>
            </div>
            {(content.materials || content.tools) && (
                <div className="grid sm:grid-cols-2 gap-4 mb-6">
                    {content.materials && <div><h5 className="font-bold text-sm mb-2">📦 Materials</h5><ul className="text-sm space-y-1">{content.materials.map((m: string, i: number) => <li key={i} className="opacity-70">• {m}</li>)}</ul></div>}
                    {content.tools && <div><h5 className="font-bold text-sm mb-2">🔧 Tools</h5><ul className="text-sm space-y-1">{content.tools.map((t: string, i: number) => <li key={i} className="opacity-70">• {t}</li>)}</ul></div>}
                </div>
            )}
            <ol className="space-y-3">
                {content.steps.map((s: any, i: number) => (
                    <li key={i} className="flex gap-3">
                        <span className="w-6 h-6 rounded-full flex items-center justify-center text-xs font-bold shrink-0" style={theme ? { backgroundColor: theme.primary, color: theme.surface } : { backgroundColor: isDarkMode ? '#fff' : '#000', color: isDarkMode ? '#000' : '#fff' }}>{s.step || i + 1}</span>
                        <div><p className="font-medium">{s.instruction}</p>{s.tip && <p className="text-xs mt-1 opacity-60">💡 {s.tip}</p>}</div>
                    </li>
                ))}
            </ol>
        </div>
    );
};

// --- PET CARE RENDERER ---
const PetCareRenderer: React.FC<{ content: any; isDarkMode: boolean; theme?: ThemePalette }> = ({ content, isDarkMode, theme }) => {
    if (!content?.animal) return null;
    return (
        <div className={`p-6 rounded-2xl border ${isDarkMode ? 'bg-white/5 border-white/10' : 'bg-white border-gray-200'}`} style={theme ? { backgroundColor: theme.surface, borderColor: theme.secondary } : {}}>
            <div className="flex items-center gap-3 mb-4">
                <span className="text-3xl">🐾</span>
                <div>
                    <h4 className="text-lg font-bold" style={theme ? { color: theme.primary } : {}}>{content.breed || content.animal}</h4>
                    <div className="flex gap-3 text-xs opacity-60">{content.size && <span>{content.size}</span>}{content.lifespan && <span>Lifespan: {content.lifespan}</span>}</div>
                </div>
            </div>
            {content.temperament && <div className="flex flex-wrap gap-2 mb-4">{content.temperament.map((t: string, i: number) => <span key={i} className={`px-2 py-1 rounded-full text-xs ${isDarkMode ? 'bg-white/10' : 'bg-gray-100'}`}>{t}</span>)}</div>}
            {content.needs && (
                <div className="grid grid-cols-3 gap-3 mb-4">
                    <div className={`p-3 rounded-lg text-center ${isDarkMode ? 'bg-white/5' : 'bg-gray-50'}`}><span className="text-xl">🏃</span><div className="text-xs mt-1 opacity-70">{content.needs.exercise}</div></div>
                    <div className={`p-3 rounded-lg text-center ${isDarkMode ? 'bg-white/5' : 'bg-gray-50'}`}><span className="text-xl">✨</span><div className="text-xs mt-1 opacity-70">{content.needs.grooming}</div></div>
                    <div className={`p-3 rounded-lg text-center ${isDarkMode ? 'bg-white/5' : 'bg-gray-50'}`}><span className="text-xl">🍖</span><div className="text-xs mt-1 opacity-70">{content.needs.diet}</div></div>
                </div>
            )}
            {content.tips && <div><h5 className="font-bold text-sm mb-2">Care Tips</h5><ul className="text-sm space-y-1">{content.tips.map((tip: string, i: number) => <li key={i} className="opacity-70">• {tip}</li>)}</ul></div>}
        </div>
    );
};

// --- HOBBY STARTER RENDERER ---
const HobbyStarterRenderer: React.FC<{ content: any; isDarkMode: boolean; theme?: ThemePalette }> = ({ content, isDarkMode, theme }) => {
    if (!content?.hobby) return null;
    return (
        <div className={`p-6 rounded-2xl border ${isDarkMode ? 'bg-white/5 border-white/10' : 'bg-white border-gray-200'}`} style={theme ? { backgroundColor: theme.surface, borderColor: theme.secondary } : {}}>
            <div className="flex items-center gap-3 mb-4">
                <span className="text-3xl">🌟</span>
                <div>
                    <h4 className="text-lg font-bold" style={theme ? { color: theme.primary } : {}}>Getting Started: {content.hobby}</h4>
                    <div className="flex gap-3 text-xs opacity-60 mt-1">{content.difficulty && <span className="capitalize">{content.difficulty}</span>}{content.timeToLearn && <span>⏱ {content.timeToLearn}</span>}{content.initialCost && <span>💰 {content.initialCost}</span>}</div>
                </div>
            </div>
            {content.whatYouNeed && <div className="mb-4"><h5 className="font-bold text-sm mb-2">What You'll Need</h5><div className="flex flex-wrap gap-2">{content.whatYouNeed.map((item: string, i: number) => <span key={i} className={`px-3 py-1 rounded-full text-xs ${isDarkMode ? 'bg-white/10' : 'bg-gray-100'}`}>{item}</span>)}</div></div>}
            {content.firstSteps && <ol className="space-y-2 mb-4">{content.firstSteps.map((s: any, i: number) => <li key={i} className="flex gap-3"><span className="w-5 h-5 rounded-full flex items-center justify-center text-xs font-bold shrink-0" style={theme ? { backgroundColor: theme.primary, color: theme.surface } : {}}>{s.step || i + 1}</span><div><p className="font-medium text-sm">{s.title}</p><p className="text-xs opacity-60">{s.description}</p></div></li>)}</ol>}
            {content.resources && <div><h5 className="font-bold text-sm mb-2">Resources</h5><div className="grid gap-2">{content.resources.map((r: any, i: number) => <div key={i} className="text-sm opacity-70">📚 {r.name} ({r.type})</div>)}</div></div>}
        </div>
    );
};

// --- BUDGET BREAKDOWN RENDERER ---
const BudgetBreakdownRenderer: React.FC<{ content: any; isDarkMode: boolean; theme?: ThemePalette }> = ({ content, isDarkMode, theme }) => {
    if (!content?.categories) return null;
    const total = content.categories.reduce((sum: number, c: any) => sum + (c.amount || 0), 0);
    return (
        <div className={`p-6 rounded-2xl border ${isDarkMode ? 'bg-white/5 border-white/10' : 'bg-white border-gray-200'}`} style={theme ? { backgroundColor: theme.surface, borderColor: theme.secondary } : {}}>
            <div className="flex items-center justify-between mb-6">
                <div className="flex items-center gap-3"><span className="text-3xl">💰</span><h4 className="text-lg font-bold" style={theme ? { color: theme.primary } : {}}>{content.title || 'Budget Breakdown'}</h4></div>
                <div className="text-2xl font-bold" style={theme ? { color: theme.primary } : {}}>{content.total || `$${total.toLocaleString()}`}</div>
            </div>
            <div className="space-y-3">
                {content.categories.map((c: any, i: number) => {
                    const pct = c.percentage || (total > 0 ? Math.round((c.amount / total) * 100) : 0);
                    return (
                        <div key={i}>
                            <div className="flex justify-between text-sm mb-1"><span>{c.name}</span><span className="font-bold">${c.amount?.toLocaleString()} ({pct}%)</span></div>
                            <div className={`h-2 rounded-full overflow-hidden ${isDarkMode ? 'bg-white/10' : 'bg-gray-100'}`}><div className="h-full rounded-full" style={{ width: `${pct}%`, backgroundColor: theme?.primary || '#3b82f6' }} /></div>
                        </div>
                    );
                })}
            </div>
            {content.tips && <div className="mt-4 space-y-1">{content.tips.map((tip: string, i: number) => <div key={i} className="text-xs opacity-60">💡 {tip}</div>)}</div>}
        </div>
    );
};

// --- LIFE HACK CARDS RENDERER ---
const LifeHackCardsRenderer: React.FC<{ content: any; isDarkMode: boolean; theme?: ThemePalette }> = ({ content, isDarkMode, theme }) => {
    if (!content?.hacks) return null;
    return (
        <div className={`p-6 rounded-2xl border ${isDarkMode ? 'bg-white/5 border-white/10' : 'bg-white border-gray-200'}`} style={theme ? { backgroundColor: theme.surface, borderColor: theme.secondary } : {}}>
            <div className="flex items-center gap-3 mb-4"><span className="text-3xl">💡</span><h4 className="text-lg font-bold" style={theme ? { color: theme.primary } : {}}>{content.category || 'Life Hacks'}</h4></div>
            <div className="grid sm:grid-cols-2 gap-3">
                {content.hacks.map((h: any, i: number) => (
                    <div key={i} className={`p-4 rounded-xl border ${isDarkMode ? 'bg-black/20 border-white/5' : 'bg-gradient-to-br from-yellow-50 to-orange-50 border-yellow-100'}`}>
                        <div className="flex items-start gap-3"><span className="text-2xl">{h.icon || '✨'}</span><div><h5 className="font-bold text-sm">{h.title}</h5><p className="text-xs opacity-70 mt-1">{h.description}</p></div></div>
                    </div>
                ))}
            </div>
        </div>
    );
};

// --- REVIEW SUMMARY RENDERER ---
const ReviewSummaryRenderer: React.FC<{ content: any; isDarkMode: boolean; theme?: ThemePalette }> = ({ content, isDarkMode, theme }) => {
    if (!content?.item) return null;
    return (
        <div className={`p-6 rounded-2xl border ${isDarkMode ? 'bg-white/5 border-white/10' : 'bg-white border-gray-200'}`} style={theme ? { backgroundColor: theme.surface, borderColor: theme.secondary } : {}}>
            <div className="flex items-center justify-between mb-4">
                <h4 className="text-lg font-bold" style={theme ? { color: theme.primary } : {}}>{content.item}</h4>
                <div className="text-right"><div className="text-3xl font-bold text-yellow-500">{'★'.repeat(Math.round(content.overallRating || 0))}</div>{content.totalReviews && <div className="text-xs opacity-50">{content.totalReviews} reviews</div>}</div>
            </div>
            {content.breakdown && <div className="space-y-2 mb-4">{content.breakdown.map((b: any, i: number) => <div key={i} className="flex items-center gap-3"><span className="text-sm w-24">{b.category}</span><div className="flex-1 h-2 rounded-full overflow-hidden bg-gray-200"><div className="h-full bg-yellow-500" style={{ width: `${(b.score / 5) * 100}%` }} /></div><span className="text-sm font-bold">{b.score}</span></div>)}</div>}
            <div className="grid sm:grid-cols-2 gap-4">
                {content.topPros && <div><h5 className="font-bold text-sm text-green-500 mb-2">👍 Pros</h5><ul className="text-sm space-y-1">{content.topPros.map((p: string, i: number) => <li key={i} className="opacity-70">• {p}</li>)}</ul></div>}
                {content.topCons && <div><h5 className="font-bold text-sm text-red-400 mb-2">👎 Cons</h5><ul className="text-sm space-y-1">{content.topCons.map((c: string, i: number) => <li key={i} className="opacity-70">• {c}</li>)}</ul></div>}
            </div>
            {content.verdict && <div className={`mt-4 p-3 rounded-lg text-sm font-medium ${isDarkMode ? 'bg-blue-500/10 text-blue-400' : 'bg-blue-50 text-blue-700'}`}>💬 {content.verdict}</div>}
        </div>
    );
};

// --- PODCAST PLAYLIST RENDERER ---
const PodcastPlaylistRenderer: React.FC<{ content: any; isDarkMode: boolean; theme?: ThemePalette }> = ({ content, isDarkMode, theme }) => {
    if (!content?.podcasts) return null;
    return (
        <div className={`p-6 rounded-2xl border ${isDarkMode ? 'bg-white/5 border-white/10' : 'bg-white border-gray-200'}`} style={theme ? { backgroundColor: theme.surface, borderColor: theme.secondary } : {}}>
            <div className="flex items-center gap-3 mb-4"><span className="text-3xl">🎙️</span><h4 className="text-lg font-bold" style={theme ? { color: theme.primary } : {}}>{content.topic ? `Podcasts: ${content.topic}` : 'Recommended Podcasts'}</h4></div>
            <div className="space-y-3">
                {content.podcasts.map((p: any, i: number) => (
                    <div key={i} className={`p-4 rounded-xl flex gap-4 ${isDarkMode ? 'bg-black/20' : 'bg-gradient-to-r from-purple-50 to-pink-50'}`}>
                        <div className="w-12 h-12 rounded-lg bg-gradient-to-br from-purple-500 to-pink-500 flex items-center justify-center text-white text-xl shrink-0">🎧</div>
                        <div className="flex-1 min-w-0"><h5 className="font-bold text-sm truncate">{p.name}</h5>{p.host && <div className="text-xs opacity-50">Hosted by {p.host}</div>}<p className="text-xs opacity-70 mt-1 line-clamp-2">{p.description}</p></div>
                    </div>
                ))}
            </div>
        </div>
    );
};

// --- SEASON GUIDE RENDERER ---
const SeasonGuideRenderer: React.FC<{ content: any; isDarkMode: boolean; theme?: ThemePalette }> = ({ content, isDarkMode, theme }) => {
    if (!content?.activities) return null;
    const seasonEmojis: Record<string, string> = { spring: '🌸', summer: '☀️', fall: '🍂', winter: '❄️', any: '🌍' };
    return (
        <div className={`p-6 rounded-2xl border ${isDarkMode ? 'bg-white/5 border-white/10' : 'bg-white border-gray-200'}`} style={theme ? { backgroundColor: theme.surface, borderColor: theme.secondary } : {}}>
            <div className="flex items-center gap-3 mb-4"><span className="text-3xl">{seasonEmojis[content.season] || '📅'}</span><h4 className="text-lg font-bold capitalize" style={theme ? { color: theme.primary } : {}}>{content.season} Activities</h4></div>
            <div className="grid sm:grid-cols-2 gap-3">
                {content.activities.map((a: any, i: number) => (
                    <div key={i} className={`p-4 rounded-xl border ${isDarkMode ? 'bg-black/20 border-white/5' : 'bg-gray-50 border-gray-100'}`}>
                        <div className="flex items-start gap-3"><span className="text-2xl">{a.icon || '🎯'}</span><div><h5 className="font-bold text-sm">{a.name}</h5><p className="text-xs opacity-70 mt-1">{a.description}</p>{a.bestTime && <div className="text-xs opacity-50 mt-1">Best: {a.bestTime}</div>}</div></div>
                    </div>
                ))}
            </div>
            {content.tips && <div className="mt-4 space-y-1">{content.tips.map((tip: string, i: number) => <div key={i} className="text-xs opacity-60">💡 {tip}</div>)}</div>}
        </div>
    );
};

// --- CELEBRATION PLANNER RENDERER ---
const CelebrationPlannerRenderer: React.FC<{ content: any; isDarkMode: boolean; theme?: ThemePalette }> = ({ content, isDarkMode, theme }) => {
    if (!content?.checklist && !content?.ideas) return null;
    return (
        <div className={`p-6 rounded-2xl border ${isDarkMode ? 'bg-white/5 border-white/10' : 'bg-white border-gray-200'}`} style={theme ? { backgroundColor: theme.surface, borderColor: theme.secondary } : {}}>
            <div className="flex items-center gap-3 mb-4"><span className="text-3xl">🎉</span><h4 className="text-lg font-bold" style={theme ? { color: theme.primary } : {}}>{content.occasion || 'Celebration'} Planner</h4></div>
            {content.checklist && <div className="mb-4"><h5 className="font-bold text-sm mb-2">Checklist</h5><div className="space-y-2">{content.checklist.map((item: any, i: number) => <div key={i} className={`flex items-center gap-3 p-2 rounded-lg ${item.priority === 'high' ? (isDarkMode ? 'bg-red-500/10' : 'bg-red-50') : (isDarkMode ? 'bg-white/5' : 'bg-gray-50')}`}><input type="checkbox" className="w-4 h-4" /><span className="text-sm flex-1">{item.task}</span><span className="text-xs opacity-50 capitalize">{item.category}</span></div>)}</div></div>}
            {content.ideas && <div className="grid sm:grid-cols-2 gap-4">{content.ideas.map((idea: any, i: number) => <div key={i} className={`p-3 rounded-lg ${isDarkMode ? 'bg-white/5' : 'bg-gray-50'}`}><h5 className="font-bold text-sm mb-2">{idea.category}</h5><ul className="text-xs space-y-1">{idea.suggestions.map((s: string, j: number) => <li key={j} className="opacity-70">• {s}</li>)}</ul></div>)}</div>}
        </div>
    );
};

// --- PARENTING TIPS RENDERER ---
const ParentingTipsRenderer: React.FC<{ content: any; isDarkMode: boolean; theme?: ThemePalette }> = ({ content, isDarkMode, theme }) => {
    if (!content?.tips) return null;
    return (
        <div className={`p-6 rounded-2xl border ${isDarkMode ? 'bg-white/5 border-white/10' : 'bg-white border-gray-200'}`} style={theme ? { backgroundColor: theme.surface, borderColor: theme.secondary } : {}}>
            <div className="flex items-center gap-3 mb-4"><span className="text-3xl">👨‍👩‍👧</span><div><h4 className="text-lg font-bold" style={theme ? { color: theme.primary } : {}}>{content.topic || 'Parenting Tips'}</h4>{content.ageGroup && <div className="text-xs opacity-50">Ages: {content.ageGroup}</div>}</div></div>
            <div className="grid sm:grid-cols-2 gap-3">
                {content.tips.map((t: any, i: number) => (
                    <div key={i} className={`p-4 rounded-xl border ${isDarkMode ? 'bg-black/20 border-white/5' : 'bg-gradient-to-br from-pink-50 to-purple-50 border-pink-100'}`}>
                        <div className="flex items-start gap-3"><span className="text-2xl">{t.icon || '💝'}</span><div><h5 className="font-bold text-sm">{t.title}</h5><p className="text-xs opacity-70 mt-1">{t.description}</p></div></div>
                    </div>
                ))}
            </div>
        </div>
    );
};

// ============================================
// NEW BUSINESS & TECH WIDGET RENDERERS
// ============================================

// --- COMPANY PROFILE RENDERER ---
const CompanyProfileRenderer: React.FC<{ content: any; isDarkMode: boolean; theme?: ThemePalette }> = ({ content, isDarkMode, theme }) => {
    const [images, setImages] = useState<{ logo?: string; hq?: string }>({});

    useEffect(() => {
        if (content?.name) {
            import('../services/imageSearchService').then(({ searchImages }) => {
                // Fetch Logo
                searchImages(`${content.name} company logo high resolution`, 1).then(results => {
                    if (results?.[0]) setImages(prev => ({ ...prev, logo: results[0].thumbnail.src }));
                });
                // Fetch HQ
                searchImages(`${content.name} headquarters building`, 1).then(results => {
                    if (results?.[0]) setImages(prev => ({ ...prev, hq: results[0].thumbnail.src }));
                });
            });
        }
    }, [content?.name]);

    if (!content?.name) return null;

    return (
        <div className={`p-8 rounded-2xl border overflow-hidden relative ${isDarkMode ? 'bg-slate-900 border-slate-800' : 'bg-white border-slate-200'}`} style={theme ? { backgroundColor: theme.surface, borderColor: theme.secondary } : {}}>
            {/* Background Image Overlay */}
            {images.hq && (
                <div className="absolute inset-0 opacity-10 pointer-events-none">
                    <img src={images.hq} alt="HQ" className="w-full h-full object-cover grayscale" />
                </div>
            )}

            <div className="relative z-10 flex flex-col md:flex-row gap-8 items-start">
                <div className={`w-32 h-32 rounded-xl flex items-center justify-center p-4 shadow-lg ${isDarkMode ? 'bg-white' : 'bg-white border'}`}>
                    {images.logo ? (
                        <img src={images.logo} alt={content.name} className="w-full h-full object-contain" />
                    ) : (
                        <span className="text-4xl font-bold text-slate-800">{content.name.substring(0, 2).toUpperCase()}</span>
                    )}
                </div>

                <div className="flex-1">
                    <h3 className="text-3xl font-bold mb-2" style={theme ? { color: theme.primary } : {}}>{content.name}</h3>
                    <div className="flex flex-wrap gap-4 text-sm font-medium opacity-70 mb-4">
                        {content.industry && <span>🏭 {content.industry}</span>}
                        {content.founded && <span>📅 Founded {content.founded}</span>}
                        {content.headquarters && <span>📍 {content.headquarters}</span>}
                    </div>
                    <p className="leading-relaxed opacity-90 mb-4">{content.description}</p>
                    {content.website && (
                        <a href={content.website} target="_blank" rel="noopener noreferrer" className="text-blue-500 hover:underline text-sm font-bold">
                            Visit Website →
                        </a>
                    )}
                </div>
            </div>
        </div>
    );
};

// --- EXECUTIVE TEAM RENDERER ---
const ExecutiveTeamRenderer: React.FC<{ content: any; isDarkMode: boolean; theme?: ThemePalette }> = ({ content, isDarkMode, theme }) => {
    const [headshots, setHeadshots] = useState<Record<string, string>>({});

    useEffect(() => {
        if (content?.members) {
            content.members.forEach((member: any) => {
                import('../services/imageSearchService').then(({ searchImages }) => {
                    searchImages(`${member.name} ${member.title} headshot`, 1).then(results => {
                        if (results?.[0]) setHeadshots(prev => ({ ...prev, [member.name]: results[0].thumbnail.src }));
                    });
                });
            });
        }
    }, [content?.members]);

    if (!content?.members) return null;

    return (
        <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-6">
            {content.members.map((member: any, i: number) => (
                <div key={i} className={`p-6 rounded-xl border text-center ${isDarkMode ? 'bg-white/5 border-white/10' : 'bg-white border-gray-200'}`} style={theme ? { backgroundColor: theme.surface, borderColor: theme.secondary } : {}}>
                    <div className="w-24 h-24 mx-auto rounded-full overflow-hidden mb-4 border-2 border-gray-200 dark:border-gray-700">
                        {headshots[member.name] ? (
                            <img src={headshots[member.name]} alt={member.name} className="w-full h-full object-cover" />
                        ) : (
                            <div className={`w-full h-full flex items-center justify-center text-2xl ${isDarkMode ? 'bg-gray-800' : 'bg-gray-100'}`}>
                                👤
                            </div>
                        )}
                    </div>
                    <h4 className="font-bold text-lg">{member.name}</h4>
                    <div className="text-xs uppercase tracking-wider opacity-60 mb-2" style={theme ? { color: theme.primary } : {}}>{member.title}</div>
                    <p className="text-sm opacity-80 leading-snug">{member.bio}</p>
                </div>
            ))}
        </div>
    );
};

// --- PRODUCT LINEUP RENDERER ---
const ProductLineupRenderer: React.FC<{ content: any; isDarkMode: boolean; theme?: ThemePalette }> = ({ content, isDarkMode, theme }) => {
    const [productImages, setProductImages] = useState<Record<string, string>>({});

    useEffect(() => {
        if (content?.products) {
            content.products.forEach((prod: any) => {
                import('../services/imageSearchService').then(({ searchImages }) => {
                    searchImages(`${prod.name} product photo`, 1).then(results => {
                        if (results?.[0]) setProductImages(prev => ({ ...prev, [prod.name]: results[0].thumbnail.src }));
                    });
                });
            });
        }
    }, [content?.products]);

    if (!content?.products) return null;

    return (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {content.products.map((prod: any, i: number) => (
                <div key={i} className={`flex gap-4 p-4 rounded-xl border ${isDarkMode ? 'bg-white/5 border-white/10' : 'bg-white border-gray-200'}`} style={theme ? { backgroundColor: theme.surface, borderColor: theme.secondary } : {}}>
                    <div className="w-24 h-24 shrink-0 rounded-lg bg-gray-100 dark:bg-gray-800 overflow-hidden flex items-center justify-center">
                        {productImages[prod.name] ? (
                            <img src={productImages[prod.name]} alt={prod.name} className="w-full h-full object-cover" />
                        ) : (
                            <span className="text-2xl opacity-20">📦</span>
                        )}
                    </div>
                    <div>
                        <div className="flex justify-between items-start">
                            <h4 className="font-bold">{prod.name}</h4>
                            {prod.price && <span className="text-sm font-mono opacity-60">{prod.price}</span>}
                        </div>
                        <div className="text-xs opacity-50 mb-1">{prod.category}</div>
                        <p className="text-sm opacity-80 line-clamp-2">{prod.description}</p>
                    </div>
                </div>
            ))}
        </div>
    );
};

// --- TECH STACK RENDERER ---
const TechStackRenderer: React.FC<{ content: any; isDarkMode: boolean; theme?: ThemePalette }> = ({ content, isDarkMode, theme }) => {
    const [logos, setLogos] = useState<Record<string, string>>({});

    useEffect(() => {
        if (content?.tools) {
            content.tools.forEach((tool: any) => {
                import('../services/imageSearchService').then(({ searchImages }) => {
                    searchImages(`${tool.name} software logo transparent`, 1).then(results => {
                        if (results?.[0]) setLogos(prev => ({ ...prev, [tool.name]: results[0].thumbnail.src }));
                    });
                });
            });
        }
    }, [content?.tools]);

    if (!content?.tools) return null;

    return (
        <div className="flex flex-wrap gap-4 justify-center">
            {content.tools.map((tool: any, i: number) => (
                <div key={i} className={`flex flex-col items-center gap-2 p-4 rounded-xl border w-32 text-center transition-transform hover:scale-105 ${isDarkMode ? 'bg-white/5 border-white/10' : 'bg-white border-gray-200'}`} style={theme ? { backgroundColor: theme.surface, borderColor: theme.secondary } : {}}>
                    <div className="w-12 h-12 flex items-center justify-center">
                        {logos[tool.name] ? (
                            <img src={logos[tool.name]} alt={tool.name} className="max-w-full max-h-full object-contain" />
                        ) : (
                            <span className="text-2xl">💻</span>
                        )}
                    </div>
                    <div className="font-bold text-sm leading-tight">{tool.name}</div>
                    <div className="text-[10px] opacity-50">{tool.category}</div>
                </div>
            ))}
        </div>
    );
};

// ============================================
// NEW TRAVEL & PLACES WIDGET RENDERERS
// ============================================

// --- DESTINATION GUIDE RENDERER ---
const DestinationGuideRenderer: React.FC<{ content: any; isDarkMode: boolean; theme?: ThemePalette }> = ({ content, isDarkMode, theme }) => {
    const [images, setImages] = useState<{ main?: string; highlights: Record<string, string> }>({ highlights: {} });

    useEffect(() => {
        if (content?.location) {
            import('../services/imageSearchService').then(({ searchImages }) => {
                // Main Image
                searchImages(`${content.location} ${content.country} scenic landmark`, 1).then(results => {
                    if (results?.[0]) setImages(prev => ({ ...prev, main: results[0].thumbnail.src }));
                });
                // Highlights
                if (content.highlights) {
                    content.highlights.forEach((highlight: string) => {
                        searchImages(`${highlight} ${content.location} travel`, 1).then(results => {
                            if (results?.[0]) setImages(prev => ({ ...prev, highlights: { ...prev.highlights, [highlight]: results[0].thumbnail.src } }));
                        });
                    });
                }
            });
        }
    }, [content?.location, content?.highlights]);

    if (!content?.location) return null;

    return (
        <div className={`rounded-2xl overflow-hidden border shadow-xl ${isDarkMode ? 'bg-stone-900 border-stone-800' : 'bg-white border-stone-200'}`} style={theme ? { backgroundColor: theme.surface, borderColor: theme.secondary } : {}}>
            <div className="relative h-64 bg-stone-200 dark:bg-stone-800">
                {images.main ? (
                    <img src={images.main} alt={content.location} className="w-full h-full object-cover" />
                ) : (
                    <div className="w-full h-full flex items-center justify-center text-6xl opacity-20">✈️</div>
                )}
                <div className="absolute inset-0 bg-gradient-to-t from-black/80 via-transparent to-transparent flex flex-col justify-end p-8 text-white">
                    <div className="uppercase tracking-widest text-sm font-bold mb-1 opacity-80">{content.country}</div>
                    <h3 className="text-5xl font-bold font-serif">{content.location}</h3>
                </div>
            </div>

            <div className="p-8">
                <div className="flex gap-8 mb-8 text-sm font-bold uppercase tracking-wider opacity-70 border-b pb-4 border-dashed" style={{ borderColor: isDarkMode ? '#333' : '#ddd' }}>
                    <div>☀️ Best Time: {content.bestTime}</div>
                    <div>💰 Currency: {content.currency}</div>
                </div>

                <h4 className="font-bold text-lg mb-4">Top Highlights</h4>
                <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                    {content.highlights.map((highlight: string, i: number) => (
                        <div key={i} className="group relative aspect-square rounded-xl overflow-hidden cursor-pointer">
                            {images.highlights[highlight] ? (
                                <img src={images.highlights[highlight]} alt={highlight} className="w-full h-full object-cover transition-transform duration-500 group-hover:scale-110" />
                            ) : (
                                <div className={`w-full h-full ${isDarkMode ? 'bg-stone-800' : 'bg-stone-100'}`} />
                            )}
                            <div className="absolute inset-0 bg-black/40 flex items-center justify-center p-2 text-center">
                                <span className="text-white font-bold text-sm drop-shadow-md">{highlight}</span>
                            </div>
                        </div>
                    ))}
                </div>
            </div>
        </div>
    );
};

// --- HOTEL SHOWCASE RENDERER ---
const HotelShowcaseRenderer: React.FC<{ content: any; isDarkMode: boolean; theme?: ThemePalette }> = ({ content, isDarkMode, theme }) => {
    const [hotelImages, setHotelImages] = useState<Record<string, string>>({});

    useEffect(() => {
        if (content?.hotels) {
            content.hotels.forEach((hotel: any) => {
                import('../services/imageSearchService').then(({ searchImages }) => {
                    searchImages(`${hotel.name} hotel room interior luxury`, 1).then(results => {
                        if (results?.[0]) setHotelImages(prev => ({ ...prev, [hotel.name]: results[0].thumbnail.src }));
                    });
                });
            });
        }
    }, [content?.hotels]);

    if (!content?.hotels) return null;

    return (
        <div className="space-y-6">
            {content.hotels.map((hotel: any, i: number) => (
                <div key={i} className={`flex flex-col md:flex-row gap-6 p-4 rounded-xl border ${isDarkMode ? 'bg-white/5 border-white/10' : 'bg-white border-gray-200'}`} style={theme ? { backgroundColor: theme.surface, borderColor: theme.secondary } : {}}>
                    <div className="w-full md:w-1/3 aspect-video rounded-lg overflow-hidden bg-gray-100 dark:bg-gray-800">
                        {hotelImages[hotel.name] ? (
                            <img src={hotelImages[hotel.name]} alt={hotel.name} className="w-full h-full object-cover" />
                        ) : (
                            <div className="w-full h-full flex items-center justify-center text-4xl opacity-20">🏨</div>
                        )}
                    </div>
                    <div className="flex-1">
                        <div className="flex justify-between items-start mb-2">
                            <div>
                                <h4 className="font-bold text-xl">{hotel.name}</h4>
                                <div className="text-yellow-500 text-sm">{'★'.repeat(hotel.stars)}</div>
                            </div>
                            <div className="font-mono font-bold text-lg opacity-60">{hotel.priceRange}</div>
                        </div>
                        <p className="text-sm opacity-80 mb-4 line-clamp-2">{hotel.description}</p>
                        <div className="flex flex-wrap gap-2">
                            {hotel.amenities.map((amenity: string, idx: number) => (
                                <span key={idx} className={`text-[10px] px-2 py-1 rounded-full uppercase tracking-wider font-bold ${isDarkMode ? 'bg-white/10' : 'bg-black/5'}`}>
                                    {amenity}
                                </span>
                            ))}
                        </div>
                    </div>
                </div>
            ))}
        </div>
    );
};

// --- TRAVEL ITINERARY RENDERER ---
const TravelItineraryRenderer: React.FC<{ content: any; isDarkMode: boolean; theme?: ThemePalette }> = ({ content, isDarkMode, theme }) => {
    const [dayImages, setDayImages] = useState<Record<number, string>>({});

    useEffect(() => {
        if (content?.days) {
            content.days.forEach((day: any) => {
                import('../services/imageSearchService').then(({ searchImages }) => {
                    searchImages(`${day.location} ${day.title} scenic`, 1).then(results => {
                        if (results?.[0]) setDayImages(prev => ({ ...prev, [day.day]: results[0].thumbnail.src }));
                    });
                });
            });
        }
    }, [content?.days]);

    if (!content?.days) return null;

    return (
        <div className="relative border-l-2 border-dashed ml-4 space-y-8 pl-8" style={{ borderColor: theme?.primary || (isDarkMode ? '#333' : '#ddd') }}>
            {content.days.map((day: any, i: number) => (
                <div key={i} className="relative">
                    <div className={`absolute -left-[41px] top-0 w-6 h-6 rounded-full border-4 ${isDarkMode ? 'bg-stone-900 border-stone-700' : 'bg-white border-stone-300'}`} style={{ borderColor: theme?.primary }} />

                    <div className={`rounded-xl overflow-hidden border ${isDarkMode ? 'bg-white/5 border-white/10' : 'bg-white border-gray-200'}`} style={theme ? { backgroundColor: theme.surface, borderColor: theme.secondary } : {}}>
                        <div className="h-32 relative bg-gray-200 dark:bg-gray-800">
                            {dayImages[day.day] && (
                                <img src={dayImages[day.day]} alt={day.title} className="w-full h-full object-cover" />
                            )}
                            <div className="absolute inset-0 bg-black/50 flex items-center px-6">
                                <div>
                                    <div className="text-xs font-bold text-white/80 uppercase tracking-widest mb-1">Day {day.day}</div>
                                    <h4 className="text-xl font-bold text-white">{day.title}</h4>
                                </div>
                            </div>
                        </div>
                        <div className="p-6">
                            <ul className="space-y-2">
                                {day.activities.map((activity: string, idx: number) => (
                                    <li key={idx} className="flex gap-3 text-sm opacity-80">
                                        <span className="opacity-40">•</span>
                                        {activity}
                                    </li>
                                ))}
                            </ul>
                        </div>
                    </div>
                </div>
            ))}
        </div>
    );
};

// ============================================
// NEW ENTERTAINMENT & MEDIA WIDGET RENDERERS
// ============================================

// --- MOVIE CAST RENDERER ---
const MovieCastRenderer: React.FC<{ content: any; isDarkMode: boolean; theme?: ThemePalette }> = ({ content, isDarkMode, theme }) => {
    const [castImages, setCastImages] = useState<Record<string, string>>({});

    useEffect(() => {
        if (content?.cast) {
            content.cast.forEach((actor: any) => {
                import('../services/imageSearchService').then(({ searchImages }) => {
                    searchImages(`${actor.actor} actor headshot`, 1).then(results => {
                        if (results?.[0]) setCastImages(prev => ({ ...prev, [actor.actor]: results[0].thumbnail.src }));
                    });
                });
            });
        }
    }, [content?.cast]);

    if (!content?.cast) return null;

    return (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            {content.cast.map((member: any, i: number) => (
                <div key={i} className={`relative group overflow-hidden rounded-xl ${isDarkMode ? 'bg-black' : 'bg-gray-100'}`}>
                    <div className="aspect-[2/3]">
                        {castImages[member.actor] ? (
                            <img src={castImages[member.actor]} alt={member.actor} className="w-full h-full object-cover transition-transform duration-500 group-hover:scale-110" />
                        ) : (
                            <div className="w-full h-full flex items-center justify-center text-4xl opacity-20">🎬</div>
                        )}
                    </div>
                    <div className="absolute inset-0 bg-gradient-to-t from-black/90 via-transparent to-transparent flex flex-col justify-end p-4 text-white opacity-0 group-hover:opacity-100 transition-opacity duration-300">
                        <div className="font-bold text-lg leading-tight">{member.actor}</div>
                        <div className="text-xs opacity-70 uppercase tracking-wider">as {member.role}</div>
                    </div>
                </div>
            ))}
        </div>
    );
};

// --- GAME ROSTER RENDERER ---
const GameRosterRenderer: React.FC<{ content: any; isDarkMode: boolean; theme?: ThemePalette }> = ({ content, isDarkMode, theme }) => {
    const [charImages, setCharImages] = useState<Record<string, string>>({});

    useEffect(() => {
        if (content?.characters) {
            content.characters.forEach((char: any) => {
                import('../services/imageSearchService').then(({ searchImages }) => {
                    searchImages(`${char.name} ${content.gameTitle} character art`, 1).then(results => {
                        if (results?.[0]) setCharImages(prev => ({ ...prev, [char.name]: results[0].thumbnail.src }));
                    });
                });
            });
        }
    }, [content?.characters, content?.gameTitle]);

    if (!content?.characters) return null;

    return (
        <div className="flex overflow-x-auto pb-4 gap-4 snap-x">
            {content.characters.map((char: any, i: number) => (
                <div key={i} className={`snap-center shrink-0 w-64 rounded-2xl overflow-hidden border relative ${isDarkMode ? 'bg-stone-900 border-stone-800' : 'bg-white border-stone-200'}`} style={theme ? { backgroundColor: theme.surface, borderColor: theme.secondary } : {}}>
                    <div className="h-48 bg-stone-800 relative">
                        {charImages[char.name] && (
                            <img src={charImages[char.name]} alt={char.name} className="w-full h-full object-cover" />
                        )}
                        <div className="absolute bottom-0 left-0 right-0 p-4 bg-gradient-to-t from-black/90 to-transparent">
                            <h4 className="text-white font-bold text-xl">{char.name}</h4>
                            <div className="text-white/60 text-xs uppercase tracking-widest">{char.role}</div>
                        </div>
                    </div>
                    <div className="p-4">
                        <div className="flex flex-wrap gap-2">
                            {char.abilities.map((ability: string, idx: number) => (
                                <span key={idx} className={`text-[10px] px-2 py-1 rounded border ${isDarkMode ? 'border-white/20 bg-white/5' : 'border-black/10 bg-black/5'}`}>
                                    {ability}
                                </span>
                            ))}
                        </div>
                    </div>
                </div>
            ))}
        </div>
    );
};

// --- HISTORICAL FIGURE RENDERER ---
const HistoricalFigureRenderer: React.FC<{ content: any; isDarkMode: boolean; theme?: ThemePalette }> = ({ content, isDarkMode, theme }) => {
    const [image, setImage] = useState<string | null>(null);

    useEffect(() => {
        if (content?.name) {
            import('../services/imageSearchService').then(({ searchImages }) => {
                searchImages(`${content.name} historical portrait`, 1).then(results => {
                    if (results?.[0]) setImage(results[0].thumbnail.src);
                });
            });
        }
    }, [content?.name]);

    if (!content?.name) return null;

    return (
        <div className={`flex flex-col md:flex-row gap-8 items-center p-8 rounded-2xl border ${isDarkMode ? 'bg-[#1a1a1a] border-[#333]' : 'bg-[#f4f1ea] border-[#e0dcd0]'}`} style={theme ? { backgroundColor: theme.surface, borderColor: theme.secondary } : {}}>
            <div className="w-48 h-64 shrink-0 rounded-lg overflow-hidden shadow-2xl border-4 border-white/10 relative">
                {image ? (
                    <img src={image} alt={content.name} className="w-full h-full object-cover sepia-[.3]" />
                ) : (
                    <div className="w-full h-full bg-stone-300 flex items-center justify-center text-6xl opacity-20">📜</div>
                )}
            </div>

            <div className="flex-1 text-center md:text-left">
                <h3 className="text-4xl font-serif font-bold mb-2" style={theme ? { color: theme.primary } : {}}>{content.name}</h3>
                <div className="text-sm font-bold uppercase tracking-widest opacity-60 mb-6">{content.era}</div>

                <div className="mb-6">
                    <h4 className="text-xs font-bold uppercase opacity-50 mb-1">Known For</h4>
                    <p className="text-lg font-medium italic">"{content.knownFor}"</p>
                </div>

                <p className="leading-relaxed opacity-80 font-serif">{content.bio}</p>
            </div>
        </div>
    );
};



// ============================================
// NEW NATURE & SCIENCE WIDGET RENDERERS
// ============================================

// --- WILDLIFE ENCYCLOPEDIA RENDERER ---
const WildlifeEncyclopediaRenderer: React.FC<{ content: any; isDarkMode: boolean; theme?: ThemePalette }> = ({ content, isDarkMode, theme }) => {
    const [image, setImage] = useState<string | null>(null);

    useEffect(() => {
        if (content?.species) {
            import('../services/imageSearchService').then(({ searchImages }) => {
                searchImages(`${content.species} animal wildlife photography`, 1).then(results => {
                    if (results?.[0]) setImage(results[0].thumbnail.src);
                });
            });
        }
    }, [content?.species]);

    if (!content?.species) return null;

    return (
        <div className={`rounded-2xl overflow-hidden border ${isDarkMode ? 'bg-green-950/30 border-green-900' : 'bg-green-50 border-green-200'}`} style={theme ? { backgroundColor: theme.surface, borderColor: theme.secondary } : {}}>
            <div className="h-64 relative">
                {image ? (
                    <img src={image} alt={content.species} className="w-full h-full object-cover" />
                ) : (
                    <div className="w-full h-full bg-green-200 dark:bg-green-900 flex items-center justify-center text-6xl opacity-20">🐾</div>
                )}
                <div className="absolute bottom-0 left-0 right-0 p-6 bg-gradient-to-t from-black/80 to-transparent text-white">
                    <div className="text-sm font-mono opacity-80 mb-1">{content.scientificName}</div>
                    <h3 className="text-4xl font-bold">{content.species}</h3>
                </div>
            </div>

            <div className="p-6 grid grid-cols-1 md:grid-cols-2 gap-6">
                <div>
                    <h4 className="font-bold mb-2 flex items-center gap-2">
                        <span>🌍</span> Habitat
                    </h4>
                    <p className="text-sm opacity-80 mb-4">{content.habitat}</p>

                    <h4 className="font-bold mb-2 flex items-center gap-2">
                        <span>🥗</span> Diet
                    </h4>
                    <p className="text-sm opacity-80">{content.diet}</p>
                </div>

                <div className={`p-4 rounded-xl ${isDarkMode ? 'bg-black/20' : 'bg-white/50'}`}>
                    <h4 className="font-bold mb-2 text-xs uppercase tracking-widest opacity-60">Conservation Status</h4>
                    <div className={`inline-block px-3 py-1 rounded-full text-sm font-bold ${content.status === 'Endangered' ? 'bg-red-500/20 text-red-500' :
                        content.status === 'Vulnerable' ? 'bg-orange-500/20 text-orange-500' :
                            'bg-green-500/20 text-green-500'
                        }`}>
                        {content.status}
                    </div>
                    <div className="mt-4">
                        <h4 className="font-bold mb-1 text-xs uppercase tracking-widest opacity-60">Fun Fact</h4>
                        <p className="text-sm italic opacity-80">"{content.funFact}"</p>
                    </div>
                </div>
            </div>
        </div>
    );
};

// --- PLANT GUIDE RENDERER ---
const PlantGuideRenderer: React.FC<{ content: any; isDarkMode: boolean; theme?: ThemePalette }> = ({ content, isDarkMode, theme }) => {
    const [image, setImage] = useState<string | null>(null);

    useEffect(() => {
        if (content?.name) {
            import('../services/imageSearchService').then(({ searchImages }) => {
                searchImages(`${content.name} plant botanical photography`, 1).then(results => {
                    if (results?.[0]) setImage(results[0].thumbnail.src);
                });
            });
        }
    }, [content?.name]);

    if (!content?.name) return null;

    return (
        <div className={`flex flex-col md:flex-row gap-6 p-6 rounded-2xl border ${isDarkMode ? 'bg-emerald-950/20 border-emerald-900' : 'bg-emerald-50/50 border-emerald-100'}`} style={theme ? { backgroundColor: theme.surface, borderColor: theme.secondary } : {}}>
            <div className="w-full md:w-1/3 aspect-[3/4] rounded-xl overflow-hidden relative shadow-lg">
                {image ? (
                    <img src={image} alt={content.name} className="w-full h-full object-cover" />
                ) : (
                    <div className="w-full h-full bg-emerald-100 dark:bg-emerald-900 flex items-center justify-center text-6xl opacity-20">🌿</div>
                )}
            </div>

            <div className="flex-1 space-y-6">
                <div>
                    <h3 className="text-3xl font-serif font-bold text-emerald-800 dark:text-emerald-400">{content.name}</h3>
                    <div className="text-sm font-mono opacity-60 italic">{content.scientificName}</div>
                </div>

                <div className="grid grid-cols-2 gap-4">
                    <div className={`p-3 rounded-lg ${isDarkMode ? 'bg-white/5' : 'bg-white/60'}`}>
                        <div className="text-xs uppercase tracking-wider opacity-50 mb-1">Water</div>
                        <div className="font-bold">{content.care?.water}</div>
                    </div>
                    <div className={`p-3 rounded-lg ${isDarkMode ? 'bg-white/5' : 'bg-white/60'}`}>
                        <div className="text-xs uppercase tracking-wider opacity-50 mb-1">Light</div>
                        <div className="font-bold">{content.care?.light}</div>
                    </div>
                </div>

                <div>
                    <h4 className="font-bold mb-2 text-sm uppercase tracking-wider opacity-70">Benefits</h4>
                    <ul className="list-disc list-inside text-sm opacity-80 space-y-1">
                        {content.benefits?.map((benefit: string, i: number) => (
                            <li key={i}>{benefit}</li>
                        ))}
                    </ul>
                </div>
            </div>
        </div>
    );
};

// --- SPACE EXPLORATION RENDERER ---
const SpaceExplorationRenderer: React.FC<{ content: any; isDarkMode: boolean; theme?: ThemePalette }> = ({ content, isDarkMode, theme }) => {
    const [image, setImage] = useState<string | null>(null);

    useEffect(() => {
        if (content?.topic) {
            import('../services/imageSearchService').then(({ searchImages }) => {
                searchImages(`${content.topic} space astronomy hubble`, 1).then(results => {
                    if (results?.[0]) setImage(results[0].thumbnail.src);
                });
            });
        }
    }, [content?.topic]);

    if (!content?.topic) return null;

    return (
        <div className={`rounded-2xl overflow-hidden border relative ${isDarkMode ? 'bg-black border-slate-800' : 'bg-slate-900 border-slate-700'}`} style={theme ? { backgroundColor: theme.surface, borderColor: theme.secondary } : {}}>
            <div className="absolute inset-0 opacity-30">
                {image && <img src={image} alt={content.topic} className="w-full h-full object-cover blur-sm scale-110" />}
            </div>

            <div className="relative z-10 p-8 text-white">
                <div className="flex flex-col md:flex-row gap-8 items-center">
                    <div className="w-48 h-48 rounded-full border-4 border-white/10 shadow-[0_0_50px_rgba(255,255,255,0.2)] overflow-hidden shrink-0 bg-black">
                        {image ? (
                            <img src={image} alt={content.topic} className="w-full h-full object-cover" />
                        ) : (
                            <div className="w-full h-full flex items-center justify-center text-6xl">🪐</div>
                        )}
                    </div>

                    <div className="flex-1 text-center md:text-left">
                        <div className="text-xs font-mono text-blue-400 mb-2 uppercase tracking-[0.2em]">Cosmic Entity</div>
                        <h3 className="text-5xl font-bold mb-4 bg-clip-text text-transparent bg-gradient-to-r from-white to-slate-400">{content.topic}</h3>

                        <div className="grid grid-cols-2 gap-x-8 gap-y-4 text-left">
                            {content.stats && Object.entries(content.stats).map(([key, value]: [string, any], i) => (
                                <div key={i} className="border-l-2 border-blue-500/50 pl-3">
                                    <div className="text-[10px] uppercase opacity-50">{key}</div>
                                    <div className="font-mono text-lg">{value}</div>
                                </div>
                            ))}
                        </div>
                    </div>
                </div>

                <div className="mt-8 p-6 rounded-xl bg-white/5 backdrop-blur-md border border-white/10">
                    <p className="leading-relaxed opacity-90 font-light text-lg">{content.description}</p>
                </div>
            </div>
        </div>
    );
};
// ============================================
// NEW LIFESTYLE & DESIGN WIDGET RENDERERS
// ============================================

// --- FASHION LOOKBOOK RENDERER ---
const FashionLookbookRenderer: React.FC<{ content: any; isDarkMode: boolean; theme?: ThemePalette }> = ({ content, isDarkMode, theme }) => {
    const [images, setImages] = useState<Record<string, string>>({});

    useEffect(() => {
        if (content?.items) {
            content.items.forEach((item: any) => {
                import('../services/imageSearchService').then(({ searchImages }) => {
                    searchImages(`${item.name} fashion item ${content.style}`, 1).then(results => {
                        if (results?.[0]) setImages(prev => ({ ...prev, [item.name]: results[0].thumbnail.src }));
                    });
                });
            });
        }
    }, [content?.items, content?.style]);

    if (!content?.items) return null;

    return (
        <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
            {content.items.map((item: any, i: number) => (
                <div key={i} className={`group relative aspect-[3/4] overflow-hidden rounded-none border ${isDarkMode ? 'border-white/10' : 'border-black/10'}`}>
                    {images[item.name] ? (
                        <img src={images[item.name]} alt={item.name} className="w-full h-full object-cover transition-transform duration-700 group-hover:scale-105" />
                    ) : (
                        <div className="w-full h-full bg-gray-100 dark:bg-gray-900 flex items-center justify-center text-4xl opacity-20">👗</div>
                    )}
                    <div className="absolute inset-0 bg-black/0 group-hover:bg-black/20 transition-colors duration-300 flex items-end p-4">
                        <div className="bg-white dark:bg-black p-3 w-full translate-y-full group-hover:translate-y-0 transition-transform duration-300">
                            <h4 className="font-bold text-sm uppercase tracking-widest mb-1">{item.name}</h4>
                            <div className="text-xs opacity-60">{item.brand} • {item.price}</div>
                        </div>
                    </div>
                </div>
            ))}
        </div>
    );
};

// --- ARCHITECTURAL STYLE RENDERER ---
const ArchitecturalStyleRenderer: React.FC<{ content: any; isDarkMode: boolean; theme?: ThemePalette }> = ({ content, isDarkMode, theme }) => {
    const [images, setImages] = useState<{ main?: string; details: Record<string, string> }>({ details: {} });

    useEffect(() => {
        if (content?.style) {
            import('../services/imageSearchService').then(({ searchImages }) => {
                // Main
                searchImages(`${content.style} architecture building example`, 1).then(results => {
                    if (results?.[0]) setImages(prev => ({ ...prev, main: results[0].thumbnail.src }));
                });
                // Features
                if (content.features) {
                    content.features.forEach((feature: string) => {
                        searchImages(`${content.style} architecture ${feature} detail`, 1).then(results => {
                            if (results?.[0]) setImages(prev => ({ ...prev, details: { ...prev.details, [feature]: results[0].thumbnail.src } }));
                        });
                    });
                }
            });
        }
    }, [content?.style, content?.features]);

    if (!content?.style) return null;

    return (
        <div className={`p-8 rounded-2xl border ${isDarkMode ? 'bg-stone-900 border-stone-800' : 'bg-stone-50 border-stone-200'}`} style={theme ? { backgroundColor: theme.surface, borderColor: theme.secondary } : {}}>
            <div className="flex flex-col md:flex-row gap-8 mb-8">
                <div className="w-full md:w-1/2 aspect-video rounded-lg overflow-hidden shadow-xl">
                    {images.main ? (
                        <img src={images.main} alt={content.style} className="w-full h-full object-cover" />
                    ) : (
                        <div className="w-full h-full bg-stone-200 dark:bg-stone-800 flex items-center justify-center text-6xl opacity-20">🏛️</div>
                    )}
                </div>
                <div className="flex-1 flex flex-col justify-center">
                    <h3 className="text-4xl font-serif font-bold mb-4">{content.style}</h3>
                    <div className="text-sm font-bold uppercase tracking-widest opacity-50 mb-4">{content.era} • {content.region}</div>
                    <p className="leading-relaxed opacity-80">{content.description}</p>
                </div>
            </div>

            <h4 className="font-bold text-sm uppercase tracking-widest opacity-60 mb-4">Key Features</h4>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                {content.features.map((feature: string, i: number) => (
                    <div key={i} className="group relative aspect-square rounded-lg overflow-hidden">
                        {images.details[feature] ? (
                            <img src={images.details[feature]} alt={feature} className="w-full h-full object-cover transition-transform duration-500 group-hover:scale-110" />
                        ) : (
                            <div className="w-full h-full bg-stone-200 dark:bg-stone-800" />
                        )}
                        <div className="absolute inset-0 bg-black/50 flex items-center justify-center p-2 text-center opacity-0 group-hover:opacity-100 transition-opacity duration-300">
                            <span className="text-white font-bold text-sm">{feature}</span>
                        </div>
                    </div>
                ))}
            </div>
        </div>
    );
};

// --- VEHICLE SHOWCASE RENDERER ---
const VehicleShowcaseRenderer: React.FC<{ content: any; isDarkMode: boolean; theme?: ThemePalette }> = ({ content, isDarkMode, theme }) => {
    const [image, setImage] = useState<string | null>(null);

    useEffect(() => {
        if (content?.model) {
            import('../services/imageSearchService').then(({ searchImages }) => {
                searchImages(`${content.make} ${content.model} ${content.year} car`, 1).then(results => {
                    if (results?.[0]) setImage(results[0].thumbnail.src);
                });
            });
        }
    }, [content?.model]);

    if (!content?.model) return null;

    return (
        <div className={`rounded-2xl overflow-hidden border ${isDarkMode ? 'bg-slate-900 border-slate-800' : 'bg-slate-50 border-slate-200'}`} style={theme ? { backgroundColor: theme.surface, borderColor: theme.secondary } : {}}>
            <div className="h-64 relative bg-gradient-to-br from-slate-200 to-slate-300 dark:from-slate-800 dark:to-slate-900 flex items-center justify-center overflow-hidden">
                {image ? (
                    <img src={image} alt={content.model} className="w-full h-full object-cover mix-blend-overlay opacity-50 absolute inset-0" />
                ) : null}
                {image && <img src={image} alt={content.model} className="relative z-10 w-3/4 drop-shadow-2xl transform -rotate-2 hover:rotate-0 transition-transform duration-500" />}
            </div>

            <div className="p-8">
                <div className="flex justify-between items-end mb-6">
                    <div>
                        <div className="text-sm font-bold uppercase tracking-widest opacity-50">{content.make}</div>
                        <h3 className="text-4xl font-black italic">{content.model}</h3>
                    </div>
                    <div className="text-2xl font-mono font-bold text-blue-500">{content.price}</div>
                </div>

                <div className="grid grid-cols-3 gap-4 mb-6">
                    {content.specs && Object.entries(content.specs).map(([key, value]: [string, any], i) => (
                        <div key={i} className={`p-3 rounded-lg text-center ${isDarkMode ? 'bg-white/5' : 'bg-white'}`}>
                            <div className="text-[10px] uppercase opacity-50 mb-1">{key}</div>
                            <div className="font-bold font-mono">{value}</div>
                        </div>
                    ))}
                </div>

                <p className="opacity-80 text-sm leading-relaxed">{content.description}</p>
            </div>
        </div>
    );
};

// --- PROPERTY LISTING RENDERER ---
const PropertyListingRenderer: React.FC<{ content: any; isDarkMode: boolean; theme?: ThemePalette }> = ({ content, isDarkMode, theme }) => {
    const [images, setImages] = useState<string[]>([]);

    useEffect(() => {
        if (content?.title) {
            import('../services/imageSearchService').then(({ searchImages }) => {
                searchImages(`${content.title} real estate house interior`, 3).then(results => {
                    if (results) setImages(results.map(r => r.thumbnail.src));
                });
            });
        }
    }, [content?.title]);

    if (!content?.title) return null;

    return (
        <div className={`rounded-2xl overflow-hidden border ${isDarkMode ? 'bg-white/5 border-white/10' : 'bg-white border-gray-200'}`} style={theme ? { backgroundColor: theme.surface, borderColor: theme.secondary } : {}}>
            <div className="grid grid-cols-2 gap-1 h-64">
                <div className="h-full bg-gray-200 dark:bg-gray-800">
                    {images[0] && <img src={images[0]} alt="Main" className="w-full h-full object-cover" />}
                </div>
                <div className="grid grid-rows-2 gap-1 h-full">
                    <div className="bg-gray-200 dark:bg-gray-800">
                        {images[1] && <img src={images[1]} alt="Detail 1" className="w-full h-full object-cover" />}
                    </div>
                    <div className="bg-gray-200 dark:bg-gray-800 relative">
                        {images[2] && <img src={images[2]} alt="Detail 2" className="w-full h-full object-cover" />}
                        <div className="absolute inset-0 bg-black/50 flex items-center justify-center text-white font-bold text-sm uppercase tracking-widest cursor-pointer hover:bg-black/60 transition-colors">
                            View Gallery
                        </div>
                    </div>
                </div>
            </div>

            <div className="p-6">
                <div className="flex justify-between items-start mb-4">
                    <div>
                        <h3 className="text-2xl font-bold mb-1">{content.title}</h3>
                        <div className="flex items-center gap-2 text-sm opacity-60">
                            <span>📍 {content.location}</span>
                        </div>
                    </div>
                    <div className="text-xl font-bold text-green-500">{content.price}</div>
                </div>

                <div className="flex gap-6 text-sm font-medium opacity-80 mb-6 border-y py-3 border-dashed" style={{ borderColor: isDarkMode ? '#333' : '#eee' }}>
                    <span>🛏️ {content.beds} Beds</span>
                    <span>🚿 {content.baths} Baths</span>
                    <span>📐 {content.sqft} sqft</span>
                </div>

                <h4 className="font-bold text-sm uppercase tracking-widest opacity-60 mb-2">Features</h4>
                <div className="flex flex-wrap gap-2">
                    {content.features.map((feature: string, i: number) => (
                        <span key={i} className={`text-xs px-2 py-1 rounded-md ${isDarkMode ? 'bg-white/10' : 'bg-gray-100'}`}>
                            {feature}
                        </span>
                    ))}
                </div>
            </div>
        </div>
    );
};

// --- NEWS GALLERY RENDERER ---
const NewsGalleryRenderer: React.FC<{ content: any; isDarkMode: boolean; theme?: ThemePalette }> = ({ content, isDarkMode, theme }) => {
    const [newsImages, setNewsImages] = useState<Record<string, string>>({});

    const articles = useMemo(() => {
        const raw = (content?.articles || content?.headlines || []) as any[];
        if (!Array.isArray(raw)) return [];
        return raw
            .map((a: any) => {
                const headline = (a?.headline || a?.title || '').toString();
                const source = (a?.source || '').toString();
                const date = (a?.date || '').toString();
                const summary = (a?.summary || '').toString();
                const url = (a?.url || a?.link || '').toString();
                const imageUrl = (a?.imageUrl || a?.image_url || '').toString();
                return { headline, source, date, summary, url, imageUrl };
            })
            .filter((a: any) => a.headline);
    }, [content]);

    useEffect(() => {
        if (!articles || articles.length === 0) return;

        articles.forEach((article: any) => {
            const key = (article.url || article.headline || '').toString();
            if (!key) return;
            if (article.imageUrl) return;
            if (newsImages[key]) return;

            import('../services/imageSearchService').then(({ searchImages }) => {
                const query = `${article.headline} ${article.source || ''} news photo`.trim();
                searchImages(query, 1).then(results => {
                    if (results?.[0]?.thumbnail?.src) {
                        setNewsImages(prev => ({ ...prev, [key]: results[0].thumbnail.src }));
                    }
                });
            });
        });
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [articles]);

    if (!articles || articles.length === 0) return null;

    return (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            {articles.map((article: any, i: number) => {
                const key = (article.url || article.headline || '').toString();
                const imgSrc = article.imageUrl || (key ? newsImages[key] : undefined);
                return (
                    <div key={i} className={`flex flex-col rounded-xl overflow-hidden border ${isDarkMode ? 'bg-white/5 border-white/10' : 'bg-white border-gray-200'}`} style={theme ? { backgroundColor: theme.surface, borderColor: theme.secondary } : {}}>
                        <div className="h-48 bg-gray-200 dark:bg-gray-800 relative">
                            {imgSrc ? (
                                <img src={imgSrc} alt={article.headline} className="w-full h-full object-cover" />
                            ) : (
                                <div className="w-full h-full flex items-center justify-center text-4xl opacity-20">📰</div>
                            )}
                            <div className="absolute top-4 left-4 bg-red-600 text-white text-[10px] font-bold px-2 py-1 uppercase tracking-widest rounded">
                                {article.source}
                            </div>
                        </div>
                        <div className="p-6 flex-1 flex flex-col">
                            <div className="text-xs opacity-50 mb-2">{article.date}</div>
                            <h4 className="font-bold text-lg mb-2 leading-tight hover:text-blue-500 cursor-pointer transition-colors">{article.headline}</h4>
                            <p className="text-sm opacity-80 line-clamp-3 mb-4 flex-1">{article.summary}</p>
                            {article.url ? (
                                <a href={article.url} target="_blank" rel="noopener noreferrer" className="text-xs font-bold uppercase tracking-widest text-blue-500 hover:underline mt-auto">
                                    Read Full Story →
                                </a>
                            ) : (
                                <div className="text-xs font-bold uppercase tracking-widest opacity-40 mt-auto">
                                    Source link unavailable
                                </div>
                            )}
                        </div>
                    </div>
                );
            })}
        </div>
    );
};

// --- 10. WORD CLOUD (3D Nebula Effect) ---
const WordCloudRenderer: React.FC<{ content: any; isDarkMode: boolean; theme?: ThemePalette }> = ({ content, isDarkMode, theme }) => {
    const [hoveredWord, setHoveredWord] = useState<string | null>(null);

    if (!content?.words || content.words.length === 0) return null;

    const maxWeight = Math.max(...content.words.map((w: any) => w.weight || 1));

    return (
        <div className={`p-8 rounded-2xl border ${isDarkMode ? 'bg-gradient-to-br from-slate-900 to-slate-800 border-white/10' : 'bg-gradient-to-br from-slate-100 to-slate-50 border-gray-200'}`} style={theme ? { backgroundColor: theme.surface, borderColor: theme.secondary } : {}}>
            <div className="flex items-center gap-3 mb-6">
                <span className="text-3xl">☁️</span>
                <h4 className="text-lg font-bold uppercase tracking-widest" style={theme ? { color: theme.primary } : {}}>Topic Cloud</h4>
            </div>

            <div className="flex flex-wrap justify-center gap-3 min-h-[200px] items-center">
                {content.words.map((word: any, i: number) => {
                    const size = 12 + (word.weight / maxWeight) * 24;
                    const isHovered = hoveredWord === word.text;

                    return (
                        <span
                            key={i}
                            className="cursor-pointer transition-all duration-300 hover:scale-110"
                            style={{
                                fontSize: size,
                                fontWeight: word.weight > maxWeight / 2 ? 'bold' : 'normal',
                                color: isHovered ? (theme?.accent || '#f472b6') : (theme?.primary || (isDarkMode ? '#fff' : '#000')),
                                opacity: isHovered ? 1 : 0.6 + (word.weight / maxWeight) * 0.4,
                                textShadow: isHovered ? `0 0 20px ${theme?.accent || '#f472b6'}` : 'none'
                            }}
                            onMouseEnter={() => setHoveredWord(word.text)}
                            onMouseLeave={() => setHoveredWord(null)}
                        >
                            {word.text}
                        </span>
                    );
                })}
            </div>

            {hoveredWord && content.words.find((w: any) => w.text === hoveredWord)?.context && (
                <div className={`mt-6 p-4 rounded-xl animate-fade-in ${isDarkMode ? 'bg-white/5' : 'bg-gray-100'}`}>
                    <div className="text-xs uppercase tracking-widest opacity-50 mb-2">Context</div>
                    <p className="text-sm" style={theme ? { color: theme.text } : {}}>
                        {content.words.find((w: any) => w.text === hoveredWord)?.context}
                    </p>
                </div>
            )}
        </div>
    );
};

// --- 11. ICEBERG DEPTH (Hidden Complexity) ---
const IcebergDepthRenderer: React.FC<{ content: any; isDarkMode: boolean; theme?: ThemePalette }> = ({ content, isDarkMode, theme }) => {
    const [scrollDepth, setScrollDepth] = useState(0);

    if (!content?.layers) return null;

    const surfaceLayers = content.layers.filter((l: any) => l.depth === 'surface');
    const hiddenLayers = content.layers.filter((l: any) => l.depth === 'hidden');
    const deepLayers = content.layers.filter((l: any) => l.depth === 'deep');

    return (
        <div className={`rounded-2xl border overflow-hidden ${isDarkMode ? 'bg-gradient-to-b from-sky-900 via-blue-950 to-slate-950 border-sky-500/20' : 'bg-gradient-to-b from-sky-100 via-blue-200 to-slate-300 border-sky-300'}`} style={theme ? { borderColor: theme.secondary } : {}}>
            <div className="p-8">
                <div className="flex items-center gap-3 mb-6">
                    <span className="text-3xl">🧊</span>
                    <h4 className="text-lg font-bold uppercase tracking-widest" style={theme ? { color: theme.primary } : {}}>The Iceberg Model</h4>
                </div>
            </div>

            <div className="relative">
                <div className="absolute inset-x-0 top-1/3 h-1 bg-gradient-to-r from-transparent via-white/50 to-transparent z-10" />
                <div className="text-center text-xs uppercase tracking-widest opacity-50 absolute left-4 top-1/3 -translate-y-1/2 z-10">Waterline</div>

                <div className={`p-8 ${isDarkMode ? 'bg-sky-600/20' : 'bg-sky-200/50'}`}>
                    <div className="text-xs uppercase tracking-widest opacity-50 mb-4">What You See</div>
                    <div className="grid gap-3">
                        {surfaceLayers.map((layer: any, i: number) => (
                            <div key={i} className={`p-4 rounded-xl ${isDarkMode ? 'bg-white/10' : 'bg-white/80'}`}>
                                <div className="font-medium" style={theme ? { color: theme.text } : {}}>{layer.title}</div>
                                {layer.description && <div className="text-sm opacity-60 mt-1">{layer.description}</div>}
                            </div>
                        ))}
                    </div>
                </div>

                <div className={`p-8 ${isDarkMode ? 'bg-blue-900/30' : 'bg-blue-300/50'}`}>
                    <div className="text-xs uppercase tracking-widest opacity-50 mb-4">Hidden Beneath</div>
                    <div className="grid gap-3">
                        {hiddenLayers.map((layer: any, i: number) => (
                            <div key={i} className={`p-4 rounded-xl ${isDarkMode ? 'bg-white/5' : 'bg-white/60'}`}>
                                <div className="font-medium" style={theme ? { color: theme.text } : {}}>{layer.title}</div>
                                {layer.description && <div className="text-sm opacity-60 mt-1">{layer.description}</div>}
                            </div>
                        ))}
                    </div>
                </div>

                <div className={`p-8 ${isDarkMode ? 'bg-slate-900/50' : 'bg-slate-400/50'}`}>
                    <div className="text-xs uppercase tracking-widest opacity-50 mb-4">Deep Structure</div>
                    <div className="grid gap-3">
                        {deepLayers.map((layer: any, i: number) => (
                            <div key={i} className={`p-4 rounded-xl ${isDarkMode ? 'bg-white/5' : 'bg-white/40'}`}>
                                <div className="font-medium" style={theme ? { color: theme.text } : {}}>{layer.title}</div>
                                {layer.description && <div className="text-sm opacity-60 mt-1">{layer.description}</div>}
                            </div>
                        ))}
                    </div>
                </div>
            </div>
        </div>
    );
};

// --- 12. SHIELD METER (Security/Protection Visualization) ---
const ShieldMeterRenderer: React.FC<{ content: any; isDarkMode: boolean; theme?: ThemePalette }> = ({ content, isDarkMode, theme }) => {
    if (!content?.integrity) return null;

    const integrity = Math.min(100, Math.max(0, content.integrity));
    const status = integrity > 80 ? 'Strong' : integrity > 50 ? 'Moderate' : integrity > 20 ? 'Weak' : 'Critical';
    const statusColor = integrity > 80 ? '#10b981' : integrity > 50 ? '#f59e0b' : integrity > 20 ? '#f97316' : '#ef4444';

    return (
        <div className={`p-8 rounded-2xl border ${isDarkMode ? 'bg-gradient-to-br from-emerald-950/30 to-teal-950/30 border-emerald-500/20' : 'bg-gradient-to-br from-emerald-50 to-teal-50 border-emerald-200'}`} style={theme ? { backgroundColor: theme.surface, borderColor: theme.secondary } : {}}>
            <div className="flex items-center gap-3 mb-6">
                <span className="text-3xl">🛡️</span>
                <h4 className="text-lg font-bold uppercase tracking-widest" style={theme ? { color: theme.primary } : {}}>
                    {content.title || 'Protection Status'}
                </h4>
            </div>

            <div className="flex items-center justify-center mb-8">
                <div className="relative w-48 h-48">
                    <svg viewBox="0 0 100 100" className="w-full h-full transform -rotate-90">
                        <circle cx="50" cy="50" r="45" fill="none" stroke={isDarkMode ? '#ffffff10' : '#00000010'} strokeWidth="8" />
                        <circle
                            cx="50"
                            cy="50"
                            r="45"
                            fill="none"
                            stroke={statusColor}
                            strokeWidth="8"
                            strokeLinecap="round"
                            strokeDasharray={`${integrity * 2.83} 283`}
                            className="transition-all duration-1000"
                        />
                    </svg>
                    <div className="absolute inset-0 flex flex-col items-center justify-center">
                        <div className="text-4xl font-bold" style={{ color: statusColor }}>{integrity}%</div>
                        <div className="text-xs uppercase tracking-widest opacity-50">{status}</div>
                    </div>
                </div>
            </div>

            {content.threats && content.threats.length > 0 && (
                <div>
                    <div className="text-xs uppercase tracking-widest opacity-50 mb-3">Active Threats</div>
                    <div className="grid gap-2">
                        {content.threats.map((threat: any, i: number) => (
                            <div key={i} className={`p-3 rounded-lg flex items-center justify-between ${isDarkMode ? 'bg-red-500/10' : 'bg-red-50'}`}>
                                <span className="text-sm" style={theme ? { color: theme.text } : {}}>{threat.name}</span>
                                <span className={`px-2 py-1 rounded text-xs font-bold ${threat.severity === 'high' ? 'bg-red-500/20 text-red-500' :
                                    threat.severity === 'medium' ? 'bg-amber-500/20 text-amber-500' :
                                        'bg-green-500/20 text-green-500'
                                    }`}>
                                    {threat.severity}
                                </span>
                            </div>
                        ))}
                    </div>
                </div>
            )}

            {content.protections && content.protections.length > 0 && (
                <div className="mt-6">
                    <div className="text-xs uppercase tracking-widest opacity-50 mb-3">Active Protections</div>
                    <div className="flex flex-wrap gap-2">
                        {content.protections.map((p: string, i: number) => (
                            <span key={i} className={`px-3 py-1 rounded-full text-xs font-medium ${isDarkMode ? 'bg-emerald-500/20 text-emerald-400' : 'bg-emerald-100 text-emerald-700'}`}>
                                ✓ {p}
                            </span>
                        ))}
                    </div>
                </div>
            )}
        </div>
    );
};

// --- 13. CONFIDENCE GAUGE (Reliability Meter) ---
const ConfidenceGaugeRenderer: React.FC<{ content: any; isDarkMode: boolean; theme?: ThemePalette }> = ({ content, isDarkMode, theme }) => {
    if (!content?.claims) return null;

    return (
        <div className={`p-8 rounded-2xl border ${isDarkMode ? 'bg-white/5 border-white/10' : 'bg-white border-gray-200'}`} style={theme ? { backgroundColor: theme.surface, borderColor: theme.secondary } : {}}>
            <div className="flex items-center gap-3 mb-6">
                <span className="text-3xl">📊</span>
                <h4 className="text-lg font-bold uppercase tracking-widest" style={theme ? { color: theme.primary } : {}}>Confidence Levels</h4>
            </div>

            <div className="space-y-6">
                {content.claims.map((claim: any, i: number) => {
                    const confidence = claim.confidence || 50;
                    const color = confidence > 80 ? '#10b981' : confidence > 60 ? '#3b82f6' : confidence > 40 ? '#f59e0b' : '#ef4444';
                    const label = confidence > 80 ? 'High Confidence' : confidence > 60 ? 'Moderate' : confidence > 40 ? 'Low' : 'Uncertain';

                    return (
                        <div key={i} className={`p-4 rounded-xl ${isDarkMode ? 'bg-white/5' : 'bg-gray-50'}`}>
                            <div className="flex items-start justify-between mb-3">
                                <div className="flex-1">
                                    <p className="font-medium" style={theme ? { color: theme.text } : {}}>{claim.statement}</p>
                                    {claim.source && <p className="text-xs opacity-50 mt-1">Source: {claim.source}</p>}
                                </div>
                                <span className="px-2 py-1 rounded text-xs font-bold ml-4" style={{ backgroundColor: color + '20', color }}>
                                    {label}
                                </span>
                            </div>
                            <div className="relative h-2 rounded-full overflow-hidden" style={{ backgroundColor: isDarkMode ? '#ffffff10' : '#00000010' }}>
                                <div
                                    className="absolute inset-y-0 left-0 rounded-full transition-all duration-1000"
                                    style={{ width: `${confidence}%`, backgroundColor: color }}
                                />
                            </div>
                            <div className="flex justify-between mt-1 text-[10px] opacity-40">
                                <span>0%</span>
                                <span>{confidence}% confidence</span>
                                <span>100%</span>
                            </div>
                        </div>
                    );
                })}
            </div>

            {content.methodology && (
                <div className={`mt-6 p-4 rounded-xl ${isDarkMode ? 'bg-blue-500/10 border border-blue-500/30' : 'bg-blue-50 border border-blue-200'}`}>
                    <div className="text-xs uppercase tracking-widest opacity-50 mb-2">Methodology</div>
                    <p className="text-sm opacity-80" style={theme ? { color: theme.text } : {}}>{content.methodology}</p>
                </div>
            )}
        </div>
    );
};

// --- 14. ACTION ITEMS (Generated To-Do List) ---
const ActionItemsRenderer: React.FC<{ content: any; isDarkMode: boolean; theme?: ThemePalette }> = ({ content, isDarkMode, theme }) => {
    const [completed, setCompleted] = useState<Set<number>>(new Set());

    if (!content?.items) return null;

    const toggleItem = (index: number) => {
        setCompleted(prev => {
            const next = new Set(prev);
            if (next.has(index)) next.delete(index);
            else next.add(index);
            return next;
        });
    };

    const progress = (completed.size / content.items.length) * 100;

    return (
        <div className={`p-8 rounded-2xl border ${isDarkMode ? 'bg-gradient-to-br from-amber-950/30 to-orange-950/30 border-amber-500/20' : 'bg-gradient-to-br from-amber-50 to-orange-50 border-amber-200'}`} style={theme ? { backgroundColor: theme.surface, borderColor: theme.secondary } : {}}>
            <div className="flex items-center justify-between mb-6">
                <div className="flex items-center gap-3">
                    <span className="text-3xl">✅</span>
                    <h4 className="text-lg font-bold uppercase tracking-widest" style={theme ? { color: theme.primary } : {}}>Action Items</h4>
                </div>
                <span className="text-sm font-mono opacity-60">{completed.size}/{content.items.length}</span>
            </div>

            <div className="relative h-2 rounded-full overflow-hidden mb-6" style={{ backgroundColor: isDarkMode ? '#ffffff10' : '#00000010' }}>
                <div
                    className="absolute inset-y-0 left-0 rounded-full transition-all duration-500"
                    style={{ width: `${progress}%`, backgroundColor: theme?.primary || '#f59e0b' }}
                />
            </div>

            <div className="space-y-3">
                {content.items.map((item: any, i: number) => {
                    const isCompleted = completed.has(i);

                    return (
                        <div
                            key={i}
                            className={`p-4 rounded-xl cursor-pointer transition-all ${isCompleted
                                ? (isDarkMode ? 'bg-green-500/10 line-through opacity-50' : 'bg-green-50 line-through opacity-50')
                                : (isDarkMode ? 'bg-white/5 hover:bg-white/10' : 'bg-white hover:bg-gray-50')
                                }`}
                            onClick={() => toggleItem(i)}
                        >
                            <div className="flex items-start gap-4">
                                <div className={`w-6 h-6 rounded-full border-2 flex items-center justify-center shrink-0 transition-all ${isCompleted
                                    ? 'bg-green-500 border-green-500 text-white'
                                    : (isDarkMode ? 'border-white/30' : 'border-gray-300')
                                    }`}>
                                    {isCompleted && <span className="text-sm">✓</span>}
                                </div>
                                <div className="flex-1">
                                    <div className="font-medium" style={theme ? { color: theme.text } : {}}>{item.task}</div>
                                    {item.details && <div className="text-sm opacity-60 mt-1">{item.details}</div>}
                                    {item.priority && (
                                        <span className={`inline-block mt-2 px-2 py-0.5 rounded text-xs font-bold ${item.priority === 'high' ? 'bg-red-500/20 text-red-500' :
                                            item.priority === 'medium' ? 'bg-amber-500/20 text-amber-500' :
                                                'bg-blue-500/20 text-blue-500'
                                            }`}>
                                            {item.priority} priority
                                        </span>
                                    )}
                                </div>
                            </div>
                        </div>
                    );
                })}
            </div>
        </div>
    );
};

// --- 15. ELI5 TOGGLE (Complexity Switcher) ---
const ELI5ToggleRenderer: React.FC<{ content: any; isDarkMode: boolean; theme?: ThemePalette }> = ({ content, isDarkMode, theme }) => {
    const [isSimple, setIsSimple] = useState(false);

    if (!content?.technical || !content?.simple) return null;

    return (
        <div className={`p-8 rounded-2xl border ${isDarkMode ? 'bg-white/5 border-white/10' : 'bg-white border-gray-200'}`} style={theme ? { backgroundColor: theme.surface, borderColor: theme.secondary } : {}}>
            <div className="flex items-center justify-between mb-6">
                <div className="flex items-center gap-3">
                    <span className="text-3xl">{isSimple ? '🧒' : '🎓'}</span>
                    <h4 className="text-lg font-bold uppercase tracking-widest" style={theme ? { color: theme.primary } : {}}>
                        {content.title || 'Explanation'}
                    </h4>
                </div>

                <button
                    onClick={() => setIsSimple(!isSimple)}
                    className={`relative w-20 h-10 rounded-full p-1 transition-all ${isSimple
                        ? (isDarkMode ? 'bg-pink-500' : 'bg-pink-500')
                        : (isDarkMode ? 'bg-blue-600' : 'bg-blue-600')
                        }`}
                >
                    <div className={`w-8 h-8 rounded-full bg-white shadow-lg transform transition-all flex items-center justify-center text-sm ${isSimple ? 'translate-x-10' : 'translate-x-0'
                        }`}>
                        {isSimple ? '🧒' : '🎓'}
                    </div>
                </button>
            </div>

            <div className="flex justify-center gap-4 mb-6">
                <span className={`text-xs uppercase tracking-widest transition-all ${!isSimple ? 'opacity-100 font-bold' : 'opacity-40'}`}>Technical</span>
                <span className={`text-xs uppercase tracking-widest transition-all ${isSimple ? 'opacity-100 font-bold' : 'opacity-40'}`}>ELI5</span>
            </div>

            <div className={`p-6 rounded-xl transition-all ${isDarkMode ? 'bg-white/5' : 'bg-gray-50'}`}>
                <p className="text-lg leading-relaxed animate-fade-in" style={theme ? { color: theme.text } : {}}>
                    {isSimple ? content.simple : content.technical}
                </p>
            </div>

            {content.analogy && isSimple && (
                <div className={`mt-4 p-4 rounded-xl ${isDarkMode ? 'bg-pink-500/10 border border-pink-500/30' : 'bg-pink-50 border border-pink-200'}`}>
                    <div className="text-xs uppercase tracking-widest opacity-50 mb-2">Think of it like...</div>
                    <p className="text-sm" style={theme ? { color: theme.text } : {}}>{content.analogy}</p>
                </div>
            )}
        </div>
    );
};

// --- 16. ICP PERSONA GRID ---
const PersonaGridRenderer: React.FC<{ content: any; isDarkMode: boolean; theme?: ThemePalette }> = ({ content, isDarkMode, theme }) => {
    if (!content?.personas || !Array.isArray(content.personas) || content.personas.length === 0) return null;

    const personas = content.personas;

    return (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {personas.map((persona: any, idx: number) => (
                <GlassCard
                    key={idx}
                    isDarkMode={isDarkMode}
                    theme={theme}
                    className="p-5 flex flex-col gap-3 h-full"
                >
                    <div className="flex items-center gap-3">
                        <div className="w-9 h-9 rounded-full bg-gradient-to-br from-indigo-500/20 to-purple-500/20 flex items-center justify-center text-base font-semibold">
                            {(persona.icon as string) || '👤'}
                        </div>
                        <div>
                            <div className="text-sm font-semibold leading-tight" style={theme ? { color: theme.text } : {}}>
                                {persona.name || 'Persona'}
                            </div>
                            {persona.segment && (
                                <div className="text-[11px] uppercase tracking-widest opacity-60">
                                    {persona.segment}
                                </div>
                            )}
                        </div>
                    </div>

                    {persona.goals && persona.goals.length > 0 && (
                        <div>
                            <div className="text-[11px] font-semibold uppercase tracking-widest opacity-60 mb-1">Goals</div>
                            <ul className="text-xs space-y-1 opacity-80">
                                {persona.goals.map((g: string, i: number) => (
                                    <li key={i}>• {g}</li>
                                ))}
                            </ul>
                        </div>
                    )}

                    {persona.pains && persona.pains.length > 0 && (
                        <div>
                            <div className="text-[11px] font-semibold uppercase tracking-widest opacity-60 mb-1">Pains</div>
                            <ul className="text-xs space-y-1 opacity-80">
                                {persona.pains.map((p: string, i: number) => (
                                    <li key={i}>• {p}</li>
                                ))}
                            </ul>
                        </div>
                    )}

                    {persona.triggers && persona.triggers.length > 0 && (
                        <div>
                            <div className="text-[11px] font-semibold uppercase tracking-widest opacity-60 mb-1">Buying Triggers</div>
                            <ul className="text-xs space-y-1 opacity-80">
                                {persona.triggers.map((t: string, i: number) => (
                                    <li key={i}>• {t}</li>
                                ))}
                            </ul>
                        </div>
                    )}
                </GlassCard>
            ))}
        </div>
    );
};

// --- 17. GTM FUNNEL BREAKDOWN ---
const FunnelBreakdownRenderer: React.FC<{ content: any; isDarkMode: boolean; theme?: ThemePalette }> = ({ content, isDarkMode, theme }) => {
    if (!content?.stages || !Array.isArray(content.stages) || content.stages.length === 0) return null;

    return (
        <GlassCard isDarkMode={isDarkMode} theme={theme} className="p-6 md:p-8">
            <div className="space-y-5">
                {content.stages.map((stage: any, idx: number) => {
                    const conversion = stage.conversionToNext || '';
                    return (
                        <div key={idx} className="space-y-1.5">
                            <div className="flex justify-between items-center">
                                <div className="flex items-center gap-2">
                                    <span className="text-xs font-mono opacity-50">{idx + 1}</span>
                                    <span className="text-sm font-semibold">{stage.name}</span>
                                </div>
                                {stage.metric && (
                                    <span className="text-[11px] uppercase tracking-widest opacity-60">{stage.metric}</span>
                                )}
                            </div>
                            <div className="text-xs opacity-70 mb-1">{stage.description}</div>
                            <div className={`h-2 rounded-full overflow-hidden ${isDarkMode ? 'bg-white/10' : 'bg-black/5'}`}>
                                <div
                                    className="h-full rounded-full transition-all duration-500"
                                    style={{
                                        width: conversion ? conversion : '40%',
                                        background: theme ? theme.primary : '#6366f1',
                                    }}
                                />
                            </div>
                            <div className="flex justify-between text-[10px] opacity-50">
                                <span>{stage.currentValue || ''}</span>
                                {conversion && <span>Conversion → {conversion}</span>}
                            </div>
                            {stage.issues && stage.issues.length > 0 && (
                                <div className="mt-1 text-[11px] opacity-70">
                                    Bottlenecks: {stage.issues.join(', ')}
                                </div>
                            )}
                        </div>
                    );
                })}
            </div>
        </GlassCard>
    );
};

// --- 18. CHANNEL MIX BOARD ---
const ChannelMixBoardRenderer: React.FC<{ content: any; isDarkMode: boolean; theme?: ThemePalette }> = ({ content, isDarkMode, theme }) => {
    if (!content?.channels || !Array.isArray(content.channels) || content.channels.length === 0) return null;

    return (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {content.channels.map((ch: any, idx: number) => (
                <GlassCard key={idx} isDarkMode={isDarkMode} theme={theme} className="p-5 flex flex-col gap-3 h-full">
                    <div className="flex items-center justify-between gap-2">
                        <div>
                            <div className="text-sm font-semibold" style={theme ? { color: theme.text } : {}}>
                                {ch.name}
                            </div>
                            {ch.role && (
                                <div className="text-[11px] uppercase tracking-widest opacity-60">{ch.role}</div>
                            )}
                        </div>
                        {ch.strength && (
                            <span className="text-[10px] px-2 py-0.5 rounded-full border border-white/10 uppercase tracking-widest opacity-70">
                                {ch.strength}
                            </span>
                        )}
                    </div>
                    {ch.metrics && (
                        <div className="grid grid-cols-3 gap-2 text-[11px] opacity-80">
                            {ch.metrics.cac && (
                                <div>
                                    <div className="uppercase tracking-widest opacity-60">CAC</div>
                                    <div className="font-mono">{ch.metrics.cac}</div>
                                </div>
                            )}
                            {ch.metrics.roi && (
                                <div>
                                    <div className="uppercase tracking-widest opacity-60">ROI</div>
                                    <div className="font-mono">{ch.metrics.roi}</div>
                                </div>
                            )}
                            {ch.metrics.cvr && (
                                <div>
                                    <div className="uppercase tracking-widest opacity-60">CVR</div>
                                    <div className="font-mono">{ch.metrics.cvr}</div>
                                </div>
                            )}
                        </div>
                    )}
                    {ch.notes && (
                        <p className="text-xs opacity-70 mt-1">{ch.notes}</p>
                    )}
                </GlassCard>
            ))}
        </div>
    );
};

// --- 19. MESSAGING MATRIX ---
const MessagingMatrixRenderer: React.FC<{ content: any; isDarkMode: boolean; theme?: ThemePalette }> = ({ content, isDarkMode, theme }) => {
    if (!content?.segments || !Array.isArray(content.segments) || content.segments.length === 0) return null;

    return (
        <GlassCard isDarkMode={isDarkMode} theme={theme} className="p-6 md:p-8">
            <div className="space-y-5">
                {content.segments.map((seg: any, idx: number) => (
                    <div key={idx} className="border-b border-white/5 pb-4 mb-4 last:border-b-0 last:pb-0 last:mb-0">
                        <div className="flex flex-wrap items-center justify-between gap-2 mb-2">
                            <div className="text-sm font-semibold" style={theme ? { color: theme.text } : {}}>
                                {seg.name}
                            </div>
                            {seg.primaryPain && (
                                <div className="text-[11px] uppercase tracking-widest opacity-60">Pain: {seg.primaryPain}</div>
                            )}
                        </div>
                        {seg.coreMessage && (
                            <div className="text-sm mb-1">
                                <span className="font-semibold">Core message:</span> {seg.coreMessage}
                            </div>
                        )}
                        {seg.altMessages && seg.altMessages.length > 0 && (
                            <div className="text-xs opacity-75">
                                Alternate angles: {seg.altMessages.join(' • ')}
                            </div>
                        )}
                        {seg.proofPoints && seg.proofPoints.length > 0 && (
                            <div className="mt-1 text-[11px] opacity-70">
                                Proof: {seg.proofPoints.join('; ')}
                            </div>
                        )}
                    </div>
                ))}
            </div>
        </GlassCard>
    );
};

// --- 20. COMPETITOR BATTLECARDS ---
const CompetitorBattlecardsRenderer: React.FC<{ content: any; isDarkMode: boolean; theme?: ThemePalette }> = ({ content, isDarkMode, theme }) => {
    if (!content?.competitors || !Array.isArray(content.competitors) || content.competitors.length === 0) return null;

    return (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {content.competitors.map((c: any, idx: number) => (
                <GlassCard key={idx} isDarkMode={isDarkMode} theme={theme} className="p-5 flex flex-col gap-3 h-full">
                    <div className="flex items-center justify-between gap-2">
                        <div>
                            <div className="text-sm font-semibold" style={theme ? { color: theme.text } : {}}>
                                {c.name}
                            </div>
                            {c.segment && (
                                <div className="text-[11px] uppercase tracking-widest opacity-60">{c.segment}</div>
                            )}
                        </div>
                        <span className="text-xl">⚔️</span>
                    </div>
                    {c.strengths && c.strengths.length > 0 && (
                        <div className="text-xs">
                            <span className="font-semibold">Strengths:</span> {c.strengths.join('; ')}
                        </div>
                    )}
                    {c.weaknesses && c.weaknesses.length > 0 && (
                        <div className="text-xs">
                            <span className="font-semibold">Weaknesses:</span> {c.weaknesses.join('; ')}
                        </div>
                    )}
                    {c.landMotions && c.landMotions.length > 0 && (
                        <div className="text-[11px] opacity-75">
                            How they win: {c.landMotions.join('; ')}
                        </div>
                    )}
                    {c.counterStrategies && c.counterStrategies.length > 0 && (
                        <div className="text-[11px] opacity-80">
                            How to respond: {c.counterStrategies.join('; ')}
                        </div>
                    )}
                </GlassCard>
            ))}
        </div>
    );
};

// --- 21. EXPERIMENT BACKLOG ---
const ExperimentBacklogRenderer: React.FC<{ content: any; isDarkMode: boolean; theme?: ThemePalette }> = ({ content, isDarkMode, theme }) => {
    if (!content?.experiments || !Array.isArray(content.experiments) || content.experiments.length === 0) return null;

    return (
        <GlassCard isDarkMode={isDarkMode} theme={theme} className="p-6 md:p-8">
            <div className="space-y-3">
                {content.experiments.map((exp: any, idx: number) => (
                    <div key={idx} className="p-4 rounded-xl bg-black/5 dark:bg-white/5 flex flex-col gap-1">
                        <div className="flex items-center justify-between gap-2 mb-1">
                            <div className="text-sm font-semibold" style={theme ? { color: theme.text } : {}}>
                                {exp.title}
                            </div>
                            {exp.status && (
                                <span className="text-[10px] uppercase tracking-widest opacity-60">{exp.status}</span>
                            )}
                        </div>
                        {exp.hypothesis && (
                            <div className="text-xs opacity-80">Hypothesis: {exp.hypothesis}</div>
                        )}
                        {exp.metric && (
                            <div className="text-[11px] opacity-70">Metric: {exp.metric}</div>
                        )}
                        <div className="flex gap-2 text-[10px] mt-1 opacity-70">
                            {exp.impact && <span>Impact: {exp.impact}</span>}
                            {exp.effort && <span>• Effort: {exp.effort}</span>}
                            {exp.confidence && <span>• Confidence: {exp.confidence}</span>}
                        </div>
                        {exp.notes && (
                            <div className="text-[11px] opacity-70 mt-1">{exp.notes}</div>
                        )}
                    </div>
                ))}
            </div>
        </GlassCard>
    );
};

// --- 22. CONTENT CALENDAR ---
const ContentCalendarRenderer: React.FC<{ content: any; isDarkMode: boolean; theme?: ThemePalette }> = ({ content, isDarkMode, theme }) => {
    if (!content?.items || !Array.isArray(content.items) || content.items.length === 0) return null;

    return (
        <GlassCard isDarkMode={isDarkMode} theme={theme} className="p-6 md:p-8">
            {content.timeframe && (
                <div className="text-xs uppercase tracking-widest opacity-60 mb-3">{content.timeframe}</div>
            )}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                {content.items.map((item: any, idx: number) => (
                    <div key={idx} className="p-4 rounded-xl bg-black/5 dark:bg-white/5 flex flex-col gap-1">
                        <div className="flex items-center justify-between gap-2">
                            <div className="text-xs font-semibold uppercase tracking-widest opacity-70">{item.week}</div>
                            {item.channel && (
                                <span className="text-[11px] px-2 py-0.5 rounded-full border border-white/10 opacity-80">
                                    {item.channel}
                                </span>
                            )}
                        </div>
                        <div className="text-sm font-medium" style={theme ? { color: theme.text } : {}}>
                            {item.title}
                        </div>
                        {item.format && (
                            <div className="text-[11px] opacity-70">Format: {item.format}</div>
                        )}
                        {item.goal && (
                            <div className="text-[11px] opacity-70">Goal: {item.goal}</div>
                        )}
                    </div>
                ))}
            </div>
        </GlassCard>
    );
};

// --- 23. PRICING & PACKAGING TIERS ---
const PricingTiersRenderer: React.FC<{ content: any; isDarkMode: boolean; theme?: ThemePalette }> = ({ content, isDarkMode, theme }) => {
    if (!content?.tiers || !Array.isArray(content.tiers) || content.tiers.length === 0) return null;

    return (
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            {content.tiers.map((tier: any, idx: number) => (
                <GlassCard key={idx} isDarkMode={isDarkMode} theme={theme} className="p-6 flex flex-col gap-3 h-full">
                    <div className="flex items-baseline justify-between gap-2">
                        <div>
                            <div className="text-sm font-semibold" style={theme ? { color: theme.text } : {}}>
                                {tier.name}
                            </div>
                            {tier.targetSegment && (
                                <div className="text-[11px] uppercase tracking-widest opacity-60">{tier.targetSegment}</div>
                            )}
                        </div>
                        {tier.price && (
                            <div className="text-lg font-bold" style={theme ? { color: theme.primary } : {}}>
                                {tier.price}
                            </div>
                        )}
                    </div>
                    {tier.keyFeatures && tier.keyFeatures.length > 0 && (
                        <ul className="text-xs space-y-1 opacity-80">
                            {tier.keyFeatures.map((f: string, i: number) => (
                                <li key={i}>• {f}</li>
                            ))}
                        </ul>
                    )}
                    {tier.limitations && tier.limitations.length > 0 && (
                        <div className="text-[11px] opacity-70 mt-1">Limitations: {tier.limitations.join('; ')}</div>
                    )}
                    {tier.notes && (
                        <div className="text-[11px] opacity-70 mt-1">{tier.notes}</div>
                    )}
                </GlassCard>
            ))}
        </div>
    );
};

// --- 24. OPPORTUNITY GRID (REGIONS / SEGMENTS) ---
const OpportunityGridRenderer: React.FC<{ content: any; isDarkMode: boolean; theme?: ThemePalette }> = ({ content, isDarkMode, theme }) => {
    if (!content?.opportunities || !Array.isArray(content.opportunities) || content.opportunities.length === 0) return null;

    return (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {content.opportunities.map((op: any, idx: number) => (
                <GlassCard key={idx} isDarkMode={isDarkMode} theme={theme} className="p-5 flex flex-col gap-2 h-full">
                    <div className="flex items-center justify-between gap-2">
                        <div>
                            <div className="text-sm font-semibold" style={theme ? { color: theme.text } : {}}>
                                {op.name}
                            </div>
                            {op.type && (
                                <div className="text-[11px] uppercase tracking-widest opacity-60">{op.type}</div>
                            )}
                        </div>
                        {op.fit && (
                            <span className="text-[10px] px-2 py-0.5 rounded-full border border-white/10 uppercase tracking-widest opacity-80">
                                Fit: {op.fit}
                            </span>
                        )}
                    </div>
                    {op.opportunitySize && (
                        <div className="text-xs opacity-80">Size: {op.opportunitySize}</div>
                    )}
                    {op.risks && op.risks.length > 0 && (
                        <div className="text-[11px] opacity-70">Risks: {op.risks.join('; ')}</div>
                    )}
                    {op.recommendedMotion && (
                        <div className="text-[11px] opacity-80 mt-1">Motion: {op.recommendedMotion}</div>
                    )}
                </GlassCard>
            ))}
        </div>
    );
};

// --- 25. GTM PLAYBOOK ---
const GTMPlaybookRenderer: React.FC<{ content: any; isDarkMode: boolean; theme?: ThemePalette }> = ({ content, isDarkMode, theme }) => {
    if (!content?.phases || !Array.isArray(content.phases) || content.phases.length === 0) return null;

    return (
        <GlassCard isDarkMode={isDarkMode} theme={theme} className="p-6 md:p-8">
            <div className="space-y-4">
                {content.phases.map((phase: any, idx: number) => (
                    <div key={idx} className="p-4 rounded-xl bg-black/5 dark:bg-white/5 flex flex-col gap-2">
                        <div className="flex items-center justify-between gap-2">
                            <div>
                                <div className="text-sm font-semibold" style={theme ? { color: theme.text } : {}}>
                                    {phase.name}
                                </div>
                                {phase.timeframe && (
                                    <div className="text-[11px] uppercase tracking-widest opacity-60">{phase.timeframe}</div>
                                )}
                            </div>
                            {phase.owner && (
                                <span className="text-[11px] px-2 py-0.5 rounded-full border border-white/10 opacity-80">
                                    {phase.owner}
                                </span>
                            )}
                        </div>
                        {phase.objectives && phase.objectives.length > 0 && (
                            <div className="text-xs">
                                <span className="font-semibold">Objectives:</span> {phase.objectives.join('; ')}
                            </div>
                        )}
                        {phase.keyActions && phase.keyActions.length > 0 && (
                            <div className="text-xs">
                                <span className="font-semibold">Key actions:</span> {phase.keyActions.join('; ')}
                            </div>
                        )}
                        {phase.successMetrics && phase.successMetrics.length > 0 && (
                            <div className="text-[11px] opacity-70">
                                Success metrics: {phase.successMetrics.join('; ')}
                            </div>
                        )}
                    </div>
                ))}
            </div>
        </GlassCard>
    );
};

// --- 26. RISK MATRIX ---
const RiskMatrixRenderer: React.FC<{ content: any; isDarkMode: boolean; theme?: ThemePalette }> = ({ content, isDarkMode, theme }) => {
    if (!content?.risks || !Array.isArray(content.risks)) return null;
    const getColor = (level: string) => {
        if (level === 'high' || level === 'critical') return '#ef4444';
        if (level === 'medium') return '#f59e0b';
        return '#22c55e';
    };
    return (
        <GlassCard isDarkMode={isDarkMode} theme={theme} className="p-6 md:p-8">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                {content.risks.map((risk: any, idx: number) => (
                    <div key={idx} className="p-4 rounded-xl border" style={{ borderColor: getColor(risk.severity || 'low'), backgroundColor: `${getColor(risk.severity || 'low')}10` }}>
                        <div className="flex items-center justify-between mb-2">
                            <span className="font-semibold text-sm" style={theme ? { color: theme.text } : {}}>{risk.name}</span>
                            <span className="text-[10px] px-2 py-0.5 rounded-full uppercase font-bold" style={{ backgroundColor: getColor(risk.severity), color: '#fff' }}>
                                {risk.severity || 'Low'}
                            </span>
                        </div>
                        {risk.likelihood && <div className="text-xs opacity-70">Likelihood: {risk.likelihood}</div>}
                        {risk.impact && <div className="text-xs opacity-70">Impact: {risk.impact}</div>}
                        {risk.mitigation && <div className="text-xs mt-2 opacity-80">Mitigation: {risk.mitigation}</div>}
                    </div>
                ))}
            </div>
        </GlassCard>
    );
};

// --- 27. DECISION TREE ---
const DecisionTreeRenderer: React.FC<{ content: any; isDarkMode: boolean; theme?: ThemePalette }> = ({ content, isDarkMode, theme }) => {
    const [currentNode, setCurrentNode] = useState<string>('root');
    if (!content?.nodes || typeof content.nodes !== 'object') return null;
    const node = content.nodes[currentNode];
    if (!node) return null;
    return (
        <GlassCard isDarkMode={isDarkMode} theme={theme} className="p-6 md:p-8 text-center">
            <div className="mb-6">
                <h4 className="text-lg font-semibold mb-2" style={theme ? { color: theme.text } : {}}>{node.question || node.title}</h4>
                {node.description && <p className="text-sm opacity-70">{node.description}</p>}
            </div>
            {node.options && node.options.length > 0 ? (
                <div className="flex flex-wrap justify-center gap-3">
                    {node.options.map((opt: any, idx: number) => (
                        <button key={idx} onClick={() => setCurrentNode(opt.next || 'root')} className="px-4 py-2 rounded-xl text-sm font-medium transition-all hover:scale-105" style={{ backgroundColor: theme?.primary || '#4f46e5', color: '#fff' }}>
                            {opt.label}
                        </button>
                    ))}
                </div>
            ) : (
                <div className="p-4 rounded-xl" style={{ backgroundColor: `${theme?.accent || '#22c55e'}20` }}>
                    <span className="font-semibold" style={{ color: theme?.accent || '#22c55e' }}>Result: </span>
                    <span style={theme ? { color: theme.text } : {}}>{node.result || 'End of decision tree'}</span>
                    <button onClick={() => setCurrentNode('root')} className="block mx-auto mt-4 text-xs underline opacity-70">Start Over</button>
                </div>
            )}
        </GlassCard>
    );
};

// --- 28. STAKEHOLDER MAP ---
const StakeholderMapRenderer: React.FC<{ content: any; isDarkMode: boolean; theme?: ThemePalette }> = ({ content, isDarkMode, theme }) => {
    if (!content?.stakeholders || !Array.isArray(content.stakeholders)) return null;
    const getInfluenceColor = (influence: string) => {
        if (influence === 'high') return theme?.primary || '#4f46e5';
        if (influence === 'medium') return theme?.accent || '#f59e0b';
        return theme?.secondary || '#6b7280';
    };
    return (
        <GlassCard isDarkMode={isDarkMode} theme={theme} className="p-6 md:p-8">
            <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4">
                {content.stakeholders.map((s: any, idx: number) => (
                    <div key={idx} className="p-4 rounded-xl text-center border" style={{ borderColor: getInfluenceColor(s.influence), borderWidth: 2 }}>
                        <div className="w-12 h-12 mx-auto mb-2 rounded-full flex items-center justify-center text-lg" style={{ backgroundColor: `${getInfluenceColor(s.influence)}20` }}>
                            {s.icon || '👤'}
                        </div>
                        <div className="font-semibold text-sm" style={theme ? { color: theme.text } : {}}>{s.name}</div>
                        <div className="text-[10px] uppercase tracking-wider opacity-60">{s.role}</div>
                        {s.interest && <div className="text-xs mt-1 opacity-70">Interest: {s.interest}</div>}
                    </div>
                ))}
            </div>
        </GlassCard>
    );
};

// --- 29. MILESTONE TRACKER ---
const MilestoneTrackerRenderer: React.FC<{ content: any; isDarkMode: boolean; theme?: ThemePalette }> = ({ content, isDarkMode, theme }) => {
    if (!content?.milestones || !Array.isArray(content.milestones)) return null;
    const total = content.milestones.length;
    const completed = content.milestones.filter((m: any) => m.status === 'completed').length;
    const progress = total > 0 ? (completed / total) * 100 : 0;
    return (
        <GlassCard isDarkMode={isDarkMode} theme={theme} className="p-6 md:p-8">
            <div className="mb-6">
                <div className="flex justify-between items-center mb-2">
                    <span className="text-sm font-medium" style={theme ? { color: theme.text } : {}}>Progress</span>
                    <span className="text-sm font-bold" style={{ color: theme?.primary || '#4f46e5' }}>{completed}/{total}</span>
                </div>
                <div className="h-2 rounded-full overflow-hidden" style={{ backgroundColor: `${theme?.primary || '#4f46e5'}20` }}>
                    <div className="h-full rounded-full transition-all" style={{ width: `${progress}%`, backgroundColor: theme?.primary || '#4f46e5' }} />
                </div>
            </div>
            <div className="space-y-3">
                {content.milestones.map((m: any, idx: number) => (
                    <div key={idx} className="flex items-center gap-3 p-3 rounded-xl" style={{ backgroundColor: m.status === 'completed' ? `${theme?.accent || '#22c55e'}10` : 'transparent' }}>
                        <div className="w-6 h-6 rounded-full flex items-center justify-center" style={{ backgroundColor: m.status === 'completed' ? (theme?.accent || '#22c55e') : `${theme?.secondary || '#6b7280'}30` }}>
                            {m.status === 'completed' ? <span className="text-white text-xs">✓</span> : <span className="text-xs opacity-50">{idx + 1}</span>}
                        </div>
                        <div className="flex-1">
                            <div className="font-medium text-sm" style={theme ? { color: theme.text } : {}}>{m.title}</div>
                            {m.date && <div className="text-[11px] opacity-60">{m.date}</div>}
                        </div>
                    </div>
                ))}
            </div>
        </GlassCard>
    );
};

// --- 30. RESOURCE ALLOCATION ---
const ResourceAllocationRenderer: React.FC<{ content: any; isDarkMode: boolean; theme?: ThemePalette }> = ({ content, isDarkMode, theme }) => {
    if (!content?.resources || !Array.isArray(content.resources)) return null;
    const colors = ['#4f46e5', '#22c55e', '#f59e0b', '#ef4444', '#8b5cf6', '#06b6d4'];
    return (
        <GlassCard isDarkMode={isDarkMode} theme={theme} className="p-6 md:p-8">
            <div className="space-y-4">
                {content.resources.map((r: any, idx: number) => (
                    <div key={idx}>
                        <div className="flex justify-between items-center mb-1">
                            <span className="text-sm font-medium" style={theme ? { color: theme.text } : {}}>{r.name}</span>
                            <span className="text-sm font-bold" style={{ color: colors[idx % colors.length] }}>{r.allocation || r.percentage}%</span>
                        </div>
                        <div className="h-3 rounded-full overflow-hidden" style={{ backgroundColor: `${colors[idx % colors.length]}20` }}>
                            <div className="h-full rounded-full transition-all" style={{ width: `${r.allocation || r.percentage}%`, backgroundColor: colors[idx % colors.length] }} />
                        </div>
                        {r.description && <div className="text-xs opacity-60 mt-1">{r.description}</div>}
                    </div>
                ))}
            </div>
        </GlassCard>
    );
};

// --- 31. HEAT MAP ---
const HeatMapRenderer: React.FC<{ content: any; isDarkMode: boolean; theme?: ThemePalette }> = ({ content, isDarkMode, theme }) => {
    if (!content?.rows || !content?.columns || !content?.values) return null;
    const getHeatColor = (value: number, max: number) => {
        const intensity = max > 0 ? value / max : 0;
        if (intensity > 0.75) return '#ef4444';
        if (intensity > 0.5) return '#f59e0b';
        if (intensity > 0.25) return '#22c55e';
        return '#3b82f6';
    };
    const maxVal = Math.max(...(content.values.flat() || [1]));
    return (
        <GlassCard isDarkMode={isDarkMode} theme={theme} className="p-6 md:p-8 overflow-x-auto">
            <table className="w-full border-collapse">
                <thead>
                    <tr>
                        <th></th>
                        {content.columns.map((col: string, idx: number) => (
                            <th key={idx} className="p-2 text-[10px] uppercase tracking-wider font-semibold" style={theme ? { color: theme.text } : {}}>{col}</th>
                        ))}
                    </tr>
                </thead>
                <tbody>
                    {content.rows.map((row: string, rIdx: number) => (
                        <tr key={rIdx}>
                            <td className="p-2 text-xs font-medium" style={theme ? { color: theme.text } : {}}>{row}</td>
                            {(content.values[rIdx] || []).map((val: number, cIdx: number) => (
                                <td key={cIdx} className="p-1">
                                    <div className="w-full h-8 rounded flex items-center justify-center text-xs font-bold text-white" style={{ backgroundColor: getHeatColor(val, maxVal) }}>
                                        {val}
                                    </div>
                                </td>
                            ))}
                        </tr>
                    ))}
                </tbody>
            </table>
        </GlassCard>
    );
};

// --- 32. BUBBLE CHART ---
const BubbleChartRenderer: React.FC<{ content: any; isDarkMode: boolean; theme?: ThemePalette }> = ({ content, isDarkMode, theme }) => {
    if (!content?.bubbles || !Array.isArray(content.bubbles)) return null;
    const colors = [theme?.primary || '#4f46e5', theme?.accent || '#22c55e', '#f59e0b', '#ef4444', '#8b5cf6', '#06b6d4'];
    const maxSize = Math.max(...content.bubbles.map((b: any) => b.size || 50));
    return (
        <GlassCard isDarkMode={isDarkMode} theme={theme} className="p-6 md:p-8">
            <div className="relative h-64 md:h-80">
                {content.bubbles.map((b: any, idx: number) => {
                    const size = ((b.size || 50) / maxSize) * 100;
                    const minSize = 40, maxDisplaySize = 100;
                    const displaySize = minSize + (size / 100) * (maxDisplaySize - minSize);
                    return (
                        <div key={idx} className="absolute flex flex-col items-center justify-center rounded-full transition-transform hover:scale-110 cursor-pointer" style={{ width: displaySize, height: displaySize, backgroundColor: `${colors[idx % colors.length]}90`, left: `${(b.x || (idx * 20)) % 80}%`, top: `${(b.y || (idx * 15)) % 70}%` }} title={b.tooltip || b.label}>
                            <span className="text-white font-bold text-xs text-center px-1">{b.label}</span>
                            {b.value && <span className="text-white text-[10px] opacity-80">{b.value}</span>}
                        </div>
                    );
                })}
            </div>
        </GlassCard>
    );
};

// --- 33. BEFORE/AFTER ---
const BeforeAfterRenderer: React.FC<{ content: any; isDarkMode: boolean; theme?: ThemePalette }> = ({ content, isDarkMode, theme }) => {
    const [showAfter, setShowAfter] = useState(false);
    if (!content?.before || !content?.after) return null;
    return (
        <GlassCard isDarkMode={isDarkMode} theme={theme} className="p-6 md:p-8">
            <div className="flex justify-center gap-4 mb-6">
                <button onClick={() => setShowAfter(false)} className="px-4 py-2 rounded-xl text-sm font-medium transition-all" style={{ backgroundColor: !showAfter ? (theme?.primary || '#4f46e5') : 'transparent', color: !showAfter ? '#fff' : (theme?.text || '#666'), border: `1px solid ${theme?.primary || '#4f46e5'}` }}>
                    Before
                </button>
                <button onClick={() => setShowAfter(true)} className="px-4 py-2 rounded-xl text-sm font-medium transition-all" style={{ backgroundColor: showAfter ? (theme?.accent || '#22c55e') : 'transparent', color: showAfter ? '#fff' : (theme?.text || '#666'), border: `1px solid ${theme?.accent || '#22c55e'}` }}>
                    After
                </button>
            </div>
            <div className="p-6 rounded-xl transition-all" style={{ backgroundColor: showAfter ? `${theme?.accent || '#22c55e'}10` : `${theme?.primary || '#4f46e5'}10` }}>
                <h4 className="font-semibold mb-2" style={theme ? { color: theme.text } : {}}>{showAfter ? content.after.title : content.before.title}</h4>
                <p className="text-sm opacity-80" style={theme ? { color: theme.text } : {}}>{showAfter ? content.after.description : content.before.description}</p>
                {(showAfter ? content.after.metrics : content.before.metrics) && (
                    <div className="flex flex-wrap gap-3 mt-4">
                        {(showAfter ? content.after.metrics : content.before.metrics).map((m: any, idx: number) => (
                            <div key={idx} className="px-3 py-1 rounded-full text-xs font-medium" style={{ backgroundColor: `${showAfter ? (theme?.accent || '#22c55e') : (theme?.primary || '#4f46e5')}20`, color: showAfter ? (theme?.accent || '#22c55e') : (theme?.primary || '#4f46e5') }}>
                                {m.label}: {m.value}
                            </div>
                        ))}
                    </div>
                )}
            </div>
        </GlassCard>
    );
};

// --- 34. PROS/CONS/NEUTRAL ---
const ProsConsNeutralRenderer: React.FC<{ content: any; isDarkMode: boolean; theme?: ThemePalette }> = ({ content, isDarkMode, theme }) => {
    if (!content) return null;
    return (
        <GlassCard isDarkMode={isDarkMode} theme={theme} className="p-6 md:p-8">
            <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                <div>
                    <h4 className="flex items-center gap-2 text-sm font-bold uppercase tracking-wider mb-4" style={{ color: '#22c55e' }}>
                        <span>✓</span> Pros
                    </h4>
                    <ul className="space-y-2">
                        {(content.pros || []).map((item: string, idx: number) => (
                            <li key={idx} className="flex items-start gap-2 text-sm" style={theme ? { color: theme.text } : {}}>
                                <span className="text-green-500 mt-0.5">+</span>
                                {item}
                            </li>
                        ))}
                    </ul>
                </div>
                <div>
                    <h4 className="flex items-center gap-2 text-sm font-bold uppercase tracking-wider mb-4" style={{ color: '#f59e0b' }}>
                        <span>○</span> Neutral
                    </h4>
                    <ul className="space-y-2">
                        {(content.neutral || []).map((item: string, idx: number) => (
                            <li key={idx} className="flex items-start gap-2 text-sm" style={theme ? { color: theme.text } : {}}>
                                <span className="text-yellow-500 mt-0.5">•</span>
                                {item}
                            </li>
                        ))}
                    </ul>
                </div>
                <div>
                    <h4 className="flex items-center gap-2 text-sm font-bold uppercase tracking-wider mb-4" style={{ color: '#ef4444' }}>
                        <span>✗</span> Cons
                    </h4>
                    <ul className="space-y-2">
                        {(content.cons || []).map((item: string, idx: number) => (
                            <li key={idx} className="flex items-start gap-2 text-sm" style={theme ? { color: theme.text } : {}}>
                                <span className="text-red-500 mt-0.5">−</span>
                                {item}
                            </li>
                        ))}
                    </ul>
                </div>
            </div>
        </GlassCard>
    );
};

// --- 35. FEATURE COMPARISON ---
const FeatureComparisonRenderer: React.FC<{ content: any; isDarkMode: boolean; theme?: ThemePalette }> = ({ content, isDarkMode, theme }) => {
    if (!content?.features || !content?.options) return null;
    return (
        <GlassCard isDarkMode={isDarkMode} theme={theme} className="p-6 md:p-8 overflow-x-auto">
            <table className="w-full border-collapse">
                <thead>
                    <tr>
                        <th className="p-3 text-left text-sm font-semibold" style={theme ? { color: theme.text } : {}}>Feature</th>
                        {content.options.map((opt: string, idx: number) => (
                            <th key={idx} className="p-3 text-center text-sm font-semibold" style={{ color: theme?.primary || '#4f46e5' }}>{opt}</th>
                        ))}
                    </tr>
                </thead>
                <tbody>
                    {content.features.map((f: any, fIdx: number) => (
                        <tr key={fIdx} className="border-t" style={{ borderColor: `${theme?.secondary || '#e5e7eb'}40` }}>
                            <td className="p-3 text-sm" style={theme ? { color: theme.text } : {}}>{f.name}</td>
                            {f.values.map((v: any, vIdx: number) => (
                                <td key={vIdx} className="p-3 text-center">
                                    {typeof v === 'boolean' ? (
                                        v ? <span className="text-green-500 text-lg">✓</span> : <span className="text-red-400 text-lg">✗</span>
                                    ) : (
                                        <span className="text-sm" style={theme ? { color: theme.text } : {}}>{v}</span>
                                    )}
                                </td>
                            ))}
                        </tr>
                    ))}
                </tbody>
            </table>
        </GlassCard>
    );
};

// --- 36. RATING BREAKDOWN ---
const RatingBreakdownRenderer: React.FC<{ content: any; isDarkMode: boolean; theme?: ThemePalette }> = ({ content, isDarkMode, theme }) => {
    if (!content?.ratings || !Array.isArray(content.ratings)) return null;
    const avgRating = content.average || (content.ratings.reduce((a: number, r: any) => a + (r.score || 0), 0) / content.ratings.length);
    return (
        <GlassCard isDarkMode={isDarkMode} theme={theme} className="p-6 md:p-8">
            <div className="flex items-center gap-6 mb-6">
                <div className="text-center">
                    <div className="text-4xl font-bold" style={{ color: theme?.primary || '#4f46e5' }}>{avgRating.toFixed(1)}</div>
                    <div className="flex gap-0.5 mt-1">
                        {[1, 2, 3, 4, 5].map(star => (
                            <span key={star} className={star <= Math.round(avgRating) ? 'text-yellow-400' : 'text-gray-300'}>★</span>
                        ))}
                    </div>
                </div>
                <div className="flex-1 space-y-2">
                    {content.ratings.map((r: any, idx: number) => (
                        <div key={idx} className="flex items-center gap-2">
                            <span className="text-xs w-16" style={theme ? { color: theme.text } : {}}>{r.category}</span>
                            <div className="flex-1 h-2 rounded-full overflow-hidden" style={{ backgroundColor: `${theme?.primary || '#4f46e5'}20` }}>
                                <div className="h-full rounded-full" style={{ width: `${(r.score / 5) * 100}%`, backgroundColor: theme?.primary || '#4f46e5' }} />
                            </div>
                            <span className="text-xs font-bold w-6" style={{ color: theme?.primary || '#4f46e5' }}>{r.score}</span>
                        </div>
                    ))}
                </div>
            </div>
        </GlassCard>
    );
};

// --- 37. SKILL TREE ---
const SkillTreeRenderer: React.FC<{ content: any; isDarkMode: boolean; theme?: ThemePalette }> = ({ content, isDarkMode, theme }) => {
    if (!content?.skills || !Array.isArray(content.skills)) return null;
    return (
        <GlassCard isDarkMode={isDarkMode} theme={theme} className="p-6 md:p-8">
            <div className="space-y-6">
                {content.skills.map((skill: any, idx: number) => (
                    <div key={idx}>
                        <div className="flex items-center gap-3 mb-2">
                            <div className="w-8 h-8 rounded-lg flex items-center justify-center" style={{ backgroundColor: `${theme?.primary || '#4f46e5'}20` }}>
                                {skill.icon || '🎯'}
                            </div>
                            <div className="flex-1">
                                <div className="font-semibold text-sm" style={theme ? { color: theme.text } : {}}>{skill.name}</div>
                                <div className="text-[10px] uppercase tracking-wider opacity-60">Level {skill.level || 1}</div>
                            </div>
                            <div className="text-xs font-bold" style={{ color: theme?.primary || '#4f46e5' }}>{skill.progress || 0}%</div>
                        </div>
                        <div className="h-2 rounded-full overflow-hidden ml-11" style={{ backgroundColor: `${theme?.primary || '#4f46e5'}20` }}>
                            <div className="h-full rounded-full transition-all" style={{ width: `${skill.progress || 0}%`, backgroundColor: theme?.primary || '#4f46e5' }} />
                        </div>
                        {skill.subskills && skill.subskills.length > 0 && (
                            <div className="ml-11 mt-2 pl-4 border-l-2" style={{ borderColor: `${theme?.primary || '#4f46e5'}30` }}>
                                {skill.subskills.map((sub: any, sIdx: number) => (
                                    <div key={sIdx} className="flex items-center justify-between py-1">
                                        <span className="text-xs" style={theme ? { color: theme.text } : {}}>{sub.name}</span>
                                        <span className="text-[10px]" style={{ color: theme?.accent || '#22c55e' }}>{sub.status || 'Pending'}</span>
                                    </div>
                                ))}
                            </div>
                        )}
                    </div>
                ))}
            </div>
        </GlassCard>
    );
};

// --- 38. DEPENDENCY GRAPH ---
const DependencyGraphRenderer: React.FC<{ content: any; isDarkMode: boolean; theme?: ThemePalette }> = ({ content, isDarkMode, theme }) => {
    if (!content?.nodes || !Array.isArray(content.nodes)) return null;
    return (
        <GlassCard isDarkMode={isDarkMode} theme={theme} className="p-6 md:p-8">
            <div className="space-y-4">
                {content.nodes.map((node: any, idx: number) => (
                    <div key={idx} className="p-4 rounded-xl border" style={{ borderColor: `${theme?.primary || '#4f46e5'}30` }}>
                        <div className="flex items-center justify-between mb-2">
                            <span className="font-semibold text-sm" style={theme ? { color: theme.text } : {}}>{node.name}</span>
                            {node.status && (
                                <span className="text-[10px] px-2 py-0.5 rounded-full" style={{ backgroundColor: node.status === 'complete' ? '#22c55e' : node.status === 'blocked' ? '#ef4444' : '#f59e0b', color: '#fff' }}>
                                    {node.status}
                                </span>
                            )}
                        </div>
                        {node.dependencies && node.dependencies.length > 0 && (
                            <div className="flex flex-wrap gap-2">
                                <span className="text-[10px] uppercase tracking-wider opacity-50">Depends on:</span>
                                {node.dependencies.map((dep: string, dIdx: number) => (
                                    <span key={dIdx} className="text-xs px-2 py-0.5 rounded-full" style={{ backgroundColor: `${theme?.secondary || '#6b7280'}20`, color: theme?.text }}>
                                        {dep}
                                    </span>
                                ))}
                            </div>
                        )}
                    </div>
                ))}
            </div>
        </GlassCard>
    );
};

// --- 39. COST-BENEFIT ANALYSIS ---
const CostBenefitRenderer: React.FC<{ content: any; isDarkMode: boolean; theme?: ThemePalette }> = ({ content, isDarkMode, theme }) => {
    if (!content) return null;
    const totalCosts = (content.costs || []).reduce((a: number, c: any) => a + (c.amount || 0), 0);
    const totalBenefits = (content.benefits || []).reduce((a: number, b: any) => a + (b.amount || 0), 0);
    const roi = totalCosts > 0 ? ((totalBenefits - totalCosts) / totalCosts * 100).toFixed(1) : '∞';
    return (
        <GlassCard isDarkMode={isDarkMode} theme={theme} className="p-6 md:p-8">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
                <div>
                    <h4 className="text-sm font-bold uppercase tracking-wider mb-4" style={{ color: '#ef4444' }}>Costs</h4>
                    <ul className="space-y-2">
                        {(content.costs || []).map((item: any, idx: number) => (
                            <li key={idx} className="flex justify-between items-center p-2 rounded-lg" style={{ backgroundColor: '#ef444410' }}>
                                <span className="text-sm" style={theme ? { color: theme.text } : {}}>{item.name}</span>
                                <span className="font-bold text-red-500">${item.amount?.toLocaleString()}</span>
                            </li>
                        ))}
                        <li className="flex justify-between items-center p-2 font-bold border-t" style={{ borderColor: '#ef444430' }}>
                            <span style={theme ? { color: theme.text } : {}}>Total</span>
                            <span style={{ color: '#ef4444' }}>${totalCosts.toLocaleString()}</span>
                        </li>
                    </ul>
                </div>
                <div>
                    <h4 className="text-sm font-bold uppercase tracking-wider mb-4" style={{ color: '#22c55e' }}>Benefits</h4>
                    <ul className="space-y-2">
                        {(content.benefits || []).map((item: any, idx: number) => (
                            <li key={idx} className="flex justify-between items-center p-2 rounded-lg" style={{ backgroundColor: '#22c55e10' }}>
                                <span className="text-sm" style={theme ? { color: theme.text } : {}}>{item.name}</span>
                                <span className="font-bold text-green-500">${item.amount?.toLocaleString()}</span>
                            </li>
                        ))}
                        <li className="flex justify-between items-center p-2 font-bold border-t" style={{ borderColor: '#22c55e30' }}>
                            <span style={theme ? { color: theme.text } : {}}>Total</span>
                            <span style={{ color: '#22c55e' }}>${totalBenefits.toLocaleString()}</span>
                        </li>
                    </ul>
                </div>
            </div>
            <div className="mt-6 p-4 rounded-xl text-center" style={{ backgroundColor: `${theme?.primary || '#4f46e5'}10` }}>
                <span className="text-sm" style={theme ? { color: theme.text } : {}}>Estimated ROI: </span>
                <span className="text-2xl font-bold" style={{ color: Number(roi) > 0 ? '#22c55e' : '#ef4444' }}>{roi}%</span>
            </div>
        </GlassCard>
    );
};

// --- 40. IMPACT-EFFORT MATRIX ---
const ImpactEffortRenderer: React.FC<{ content: any; isDarkMode: boolean; theme?: ThemePalette }> = ({ content, isDarkMode, theme }) => {
    if (!content?.items || !Array.isArray(content.items)) return null;
    const quadrantColors: Record<string, string> = {
        'quick_wins': '#22c55e',
        'major_projects': theme?.primary || '#4f46e5',
        'fill_ins': '#f59e0b',
        'thankless_tasks': '#ef4444'
    };
    const getQuadrant = (impact: number, effort: number) => {
        if (impact >= 5 && effort < 5) return 'quick_wins';
        if (impact >= 5 && effort >= 5) return 'major_projects';
        if (impact < 5 && effort < 5) return 'fill_ins';
        return 'thankless_tasks';
    };
    const quadrants = {
        quick_wins: content.items.filter((i: any) => getQuadrant(i.impact, i.effort) === 'quick_wins'),
        major_projects: content.items.filter((i: any) => getQuadrant(i.impact, i.effort) === 'major_projects'),
        fill_ins: content.items.filter((i: any) => getQuadrant(i.impact, i.effort) === 'fill_ins'),
        thankless_tasks: content.items.filter((i: any) => getQuadrant(i.impact, i.effort) === 'thankless_tasks')
    };
    return (
        <GlassCard isDarkMode={isDarkMode} theme={theme} className="p-6 md:p-8">
            <div className="grid grid-cols-2 gap-4">
                {Object.entries(quadrants).map(([key, items]) => (
                    <div key={key} className="p-4 rounded-xl border-2" style={{ borderColor: quadrantColors[key], backgroundColor: `${quadrantColors[key]}10` }}>
                        <h4 className="text-xs font-bold uppercase tracking-wider mb-3" style={{ color: quadrantColors[key] }}>
                            {key.replace(/_/g, ' ')}
                        </h4>
                        <ul className="space-y-1">
                            {(items as any[]).map((item: any, idx: number) => (
                                <li key={idx} className="text-xs p-1.5 rounded" style={{ backgroundColor: `${quadrantColors[key]}15`, color: theme?.text }}>
                                    {item.name}
                                </li>
                            ))}
                            {(items as any[]).length === 0 && <li className="text-xs opacity-40 italic">No items</li>}
                        </ul>
                    </div>
                ))}
            </div>
        </GlassCard>
    );
};

// --- 41. LEARNING PATH ---
const LearningPathRenderer: React.FC<{ content: any; isDarkMode: boolean; theme?: ThemePalette }> = ({ content, isDarkMode, theme }) => {
    if (!content?.steps || !Array.isArray(content.steps)) return null;
    return (
        <GlassCard isDarkMode={isDarkMode} theme={theme} className="p-6 md:p-8">
            <div className="space-y-4">
                {content.steps.map((step: any, idx: number) => (
                    <div key={idx} className="flex gap-4">
                        <div className="flex flex-col items-center">
                            <div className="w-10 h-10 rounded-full flex items-center justify-center text-white font-bold" style={{ backgroundColor: theme?.primary || '#4f46e5' }}>
                                {idx + 1}
                            </div>
                            {idx < content.steps.length - 1 && <div className="w-0.5 flex-1 mt-2" style={{ backgroundColor: `${theme?.primary || '#4f46e5'}30` }} />}
                        </div>
                        <div className="flex-1 pb-4">
                            <h4 className="font-semibold" style={theme ? { color: theme.text } : {}}>{step.title}</h4>
                            {step.duration && <span className="text-xs px-2 py-0.5 rounded-full" style={{ backgroundColor: `${theme?.accent || '#22c55e'}20`, color: theme?.accent || '#22c55e' }}>{step.duration}</span>}
                            {step.description && <p className="text-sm opacity-70 mt-1">{step.description}</p>}
                            {step.resources && <div className="text-xs opacity-60 mt-1">Resources: {step.resources.join(', ')}</div>}
                        </div>
                    </div>
                ))}
            </div>
        </GlassCard>
    );
};

// --- 42. RECIPE STEPS ---
const RecipeStepsRenderer: React.FC<{ content: any; isDarkMode: boolean; theme?: ThemePalette }> = ({ content, isDarkMode, theme }) => {
    if (!content?.steps || !Array.isArray(content.steps)) return null;
    return (
        <GlassCard isDarkMode={isDarkMode} theme={theme} className="p-6 md:p-8">
            {content.ingredients && (
                <div className="mb-6 p-4 rounded-xl" style={{ backgroundColor: `${theme?.secondary || '#6b7280'}20` }}>
                    <h4 className="text-sm font-bold uppercase tracking-wider mb-2" style={theme ? { color: theme.text } : {}}>Ingredients</h4>
                    <ul className="grid grid-cols-2 gap-1 text-sm">
                        {content.ingredients.map((ing: string, idx: number) => (
                            <li key={idx} className="flex items-center gap-2" style={theme ? { color: theme.text } : {}}>
                                <span style={{ color: theme?.accent || '#22c55e' }}>•</span> {ing}
                            </li>
                        ))}
                    </ul>
                </div>
            )}
            <div className="space-y-4">
                {content.steps.map((step: any, idx: number) => (
                    <div key={idx} className="flex gap-4 p-3 rounded-xl" style={{ backgroundColor: `${theme?.primary || '#4f46e5'}05` }}>
                        <div className="w-8 h-8 rounded-lg flex items-center justify-center font-bold text-sm" style={{ backgroundColor: theme?.primary || '#4f46e5', color: '#fff' }}>
                            {idx + 1}
                        </div>
                        <div className="flex-1">
                            <p className="text-sm" style={theme ? { color: theme.text } : {}}>{typeof step === 'string' ? step : step.instruction}</p>
                            {step.tip && <div className="text-xs mt-1 italic opacity-70">Tip: {step.tip}</div>}
                        </div>
                    </div>
                ))}
            </div>
        </GlassCard>
    );
};

// --- 43. PRODUCT SHOWCASE ---
const ProductShowcaseRenderer: React.FC<{ content: any; isDarkMode: boolean; theme?: ThemePalette }> = ({ content, isDarkMode, theme }) => {
    if (!content?.products || !Array.isArray(content.products)) return null;
    return (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {content.products.map((product: any, idx: number) => (
                <GlassCard key={idx} isDarkMode={isDarkMode} theme={theme} className="p-5">
                    <div className="text-center mb-3">
                        <span className="text-3xl">{product.icon || '📦'}</span>
                    </div>
                    <h4 className="font-semibold text-center mb-2" style={theme ? { color: theme.text } : {}}>{product.name}</h4>
                    {product.price && <div className="text-center text-lg font-bold mb-2" style={{ color: theme?.primary || '#4f46e5' }}>{product.price}</div>}
                    {product.description && <p className="text-xs text-center opacity-70 mb-3">{product.description}</p>}
                    {product.features && (
                        <ul className="space-y-1">
                            {product.features.map((f: string, fIdx: number) => (
                                <li key={fIdx} className="flex items-center gap-2 text-xs" style={theme ? { color: theme.text } : {}}>
                                    <span style={{ color: theme?.accent || '#22c55e' }}>✓</span> {f}
                                </li>
                            ))}
                        </ul>
                    )}
                    {product.rating && <div className="text-center mt-3 text-yellow-400">{'★'.repeat(Math.round(product.rating))}{'☆'.repeat(5 - Math.round(product.rating))}</div>}
                </GlassCard>
            ))}
        </div>
    );
};

// --- 44. POLL RESULTS ---
const PollResultsRenderer: React.FC<{ content: any; isDarkMode: boolean; theme?: ThemePalette }> = ({ content, isDarkMode, theme }) => {
    if (!content?.options || !Array.isArray(content.options)) return null;
    const total = content.options.reduce((a: number, o: any) => a + (o.votes || o.percentage || 0), 0);
    const colors = [theme?.primary || '#4f46e5', theme?.accent || '#22c55e', '#f59e0b', '#ef4444', '#8b5cf6', '#06b6d4'];
    return (
        <GlassCard isDarkMode={isDarkMode} theme={theme} className="p-6 md:p-8">
            {content.question && <h4 className="font-semibold mb-4 text-center" style={theme ? { color: theme.text } : {}}>{content.question}</h4>}
            <div className="space-y-3">
                {content.options.map((opt: any, idx: number) => {
                    const pct = total > 0 ? ((opt.votes || opt.percentage || 0) / total * 100) : 0;
                    return (
                        <div key={idx}>
                            <div className="flex justify-between text-sm mb-1">
                                <span style={theme ? { color: theme.text } : {}}>{opt.label}</span>
                                <span className="font-bold" style={{ color: colors[idx % colors.length] }}>{pct.toFixed(0)}%</span>
                            </div>
                            <div className="h-4 rounded-full overflow-hidden" style={{ backgroundColor: `${colors[idx % colors.length]}20` }}>
                                <div className="h-full rounded-full transition-all" style={{ width: `${pct}%`, backgroundColor: colors[idx % colors.length] }} />
                            </div>
                        </div>
                    );
                })}
            </div>
            {content.totalResponses && <div className="text-center text-xs opacity-60 mt-4">{content.totalResponses} responses</div>}
        </GlassCard>
    );
};

// --- 45. ORG CHART ---
const OrgChartRenderer: React.FC<{ content: any; isDarkMode: boolean; theme?: ThemePalette }> = ({ content, isDarkMode, theme }) => {
    if (!content?.nodes || !Array.isArray(content.nodes)) return null;
    const levels = content.nodes.reduce((acc: Record<number, any[]>, node: any) => {
        const level = node.level || 0;
        if (!acc[level]) acc[level] = [];
        acc[level].push(node);
        return acc;
    }, {});
    return (
        <GlassCard isDarkMode={isDarkMode} theme={theme} className="p-6 md:p-8">
            <div className="space-y-6">
                {Object.keys(levels).sort((a, b) => Number(a) - Number(b)).map((level) => (
                    <div key={level} className="flex flex-wrap justify-center gap-4">
                        {levels[Number(level)].map((node: any, idx: number) => (
                            <div key={idx} className="p-3 rounded-xl text-center min-w-[120px] border" style={{ borderColor: `${theme?.primary || '#4f46e5'}40`, backgroundColor: `${theme?.primary || '#4f46e5'}10` }}>
                                <div className="text-2xl mb-1">{node.icon || '👤'}</div>
                                <div className="font-semibold text-sm" style={theme ? { color: theme.text } : {}}>{node.name}</div>
                                <div className="text-[10px] uppercase tracking-wider opacity-60">{node.title || node.role}</div>
                            </div>
                        ))}
                    </div>
                ))}
            </div>
        </GlassCard>
    );
};

// --- 46. MOOD BOARD ---
const MoodBoardRenderer: React.FC<{ content: any; isDarkMode: boolean; theme?: ThemePalette }> = ({ content, isDarkMode, theme }) => {
    if (!content?.items || !Array.isArray(content.items)) return null;
    return (
        <GlassCard isDarkMode={isDarkMode} theme={theme} className="p-6 md:p-8">
            <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-3">
                {content.items.map((item: any, idx: number) => (
                    <div key={idx} className="aspect-square rounded-xl flex flex-col items-center justify-center p-3 text-center" style={{ backgroundColor: item.color || `${theme?.primary || '#4f46e5'}20` }}>
                        <span className="text-3xl mb-2">{item.icon || '✨'}</span>
                        <span className="text-xs font-medium" style={theme ? { color: theme.text } : {}}>{item.label || item.text}</span>
                        {item.description && <span className="text-[10px] opacity-60 mt-1">{item.description}</span>}
                    </div>
                ))}
            </div>
            {content.theme && <div className="text-center text-sm mt-4 opacity-70">Theme: {content.theme}</div>}
        </GlassCard>
    );
};

// --- 47. EVENT AGENDA ---
const EventAgendaRenderer: React.FC<{ content: any; isDarkMode: boolean; theme?: ThemePalette }> = ({ content, isDarkMode, theme }) => {
    if (!content?.events || !Array.isArray(content.events)) return null;
    return (
        <GlassCard isDarkMode={isDarkMode} theme={theme} className="p-6 md:p-8">
            <div className="space-y-3">
                {content.events.map((event: any, idx: number) => (
                    <div key={idx} className="flex gap-4 p-3 rounded-xl border" style={{ borderColor: `${theme?.primary || '#4f46e5'}20` }}>
                        <div className="text-center min-w-[60px]">
                            <div className="text-xs font-bold" style={{ color: theme?.primary || '#4f46e5' }}>{event.time}</div>
                            {event.duration && <div className="text-[10px] opacity-50">{event.duration}</div>}
                        </div>
                        <div className="flex-1 border-l pl-4" style={{ borderColor: `${theme?.primary || '#4f46e5'}30` }}>
                            <div className="font-semibold text-sm" style={theme ? { color: theme.text } : {}}>{event.title}</div>
                            {event.speaker && <div className="text-xs opacity-70">Speaker: {event.speaker}</div>}
                            {event.location && <div className="text-xs opacity-60">📍 {event.location}</div>}
                        </div>
                    </div>
                ))}
            </div>
        </GlassCard>
    );
};

// --- 48. TESTIMONIALS ---
const TestimonialsRenderer: React.FC<{ content: any; isDarkMode: boolean; theme?: ThemePalette }> = ({ content, isDarkMode, theme }) => {
    const [current, setCurrent] = useState(0);
    if (!content?.testimonials || !Array.isArray(content.testimonials)) return null;
    const testimonial = content.testimonials[current];
    return (
        <GlassCard isDarkMode={isDarkMode} theme={theme} className="p-6 md:p-8 text-center">
            <span className="text-5xl opacity-20" style={{ color: theme?.primary || '#4f46e5' }}>"</span>
            <p className="text-lg italic mb-4" style={theme ? { color: theme.text } : {}}>{testimonial.quote}</p>
            <div className="font-semibold" style={{ color: theme?.primary || '#4f46e5' }}>{testimonial.author}</div>
            {testimonial.role && <div className="text-xs opacity-60">{testimonial.role}</div>}
            {testimonial.company && <div className="text-xs opacity-50">{testimonial.company}</div>}
            {testimonial.rating && <div className="text-yellow-400 mt-2">{'★'.repeat(testimonial.rating)}</div>}
            {content.testimonials.length > 1 && (
                <div className="flex justify-center gap-2 mt-4">
                    {content.testimonials.map((_: any, idx: number) => (
                        <button key={idx} onClick={() => setCurrent(idx)} className="w-2 h-2 rounded-full transition-all" style={{ backgroundColor: idx === current ? (theme?.primary || '#4f46e5') : `${theme?.secondary || '#6b7280'}40` }} />
                    ))}
                </div>
            )}
        </GlassCard>
    );
};

// --- 49. TIPS GRID ---
const TipsGridRenderer: React.FC<{ content: any; isDarkMode: boolean; theme?: ThemePalette }> = ({ content, isDarkMode, theme }) => {
    if (!content?.tips || !Array.isArray(content.tips)) return null;
    return (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {content.tips.map((tip: any, idx: number) => (
                <GlassCard key={idx} isDarkMode={isDarkMode} theme={theme} className="p-4 flex gap-3">
                    <div className="w-10 h-10 rounded-xl flex items-center justify-center text-lg shrink-0" style={{ backgroundColor: `${theme?.accent || '#22c55e'}20` }}>
                        {tip.icon || '💡'}
                    </div>
                    <div>
                        {tip.title && <h4 className="font-semibold text-sm mb-1" style={theme ? { color: theme.text } : {}}>{tip.title}</h4>}
                        <p className="text-sm opacity-80" style={theme ? { color: theme.text } : {}}>{typeof tip === 'string' ? tip : tip.text}</p>
                    </div>
                </GlassCard>
            ))}
        </div>
    );
};

// --- 50. NUMBERED LIST ---
const NumberedListRenderer: React.FC<{ content: any; isDarkMode: boolean; theme?: ThemePalette }> = ({ content, isDarkMode, theme }) => {
    if (!content?.items || !Array.isArray(content.items)) return null;
    return (
        <GlassCard isDarkMode={isDarkMode} theme={theme} className="p-6 md:p-8">
            <ol className="space-y-4">
                {content.items.map((item: any, idx: number) => (
                    <li key={idx} className="flex gap-4">
                        <span className="w-8 h-8 rounded-full flex items-center justify-center text-sm font-bold shrink-0" style={{ backgroundColor: theme?.primary || '#4f46e5', color: '#fff' }}>{idx + 1}</span>
                        <div>
                            {item.title && <h4 className="font-semibold" style={theme ? { color: theme.text } : {}}>{item.title}</h4>}
                            <p className="text-sm opacity-80" style={theme ? { color: theme.text } : {}}>{typeof item === 'string' ? item : item.description}</p>
                        </div>
                    </li>
                ))}
            </ol>
        </GlassCard>
    );
};

// --- 51. RESOURCE LINKS ---
const ResourceLinksRenderer: React.FC<{ content: any; isDarkMode: boolean; theme?: ThemePalette }> = ({ content, isDarkMode, theme }) => {
    if (!content?.links || !Array.isArray(content.links)) return null;
    return (
        <GlassCard isDarkMode={isDarkMode} theme={theme} className="p-6 md:p-8">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                {content.links.map((link: any, idx: number) => (
                    <a key={idx} href={link.url} target="_blank" rel="noopener noreferrer" className="flex items-center gap-3 p-3 rounded-xl border transition-all hover:scale-[1.02]" style={{ borderColor: `${theme?.primary || '#4f46e5'}20` }}>
                        <span className="text-xl">{link.icon || '🔗'}</span>
                        <div className="flex-1 min-w-0">
                            <div className="font-medium text-sm truncate" style={theme ? { color: theme.text } : {}}>{link.title}</div>
                            {link.description && <div className="text-xs opacity-60 truncate">{link.description}</div>}
                        </div>
                        <span className="text-xs opacity-40">→</span>
                    </a>
                ))}
            </div>
        </GlassCard>
    );
};

// --- 52. GLOSSARY ---
const GlossaryRenderer: React.FC<{ content: any; isDarkMode: boolean; theme?: ThemePalette }> = ({ content, isDarkMode, theme }) => {
    if (!content?.terms || !Array.isArray(content.terms)) return null;
    return (
        <GlassCard isDarkMode={isDarkMode} theme={theme} className="p-6 md:p-8">
            <div className="space-y-4">
                {content.terms.map((term: any, idx: number) => (
                    <div key={idx} className="border-b pb-3" style={{ borderColor: `${theme?.secondary || '#6b7280'}20` }}>
                        <dt className="font-bold" style={{ color: theme?.primary || '#4f46e5' }}>{term.term}</dt>
                        <dd className="text-sm mt-1 opacity-80" style={theme ? { color: theme.text } : {}}>{term.definition}</dd>
                        {term.example && <div className="text-xs mt-1 opacity-60 italic">Example: {term.example}</div>}
                    </div>
                ))}
            </div>
        </GlassCard>
    );
};

// --- 53. TRIVIA FACTS ---
const TriviaFactsRenderer: React.FC<{ content: any; isDarkMode: boolean; theme?: ThemePalette }> = ({ content, isDarkMode, theme }) => {
    if (!content?.facts || !Array.isArray(content.facts)) return null;
    const colors = ['#4f46e5', '#22c55e', '#f59e0b', '#ef4444', '#8b5cf6', '#06b6d4'];
    return (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {content.facts.map((fact: any, idx: number) => (
                <GlassCard key={idx} isDarkMode={isDarkMode} theme={theme} className="p-5 text-center">
                    <div className="text-3xl mb-3">{fact.icon || '🎯'}</div>
                    {fact.value && <div className="text-2xl font-bold mb-1" style={{ color: colors[idx % colors.length] }}>{fact.value}</div>}
                    <p className="text-sm" style={theme ? { color: theme.text } : {}}>{typeof fact === 'string' ? fact : fact.text}</p>
                    {fact.source && <div className="text-[10px] opacity-40 mt-2">Source: {fact.source}</div>}
                </GlassCard>
            ))}
        </div>
    );
};

// --- 54. HIGHLIGHT BOX ---
const HighlightBoxRenderer: React.FC<{ content: any; isDarkMode: boolean; theme?: ThemePalette }> = ({ content, isDarkMode, theme }) => {
    if (!content) return null;
    const typeColors: Record<string, string> = {
        info: '#3b82f6',
        success: '#22c55e',
        warning: '#f59e0b',
        error: '#ef4444',
        tip: theme?.accent || '#8b5cf6'
    };
    const color = typeColors[content.type] || theme?.primary || '#4f46e5';
    return (
        <div className="p-5 rounded-xl border-l-4" style={{ backgroundColor: `${color}10`, borderColor: color }}>
            <div className="flex items-start gap-3">
                <span className="text-2xl">{content.icon || (content.type === 'warning' ? '⚠️' : content.type === 'success' ? '✅' : content.type === 'error' ? '❌' : '💡')}</span>
                <div>
                    {content.title && <h4 className="font-semibold mb-1" style={{ color }}>{content.title}</h4>}
                    <p className="text-sm" style={theme ? { color: theme.text } : {}}>{content.text || content.message}</p>
                </div>
            </div>
        </div>
    );
};

// --- 55. PROGRESS TRACKER ---
const ProgressTrackerRenderer: React.FC<{ content: any; isDarkMode: boolean; theme?: ThemePalette }> = ({ content, isDarkMode, theme }) => {
    if (!content?.stages || !Array.isArray(content.stages)) return null;
    const currentIdx = content.stages.findIndex((s: any) => s.current) ?? -1;
    return (
        <GlassCard isDarkMode={isDarkMode} theme={theme} className="p-6 md:p-8">
            <div className="flex items-center justify-between relative">
                <div className="absolute top-5 left-0 right-0 h-1 rounded-full" style={{ backgroundColor: `${theme?.primary || '#4f46e5'}20` }}>
                    <div className="h-full rounded-full transition-all" style={{ width: `${currentIdx >= 0 ? ((currentIdx + 1) / content.stages.length) * 100 : 0}%`, backgroundColor: theme?.primary || '#4f46e5' }} />
                </div>
                {content.stages.map((stage: any, idx: number) => (
                    <div key={idx} className="relative z-10 flex flex-col items-center">
                        <div className="w-10 h-10 rounded-full flex items-center justify-center text-sm font-bold mb-2" style={{ backgroundColor: idx <= currentIdx ? (theme?.primary || '#4f46e5') : `${theme?.secondary || '#6b7280'}30`, color: idx <= currentIdx ? '#fff' : (theme?.text || '#666') }}>
                            {stage.icon || (idx < currentIdx ? '✓' : idx + 1)}
                        </div>
                        <span className="text-xs font-medium text-center max-w-[80px]" style={theme ? { color: theme.text } : {}}>{stage.label}</span>
                    </div>
                ))}
            </div>
        </GlassCard>
    );
};

// ============================================
// END OF NEW WIDGET RENDERERS
// ============================================


// --- TABLE CELL COMPONENT (Fixes truncation & links) ---
const TableCell: React.FC<{
    value: string;
    onChange: (val: string) => void;
    isDarkMode: boolean;
    theme?: ThemePalette
}> = ({ value, onChange, isDarkMode, theme }) => {
    const textareaRef = useRef<HTMLTextAreaElement>(null);
    const [isFocused, setIsFocused] = useState(false);

    // Auto-resize when focused to show all content
    useEffect(() => {
        if (textareaRef.current) {
            if (isFocused) {
                textareaRef.current.style.height = 'auto';
                textareaRef.current.style.height = textareaRef.current.scrollHeight + 'px';
            } else {
                // Reset height when blurred so max-height CSS takes over
                textareaRef.current.style.height = 'auto';
            }
        }
    }, [value, isFocused]);

    // Check for URL (simple regex)
    const urlMatches = value.match(/(https?:\/\/[^\s]+)/g);
    const firstUrl = urlMatches ? urlMatches[0] : null;

    return (
        <div className="relative group min-w-[200px]">
            <textarea
                ref={textareaRef}
                value={value}
                onChange={(e) => onChange(e.target.value)}
                onFocus={() => setIsFocused(true)}
                onBlur={() => setIsFocused(false)}
                className={`w-full bg-transparent border border-transparent focus:border-gray-300 dark:focus:border-gray-600 rounded p-2 outline-none text-sm font-light resize-none transition-[height] duration-200 ${isDarkMode ? 'text-gray-300' : 'text-gray-700'} ${!isFocused ? 'overflow-hidden' : 'overflow-y-auto'}`}
                style={{
                    ... (theme ? { color: theme.text } : {}),
                    lineHeight: '1.5em',
                    maxHeight: isFocused ? 'none' : '3em', // 2 lines at 1.5em line-height
                    display: '-webkit-box',
                    WebkitLineClamp: isFocused ? 'none' : 2,
                    WebkitBoxOrient: 'vertical',
                }}
                rows={1}
            />
            {firstUrl && (
                <div className="absolute top-1 right-1 opacity-0 group-hover:opacity-100 transition-opacity z-10">
                    <a
                        href={firstUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="flex items-center gap-1 p-1.5 bg-blue-500 hover:bg-blue-600 text-white rounded-md text-xs font-bold shadow-lg transition-colors"
                        title={firstUrl}
                    >
                        🔗 <span className="hidden md:inline">Open Link</span>
                    </a>
                </div>
            )}
        </div>
    );
};

// --- TABLE RENDERER ---
const TableRenderer: React.FC<{ content: any; isDarkMode: boolean; theme?: ThemePalette }> = ({ content, isDarkMode, theme }) => {
    const [headers, setHeaders] = useState<string[]>([]);
    const [rows, setRows] = useState<string[][]>([]);

    useEffect(() => {
        if (content?.headers) setHeaders(content.headers);
        if (content?.rows) setRows(content.rows);
    }, [content]);

    if (!headers.length && !rows.length) return null;

    const updateHeader = (index: number, value: string) => {
        const newHeaders = [...headers];
        newHeaders[index] = value;
        setHeaders(newHeaders);
    };

    const updateCell = (rowIndex: number, colIndex: number, value: string) => {
        const newRows = [...rows];
        newRows[rowIndex] = [...newRows[rowIndex]];
        newRows[rowIndex][colIndex] = value;
        setRows(newRows);
    };

    const addRow = () => {
        const newRow = new Array(headers.length).fill('');
        setRows([...rows, newRow]);
    };

    const addColumn = () => {
        setHeaders([...headers, 'New Column']);
        setRows(rows.map(row => [...row, '']));
    };

    const removeRow = (index: number) => {
        setRows(rows.filter((_, i) => i !== index));
    };

    const removeColumn = (index: number) => {
        setHeaders(headers.filter((_, i) => i !== index));
        setRows(rows.map(row => row.filter((_, i) => i !== index)));
    };

    return (
        <div className={`w-full overflow-x-auto rounded-xl border ${isDarkMode ? 'border-white/10' : 'border-black/10'}`} style={theme ? { borderColor: theme.secondary } : {}}>
            <table className="w-full text-left border-collapse">
                <thead>
                    <tr className={isDarkMode ? 'bg-white/10 text-white' : 'bg-black/5 text-black'} style={theme ? { backgroundColor: theme.secondary, color: theme.background } : {}}>
                        {headers.map((h, i) => (
                            <th key={i} className="p-3 min-w-[200px] relative group align-top">
                                <input
                                    type="text"
                                    value={h}
                                    onChange={(e) => updateHeader(i, e.target.value)}
                                    className="w-full bg-transparent border-b border-transparent focus:border-current outline-none font-bold uppercase tracking-wider text-xs py-1"
                                    style={{ color: 'inherit' }}
                                />
                                <button
                                    onClick={() => removeColumn(i)}
                                    className="absolute -top-1 -right-1 opacity-0 group-hover:opacity-100 text-[10px] w-5 h-5 flex items-center justify-center rounded-full bg-red-500 text-white hover:bg-red-600 transition-all z-10 shadow-sm"
                                    title="Remove Column"
                                >
                                    ×
                                </button>
                            </th>
                        ))}
                        <th className="p-2 w-10 align-top">
                            <button
                                onClick={addColumn}
                                className="w-8 h-8 rounded-full flex items-center justify-center hover:bg-black/10 dark:hover:bg-white/10 transition-colors text-xl leading-none pb-1"
                                title="Add Column"
                            >
                                +
                            </button>
                        </th>
                    </tr>
                </thead>
                <tbody>
                    {rows.map((row, rIdx) => (
                        <tr key={rIdx} className={`border-t ${isDarkMode ? 'border-white/5 hover:bg-white/5' : 'border-black/5 hover:bg-black/5'}`} style={theme ? { borderColor: theme.secondary } : {}}>
                            {row.map((cell, cIdx) => (
                                <td key={cIdx} className="p-0 align-top border-r border-transparent last:border-r-0">
                                    <TableCell
                                        value={cell}
                                        onChange={(val) => updateCell(rIdx, cIdx, val)}
                                        isDarkMode={isDarkMode}
                                        theme={theme}
                                    />
                                </td>
                            ))}
                            <td className="p-2 text-center align-middle">
                                <button
                                    onClick={() => removeRow(rIdx)}
                                    className="text-sm opacity-20 hover:opacity-100 hover:text-red-500 transition-opacity p-2"
                                    title="Remove Row"
                                >
                                    🗑️
                                </button>
                            </td>
                        </tr>
                    ))}
                </tbody>
            </table>
            <div className="p-3 border-t border-dashed border-gray-200 dark:border-gray-800 flex justify-center">
                <button
                    onClick={addRow}
                    className={`text-xs font-bold uppercase tracking-widest px-6 py-3 rounded-lg transition-colors flex items-center gap-2 ${isDarkMode ? 'hover:bg-white/10 bg-white/5' : 'hover:bg-black/5 bg-black/5'}`}
                    style={theme ? { color: theme.primary } : {}}
                >
                    <span className="text-lg leading-none">+</span> Add Row
                </button>
            </div>
        </div>
    );
};

// --- SLIDESHOW RENDERER ---
const Slideshow: React.FC<{
    slides: Slide[];
    isDarkMode: boolean;
    theme?: ThemePalette;
    onUpdateSlide?: (index: number, imageUrl: string) => void;
}> = ({ slides, isDarkMode, theme, onUpdateSlide }) => {
    const [current, setCurrent] = useState(0);
    const [images, setImages] = useState<Record<number, string>>({});
    const [loadingImage, setLoadingImage] = useState(false);
    const generatingRef = useRef<Set<number>>(new Set());

    // Load existing images from slides if present
    useEffect(() => {
        slides.forEach((slide, idx) => {
            if (slide.imageUrl && !images[idx]) {
                setImages(prev => ({ ...prev, [idx]: slide.imageUrl! }));
            }
        });
    }, [slides, images]);

    // Generate image for the current slide if not exists
    useEffect(() => {
        const slide = slides[current];
        if (!slide) return;

        // If already generated or loaded, skip
        // Check both local images map and the slide prop itself to be safe
        if (images[current] || slide.imageUrl) return;

        // Check if generation is already in progress
        if (generatingRef.current.has(current)) return;
        if (!slide.imagePrompt && !slide.title) return;

        setLoadingImage(true);
        generatingRef.current.add(current);

        // Prefer Pexels images for slides; fall back to Placeholder if Pexels fails
        const query = slide.imagePrompt || slide.title || '';

        getPexelsImage(query)
            .then(url => {
                const finalUrl = url || `https://placehold.co/1920x1080/1f2937/ffffff?text=${encodeURIComponent(query.substring(0, 30))}&font=roboto`;
                setImages(prev => ({ ...prev, [current]: finalUrl }));
                // Notify parent to save
                if (onUpdateSlide) onUpdateSlide(current, finalUrl);
            })
            .catch(err => {
                console.warn("Pexels lookup failed for slide, using placeholder", err);
                const placeholder = `https://placehold.co/1920x1080/1f2937/ffffff?text=${encodeURIComponent(query.substring(0, 30))}&font=roboto`;
                setImages(prev => ({ ...prev, [current]: placeholder }));
                if (onUpdateSlide) onUpdateSlide(current, placeholder);
            })
            .finally(() => {
                setLoadingImage(false);
                generatingRef.current.delete(current);
            });
    }, [current, slides, images, onUpdateSlide]);


    if (!slides || slides.length === 0) return null;

    const next = () => setCurrent(c => (c + 1) % slides.length);
    const prev = () => setCurrent(c => (c - 1 + slides.length) % slides.length);
    const currentSlide = slides[current];

    return (
        <div className={`relative w-full min-h-[400px] rounded-2xl overflow-hidden shadow-2xl transition-all group ${isDarkMode ? 'bg-neutral-900 border border-white/10' : 'bg-white border border-black/5'
            }`} style={theme ? { borderColor: theme.secondary, backgroundColor: theme.background } : {}}>
            {/* Background Image Layer */}
            <div className="absolute inset-0 z-0">
                {images[current] ? (
                    <img
                        src={images[current]}
                        alt="Slide Background"
                        className="w-full h-full object-cover opacity-30 transition-opacity duration-1000"
                    />
                ) : (
                    <div className={`w-full h-full opacity-10 ${isDarkMode ? 'bg-gradient-to-br from-blue-900 to-purple-900' : 'bg-gradient-to-br from-blue-100 to-purple-100'}`}
                        style={theme ? { backgroundColor: theme.primary } : {}}
                    />
                )}
                {/* Gradient Overlay for Text Readability */}
                <div className={`absolute inset-0 bg-gradient-to-r ${isDarkMode ? 'from-black via-black/80 to-transparent' : 'from-white via-white/90 to-transparent'
                    }`} style={theme ? { background: `linear-gradient(to right, ${theme.background}, ${theme.background}cc, transparent)` } : {}}></div>
            </div>

            {/* Content Layer */}
            <div className="relative z-10 flex flex-col justify-center p-4 sm:p-6 md:p-16 pb-24 sm:pb-28 md:pb-16">
                <div className="w-full max-w-3xl mx-auto">
                    <div className="flex items-center gap-2 sm:gap-3 mb-3 sm:mb-4 md:mb-6 flex-wrap">
                        <span className={`text-[10px] sm:text-xs font-bold uppercase tracking-widest px-2 py-1 rounded border ${isDarkMode ? 'border-white/20 text-white/60' : 'border-black/20 text-black/60'
                            }`} style={theme ? { borderColor: theme.secondary, color: theme.text } : {}}>
                            Slide {current + 1}/{slides.length}
                        </span>
                        {loadingImage && (
                            <span className="flex items-center gap-2 text-[10px] uppercase tracking-wider opacity-50 animate-pulse">
                                Generative Background...
                            </span>
                        )}
                    </div>

                    <h3 className={`text-xl sm:text-2xl md:text-4xl lg:text-5xl font-bold mb-3 sm:mb-4 md:mb-8 leading-tight tracking-tight break-words ${isDarkMode ? 'text-white' : 'text-gray-900'
                        }`} style={theme ? { color: theme.primary } : {}}>
                        {currentSlide.title}
                    </h3>

                    <ul className="space-y-2 sm:space-y-3 md:space-y-4">
                        {currentSlide.content.map((bullet, idx) => (
                            <li key={idx} className="flex gap-2 sm:gap-3 md:gap-4 items-start animate-fade-in" style={{ animationDelay: `${idx * 100}ms` }}>
                                <span className={`mt-1.5 sm:mt-2 w-1.5 h-1.5 rounded-full shrink-0 ${isDarkMode ? 'bg-blue-400' : 'bg-blue-600'
                                    }`} style={theme ? { backgroundColor: theme.accent } : {}}></span>
                                <span className={`text-sm sm:text-base md:text-lg lg:text-xl font-light leading-relaxed break-words ${isDarkMode ? 'text-gray-300' : 'text-gray-700'
                                    }`} style={theme ? { color: theme.text } : {}}>
                                    {bullet}
                                </span>
                            </li>
                        ))}
                    </ul>
                </div>
            </div>

            {/* Controls */}
            <div className="absolute bottom-12 sm:bottom-16 md:bottom-8 right-3 sm:right-4 md:right-8 z-20 flex gap-2 md:gap-4">
                <button
                    onClick={prev}
                    className={`w-9 h-9 sm:w-10 sm:h-10 md:w-12 md:h-12 rounded-full flex items-center justify-center backdrop-blur-md transition-all hover:scale-110 active:scale-95 ${isDarkMode
                        ? 'bg-white/10 hover:bg-white/20 text-white border border-white/10'
                        : 'bg-black/5 hover:bg-black/10 text-black border border-black/5'
                        }`}
                    style={theme ? { backgroundColor: theme.surface, color: theme.text, borderColor: theme.secondary } : {}}
                >
                    <svg className="w-4 h-4 sm:w-5 sm:h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M15 19l-7-7 7-7"></path></svg>
                </button>
                <button
                    onClick={next}
                    className={`w-9 h-9 sm:w-10 sm:h-10 md:w-12 md:h-12 rounded-full flex items-center justify-center backdrop-blur-md transition-all hover:scale-110 active:scale-95 ${isDarkMode
                        ? 'bg-white text-black hover:bg-gray-200'
                        : 'bg-black text-white hover:bg-gray-800'
                        }`}
                    style={theme ? { backgroundColor: theme.primary, color: theme.background } : {}}
                >
                    <svg className="w-4 h-4 sm:w-5 sm:h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M9 5l7 7-7 7"></path></svg>
                </button>
            </div>

            {/* Progress Bar */}
            <div className="absolute bottom-0 left-0 w-full h-1 bg-gray-500/10 z-30">
                <div
                    className={`h-full transition-all duration-500 ${isDarkMode ? 'bg-blue-500' : 'bg-blue-600'}`}
                    style={{ width: `${((current + 1) / slides.length) * 100}%`, backgroundColor: theme ? theme.accent : undefined }}
                ></div>
            </div>
        </div>
    );
};

// --- INTERACTIVE WIDGET RENDERER ---
const WidgetRenderer: React.FC<{
    content: any;
    isDarkMode: boolean;
    onInteract: (input: string, instruction: string) => Promise<string>;
    theme?: ThemePalette;
}> = ({ content, isDarkMode, onInteract, theme }) => {
    const [input, setInput] = useState('');
    const [result, setResult] = useState<string | null>(null);
    const [loading, setLoading] = useState(false);

    const handleSubmit = async () => {
        if (!input.trim()) return;
        setLoading(true);
        try {
            const res = await onInteract(input, content.widgetSystemInstruction);
            setResult(res);
        } catch (e) {
            console.error(e);
            setResult("Error processing request.");
        } finally {
            setLoading(false);
        }
    };

    const getEmoji = (subtype: string) => {
        switch (subtype) {
            case 'quiz': return '🎓';
            case 'simulation': return '🎲';
            case 'oracle': return '🔮';
            case 'creative': return '🎨';
            default: return '🧩';
        }
    };

    return (
        <div className={`relative overflow-hidden p-8 rounded-2xl border transition-all shadow-xl group ${isDarkMode
            ? 'bg-gradient-to-br from-indigo-900/20 to-purple-900/20 border-indigo-500/30'
            : 'bg-gradient-to-br from-indigo-50 to-purple-50 border-indigo-200'
            }`} style={theme ? { backgroundColor: theme.surface, borderColor: theme.secondary } : {}}>
            {/* Decorative Blur */}
            <div className="absolute -top-20 -right-20 w-64 h-64 bg-indigo-500/20 rounded-full blur-3xl group-hover:bg-indigo-500/30 transition-all duration-700 pointer-events-none"
                style={theme ? { backgroundColor: theme.primary + '33' } : {}}></div>

            <div className="relative z-10">
                <div className="flex items-center gap-3 mb-4">
                    <span className="text-3xl filter drop-shadow-md">{getEmoji(content.subtype)}</span>
                    <h3 className={`text-xl font-bold tracking-tight ${isDarkMode ? 'text-white' : 'text-gray-900'}`} style={theme ? { color: theme.primary } : {}}>
                        Interactive: <span className="text-indigo-400 capitalize" style={theme ? { color: theme.accent } : {}}>{content.subtype}</span>
                    </h3>
                </div>

                <p className={`mb-6 text-lg font-light leading-relaxed ${isDarkMode ? 'text-gray-300' : 'text-gray-700'}`} style={theme ? { color: theme.text } : {}}>
                    {content.description}
                </p>

                <div className="space-y-4">
                    <div className="relative flex flex-col md:block">
                        <input
                            type="text"
                            value={input}
                            onChange={(e) => setInput(e.target.value)}
                            placeholder={content.placeholder}
                            onKeyDown={(e) => e.key === 'Enter' && handleSubmit()}
                            className={`w-full px-6 py-4 rounded-xl border outline-none transition-all shadow-inner text-lg ${isDarkMode
                                ? 'bg-black/30 border-white/10 text-white placeholder-white/30 focus:border-indigo-500/50 focus:bg-black/50'
                                : 'bg-white border-gray-200 text-gray-900 placeholder-gray-400 focus:border-indigo-400 focus:ring-2 focus:ring-indigo-100'
                                }`}
                            style={theme ? { borderColor: theme.secondary, color: theme.text, backgroundColor: theme.background } : {}}
                        />
                        <button
                            onClick={handleSubmit}
                            disabled={loading || !input.trim()}
                            className={`mt-3 w-full py-3 md:mt-0 md:w-auto md:absolute md:right-2 md:top-2 md:bottom-2 px-6 rounded-lg font-bold uppercase tracking-wider text-sm transition-all transform active:scale-95 ${loading
                                ? 'bg-gray-600 cursor-not-allowed opacity-50'
                                : 'bg-indigo-600 hover:bg-indigo-500 text-white shadow-lg hover:shadow-indigo-500/25'
                                }`}
                            style={!loading && theme ? { backgroundColor: theme.primary, color: theme.background } : {}}
                        >
                            {loading ? (
                                <span className="flex items-center gap-2">
                                    <svg className="animate-spin h-4 w-4" viewBox="0 0 24 24"><circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" fill="none"></circle><path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path></svg>
                                    Thinking
                                </span>
                            ) : content.buttonText || 'Go'}
                        </button>
                    </div>

                    {result && (
                        <div className={`mt-6 p-6 rounded-xl border animate-fade-in relative ${isDarkMode
                            ? 'bg-indigo-950/30 border-indigo-500/30 text-indigo-100'
                            : 'bg-white border-indigo-200 text-indigo-900 shadow-sm'
                            }`} style={theme ? { backgroundColor: theme.background, borderColor: theme.secondary, color: theme.text } : {}}>
                            <div className="absolute top-3 right-3 bg-indigo-600 text-white px-3 py-1 rounded-full text-[10px] font-bold uppercase tracking-widest shadow-lg"
                                style={theme ? { backgroundColor: theme.accent } : {}}>
                                Gemini Result
                            </div>
                            <div className="font-medium leading-relaxed prose prose-sm prose-invert max-w-none">
                                <ReactMarkdown>{result}</ReactMarkdown>
                            </div>
                        </div>
                    )}
                </div>
            </div>
        </div>
    );
};

// --- FUN SECTION RENDERER ---
const FunSectionRenderer: React.FC<{ html: string; isDarkMode: boolean }> = ({ html, isDarkMode }) => {
    if (!html) return null;

    return (
        <div className="my-16 animate-fade-in">
            {/* Title Outside */}
            <div className="flex items-center gap-3 mb-6 px-2">
                <div className="relative flex h-3 w-3">
                    <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-pink-400 opacity-75"></span>
                    <span className="relative inline-flex rounded-full h-3 w-3 bg-pink-500"></span>
                </div>
                <span className={`text-sm font-bold uppercase tracking-widest ${isDarkMode ? 'text-pink-300' : 'text-pink-600'}`}>
                    Fun Zone: Interactive Simulation
                </span>
            </div>

            {/* Responsive Container with aspect ratio */}
            <div className={`w-full aspect-[4/3] sm:aspect-video min-h-[400px] max-h-[800px] rounded-2xl overflow-hidden shadow-2xl border ${isDarkMode ? 'border-pink-500/20' : 'border-pink-500/10'
                }`}>
                <iframe
                    srcDoc={html}
                    className="w-full h-full border-0 bg-black"
                    title="Interactive Mini Game"
                    sandbox="allow-scripts allow-popups allow-forms allow-same-origin"
                />
            </div>
        </div>
    );
};


export const BlogCreator: React.FC<BlogCreatorProps> = ({
    currentProject,
    initialResearchTopic,
    loadedResearch,
    loadedWebsiteVersion,
    onBackToDashboard,
    onProjectUpdate,
    onResearchCompleted,
    isDarkMode: isDarkModeProp,
    toggleTheme,
    isSubscribed = false,
    onUpgrade,
    onResearchLogsUpdate,
    researchDockOpenSeed,
    isShareView
}) => {
    // Connection State
    const [connected, setConnected] = useState(false);
    const [isSpeaking, setIsSpeaking] = useState(false);
    const [mode, setMode] = useState<Mode>('researcher');

    // Use prop if provided, otherwise fall back to localStorage
    const isDarkMode = isDarkModeProp ?? (() => {
        const saved = localStorage.getItem('theme-dark-mode');
        return saved !== null ? saved === 'true' : true;
    })();

    // UI State
    const [showLibrary, setShowLibrary] = useState(false);
    const [isDockMinimized, setIsDockMinimized] = useState(false);
    const [isFullscreen, setIsFullscreen] = useState(false);
    const [expandedSections, setExpandedSections] = useState({
        analysis: true,
        timeline: true,
        sources: true,
        financials: true,
        videos: true,
        slides: true,
        funZone: true
    });

    // Track if initial research should auto-start
    const [hasAutoStarted, setHasAutoStarted] = useState(false);

    // Content State
    const [htmlContent, setHtmlContent] = useState<string>('');
    const [researchData, setResearchData] = useState<ResearchReport | null>(null);
    const [reportHeaderImage, setReportHeaderImage] = useState<string | null>(null);
    const [currentProjectId, setCurrentProjectId] = useState<string | null>(null);
    const [currentResearchSessionId, setCurrentResearchSessionId] = useState<string | null>(null);

    const [summaryAudioUrl, setSummaryAudioUrl] = useState<string | null>(null);
    const [isGeneratingSummaryAudio, setIsGeneratingSummaryAudio] = useState(false);
    const [isPlayingSummaryAudio, setIsPlayingSummaryAudio] = useState(false);
    const summaryAudioRef = useRef<HTMLAudioElement | null>(null);

    // Credit System State
    const [insufficientCreditsModal, setInsufficientCreditsModal] = useState<{
        isOpen: boolean;
        cost: number;
        current: number;
        operation: CreditOperation
    } | null>(null);

    const checkAndDeductCredits = async (operation: CreditOperation): Promise<boolean> => {
        const user = auth.currentUser;
        if (!user) return false;

        const cost = creditService.getCreditCost(operation);
        const hasEnough = await creditService.hasEnoughCredits(operation);

        if (!hasEnough) {
            const current = await creditService.getUserCredits();
            setInsufficientCreditsModal({ isOpen: true, cost, current, operation });
            return false;
        }

        return await creditService.deductCredits(operation);
    };

    const base64ToBlob = useCallback((base64: string, mimeType: string): Blob => {
        const byteCharacters = atob(base64);
        const byteNumbers = new Array(byteCharacters.length);
        for (let i = 0; i < byteCharacters.length; i++) {
            byteNumbers[i] = byteCharacters.charCodeAt(i);
        }
        return new Blob([new Uint8Array(byteNumbers)], { type: mimeType });
    }, []);

    useEffect(() => {
        const audioEl = summaryAudioRef.current;
        if (!audioEl) return;

        const onEnded = () => setIsPlayingSummaryAudio(false);
        audioEl.addEventListener('ended', onEnded);
        return () => audioEl.removeEventListener('ended', onEnded);
    }, []);

    useEffect(() => {
        return () => {
            if (summaryAudioUrl) {
                try { URL.revokeObjectURL(summaryAudioUrl); } catch { }
            }
        };
    }, [summaryAudioUrl]);
    const [noteMapState, setNoteMapState] = useState<NoteNode[]>([]);
    const [userNotes, setUserNotes] = useState('');
    const [socialCampaign, setSocialCampaign] = useState<SocialCampaign | null>(null);
    const [blogPost, setBlogPost] = useState<BlogPost | null>(null); // New state for blog post
    const [isGeneratingAssets, setIsGeneratingAssets] = useState(false); // Unified loading state
    const [isGeneratingReel, setIsGeneratingReel] = useState(false);
    const [reelVideoUrl, setReelVideoUrl] = useState<string | null>(null);
    const [reelCaption, setReelCaption] = useState<string>('');
    const [reelHashtags, setReelHashtags] = useState<string>('');
    const [videoPost, setVideoPost] = useState<VideoPost | null>(null);

    // Note Suggestion State
    const [noteSuggestions, setNoteSuggestions] = useState<string[]>([]);
    const [loadingSuggestions, setLoadingSuggestions] = useState(false);

    const [textInput, setTextInput] = useState('');
    const [showCode, setShowCode] = useState(false);

    // Context Handover State
    const [builderContext, setBuilderContext] = useState<string>('');
    const [pendingAutoConnect, setPendingAutoConnect] = useState(false);
    const [isWaitingForAutoBuild, setIsWaitingForAutoBuild] = useState(false);

    const [streamingCode, setStreamingCode] = useState<string>('');
    const [researchLogs, setResearchLogs] = useState<string[]>([]); // New: Dedicated logs for main view
    const [isGenerating, setIsGenerating] = useState(false);
    const [generationStatus, setGenerationStatus] = useState<'idle' | 'stable' | 'retrying' | 'failed'>('idle');
    const [currentActivity, setCurrentActivity] = useState<'thinking' | 'searching' | 'reading' | 'stock' | 'crypto' | 'jobs' | 'video' | 'game' | null>(null);
    const [activitySummary, setActivitySummary] = useState<string>('');
    const [logs, setLogs] = useState<LogItem[]>([]);
    const [userTranscriptBuffer, setUserTranscriptBuffer] = useState('');
    const [assistantTranscriptBuffer, setAssistantTranscriptBuffer] = useState('');
    const [queuedInputLength, setQueuedInputLength] = useState(0);
    const [copyFeedback, setCopyFeedback] = useState(false);
    const [shareFeedback, setShareFeedback] = useState(false);
    const [currentShareId, setCurrentShareId] = useState<string | null>(null);
    const [shareModalOpen, setShareModalOpen] = useState(false);
    const [shareModalStatus, setShareModalStatus] = useState<'confirm' | 'working' | 'ready' | 'error'>('confirm');
    const [shareModalLink, setShareModalLink] = useState<string>('');
    const [shareModalError, setShareModalError] = useState<string | null>(null);
    const [usageLimitModal, setUsageLimitModal] = useState<{ isOpen: boolean; usageType: UsageType; current: number; limit: number } | null>(null);

    // Refs
    const audioContextRef = useRef<AudioContext | null>(null);
    const inputContextRef = useRef<AudioContext | null>(null);
    const mediaStreamRef = useRef<MediaStream | null>(null);
    const sessionRef = useRef<Promise<any> | null>(null);
    // Track the currently active deep-research run so we can ignore late
    // updates when the user navigates away or opens an older session.
    const activeRunIdRef = useRef<string | null>(null);
    const lastInitialTopicRef = useRef<string | null>(null);
    const nextStartTimeRef = useRef<number>(0);
    const sourcesRef = useRef<Set<AudioBufferSourceNode>>(new Set());
    const logsEndRef = useRef<HTMLDivElement>(null);
    const codeEndRef = useRef<HTMLDivElement>(null);
    const researchLogsEndRef = useRef<HTMLDivElement>(null);
    const fileInputRef = useRef<HTMLInputElement>(null);

    // Audio Queueing Refs
    const isBusyRef = useRef<boolean>(false);
    const audioQueueRef = useRef<any[]>([]);

    // Track generation status to prevent double generation
    const generatingImagePromptRef = useRef<string | null>(null);
    const hasSentInitialTopicRef = useRef(false);

    // Derived Active Theme (Light vs Dark)
    const activeTheme = researchData?.theme
        ? (isDarkMode ? researchData.theme.dark : researchData.theme.light)
        : undefined;

    // When the parent indicates a brand-new research run (non-resume),
    // ensure the floating prompt dock starts expanded so the input is visible.
    useEffect(() => {
        if (researchDockOpenSeed !== undefined) {
            setIsDockMinimized(false);
        }
    }, [researchDockOpenSeed]);

    // Auto-scroll logs
    useEffect(() => {
        logsEndRef.current?.scrollIntoView({ behavior: 'smooth' });
    }, [logs]);

    // Auto-scroll code stream
    useEffect(() => {
        codeEndRef.current?.scrollIntoView({ behavior: 'smooth' });
    }, [streamingCode]);

    // Auto-scroll research logs
    useEffect(() => {
        researchLogsEndRef.current?.scrollIntoView({ behavior: 'smooth' });
    }, [researchLogs]);

    // Expose live research logs to parent (e.g. ProjectDashboard Research in Progress card)
    useEffect(() => {
        if (onResearchLogsUpdate) {
            onResearchLogsUpdate(researchLogs);
        }
    }, [researchLogs, onResearchLogsUpdate]);

    useEffect(() => {
        if (initialResearchTopic !== lastInitialTopicRef.current) {
            lastInitialTopicRef.current = initialResearchTopic || null;
            setHasAutoStarted(false);
        }
    }, [initialResearchTopic]);

    // Load research from props if provided (e.g. opening a saved session from the dashboard)
    useEffect(() => {
        if (loadedResearch) {
            // Switching the visible report should not cancel any in-progress deep
            // research run. That run may continue streaming logs in the dock and
            // will complete/save independently.

            setResearchData(loadedResearch.researchReport);
            setCurrentResearchSessionId(loadedResearch.id);
            setCurrentShareId(loadedResearch.shareId || null);
            setNoteMapState(loadedResearch.noteMapState || []);
            setCurrentProjectId(currentProject?.id || null);

            if (loadedWebsiteVersion) {
                setHtmlContent(loadedWebsiteVersion.html);
                setMode('builder');
                setIsWaitingForAutoBuild(false);
                setPendingAutoConnect(true);
            } else if (loadedResearch.websiteVersions && loadedResearch.websiteVersions.length > 0) {
                setHtmlContent(loadedResearch.websiteVersions[0].html);
                setIsWaitingForAutoBuild(false);
                setPendingAutoConnect(true);
            } else {
                setHtmlContent('');
                setIsWaitingForAutoBuild(true);
            }
        }
    }, [loadedResearch, loadedWebsiteVersion, currentProject?.id]);

    // Auto-start research with initial topic if provided
    useEffect(() => {
        if (initialResearchTopic && !hasAutoStarted) {
            setHasAutoStarted(true);
            setTextInput(initialResearchTopic);
            startDeepResearchFromPrompt(initialResearchTopic);
        }
    }, [initialResearchTopic, hasAutoStarted, currentProject, onProjectUpdate]);

    useEffect(() => {
        const noGlobalEntry =
            !initialResearchTopic &&
            !loadedResearch &&
            (!currentProject || currentProject.activeResearchStatus !== 'in_progress');

        // Only clear to a blank state when there is truly no loaded research run
        // (no global entry point AND no in-memory research report/session).
        if (noGlobalEntry && !researchData && !currentResearchSessionId) {
            setResearchData(null);
            setUserNotes('');
            setSocialCampaign(null);
            setBlogPost(null);
            setVideoPost(null);
            setCurrentActivity(null);
            setActivitySummary('');
            setResearchLogs([]);
        }
    }, [initialResearchTopic, loadedResearch, currentProject?.activeResearchStatus, researchData, currentResearchSessionId]);

    // Auto-connect effect for mode switching
    useEffect(() => {
        if (pendingAutoConnect) {
            const timer = setTimeout(() => {
                connect();
                setPendingAutoConnect(false);
            }, 500); // Small delay to ensure state and cleanup settle
            return () => clearTimeout(timer);
        }
    }, [mode, pendingAutoConnect]);

    // Sync userNotes with researchData when loading a new project
    useEffect(() => {
        if (researchData) {
            setUserNotes(researchData.userNotes || '');
            setSocialCampaign(researchData.socialCampaign || null);
            setBlogPost(researchData.blogPost || null);
            setVideoPost(researchData.videoPost || null);
        }
    }, [researchData?.topic, currentProjectId]);

    // Debounced auto-save for User Notes
    useEffect(() => {
        const timer = setTimeout(() => {
            if (researchData && currentProjectId && userNotes !== (researchData.userNotes || '')) {
                const updated = { ...researchData, userNotes };
                setResearchData(updated);
                storageService.updateProjectReport(currentProjectId, updated);
            }
        }, 1000);
        return () => clearTimeout(timer);
    }, [userNotes, currentProjectId]);

    // Debounced Suggestion Generator for Notes
    useEffect(() => {
        const timer = setTimeout(async () => {
            if (!userNotes || userNotes.length < 5) return;
            if (researchData) {
                setLoadingSuggestions(true);
                const sugs = await generateNoteSuggestions(userNotes, researchData.topic);
                setNoteSuggestions(sugs);
                setLoadingSuggestions(false);
            }
        }, 2000); // 2s debounce to avoid spamming
        return () => clearTimeout(timer);
    }, [userNotes, researchData]);

    // Generate Report Image Effect with Theme Extraction & Persistence
    useEffect(() => {
        if (!researchData) {
            setReportHeaderImage(null);
            generatingImagePromptRef.current = null;
            return;
        }

        // 1. If we have a URL in data, use it directly (Persistence check)
        if (researchData.headerImageUrl) {
            if (reportHeaderImage !== researchData.headerImageUrl) {
                setReportHeaderImage(researchData.headerImageUrl);
            }

            // Theme recovery for legacy saves - only if not currently processing
            if (!researchData.theme && mode === 'researcher' && !generatingImagePromptRef.current && researchData.headerImageUrl.startsWith('data:')) {
                generatingImagePromptRef.current = "extracting_legacy";
                extractImageColors(researchData.headerImageUrl).then(theme => {
                    if (theme && currentProjectId) {
                        // Merge theme into the latest researchData instead of a stale snapshot
                        setResearchData(prev => {
                            if (!prev) return prev;
                            const updatedReport = { ...prev, theme };
                            storageService.updateProjectReport(currentProjectId, updatedReport);
                            return updatedReport;
                        });
                    }
                    generatingImagePromptRef.current = null;
                });
            }
            return;
        }

        // 2. Otherwise Generate new
        if (mode === 'researcher' && researchData.headerImagePrompt && !reportHeaderImage) {
            // Prevent double generation
            if (generatingImagePromptRef.current === researchData.headerImagePrompt) return;

            generatingImagePromptRef.current = researchData.headerImagePrompt;

            addLog('system', '🎨 Generating Report Header Image...');
            generateImage(researchData.headerImagePrompt)
                .then(async result => {
                    const url = result.imageDataUrl;
                    // EXTRACT THEME
                    addLog('system', '🎨 Extracting Color Palette from Image...');
                    const extractedTheme = await extractImageColors(url);
                    if (extractedTheme) {
                        addLog('system', '🎨 Theme Extracted & Applied.');
                    }

                    // PERSIST EVERYTHING against the latest researchData so we don't
                    // clobber creative assets that may have been added in parallel.
                    setResearchData(prev => {
                        if (!prev) return prev;
                        const updatedReport = {
                            ...prev,
                            headerImageUrl: url,
                            theme: extractedTheme || prev.theme
                        };

                        if (currentProjectId) {
                            storageService.updateProjectReport(currentProjectId, updatedReport);
                        }

                        return updatedReport;
                    });

                    setReportHeaderImage(url);

                    generatingImagePromptRef.current = null;
                })
                .catch(err => {
                    console.error("Report header gen failed", err);
                    generatingImagePromptRef.current = null;
                });
        }
    }, [researchData, mode, currentProjectId, reportHeaderImage]);

    const addLog = (type: LogItem['type'], text: string) => {
        setLogs(prev => {
            // Logic to merge streaming thought logs into a single bubble
            const lastLog = prev[prev.length - 1];
            if (lastLog && lastLog.type === type && type === 'thought') {
                // Return a new array with the last item updated
                return [
                    ...prev.slice(0, -1),
                    { ...lastLog, text: lastLog.text + text }
                ];
            }

            // Standard append for new logs or different types
            return [...prev, {
                id: Math.random().toString(36).substring(7),
                type,
                text,
                timestamp: Date.now()
            }];
        });
    };

    // Callback for Slideshow to save generated images
    const handleUpdateSlideImage = useCallback((index: number, url: string) => {
        if (!researchData || !currentProjectId) return;
        const newSlides = [...(researchData.slides || [])];
        if (newSlides[index]) {
            newSlides[index] = { ...newSlides[index], imageUrl: url };
            const updatedReport = { ...researchData, slides: newSlides };
            setResearchData(updatedReport);
            storageService.updateProjectReport(currentProjectId, updatedReport);
        }
    }, [researchData, currentProjectId]);

    // --- CREATIVE ASSETS GENERATOR (Unified) ---
    const generateCreativeAssets = async (report: ResearchReport) => {
        if (!report || isGeneratingAssets) return;

        await incrementUsage('social');

        setIsGeneratingAssets(true);
        addLog('system', '🎨 Generating Social Campaign & Blog Post...');

        try {
            // 1. Text generation for campaign + blog (allowing partial success)
            let campaignPosts: any[] = [];
            let blogDraft: BlogPost | null = null;

            const [campaignResult, blogResult] = await Promise.allSettled([
                generateSocialCampaign(report.topic, report.summary, report.keyPoints || []),
                generateStructuredBlogPost(report.topic, report.summary, report.keyPoints || [])
            ]);

            if (campaignResult.status === 'fulfilled' && Array.isArray(campaignResult.value) && campaignResult.value.length > 0) {
                campaignPosts = campaignResult.value;
            } else {
                console.error('Social campaign generation failed or returned no posts', campaignResult);
            }

            if (blogResult.status === 'fulfilled' && blogResult.value && blogResult.value.content) {
                blogDraft = blogResult.value;
            } else {
                console.error('Blog generation failed or returned empty content', blogResult);
            }

            let newCampaign: SocialCampaign | null = null;
            let newBlogPost: BlogPost | null = null;

            // Process Social Campaign
            if (campaignPosts.length > 0) {
                newCampaign = { posts: campaignPosts };
                setSocialCampaign(newCampaign);
            }

            // Process Blog Post
            if (blogDraft && blogDraft.content) {
                newBlogPost = blogDraft;
                setBlogPost(newBlogPost);
            }

            // Initial Save of Text Content
            if (currentProjectId) {
                const updatedReport = { ...report, socialCampaign: newCampaign || undefined, blogPost: newBlogPost || undefined };
                setResearchData(updatedReport);
                storageService.updateProjectReport(currentProjectId, updatedReport);
            }

            // 2. Parallel Image Generation (and persistence to knowledge base / Blob storage)
            const imagePromises: Promise<void>[] = [];

            // Social Images
            if (campaignPosts.length > 0) {
                campaignPosts.forEach((post, index) => {
                    imagePromises.push(
                        (async () => {
                            try {
                                const result = await generateImage(post.imagePrompt);
                                const url = result.imageDataUrl;
                                let finalUrl = url;

                                // Always persist generated images to the project knowledge base (Vercel Blob-backed)
                                if (currentProject && currentProject.id) {
                                    try {
                                        const res = await fetch(url);
                                        const blob = await res.blob();
                                        const file = new File(
                                            [blob],
                                            `social-${index}-${Date.now()}.png`,
                                            { type: blob.type || 'image/png' }
                                        );
                                        const kb = await storageService.uploadKnowledgeBaseFile(
                                            currentProject.id,
                                            file,
                                            currentResearchSessionId || undefined
                                        );
                                        finalUrl = kb.url;
                                    } catch (saveError) {
                                        console.error('Failed to save social image to project knowledge base:', saveError);
                                    }
                                }

                                setSocialCampaign(prev => {
                                    if (!prev) return null;
                                    const updatedPosts = [...prev.posts];
                                    updatedPosts[index] = { ...updatedPosts[index], imageUrl: finalUrl };
                                    return { posts: updatedPosts };
                                });
                            } catch (error) {
                                console.error('Failed to generate social image:', error);
                            }
                        })()
                    );
                });
            }

            // Blog Image (only if blog text was successfully generated)
            if (blogDraft && blogDraft.imagePrompt) {
                imagePromises.push(
                    (async () => {
                        try {
                            const result = await generateImage(blogDraft.imagePrompt);
                            const url = result.imageDataUrl;
                            let finalUrl = url;

                            if (currentProject && currentProject.id) {
                                try {
                                    const res = await fetch(url);
                                    const blob = await res.blob();
                                    const file = new File(
                                        [blob],
                                        `blog-cover-${Date.now()}.png`,
                                        { type: blob.type || 'image/png' }
                                    );
                                    const kb = await storageService.uploadKnowledgeBaseFile(
                                        currentProject.id,
                                        file,
                                        currentResearchSessionId || undefined
                                    );
                                    finalUrl = kb.url;
                                } catch (saveError) {
                                    console.error('Failed to save blog cover image to project knowledge base:', saveError);
                                }
                            }

                            setBlogPost(prev => prev ? { ...prev, imageUrl: finalUrl } : null);
                        } catch (error) {
                            console.error('Failed to generate blog cover image:', error);
                        }
                    })()
                );
            }

            // 3. Campaign Reel Video via Sora with Creatomate fallback (saved to project knowledge base + video post asset)
            if (currentProject && currentProject.id) {
                imagePromises.push(
                    (async () => {
                        // Build a concise reel-style prompt from the generated blog/campaign
                        const promptParts: string[] = [];
                        if (blogDraft?.title) promptParts.push(blogDraft.title);
                        if (blogDraft?.subtitle) promptParts.push(blogDraft.subtitle);
                        if (blogDraft?.content) {
                            promptParts.push('Vertical social media reel summarizing the article above with engaging motion graphics.');
                        }

                        const soraPrompt = promptParts.join(' - ') || `Vertical social media reel about ${report.topic}`;

                        // Compose context description for voiceover
                        const contextLines: string[] = [];
                        if (blogDraft?.title) contextLines.push(`Title: ${blogDraft.title}`);
                        if (blogDraft?.subtitle) contextLines.push(`Subtitle: ${blogDraft.subtitle}`);
                        if (report.summary) contextLines.push(`Research summary: ${report.summary}`);
                        const articleContent = blogDraft?.content || '';
                        const contextDescription = `${contextLines.join('\n')}\n\nArticle content (may be truncated):\n${articleContent.slice(0, 800)}`;

                        // Derive a simple caption + hashtags for the video post
                        const topic = report.topic || 'Research Insight';
                        const summary = report.summary || report.tldr || '';
                        const baseCaption = (summary
                            ? `${summary.split('.').slice(0, 1).join('.').trim()}${summary.includes('.') ? '.' : ''}`
                            : (blogDraft?.subtitle || blogDraft?.title || topic));
                        const topicTag = `#${topic.replace(/[^a-zA-Z0-9]+/g, '').toLowerCase()}`;
                        const hashtags = topicTag || '#research';

                        try {
                            const job = await createVideoFromText({
                                model: 'sora-2',
                                prompt: soraPrompt,
                                seconds: '8',
                                size: '720x1280',
                            });

                            const finalJob = await pollVideoUntilComplete(job.id);
                            if (finalJob.status !== 'completed') {
                                console.error('Sora campaign reel job did not complete successfully:', finalJob);
                                throw new Error(finalJob.error?.message || `Sora job ended with status: ${finalJob.status}`);
                            }

                            const blob = await downloadVideoBlob(finalJob.id, 'video');
                            const file = new File(
                                [blob],
                                `campaign-reel-${Date.now()}.mp4`,
                                { type: 'video/mp4' }
                            );

                            const kb = await storageService.uploadKnowledgeBaseFile(
                                currentProject.id,
                                file,
                                currentResearchSessionId || undefined
                            );

                            setVideoPost({
                                videoUrl: kb.url,
                                caption: baseCaption,
                                hashtags,
                                provider: 'sora',
                            });
                        } catch (soraError) {
                            console.error('Failed to generate campaign reel video with Sora, falling back to Veo 3.1 then Creatomate:', soraError);
                            // Veo 3.1 fallback
                            try {
                                const veoBlob = await generateVeoVideo(soraPrompt, '9:16', 'quality', {});
                                const veoFile = new File(
                                    [veoBlob],
                                    `campaign-reel-veo-${Date.now()}.mp4`,
                                    { type: 'video/mp4' }
                                );

                                const kb = await storageService.uploadKnowledgeBaseFile(
                                    currentProject.id,
                                    veoFile,
                                    currentResearchSessionId || undefined
                                );

                                setVideoPost({
                                    videoUrl: kb.url,
                                    caption: baseCaption,
                                    hashtags,
                                    provider: 'veo',
                                });
                                return;
                            } catch (veoError) {
                                console.error('Veo fallback for campaign reel failed, falling back to Creatomate:', veoError);
                            }

                            // Creatomate fallback
                            try {
                                const fallback = await createVoiceoverVideoWithCreatomate({
                                    prompt: soraPrompt,
                                    voiceoverPrompt: blogDraft?.subtitle || blogDraft?.title || report.summary || report.topic || 'Social media reel',
                                    aspect: '720x1280',
                                    durationSeconds: 8,
                                    contextDescription,
                                });

                                const res = await fetch(fallback.url);
                                const blob = await res.blob();
                                const file = new File(
                                    [blob],
                                    `campaign-reel-creatomate-${Date.now()}.mp4`,
                                    { type: 'video/mp4' }
                                );

                                const kb = await storageService.uploadKnowledgeBaseFile(
                                    currentProject.id,
                                    file,
                                    currentResearchSessionId || undefined
                                );

                                setVideoPost({
                                    videoUrl: kb.url,
                                    caption: baseCaption,
                                    hashtags,
                                    provider: 'creatomate',
                                });
                            } catch (fallbackError) {
                                console.error('Creatomate fallback for campaign reel failed:', fallbackError);
                            }
                        }
                    })()
                );
            }

            // Wait for all images and then do a final save
            await Promise.allSettled(imagePromises);

            await persistCreativeAssetsNow();

            // FINAL SAVE: After all images are generated, save the complete assets
            // We need to get the latest state from the React state callbacks
            setTimeout(() => {
                saveCreativeAssets();
            }, 500);

        } catch (err) {
            console.error(err);
        } finally {
            setIsGeneratingAssets(false);
            addLog('system', '✅ Creative Assets Generated.');
        }
    };

    // Helper to save creative assets to storage (debounced to prevent Firestore exhaustion)
    const saveCreativeAssets = useCallback(
        debounce(() => {
            if (!researchData) return;

            // For SavedProject (legacy)
            if (currentProjectId && !currentProject) {
                const updatedReport = { ...researchData, socialCampaign, blogPost, videoPost };
                storageService.updateProjectReport(currentProjectId, updatedReport);
            }

            // For ResearchProject (new system)
            if (currentProject && currentResearchSessionId) {
                const updatedReport = { ...researchData, socialCampaign, blogPost, videoPost };
                storageService.updateResearchInProject(currentProject.id, currentResearchSessionId, { researchReport: updatedReport });

                // Also update the in-memory project and notify parent so ProjectDashboard/Assets see the new blog immediately
                if (onProjectUpdate) {
                    const updatedSessions = (currentProject.researchSessions || []).map(session =>
                        session.id === currentResearchSessionId
                            ? { ...session, researchReport: updatedReport }
                            : session
                    );

                    onProjectUpdate({
                        ...currentProject,
                        researchSessions: updatedSessions,
                        lastModified: Date.now(),
                    });
                }
            }
        }, 800), // 800ms debounce to avoid rapid Firestore writes
        [researchData, currentProjectId, currentProject, currentResearchSessionId, onProjectUpdate, socialCampaign, blogPost, videoPost]
    );

    const persistCreativeAssetsNow = async () => {
        if (!researchData) return;

        const baseReport: ResearchReport = {
            ...researchData,
            socialCampaign: socialCampaign || researchData.socialCampaign,
            blogPost: blogPost || researchData.blogPost,
            videoPost: videoPost || researchData.videoPost,
        };

        if (currentProjectId && !currentProject) {
            await storageService.updateProjectReport(currentProjectId, baseReport);
            setResearchData(baseReport);
        }

        if (currentProject && currentResearchSessionId) {
            await storageService.updateResearchInProject(currentProject.id, currentResearchSessionId, { researchReport: baseReport });

            setResearchData(baseReport);

            if (onProjectUpdate) {
                const updatedSessions = (currentProject.researchSessions || []).map(session =>
                    session.id === currentResearchSessionId
                        ? { ...session, researchReport: baseReport }
                        : session
                );

                onProjectUpdate({
                    ...currentProject,
                    researchSessions: updatedSessions,
                    lastModified: Date.now(),
                });
            }
        }
    };

    // Track previous serialized values to detect actual changes
    const prevSocialRef = useRef<string | null>(null);
    const prevBlogRef = useRef<string | null>(null);
    const prevVideoRef = useRef<string | null>(null);

    // Auto-save when social assets actually change (not on every render)
    useEffect(() => {
        const currentSocialStr = socialCampaign ? JSON.stringify(socialCampaign) : null;
        const currentBlogStr = blogPost ? JSON.stringify(blogPost) : null;
        const currentVideoStr = videoPost ? JSON.stringify(videoPost) : null;

        const socialChanged = currentSocialStr !== prevSocialRef.current;
        const blogChanged = currentBlogStr !== prevBlogRef.current;
        const videoChanged = currentVideoStr !== prevVideoRef.current;

        if ((socialChanged || blogChanged || videoChanged) && (socialCampaign || blogPost || videoPost)) {
            saveCreativeAssets();
        }

        prevSocialRef.current = currentSocialStr;
        prevBlogRef.current = currentBlogStr;
        prevVideoRef.current = currentVideoStr;
    }, [socialCampaign, blogPost, videoPost, saveCreativeAssets]);

    // Regenerate creative assets
    const handleRegenerateAssets = async () => {
        if (!researchData) return;

        setSocialCampaign(null);
        setBlogPost(null);
        setVideoPost(null);

        await generateCreativeAssets(researchData);
    };

    // --- WIDGET INTERACTION HANDLER ---
    const handleWidgetInteraction = async (input: string, instruction: string): Promise<string> => {
        if (!(await checkAndDeductCredits('inlineAiAsk'))) {
            return "Insufficient credits to use this widget.";
        }
        // 1. Get Full Report Context
        if (!researchData) return "Error: Report context missing.";

        const context = JSON.stringify(researchData);

        // 2. Call Gemini Flash Lite
        const result = await queryWidget(context, instruction, input);

        // 3. Inform Live API (if connected)
        if (connected && sessionRef.current) {
            const session = await sessionRef.current;
            const interactionMessage = `USER_INTERACTION_EVENT:
                                                                                                        Widget: ${instruction.substring(0, 50)}...
                                                                                                        User Input: "${input}"
                                                                                                        Gemini Lite Result: "${result}"

                                                                                                        INSTRUCTION: The user just used the interactive widget. Acknowledge this briefly if you are speaking next.`;

            await session.sendClientContent({
                turns: [{
                    role: 'user',
                    parts: [{ text: interactionMessage }]
                }],
                turnComplete: true // We don't necessarily force a turn, but updating context is good.
            });
        }

        return result;
    };

    // --- NOTE MAP STATE HANDLER ---
    const handleNoteMapUpdate = (newNodes: NoteNode[]) => {
        const prevNodes = noteMapState;
        setNoteMapState(newNodes);

        if (connected && sessionRef.current) {
            // 1. Check for Additions
            // We consider a node "added" if its ID wasn't in the previous state.
            const addedNodes = newNodes.filter(n => !prevNodes.find(p => p.id === n.id));
            if (addedNodes.length > 0) {
                const summary = addedNodes.map(n => `"${n.title}"`).join(', ');
                sessionRef.current.then(s => s.sendClientContent({
                    turns: [{ role: 'user', parts: [{ text: `[SYSTEM EVENT] Note Map: ${addedNodes.length} new node(s) created: ${summary}. User may have added them manually or branched an existing node.` }] }],
                    turnComplete: false
                }));
            }

            // 2. Check for Content Edits
            // We ignore X/Y changes to avoid spamming the context during drags.
            const modifiedNodes = newNodes.filter(n => {
                const p = prevNodes.find(prev => prev.id === n.id);
                // Check if title or content changed
                return p && (p.title !== n.title || p.content !== n.content);
            });

            if (modifiedNodes.length > 0) {
                const summary = modifiedNodes.map(n => `"${n.title}"`).join(', ');
                sessionRef.current.then(s => s.sendClientContent({
                    turns: [{ role: 'user', parts: [{ text: `[SYSTEM EVENT] Note Map: Node(s) content updated: ${summary}.` }] }],
                    turnComplete: false
                }));
            }
        }

        // Persist to storage - note map state is saved with the research session
        if (currentProject && currentResearchSessionId) {
            storageService.updateResearchInProject(currentProject.id, currentResearchSessionId, { noteMapState: newNodes });
        }
    };

    const handleInsertToMap = () => {
        if (!userNotes.trim()) return;

        // Create new node from scratchpad
        const newNode: NoteNode = {
            id: `node-scratch-${Date.now()}`,
            x: 400 + (Math.random() * 100 - 50), // Center with slight random offset
            y: 300 + (Math.random() * 100 - 50),
            title: "Scratchpad Note", // Or maybe truncate content? "Note: " + userNotes.substring(0, 15)...
            content: userNotes,
            color: activeTheme ? activeTheme.accent : '#f472b6',
            width: 300
        };

        let updatedNodes = [...noteMapState];

        // Fix: Ensure we don't lose the original report nodes if this is the first interaction with the map
        // We check if report nodes are missing (e.g. if map is empty or only has user scratch notes)
        const hasReportNodes = updatedNodes.some(n => n.id === 'root' || n.id.startsWith('kp-'));

        if (!hasReportNodes && researchData) {
            const initialNodes = generateInitialNodes(researchData);
            updatedNodes = [...updatedNodes, ...initialNodes];
        }

        updatedNodes.push(newNode);

        // Use the existing handler to ensure persistence and Live API context updates
        handleNoteMapUpdate(updatedNodes);

        addLog('system', '📝 Scratchpad content added to Note Map.');
    };

    const handleCopy = async () => {
        let contentToCopy = '';

        if (mode === 'builder') {
            contentToCopy = htmlContent;
        } else if (mode === 'researcher' && researchData) {
            const report = researchData;
            contentToCopy = `# ${report.topic}\n\n`;
            if (report.tldr) contentToCopy += `## TL;DR\n${report.tldr}\n\n`;
            contentToCopy += `## Summary\n${report.summary}\n\n`;

            if (report.dynamicSections) {
                report.dynamicSections.forEach(ds => {
                    contentToCopy += `## ${ds.title}\n`;
                    if (typeof ds.content === 'string') {
                        contentToCopy += `${ds.content}\n\n`;
                    } else {
                        contentToCopy += JSON.stringify(ds.content, null, 2) + "\n\n";
                    }
                });
            }

            if (report.keyPoints && report.keyPoints.length > 0) {
                contentToCopy += `## Key Points\n`;
                report.keyPoints.forEach(kp => {
                    contentToCopy += `### ${kp.title} (${kp.priority})\n${kp.details}\n\n`;
                });
            }

            contentToCopy += `## Market Implications\n${report.marketImplications}\n\n`;

            if (userNotes) {
                contentToCopy += `## User Notes\n${userNotes}\n\n`;
            }

            if (report.videoAnalysis) {
                contentToCopy += `## Video Intelligence\n**${report.videoAnalysis.title}**\n${report.videoAnalysis.analysis}\n\n`;
            }

            if (report.sources && report.sources.length > 0) {
                contentToCopy += `## Sources\n`;
                report.sources.forEach((src, idx) => {
                    contentToCopy += `${idx + 1}. ${src.title} (${src.uri})\n`;
                });
            }
        }

        if (contentToCopy) {
            try {
                await navigator.clipboard.writeText(contentToCopy);
                setCopyFeedback(true);
                setTimeout(() => setCopyFeedback(false), 2000);
            } catch (err) {
                console.error('Copy failed', err);
            }
        }
    };

    const handleShare = () => {
        if (!researchData) return;

        const existingShareId = currentShareId || loadedResearch?.shareId || null;
        const link =
            typeof window !== 'undefined' && existingShareId
                ? `${window.location.origin}/r/${existingShareId}`
                : '';

        setShareModalError(null);
        setShareModalLink(link);
        setShareModalStatus(existingShareId ? 'ready' : 'confirm');
        setShareModalOpen(true);
    };

    const handleMakePublic = async () => {
        if (!researchData) return;
        if (!currentProjectId || !currentResearchSessionId) {
            setShareModalStatus('error');
            setShareModalError('This report must be saved in a project before it can be shared.');
            return;
        }

        setShareModalError(null);
        setShareModalStatus('working');

        try {
            const shareId = await storageService.createShareLinkForResearchSession(
                currentProjectId,
                currentResearchSessionId,
                researchData
            );

            setCurrentShareId(shareId);

            const link = typeof window !== 'undefined' ? `${window.location.origin}/r/${shareId}` : '';
            setShareModalLink(link);
            setShareModalStatus('ready');
        } catch (e: any) {
            console.error('Failed to create share link', e);
            setShareModalStatus('error');
            setShareModalError(e?.message || 'Failed to create share link');
        }
    };

    const handleCopyShareLink = async () => {
        if (!shareModalLink) return;
        try {
            await navigator.clipboard.writeText(shareModalLink);
            setShareFeedback(true);
            setTimeout(() => setShareFeedback(false), 2000);
        } catch (e) {
            console.error('Copy share link failed', e);
        }
    };

    const startDeepResearchFromPrompt = async (topic: string, skipCreditCheck = false) => {
        const trimmedTopic = topic.trim();
        if (!trimmedTopic) return;

        if (!skipCreditCheck) {
            const success = await checkAndDeductCredits('researchSession');
            if (!success) {
                // If checking from useEffect (auto-research), the modal will be shown by checkAndDeductCredits.
                return;
            }
        }

        let runId: string | null = null;

        try {
            await incrementUsage('research');
            runId = (typeof crypto !== 'undefined' && (crypto as any).randomUUID)
                ? crypto.randomUUID()
                : `${Date.now()}-${Math.random().toString(36).slice(2)}`;
            activeRunIdRef.current = runId;

            if (currentProject) {
                // Persist in-progress status so the dashboard can show an active research card
                try {
                    await storageService.updateResearchProject(currentProject.id, {
                        activeResearchTopic: trimmedTopic,
                        activeResearchStartedAt: Date.now(),
                        activeResearchStatus: 'in_progress',
                    });
                } catch (e) {
                    console.error('Failed to persist active research status to storage', e);
                }

                if (onProjectUpdate) {
                    onProjectUpdate({
                        ...currentProject,
                        activeResearchTopic: trimmedTopic,
                        activeResearchStartedAt: Date.now(),
                        activeResearchStatus: 'in_progress',
                    });
                }
            }

            setIsGenerating(true);
            setResearchData(null);
            setUserNotes('');
            setResearchLogs([]);

            addLog('tool', `🕵️‍♀️ Engaging Deep Research Agent for: "${trimmedTopic}"`);
            const shouldRequestLocation = promptHasLocationIntent(trimmedTopic);
            const userLoc = shouldRequestLocation ? await getUserLocation() : null;
            if (shouldRequestLocation) {
                if (userLoc) {
                    addLog('system', `📍 Location acquired: ${userLoc.lat.toFixed(4)}, ${userLoc.lng.toFixed(4)}`);
                } else {
                    addLog('system', '⚠️ Location denied or unavailable. Proceeding with global search.');
                }
            }

            setCurrentActivity('thinking');
            setActivitySummary('Starting research...');

            const projectKnowledgeContext = currentProject
                ? contextService.getKnowledgeBaseForResearch(currentProject, trimmedTopic)
                : undefined;

            if (projectKnowledgeContext) {
                addLog('system', `📚 Loading ${currentProject?.knowledgeBase?.length || 0} knowledge base file(s) for context...`);
            }

            const report = await performDeepResearch(
                trimmedTopic,
                (type, logText) => {
                    // If this deep-research run has been superseded (e.g. user opened
                    // a different session), ignore late log updates.
                    if (!runId || activeRunIdRef.current !== runId) return;

                    addLog(type, logText);
                    const prefix = type === 'thought' ? '[🧠 THINKING]' : '[🛠️ TOOL]';
                    const logEntry = `${prefix} ${logText}`;
                    setResearchLogs(prev => [...prev, logEntry]);

                    const activityType = parseActivityType(logEntry);
                    if (activityType) {
                        setCurrentActivity(activityType);
                        generateActivitySummary(logText, activityType);
                    }
                },
                userLoc || undefined,
                projectKnowledgeContext,
                undefined,
                currentProject?.id,
                currentProject?.ownerUid
            );

            // If this run is no longer the active one, don't overwrite whatever
            // the user is currently viewing.
            if (!runId || activeRunIdRef.current !== runId) {
                return;
            }

            setResearchData(report);
            setCurrentActivity(null);
            setActivitySummary('');

            if (currentProject) {
                const savedSession = await storageService.addResearchToProject(currentProject.id, report);

                // Check for Wiza prospects table and save as an asset
                if ((report as any).wizaProspects?.tableSpec) {
                    try {
                        const wizaData = (report as any).wizaProspects;
                        const tableAsset: any = { // Using any to bypass potential strict typing issues temporarily
                            id: crypto.randomUUID(),
                            type: 'table',
                            title: "Prospects (Wiza)",
                            description: "Enriched prospects table from Wiza research.",
                            columns: wizaData.tableSpec.columns || [],
                            rows: wizaData.tableSpec.rows || [],
                            createdAt: Date.now(),
                            uploadedAt: Date.now(),
                            name: "Prospects (Wiza)",
                            uri: "",
                            mimeType: "application/json",
                            sizeBytes: 0
                        };

                        // Update the session with this new asset
                        const newFiles = [...(savedSession.uploadedFiles || []), tableAsset];
                        await storageService.updateResearchSession(currentProject.id, savedSession.id, { uploadedFiles: newFiles });
                        savedSession.uploadedFiles = newFiles; // Update local object reference
                        addLog('system', `💾 Saved Wiza prospects table to assets.`);
                    } catch (err) {
                        console.error("Failed to save Wiza table asset", err);
                    }
                }

                setCurrentResearchSessionId(savedSession.id);
                setCurrentProjectId(currentProject.id);
                setNoteMapState(savedSession.noteMapState || []);
                setHtmlContent('');
                setIsWaitingForAutoBuild(true);
                setPendingAutoConnect(false);
                addLog('system', `💾 Research saved to project "${currentProject.name}".`);

                if (onResearchCompleted) {
                    try {
                        onResearchCompleted({ projectId: currentProject.id, session: savedSession });
                    } catch (e) {
                        console.error('onResearchCompleted callback failed', e);
                    }
                }

                // Clear active status at the storage level so future loads don't think research is still running
                try {
                    await storageService.updateResearchProject(currentProject.id, {
                        activeResearchTopic: null,
                        activeResearchStartedAt: null,
                        activeResearchStatus: null,
                    });
                } catch (e) {
                    console.error('Failed to clear active research status in storage', e);
                }

                // Immediately merge the new session into the in-memory project so the
                // Project Dashboard Research Library reflects it without relying on a
                // full project reload from storage.
                if (onProjectUpdate) {
                    const existingSessions = currentProject.researchSessions || [];
                    const nextProject = {
                        ...currentProject,
                        researchSessions: [savedSession, ...existingSessions],
                        lastModified: Date.now(),
                        activeResearchTopic: null,
                        activeResearchStartedAt: null,
                        activeResearchStatus: null,
                    };
                    onProjectUpdate(nextProject);
                }
            } else {
                const savedProj = await storageService.saveProject(report);
                setCurrentProjectId(savedProj.id);
                addLog('system', `💾 Report saved to Library (ID: ${savedProj.id.substring(0, 6)}).`);
            }

            addLog('system', `✅ Research Complete. Found ${report.sources?.length || 0} sources.`);

            if (sessionRef.current) {
                try {
                    const session = await sessionRef.current;
                    addLog('system', '📡 Sending research report to Live session...');
                    const fullReportContext = `=== FINAL RESEARCH REPORT (JSON) ===\n${JSON.stringify(report, null, 2)}\n=== END OF REPORT ===\n\nINSTRUCTION:\n1. The research is complete.\n2. The user can now see the report visually on their screen.\n3. Inform the user you have finished and summarize the single most interesting finding.\n4. You now have the FULL CONTEXT of this report. Answer any user questions based on the JSON above.`;

                    audioQueueRef.current = [];
                    setQueuedInputLength(0);

                    await session.sendClientContent({
                        turns: [{ role: 'user', parts: [{ text: fullReportContext }] }],
                        turnComplete: true,
                    });
                } catch (err) {
                    console.error('Failed to send report to Live session:', err);
                }
            }
        } catch (error) {
            console.error(error);
            addLog('system', '❌ Research Failed.');

            // Refund credits if they were deducted
            if (!skipCreditCheck) {
                const cost = creditService.getCreditCost('researchSession');
                await creditService.addCredits(cost);
                addLog('system', `💰 Refunded ${cost} credits due to failure.`);
            }

            // If research fails for a free user, show the Pro subscription modal
            if (!isSubscribed) {
                setUsageLimitModal({
                    isOpen: true,
                    usageType: 'research',
                    current: 0,
                    limit: 0,
                });
            }

            if (currentProject) {
                // Ensure active status is not left stuck in-progress on failure
                try {
                    await storageService.updateResearchProject(currentProject.id, {
                        activeResearchStatus: null,
                        activeResearchTopic: null,
                        activeResearchStartedAt: null,
                    });
                } catch (e) {
                    console.error('Failed to clear active research status in storage after failure', e);
                }

                if (onProjectUpdate) {
                    onProjectUpdate({
                        ...currentProject,
                        activeResearchStatus: null,
                        activeResearchTopic: null,
                        activeResearchStartedAt: null,
                    });
                }
            }
        } finally {
            // Only clear generating state if this run is still the active one.
            if (runId && activeRunIdRef.current === runId) {
                setIsGenerating(false);
                activeRunIdRef.current = null;
            }
        }
    };

    const handleSendText = async () => {
        if (!textInput.trim()) return;
        const text = textInput.trim();
        setTextInput('');
        addLog('user', text);

        // In research mode, treat certain prompts as new deep-research requests, matching dashboard suggestions / Live behavior.
        if (mode === 'researcher') {
            const normalized = text.toLowerCase();
            const looksLikeResearch =
                normalized.startsWith('research ') ||
                normalized.startsWith('deep research ') ||
                normalized.includes(' near me') ||
                normalized.includes(' nearby') ||
                normalized.includes(' near-by') ||
                normalized.includes(' close to me') ||
                normalized.includes(' around me');

            if (looksLikeResearch) {
                let topicForResearch = text;
                if (normalized.startsWith('deep research ')) {
                    topicForResearch = text.slice(13).trim() || text;
                } else if (normalized.startsWith('research ')) {
                    topicForResearch = text.slice(9).trim() || text;
                }

                await startDeepResearchFromPrompt(topicForResearch);
                return;
            }
        }

        // If a Live session is connected, send via the Live API so tools and voice context stay in sync.
        if (connected && sessionRef.current) {
            try {
                const session = await sessionRef.current;
                await session.sendClientContent({
                    turns: [{
                        role: 'user',
                        parts: [{ text }]
                    }],
                    turnComplete: true
                });
            } catch (e) {
                console.error("Failed to send text over live session", e);
                addLog('system', '❌ Message failed to send over live connection.');
            }
            return;
        }

        // Text-only path: when voice is not connected, fall back to a standard Gemini text call
        // using the current research/project context as background.
        try {
            const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });
            const context = getContextData();

            const prompt = context
                ? `You are the research co-pilot inside a research dashboard.\n\n` +
                `Use the following context to answer the user's question, but do not restate it in full unless asked.\n\n` +
                `${context}\n\n` +
                `User question: ${text}`
                : text;

            const response: any = await ai.models.generateContent({
                model: 'gemini-2.5-flash',
                contents: prompt,
                config: {
                    tools: [{ codeExecution: {} }],
                },
            });

            const reply = (response && typeof response.text === 'string') ? response.text.trim() : '';
            if (reply) {
                addLog('tool', reply);
            } else {
                addLog('system', '⚠️ No response generated.');
            }
        } catch (e) {
            console.error('Failed to send text-only message', e);
            addLog('system', '❌ Failed to get a response. Please try again.');
        }
    };

    const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
        const file = e.target.files?.[0];
        if (!file) return;

        if (!connected) {
            alert("Please start the session (Mic button) before uploading files.");
            return;
        }

        addLog('user', `📂 Uploading ${file.name}...`);

        // Reset input immediately
        if (fileInputRef.current) fileInputRef.current.value = '';

        try {
            const session = await sessionRef.current;
            const isImage = file.type.startsWith('image/');
            const isVideo = file.type.startsWith('video/');

            if (isImage) {
                const base64 = await new Promise<string>((resolve, reject) => {
                    const reader = new FileReader();
                    reader.onload = (e) => {
                        const res = e.target?.result as string;
                        const data = res.split(',')[1];
                        resolve(data);
                    };
                    reader.onerror = reject;
                    reader.readAsDataURL(file);
                });

                await session.sendRealtimeInput({
                    media: {
                        mimeType: file.type,
                        data: base64
                    }
                });

                await session.sendClientContent({
                    turns: [{
                        role: 'user',
                        parts: [{ text: `I have sent you an image (${file.name}). Analyze it and suggest how we can use it.` }]
                    }],
                    turnComplete: true
                });
                addLog('system', 'Image sent to Gemini Live.');

            } else {
                // Document OR Video
                const typeLabel = isVideo ? "Video" : "Document";
                addLog('system', `Analyzing ${typeLabel.toLowerCase()} (${file.name})...`);

                const analysis = await analyzeDocument(file);
                addLog('system', `${typeLabel} analysis sent to Gemini.`);

                const modeContext = mode === 'builder'
                    ? "Builder Mode (Building a website)"
                    : "Research Mode (Deep Analysis)";

                const promptText = `USER_EVENT: I uploaded a ${typeLabel.toLowerCase()} (${file.name}).

                                                                                                                ${typeLabel.toUpperCase()} ANALYSIS:
                                                                                                                ${analysis}

                                                                                                                CONTEXT: ${modeContext}.

                                                                                                                YOUR TASK:
                                                                                                                1. Acknowledge receipt of the ${typeLabel.toLowerCase()}.
                                                                                                                2. Explain what you see/read based on the analysis.
                                                                                                                3. Suggest 2 ways to use it for our current task.
                                                                                                                4. Ask how I would like to proceed.`;

                await session.sendClientContent({
                    turns: [{
                        role: 'user',
                        parts: [{ text: promptText }]
                    }],
                    turnComplete: true
                });
            }

        } catch (err) {
            console.error("File upload failed", err);
            addLog('system', '❌ Upload failed. Please try again.');
        }
    };

    const processHtmlImages = async (rawHtml: string) => {
        // 1. First Pass: Inject Placeholders immediately so the user sees structure
        let workingHtml = rawHtml.replace(
            /src="https:\/\/gemini\.image\/generate\?prompt=([^"]+)"/g,
            (match, encodedPrompt) => {
                const prompt = decodeURIComponent(encodedPrompt);
                // Shorten prompt for display text
                const text = encodeURIComponent(prompt.length > 25 ? prompt.substring(0, 25) + '...' : prompt);
                // Use a distinct placeholder pattern we can regex for later, and store the original prompt
                return `src="https://placehold.co/800x600/1f2937/ffffff?text=${text}&font=roboto" data-original-prompt="${encodedPrompt}"`;
            }
        );

        // Update the view immediately with placeholders
        setHtmlContent(workingHtml);

        // Save placeholder version to storage immediately if we have a project
        if (currentProjectId) {
            storageService.updateLatestWebsiteVersion(currentProjectId, workingHtml);
        }

        // 2. Second Pass: Async generation of real images
        // We regex match the ORIGINAL raw string again to find prompts, then replace in the STATE.
        const matches = [...rawHtml.matchAll(/src="https:\/\/gemini\.image\/generate\?prompt=([^"]+)"/g)];

        if (matches.length > 0) {
            addLog('system', `🎨 Generating ${matches.length} images for the website...`);
        }

        // Iterate matches and replace progressively
        for (const match of matches) {
            const encodedPrompt = match[1];
            const prompt = decodeURIComponent(encodedPrompt);

            try {
                let resolvedImageSrc: string | null = null;

                try {
                    resolvedImageSrc = await getPexelsImage(prompt);
                } catch (pexelsErr) {
                    console.warn('Pexels lookup failed, falling back to Gemini image generation', pexelsErr);
                }

                if (!resolvedImageSrc) {
                    const result = await generateImage(prompt);
                    resolvedImageSrc = result.imageDataUrl;
                }

                // Simpler approach with robust regex using the local workingHtml variable to accumulate changes
                const replacementRegex = new RegExp(`src="[^"]+" data-original-prompt="${encodedPrompt.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}"`);

                workingHtml = workingHtml.replace(replacementRegex, `src="${resolvedImageSrc}"`);

                // Update State
                setHtmlContent(workingHtml);

                // Update Storage incrementally so we don't lose images on reload
                if (currentProjectId) {
                    storageService.updateLatestWebsiteVersion(currentProjectId, workingHtml);
                }

            } catch (e) {
                console.error("Failed to resolve image for website", e);
            }
        }

        return workingHtml;
    };

    const handleRefresh = () => {
        if (!htmlContent) return;
        const current = htmlContent;
        setHtmlContent(''); // Unmount
        setTimeout(() => setHtmlContent(current), 50); // Remount
        addLog('system', '🔄 Preview refreshed.');
    };

    // Toggle Mode Handler
    const toggleMode = (targetMode: Mode) => {
        if (connected) {
            disconnect();
        }

        if (targetMode === 'builder') {
            // Switching TO Builder
            setMode('builder');
            // If we have research data, we want to auto-build
            if (researchData) {
                const context = `RESEARCH TOPIC: ${researchData.topic}\nSUMMARY: ${researchData.summary}\nKEY POINTS: ${(researchData.keyPoints || []).map(k => k.title + ': ' + k.details).join('; ')}\nIMPLICATIONS: ${researchData.marketImplications}`;
                setBuilderContext(context);

                if (!htmlContent) {
                    // Only trigger auto-build if no content exists (Persistence Logic)
                    setPendingAutoConnect(true);
                    setIsWaitingForAutoBuild(true);
                    addLog('system', 'Auto-switching to Builder with Research Context...');
                } else {
                    addLog('system', 'Switched to Builder Mode. Content persisted.');
                    setIsWaitingForAutoBuild(false);
                }
            } else {
                setBuilderContext('');
                setIsWaitingForAutoBuild(false);
            }
        } else if (targetMode === 'create') {
            // Switching TO Create
            setMode('create');
            setIsWaitingForAutoBuild(false);

            // Auto-generate only when no creative assets exist yet for this research
            const hasAnyCreativeAssets = !!(
                socialCampaign ||
                blogPost ||
                videoPost ||
                researchData?.socialCampaign ||
                researchData?.blogPost ||
                researchData?.videoPost
            );

            if (researchData && !hasAnyCreativeAssets && !isGeneratingAssets) {
                generateCreativeAssets(researchData);
            }

        } else if (targetMode === 'researcher') {
            // Switching TO Researcher
            setMode('researcher');
            setIsWaitingForAutoBuild(false);
        } else if (targetMode === 'notemap') {
            // Switching TO Note Map
            setMode('notemap');
            setIsWaitingForAutoBuild(false);
        }
    };

    const handleLoadProject = (project: SavedProject, version?: SavedWebsiteVersion) => {
        setMode('researcher');
        setResearchData(project.researchReport);
        setCurrentProjectId(project.id);
        setNoteMapState(project.noteMapState || []);
        setUserNotes(project.researchReport.userNotes || '');
        setSocialCampaign(project.researchReport.socialCampaign || null);
        setBlogPost(project.researchReport.blogPost || null);
        setVideoPost(project.researchReport.videoPost || null);

        if (version) {
            setHtmlContent(version.html);
            setMode('builder');
        } else if (project.websiteVersions.length > 0) {
            setHtmlContent(project.websiteVersions[0].html);
        } else {
            setHtmlContent('');
        }

        setIsWaitingForAutoBuild(!project.websiteVersions.length);
        setShowLibrary(false);
        addLog('system', `📂 Loaded project: ${project.topic}`);
    };

    // Handles all tool calls in a non-blocking way
    const handleToolCall = async (fc: any, sessionPromise: Promise<any>) => {
        isBusyRef.current = true;
        setQueuedInputLength(0);
        const session = await sessionPromise;

        if (fc.name === 'generate_website') {
            const args = fc.args as any;

            if (!(await checkAndDeductCredits('websiteGeneration'))) {
                isBusyRef.current = false;
                await session.sendToolResponse({
                    functionResponses: [{
                        id: fc.id,
                        name: fc.name,
                        response: { error: "Insufficient credits for website generation." }
                    }]
                });
                return;
            }

            setIsWaitingForAutoBuild(false);
            addLog('tool', '🏗️ Spec received. Starting generation pipeline...');
            setIsGenerating(true);
            setShowCode(true);
            setStreamingCode('');
            setHtmlContent('');
            setGenerationStatus('stable');

            await session.sendToolResponse({
                functionResponses: [{
                    id: fc.id,
                    name: fc.name,
                    response: { result: "Starting two-stage generation process: 1. Rapid Prototype (Flash) -> 2. High-Fidelity Experience (Gemini 3 Pro)." }
                }]
            });

            try {
                // --- STEP 1: RAPID PROTOTYPE (Flash) ---
                // Pass the extracted theme to the builder
                addLog('system', '⚡ Stage 1: Generating rapid prototype...');
                setStreamingCode(prev => prev + '// Stage 1: Generating Rapid Prototype (Flash)...\n');
                const v1Html = await streamWebsiteCode(args.specification, researchData?.theme, (chunk) => {
                    setStreamingCode(prev => prev + chunk);
                });
                processHtmlImages(v1Html); // Render V1 immediately

                // Show preview immediately after V1 is done, allowing interaction while V2 generates
                setShowCode(false);

                // --- STEP 2: HIGH-FIDELITY EXPERIENCE (Pro) ---
                addLog('system', '🚀 Stage 2: Enhancing with Gemini 3 Pro (Thinking Mode)...');
                setStreamingCode(prev => prev + '\n\n/* ========================================= */\n/*  SWITCHING TO GEMINI 3 PRO FOR ENHANCEMENT  */\n/*  THINKING: ANALYZING RESEARCH & UX...       */\n/* ========================================= */\n\n');

                // Use builderContext (Research summary) if available, otherwise just the spec.
                const contextForPro = builderContext || args.specification;

                const v2Html = await refineWebsiteCode(
                    v1Html,
                    contextForPro,
                    researchData?.theme, // Pass theme to Pro model
                    (chunk) => setStreamingCode(prev => prev + chunk),
                    (logText) => {
                        addLog('thought', logText);
                        // Inject thought into code stream for visibility in Terminal
                        setStreamingCode(prev => prev + `\n/* 🧠 THINKING: ${logText} */\n`);
                    }
                );

                // Render V2 (Final) and capture the fully processed HTML (with images)
                const finalHtml = await processHtmlImages(v2Html);

                // --- AUTO SAVE WEBSITE ---
                if (currentProject && currentResearchSessionId) {
                    const sessions = currentProject.researchSessions || [];
                    const session = sessions.find(s => s.id === currentResearchSessionId);
                    const existingVersions = session?.websiteVersions || [];

                    const newVersion: SavedWebsiteVersion = {
                        id: crypto.randomUUID(),
                        timestamp: Date.now(),
                        html: finalHtml,
                        description: 'Generated Version',
                    };
                    const updatedVersions = [newVersion, ...existingVersions];

                    try {
                        await storageService.updateResearchInProject(currentProject.id, currentResearchSessionId, {
                            websiteVersions: updatedVersions,
                        });
                        addLog('system', '💾 Website version saved to research session.');
                    } catch (e) {
                        console.error('Failed to save website version to research session', e);
                        addLog('system', '⚠️ Website saved locally but failed to sync to Firestore.');
                    }

                    if (onProjectUpdate) {
                        const updatedSessions = sessions.map(sessionItem =>
                            sessionItem.id === currentResearchSessionId
                                ? { ...sessionItem, websiteVersions: updatedVersions }
                                : sessionItem
                        );

                        onProjectUpdate({
                            ...currentProject,
                            researchSessions: updatedSessions,
                            lastModified: Date.now(),
                        });
                    }
                } else if (currentProjectId) {
                    await storageService.addWebsiteVersion(currentProjectId, finalHtml, 'Generated Version');
                    addLog('system', '💾 Website version saved to Library.');
                } else {
                    // Create a temporary project if none exists - only when not in project context
                    addLog('system', '💾 Website generated (save to project to persist).');
                }

                setGenerationStatus('idle');
                addLog('system', '✅ Experience Generation Complete.');

                await session.sendClientContent({
                    turns: [{ role: 'user', parts: [{ text: `The website has been upgraded to a high-fidelity experience using Gemini 3 Pro. Ask the user what they think of this custom digital experience.\n\n=== GENERATED CODE CONTEXT ===\n${v2Html.substring(0, 10000)}...` }] }],
                    turnComplete: true,
                });

            } catch (e) {
                console.error("Build Pipeline Error", e);
                setGenerationStatus('failed');
                addLog('system', '❌ Build Failed during generation pipeline.');
                await session.sendClientContent({
                    turns: [{ role: 'user', parts: [{ text: "The build pipeline encountered an error. Inform the user." }] }],
                    turnComplete: true,
                });
            } finally {
                setIsGenerating(false);
            }

        } else if (fc.name === 'edit_website') {
            const args = fc.args as any;

            if (!(await checkAndDeductCredits('websiteGeneration'))) {
                isBusyRef.current = false;
                await session.sendToolResponse({
                    functionResponses: [{
                        id: fc.id,
                        name: fc.name,
                        response: { error: "Insufficient credits for website edit." }
                    }]
                });
                return;
            }
            const instruction = (args?.instruction || '').trim();

            if (!htmlContent) {
                addLog('system', '⚠️ Cannot edit website because no code is loaded. Ask me to generate a site first.');
                await session.sendToolResponse({
                    functionResponses: [{
                        id: fc.id,
                        name: fc.name,
                        response: { error: "No existing website code to edit. Generate a site first, then ask for edits." }
                    }]
                });
                isBusyRef.current = false;
                return;
            }

            setIsWaitingForAutoBuild(false);
            setIsGenerating(true);
            setShowCode(true);
            setStreamingCode('');
            setGenerationStatus('stable');
            addLog('tool', '🛠️ Applying targeted edit to existing website...');

            await session.sendToolResponse({
                functionResponses: [{
                    id: fc.id,
                    name: fc.name,
                    response: { result: `Editing existing website to: ${instruction || 'apply requested changes'}` }
                }]
            });

            try {
                const parts: string[] = [];

                if (builderContext) {
                    parts.push(`BUILDER_CONTEXT:\n${builderContext}`);
                }
                if (researchData?.summary) {
                    parts.push(`RESEARCH_SUMMARY:\n${researchData.summary}`);
                } else if (researchData?.tldr) {
                    parts.push(`RESEARCH_TLDR:\n${researchData.tldr}`);
                }
                if (instruction) {
                    parts.push(`EDIT_INSTRUCTION:\n${instruction}\n\nYou must keep the existing layout, sections, IDs, data attributes, and JS behavior. Only make the minimal HTML/CSS changes needed to satisfy the instruction.`);
                }

                const contextForEdit =
                    parts.join('\n\n') ||
                    instruction ||
                    'Apply a small, targeted edit to this page while preserving its structure.';

                const updatedHtml = await refineWebsiteCode(
                    htmlContent,
                    contextForEdit,
                    researchData?.theme,
                    (chunk) => setStreamingCode(prev => prev + chunk),
                    (logText) => {
                        addLog('thought', logText);
                        setStreamingCode(prev => prev + `\n/* 🧠 THINKING: ${logText} */\n`);
                    }
                );

                const finalHtml = await processHtmlImages(updatedHtml);
                setHtmlContent(finalHtml);

                if (currentProject && currentResearchSessionId) {
                    const sessions = currentProject.researchSessions || [];
                    const sessionItem = sessions.find(s => s.id === currentResearchSessionId);
                    const existingVersions = sessionItem?.websiteVersions || [];

                    const newVersion: SavedWebsiteVersion = {
                        id: crypto.randomUUID(),
                        timestamp: Date.now(),
                        html: finalHtml,
                        description: 'Edited Version',
                    };

                    const updatedVersions = [newVersion, ...existingVersions];

                    try {
                        await storageService.updateResearchInProject(currentProject.id, currentResearchSessionId, {
                            websiteVersions: updatedVersions,
                        });
                        addLog('system', '💾 Edited website version saved to research session.');
                    } catch (e) {
                        console.error('Failed to save edited website version to research session', e);
                        addLog('system', '⚠️ Edited website saved locally but failed to sync to Firestore.');
                    }

                    if (onProjectUpdate) {
                        const updatedSessions = sessions.map((sessionItemInner) =>
                            sessionItemInner.id === currentResearchSessionId
                                ? { ...sessionItemInner, websiteVersions: updatedVersions }
                                : sessionItemInner
                        );

                        onProjectUpdate({
                            ...currentProject,
                            researchSessions: updatedSessions,
                            lastModified: Date.now(),
                        });
                    }
                } else if (currentProjectId) {
                    await storageService.addWebsiteVersion(currentProjectId, finalHtml, 'Edited Version');
                    addLog('system', '💾 Edited website version saved to Library.');
                }

                setGenerationStatus('idle');
                addLog('system', '✅ Website updated with requested changes.');
            } catch (e) {
                console.error('Edit pipeline error', e);
                setGenerationStatus('failed');
                addLog('system', '❌ Failed to apply website edit.');
                await session.sendToolResponse({
                    functionResponses: [{
                        id: fc.id,
                        name: fc.name,
                        response: { error: "Edit pipeline failed while applying changes to the website." }
                    }]
                });
            } finally {
                setIsGenerating(false);
            }

        } else if (fc.name === 'generate_research_report') {
            const args = fc.args as any;

            if (!(await checkAndDeductCredits('researchSession'))) {
                isBusyRef.current = false;
                await session.sendToolResponse({
                    functionResponses: [{
                        id: fc.id,
                        name: fc.name,
                        response: { error: "Insufficient credits for research session." }
                    }]
                });
                return;
            }

            addLog('tool', `🕵️‍♀️ Engaging Deep Research Agent for: "${args.topic}"`);
            setResearchData(null);
            setUserNotes('');
            setResearchLogs([]);

            // 1. Send IMMEDIATE tool response to keep the conversation flowing.
            await session.sendToolResponse({
                functionResponses: [{
                    id: fc.id,
                    name: fc.name,
                    response: { result: "AGENTS_DEPLOYED. Research initiated. Stand by for incoming report data stream via System Message." }
                }]
            });

            // 2. Kick off the shared deep research pipeline used by text-only / auto-start.
            // Pass true to skip credit check since we already deducted above
            startDeepResearchFromPrompt(args.topic, true);
            return;

        } else if (fc.name === 'switch_to_builder') {
            const args = fc.args as any;
            addLog('tool', '🔄 Received request to switch to Builder Mode.');
            setBuilderContext(args.researchContext || '');
            addLog('system', 'Switching to Builder Mode with research context...');
            disconnect();

            setMode('builder');
            // Only trigger a fresh build if we don't already have HTML persisted
            if (!htmlContent) {
                setHtmlContent('');
                setIsWaitingForAutoBuild(true);
                setPendingAutoConnect(true);
            } else {
                setIsWaitingForAutoBuild(false);
                setPendingAutoConnect(false);
            }

            isBusyRef.current = false; // Manually reset for this path
            return;

            // ========== NEW APP CONTROL TOOL HANDLERS ==========

        } else if (fc.name === 'toggle_dark_mode') {
            const args = fc.args as any;
            const targetMode = args?.mode || 'toggle';

            if (toggleTheme) {
                if ((targetMode === 'dark' && !isDarkMode) ||
                    (targetMode === 'light' && isDarkMode) ||
                    targetMode === 'toggle') {
                    toggleTheme();
                }
            }

            const newMode = targetMode === 'toggle' ? (isDarkMode ? 'light' : 'dark') : targetMode;
            addLog('tool', `🌓 Theme switched to ${newMode} mode`);

            await session.sendToolResponse({
                functionResponses: [{
                    id: fc.id,
                    name: fc.name,
                    response: { result: `Theme changed to ${newMode} mode.` }
                }]
            });

        } else if (fc.name === 'switch_tab') {
            const args = fc.args as any;
            const targetTab = args.tab?.toLowerCase() as Mode;

            if (['researcher', 'builder', 'notemap', 'create'].includes(targetTab)) {
                disconnect(); // Disconnect current session
                setMode(targetTab);
                if (targetTab === 'builder') {
                    if (!htmlContent) {
                        setIsWaitingForAutoBuild(true);
                        setPendingAutoConnect(true);
                    } else {
                        setIsWaitingForAutoBuild(false);
                        setPendingAutoConnect(false);
                    }
                } else {
                    setPendingAutoConnect(true); // Will auto-reconnect in new mode
                }
                addLog('tool', `📑 Switching to ${targetTab} tab`);

                await session.sendToolResponse({
                    functionResponses: [{
                        id: fc.id,
                        name: fc.name,
                        response: { result: `Switched to ${targetTab} tab. Reconnecting voice session...` }
                    }]
                });
            } else {
                await session.sendToolResponse({
                    functionResponses: [{
                        id: fc.id,
                        name: fc.name,
                        response: { error: `Unknown tab: ${targetTab}. Available: researcher, builder, notemap, create` }
                    }]
                });
            }
            isBusyRef.current = false;
            return;

        } else if (fc.name === 'open_library') {
            setShowLibrary(true);
            addLog('tool', '📚 Library opened');

            await session.sendToolResponse({
                functionResponses: [{
                    id: fc.id,
                    name: fc.name,
                    response: { result: "Library panel is now open. The user can see their saved projects and research reports." }
                }]
            });

        } else if (fc.name === 'close_library') {
            setShowLibrary(false);
            addLog('tool', '📚 Library closed');

            await session.sendToolResponse({
                functionResponses: [{
                    id: fc.id,
                    name: fc.name,
                    response: { result: "Library panel is now closed." }
                }]
            });

        } else if (fc.name === 'scroll_to_section') {
            const args = fc.args as any;
            const sectionId = args.section?.toLowerCase() || '';

            // Map common names to actual section IDs
            const sectionMap: Record<string, string> = {
                'summary': 'research-summary',
                'executive': 'executive-summary',
                'analysis': 'deep-analysis',
                'slides': 'presentation-slides',
                'financials': 'financial-data',
                'financial': 'financial-data',
                'timeline': 'historical-timeline',
                'history': 'historical-timeline',
                'sources': 'verified-sources',
                'references': 'verified-sources',
                'dynamic': 'dynamic-sections',
                'widgets': 'dynamic-sections',
                'game': 'fun-zone',
                'fun': 'fun-zone',
                'play': 'fun-zone',
                'videos': 'video-intelligence',
                'video': 'video-intelligence',
                'youtube': 'video-intelligence',
                'top': 'research-header',
                'beginning': 'research-header',
            };

            const targetId = sectionMap[sectionId] || sectionId;
            const element = document.getElementById(targetId);

            if (element) {
                element.scrollIntoView({ behavior: 'smooth', block: 'start' });
                addLog('tool', `📍 Scrolled to: ${sectionId}`);

                await session.sendToolResponse({
                    functionResponses: [{
                        id: fc.id,
                        name: fc.name,
                        response: { result: `Scrolled to the ${sectionId} section. The user can now see this content.` }
                    }]
                });
            } else {
                // Try to find by partial match in section titles
                const allSections = document.querySelectorAll('[id^="section-"], [id^="dynamic-"]');
                let found = false;

                allSections.forEach((el) => {
                    if (el.textContent?.toLowerCase().includes(sectionId)) {
                        el.scrollIntoView({ behavior: 'smooth', block: 'start' });
                        found = true;
                    }
                });

                await session.sendToolResponse({
                    functionResponses: [{
                        id: fc.id,
                        name: fc.name,
                        response: { result: found ? `Scrolled to section matching "${sectionId}".` : `Could not find section "${sectionId}". Available sections: summary, analysis, slides, financials, timeline, sources, game, videos.` }
                    }]
                });
            }

        } else if (fc.name === 'play_game') {
            // Scroll to game section and expand it
            const gameSection = document.getElementById('fun-zone');
            if (gameSection) {
                gameSection.scrollIntoView({ behavior: 'smooth', block: 'start' });
                setExpandedSections(prev => ({ ...prev, funZone: true }));
                addLog('tool', '🎮 Opening game section');
            }

            await session.sendToolResponse({
                functionResponses: [{
                    id: fc.id,
                    name: fc.name,
                    response: { result: researchData?.funSection ? "Game section opened! The user can now play the interactive educational game." : "No game available yet. Complete a research first to generate an educational game." }
                }]
            });

        } else if (fc.name === 'toggle_code_view') {
            const args = fc.args as any;
            const action = args?.show || 'toggle';

            if (action === 'code') {
                setShowCode(true);
            } else if (action === 'preview') {
                setShowCode(false);
            } else {
                setShowCode(prev => !prev);
            }

            addLog('tool', `💻 ${action === 'toggle' ? 'Toggled' : 'Switched to'} ${showCode ? 'preview' : 'code'} view`);

            await session.sendToolResponse({
                functionResponses: [{
                    id: fc.id,
                    name: fc.name,
                    response: { result: `Switched to ${showCode ? 'preview' : 'code'} view.` }
                }]
            });

        } else if (fc.name === 'toggle_fullscreen') {
            setIsFullscreen(prev => !prev);
            addLog('tool', `🖥️ Fullscreen ${isFullscreen ? 'disabled' : 'enabled'}`);

            await session.sendToolResponse({
                functionResponses: [{
                    id: fc.id,
                    name: fc.name,
                    response: { result: `Fullscreen mode ${isFullscreen ? 'disabled' : 'enabled'}.` }
                }]
            });

        } else if (fc.name === 'toggle_section') {
            const args = fc.args as any;
            const section = args.section?.toLowerCase() || '';
            const action = args.action || 'toggle';

            const sectionKeyMap: Record<string, string> = {
                'analysis': 'analysis',
                'timeline': 'timeline',
                'sources': 'sources',
                'financials': 'financials',
                'financial': 'financials',
                'videos': 'videos',
                'video': 'videos',
                'slides': 'slides',
                'game': 'funZone',
                'fun': 'funZone',
            };

            const key = sectionKeyMap[section];
            if (key) {
                setExpandedSections(prev => ({
                    ...prev,
                    [key]: action === 'expand' ? true : action === 'collapse' ? false : !prev[key as keyof typeof prev]
                }));
                addLog('tool', `📂 ${action} ${section} section`);
            }

            await session.sendToolResponse({
                functionResponses: [{
                    id: fc.id,
                    name: fc.name,
                    response: { result: key ? `${section} section ${action}ed.` : `Unknown section: ${section}` }
                }]
            });

        } else if (fc.name === 'start_new_research') {
            setResearchData(null);
            setBuilderContext('');
            setUserNotes('');
            addLog('tool', '🔄 Cleared research, ready for new topic');

            await session.sendToolResponse({
                functionResponses: [{
                    id: fc.id,
                    name: fc.name,
                    response: { result: "Research cleared. Ready for a new topic. Ask the user what they would like to research next." }
                }]
            });

        } else if (fc.name === 'save_work') {
            const args = fc.args as any;
            const customName = args?.name;

            if (researchData && currentProjectId) {
                // Already saved via auto-save
                addLog('tool', '💾 Work already saved to library');
                await session.sendToolResponse({
                    functionResponses: [{
                        id: fc.id,
                        name: fc.name,
                        response: { result: "Work is already saved to the library. The user can access it anytime from the Library panel." }
                    }]
                });
            } else if (researchData) {
                const projectId = storageService.createProject(researchData.topic, researchData);
                setCurrentProjectId(projectId);
                addLog('tool', '💾 Research saved to library');
                await session.sendToolResponse({
                    functionResponses: [{
                        id: fc.id,
                        name: fc.name,
                        response: { result: `Research saved to library${customName ? ` as "${customName}"` : ''}. The user can access it from the Library panel.` }
                    }]
                });
            } else {
                await session.sendToolResponse({
                    functionResponses: [{
                        id: fc.id,
                        name: fc.name,
                        response: { result: "No research to save yet. Complete a research first." }
                    }]
                });
            }

        } else if (fc.name === 'get_user_location') {
            addLog('tool', '🌍 Requesting user location...');
            try {
                const loc = await getUserLocation();
                if (loc) {
                    addLog('system', `📍 Location acquired: ${loc.lat.toFixed(4)}, ${loc.lng.toFixed(4)}`);
                    await session.sendToolResponse({
                        functionResponses: [{
                            id: fc.id,
                            name: fc.name,
                            response: {
                                result: "success",
                                latitude: loc.lat,
                                longitude: loc.lng,
                                message: "Location acquired successfully. You can now use this for local searches."
                            }
                        }]
                    });
                } else {
                    addLog('system', '⚠️ User denied location or it is unavailable.');
                    await session.sendToolResponse({
                        functionResponses: [{
                            id: fc.id,
                            name: fc.name,
                            response: { error: "Location permission denied or unavailable." }
                        }]
                    });
                }
            } catch (e) {
                console.error("Location tool error", e);
                await session.sendToolResponse({
                    functionResponses: [{
                        id: fc.id,
                        name: fc.name,
                        response: { error: "Failed to retrieve location." }
                    }]
                });
            }
            isBusyRef.current = false;

        } else if (fc.name === 'describe_screen') {
            let description = `Current Mode: ${mode}. `;

            if (mode === 'researcher') {
                if (researchData) {
                    description += `Viewing research report on "${researchData.topic}". `;
                    description += `Sections visible: Summary, Analysis, ${researchData.slides ? 'Slides, ' : ''}`;

                    const hasFinancials = researchData.dynamicSections?.some(s => ['metric_card_grid', 'tradingview_chart', 'stats'].includes(s.type));
                    const hasTimeline = researchData.dynamicSections?.some(s => s.type === 'timeline');

                    description += `${hasFinancials ? 'Financial Data, ' : ''}`;
                    description += `${hasTimeline ? 'Timeline, ' : ''}`;
                    description += `${researchData.dynamicSections?.length ? `${researchData.dynamicSections.length} Dynamic Widgets, ` : ''}`;
                    description += `${researchData.funSection ? 'Interactive Game, ' : ''}`;
                    description += `Sources.`;
                } else {
                    description += `No research loaded. Ready to start a new research topic.`;
                }
            } else if (mode === 'builder') {
                description += htmlContent ? `Website preview is showing. ` : `No website built yet. `;
                description += showCode ? `Code editor is visible.` : `Preview mode is active.`;
            } else if (mode === 'notemap') {
                description += `Mind map view with ${noteMapState.length} note nodes.`;
            } else if (mode === 'create') {
                description += `Content creation mode for social media and blog posts.`;
            }

            description += ` Theme: ${isDarkMode ? 'Dark' : 'Light'} mode.`;

            addLog('tool', '👁️ Describing screen');

            await session.sendToolResponse({
                functionResponses: [{
                    id: fc.id,
                    name: fc.name,
                    response: { result: description }
                }]
            });

        } else if (fc.name === 'zoom') {
            const args = fc.args as any;
            const action = args.action;

            // This would require a zoom state - for now just acknowledge
            addLog('tool', `🔍 Zoom ${action}`);

            await session.sendToolResponse({
                functionResponses: [{
                    id: fc.id,
                    name: fc.name,
                    response: { result: `Zoom ${action} applied.` }
                }]
            });

        } else if (fc.name === 'copy_content') {
            const args = fc.args as any;
            const what = args.what?.toLowerCase() || 'summary';

            let textToCopy = '';

            if (what === 'code' && htmlContent) {
                textToCopy = htmlContent;
            } else if (what === 'summary' && researchData) {
                textToCopy = researchData.summary;
            } else if (what === 'all' && researchData) {
                textToCopy = JSON.stringify(researchData, null, 2);
            }

            if (textToCopy) {
                try {
                    await navigator.clipboard.writeText(textToCopy);
                    addLog('tool', `📋 Copied ${what} to clipboard`);
                    await session.sendToolResponse({
                        functionResponses: [{
                            id: fc.id,
                            name: fc.name,
                            response: { result: `${what} copied to clipboard successfully.` }
                        }]
                    });
                } catch (e) {
                    await session.sendToolResponse({
                        functionResponses: [{
                            id: fc.id,
                            name: fc.name,
                            response: { error: "Failed to copy to clipboard. Browser may have blocked the action." }
                        }]
                    });
                }
            } else {
                await session.sendToolResponse({
                    functionResponses: [{
                        id: fc.id,
                        name: fc.name,
                        response: { error: `No ${what} available to copy.` }
                    }]
                });
            }
        }

        // Un-busy the ref once the tool *response* is sent, not waiting for the promise to resolve.
        setTimeout(() => {
            // Only flush audio if we didn't just clear it explicitly (like in research report)
            if (audioQueueRef.current.length > 0) {
                sessionPromise.then(s => {
                    for (const blob of audioQueueRef.current) {
                        s.sendRealtimeInput({ media: blob });
                    }
                    audioQueueRef.current = [];
                    setQueuedInputLength(0);
                });
            }
            isBusyRef.current = false;
        }, 100);
    };

    // Helper to build context string from all available state
    const getContextData = () => {
        let context = "";

        // Include project-level context if available (all research sessions, notes, tasks)
        if (currentProject) {
            const projectContext = contextService.buildProjectContext(currentProject);
            context += `\n=== PROJECT-LEVEL CONTEXT ===\n`;
            context += projectContext.projectSummary;

            // Add summary of other research sessions (excluding current one)
            if (currentProject.researchSessions && currentProject.researchSessions.length > 1) {
                const otherSessions = currentProject.researchSessions
                    // Guard against malformed / partial sessions
                    .filter(session => {
                        if (!session || !session.topic || !session.researchReport) return false;
                        if (!researchData) return true;
                        return session.researchReport.topic !== researchData.topic;
                    })
                    .slice(0, 3);

                if (otherSessions.length > 0) {
                    context += `\n--- Related Research in Project ---\n`;
                    otherSessions.forEach((session, index) => {
                        const report = session.researchReport;
                        const summarySnippet =
                            report?.tldr?.substring(0, 200) ||
                            report?.summary?.substring(0, 200) ||
                            'No summary';

                        context += `${index + 1}. "${session.topic}": ${summarySnippet}...\n`;
                    });
                }
            }

            // Add project notes context
            if (projectContext.notesContext) {
                context += projectContext.notesContext;
            }

            // Add project tasks context
            if (projectContext.tasksContext) {
                context += projectContext.tasksContext;
            }
        }

        if (researchData) {
            context += `\n\n=== CURRENT RESEARCH REPORT AVAILABLE ===\n`;
            context += `Topic: ${researchData.topic}\n`;
            context += `Summary: ${researchData.summary}\n`;
            // Video Intelligence
            if (researchData.videoAnalysis) {
                context += `Video Intelligence: ${researchData.videoAnalysis.title} - ${researchData.videoAnalysis.analysis.substring(0, 300)}...\n`;
            }
            // Interactive sections
            if (researchData.funSection) {
                context += `Interactive Game: Available in 'Fun Zone'. (HTML Game Content Available)\n`;
            }
            if (researchData.dynamicSections) {
                context += `Dynamic Sections Present: ${researchData.dynamicSections.map(d => d.title + ' (' + d.type + ')').join(', ')}\n`;
            }
            // User Scratchpad Notes
            if (userNotes) {
                context += `\nUSER SCRATCHPAD NOTES: ${userNotes}\n`;
            }
            // Truncate JSON if huge
            context += `Full JSON Content: ${JSON.stringify(researchData).substring(0, 15000)}\n`;
        }

        if (noteMapState.length > 0) {
            const simpleNodes = noteMapState.map(n => ({ title: n.title, content: n.content }));
            context += `\n\n=== CURRENT NOTE MAP NODES ===\n${JSON.stringify(simpleNodes, null, 2).substring(0, 10000)}\n`;
        }

        if (htmlContent) {
            context += `\n\n=== CURRENT BUILDER CODE ===\n${htmlContent.substring(0, 20000)}\n`;
        }

        return context;
    };

    const connect = async () => {
        try {
            // Try to acquire user location for this Live session so "near me" queries work better.
            // MODIFIED: Location is now requested on-demand via tool call, not automatically at start.
            let liveLocation: { lat: number; lng: number } | null = null;
            /*
            try {
                addLog('system', '🌍 Requesting geolocation for Gemini Live...');
                liveLocation = await getUserLocation();
                if (liveLocation) {
                    addLog('system', `📍 Live location: ${liveLocation.lat.toFixed(4)}, ${liveLocation.lng.toFixed(4)}`);
                } else {
                    addLog('system', '⚠️ Live location unavailable. Using global context for searches.');
                }
            } catch (locError) {
                console.warn('Live geolocation error', locError);
            }
            */

            const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });

            const outputCtx = new (window.AudioContext || (window as any).webkitAudioContext)({ sampleRate: 24000 });
            const inputCtx = new (window.AudioContext || (window as any).webkitAudioContext)({ sampleRate: 16000 });
            audioContextRef.current = outputCtx;
            inputContextRef.current = inputCtx;
            const outputNode = outputCtx.createGain();
            outputNode.connect(outputCtx.destination);

            const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
            mediaStreamRef.current = stream;

            const isResearch = mode === 'researcher';
            const isNoteMap = mode === 'notemap';
            const isCreate = mode === 'create';

            // DYNAMICALLY BUILD CONTEXT
            const appStateContext = getContextData();

            let systemInstruction = `You are an elite AI assistant.`;

            if (isResearch) {
                systemInstruction = `You are an elite Deep Research Analyst with full app control capabilities.
          
          **YOUR ROLE**: Conduct rigorous, multi-step research on complex topics.
          **GOAL**: Uncover trends, data points, and market implications with high accuracy and depth.
          
          **CRITICAL PROTOCOL**:
          1. When a user specifies a research topic, you MUST call the \`generate_research_report\` tool immediately.
          2. The tool will acknowledge start.
          3. WAIT. When the research is done, you will receive a message starting with "=== FINAL RESEARCH REPORT ===".
          4. YOU MUST READ AND MEMORIZE THAT REPORT.
          5. Use that report to answer ALL subsequent user questions.

          **LOCATION-AWARE DEEP RESEARCH TOPICS**:
          - If the user says things like "research ... near me", "do deep research on ... near me", or similar (for example: "research printing shops near me"):
            * ALWAYS treat this as a full deep-research topic.
            * You MUST call \`generate_research_report\` with a topic that includes their approximate location (e.g. "printing shops near Scarborough Toronto"), not just a single \`googleSearch\` call.
            * You MAY optionally use \`googleSearch\` to gather seed URLs, but you still MUST run \`generate_research_report\` so the full report, maps, and widgets are produced.
          - Only for quick, one-off local lookups that are clearly NOT deep research (for example: "what coffee shops are near me right now?") may you answer using \`googleSearch\` alone.
          - When in doubt, prefer starting deep research via \`generate_research_report\`.
          
          **APP CONTROL CAPABILITIES** (Use these tools when the user asks):
          - \`scroll_to_section\`: Navigate to specific sections: "summary", "analysis", "slides", "financials", "timeline", "sources", "game", "videos", "dynamic" (widgets)
          - \`toggle_dark_mode\`: Switch between light/dark themes
          - \`switch_tab\`: Navigate to tabs: "researcher", "builder", "notemap", "create"
          - \`open_library\` / \`close_library\`: Show/hide the saved projects library
          - \`play_game\`: Open the educational game section
          - \`toggle_section\`: Expand/collapse report sections
          - \`start_new_research\`: Clear current research for a new topic
          - \`save_work\`: Save current research to library
          - \`describe_screen\`: Describe what's currently visible
          - \`copy_content\`: Copy content to clipboard
          
          **NAVIGATION EXAMPLES**:
          - User: "Show me the sources" → Call scroll_to_section with section="sources"
          - User: "Go to the timeline" → Call scroll_to_section with section="timeline"
          - User: "Switch to dark mode" → Call toggle_dark_mode with mode="dark"
          - User: "Take me to the game" → Call play_game
          - User: "Go to the builder" → Call switch_tab with tab="builder"
          
          **TONE**: Professional, analytical, precise. emphasizing the depth of your sources.
          
          ${appStateContext}`;

                const locationContext = liveLocation
                    ? `\n\n**USER LOCATION**: The user has granted geolocation permission. They are approximately at latitude ${liveLocation.lat.toFixed(
                        4
                    )}, longitude ${liveLocation.lng.toFixed(
                        4
                    )}. When the user says "near me" or "nearby", interpret that relative to this location and prefer local, up-to-date results when calling tools or starting new research.`
                    : `\n\n**USER LOCATION**: Geolocation is not available for this session. When the user says "near me", explain that you do not know their exact location and ask them to specify a city, neighborhood, or region before you search. OR, you can call the \`get_user_location\` tool to request permission.`;

                systemInstruction += `

                                                                                                                    **LOCATION-AWARE QUERIES**:
                                                                                                                    - When the user asks to "search locations near me" or similar, you should either:
                                                                                                                    * Treat it as a new research topic and call \`generate_research_report\` with an appropriate topic, OR
                                                                                                                    * Use the \`googleSearch\` tool with a query that includes their rough location.
                                                                                                                    - Always clearly explain what you're doing ("I'll run a quick local search near you...").
                                                                                                                    ${locationContext}
                                                                                                                    `;
            } else if (isNoteMap) {
                systemInstruction = `You are a Creative Knowledge Partner assisting with a visual mind map.
         
         **CONTEXT**: The user is viewing a "Note Map" where research concepts are visual nodes.
         **YOUR ROLE**: Help the user brainstorm connections between these notes.
         
         **CAPABILITIES**:
         1. **Fuse**: Drag one note onto another to fuse them into a new insight.
         2. **Branch**: You can branch existing nodes into sub-topics.
         3. **Add**: The user can create blank notes to fill in.
         
         **APP CONTROL** (Use when asked):
         - \`toggle_dark_mode\`: Switch themes (dark/light)
         - \`switch_tab\`: Navigate: "researcher", "builder", "notemap", "create"
         - \`open_library\` / \`close_library\`: Show/hide saved projects
         - \`save_work\`: Save current work
         
         ${appStateContext}
         `;
            } else if (isCreate) {
                systemInstruction = `You are a Social Media Strategist and Content Editor.
          
          **CONTEXT**: The user is in the 'Create' tab.
          **YOUR ROLE**: 
          1. Help the user refine the social media posts (Instagram, LinkedIn, Twitter/X) generated from the research.
          2. Help the user edit or expand the generated Blog Article.
          
          **APP CONTROL** (Use when asked):
          - \`toggle_dark_mode\`: Switch themes (dark/light)
          - \`switch_tab\`: Navigate: "researcher", "builder", "notemap", "create"
          - \`open_library\` / \`close_library\`: Show/hide saved projects
          - \`save_work\`: Save current work
          - \`copy_content\`: Copy content to clipboard
          
          ${appStateContext}
          `;
            } else {
                // Builder Mode
                systemInstruction = `You are an elite Digital Architect and Investigative Journalist.
         
          **YOUR ROLE: ARCHITECT**
          You research, plan, and design. You do NOT manually type large blocks of HTML into the editor. Instead you delegate changes to tools:
          - \`generate_website\` for initial builds or full redesigns.
          - \`edit_website\` for small, targeted edits to the existing page.

          **PROCESS**:
          1. **Analyze Request**: Identify what the user wants to build.
          2. **Quick Scan (Optional)**: Use [googleSearch] if you need real-world data or design inspiration for the specific topic.
          3. **Build Phase**: Call \`generate_website\` with a detailed technical spec.
          
          **QA RULES**:
          - Use \`onclick="showView('id')"\` for navigation.
          - Use \`https://gemini.image/generate?prompt=...\` for images.
          - Ensure the site is a Single Page Application (SPA).
          
          **APP CONTROL** (Use when asked):
          - \`toggle_dark_mode\`: Switch themes (dark/light)
          - \`switch_tab\`: Navigate: "researcher", "builder", "notemap", "create"
          - \`open_library\` / \`close_library\`: Show/hide saved projects
          - \`toggle_code_view\`: Switch between code editor and preview
          - \`toggle_fullscreen\`: Toggle fullscreen mode
          - \`save_work\`: Save current work
          - \`copy_content\`: Copy code to clipboard
          
          ${appStateContext}
          `;

                if (builderContext) {
                    systemInstruction += `\n\n[IMPORTANT] RESEARCH CONTEXT:\n${builderContext}`;

                    if (!htmlContent) {
                        systemInstruction += `\n\nYOUR TASK: The user wants to build a website based on this research IMMEDIATELY.
                
                **CRITICAL INSTRUCTION**:
                1. You must call the \`generate_website\` tool RIGHT NOW.
                2. Create a detailed website specification that is HIGHLY RELEVANT and THEMATIC to the Research Context.
                3. If the research is about Space, build a Space-themed site. If it's about Finance, build a Fintech dashboard.
                4. Do NOT ask for confirmation. Just build it.
                `;
                    } else {
                        systemInstruction += `\n\nYOUR TASK: The user has already built a website based on this research.
                 - If the user asks for changes and a site already exists, prefer the \`edit_website\` tool to make small, targeted edits. Only use \`generate_website\` for major redesigns or when the user explicitly asks to rebuild from scratch.
                 - Use the research context to answer questions or add relevant content if requested.
                 `;
                    }
                } else {
                    // FRESH START IN BUILDER MODE
                    systemInstruction += `\n\nYOUR TASK: You are in "Builder Mode".
             - The user will ask you to create a website, app, or dashboard.
             - If they provide a topic (e.g. "Build a website for a sushi restaurant"), you should:
               1. Optionally perform a quick Google Search to get ideas or data if the topic is real-world (e.g. "Apple Stock price", "Sushi menu trends").
               2. IMMEDIATELY call the \`generate_website\` tool with a comprehensive specification.
             - **Do NOT** wait for "Deep Research". Just build it.
             `;
                }
            }

            // App control tools available in ALL modes
            const getUserLocationTool: FunctionDeclaration = {
                name: "get_user_location",
                description: "Request the user's current physical location (latitude/longitude). ONLY use this if the user asks for 'near me' or location-specific information.",
            };

            const appControlTools = [
                toggleDarkModeTool,
                switchTabTool,
                openLibraryTool,
                closeLibraryTool,
                scrollToSectionTool,
                playGameTool,
                toggleCodeViewTool,
                toggleFullscreenTool,
                toggleSectionTool,
                startNewResearchTool,
                saveWorkTool,
                describeScreenTool,
                zoomTool,
                copyContentTool,
                getUserLocationTool,
            ];

            const tools = isResearch
                ? [
                    { googleSearch: {} },
                    { functionDeclarations: [generateResearchReportTool, switchToBuilderTool, ...appControlTools] },
                ]
                : (isNoteMap || isCreate
                    ? [{ functionDeclarations: appControlTools }]
                    : [{ googleSearch: {} }, { functionDeclarations: [generateWebsiteTool, editWebsiteTool, ...appControlTools] }]);

            const sessionPromise = ai.live.connect({
                model: 'gemini-2.5-flash-native-audio-preview-09-2025',
                config: {
                    responseModalities: [Modality.AUDIO],
                    systemInstruction,
                    tools,
                    outputAudioTranscription: {},
                    inputAudioTranscription: {},
                    speechConfig: {
                        voiceConfig: { prebuiltVoiceConfig: { voiceName: 'Zephyr' } },
                    },
                    thinkingConfig: {
                        includeThoughts: true,
                        thinkingBudget: 16384,
                    },
                    contextWindowCompression: { slidingWindow: {} },
                    realtimeInputConfig: {
                        automaticActivityDetection: {
                            disabled: false,
                            startOfSpeechSensitivity: StartSensitivity.START_SENSITIVITY_LOW,
                            endOfSpeechSensitivity: EndSensitivity.END_SENSITIVITY_LOW,
                            prefixPaddingMs: 20,
                            silenceDurationMs: 500,
                        }
                    }
                },
                callbacks: {
                    onopen: () => {
                        console.log("Session Opened");
                        setConnected(true);
                        addLog('system', `Connected: ${mode.toUpperCase()} Mode`);

                        // SEND RESEARCH CONTEXT TO LIVE SESSION
                        // If research is in progress or completed, inform the session about it.
                        // This should work both for freshly-started deep research (initialResearchTopic)
                        // and for previously saved reports opened from the dashboard (researchData only).
                        if (mode === 'researcher') {
                            sessionPromise.then(session => {
                                if (isGenerating && initialResearchTopic) {
                                    // Research is currently in progress
                                    addLog('system', '\ud83d\udcf1 Syncing Live session with in-progress research...');
                                    session.sendClientContent({
                                        turns: [{
                                            role: 'user',
                                            parts: [{
                                                text: `CONTEXT: Deep research is currently in progress for topic: "${initialResearchTopic}". The user can see the research logs on screen. You will receive the full report when it completes. In the meantime, you can answer general questions or help the user with other tasks.`
                                            }]
                                        }],
                                        turnComplete: true,
                                    });
                                } else if (researchData) {
                                    // Research already completed (either just finished, or loaded from the dashboard)
                                    addLog('system', '\ud83d\udcf1 Syncing Live session with completed research...');
                                    const fullReportContext =
                                        `=== FINAL RESEARCH REPORT (JSON) ===\n${JSON.stringify(researchData, null, 2)}\n=== END OF REPORT ===\n\nINSTRUCTION:\n` +
                                        `1. The research is complete.\n` +
                                        `2. The user can now see the report visually on their screen.\n` +
                                        `3. Inform the user you have finished and summarize the single most interesting finding.\n` +
                                        `4. You now have the FULL CONTEXT of this report. Answer any user questions based on the JSON above.`;

                                    session.sendClientContent({
                                        turns: [{ role: 'user', parts: [{ text: fullReportContext }] }],
                                        turnComplete: true,
                                    });
                                }
                            });
                        }

                        // AUTOMATIC BUILD TRIGGER
                        if (mode === 'builder' && builderContext && !htmlContent) {
                            addLog('system', '⚡ Sending Build Trigger to Agent...');
                            sessionPromise.then(session => {
                                session.sendClientContent({
                                    turns: [{
                                        role: 'user',
                                        parts: [{ text: "SYSTEM_TRIGGER: The user has switched to Builder Mode. The Research Context is provided in your System Instructions. Proceed immediately to creating the website specification and calling the generate_website tool." }]
                                    }],
                                    turnComplete: true
                                });
                            });
                        }

                        const source = inputCtx.createMediaStreamSource(stream);
                        const scriptProcessor = inputCtx.createScriptProcessor(4096, 1, 1);

                        scriptProcessor.onaudioprocess = (e) => {
                            const inputData = e.inputBuffer.getChannelData(0);
                            const pcmBlob = createPcmBlob(inputData);

                            if (isBusyRef.current) {
                                audioQueueRef.current.push(pcmBlob);
                                setQueuedInputLength(prev => prev + 1);
                            } else {
                                sessionPromise.then(session => session.sendRealtimeInput({ media: pcmBlob }));
                            }
                        };

                        source.connect(scriptProcessor);
                        scriptProcessor.connect(inputCtx.destination);
                    },
                    onmessage: async (msg: LiveServerMessage) => {
                        const { serverContent, toolCall } = msg;
                        const clientContent = (msg as any).clientContent;

                        // Accumulate user input transcription so we can log what the user said
                        const inputText = clientContent?.inputTranscription?.text || serverContent?.inputTranscription?.text;
                        if (inputText) {
                            setUserTranscriptBuffer(prev => prev + inputText);
                        }

                        // When the user turn is complete, commit the buffered input as a user log
                        if (clientContent?.turnComplete) {
                            setUserTranscriptBuffer(prev => {
                                const trimmed = prev.trim();
                                if (trimmed) {
                                    addLog('user', trimmed);
                                }
                                return '';
                            });
                        }

                        if (serverContent?.interrupted) {
                            sourcesRef.current.forEach(s => s.stop());
                            sourcesRef.current.clear();
                            nextStartTimeRef.current = 0;
                            setIsSpeaking(false);
                            addLog('system', '🎙️ Gemini paused.');
                        }

                        // Accumulate model output transcription so we can log spoken answers
                        if (serverContent?.outputTranscription?.text) {
                            const text = serverContent.outputTranscription.text;
                            setAssistantTranscriptBuffer(prev => prev + text);
                        }

                        // When the model turn completes, flush the transcript buffer into a single model log
                        if (serverContent?.turnComplete) {
                            setAssistantTranscriptBuffer(prev => {
                                const trimmed = prev.trim();
                                if (trimmed) {
                                    addLog('model', trimmed);
                                }
                                return '';
                            });
                        }

                        // Handle audio playback (keep existing behavior)
                        const base64Audio = serverContent?.modelTurn?.parts?.[0]?.inlineData?.data;
                        if (base64Audio && audioContextRef.current) {
                            setIsSpeaking(true);
                            const ctx = audioContextRef.current;
                            nextStartTimeRef.current = Math.max(nextStartTimeRef.current, ctx.currentTime);

                            const audioBuffer = await decodeAudioData(decode(base64Audio), ctx, 24000, 1);
                            const source = ctx.createBufferSource();
                            source.buffer = audioBuffer;
                            source.connect(outputNode);

                            source.addEventListener('ended', () => {
                                sourcesRef.current.delete(source);
                                if (sourcesRef.current.size === 0) setIsSpeaking(false);
                            });

                            source.start(nextStartTimeRef.current);
                            nextStartTimeRef.current += audioBuffer.duration;
                            sourcesRef.current.add(source);
                        }

                        // Preserve "thinking" logs for tool reasoning
                        const parts = serverContent?.modelTurn?.parts || [];
                        for (const part of parts) {
                            if (part.thought && part.text && part.text.length > 5) {
                                addLog('thought', part.text);
                            }
                        }

                        if (toolCall) {
                            for (const fc of toolCall.functionCalls) {
                                handleToolCall(fc, sessionPromise);
                            }
                        }
                    },
                    onclose: () => setConnected(false),
                    onerror: (err) => {
                        console.error(err);
                        setConnected(false);
                    }
                }
            });
            sessionRef.current = sessionPromise;
        } catch (e) {
            console.error(e);
            alert('Failed to connect.');
        }
    };

    const disconnect = () => {
        if (audioContextRef.current) {
            audioContextRef.current.close();
            audioContextRef.current = null;
        }
        if (inputContextRef.current) {
            inputContextRef.current.close();
            inputContextRef.current = null;
        }
        if (mediaStreamRef.current) {
            mediaStreamRef.current.getTracks().forEach(track => track.stop());
            mediaStreamRef.current = null;
        }
        if (sessionRef.current) {
            sessionRef.current.then(session => {
                if (session.close) session.close();
            });
            sessionRef.current = null;
        }
        setConnected(false);
        setIsSpeaking(false);
    };

    // Logic to determine if terminal should be shown
    const showTerminal =
        (mode === 'builder' && (
            isWaitingForAutoBuild ||
            (isGenerating && !htmlContent) ||
            (showCode && !!streamingCode)
        )) ||
        (mode === 'researcher' && isGenerating && !researchData);

    const showIdle = !showTerminal && !isGenerating && !isGeneratingAssets && !socialCampaign && !blogPost && (
        (mode === 'builder' && !htmlContent) ||
        (mode === 'researcher' && !researchData)
    );

    const handleGenerateReel = async () => {
        if (!researchData || !currentProject || !currentProject.id) return;

        if (!(await checkAndDeductCredits('videoClipGeneration'))) return;

        try {
            setIsGeneratingReel(true);

            const topic = researchData.topic || 'Research Insight';
            const summary = researchData.summary || researchData.tldr || '';
            const keyPoints = Array.isArray((researchData as any).keyPoints) ? (researchData as any).keyPoints : [];

            const primaryPointTitle = keyPoints[0]?.title || '';
            const baseCaption = summary
                ? `${summary.split('.').slice(0, 1).join('.').trim()}${summary.includes('.') ? '.' : ''}`
                : primaryPointTitle || topic;

            const topicTag = `#${topic.replace(/[^a-zA-Z0-9]+/g, '').toLowerCase()}`;
            const pointTags = keyPoints
                .slice(0, 3)
                .map((p: any) => `#${String(p.title || '')
                    .split(' ')
                    .slice(0, 2)
                    .join('')
                    .replace(/[^a-zA-Z0-9]+/g, '')
                    .toLowerCase()}`)
                .filter(Boolean);

            const hashtags = [topicTag, ...pointTags].join(' ').trim();

            const soraPrompt = `Create a cinematic 12-second vertical (9:16) social media video reel for TikTok/Instagram Reels based on this research.

                                                                                                                    Topic: ${topic}

                                                                                                                    Summary: ${summary || '(summary unavailable)'}

                                                                                                                    Focus on dynamic motion, bold typography, and visually engaging shots that would work with this caption and hashtags:

                                                                                                                    Caption: ${baseCaption}
                                                                                                                    Hashtags: ${hashtags || '#research'}

                                                                                                                    The video should loop cleanly, feel modern and premium, and avoid adding any on-screen UI or watermarks.`;
            const contextDescription = `Topic: ${topic}
                                                                                                                    Summary: ${summary || '(summary unavailable)'}
                                                                                                                    Caption: ${baseCaption}
                                                                                                                    Hashtags: ${hashtags || '#research'}`;

            try {
                const job = await createVideoFromText({
                    model: 'sora-2',
                    prompt: soraPrompt,
                    seconds: '12',
                    size: '720x1280'
                });

                const finalJob = await pollVideoUntilComplete(job.id, () => { }, 5000);
                if (finalJob.status !== 'completed') {
                    throw new Error(finalJob.error?.message || `Video job ended with status: ${finalJob.status}`);
                }

                const blob = await downloadVideoBlob(finalJob.id, 'video');
                const file = new File([blob], `reel-${Date.now()}.mp4`, { type: 'video/mp4' });
                const kbFile = await storageService.uploadKnowledgeBaseFile(currentProject.id, file, currentResearchSessionId || undefined);

                setReelVideoUrl(kbFile.url);
                setReelCaption(baseCaption);
                setReelHashtags(hashtags || '#research');
                setVideoPost({
                    videoUrl: kbFile.url,
                    caption: baseCaption,
                    hashtags: hashtags || '#research',
                    provider: 'sora',
                });
            } catch (soraError: any) {
                console.error('Failed to generate video reel via Sora, falling back to Veo 3.1 then Creatomate:', soraError);

                // Veo 3.1 fallback
                try {
                    const veoBlob = await generateVeoVideo(soraPrompt, '9:16', 'quality', {});
                    const veoFile = new File([veoBlob], `reel-veo-${Date.now()}.mp4`, { type: 'video/mp4' });
                    const kbFile = await storageService.uploadKnowledgeBaseFile(currentProject.id, veoFile, currentResearchSessionId || undefined);

                    setReelVideoUrl(kbFile.url);
                    setReelCaption(baseCaption);
                    setReelHashtags(hashtags || '#research');
                    setVideoPost({
                        videoUrl: kbFile.url,
                        caption: baseCaption,
                        hashtags: hashtags || '#research',
                        provider: 'veo',
                    });
                    return;
                } catch (veoError) {
                    console.error('Veo fallback for reel failed, falling back to Creatomate:', veoError);
                }

                // Creatomate fallback
                const fallback = await createVoiceoverVideoWithCreatomate({
                    prompt: soraPrompt,
                    voiceoverPrompt: baseCaption || summary || topic,
                    aspect: '720x1280',
                    durationSeconds: 12,
                    contextDescription,
                });

                const res = await fetch(fallback.url);
                const blob = await res.blob();
                const file = new File([blob], `reel-creatomate-${Date.now()}.mp4`, { type: 'video/mp4' });
                const kbFile = await storageService.uploadKnowledgeBaseFile(currentProject.id, file, currentResearchSessionId || undefined);

                setReelVideoUrl(kbFile.url);
                setReelCaption(baseCaption);
                setReelHashtags(hashtags || '#research');
                setVideoPost({
                    videoUrl: kbFile.url,
                    caption: baseCaption,
                    hashtags: hashtags || '#research',
                    provider: 'creatomate',
                });
            }
        } catch (error) {
            console.error('Failed to generate video reel:', error);
        } finally {
            setIsGeneratingReel(false);
        }
    };

    // Helper to determine activity type from log text
    const parseActivityType = (logText: string): 'thinking' | 'searching' | 'reading' | 'stock' | 'crypto' | 'jobs' | 'video' | 'game' | null => {
        const text = logText.toLowerCase();
        // Check for game generation first (more specific)
        if (text.includes('generating interactive game') || text.includes('game module') || text.includes('🎮')) {
            return 'game';
        }
        // Check for video analysis
        if (text.includes('video intelligence') || text.includes('analyzing video') || text.includes('video analysis') || text.includes('🎥') || text.includes('youtube')) {
            return 'video';
        }
        // Check for thinking
        if (text.includes('[🧠 thinking]') || text.includes('thinking')) {
            return 'thinking';
        }
        // Check for crypto price (before general crypto check)
        if (text.includes('fetching crypto price') || text.includes('get_crypto_price')) {
            return 'crypto';
        }
        // Check for stock price
        if (text.includes('fetching stock price') || text.includes('get_stock_price') || text.includes('fetching stock')) {
            return 'stock';
        }
        // Check for jobs
        if (text.includes('searching for remote jobs') || text.includes('search_remote_jobs')) {
            return 'jobs';
        }
        // Check for reading
        if (text.includes('reading source') || text.includes('read source') || text.includes('urlcontext')) {
            return 'reading';
        }
        // Check for searching
        if (text.includes('running search') || text.includes('search:')) {
            return 'searching';
        }
        return null;
    };

    // Helper to generate activity summary using gemini-3.1-flash-lite-preview
    const generateActivitySummary = async (logText: string, activityType: string) => {
        try {
            const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });
            const prompt = `Based on this research activity log, provide a single, concise, friendly sentence summarizing what's happening right now. Keep it under 15 words and make it sound natural and engaging:

                                                                                                                    "${logText}"

                                                                                                                    Activity type: ${activityType}

                                                                                                                    Respond with ONLY the summary sentence, nothing else.`;

            const response = await ai.models.generateContent({
                model: "gemini-3.1-flash-lite-preview",
                contents: prompt,
            });

            const summary = response.text?.trim() || '';
            if (summary) {
                setActivitySummary(summary);
            }
        } catch (error) {
            console.error('Failed to generate activity summary:', error);
            // Fallback summary
            const fallbackSummaries: Record<string, string> = {
                thinking: 'Analyzing the research topic...',
                searching: 'Searching the web for information...',
                reading: 'Reading sources and gathering insights...',
                stock: 'Fetching real-time stock market data...',
                crypto: 'Getting latest cryptocurrency prices...',
                jobs: 'Finding relevant job opportunities...',
                video: 'Analyzing video content for insights...',
                game: 'Creating an interactive game module...',
            };
            setActivitySummary(fallbackSummaries[activityType] || 'Processing research...');
        }
    };

    // Helper to format research logs nicely
    const formatResearchLog = (log: string) => {
        // HANDLE PHASE HEADERS
        if (log.includes('[PHASE 1]') || log.includes('[PHASE 2]') || log.includes('[PHASE 1.5]') || log.includes('[PHASE 1.8]')) {
            const cleanText = log.replace('[🛠️ TOOL]', '').trim();
            return (
                <div className="py-6 border-y border-white/10 my-4 bg-white/5 -mx-4 px-8">
                    <div className="flex items-center gap-3">
                        <span className="relative flex h-3 w-3">
                            <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75"></span>
                            <span className="relative inline-flex rounded-full h-3 w-3 bg-emerald-500"></span>
                        </span>
                        <span className="text-sm font-bold text-white tracking-widest uppercase glow-text">
                            {cleanText}
                        </span>
                    </div>
                </div>
            );
        }

        if (log.startsWith('[🧠 THINKING]')) {
            const content = log.replace('[🧠 THINKING]', '').trim();
            return (
                <div className="relative pl-8 pb-8 border-l border-white/10 last:border-0 last:pb-0 group">
                    <div className="absolute -left-[5px] top-0 w-2.5 h-2.5 rounded-full bg-[#1a1a1a] border border-purple-500/50 shadow-[0_0_10px_rgba(168,85,247,0.2)] group-hover:bg-purple-500/20 transition-colors"></div>
                    <span className="block text-[10px] font-bold text-purple-500/50 uppercase tracking-widest mb-1 group-hover:text-purple-400 transition-colors">Thinking Process</span>
                    <p className="text-gray-400 font-light leading-relaxed font-mono text-xs">{content}</p>
                </div>
            );
        }
        if (log.startsWith('[🛠️ TOOL]')) {
            const content = log.replace('[🛠️ TOOL]', '').trim();
            return (
                <div className="relative pl-8 pb-8 border-l border-white/10 last:border-0 last:pb-0 group">
                    <div className="absolute -left-[5px] top-0 w-2.5 h-2.5 rounded-full bg-[#1a1a1a] border border-blue-500/50 shadow-[0_0_10px_rgba(59,130,246,0.2)] group-hover:bg-blue-500/20 transition-colors"></div>
                    <span className="block text-[10px] font-bold text-blue-500/50 uppercase tracking-widest mb-1 group-hover:text-blue-400 transition-colors">System Action</span>
                    <p className="text-white font-medium leading-relaxed font-mono text-xs">{content}</p>
                </div>
            );
        }
        return <div className="text-gray-500 py-1 font-mono text-xs pl-8">{log}</div>;
    };

    return (
        <div className="relative w-full h-full bg-neutral-100 overflow-hidden font-sans">

            {/* LIBRARY COMPONENT */}
            {!isShareView && (
                <Library
                    isOpen={showLibrary}
                    onClose={() => setShowLibrary(false)}
                    onLoadProject={handleLoadProject}
                    isDarkMode={isDarkMode}
                />
            )}

            {/* 1. VIEWPORT: Handles all visual output */}
            <div className="absolute inset-0 z-0 bg-white">

                {/* TOP LEFT ACTIONS (Grouped Copy & Theme) */}
                <div className="absolute top-4 left-4 md:top-6 md:left-6 z-30 flex items-center gap-2 md:gap-3">

                    {/* 0. BACK TO DASHBOARD BUTTON */}
                    {onBackToDashboard && (
                        <button
                            onClick={onBackToDashboard}
                            title="Back to Project Dashboard"
                            className={`w-10 h-10 md:w-12 md:h-12 flex items-center justify-center rounded-full transition-all shadow-xl backdrop-blur-md border ${(mode === 'researcher' && !isDarkMode && !activeTheme)
                                ? 'bg-white/80 border-black/5 text-black hover:bg-white shadow-sm'
                                : 'bg-black/40 border-white/10 text-white hover:bg-black/60 shadow-sm'
                                }`}
                            style={activeTheme ? { borderColor: activeTheme.secondary, backgroundColor: activeTheme.surface, color: activeTheme.text } : {}}
                        >
                            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M10 19l-7-7m0 0l7-7m-7 7h18" />
                            </svg>
                        </button>
                    )}

                    {/* 1b. SHARE BUTTON (desktop/tablet only) */}
                    {!isShareView && mode === 'researcher' && researchData && (
                        <button
                            onClick={handleShare}
                            title="Copy Share Link"
                            className={`flex w-10 h-10 md:w-12 md:h-12 items-center justify-center rounded-full transition-all shadow-xl backdrop-blur-md border ${shareFeedback
                                ? 'bg-emerald-500 text-white border-emerald-400'
                                : (!isDarkMode && !activeTheme)
                                    ? 'bg-white/80 border-black/5 text-black hover:bg-white shadow-sm'
                                    : 'bg-black/40 border-white/10 text-white hover:bg-black/60 shadow-sm'
                                }`}
                            style={activeTheme ? { borderColor: activeTheme.secondary, backgroundColor: activeTheme.surface, color: activeTheme.text } : {}}
                        >
                            {shareFeedback ? (
                                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M5 13l4 4L19 7"></path></svg>
                            ) : (
                                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M13.828 10.172a4 4 0 015.656 5.656l-1.414 1.414a4 4 0 01-5.656 0M10.172 13.828a4 4 0 01-5.656-5.656l1.414-1.414a4 4 0 015.656 0" />
                                </svg>
                            )}
                        </button>
                    )}

                    {/* 1. COPY BUTTON (desktop/tablet only) */}
                    {!isShareView && ((mode === 'builder' && htmlContent) || (mode === 'researcher' && researchData)) && (
                        <button
                            onClick={handleCopy}
                            title={mode === 'builder' ? 'Copy Code' : 'Copy Report'}
                            className={`flex w-10 h-10 md:w-12 md:h-12 items-center justify-center rounded-full transition-all shadow-xl backdrop-blur-md border ${copyFeedback
                                ? 'bg-emerald-500 text-white border-emerald-400'
                                : (mode === 'researcher' && !isDarkMode && !activeTheme)
                                    ? 'bg-white/80 border-black/5 text-black hover:bg-white shadow-sm'
                                    : 'bg-black/40 border-white/10 text-white hover:bg-black/60 shadow-sm'
                                }`}
                            style={activeTheme ? { borderColor: activeTheme.secondary, backgroundColor: activeTheme.surface, color: activeTheme.text } : {}}
                        >
                            {copyFeedback ? (
                                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M5 13l4 4L19 7"></path></svg>
                            ) : (
                                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M8 5H6a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2v-1M8 5a2 2 0 002 2h2a2 2 0 002-2M8 5a2 2 0 012-2h2a2 2 0 012 2m-6 9l2 2 4-4"></path></svg>
                            )}
                        </button>
                    )}

                    {/* 2. SHOW CODE BUTTON */}
                    {htmlContent && mode === 'builder' && (
                        <button
                            onClick={() => setShowCode(!showCode)}
                            title={showCode ? "Show Preview" : "Show Code"}
                            className={`w-10 h-10 md:w-12 md:h-12 flex items-center justify-center rounded-full transition-all shadow-xl backdrop-blur-md border relative ${showCode
                                ? 'bg-white text-black border-white/20' // Active state
                                : (isDarkMode ? 'bg-black/40 border-white/10 text-white hover:bg-black/60' : 'bg-white/80 border-black/5 text-black hover:bg-white')
                                }`}
                        >
                            {isGenerating && !showCode && (
                                <span className="absolute top-0 right-0 flex h-3 w-3 -mt-1 -mr-1">
                                    <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75"></span>
                                    <span className="relative inline-flex rounded-full h-3 w-3 bg-emerald-500"></span>
                                </span>
                            )}
                            {/* Icons */}
                            {showCode ? (
                                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="w-5 h-5">
                                    <path d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
                                    <path d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" />
                                </svg>
                            ) : (
                                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="w-5 h-5">
                                    <path d="M10 20l4-16m4 4l4 4-4 4M6 16l-4-4 4-4" strokeLinecap="round" strokeLinejoin="round" />
                                </svg>
                            )}
                        </button>
                    )}

                    {/* 3. REFRESH PREVIEW BUTTON */}
                    {htmlContent && mode === 'builder' && (
                        <button
                            onClick={handleRefresh}
                            title="Refresh Preview"
                            className={`w-10 h-10 md:w-12 md:h-12 flex items-center justify-center rounded-full border transition-all backdrop-blur-md shadow-xl ${isDarkMode
                                ? 'bg-black/40 border-white/10 text-white hover:bg-black/60'
                                : 'bg-white/80 border-black/5 text-black hover:bg-white'
                                }`}
                        >
                            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="w-5 h-5">
                                <path strokeLinecap="round" strokeLinejoin="round" d="M16.023 9.348h4.992v-.001M2.985 19.644v-4.992m0 0h4.992m-4.993 0l3.181 3.183a8.25 8.25 0 0013.803-3.7M4.031 9.865a8.25 8.25 0 0113.803-3.7l3.181 3.182m0-4.991v4.99" />
                            </svg>
                        </button>
                    )}

                    {/* 4. THEME TOGGLE */}
                    {mode === 'researcher' && researchData && toggleTheme && (
                        <button
                            onClick={toggleTheme}
                            className={`w-10 h-10 md:w-12 md:h-12 flex items-center justify-center rounded-full border transition-all backdrop-blur-md shadow-xl ${isDarkMode
                                ? 'bg-black/40 border-white/10 text-white hover:bg-black/60'
                                : 'bg-white/80 border-black/5 text-black hover:bg-white'
                                }`}
                            style={activeTheme ? { borderColor: activeTheme.secondary, backgroundColor: activeTheme.surface, color: activeTheme.text } : {}}
                            title={isDarkMode ? "Switch to Light Mode" : "Switch to Dark Mode"}
                        >
                            {isDarkMode ? '☀️' : '🌙'}
                        </button>
                    )}
                </div>

                {/* VIEW A: WEBSITE PREVIEW */}
                {mode === 'builder' && htmlContent && !showTerminal && (
                    <iframe
                        srcDoc={htmlContent}
                        className="w-full h-full border-0"
                        title="Preview"
                        sandbox="allow-scripts allow-same-origin"
                    />
                )}

                {/* VIEW B: RESEARCH REPORT - Apple-Style Minimal Design */}
                {mode === 'researcher' && researchData && (
                    <div
                        className={`w-full h-full overflow-y-auto relative transition-colors duration-500 pt-[10px] md:pt-0 ${isDarkMode ? 'bg-[#000000] text-white selection:bg-white/20' : 'bg-[#fafafa] text-gray-900 selection:bg-black/10'}`}
                        style={activeTheme ? { backgroundColor: activeTheme.background, color: activeTheme.text } : {}}
                    >
                        {/* Subtle Ambient Background */}
                        <div className="fixed inset-0 z-0 pointer-events-none overflow-hidden">
                            {reportHeaderImage && (
                                <div
                                    className="absolute top-0 left-1/2 -translate-x-1/2 w-[1200px] h-[800px] transition-opacity duration-1000"
                                    style={{
                                        backgroundImage: `url(${reportHeaderImage})`,
                                        backgroundSize: 'cover',
                                        backgroundPosition: 'center',
                                        filter: 'blur(150px) saturate(1.5)',
                                        opacity: isDarkMode ? 0.15 : 0.25,
                                        transform: 'translateX(-50%) scale(1.5)'
                                    }}
                                />
                            )}
                            {/* Gradient overlay for depth */}
                            <div
                                className="absolute inset-0"
                                style={{
                                    background: isDarkMode
                                        ? 'radial-gradient(ellipse at top, transparent 0%, #000000 70%)'
                                        : 'radial-gradient(ellipse at top, transparent 0%, #fafafa 70%)'
                                }}
                            />
                        </div>

                        <div className="relative z-10 max-w-4xl mx-auto px-6 md:px-8 py-12 md:py-16 lg:py-20 pb-48 space-y-12 animate-fade-in">
                            {/* 1. Header & TL;DR - Hero Section */}
                            <div className="space-y-8">
                                {/* Meta Pills - Minimal Style */}
                                <div className="flex items-center gap-2.5 flex-wrap">
                                    <span
                                        className="px-3.5 py-1.5 rounded-full text-[11px] font-semibold uppercase tracking-[0.1em]"
                                        style={{
                                            background: activeTheme?.primary || '#0071e3',
                                            color: '#fff'
                                        }}
                                    >
                                        Research
                                    </span>
                                    <span
                                        className={`px-3 py-1.5 rounded-full text-[11px] font-medium ${isDarkMode ? 'bg-white/[0.06] text-white/60' : 'bg-black/[0.04] text-black/50'
                                            }`}
                                    >
                                        {researchData.sources?.length || 0} Sources
                                    </span>
                                    {researchData.category && (
                                        <span
                                            className={`px-3 py-1.5 rounded-full text-[11px] font-medium ${isDarkMode ? 'bg-white/[0.06] text-white/60' : 'bg-black/[0.04] text-black/50'
                                                }`}
                                        >
                                            {researchData.category}
                                        </span>
                                    )}
                                </div>

                                {/* Title - Clean Apple Typography */}
                                <h1
                                    className="text-[32px] sm:text-[40px] md:text-[48px] lg:text-[56px] font-semibold tracking-tight leading-[1.1]"
                                    style={{
                                        color: activeTheme?.primary || (isDarkMode ? '#ffffff' : '#1d1d1f')
                                    }}
                                >
                                    {researchData.topic}
                                </h1>

                                {/* Report Header Image - Clean Frame */}
                                {reportHeaderImage && (
                                    <div
                                        className="w-full aspect-[16/9] md:aspect-[2.2/1] rounded-2xl overflow-hidden animate-fade-in relative group"
                                        style={{
                                            boxShadow: isDarkMode
                                                ? '0 20px 60px -20px rgba(0,0,0,0.6)'
                                                : '0 20px 60px -20px rgba(0,0,0,0.15)'
                                        }}
                                    >
                                        <img
                                            src={reportHeaderImage}
                                            alt="Report Header"
                                            className="w-full h-full object-cover transition-transform duration-700 group-hover:scale-[1.02]"
                                        />
                                    </div>
                                )}

                                {/* TL;DR Card - Minimal Glass */}
                                {researchData.tldr && (
                                    <GlassCard isDarkMode={isDarkMode} theme={activeTheme} className="p-6 md:p-8" intensity="medium" glow>
                                        <div className="flex items-center justify-between gap-3 mb-4">
                                            <div className="flex items-center gap-2.5">
                                                <div
                                                    className="w-7 h-7 rounded-lg flex items-center justify-center"
                                                    style={{
                                                        background: `${activeTheme?.primary || '#0071e3'}15`
                                                    }}
                                                >
                                                    <svg className="w-3.5 h-3.5" style={{ color: activeTheme?.primary || '#0071e3' }} fill="currentColor" viewBox="0 0 20 20">
                                                        <path d="M9.049 2.927c.3-.921 1.603-.921 1.902 0l1.07 3.292a1 1 0 00.95.69h3.462c.969 0 1.371 1.24.588 1.81l-2.8 2.034a1 1 0 00-.364 1.118l1.07 3.292c.3.921-.755 1.688-1.54 1.118l-2.8-2.034a1 1 0 00-1.175 0l-2.8 2.034c-.784.57-1.838-.197-1.539-1.118l1.07-3.292a1 1 0 00-.364-1.118L2.98 8.72c-.783-.57-.38-1.81.588-1.81h3.461a1 1 0 00.951-.69l1.07-3.292z" />
                                                    </svg>
                                                </div>
                                                <h3
                                                    className="text-[12px] font-semibold uppercase tracking-[0.12em]"
                                                    style={{ color: activeTheme?.primary || (isDarkMode ? '#86868b' : '#6b7280') }}
                                                >
                                                    Summary
                                                </h3>
                                            </div>

                                            <button
                                                type="button"
                                                onClick={async () => {
                                                    if (!researchData) return;
                                                    const audioEl = summaryAudioRef.current;
                                                    if (!audioEl) return;

                                                    if (isPlayingSummaryAudio) {
                                                        try { audioEl.pause(); } catch { }
                                                        setIsPlayingSummaryAudio(false);
                                                        return;
                                                    }

                                                    if (summaryAudioUrl) {
                                                        try {
                                                            const p = audioEl.play();
                                                            if (p && typeof (p as any).catch === 'function') {
                                                                (p as Promise<void>).catch(() => undefined);
                                                            }
                                                            setIsPlayingSummaryAudio(true);
                                                        } catch {
                                                            setIsPlayingSummaryAudio(false);
                                                        }
                                                        return;
                                                    }

                                                    if (isGeneratingSummaryAudio) return;
                                                    setIsGeneratingSummaryAudio(true);
                                                    try {
                                                        const textToRead =
                                                            (researchData as any).narrationScript ||
                                                            (researchData as any).expandedSummary ||
                                                            researchData.summary ||
                                                            researchData.tldr ||
                                                            '';
                                                        const audio = await generateSingleSpeakerAudio(textToRead, 'Kore', 'clearly and professionally');
                                                        const mimeType = audio.mimeType || 'audio/wav';
                                                        const audioBlob = base64ToBlob(audio.audioData, mimeType);
                                                        const url = URL.createObjectURL(audioBlob);
                                                        setSummaryAudioUrl(url);

                                                        audioEl.src = url;
                                                        audioEl.currentTime = 0;
                                                        const p = audioEl.play();
                                                        if (p && typeof (p as any).catch === 'function') {
                                                            (p as Promise<void>).catch(() => undefined);
                                                        }
                                                        setIsPlayingSummaryAudio(true);
                                                    } catch (e) {
                                                        console.error('Failed to generate summary audio', e);
                                                        setIsPlayingSummaryAudio(false);
                                                    } finally {
                                                        setIsGeneratingSummaryAudio(false);
                                                    }
                                                }}
                                                disabled={isGeneratingSummaryAudio}
                                                className={`shrink-0 w-9 h-9 rounded-full flex items-center justify-center transition-all ${isGeneratingSummaryAudio
                                                    ? isDarkMode
                                                        ? 'bg-white/10 text-white/40 cursor-wait'
                                                        : 'bg-black/5 text-black/30 cursor-wait'
                                                    : isDarkMode
                                                        ? 'bg-white/10 hover:bg-white/15 text-white'
                                                        : 'bg-black/5 hover:bg-black/10 text-black'
                                                    }`}
                                                title={isPlayingSummaryAudio ? 'Pause summary' : 'Play summary'}
                                            >
                                                {isGeneratingSummaryAudio ? (
                                                    <svg className="w-4 h-4 animate-spin" viewBox="0 0 24 24">
                                                        <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" fill="none"></circle>
                                                        <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"></path>
                                                    </svg>
                                                ) : isPlayingSummaryAudio ? (
                                                    <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 24 24">
                                                        <path d="M6 5h4v14H6V5zm8 0h4v14h-4V5z" />
                                                    </svg>
                                                ) : (
                                                    <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 24 24">
                                                        <path d="M8 5v14l11-7z" />
                                                    </svg>
                                                )}
                                            </button>
                                        </div>

                                        <audio ref={summaryAudioRef} className="hidden" preload="none" />
                                        <p
                                            className="text-[17px] md:text-[19px] font-normal leading-[1.6]"
                                            style={{ color: activeTheme?.text || (isDarkMode ? '#e5e5e5' : '#1d1d1f') }}
                                        >
                                            {researchData.tldr}
                                        </p>
                                    </GlassCard>
                                )}

                                {/* SLIDESHOW COMPONENT */}
                                {researchData.slides && researchData.slides.length > 0 && (
                                    <div className="animate-fade-in">
                                        <Slideshow
                                            slides={researchData.slides}
                                            isDarkMode={isDarkMode}
                                            theme={activeTheme}
                                            onUpdateSlide={handleUpdateSlideImage}
                                        />
                                    </div>
                                )}

                                {/* Full Summary - Clean Typography */}
                                <div className="prose prose-lg max-w-none">
                                    <p
                                        className="text-base md:text-lg leading-[1.8] font-light"
                                        style={{ color: activeTheme?.text || (isDarkMode ? '#9ca3af' : '#4b5563'), opacity: 0.9 }}
                                    >
                                        {researchData.summary}
                                    </p>
                                </div>

                                {/* Job Board: only for clearly career-related topics with job listings */}
                                {researchData.jobListings && researchData.jobListings.length > 0 && isCareerTopic(researchData.topic) && (
                                    <div className="mt-10">
                                        <JobBoardRenderer
                                            initialJobs={researchData.jobListings}
                                            topic={researchData.topic}
                                            isDarkMode={isDarkMode}
                                            theme={activeTheme}
                                        />
                                    </div>
                                )}


                            </div>

                            {/* 2. DYNAMIC SECTIONS - Seamless Glassmorphic Design */}
                            {(() => {
                                const topicWidgetHtml = (researchData as any).topicWidget as string | undefined;
                                const hasSwot = !!researchData.dynamicSections?.some(s => s?.type === 'swot_analysis');
                                let topicWidgetInserted = false;

                                return researchData.dynamicSections?.map((section, idx) => {
                                    const shouldInsertTopicWidget =
                                        !!topicWidgetHtml &&
                                        hasSwot &&
                                        !topicWidgetInserted &&
                                        section?.type === 'swot_analysis';

                                    if (shouldInsertTopicWidget) {
                                        topicWidgetInserted = true;
                                    }

                                    return (
                                        <React.Fragment key={idx}>
                                            {shouldInsertTopicWidget && (
                                                <div className="animate-fade-in">
                                                    <TopicWidgetRenderer html={topicWidgetHtml} isDarkMode={isDarkMode} />
                                                </div>
                                            )}

                                            <div className="animate-fade-in space-y-6">
                                                {section.type !== 'interactive_widget' && section.type !== 'map_widget' && (
                                                    <div className="flex items-center gap-4">
                                                        {section.icon && (
                                                            <div
                                                                className="w-10 h-10 rounded-2xl flex items-center justify-center text-lg shadow-lg"
                                                                style={{
                                                                    background: `linear-gradient(135deg, ${activeTheme?.primary || (isDarkMode ? '#818cf8' : '#4f46e5')}25, ${activeTheme?.accent || (isDarkMode ? '#c084fc' : '#7c3aed')}15)`,
                                                                    border: `1px solid ${activeTheme?.primary || (isDarkMode ? '#818cf8' : '#4f46e5')}20`
                                                                }}
                                                            >
                                                                {section.icon}
                                                            </div>
                                                        )}
                                                        <h3
                                                            className="text-xl md:text-2xl font-semibold tracking-tight"
                                                            style={{ color: activeTheme?.primary || (isDarkMode ? '#fff' : '#111') }}
                                                        >
                                                            {section.title}
                                                        </h3>
                                                    </div>
                                                )}

                                                {/* RENDERER FOR STATS -> CHART */}
                                                {section.type === 'stats' && (
                                                    <SimpleBarChart data={section.content} isDarkMode={isDarkMode} theme={activeTheme} />
                                                )}

                                                {/* RENDERER FOR MAP WIDGET */}
                                                {section.type === 'map_widget' && (
                                                    <MapWidgetRenderer
                                                        content={section.content}
                                                        isDarkMode={isDarkMode}
                                                        theme={activeTheme}
                                                        userLocation={researchData.userLocation}
                                                    />
                                                )}

                                                {/* RENDERER FOR TIMELINE - Glassmorphism */}
                                                {section.type === 'timeline' && (
                                                    <GlassCard isDarkMode={isDarkMode} theme={activeTheme} className="p-6 md:p-8">
                                                        <div className="relative space-y-8">
                                                            {Array.isArray(section.content) && section.content.map((event: any, tIdx: number) => (
                                                                <div key={tIdx} className="relative flex gap-5 group">
                                                                    <div className="flex flex-col items-center">
                                                                        <div
                                                                            className="w-4 h-4 rounded-full shrink-0 shadow-lg ring-4"
                                                                            style={{
                                                                                background: `linear-gradient(135deg, ${activeTheme?.primary || (isDarkMode ? '#818cf8' : '#4f46e5')}, ${activeTheme?.accent || (isDarkMode ? '#c084fc' : '#7c3aed')})`,
                                                                                ['--tw-ring-color' as any]: isDarkMode ? 'rgba(255,255,255,0.05)' : 'rgba(0,0,0,0.03)'
                                                                            } as React.CSSProperties}
                                                                        />
                                                                        {tIdx < section.content.length - 1 && (
                                                                            <div
                                                                                className="w-0.5 flex-1 mt-2 rounded-full min-h-[40px]"
                                                                                style={{
                                                                                    background: `linear-gradient(to bottom, ${activeTheme?.primary || (isDarkMode ? '#818cf8' : '#4f46e5')}40, transparent)`
                                                                                }}
                                                                            />
                                                                        )}
                                                                    </div>
                                                                    <div className="flex-1 pb-4">
                                                                        <span
                                                                            className="inline-block px-3 py-1 rounded-full text-[10px] font-bold uppercase tracking-wider mb-3"
                                                                            style={{
                                                                                backgroundColor: `${activeTheme?.primary || (isDarkMode ? '#818cf8' : '#4f46e5')}15`,
                                                                                color: activeTheme?.primary || (isDarkMode ? '#a5b4fc' : '#4f46e5')
                                                                            }}
                                                                        >
                                                                            {event.date}
                                                                        </span>
                                                                        <h4
                                                                            className="text-lg font-semibold mb-2"
                                                                            style={{ color: activeTheme?.text || (isDarkMode ? '#fff' : '#111') }}
                                                                        >
                                                                            {event.event}
                                                                        </h4>
                                                                        {event.details && (
                                                                            <p
                                                                                className="text-sm leading-relaxed"
                                                                                style={{ color: activeTheme?.text || (isDarkMode ? '#9ca3af' : '#6b7280'), opacity: 0.8 }}
                                                                            >
                                                                                {event.details}
                                                                            </p>
                                                                        )}
                                                                    </div>
                                                                </div>
                                                            ))}
                                                        </div>
                                                    </GlassCard>
                                                )}

                                                {/* RENDERER FOR COMPARISON */}
                                                {section.type === 'comparison' && (
                                                    <div className="grid grid-cols-1 md:grid-cols-2 gap-8 md:gap-16">
                                                        <div>
                                                            <h4 className={`text-sm font-bold uppercase tracking-widest mb-6 border-b pb-2 ${isDarkMode ? 'text-white border-white/10' : 'text-black border-black/10'}`} style={activeTheme ? { color: activeTheme.primary, borderColor: activeTheme.secondary } : {}}>
                                                                {section.content.leftTitle || 'Pros'}
                                                            </h4>
                                                            <ul className="space-y-4">
                                                                {section.content.points?.map((pt: any, pIdx: number) => (
                                                                    <li key={pIdx} className="flex gap-4 items-start">
                                                                        <span className={`text-xl leading-none ${isDarkMode ? 'text-white' : 'text-black'}`} style={activeTheme ? { color: activeTheme.accent } : {}}>+</span>
                                                                        <span className={`leading-relaxed font-light ${isDarkMode ? 'text-gray-300' : 'text-gray-600'}`} style={activeTheme ? { color: activeTheme.text } : {}}>{pt.left}</span>
                                                                    </li>
                                                                ))}
                                                            </ul>
                                                        </div>
                                                        <div>
                                                            <h4 className={`text-sm font-bold uppercase tracking-widest mb-6 border-b pb-2 ${isDarkMode ? 'text-white/50 border-white/10' : 'text-black/50 border-black/10'}`} style={activeTheme ? { color: activeTheme.primary, opacity: 0.7, borderColor: activeTheme.secondary } : {}}>
                                                                {section.content.rightTitle || 'Cons'}
                                                            </h4>
                                                            <ul className="space-y-4">
                                                                {section.content.points?.map((pt: any, pIdx: number) => (
                                                                    <li key={pIdx} className="flex gap-4 items-start">
                                                                        <span className={`text-xl leading-none ${isDarkMode ? 'text-white/50' : 'text-black/50'}`} style={activeTheme ? { color: activeTheme.secondary } : {}}>−</span>
                                                                        <span className={`leading-relaxed font-light ${isDarkMode ? 'text-gray-400' : 'text-gray-500'}`} style={activeTheme ? { color: activeTheme.text, opacity: 0.8 } : {}}>{pt.right}</span>
                                                                    </li>
                                                                ))}
                                                            </ul>
                                                        </div>
                                                    </div>
                                                )}

                                                {/* RENDERER FOR TABLE */}
                                                {section.type === 'table' && (
                                                    <TableRenderer content={section.content} isDarkMode={isDarkMode} theme={activeTheme} />
                                                )}

                                                {/* RENDERER FOR RADAR CHART */}
                                                {section.type === 'radar_chart' && (
                                                    <RadarChartRenderer content={section.content} isDarkMode={isDarkMode} theme={activeTheme} />
                                                )}

                                                {/* RENDERER FOR SWOT ANALYSIS */}
                                                {section.type === 'swot_analysis' && (
                                                    <SwotAnalysisRenderer content={section.content} isDarkMode={isDarkMode} theme={activeTheme} />
                                                )}

                                                {/* RENDERER FOR PROCESS FLOW */}
                                                {section.type === 'process_flow' && (
                                                    <ProcessFlowRenderer content={section.content} isDarkMode={isDarkMode} theme={activeTheme} />
                                                )}

                                                {/* RENDERER FOR METRIC CARD GRID */}
                                                {section.type === 'metric_card_grid' && (
                                                    <MetricCardGridRenderer content={section.content} isDarkMode={isDarkMode} theme={activeTheme} />
                                                )}

                                                {/* RENDERER FOR TOP PICKS */}
                                                {section.type === 'top_picks' && (
                                                    <TopPicksRenderer content={section.content} isDarkMode={isDarkMode} theme={activeTheme} />
                                                )}

                                                {/* RENDERER FOR TRADINGVIEW CHART */}
                                                {section.type === 'tradingview_chart' && (
                                                    <TradingViewChartRenderer content={section.content} isDarkMode={isDarkMode} theme={activeTheme} />
                                                )}

                                                {/* RENDERER FOR FAQ - Glassmorphism */}
                                                {section.type === 'faq' && (
                                                    <div className="grid gap-4">
                                                        {Array.isArray(section.content) && section.content.map((item: any, idx: number) => (
                                                            <GlassCard key={idx} isDarkMode={isDarkMode} theme={activeTheme} className="p-6 hover:scale-[1.01] transition-transform duration-300">
                                                                <div className="flex items-start gap-4">
                                                                    <div
                                                                        className="w-8 h-8 rounded-xl flex items-center justify-center text-sm font-bold shrink-0"
                                                                        style={{
                                                                            background: `linear-gradient(135deg, ${activeTheme?.primary || (isDarkMode ? '#818cf8' : '#4f46e5')}20, ${activeTheme?.accent || (isDarkMode ? '#c084fc' : '#7c3aed')}10)`,
                                                                            color: activeTheme?.primary || (isDarkMode ? '#a5b4fc' : '#4f46e5')
                                                                        }}
                                                                    >
                                                                        Q
                                                                    </div>
                                                                    <div className="flex-1">
                                                                        <h4
                                                                            className="text-base font-semibold mb-2"
                                                                            style={{ color: activeTheme?.text || (isDarkMode ? '#fff' : '#111') }}
                                                                        >
                                                                            {item.question}
                                                                        </h4>
                                                                        <p
                                                                            className="text-sm leading-relaxed"
                                                                            style={{ color: activeTheme?.text || (isDarkMode ? '#9ca3af' : '#6b7280'), opacity: 0.85 }}
                                                                        >
                                                                            {item.answer}
                                                                        </p>
                                                                    </div>
                                                                </div>
                                                            </GlassCard>
                                                        ))}
                                                    </div>
                                                )}

                                                {/* RENDERER FOR CHECKLIST - Glassmorphism */}
                                                {section.type === 'checklist' && (
                                                    <GlassCard isDarkMode={isDarkMode} theme={activeTheme} className="p-6 md:p-8" glow>
                                                        <ul className="space-y-4">
                                                            {Array.isArray(section.content) && section.content.map((item: string, idx: number) => (
                                                                <li key={idx} className="flex gap-4 items-start group">
                                                                    <div
                                                                        className="mt-0.5 w-6 h-6 rounded-lg flex items-center justify-center shrink-0 shadow-lg transition-transform group-hover:scale-110"
                                                                        style={{
                                                                            background: `linear-gradient(135deg, ${activeTheme?.accent || '#10b981'}, ${activeTheme?.primary || '#059669'})`,
                                                                        }}
                                                                    >
                                                                        <svg className="w-3.5 h-3.5 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                                                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="3" d="M5 13l4 4L19 7" />
                                                                        </svg>
                                                                    </div>
                                                                    <span
                                                                        className="text-base leading-relaxed"
                                                                        style={{ color: activeTheme?.text || (isDarkMode ? '#e5e7eb' : '#1f2937') }}
                                                                    >
                                                                        {item}
                                                                    </span>
                                                                </li>
                                                            ))}
                                                        </ul>
                                                    </GlassCard>
                                                )}

                                                {/* RENDERER FOR QUOTE */}
                                                {section.type === 'quote' && (
                                                    <div className="relative p-12 text-center">
                                                        <span className="absolute top-0 left-0 text-8xl font-serif opacity-10" style={activeTheme ? { color: activeTheme.primary } : {}}>“</span>
                                                        <p className={`text-2xl md:text-3xl font-serif leading-relaxed mb-6 ${isDarkMode ? 'text-white' : 'text-gray-900'}`} style={activeTheme ? { color: activeTheme.text } : {}}>
                                                            {section.content.text}
                                                        </p>
                                                        <div className="flex flex-col items-center gap-1">
                                                            <span className="text-sm font-bold tracking-widest uppercase" style={activeTheme ? { color: activeTheme.primary } : {}}>{section.content.author}</span>
                                                            <span className="text-xs opacity-50">{section.content.role}</span>
                                                        </div>
                                                    </div>
                                                )}

                                                {/* RENDERER FOR TEXT */}
                                                {section.type === 'text' && (
                                                    <div className="max-w-3xl">
                                                        <p className={`text-lg leading-relaxed whitespace-pre-wrap font-light ${isDarkMode ? 'text-gray-300' : 'text-gray-700'}`} style={activeTheme ? { color: activeTheme.text } : {}}>{section.content}</p>
                                                    </div>
                                                )}

                                                {/* RENDERER FOR INTERACTIVE WIDGET */}
                                                {section.type === 'interactive_widget' && (
                                                    <WidgetRenderer
                                                        content={section.content}
                                                        isDarkMode={isDarkMode}
                                                        onInteract={handleWidgetInteraction}
                                                        theme={activeTheme}
                                                    />
                                                )}

                                                {/* === NEW ADVANCED WIDGET RENDERERS === */}

                                                {/* RENDERER FOR SCENARIO SLIDER */}
                                                {section.type === 'scenario_slider' && (
                                                    <ScenarioSliderRenderer content={section.content} isDarkMode={isDarkMode} theme={activeTheme} />
                                                )}

                                                {/* RENDERER FOR PARAMETER KNOBS */}
                                                {section.type === 'parameter_knobs' && (
                                                    <ParameterKnobsRenderer content={section.content} isDarkMode={isDarkMode} theme={activeTheme} />
                                                )}

                                                {/* RENDERER FOR VENN DIAGRAM */}
                                                {section.type === 'venn_diagram' && (
                                                    <VennDiagramRenderer content={section.content} isDarkMode={isDarkMode} theme={activeTheme} />
                                                )}

                                                {/* RENDERER FOR SANKEY FLOW */}
                                                {section.type === 'sankey_flow' && (
                                                    <SankeyFlowRenderer content={section.content} isDarkMode={isDarkMode} theme={activeTheme} />
                                                )}

                                                {/* RENDERER FOR BIAS RADAR */}
                                                {section.type === 'bias_radar' && (
                                                    <BiasRadarRenderer content={section.content} isDarkMode={isDarkMode} theme={activeTheme} />
                                                )}

                                                {/* RENDERER FOR INFLUENCE NETWORK */}
                                                {section.type === 'influence_network' && (
                                                    <InfluenceNetworkRenderer content={section.content} isDarkMode={isDarkMode} theme={activeTheme} />
                                                )}

                                                {/* RENDERER FOR ROOT CAUSE TREE */}
                                                {section.type === 'root_cause_tree' && (
                                                    <RootCauseTreeRenderer content={section.content} isDarkMode={isDarkMode} theme={activeTheme} />
                                                )}

                                                {/* RENDERER FOR SENTIMENT TIMELINE */}
                                                {section.type === 'sentiment_timeline' && (
                                                    <SentimentTimelineRenderer content={section.content} isDarkMode={isDarkMode} theme={activeTheme} />
                                                )}

                                                {/* RENDERER FOR INSIGHT CARDS */}
                                                {section.type === 'insight_cards' && (
                                                    <InsightCardsRenderer content={section.content} isDarkMode={isDarkMode} theme={activeTheme} />
                                                )}

                                                {/* RENDERER FOR WORD CLOUD */}
                                                {section.type === 'word_cloud' && (
                                                    <WordCloudRenderer content={section.content} isDarkMode={isDarkMode} theme={activeTheme} />
                                                )}

                                                {/* --- NEW BUSINESS & TECH WIDGETS --- */}
                                                {section.type === 'company_profile' && <CompanyProfileRenderer content={section.content} isDarkMode={isDarkMode} theme={activeTheme} />}
                                                {section.type === 'executive_team' && <ExecutiveTeamRenderer content={section.content} isDarkMode={isDarkMode} theme={activeTheme} />}
                                                {section.type === 'product_lineup' && <ProductLineupRenderer content={section.content} isDarkMode={isDarkMode} theme={activeTheme} />}
                                                {section.type === 'tech_stack' && <TechStackRenderer content={section.content} isDarkMode={isDarkMode} theme={activeTheme} />}

                                                {/* --- NEW TRAVEL & PLACES WIDGETS --- */}
                                                {section.type === 'destination_guide' && <DestinationGuideRenderer content={section.content} isDarkMode={isDarkMode} theme={activeTheme} />}
                                                {section.type === 'hotel_showcase' && <HotelShowcaseRenderer content={section.content} isDarkMode={isDarkMode} theme={activeTheme} />}
                                                {section.type === 'travel_itinerary' && <TravelItineraryRenderer content={section.content} isDarkMode={isDarkMode} theme={activeTheme} />}

                                                {/* --- NEW ENTERTAINMENT & MEDIA WIDGETS --- */}
                                                {section.type === 'movie_cast' && <MovieCastRenderer content={section.content} isDarkMode={isDarkMode} theme={activeTheme} />}
                                                {section.type === 'game_roster' && <GameRosterRenderer content={section.content} isDarkMode={isDarkMode} theme={activeTheme} />}
                                                {section.type === 'historical_figure' && <HistoricalFigureRenderer content={section.content} isDarkMode={isDarkMode} theme={activeTheme} />}

                                                {/* --- NEW NATURE & SCIENCE WIDGETS --- */}
                                                {section.type === 'wildlife_encyclopedia' && <WildlifeEncyclopediaRenderer content={section.content} isDarkMode={isDarkMode} theme={activeTheme} />}
                                                {section.type === 'plant_guide' && <PlantGuideRenderer content={section.content} isDarkMode={isDarkMode} theme={activeTheme} />}
                                                {section.type === 'space_exploration' && <SpaceExplorationRenderer content={section.content} isDarkMode={isDarkMode} theme={activeTheme} />}

                                                {/* --- NEW LIFESTYLE & DESIGN WIDGETS --- */}
                                                {section.type === 'fashion_lookbook' && <FashionLookbookRenderer content={section.content} isDarkMode={isDarkMode} theme={activeTheme} />}
                                                {section.type === 'architectural_style' && <ArchitecturalStyleRenderer content={section.content} isDarkMode={isDarkMode} theme={activeTheme} />}
                                                {section.type === 'vehicle_showcase' && <VehicleShowcaseRenderer content={section.content} isDarkMode={isDarkMode} theme={activeTheme} />}
                                                {section.type === 'property_listing' && <PropertyListingRenderer content={section.content} isDarkMode={isDarkMode} theme={activeTheme} />}
                                                {section.type === 'news_gallery' && <NewsGalleryRenderer content={section.content} isDarkMode={isDarkMode} theme={activeTheme} />}
                                                {section.type === 'entity_logo_wall' && <EntityLogoWallRenderer content={section.content} isDarkMode={isDarkMode} theme={activeTheme} />}
                                                {section.type === 'key_people_gallery' && <KeyPeopleGalleryRenderer content={section.content} isDarkMode={isDarkMode} theme={activeTheme} />}
                                                {section.type === 'chart_image_gallery' && <ChartImageGalleryRenderer content={section.content} isDarkMode={isDarkMode} theme={activeTheme} />}

                                                {/* RENDERER FOR ICEBERG DEPTH */}
                                                {section.type === 'iceberg_depth' && (
                                                    <IcebergDepthRenderer content={section.content} isDarkMode={isDarkMode} theme={activeTheme} />
                                                )}

                                                {/* RENDERER FOR SHIELD METER */}
                                                {section.type === 'shield_meter' && (
                                                    <ShieldMeterRenderer content={section.content} isDarkMode={isDarkMode} theme={activeTheme} />
                                                )}

                                                {/* RENDERER FOR CONFIDENCE GAUGE */}
                                                {section.type === 'confidence_gauge' && (
                                                    <ConfidenceGaugeRenderer content={section.content} isDarkMode={isDarkMode} theme={activeTheme} />
                                                )}

                                                {/* RENDERER FOR ACTION ITEMS */}
                                                {section.type === 'action_items' && (
                                                    <ActionItemsRenderer content={section.content} isDarkMode={isDarkMode} theme={activeTheme} />
                                                )}

                                                {/* RENDERER FOR ELI5 TOGGLE */}
                                                {section.type === 'eli5_toggle' && (
                                                    <ELI5ToggleRenderer content={section.content} isDarkMode={isDarkMode} theme={activeTheme} />
                                                )}

                                                {/* RENDERER FOR PERSONA GRID */}
                                                {section.type === 'persona_grid' && (
                                                    <PersonaGridRenderer content={section.content} isDarkMode={isDarkMode} theme={activeTheme} />
                                                )}

                                                {/* RENDERER FOR FUNNEL BREAKDOWN */}
                                                {section.type === 'funnel_breakdown' && (
                                                    <FunnelBreakdownRenderer content={section.content} isDarkMode={isDarkMode} theme={activeTheme} />
                                                )}

                                                {/* RENDERER FOR CHANNEL MIX BOARD */}
                                                {section.type === 'channel_mix_board' && (
                                                    <ChannelMixBoardRenderer content={section.content} isDarkMode={isDarkMode} theme={activeTheme} />
                                                )}

                                                {/* RENDERER FOR MESSAGING MATRIX */}
                                                {section.type === 'messaging_matrix' && (
                                                    <MessagingMatrixRenderer content={section.content} isDarkMode={isDarkMode} theme={activeTheme} />
                                                )}

                                                {/* RENDERER FOR COMPETITOR BATTLECARDS */}
                                                {section.type === 'competitor_battlecards' && (
                                                    <CompetitorBattlecardsRenderer content={section.content} isDarkMode={isDarkMode} theme={activeTheme} />
                                                )}

                                                {/* RENDERER FOR EXPERIMENT BACKLOG */}
                                                {section.type === 'experiment_backlog' && (
                                                    <ExperimentBacklogRenderer content={section.content} isDarkMode={isDarkMode} theme={activeTheme} />
                                                )}

                                                {/* RENDERER FOR CONTENT CALENDAR */}
                                                {section.type === 'content_calendar' && (
                                                    <ContentCalendarRenderer content={section.content} isDarkMode={isDarkMode} theme={activeTheme} />
                                                )}

                                                {/* RENDERER FOR PRICING TIERS */}
                                                {section.type === 'pricing_tiers' && (
                                                    <PricingTiersRenderer content={section.content} isDarkMode={isDarkMode} theme={activeTheme} />
                                                )}

                                                {/* RENDERER FOR OPPORTUNITY GRID */}
                                                {section.type === 'opportunity_grid' && (
                                                    <OpportunityGridRenderer content={section.content} isDarkMode={isDarkMode} theme={activeTheme} />
                                                )}

                                                {/* RENDERER FOR GTM PLAYBOOK */}
                                                {section.type === 'gtm_playbook' && (
                                                    <GTMPlaybookRenderer content={section.content} isDarkMode={isDarkMode} theme={activeTheme} />
                                                )}

                                                {/* === ADDITIONAL DYNAMIC SECTION RENDERERS === */}

                                                {/* RENDERER FOR RISK MATRIX */}
                                                {section.type === 'risk_matrix' && (
                                                    <RiskMatrixRenderer content={section.content} isDarkMode={isDarkMode} theme={activeTheme} />
                                                )}

                                                {/* RENDERER FOR DECISION TREE */}
                                                {section.type === 'decision_tree' && (
                                                    <DecisionTreeRenderer content={section.content} isDarkMode={isDarkMode} theme={activeTheme} />
                                                )}

                                                {/* RENDERER FOR STAKEHOLDER MAP */}
                                                {section.type === 'stakeholder_map' && (
                                                    <StakeholderMapRenderer content={section.content} isDarkMode={isDarkMode} theme={activeTheme} />
                                                )}

                                                {/* RENDERER FOR MILESTONE TRACKER */}
                                                {section.type === 'milestone_tracker' && (
                                                    <MilestoneTrackerRenderer content={section.content} isDarkMode={isDarkMode} theme={activeTheme} />
                                                )}

                                                {/* RENDERER FOR RESOURCE ALLOCATION */}
                                                {section.type === 'resource_allocation' && (
                                                    <ResourceAllocationRenderer content={section.content} isDarkMode={isDarkMode} theme={activeTheme} />
                                                )}

                                                {/* RENDERER FOR HEAT MAP */}
                                                {section.type === 'heat_map' && (
                                                    <HeatMapRenderer content={section.content} isDarkMode={isDarkMode} theme={activeTheme} />
                                                )}

                                                {/* RENDERER FOR BUBBLE CHART */}
                                                {section.type === 'bubble_chart' && (
                                                    <BubbleChartRenderer content={section.content} isDarkMode={isDarkMode} theme={activeTheme} />
                                                )}

                                                {/* RENDERER FOR BEFORE/AFTER */}
                                                {section.type === 'before_after' && (
                                                    <BeforeAfterRenderer content={section.content} isDarkMode={isDarkMode} theme={activeTheme} />
                                                )}

                                                {/* RENDERER FOR PROS/CONS/NEUTRAL */}
                                                {section.type === 'pros_cons_neutral' && (
                                                    <ProsConsNeutralRenderer content={section.content} isDarkMode={isDarkMode} theme={activeTheme} />
                                                )}

                                                {/* RENDERER FOR FEATURE COMPARISON */}
                                                {section.type === 'feature_comparison' && (
                                                    <FeatureComparisonRenderer content={section.content} isDarkMode={isDarkMode} theme={activeTheme} />
                                                )}

                                                {/* RENDERER FOR RATING BREAKDOWN */}
                                                {section.type === 'rating_breakdown' && (
                                                    <RatingBreakdownRenderer content={section.content} isDarkMode={isDarkMode} theme={activeTheme} />
                                                )}

                                                {/* RENDERER FOR SKILL TREE */}
                                                {section.type === 'skill_tree' && (
                                                    <SkillTreeRenderer content={section.content} isDarkMode={isDarkMode} theme={activeTheme} />
                                                )}

                                                {/* RENDERER FOR DEPENDENCY GRAPH */}
                                                {section.type === 'dependency_graph' && (
                                                    <DependencyGraphRenderer content={section.content} isDarkMode={isDarkMode} theme={activeTheme} />
                                                )}

                                                {/* RENDERER FOR COST-BENEFIT */}
                                                {section.type === 'cost_benefit' && (
                                                    <CostBenefitRenderer content={section.content} isDarkMode={isDarkMode} theme={activeTheme} />
                                                )}

                                                {/* RENDERER FOR IMPACT-EFFORT MATRIX */}
                                                {section.type === 'impact_effort' && (
                                                    <ImpactEffortRenderer content={section.content} isDarkMode={isDarkMode} theme={activeTheme} />
                                                )}

                                                {/* RENDERER FOR LEARNING PATH */}
                                                {section.type === 'learning_path' && (
                                                    <LearningPathRenderer content={section.content} isDarkMode={isDarkMode} theme={activeTheme} />
                                                )}

                                                {/* RENDERER FOR RECIPE STEPS */}
                                                {section.type === 'recipe_steps' && (
                                                    <RecipeStepsRenderer content={section.content} isDarkMode={isDarkMode} theme={activeTheme} />
                                                )}

                                                {/* RENDERER FOR PRODUCT SHOWCASE */}
                                                {section.type === 'product_showcase' && (
                                                    <ProductShowcaseRenderer content={section.content} isDarkMode={isDarkMode} theme={activeTheme} />
                                                )}

                                                {/* RENDERER FOR POLL RESULTS */}
                                                {section.type === 'poll_results' && (
                                                    <PollResultsRenderer content={section.content} isDarkMode={isDarkMode} theme={activeTheme} />
                                                )}

                                                {/* RENDERER FOR ORG CHART */}
                                                {section.type === 'org_chart' && (
                                                    <OrgChartRenderer content={section.content} isDarkMode={isDarkMode} theme={activeTheme} />
                                                )}

                                                {/* RENDERER FOR MOOD BOARD */}
                                                {section.type === 'mood_board' && (
                                                    <MoodBoardRenderer content={section.content} isDarkMode={isDarkMode} theme={activeTheme} />
                                                )}

                                                {/* RENDERER FOR EVENT AGENDA */}
                                                {section.type === 'event_agenda' && (
                                                    <EventAgendaRenderer content={section.content} isDarkMode={isDarkMode} theme={activeTheme} />
                                                )}

                                                {/* RENDERER FOR TESTIMONIALS */}
                                                {section.type === 'testimonials' && (
                                                    <TestimonialsRenderer content={section.content} isDarkMode={isDarkMode} theme={activeTheme} />
                                                )}

                                                {/* RENDERER FOR TIPS GRID */}
                                                {section.type === 'tips_grid' && (
                                                    <TipsGridRenderer content={section.content} isDarkMode={isDarkMode} theme={activeTheme} />
                                                )}

                                                {/* RENDERER FOR NUMBERED LIST */}
                                                {section.type === 'numbered_list' && (
                                                    <NumberedListRenderer content={section.content} isDarkMode={isDarkMode} theme={activeTheme} />
                                                )}

                                                {/* RENDERER FOR RESOURCE LINKS */}
                                                {section.type === 'resource_links' && (
                                                    <ResourceLinksRenderer content={section.content} isDarkMode={isDarkMode} theme={activeTheme} />
                                                )}

                                                {/* RENDERER FOR GLOSSARY */}
                                                {section.type === 'glossary' && (
                                                    <GlossaryRenderer content={section.content} isDarkMode={isDarkMode} theme={activeTheme} />
                                                )}

                                                {/* RENDERER FOR TRIVIA FACTS */}
                                                {section.type === 'trivia_facts' && (
                                                    <TriviaFactsRenderer content={section.content} isDarkMode={isDarkMode} theme={activeTheme} />
                                                )}

                                                {/* RENDERER FOR HIGHLIGHT BOX */}
                                                {section.type === 'highlight_box' && (
                                                    <HighlightBoxRenderer content={section.content} isDarkMode={isDarkMode} theme={activeTheme} />
                                                )}

                                                {/* RENDERER FOR PROGRESS TRACKER */}
                                                {section.type === 'progress_tracker' && (
                                                    <ProgressTrackerRenderer content={section.content} isDarkMode={isDarkMode} theme={activeTheme} />
                                                )}

                                                {/* === ARTS & CULTURE RENDERERS === */}

                                                {/* RENDERER FOR POETRY DISPLAY */}
                                                {section.type === 'poetry_display' && (
                                                    <PoetryDisplayRenderer content={section.content} isDarkMode={isDarkMode} theme={activeTheme} />
                                                )}

                                                {/* RENDERER FOR MUSIC PLAYER */}
                                                {section.type === 'music_player' && (
                                                    <MusicPlayerRenderer content={section.content} isDarkMode={isDarkMode} theme={activeTheme} />
                                                )}

                                                {/* RENDERER FOR ARTWORK GALLERY */}
                                                {section.type === 'artwork_gallery' && (
                                                    <ArtworkGalleryRenderer content={section.content} isDarkMode={isDarkMode} theme={activeTheme} />
                                                )}

                                                {/* RENDERER FOR BOOK SHELF */}
                                                {section.type === 'book_shelf' && (
                                                    <BookShelfRenderer content={section.content} isDarkMode={isDarkMode} theme={activeTheme} />
                                                )}

                                                {/* RENDERER FOR CREATIVE SHOWCASE */}
                                                {section.type === 'creative_showcase' && (
                                                    <CreativeShowcaseRenderer content={section.content} isDarkMode={isDarkMode} theme={activeTheme} />
                                                )}

                                                {/* === SCIENCE & DISCOVERY RENDERERS === */}

                                                {/* RENDERER FOR PERIODIC ELEMENT */}
                                                {section.type === 'periodic_element' && (
                                                    <PeriodicElementRenderer content={section.content} isDarkMode={isDarkMode} theme={activeTheme} />
                                                )}

                                                {/* RENDERER FOR DISCOVERY TIMELINE */}
                                                {section.type === 'discovery_timeline' && (
                                                    <DiscoveryTimelineRenderer content={section.content} isDarkMode={isDarkMode} theme={activeTheme} />
                                                )}

                                                {/* RENDERER FOR FORMULA DISPLAY */}
                                                {section.type === 'formula_display' && (
                                                    <FormulaDisplayRenderer content={section.content} isDarkMode={isDarkMode} theme={activeTheme} />
                                                )}

                                                {/* RENDERER FOR ANATOMY EXPLORER */}
                                                {section.type === 'anatomy_explorer' && (
                                                    <AnatomyExplorerRenderer content={section.content} isDarkMode={isDarkMode} theme={activeTheme} />
                                                )}

                                                {/* RENDERER FOR EXPERIMENT STEPS */}
                                                {section.type === 'experiment_steps' && (
                                                    <ExperimentStepsRenderer content={section.content} isDarkMode={isDarkMode} theme={activeTheme} />
                                                )}

                                                {/* === LOCAL & EVENTS RENDERERS === */}

                                                {/* RENDERER FOR EVENT CALENDAR */}
                                                {section.type === 'event_calendar' && (
                                                    <EventCalendarRenderer content={section.content} isDarkMode={isDarkMode} theme={activeTheme} />
                                                )}

                                                {/* RENDERER FOR VENUE CARDS */}
                                                {section.type === 'venue_cards' && (
                                                    <VenueCardsRenderer content={section.content} isDarkMode={isDarkMode} theme={activeTheme} />
                                                )}

                                                {/* RENDERER FOR DIRECTIONS GUIDE */}
                                                {section.type === 'directions_guide' && (
                                                    <DirectionsGuideRenderer content={section.content} isDarkMode={isDarkMode} theme={activeTheme} />
                                                )}

                                                {/* RENDERER FOR LOCAL SPOTLIGHT */}
                                                {section.type === 'local_spotlight' && (
                                                    <LocalSpotlightRenderer content={section.content} isDarkMode={isDarkMode} theme={activeTheme} />
                                                )}

                                                {/* === EDUCATION RENDERERS === */}

                                                {/* RENDERER FOR FLASHCARD DECK */}
                                                {section.type === 'flashcard_deck' && (
                                                    <FlashcardDeckRenderer content={section.content} isDarkMode={isDarkMode} theme={activeTheme} />
                                                )}

                                                {/* RENDERER FOR QUIZ INTERACTIVE */}
                                                {section.type === 'quiz_interactive' && (
                                                    <QuizInteractiveRenderer content={section.content} isDarkMode={isDarkMode} theme={activeTheme} />
                                                )}

                                                {/* RENDERER FOR CONCEPT MAP */}
                                                {section.type === 'concept_map' && (
                                                    <ConceptMapRenderer content={section.content} isDarkMode={isDarkMode} theme={activeTheme} />
                                                )}

                                                {/* RENDERER FOR STUDY SCHEDULE */}
                                                {section.type === 'study_schedule' && (
                                                    <StudyScheduleRenderer content={section.content} isDarkMode={isDarkMode} theme={activeTheme} />
                                                )}

                                                {/* === LIFESTYLE RENDERERS === */}

                                                {/* RENDERER FOR RECIPE CARD */}
                                                {section.type === 'recipe_card' && (
                                                    <RecipeCardRenderer content={section.content} isDarkMode={isDarkMode} theme={activeTheme} />
                                                )}

                                                {/* RENDERER FOR WORKOUT ROUTINE */}
                                                {section.type === 'workout_routine' && (
                                                    <WorkoutRoutineRenderer content={section.content} isDarkMode={isDarkMode} theme={activeTheme} />
                                                )}

                                                {/* RENDERER FOR NUTRITION BREAKDOWN */}
                                                {section.type === 'nutrition_breakdown' && (
                                                    <NutritionBreakdownRenderer content={section.content} isDarkMode={isDarkMode} theme={activeTheme} />
                                                )}

                                                {/* RENDERER FOR HABIT TRACKER */}
                                                {section.type === 'habit_tracker' && (
                                                    <HabitTrackerRenderer content={section.content} isDarkMode={isDarkMode} theme={activeTheme} />
                                                )}

                                                {/* === EVERYDAY & LIFESTYLE WIDGET RENDERERS === */}

                                                {section.type === 'buying_guide' && <BuyingGuideRenderer content={section.content} isDarkMode={isDarkMode} theme={activeTheme} />}
                                                {section.type === 'streaming_guide' && <StreamingGuideRenderer content={section.content} isDarkMode={isDarkMode} theme={activeTheme} />}
                                                {section.type === 'gift_ideas' && <GiftIdeasRenderer content={section.content} isDarkMode={isDarkMode} theme={activeTheme} />}
                                                {section.type === 'diy_project' && <DiyProjectRenderer content={section.content} isDarkMode={isDarkMode} theme={activeTheme} />}
                                                {section.type === 'pet_care' && <PetCareRenderer content={section.content} isDarkMode={isDarkMode} theme={activeTheme} />}
                                                {section.type === 'parenting_tips' && <ParentingTipsRenderer content={section.content} isDarkMode={isDarkMode} theme={activeTheme} />}
                                                {section.type === 'hobby_starter' && <HobbyStarterRenderer content={section.content} isDarkMode={isDarkMode} theme={activeTheme} />}
                                                {section.type === 'budget_breakdown' && <BudgetBreakdownRenderer content={section.content} isDarkMode={isDarkMode} theme={activeTheme} />}
                                                {section.type === 'life_hack_cards' && <LifeHackCardsRenderer content={section.content} isDarkMode={isDarkMode} theme={activeTheme} />}
                                                {section.type === 'review_summary' && <ReviewSummaryRenderer content={section.content} isDarkMode={isDarkMode} theme={activeTheme} />}
                                                {section.type === 'podcast_playlist' && <PodcastPlaylistRenderer content={section.content} isDarkMode={isDarkMode} theme={activeTheme} />}
                                                {section.type === 'season_guide' && <SeasonGuideRenderer content={section.content} isDarkMode={isDarkMode} theme={activeTheme} />}
                                                {section.type === 'celebration_planner' && <CelebrationPlannerRenderer content={section.content} isDarkMode={isDarkMode} theme={activeTheme} />}
                                            </div>
                                        </React.Fragment>
                                    );
                                });
                            })()}

                            {/* 3. YOUTUBE VIDEOS & VIDEO ANALYSIS */}
                            {(researchData.youtubeVideos && researchData.youtubeVideos.length > 0) && (
                                <div className="space-y-8 animate-fade-in">
                                    <div className="flex items-center gap-3">
                                        <div
                                            className="w-8 h-8 rounded-xl flex items-center justify-center"
                                            style={{
                                                background: `linear-gradient(135deg, ${activeTheme?.primary || (isDarkMode ? '#ff0000' : '#ff0000')}15, transparent)`
                                            }}
                                        >
                                            <span className="text-lg">🎥</span>
                                        </div>
                                        <h3
                                            className="text-[13px] font-semibold uppercase tracking-[0.15em]"
                                            style={{ color: activeTheme?.text || (isDarkMode ? '#86868b' : '#6b7280') }}
                                        >
                                            Video Intelligence ({researchData.youtubeVideos.length})
                                        </h3>
                                    </div>

                                    {(() => {
                                        const mainVideoId = researchData.videoAnalysis?.videoId;
                                        const mainVideo = mainVideoId
                                            ? researchData.youtubeVideos.find(v => v.id === mainVideoId)
                                            : researchData.youtubeVideos[0];
                                        const otherVideos = researchData.youtubeVideos.filter(v => v.id !== (mainVideo && mainVideo.id));

                                        return (
                                            <>
                                                {mainVideo && (
                                                    <div
                                                        className={`group rounded-2xl overflow-hidden border transition-all duration-300 ${isDarkMode
                                                            ? 'bg-[#1c1c1e]/60 border-white/[0.06] hover:border-white/[0.1]'
                                                            : 'bg-white/60 border-black/[0.04] hover:border-black/[0.08]'
                                                            }`}
                                                        style={activeTheme ? { backgroundColor: `${activeTheme.surface}80`, borderColor: `${activeTheme.secondary}30` } : {}}
                                                    >
                                                        <div className="relative bg-black aspect-video">
                                                            <iframe
                                                                src={`https://www.youtube.com/embed/${mainVideo.id}`}
                                                                title={mainVideo.title}
                                                                className="w-full h-full"
                                                                allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
                                                                allowFullScreen
                                                            />
                                                        </div>

                                                        <div className="p-4 sm:p-6 space-y-4">
                                                            <div className="space-y-2">
                                                                <h4
                                                                    className="text-base sm:text-lg font-semibold leading-snug"
                                                                    style={{ color: activeTheme?.text || (isDarkMode ? '#fff' : '#1d1d1f') }}
                                                                >
                                                                    {mainVideo.title}
                                                                </h4>
                                                                <div
                                                                    className="flex flex-wrap items-center gap-3 text-xs"
                                                                    style={{
                                                                        color: activeTheme?.text || (isDarkMode ? '#9ca3af' : '#6b7280'),
                                                                        opacity: 0.8
                                                                    }}
                                                                >
                                                                    <span>{mainVideo.channel}</span>
                                                                    {mainVideo.views && <span>• {mainVideo.views}</span>}
                                                                    {mainVideo.duration && <span>• {mainVideo.duration}</span>}
                                                                </div>
                                                            </div>

                                                            {researchData.videoAnalysis && (
                                                                <div
                                                                    className={`mt-2 pt-4 border-t space-y-2 ${isDarkMode ? 'border-white/10' : 'border-black/10'
                                                                        }`}
                                                                >
                                                                    <div className="flex items-center gap-2">
                                                                        <span
                                                                            className="text-xs font-semibold uppercase tracking-wider"
                                                                            style={{
                                                                                color: activeTheme?.primary || (isDarkMode ? '#a5b4fc' : '#4f46e5')
                                                                            }}
                                                                        >
                                                                            AI Analysis
                                                                        </span>
                                                                    </div>
                                                                    <div
                                                                        className="text-sm leading-relaxed prose prose-sm max-w-none"
                                                                        style={{ color: activeTheme?.text || (isDarkMode ? '#9ca3af' : '#6b7280') }}
                                                                    >
                                                                        <ReactMarkdown>{researchData.videoAnalysis.analysis}</ReactMarkdown>
                                                                    </div>
                                                                </div>
                                                            )}
                                                        </div>
                                                    </div>
                                                )}

                                                {otherVideos.length > 0 && (
                                                    <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                                                        {otherVideos.map((video, idx) => (
                                                            <div
                                                                key={idx}
                                                                className={`group rounded-2xl overflow-hidden border transition-all duration-300 ${isDarkMode
                                                                    ? 'bg-[#1c1c1e]/60 border-white/[0.06] hover:border-white/[0.1]'
                                                                    : 'bg-white/60 border-black/[0.04] hover:border-black/[0.08]'
                                                                    }`}
                                                                style={activeTheme ? { backgroundColor: `${activeTheme.surface}80`, borderColor: `${activeTheme.secondary}30` } : {}}
                                                            >
                                                                <div className="relative bg-black aspect-video">
                                                                    <iframe
                                                                        src={`https://www.youtube.com/embed/${video.id}`}
                                                                        title={video.title}
                                                                        className="w-full h-full"
                                                                        allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
                                                                        allowFullScreen
                                                                    />
                                                                </div>

                                                                <div className="p-4 space-y-2">
                                                                    <h4
                                                                        className="text-sm font-semibold line-clamp-2 leading-snug"
                                                                        style={{ color: activeTheme?.text || (isDarkMode ? '#fff' : '#1d1d1f') }}
                                                                    >
                                                                        {video.title}
                                                                    </h4>
                                                                    <div
                                                                        className="flex items-center gap-3 text-xs"
                                                                        style={{
                                                                            color: activeTheme?.text || (isDarkMode ? '#9ca3af' : '#6b7280'),
                                                                            opacity: 0.7
                                                                        }}
                                                                    >
                                                                        <span>{video.channel}</span>
                                                                        {video.views && <span>• {video.views}</span>}
                                                                        {video.duration && <span>• {video.duration}</span>}
                                                                    </div>
                                                                </div>
                                                            </div>
                                                        ))}
                                                    </div>
                                                )}
                                            </>
                                        );
                                    })()}
                                </div>
                            )}

                            {/* 4. FUN SECTION (Interactive HTML Game) */}
                            {researchData.funSection && (
                                <div className="animate-fade-in">
                                    <FunSectionRenderer html={researchData.funSection} isDarkMode={isDarkMode} />
                                </div>
                            )}

                            {/* 4b. TOPIC WIDGET (Non-game interactive HTML) */}
                            {(researchData as any).topicWidget && !researchData.dynamicSections?.some(s => s?.type === 'swot_analysis') && (
                                <div className="animate-fade-in">
                                    <TopicWidgetRenderer html={(researchData as any).topicWidget} isDarkMode={isDarkMode} />
                                </div>
                            )}

                            {/* 4. KEY POINTS (Fallback or Supplementary) */}
                            {(!researchData.dynamicSections || researchData.dynamicSections.length === 0) && researchData.keyPoints?.map((point, idx) => (
                                <div key={idx} className={`p-6 rounded-xl border ${isDarkMode
                                    ? 'bg-white/5 border-white/5'
                                    : 'bg-black/5 border-black/5'
                                    }`} style={activeTheme ? { backgroundColor: activeTheme.surface, borderColor: activeTheme.secondary } : {}}>
                                    <div className="flex justify-between items-start mb-4">
                                        <span className={`text-xs font-bold uppercase tracking-wider ${isDarkMode ? 'text-white/70' : 'text-black/70'
                                            }`} style={activeTheme ? { color: activeTheme.text, opacity: 0.7 } : {}}>
                                            {point.priority} Priority
                                        </span>
                                        <span className={`font-mono text-xs opacity-30`}>0{idx + 1}</span>
                                    </div>
                                    <h3 className="text-lg font-medium mb-3 leading-tight" style={activeTheme ? { color: activeTheme.primary } : {}}>{point.title}</h3>
                                    <p className={`text-sm leading-relaxed font-light ${isDarkMode ? 'text-gray-400' : 'text-gray-600'}`} style={activeTheme ? { color: activeTheme.text } : {}}>
                                        {point.details}
                                    </p>
                                </div>
                            ))}

                            {/* 5. Sources - Apple-Style Minimal Design */}
                            <div className="space-y-6">
                                <div className="flex items-center gap-3">
                                    <div
                                        className="w-8 h-8 rounded-xl flex items-center justify-center"
                                        style={{
                                            background: `linear-gradient(135deg, ${activeTheme?.primary || (isDarkMode ? '#0071e3' : '#0071e3')}15, transparent)`
                                        }}
                                    >
                                        <svg className="w-4 h-4" style={{ color: activeTheme?.primary || '#0071e3' }} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M13.828 10.172a4 4 0 00-5.656 0l-4 4a4 4 0 105.656 5.656l1.102-1.101m-.758-4.899a4 4 0 005.656 0l4-4a4 4 0 00-5.656-5.656l-1.1 1.1" />
                                        </svg>
                                    </div>
                                    <h3
                                        className="text-[13px] font-semibold uppercase tracking-[0.15em]"
                                        style={{ color: activeTheme?.text || (isDarkMode ? '#86868b' : '#6b7280') }}
                                    >
                                        Sources ({researchData.sources?.length || 0})
                                    </h3>
                                </div>
                                <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                                    {researchData.sources?.map((src, i) => (
                                        <a
                                            key={i}
                                            href={src.uri?.startsWith('http') ? src.uri : `https://www.google.com/search?q=${encodeURIComponent(src.uri || src.title || '')}`}
                                            target="_blank"
                                            rel="noreferrer"
                                            className={`group flex items-start gap-4 p-4 rounded-2xl border transition-all duration-200 ${isDarkMode
                                                ? 'bg-[#1c1c1e]/60 border-white/[0.06] hover:bg-[#2c2c2e]/80 hover:border-white/[0.1]'
                                                : 'bg-white/60 border-black/[0.04] hover:bg-white/80 hover:border-black/[0.08]'
                                                }`}
                                            style={activeTheme ? { backgroundColor: `${activeTheme.surface}80`, borderColor: `${activeTheme.secondary}30` } : {}}
                                        >
                                            <div
                                                className={`w-8 h-8 shrink-0 flex items-center justify-center rounded-xl text-[11px] font-bold transition-all ${isDarkMode
                                                    ? 'bg-white/[0.06] text-white/60 group-hover:bg-[#0071e3] group-hover:text-white'
                                                    : 'bg-black/[0.04] text-black/50 group-hover:bg-[#0071e3] group-hover:text-white'
                                                    }`}
                                                style={activeTheme ? { backgroundColor: `${activeTheme.primary}15`, color: activeTheme.primary } : {}}
                                            >
                                                {i + 1}
                                            </div>
                                            <div className="flex-1 min-w-0 pt-0.5">
                                                <div
                                                    className={`text-[14px] font-medium line-clamp-1 transition-colors ${isDarkMode ? 'text-white/90 group-hover:text-white' : 'text-gray-800 group-hover:text-black'}`}
                                                    style={activeTheme ? { color: activeTheme.text } : {}}
                                                >
                                                    {src.title || src.uri.replace(/^https?:\/\/(www\.)?/, '').split('/')[0]}
                                                </div>
                                                <div className={`text-[12px] line-clamp-1 mt-1 ${isDarkMode ? 'text-white/40' : 'text-black/40'}`}>
                                                    {src.uri.replace(/^https?:\/\/(www\.)?/, '').split('/')[0]}
                                                </div>
                                            </div>
                                            <svg
                                                className={`w-4 h-4 mt-1 shrink-0 opacity-0 group-hover:opacity-60 transition-all transform group-hover:translate-x-0.5 ${isDarkMode ? 'text-white' : 'text-black'}`}
                                                fill="none" stroke="currentColor" viewBox="0 0 24 24"
                                            >
                                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" />
                                            </svg>
                                        </a>
                                    ))}
                                </div>
                            </div>
                        </div>
                    </div>
                )}

                {/* VIEW C: NOTE MAP */}
                {mode === 'notemap' && (
                    <NoteMap
                        researchReport={researchData}
                        currentProjectId={currentProjectId}
                        projectKnowledgeBaseFiles={currentProject?.knowledgeBase || []}
                        projectUploadedFiles={currentProject?.uploadedFiles || []}
                        savedState={noteMapState}
                        isDarkMode={isDarkMode}
                        theme={activeTheme}
                        onUpdateState={handleNoteMapUpdate}
                    />
                )}

                {/* VIEW F: SOCIAL CREATE TAB - Apple-Style Minimal Design */}
                {mode === 'create' && (
                    <div className={`w-full h-full overflow-y-auto ${isDarkMode ? 'bg-[#000000] text-white' : 'bg-[#fafafa] text-black'}`}
                        style={activeTheme ? { backgroundColor: activeTheme.background, color: activeTheme.text } : {}}>

                        <div className="max-w-6xl mx-auto px-6 md:px-8 py-12 md:py-16 space-y-14 animate-fade-in">

                            {/* Header - Minimal Apple Style */}
                            <div className="text-center space-y-4">
                                <span className={`text-[11px] font-semibold uppercase tracking-[0.15em] ${isDarkMode ? 'text-[#86868b]' : 'text-[#6b7280]'}`}>
                                    Creative Studio
                                </span>
                                <h2 className={`text-[32px] md:text-[40px] font-semibold tracking-tight ${isDarkMode ? 'text-white' : 'text-[#1d1d1f]'}`}>
                                    Campaign Assets
                                </h2>
                                <p className={`text-[15px] max-w-lg mx-auto leading-relaxed ${isDarkMode ? 'text-[#86868b]' : 'text-[#6b7280]'}`}>
                                    AI-generated multi-platform content tailored to your research.
                                </p>

                                {/* Regenerate Button - Apple Style */}
                                {(socialCampaign || blogPost) && !isGeneratingAssets && (
                                    <button
                                        onClick={handleRegenerateAssets}
                                        className={`mt-4 inline-flex items-center gap-2 px-5 py-2.5 rounded-full text-[14px] font-medium transition-all duration-200 active:scale-[0.98] ${isDarkMode
                                            ? 'bg-[#1c1c1e] hover:bg-[#2c2c2e] text-white border border-white/[0.06]'
                                            : 'bg-white hover:bg-gray-50 text-[#1d1d1f] border border-black/[0.04] shadow-sm'
                                            }`}
                                    >
                                        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
                                        </svg>
                                        Regenerate Assets
                                    </button>
                                )}
                            </div>

                            {isGeneratingAssets && (!socialCampaign || !blogPost) ? (
                                <div className="flex flex-col items-center justify-center h-96 space-y-6">
                                    <div className="w-20 h-20 border-4 border-indigo-500 border-t-transparent rounded-full animate-spin"></div>
                                    <p className="animate-pulse opacity-70 text-lg font-light">Crafting social posts & writing article...</p>
                                </div>
                            ) : (
                                <>
                                    {/* SOCIAL MEDIA SECTION */}
                                    {socialCampaign ? (
                                        <div className="space-y-8">
                                            <div className="flex items-center gap-4 opacity-50 border-b pb-4 border-current">
                                                <span className="text-2xl">📱</span>
                                                <h3 className="text-sm font-bold uppercase tracking-widest">Social Media Feed</h3>
                                            </div>

                                            <div className="grid grid-cols-1 md:grid-cols-3 gap-8 items-start">
                                                {socialCampaign.posts.map((post, idx) => {
                                                    const isInsta = post.platform === 'Instagram';
                                                    const isTwitter = post.platform === 'Twitter';
                                                    const isLinkedIn = post.platform === 'LinkedIn';

                                                    return (
                                                        <div key={idx} className={`rounded-xl overflow-hidden shadow-2xl flex flex-col transition-all hover:-translate-y-2 duration-500 ${isDarkMode ? 'bg-[#000000]' : 'bg-white'
                                                            }`} style={{
                                                                border: isDarkMode ? '1px solid #333' : '1px solid #eee',
                                                                fontFamily: isTwitter ? '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif' : 'inherit'
                                                            }}>

                                                            {/* CARD HEADER */}
                                                            <div className="p-4 flex items-center justify-between">
                                                                <div className="flex items-center gap-3">
                                                                    <div className={`w-10 h-10 rounded-full bg-gradient-to-tr from-yellow-400 to-purple-600 p-[2px]`}>
                                                                        <div className={`w-full h-full rounded-full ${isDarkMode ? 'bg-black' : 'bg-white'} border-2 border-transparent`}>
                                                                            <img src={`https://api.dicebear.com/7.x/avataaars/svg?seed=${researchData?.topic.substring(0, 5)}`} alt="Avatar" className="w-full h-full rounded-full" />
                                                                        </div>
                                                                    </div>
                                                                    <div>
                                                                        <div className="flex items-center gap-1">
                                                                            <span className={`text-sm font-bold ${isDarkMode ? 'text-white' : 'text-black'}`}>Gemini Research</span>
                                                                            {isTwitter && <span className="text-blue-500 text-[10px] ml-0.5">✔</span>}
                                                                        </div>
                                                                        <div className="text-xs opacity-50">
                                                                            {isInsta ? 'Sponsored' : isTwitter ? '@gemini_ai · 1h' : '1st • 2h'}
                                                                        </div>
                                                                    </div>
                                                                </div>
                                                                <span className="opacity-50 text-xl">•••</span>
                                                            </div>

                                                            {/* CONTENT BODY */}
                                                            <div className={`px-4 pb-3 ${isTwitter ? 'text-[15px]' : 'text-sm'} leading-relaxed ${isDarkMode ? 'text-white' : 'text-black'}`}>
                                                                {isTwitter ? (
                                                                    <div>
                                                                        {post.caption.split(' ').slice(0, 20).join(' ')}... <span className="text-blue-400">#Research</span>
                                                                    </div>
                                                                ) : (
                                                                    <p className="whitespace-pre-line">{post.caption.length > 150 ? post.caption.substring(0, 150) + '... more' : post.caption}</p>
                                                                )}
                                                            </div>

                                                            {/* IMAGE */}
                                                            {post.imageUrl ? (
                                                                <div className={`relative bg-neutral-800 ${isTwitter ? 'mx-4 mb-4 rounded-2xl border border-neutral-700 overflow-hidden' : ''}`}>
                                                                    <img src={post.imageUrl} alt="Post Visual" className="w-full h-auto object-cover" />
                                                                </div>
                                                            ) : (
                                                                <div className={`h-64 bg-neutral-800 animate-pulse flex items-center justify-center ${isTwitter ? 'mx-4 mb-4 rounded-2xl' : ''}`}>
                                                                    <span className="opacity-20 text-4xl">🖼️</span>
                                                                </div>
                                                            )}

                                                            {/* ACTION BAR */}
                                                            <div className={`p-4 flex justify-between opacity-70 ${isDarkMode ? 'text-white' : 'text-black'}`}>
                                                                {isInsta && (
                                                                    <div className="flex gap-4 text-2xl">
                                                                        <span>❤️</span><span>💬</span><span>🚀</span>
                                                                    </div>
                                                                )}
                                                                {isLinkedIn && (
                                                                    <div className="flex gap-6 text-sm font-bold">
                                                                        <span>👍 Like</span><span>💬 Comment</span><span>↩️ Repost</span>
                                                                    </div>
                                                                )}
                                                                {isTwitter && (
                                                                    <div className="flex justify-between w-full text-xs opacity-50">
                                                                        <span>💬 24</span><span>Example 145</span><span>❤️ 892</span><span>📊 12K</span>
                                                                    </div>
                                                                )}
                                                                {isInsta && <span>🔖</span>}
                                                            </div>

                                                            {/* Hashtags (Footer) */}
                                                            {!isTwitter && (
                                                                <div className="px-4 pb-4 flex flex-wrap gap-1 text-xs text-blue-500 font-medium">
                                                                    {post.hashtags.map(t => `#${t} `)}
                                                                </div>
                                                            )}

                                                            {/* Copy Action */}
                                                            <button
                                                                onClick={() => {
                                                                    navigator.clipboard.writeText(`${post.caption}\n\n${post.hashtags.map(t => '#' + t).join(' ')}`);
                                                                    alert("Caption copied!");
                                                                }}
                                                                className={`w-full py-3 text-xs font-bold uppercase tracking-wider hover:bg-neutral-500/10 transition-colors border-t ${isDarkMode ? 'border-white/10' : 'border-black/5'}`}
                                                            >
                                                                Copy Content
                                                            </button>
                                                        </div>
                                                    );
                                                })}
                                            </div>
                                        </div>
                                    ) : null}

                                    {/* BLOG POST SECTION */}
                                    {blogPost ? (
                                        <div className="space-y-8 pt-12 border-t border-dashed border-gray-500/20">
                                            <div className="flex items-center gap-4 opacity-50 border-b pb-4 border-current">
                                                <span className="text-2xl">✍️</span>
                                                <h3 className="text-sm font-bold uppercase tracking-widest">Blog Article</h3>
                                            </div>

                                            <div className={`max-w-3xl mx-auto rounded-xl overflow-hidden shadow-2xl border ${isDarkMode ? 'bg-black border-neutral-800' : 'bg-white border-neutral-200'
                                                }`}>
                                                {/* Cover Image */}
                                                <div className="w-full aspect-[21/9] bg-neutral-900 relative overflow-hidden group">
                                                    {blogPost.imageUrl ? (
                                                        <img src={blogPost.imageUrl} alt="Cover" className="w-full h-full object-cover" />
                                                    ) : (
                                                        <div className="w-full h-full flex items-center justify-center animate-pulse bg-neutral-800">
                                                            <span className="text-neutral-600">Generating Cover Art...</span>
                                                        </div>
                                                    )}
                                                </div>

                                                {/* Article Content */}
                                                <div className={`p-8 md:p-12 space-y-8 ${isDarkMode ? 'text-gray-300' : 'text-gray-800'}`}>
                                                    <header className="space-y-4 text-center border-b border-dashed border-gray-500/20 pb-8">
                                                        <span className="text-xs font-bold uppercase tracking-widest text-indigo-500">Feature Story</span>
                                                        <h1 className={`text-3xl md:text-5xl font-bold leading-tight ${isDarkMode ? 'text-white' : 'text-gray-900'}`}>
                                                            {blogPost.title}
                                                        </h1>
                                                        <h2 className="text-xl md:text-2xl font-light opacity-80 italic">
                                                            {blogPost.subtitle}
                                                        </h2>
                                                        <div className="flex items-center justify-center gap-2 text-xs opacity-50 pt-4">
                                                            <div className="w-6 h-6 rounded-full bg-indigo-500"></div>
                                                            <span>By Gemini Research AI</span>
                                                            <span>•</span>
                                                            <span>5 min read</span>
                                                        </div>
                                                    </header>

                                                    <article className="prose prose-lg max-w-none prose-invert">
                                                        <ReactMarkdown
                                                            components={{
                                                                h2: ({ node, ...props }) => <h2 className={`text-2xl font-bold mt-8 mb-4 ${isDarkMode ? 'text-white' : 'text-gray-900'}`} {...props} />,
                                                                h3: ({ node, ...props }) => <h3 className={`text-xl font-semibold mt-6 mb-3 ${isDarkMode ? 'text-white' : 'text-gray-800'}`} {...props} />,
                                                                p: ({ node, ...props }) => <p className={`leading-relaxed mb-4 font-light ${isDarkMode ? 'text-gray-300' : 'text-gray-700'}`} {...props} />,
                                                                ul: ({ node, ...props }) => <ul className="list-disc pl-5 space-y-2 mb-4 opacity-80" {...props} />,
                                                                li: ({ node, ...props }) => <li className="pl-2" {...props} />,
                                                                strong: ({ node, ...props }) => <strong className={`font-bold ${isDarkMode ? 'text-white' : 'text-gray-900'}`} {...props} />,
                                                                blockquote: ({ node, ...props }) => <blockquote className="border-l-4 border-indigo-500 pl-4 italic opacity-70 my-6" {...props} />
                                                            }}
                                                        >
                                                            {blogPost.content}
                                                        </ReactMarkdown>
                                                    </article>

                                                    <div className="pt-8 flex justify-center">
                                                        <button
                                                            onClick={() => {
                                                                navigator.clipboard.writeText(`# ${blogPost.title}\n\n${blogPost.content}`);
                                                                alert("Article copied to clipboard!");
                                                            }}
                                                            className="px-8 py-3 rounded-full bg-indigo-600 hover:bg-indigo-500 text-white font-bold shadow-lg transition-transform hover:scale-105"
                                                        >
                                                            Copy Article Markdown
                                                        </button>
                                                    </div>
                                                </div>
                                            </div>
                                        </div>
                                    ) : null}
                                </>
                            )}
                        </div>
                    </div>
                )}

                {/* VIEW D: TERMINAL / LOADING - REDESIGNED FOR LUXURY STEALTH */}
                {showTerminal && (
                    <div className={`w-full h-full relative font-mono text-sm flex flex-col ${mode === 'researcher' && !isWaitingForAutoBuild ? 'bg-white' : 'bg-[#050505]'}`}>
                        {/* Header - Only show for builder mode */}
                        {mode === 'builder' && (
                            <div className="flex items-center justify-between px-6 py-4 border-b border-white/5 bg-[#050505] z-10 shrink-0">
                                {/* Breadcrumbs / Title */}
                                <div className="flex items-center gap-3">
                                    <div className="flex gap-1.5 opacity-30 hover:opacity-100 transition-opacity">
                                        <div className="w-2.5 h-2.5 rounded-full bg-white"></div>
                                        <div className="w-2.5 h-2.5 rounded-full bg-white"></div>
                                    </div>
                                    <div className="h-4 w-px bg-white/10 mx-2"></div>
                                    <span className="text-xs font-medium text-white/40 tracking-[0.2em] uppercase">
                                        {mode === 'builder' ? 'GEMINI_ENGINE::BUILD_V1' : 'GEMINI_RESEARCH::DEEP_SCAN'}
                                    </span>
                                </div>
                                {/* Status */}
                                {mode === 'builder' && (
                                    <div className="flex items-center gap-2">
                                        <div className="relative flex h-2 w-2">
                                            <span className={`animate-ping absolute inline-flex h-full w-full rounded-full opacity-75 ${generationStatus === 'stable' ? 'bg-emerald-500' : 'bg-amber-500'}`}></span>
                                            <span className={`relative inline-flex rounded-full h-2 w-2 ${generationStatus === 'stable' ? 'bg-emerald-500' : 'bg-amber-500'}`}></span>
                                        </div>
                                        <span className="text-[10px] font-bold text-white/40 tracking-widest uppercase">Active</span>
                                    </div>
                                )}
                            </div>
                        )}

                        {/* Body */}
                        <div className={`flex-1 overflow-y-auto scrollbar-none ${mode === 'researcher' && !isWaitingForAutoBuild ? 'flex items-center justify-center' : 'p-8 md:p-12'}`}>
                            {mode === 'researcher' && !isWaitingForAutoBuild ? (
                                // Richer research loading view with live log preview (generic for all activities)
                                <div className="w-full h-full flex flex-col items-center justify-center bg-white">
                                    {currentActivity ? (
                                        <div className="flex flex-col items-center justify-center space-y-6">
                                            <div className="text-8xl animate-bounce flex items-center justify-center" style={{ animationDuration: '2s' }}>
                                                {currentActivity === 'thinking' && '🧠'}
                                                {currentActivity === 'searching' && '🔍'}
                                                {currentActivity === 'reading' && '📖'}
                                                {currentActivity === 'stock' && '📈'}
                                                {currentActivity === 'crypto' && '₿'}
                                                {currentActivity === 'jobs' && '💼'}
                                                {currentActivity === 'video' && '🎥'}
                                                {currentActivity === 'game' && '🎮'}
                                            </div>
                                            {activitySummary && (
                                                <p className="text-lg font-light tracking-wide text-neutral-600 max-w-md text-center px-8">
                                                    {activitySummary}
                                                </p>
                                            )}
                                        </div>
                                    ) : (
                                        <div className="flex flex-col items-center justify-center space-y-4">
                                            <div className="text-6xl animate-pulse flex items-center justify-center">🔬</div>
                                            <p className="text-lg font-light tracking-wide text-neutral-500 max-w-md text-center px-8">
                                                Initializing research...
                                            </p>
                                        </div>
                                    )}

                                    {/* Live research log preview */}
                                    {false && researchLogs.length > 0 && (
                                        <div className="mt-10 w-full max-w-2xl px-6">
                                            <div className="mb-2 flex items-center justify-between">
                                                <p className="text-xs font-semibold tracking-[0.18em] uppercase text-neutral-400">
                                                    Live research log
                                                </p>
                                                <span className="text-[10px] text-neutral-400">
                                                    Showing latest {Math.min(researchLogs.length, 8)} step{researchLogs.length > 1 ? 's' : ''}
                                                </span>
                                            </div>
                                            <div className="max-h-48 overflow-y-auto rounded-2xl border border-neutral-200/80 bg-neutral-50/90 shadow-sm">
                                                <ul className="divide-y divide-neutral-200/80 text-left text-xs leading-relaxed">
                                                    {researchLogs.slice(-8).map((entry, idx) => (
                                                        <li key={idx} className="px-4 py-2 text-neutral-700">
                                                            {entry}
                                                        </li>
                                                    ))}
                                                    <div ref={researchLogsEndRef} />
                                                </ul>
                                            </div>
                                        </div>
                                    )}
                                </div>
                            ) : (
                                <div className="max-w-4xl mx-auto">
                                    {mode === 'builder' ? (
                                        <>
                                            {isWaitingForAutoBuild && (
                                                <div className="space-y-2 text-white/30 font-mono text-xs mb-8">
                                                    <div className="flex gap-3 items-center"><span className="text-emerald-500/50">→</span> SYSTEM_MODE: BUILDER</div>
                                                    <div className="flex gap-3 items-center animate-pulse"><span className="text-emerald-500/50">→</span> CONNECTING_LIVE_API...</div>
                                                    <div className="flex gap-3 items-center animate-pulse delay-75"><span className="text-emerald-500/50">→</span> INGESTING_CONTEXT...</div>
                                                </div>
                                            )}
                                            <div className="font-mono text-xs md:text-sm text-gray-500 leading-7 whitespace-pre-wrap selection:bg-white/20 selection:text-white">
                                                {streamingCode}
                                                <span className="inline-block w-2 h-4 bg-white animate-pulse ml-1 align-middle shadow-[0_0_8px_rgba(255,255,255,0.8)]"></span>
                                            </div>
                                            <div ref={codeEndRef} />
                                        </>
                                    ) : null}
                                </div>
                            )}
                        </div>
                    </div>
                )}

                {/* VIEW E: IDLE STATE */}
                {showIdle && (
                    <div className={`w-full h-full flex flex-col items-center justify-center text-neutral-400 ${isDarkMode ? 'bg-[#1c1c1e]' : 'bg-white'}`}>
                        <div className="w-48 h-48 mb-8 animate-pulse-slow flex items-center justify-center">
                            <img
                                src="https://inrveiaulksfmzsbyzqj.supabase.co/storage/v1/object/public/images/Untitled%20design.svg"
                                alt="Logo"
                                className={`w-full h-full object-contain opacity-80 ${isDarkMode ? 'invert' : ''}`}
                            />
                        </div>
                        <p className={`text-lg font-light tracking-wide max-w-md text-center ${isDarkMode ? 'text-neutral-400' : 'text-neutral-500'}`}>
                            {mode === 'builder'
                                ? (builderContext ? "Building website from research..." : "Describe your vision. I'll handle the research, review, & coding.")
                                : "Ask me to research anything :)"}
                        </p>
                    </div>
                )}
            </div>

            {/* 2. MODE TOGGLE (Top Right) */}
            {!isShareView && (
                <div className={`absolute top-4 right-4 md:top-6 md:right-6 z-30 flex items-center gap-1 md:gap-3 p-1 rounded-full border shadow-xl backdrop-blur-md transition-all overflow-x-auto max-w-[calc(100vw-32px)] scrollbar-hide ${(mode === 'researcher' && !isDarkMode && !activeTheme)
                    ? 'bg-black/5 border-black/10'
                    : 'bg-white/10 border-white/20'
                    }`}>
                    <button
                        onClick={() => toggleMode('researcher')}
                        className={`px-3 py-2 md:px-4 md:py-2 rounded-full text-xs font-bold uppercase tracking-wider transition-all whitespace-nowrap ${mode === 'researcher'
                            ? (isDarkMode ? 'bg-white text-black shadow-sm' : 'bg-black text-white shadow-sm')
                            : (isDarkMode ? 'text-neutral-400 hover:text-black hover:bg-white' : 'text-neutral-500 hover:text-black hover:bg-white')
                            }`}
                    >
                        Research
                    </button>
                    <button
                        onClick={() => toggleMode('notemap')}
                        className={`px-3 py-2 md:px-4 md:py-2 rounded-full text-xs font-bold uppercase tracking-wider transition-all whitespace-nowrap ${mode === 'notemap'
                            ? (isDarkMode ? 'bg-white text-black shadow-sm' : 'bg-black text-white shadow-sm')
                            : (isDarkMode ? 'text-neutral-400 hover:text-black hover:bg-white' : 'text-neutral-500 hover:text-black hover:bg-white')
                            }`}
                    >
                        Map
                    </button>
                </div>
            )}

            {/* 3. FLOATING DOCK */}
            {!isShareView && (
                <div
                    className={`fixed z-50 transition-all duration-300 ease-[cubic-bezier(0.16,1,0.3,1)] ${isDockMinimized
                        ? 'bottom-[max(1.5rem,env(safe-area-inset-bottom))] left-8 w-14 h-14 translate-x-0'
                        : 'bottom-[max(1.5rem,env(safe-area-inset-bottom))] md:bottom-8 left-1/2 -translate-x-1/2 w-[90%] max-w-2xl'
                        }`}
                >
                    <div
                        className={`relative w-full h-full bg-black/50 backdrop-blur-xl border border-white/10 shadow-2xl transition-all duration-300 ease-[cubic-bezier(0.16,1,0.3,1)] overflow-hidden ring-1 ring-white/5 ${isDockMinimized
                            ? 'rounded-full flex items-center justify-center hover:bg-blue-600 hover:border-blue-500 cursor-pointer hover:scale-110 active:scale-95'
                            : 'rounded-[32px] p-2 flex items-end gap-3'
                            }`}
                        onClick={isDockMinimized ? () => setIsDockMinimized(false) : undefined}
                    >
                        {isDockMinimized ? (
                            // Minimized Content
                            <svg className="w-6 h-6 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 4v16m8-8H4"></path></svg>
                        ) : (
                            // Expanded Content
                            <>
                                {/* Minimize Button */}
                                <button
                                    onClick={(e) => { e.stopPropagation(); setIsDockMinimized(true); }}
                                    className="absolute top-4 right-4 text-white/30 hover:text-white transition-colors z-20"
                                    title="Minimize Dock"
                                >
                                    <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M19 9l-7 7-7-7"></path></svg>
                                </button>

                                {/* Logs & Input Area */}
                                <div className="flex-1 flex flex-col min-w-0 gap-2">
                                    <div className="h-32 overflow-y-auto px-4 py-3 mask-image-gradient scrollbar-hide">
                                        <div className="space-y-3">
                                            {logs.length === 0 && (
                                                <p className="text-white/50 text-sm mt-10 text-center italic font-light">
                                                    Tap the microphone to start the {mode === 'builder' ? 'building' : 'research'} session.
                                                </p>
                                            )}
                                            {logs.map(log => (
                                                <div key={log.id} className="text-sm animate-fade-in group">
                                                    {log.type === 'thought' && (
                                                        <div className="flex gap-2">
                                                            <span className="text-purple-400 text-[10px] font-bold uppercase tracking-widest mt-1 opacity-70">Thinking</span>
                                                            <span className="text-white leading-relaxed font-light">{log.text}</span>
                                                        </div>
                                                    )}
                                                    {log.type === 'tool' && (
                                                        <div className="flex gap-2">
                                                            <span className="text-emerald-400 text-[10px] font-bold uppercase tracking-widest mt-1 opacity-70">System</span>
                                                            <span className="text-white leading-relaxed font-medium">{log.text}</span>
                                                        </div>
                                                    )}
                                                    {log.type === 'system' && (
                                                        <div className="text-center text-white/50 text-xs py-1 border-t border-white/5 mt-2">
                                                            {log.text}
                                                        </div>
                                                    )}
                                                    {log.type === 'user' && (
                                                        <div className="flex justify-end animate-fade-in">
                                                            <span className="bg-white/20 text-white px-3 py-1.5 rounded-2xl rounded-tr-sm text-sm max-w-[85%] leading-relaxed shadow-sm backdrop-blur-sm">
                                                                {log.text}
                                                            </span>
                                                        </div>
                                                    )}
                                                </div>
                                            ))}
                                            <div ref={logsEndRef} />
                                        </div>
                                    </div>

                                    {/* Text Input Row */}
                                    <div className="px-3 pb-2 flex items-center gap-2">

                                        {/* 1. Attachment Button (Inside Input Row) */}
                                        {connected && (
                                            <button
                                                onClick={() => fileInputRef.current?.click()}
                                                title="Upload Document or Video"
                                                className="w-10 h-10 shrink-0 rounded-full bg-white/10 hover:bg-white/20 text-white flex items-center justify-center transition-all backdrop-blur-md"
                                            >
                                                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="w-5 h-5">
                                                    <path d="M15.172 7l-6.586 6.586a2 2 0 102.828 2.828l6.414-6.586a4 4 0 00-5.656-5.656l-6.415 6.585a6 6 0 108.486 8.486L20.5 13" strokeLinecap="round" strokeLinejoin="round"></path>
                                                </svg>
                                                <input
                                                    type="file"
                                                    ref={fileInputRef}
                                                    onChange={handleFileUpload}
                                                    className="hidden"
                                                    accept=".pdf,.jpg,.jpeg,.png,.txt,.mp4,.mpeg,.mov,.avi,.mpg,.webm,.wmv,.3gpp"
                                                />
                                            </button>
                                        )}

                                        {/* 2. Input Field */}
                                        <div className="relative flex-1">
                                            <input
                                                type="text"
                                                value={textInput}
                                                onChange={(e) => setTextInput(e.target.value)}
                                                onKeyDown={(e) => e.key === 'Enter' && handleSendText()}
                                                placeholder="Type a message..."
                                                className="w-full bg-white/5 border border-white/10 rounded-full pl-4 pr-10 py-2 text-sm text-white placeholder-white/60 focus:outline-none focus:bg-white/10 focus:border-white/20 transition-all"
                                            />
                                            <button
                                                onClick={handleSendText}
                                                disabled={!textInput.trim()}
                                                className="absolute right-1.5 top-1/2 -translate-y-1/2 p-1.5 rounded-full text-neutral-400 hover:text-white hover:bg-white/10 transition-colors disabled:opacity-0"
                                            >
                                                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="w-4 h-4">
                                                    <path d="M22 2L11 13M22 2l-7 20-4-9-9-4 20-7z" strokeLinecap="round" strokeLinejoin="round" />
                                                </svg>
                                            </button>
                                        </div>
                                    </div>
                                </div>

                                {/* Controls - Mic Button Stack */}
                                <div className="flex flex-col items-center gap-2">
                                    {/* STACKED MOBILE ACTION BUTTONS */}


                                    {/* SHOW CODE (Builder) */}


                                    {/* MIC BUTTON */}
                                    <button
                                        onClick={connected ? disconnect : connect}
                                        className={`w-14 h-14 shrink-0 rounded-full flex items-center justify-center transition-all duration-500 shadow-xl border border-white/10 ${connected
                                            ? isSpeaking
                                                ? 'bg-white text-black scale-110 shadow-white/50'
                                                : 'bg-red-500 text-white hover:bg-red-600'
                                            : mode === 'researcher' ? 'bg-blue-600 text-white hover:bg-blue-500' : 'bg-white text-black hover:bg-neutral-200'
                                            }`}
                                    >
                                        {connected ? (
                                            <div className={`w-4 h-4 rounded-[2px] ${isSpeaking ? 'bg-black animate-pulse' : 'bg-white'}`} />
                                        ) : (
                                            <svg viewBox="0 0 24 24" fill="currentColor" className="w-6 h-6">
                                                <path d="M12 14c1.66 0 3-1.34 3-3V5c0-1.66-1.34-3-3-3S9 3.34 9 5v6c0 1.66 1.34 3 3 3z" />
                                                <path d="M17 11c0 2.76-2.24 5-5 5s-5-2.24-5-5H5c0 3.53 2.61 6.43 6 6.92V19h2v-2.08c3.39-.49 6-3.39 6-6.92h-2z" />
                                            </svg>
                                        )}
                                    </button>
                                </div>
                            </>
                        )}
                    </div>
                </div>
            )
            }

            {
                usageLimitModal && (
                    <UsageLimitModal
                        isOpen={usageLimitModal.isOpen}
                        onClose={() => setUsageLimitModal(null)}
                        onUpgrade={() => {
                            setUsageLimitModal(null);
                            onUpgrade?.();
                        }}
                        isDarkMode={isDarkMode}
                        usageType={usageLimitModal.usageType}
                        current={usageLimitModal.current}
                        limit={usageLimitModal.limit}
                        isSubscribed={isSubscribed}
                    />
                )
            }


            {
                insufficientCreditsModal && (
                    <InsufficientCreditsModal
                        isOpen={insufficientCreditsModal.isOpen}
                        onClose={() => setInsufficientCreditsModal(null)}
                        onUpgrade={() => {
                            setInsufficientCreditsModal(null);
                            onUpgrade?.();
                        }}
                        isDarkMode={isDarkMode}
                        operation={insufficientCreditsModal.operation}
                        creditsNeeded={insufficientCreditsModal.cost}
                        currentCredits={insufficientCreditsModal.current}
                    />
                )
            }

            {
                shareModalOpen && (
                    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
                        <div
                            className="absolute inset-0 bg-black/60 backdrop-blur-sm"
                            onClick={() => {
                                if (shareModalStatus === 'working') return;
                                setShareModalOpen(false);
                            }}
                        />

                        <div className={`relative w-full max-w-md rounded-2xl p-6 shadow-2xl ${isDarkMode
                            ? 'bg-[#1c1c1e] border border-[#3a3a3c]'
                            : 'bg-white border border-gray-200'
                            }`}>
                            <div className="flex items-start justify-between gap-4">
                                <div>
                                    <h3 className={`text-xl font-semibold ${isDarkMode ? 'text-white' : 'text-gray-900'}`}>
                                        Share report
                                    </h3>
                                    <p className={`text-sm mt-1 ${isDarkMode ? 'text-gray-400' : 'text-gray-600'}`}>
                                        Your research is private by default.
                                    </p>
                                </div>

                                <button
                                    onClick={() => {
                                        if (shareModalStatus === 'working') return;
                                        setShareModalOpen(false);
                                    }}
                                    className={`${isDarkMode ? 'text-white/50 hover:text-white' : 'text-gray-400 hover:text-gray-700'} transition-colors`}
                                    title="Close"
                                >
                                    ✕
                                </button>
                            </div>

                            {shareModalStatus === 'confirm' && (
                                <div className="mt-5 space-y-4">
                                    <div className={`p-4 rounded-xl ${isDarkMode ? 'bg-white/5' : 'bg-gray-50'}`}>
                                        <p className={`${isDarkMode ? 'text-gray-300' : 'text-gray-700'} text-sm leading-relaxed`}>
                                            Making this report public will create a shareable link that anyone can view.
                                        </p>
                                    </div>
                                    <div className="flex gap-3">
                                        <button
                                            onClick={() => setShareModalOpen(false)}
                                            className={`flex-1 py-3 px-4 rounded-xl font-medium transition-colors ${isDarkMode
                                                ? 'bg-white/10 text-white hover:bg-white/20'
                                                : 'bg-gray-100 text-gray-900 hover:bg-gray-200'
                                                }`}
                                        >
                                            Cancel
                                        </button>
                                        <button
                                            onClick={handleMakePublic}
                                            className="flex-1 py-3 px-4 rounded-xl font-medium bg-gradient-to-r from-blue-600 to-cyan-500 text-white hover:opacity-90 transition-opacity"
                                        >
                                            Make public
                                        </button>
                                    </div>
                                </div>
                            )}

                            {shareModalStatus === 'working' && (
                                <div className="mt-6 flex flex-col items-center gap-3">
                                    <div className="w-10 h-10 border-4 border-blue-600 border-t-transparent rounded-full animate-spin"></div>
                                    <p className={`${isDarkMode ? 'text-gray-400' : 'text-gray-600'} text-sm`}>
                                        Creating share link...
                                    </p>
                                </div>
                            )}

                            {(shareModalStatus === 'ready' || shareModalStatus === 'error') && (
                                <div className="mt-5 space-y-4">
                                    {shareModalError && (
                                        <div className={`p-4 rounded-xl ${isDarkMode ? 'bg-red-500/10 border border-red-500/20 text-red-200' : 'bg-red-50 border border-red-200 text-red-700'}`}>
                                            <p className="text-sm">{shareModalError}</p>
                                        </div>
                                    )}

                                    <div className={`p-3 rounded-xl border ${isDarkMode ? 'bg-white/5 border-white/10' : 'bg-gray-50 border-gray-200'}`}>
                                        <div className="flex items-center gap-2">
                                            <input
                                                value={shareModalLink}
                                                readOnly
                                                className={`flex-1 bg-transparent text-sm outline-none ${isDarkMode ? 'text-white' : 'text-gray-900'}`}
                                            />
                                            <button
                                                onClick={handleCopyShareLink}
                                                disabled={!shareModalLink}
                                                className={`px-3 py-2 rounded-lg text-sm font-medium transition-colors ${isDarkMode
                                                    ? 'bg-white/10 text-white hover:bg-white/20 disabled:opacity-40'
                                                    : 'bg-gray-200 text-gray-900 hover:bg-gray-300 disabled:opacity-40'
                                                    }`}
                                            >
                                                {shareFeedback ? 'Copied' : 'Copy'}
                                            </button>
                                        </div>
                                    </div>

                                    {shareModalStatus === 'error' && (
                                        <button
                                            onClick={handleMakePublic}
                                            className="w-full py-3 px-4 rounded-xl font-medium bg-gradient-to-r from-blue-600 to-cyan-500 text-white hover:opacity-90 transition-opacity"
                                        >
                                            Try again
                                        </button>
                                    )}
                                </div>
                            )}
                        </div>
                    </div>
                )
            }

            {
                isShareView && researchData && (
                    <SharedReportAssistant report={researchData} isDarkMode={isDarkMode} />
                )
            }
        </div >
    );
};
