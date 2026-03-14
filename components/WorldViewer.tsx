import React, { useEffect, useRef, useState } from 'react';
import { WebGLRenderer, Scene, PerspectiveCamera, Clock, Color } from 'three';
import { SparkRenderer, SplatMesh, SparkControls } from '@sparkjsdev/spark';
import {
    WorldAsset,
    ResearchProject,
    KnowledgeBaseFile,
    UploadedFile
} from '../types';
import AnnotationCanvas, { AnnotationCanvasHandle } from './AnnotationCanvas';
import { compositeImages, dataUrlToBlob, downloadDataUrl } from '../utils/canvasComposite';
import { storageService } from '../services/storageService';

interface WorldViewerProps {
    world: WorldAsset;
    onClose: () => void;
    projectId?: string;
    project?: ResearchProject;
    onProjectUpdate?: (project: ResearchProject) => void;
}

export const WorldViewer: React.FC<WorldViewerProps> = ({ world, onClose, projectId, project, onProjectUpdate }) => {
    const containerRef = useRef<HTMLDivElement>(null);
    const annotationCanvasRef = useRef<AnnotationCanvasHandle>(null);
    const rendererRef = useRef<WebGLRenderer | null>(null);
    const sceneRef = useRef<Scene | null>(null);
    const cameraRef = useRef<PerspectiveCamera | null>(null);
    const controlsRef = useRef<SparkControls | null>(null);

    const [error, setError] = useState<string | null>(null);
    const [loading, setLoading] = useState(true);
    const [annotationMode, setAnnotationMode] = useState(false);
    const [containerSize, setContainerSize] = useState({ width: 0, height: 0 });
    const [saving, setSaving] = useState(false);

    const annotationModeRef = useRef(annotationMode);
    useEffect(() => {
        annotationModeRef.current = annotationMode;
    }, [annotationMode]);

    useEffect(() => {
        if (!containerRef.current) return;

        let renderer: WebGLRenderer | null = null;
        let scene: Scene | null = null;
        let camera: PerspectiveCamera | null = null;
        let spark: SparkRenderer | null = null;
        let controls: SparkControls | null = null;
        let animationId: number | null = null;

        // Track container size for annotation canvas
        const updateSize = () => {
            if (containerRef.current) {
                setContainerSize({
                    width: containerRef.current.clientWidth,
                    height: containerRef.current.clientHeight
                });
            }
        };

        const handleResize = () => {
            if (!containerRef.current || !camera || !renderer) return;
            const w = containerRef.current.clientWidth;
            const h = containerRef.current.clientHeight;
            camera.aspect = w / h;
            camera.updateProjectionMatrix();
            renderer.setSize(w, h);
            updateSize();
        };

        const init = async () => {
            try {
                // Find the splat URL from World Labs response structure
                const findAssetUrl = (obj: any): string => {
                    if (typeof obj === 'string') {
                        const low = obj.toLowerCase();
                        if (low.endsWith('.spz') || low.endsWith('.ply')) return obj;
                    } else if (typeof obj === 'object' && obj !== null) {
                        // Check for spz_urls with resolution options (World Labs structure)
                        if (obj.spz_urls) {
                            // Prefer full_res, then 500k, then 100k
                            if (obj.spz_urls.full_res) return obj.spz_urls.full_res;
                            if (obj.spz_urls['500k']) return obj.spz_urls['500k'];
                            if (obj.spz_urls['100k']) return obj.spz_urls['100k'];
                        }

                        // Priority to names like 'spz', 'ply', 'splat'
                        const keys = Object.keys(obj);
                        for (const key of ['spz', 'ply', 'splat', 'url', 'stream_url']) {
                            if (typeof obj[key] === 'string') {
                                const val = obj[key].toLowerCase();
                                if (val.endsWith('.spz') || val.endsWith('.ply')) return obj[key];
                            }
                        }

                        // Recursively search nested objects
                        for (const value of Object.values(obj)) {
                            const result = findAssetUrl(value);
                            if (result) return result;
                        }
                    }
                    return '';
                };

                let splatUrl = '';

                // Handle nested data structure from World Labs API
                const worldData = world.data?.data || world.data;

                if (worldData?.assets) {
                    splatUrl = findAssetUrl(worldData.assets);
                }

                if (!splatUrl) {
                    console.error('No 3D asset found in world data:', world);
                    setError(`No 3D asset found. Please use the fallback link below to view in browser.`);
                    setLoading(false);
                    return;
                }

                console.log('[WorldViewer] Loading splat from:', splatUrl);

                // Proxy the URL through our backend to bypass CORS
                const proxiedUrl = `/api/media?op=proxy-world-asset&url=${encodeURIComponent(splatUrl)}`;
                console.log('[WorldViewer] Using proxied URL:', proxiedUrl);

                // Setup THREE.js
                scene = new Scene();
                scene.background = new Color(0x000000);

                const width = containerRef.current!.clientWidth;
                const height = containerRef.current!.clientHeight;

                camera = new PerspectiveCamera(60, width / height, 0.1, 1000);
                // Position camera at origin, looking forward (negative Z in OpenGL)
                camera.position.set(0, 0, 0);
                camera.lookAt(0, 0, -1);

                renderer = new WebGLRenderer({
                    antialias: false,
                    preserveDrawingBuffer: true
                });
                renderer.setSize(width, height);
                renderer.setPixelRatio(window.devicePixelRatio);
                containerRef.current!.appendChild(renderer.domElement);

                // Store refs for external access
                rendererRef.current = renderer;
                sceneRef.current = scene;
                cameraRef.current = camera;
                updateSize();

                // Controls
                controls = new SparkControls({ canvas: renderer.domElement });
                controlsRef.current = controls;

                // Spark Renderer - add as child of camera for better precision
                spark = new SparkRenderer({ renderer });
                camera.add(spark);
                scene.add(camera);

                // Load Splat using proxied URL
                const splat = new SplatMesh({ url: proxiedUrl });

                // Re-orient from OpenCV to OpenGL coordinates
                // OpenCV: Y down, Z forward → OpenGL: Y up, Z backward
                // Quaternion (1,0,0,0) rotates 180° around X axis
                splat.quaternion.set(1, 0, 0, 0);
                splat.position.set(0, 0, -3); // Place splat in front of camera
                splat.scale.setScalar(1.0);

                scene.add(splat);

                await splat.initialized;
                setLoading(false);

                const clock = new Clock();

                renderer.setAnimationLoop(() => {
                    if (!renderer || !scene || !camera || !controls) return;

                    const delta = clock.getDelta();
                    // Only update controls if not in annotation mode - use ref to avoid stale closure
                    if (!annotationModeRef.current) {
                        controls.update(camera);
                    }
                    renderer.render(scene, camera);
                });

                window.addEventListener('resize', handleResize);

            } catch (e: any) {
                console.error('Failed to init WorldViewer:', e);
                setError(e.message || 'Failed to load 3D viewer. Please use the fallback link below.');
                setLoading(false);
            }
        };

        init();

        return () => {
            window.removeEventListener('resize', handleResize);
            if (renderer) {
                renderer.setAnimationLoop(null);
                renderer.dispose();
                containerRef.current?.removeChild(renderer.domElement);
            }
            if (spark) (spark as any).dispose?.();
            if (controls) (controls as any).dispose?.();
            scene?.clear();
        };
    }, [world]);

    const captureScreen = async (): Promise<string> => {
        const renderer = rendererRef.current;
        const scene = sceneRef.current;
        const camera = cameraRef.current;

        if (!renderer || !scene || !camera) throw new Error('Renderer not initialized');

        // Ensure we have a fresh render for the screenshot
        renderer.render(scene, camera);

        // Get 3D viewer screenshot
        const viewerDataUrl = renderer.domElement.toDataURL('image/png');

        // Get annotation canvas if it exists
        const annotationDataUrl = annotationCanvasRef.current?.toDataURL('image/png');

        // Composite both images
        const composite = await compositeImages(viewerDataUrl, annotationDataUrl);
        return composite;
    };

    const handleDownload = async () => {
        try {
            const dataUrl = await captureScreen();
            const filename = `world-${world.id}-${Date.now()}.png`;
            downloadDataUrl(dataUrl, filename);
        } catch (e: any) {
            console.error('Failed to download screenshot:', e);
            alert('Failed to download screenshot');
        }
    };

    const handleSaveToAssets = async () => {
        const id = project?.id || projectId;
        if (!id || saving) return;

        setSaving(true);
        try {
            // Use provided project object or fetch fresh from storage
            const currentProject = project || await storageService.getResearchProject(id);

            if (!currentProject) {
                console.warn('Project not found to link asset:', id);
                alert('Screenshot uploaded but could not be linked to project.');
                return;
            }

            // captureScreen already handles compositing annotations
            const compositeDataUrl = await captureScreen();
            const blob = dataUrlToBlob(compositeDataUrl);

            const filename = `screenshot-${Date.now()}.png`;
            const uploadRes = await fetch(`/api/media?op=upload-blob&projectId=${id}&filename=${filename}&contentType=image/png`, {
                method: 'POST',
                body: blob
            });

            if (!uploadRes.ok) throw new Error('Failed to upload screenshot');

            const resData = await uploadRes.json();

            // Create KnowledgeBaseFile (Legacy/Compatibility)
            const newFile: KnowledgeBaseFile = {
                id: resData.url.split('/').pop() || Date.now().toString(),
                name: filename,
                type: 'image/png',
                size: blob.size,
                url: resData.url,
                storagePath: resData.pathname || '',
                uploadedAt: Date.now()
            };

            // Create UploadedFile (Data Tab / New Model)
            const newUploadedFile: UploadedFile = {
                id: newFile.id,
                name: newFile.id,
                uri: resData.url,
                mimeType: newFile.type,
                sizeBytes: blob.size,
                displayName: newFile.name,
                uploadedAt: newFile.uploadedAt,
                url: resData.url,
                summary: `World View screenshot of: ${world.prompt}`
            };

            const updatedKnowledgeBase = [newFile, ...(currentProject.knowledgeBase || [])];
            const updatedUploadedFiles = [newUploadedFile, ...(currentProject.uploadedFiles || [])];

            const updatedProject = {
                ...currentProject,
                knowledgeBase: updatedKnowledgeBase,
                uploadedFiles: updatedUploadedFiles,
                lastModified: Date.now()
            };

            await storageService.updateResearchProject(id, {
                knowledgeBase: updatedKnowledgeBase,
                uploadedFiles: updatedUploadedFiles
            });

            if (onProjectUpdate) {
                onProjectUpdate(updatedProject);
            }

            alert('Screenshot saved to assets!');

        } catch (e: any) {
            console.error('Failed to save to assets:', e);
            alert('Failed to save to assets');
        } finally {
            setSaving(false);
        }
    };

    const handleAnnotationCapture = (dataUrl: string) => {
        // This is called by AnnotationCanvas when needed
        // Currently not used, but available for future features
    };

    return (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/90 backdrop-blur-md">
            <div className="relative w-full h-full max-w-7xl max-h-[90vh] mx-auto p-4 flex flex-col">

                {/* Header */}
                <div className="flex items-center justify-between mb-2 text-white">
                    <h2 className="text-lg font-semibold truncate">{world.prompt}</h2>

                    <div className="flex items-center gap-2">
                        {/* Annotation Toggle */}
                        <button
                            onClick={() => setAnnotationMode(!annotationMode)}
                            className={`px-4 py-2 rounded-lg transition-colors font-medium ${annotationMode
                                ? 'bg-indigo-600 hover:bg-indigo-700'
                                : 'bg-white/10 hover:bg-white/20'
                                }`}
                            title="Toggle Annotation Mode"
                        >
                            {annotationMode ? '✏️ Annotating' : '✏️ Annotate'}
                        </button>

                        {/* Download Button */}
                        <button
                            onClick={handleDownload}
                            className="px-4 py-2 bg-white/10 hover:bg-white/20 rounded-lg transition-colors font-medium"
                            title="Download Screenshot"
                        >
                            📥 Download
                        </button>

                        {/* Save to Assets Button */}
                        {projectId && (
                            <button
                                onClick={handleSaveToAssets}
                                disabled={saving}
                                className="px-4 py-2 bg-green-600 hover:bg-green-700 disabled:opacity-50 disabled:cursor-not-allowed rounded-lg transition-colors font-medium"
                                title="Save to Assets"
                            >
                                {saving ? '💾 Saving...' : '💾 Save to Assets'}
                            </button>
                        )}

                        {/* Close Button */}
                        <button
                            onClick={onClose}
                            className="p-2 hover:bg-white/10 rounded-full transition-colors"
                            title="Close Viewer"
                        >
                            <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                            </svg>
                        </button>
                    </div>
                </div>

                {/* 3D Container */}
                <div ref={containerRef} className="flex-1 w-full bg-black rounded-xl overflow-hidden relative border border-white/10">
                    {loading && (
                        <div className="absolute inset-0 flex items-center justify-center text-white bg-black/50 z-10">
                            <div className="flex flex-col items-center gap-2">
                                <svg className="w-8 h-8 animate-spin text-indigo-500" viewBox="0 0 24 24" fill="none">
                                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
                                </svg>
                                <span>Loading 3D World...</span>
                            </div>
                        </div>
                    )}

                    {error && (
                        <div className="absolute inset-0 flex items-center justify-center text-red-500 bg-black/80 z-20">
                            <div className="text-center p-6 bg-gray-900 rounded-xl border border-red-500/20 max-w-md">
                                <p className="font-semibold mb-2">Error</p>
                                <p className="mb-1">{error}</p>
                                {(world.data?.data?.world_marble_url || world.data?.world_marble_url) && (
                                    <a
                                        href={world.data?.data?.world_marble_url || world.data?.world_marble_url}
                                        target="_blank"
                                        rel="noreferrer"
                                        className="mt-4 inline-block px-4 py-2 bg-indigo-600 hover:bg-indigo-700 rounded-lg text-sm transition-colors text-white font-medium"
                                    >
                                        🌍 Open in World Labs Viewer
                                    </a>
                                )}
                            </div>
                        </div>
                    )}

                    {/* Annotation Canvas Overlay */}
                    {containerSize.width > 0 && containerSize.height > 0 && (
                        <AnnotationCanvas
                            ref={annotationCanvasRef}
                            width={containerSize.width}
                            height={containerSize.height}
                            enabled={annotationMode}
                            onToggle={setAnnotationMode}
                            onCapture={handleAnnotationCapture}
                        />
                    )}
                </div>

                {/* Controls Hint */}
                <div className="mt-2 text-center text-xs text-white/50">
                    {annotationMode
                        ? '🎨 Annotation Mode Active - Use toolbar to draw • Toggle off to navigate'
                        : 'Left Click: Rotate • Right Click: Pan • Scroll: Zoom • Arrow Keys: Look/Move'
                    }
                </div>
            </div>
        </div>
    );
};
