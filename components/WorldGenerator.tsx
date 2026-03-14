import React, { useState, useMemo } from 'react';
import { worldLabsService, OperationResponse } from '../services/worldLabsService';
import { mediaService } from '../services/mediaService';
import { AssetItem } from '../types';
import { CreditOperation } from '../services/creditService';

interface WorldGeneratorProps {
    onWorldGenerated: (world: OperationResponse) => void;
    onError: (error: string) => void;
    assets: AssetItem[];
    isDarkMode: boolean;
    checkCredits: (operation: CreditOperation) => Promise<boolean>;
    deductCredits: (operation: CreditOperation) => Promise<boolean>;
    autoFocus?: boolean;
}

// Icons
// ... (Icon components remain the same, simplified for brevity in replacement)
const IconCube = () => (
    <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M20 7l-8-4-8 4m16 0l-8 4m8-4v10l-8 4m0-10L4 7m8 4v10M4 7v10l8 4" />
    </svg>
);
const IconMagic = () => (
    <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19.428 15.428a2 2 0 00-1.022-.547l-2.384-.477a6 6 0 00-3.86.517l-.318.158a6 6 0 01-3.86.517L6.05 15.21a2 2 0 00-1.806.547M8 4h8l-1 1v5.172a2 2 0 00.586 1.414l5 5c1.26 1.26.367 3.414-1.415 3.414H4.828c-1.782 0-2.674-2.154-1.414-3.414l5-5A2 2 0 009 10.172V5L8 4z" />
    </svg>
);
const IconImage = () => (
    <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" />
    </svg>
);
const IconImages = () => (
    <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 11H5m14 0a2 2 0 012 2v6a2 2 0 01-2 2H5a2 2 0 01-2-2v-6a2 2 0 012-2m14 0V9a2 2 0 00-2-2M5 11V9a2 2 0 012-2m0 0V5a2 2 0 012-2h6a2 2 0 012 2v2M7 7h10" />
    </svg>
);
const IconVideo = () => (
    <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 10l4.553-2.276A1 1 0 0121 8.618v6.764a1 1 0 01-1.447.894L15 14M5 18h8a2 2 0 002-2V8a2 2 0 00-2-2H5a2 2 0 00-2 2v8a2 2 0 002 2z" />
    </svg>
);
const IconCloudUpload = () => (
    <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M15 13l-3-3m0 0l-3 3m3-3v12" />
    </svg>
);

const Spinner = () => (
    <svg className="animate-spin -ml-1 mr-3 h-5 w-5 text-current" fill="none" viewBox="0 0 24 24">
        <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
        <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
    </svg>
);

export const WorldGenerator: React.FC<WorldGeneratorProps> = ({ onWorldGenerated, onError, assets, isDarkMode, checkCredits, deductCredits, autoFocus }) => {
    const [activeTab, setActiveTab] = useState<'text' | 'image' | 'video' | 'multi-image'>('text');
    const [inputMode, setInputMode] = useState<'upload' | 'asset'>('upload');
    const [textPrompt, setTextPrompt] = useState('');
    const inputRef = React.useRef<HTMLTextAreaElement>(null);

    React.useEffect(() => {
        if (autoFocus && inputRef.current) {
            inputRef.current.focus();
        }
    }, [autoFocus]);

    const [selectedFile, setSelectedFile] = useState<File | null>(null);
    const [selectedAsset, setSelectedAsset] = useState<AssetItem | null>(null);
    const [selectedAssets, setSelectedAssets] = useState<AssetItem[]>([]);
    const [isGenerating, setIsGenerating] = useState(false);
    const [generatedWorld, setGeneratedWorld] = useState<OperationResponse['response'] | null>(null);
    const [progress, setProgress] = useState<string>('');
    const [error, setError] = useState<string | null>(null);

    // Filter compatible assets based on active tab
    const compatibleAssets = useMemo(() => {
        if (!assets) return [];
        if (activeTab === 'image' || activeTab === 'multi-image') {
            return assets.filter(a => {
                const type = a.type;
                if (type === 'video' || type === 'podcast' || type === 'book' || type === 'table' || type === 'leadform' || type === 'doc' || type === 'website' || type === 'blog') return false;
                return true;
            });
        } else if (activeTab === 'video') {
            return assets.filter(a => a.type === 'video');
        }
        return [];
    }, [assets, activeTab]);

    const handleAssetToggle = (asset: AssetItem) => {
        if (activeTab === 'multi-image') {
            setSelectedAssets(prev => {
                const exists = prev.find(a => a.id === asset.id);
                if (exists) {
                    return prev.filter(a => a.id !== asset.id);
                } else {
                    if (prev.length >= 8) return prev; // Max 8 images
                    return [...prev, asset];
                }
            });
        } else {
            setSelectedAsset(asset);
        }
    };

    const handleGenerate = async () => {
        // Credit Check
        const hasCredits = await checkCredits('worldGeneration');
        if (!hasCredits) return;

        const success = await deductCredits('worldGeneration');
        if (!success) {
            setError('Failed to deduct credits');
            return;
        }

        setIsGenerating(true);
        setError(null);
        setProgress('Initializing job...');
        // setGeneratedWorld(null); // Removed as per instruction

        try {
            if (!textPrompt) throw new Error('Please describe the world');

            let request: any = {
                world_prompt: {
                    type: activeTab,
                    text_prompt: textPrompt
                }
            };

            // Input Handling
            const handleMediaInput = async () => {
                const isMulti = activeTab === 'multi-image';
                const isVideo = activeTab === 'video';

                if (isMulti) {
                    if (selectedAssets.length < 2) throw new Error('Please select at least 2 images (Max 8)');

                    setProgress('Preparing images...');
                    const remappedAssets = await Promise.all(selectedAssets.map(async (asset, index) => {
                        const remoteUrl = await mediaService.ensureRemoteUrl(asset.url);
                        return {
                            content: { source: 'uri', uri: remoteUrl || asset.url },
                            azimuth: (360 / selectedAssets.length) * index
                        };
                    }));

                    request.world_prompt.multi_image_prompt = remappedAssets;
                    return;
                }

                if (inputMode === 'upload') {
                    if (!selectedFile) throw new Error(`Please select a ${isVideo ? 'video' : 'image'}`);
                    setProgress(`Uploading ${isVideo ? 'video' : 'image'}...`);
                    const mediaId = await worldLabsService.uploadMedia(selectedFile);
                    request.world_prompt[isVideo ? 'video_prompt' : 'image_prompt'] = { source: 'media_asset', media_asset_id: mediaId };
                } else {
                    if (!selectedAsset) throw new Error(`Please select a ${isVideo ? 'video' : 'image'} asset`);
                    setProgress('Preparing asset...');
                    const remoteUrl = await mediaService.ensureRemoteUrl(selectedAsset.url);
                    request.world_prompt[isVideo ? 'video_prompt' : 'image_prompt'] = { source: 'uri', uri: remoteUrl || selectedAsset.url };
                }
            };

            if (activeTab !== 'text') {
                await handleMediaInput();
            }

            if (activeTab === 'video') request.world_prompt.type = 'video';

            setProgress('Starting generation...');
            // Start the job, don't wait for completion here
            const operation = await worldLabsService.generateWorld(request);

            // Notify parent immediately with "generating" status
            onWorldGenerated(operation);

            // Allow user to start another or see status in queue
            setTextPrompt('');
            setSelectedFile(null);

        } catch (err: any) {
            console.error(err);
            setError(err.message || 'Failed to start generation');
            onError(err.message);
        } finally {
            setIsGenerating(false);
            setProgress('');
        }
    };

    const tabs = [
        { id: 'text', label: 'Text', icon: IconMagic },
        { id: 'image', label: 'Image', icon: IconImage },
        { id: 'multi-image', label: 'Multi View', icon: IconImages },
        { id: 'video', label: 'Video', icon: IconVideo }
    ];

    const formatDate = (timestamp: number) => {
        return new Date(timestamp).toLocaleDateString('en-US', {
            month: 'short',
            day: 'numeric',
            year: 'numeric'
        });
    };

    return (
        <div className={`w-full space-y-4 animate-in fade-in duration-700 ${!isDarkMode ? 'text-gray-900' : ''}`}>
            {/* Mode Selection */}
            <div className="flex flex-wrap items-center justify-between gap-3 mb-2">
                <div className={`flex flex-wrap p-1 ${isDarkMode ? 'bg-[#1c1c1e]' : 'bg-gray-100'} rounded-xl border ${isDarkMode ? 'border-gray-800' : 'border-gray-200'}`}>
                    {tabs.map((tab) => (
                        <button
                            key={tab.id}
                            onClick={() => {
                                setActiveTab(tab.id as any);
                                if (tab.id !== 'text') setInputMode(tab.id === 'multi-image' ? 'asset' : 'upload');
                            }}
                            className={`
                                relative px-4 py-1.5 text-xs font-bold rounded-lg transition-all duration-300 flex items-center gap-2
                                ${activeTab === tab.id
                                    ? (isDarkMode ? 'bg-gray-800 text-white shadow-sm ring-1 ring-white/10' : 'bg-white text-indigo-600 shadow-sm ring-1 ring-black/5')
                                    : (isDarkMode ? 'text-gray-500 hover:text-gray-300' : 'text-gray-500 hover:text-indigo-600')
                                }
                            `}
                        >
                            <tab.icon />
                            <span>{tab.label}</span>
                        </button>
                    ))}
                </div>
            </div>

            <div className="grid grid-cols-1 xl:grid-cols-12 gap-6 items-start">
                {/* Left Column: Controls (Prompt & Inputs) */}
                <div className={`xl:col-span-5 space-y-6 ${activeTab !== 'text' ? 'order-2 xl:order-1' : ''}`}>
                    {/* Prompt Input */}
                    <div className={`relative rounded-2xl p-5 ${isDarkMode ? 'bg-[#111111]/50 border-[#3d3d3f]/40' : 'bg-gray-50 border-gray-200'} border`}>
                        <div className="flex items-center gap-2 mb-4">
                            <div className="p-2 rounded-lg bg-indigo-500/10 text-indigo-500">
                                <IconMagic />
                            </div>
                            <span className={`text-sm font-bold uppercase tracking-widest ${isDarkMode ? 'text-gray-400' : 'text-gray-500'}`}>Describe World</span>
                        </div>

                        <textarea
                            ref={inputRef}
                            value={textPrompt}
                            onChange={(e) => setTextPrompt(e.target.value)}
                            placeholder="Describe your world in detail (e.g., 'A bioluminescent forest at night with floating crystals and neon flora'...)"
                            className={`w-full bg-transparent p-0 ${isDarkMode ? 'text-white' : 'text-gray-900'} placeholder-gray-500 text-lg border-none focus:ring-0 resize-none min-h-[160px] leading-relaxed mb-4`}
                        />

                        <div className={`flex justify-between items-center pt-4 border-t ${isDarkMode ? 'border-gray-800' : 'border-gray-100'}`}>
                            <span className={`text-xs ${isDarkMode ? 'text-gray-500' : 'text-gray-400'}`}>{textPrompt.length} characters</span>
                            <div className="flex gap-2">
                                <button
                                    onClick={() => setTextPrompt('')}
                                    className={`p-2 rounded-full hover:bg-black/5 transition-colors ${isDarkMode ? 'text-gray-500 hover:text-white' : 'text-gray-400 hover:text-gray-900'}`}
                                    title="Reset Prompt"
                                >
                                    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" /></svg>
                                </button>
                            </div>
                        </div>
                    </div>

                    {/* Generate Button Container */}
                    <div className="relative group">
                        <div className={`absolute -inset-1 bg-gradient-to-r from-indigo-500 to-purple-600 rounded-[2rem] blur opacity-25 group-hover:opacity-40 transition duration-1000 group-hover:duration-200`}></div>
                        <button
                            onClick={handleGenerate}
                            disabled={isGenerating}
                            className={`
                                relative w-full py-3.5 rounded-2xl font-bold text-base flex items-center justify-center gap-3 transition-all duration-300
                                ${isGenerating
                                    ? (isDarkMode ? 'bg-[#2c2c2e] cursor-wait text-gray-500' : 'bg-gray-100 cursor-wait text-gray-400')
                                    : 'bg-[#0071e3] text-white hover:bg-[#0077ed] hover:scale-[1.01]'
                                }
                            `}
                        >
                            {isGenerating ? (
                                <>
                                    <Spinner />
                                    <span className="tracking-tight uppercase">{progress}</span>
                                </>
                            ) : (
                                <>
                                    <IconCube /> <span className="uppercase tracking-widest">Generate World</span>
                                </>
                            )}
                        </button>
                    </div>

                    {error && (
                        <div className={`p-4 rounded-2xl flex items-start gap-3 ${isDarkMode ? 'bg-red-500/10 text-red-400 border border-red-500/20' : 'bg-red-50 text-red-700 border border-red-100'}`}>
                            <svg className="w-5 h-5 flex-shrink-0 mt-0.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>
                            <p className="text-sm font-semibold">{error}</p>
                        </div>
                    )}
                </div>

                {/* Right Column: Reference Assets or Tips */}
                <div className={`xl:col-span-7 ${activeTab !== 'text' ? 'order-1 xl:order-2' : ''}`}>
                    {(activeTab !== 'text') ? (
                        <div className={`rounded-2xl border ${isDarkMode ? 'bg-[#111111]/50 border-[#3d3d3f]/40' : 'bg-gray-50 border-gray-200'} p-5 flex flex-col h-full min-h-[400px]`}>
                            {/* Sub-Header / Toggle */}
                            {activeTab !== 'multi-image' && (
                                <div className="flex items-center justify-between mb-6">
                                    <div className="flex items-center gap-2">
                                        <div className={`p-2 rounded-lg ${isDarkMode ? 'bg-gray-800 text-gray-400' : 'bg-gray-100 text-gray-600'}`}>
                                            {activeTab === 'video' ? <IconVideo /> : <IconImage />}
                                        </div>
                                        <span className={`font-bold text-sm tracking-wider uppercase hidden md:block ${isDarkMode ? 'text-gray-300' : 'text-gray-700'}`}>Structure Guide</span>
                                    </div>
                                    <div className={`flex ${isDarkMode ? 'bg-gray-800' : 'bg-gray-100'} p-1 rounded-full`}>
                                        <button onClick={() => setInputMode('upload')} className={`px-5 py-1.5 text-xs font-bold rounded-full transition-all ${inputMode === 'upload' ? (isDarkMode ? 'bg-gray-700 text-white shadow-lg' : 'bg-white text-indigo-600 shadow-sm') : (isDarkMode ? 'text-gray-500' : 'text-gray-500')}`}>Upload</button>
                                        <button onClick={() => setInputMode('asset')} className={`px-5 py-1.5 text-xs font-bold rounded-full transition-all ${inputMode === 'asset' ? (isDarkMode ? 'bg-gray-700 text-white shadow-lg' : 'bg-white text-indigo-600 shadow-sm') : (isDarkMode ? 'text-gray-500' : 'text-gray-500')}`}>Assets</button>
                                    </div>
                                </div>
                            )}

                            <div className={`flex-1 rounded-2xl ${isDarkMode ? 'bg-[#000000]/30 border-gray-800' : 'bg-gray-50 border-gray-200'} border flex flex-col relative overflow-hidden`}>
                                {inputMode === 'upload' && activeTab !== 'multi-image' ? (
                                    <div className={`flex-1 flex flex-col items-center justify-center cursor-pointer group transition-all duration-300 ${isDarkMode ? 'hover:bg-indigo-500/5' : 'hover:bg-indigo-500/5'}`}>
                                        <input
                                            type="file"
                                            accept={activeTab === 'video' ? "video/*" : "image/*"}
                                            onChange={(e) => setSelectedFile(e.target.files?.[0] || null)}
                                            className="absolute inset-0 opacity-0 cursor-pointer z-20"
                                        />
                                        <div className={`p-6 ${isDarkMode ? 'bg-indigo-500/10 text-indigo-400' : 'bg-indigo-50 text-indigo-500'} rounded-full mb-4 group-hover:scale-110 transition-transform duration-500 shadow-xl shadow-indigo-500/10`}>
                                            <IconCloudUpload />
                                        </div>
                                        <p className={`text-lg font-bold ${isDarkMode ? 'text-gray-200' : 'text-gray-800'}`}>{selectedFile ? selectedFile.name : `Drop ${activeTab} Reference`}</p>
                                        <p className="text-sm text-gray-500 mt-2 font-medium">JPEG, PNG, WEBP or MP4</p>
                                    </div>
                                ) : (
                                    <div className="flex-1 overflow-y-auto p-4 custom-scrollbar">
                                        {compatibleAssets.length === 0 ? (
                                            <div className="h-full flex flex-col items-center justify-center text-gray-500">
                                                <div className="mb-3 opacity-20"><IconCube /></div>
                                                <p className="text-sm font-bold uppercase tracking-widest">No Compatible Assets</p>
                                            </div>
                                        ) : (
                                            <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-4">
                                                {compatibleAssets.map(asset => {
                                                    const isSelected = activeTab === 'multi-image'
                                                        ? selectedAssets.some(a => a.id === asset.id)
                                                        : selectedAsset?.id === asset.id;

                                                    const selectIndex = activeTab === 'multi-image'
                                                        ? selectedAssets.findIndex(a => a.id === asset.id) + 1
                                                        : null;

                                                    return (
                                                        <button
                                                            key={asset.id}
                                                            onClick={() => handleAssetToggle(asset)}
                                                            className={`relative aspect-[4/3] group rounded-xl overflow-hidden transition-all duration-500 ${isSelected ? 'ring-4 ring-indigo-500 scale-[0.98]' : 'hover:scale-[1.02] shadow-sm hover:shadow-xl'}`}
                                                        >
                                                            {(activeTab === 'video' || asset.type === 'video') ? (
                                                                <video src={asset.url || ''} className="w-full h-full object-cover pointer-events-none" />
                                                            ) : (
                                                                <img src={asset.url || ''} alt="" className="w-full h-full object-cover" />
                                                            )}

                                                            <div className={`absolute inset-0 bg-gradient-to-t from-black/60 via-transparent to-transparent transition-opacity duration-300 ${isSelected ? 'opacity-100' : 'opacity-0 group-hover:opacity-100'}`} />

                                                            {isSelected && (
                                                                <div className="absolute top-2 right-2">
                                                                    <div className="bg-indigo-500 text-white w-7 h-7 rounded-full flex items-center justify-center text-xs font-black shadow-2xl scale-110">
                                                                        {activeTab === 'multi-image' ? selectIndex : '✓'}
                                                                    </div>
                                                                </div>
                                                            )}
                                                        </button>
                                                    );
                                                })}
                                            </div>
                                        )}
                                    </div>
                                )}
                            </div>
                        </div>
                    ) : (
                        // Placeholder / Creative Tips when in Text Mode
                        <div className={`h-full flex flex-col items-center justify-center p-8 text-center rounded-2xl border border-dashed ${isDarkMode ? 'bg-[#111111]/30 border-gray-800' : 'bg-gray-50 border-gray-200'} min-h-[400px]`}>
                            <div className={`w-20 h-20 rounded-3xl flex items-center justify-center ${isDarkMode ? 'bg-[#5e5ce6]/20 shadow-2xl border border-[#5e5ce6]/30' : 'bg-indigo-50 shadow-xl border border-indigo-100'} mb-8 transform -rotate-6 hover:rotate-0 transition-all duration-700 hover:scale-110`}>
                                <span className="text-4xl drop-shadow-lg">🌍</span>
                            </div>
                            <h3 className={`text-xl font-bold ${isDarkMode ? 'text-white' : 'text-gray-900'} mb-3 tracking-tight`}>AI World Labs</h3>
                            <p className={`${isDarkMode ? 'text-gray-400' : 'text-gray-600'} text-sm max-w-sm leading-relaxed mb-6`}>
                                Describe the environment, lighting, and mood. The more descriptive, the better the result.
                            </p>
                            <div className={`flex flex-wrap justify-center gap-3`}>
                                <span className={`px-4 py-2 rounded-full text-xs font-bold uppercase tracking-widest ${isDarkMode ? 'bg-gray-800 text-gray-400' : 'bg-white text-gray-500 shadow-sm border border-gray-100'}`}>Cyberpunk Sunset</span>
                                <span className={`px-4 py-2 rounded-full text-xs font-bold uppercase tracking-widest ${isDarkMode ? 'bg-gray-800 text-gray-400' : 'bg-white text-gray-500 shadow-sm border border-gray-100'}`}>Ethereal Garden</span>
                                <span className={`px-4 py-2 rounded-full text-xs font-bold uppercase tracking-widest ${isDarkMode ? 'bg-gray-800 text-gray-400' : 'bg-white text-gray-500 shadow-sm border border-gray-100'}`}>Deep Ocean Abyss</span>
                            </div>
                        </div>
                    )}
                </div>
            </div>

            {/* Generated Result - Full Width Card */}
            {generatedWorld && (
                <div className="mt-8 animate-in slide-in-from-bottom-8 duration-1000">
                    <div className="relative rounded-[2.5rem] overflow-hidden bg-black aspect-video xl:aspect-[21/9] group shadow-2xl shadow-indigo-500/40">
                        <img
                            src={generatedWorld?.assets?.thumbnail_url}
                            alt="Generated World"
                            className="w-full h-full object-cover transition-transform duration-[3s] ease-in-out group-hover:scale-110"
                        />
                        <div className="absolute inset-0 bg-gradient-to-t from-black via-black/20 to-transparent flex flex-col justify-end p-12">
                            <div className="transform translate-y-4 group-hover:translate-y-0 transition-transform duration-700">
                                <span className="inline-block px-4 py-1.5 rounded-full bg-indigo-500 text-white text-[10px] font-black uppercase tracking-[0.2em] mb-4">Success</span>
                                <h3 className="text-4xl md:text-5xl font-black text-white mb-6 tracking-tighter leading-none">{generatedWorld?.display_name || 'Your New World'}</h3>
                                <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-6">
                                    <a
                                        href={generatedWorld?.world_marble_url}
                                        target="_blank"
                                        rel="noreferrer"
                                        className="inline-flex items-center justify-center gap-3 px-10 py-5 bg-white text-black rounded-full font-black text-lg tracking-widest hover:bg-gray-100 transition-all hover:scale-105 active:scale-95 shadow-2xl"
                                    >
                                        <IconCube /> ENTER WORLD
                                    </a>
                                    <div className="flex items-center gap-3 text-white/50">
                                        <div className="w-1.5 h-1.5 rounded-full bg-green-400 animate-pulse" />
                                        <span className="text-sm font-bold uppercase tracking-widest">Ready to explore</span>
                                    </div>
                                </div>
                            </div>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
};
