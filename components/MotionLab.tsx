import React, { useState, useRef } from 'react';
import { generateVeoVideo, ensureVeoKey } from '../services/geminiService';

export const MotionLab: React.FC = () => {
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [prompt, setPrompt] = useState('');
  const [aspectRatio, setAspectRatio] = useState<'16:9' | '9:16'>('16:9');
  const [videoUrl, setVideoUrl] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [status, setStatus] = useState('');
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files[0]) {
      const file = e.target.files[0];
      setSelectedFile(file);
      setPreviewUrl(URL.createObjectURL(file));
      setVideoUrl(null);
    }
  };

  const getBase64 = (file: File): Promise<string> => {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.readAsDataURL(file);
      reader.onload = () => {
        const result = reader.result as string;
        const base64 = result.split(',')[1];
        resolve(base64);
      };
      reader.onerror = error => reject(error);
    });
  };

  const handleGenerate = async () => {
    if (!selectedFile) return;

    setLoading(true);
    setStatus('Checking API Key access...');

    try {
      // 1. Check/Request Key
      try {
        await ensureVeoKey();
      } catch (e) {
        // Fallback or ignore if not available in environment but assume handled
        console.warn("Key selection check failed or skipped", e);
      }

      setStatus('Uploading and processing...');
      const base64 = await getBase64(selectedFile);

      setStatus('Veo is dreaming (this takes 1-2 mins)...');

      const blob = await generateVeoVideo(prompt, aspectRatio, 'quality', { image: { base64, mimeType: selectedFile.type } });
      const url = URL.createObjectURL(blob);
      setVideoUrl(url);
      setStatus('Complete!');

    } catch (err) {
      console.error(err);
      setStatus('Error generating video.');
      alert('Video generation failed. Please ensure you have selected a paid project API key.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="h-full flex flex-col gap-6">
      <div className="bg-gradient-to-r from-emerald-900/40 to-teal-900/40 border border-emerald-500/20 rounded-2xl p-6 flex justify-between items-center">
        <div>
          <h2 className="text-3xl font-bold text-white mb-2">Motion Lab (Veo)</h2>
          <p className="text-emerald-200">
            Bring photos to life. Requires a paid billing project selected via the popup.
          </p>
        </div>
        <div className="text-right">
          <a href="https://ai.google.dev/gemini-api/docs/billing" target="_blank" rel="noreferrer" className="text-xs text-emerald-400 hover:underline">Billing Info</a>
        </div>
      </div>

      <div className="flex-1 grid grid-cols-1 lg:grid-cols-3 gap-8 min-h-0">
        {/* Controls */}
        <div className="lg:col-span-1 bg-gray-900 p-6 rounded-2xl border border-gray-800 space-y-6 overflow-y-auto">
          <div>
            <label className="block text-sm font-medium text-gray-400 mb-3">1. Source Image</label>
            <div
              onClick={() => fileInputRef.current?.click()}
              className="border-2 border-dashed border-gray-700 hover:border-emerald-500 rounded-xl p-4 cursor-pointer transition-colors bg-gray-950 flex flex-col items-center"
            >
              <input type="file" ref={fileInputRef} onChange={handleFileChange} className="hidden" accept="image/*" />
              {previewUrl ? (
                <img src={previewUrl} alt="Source" className="rounded-lg h-40 object-cover" />
              ) : (
                <div className="py-8 text-center text-gray-500">
                  <span>Upload Photo</span>
                </div>
              )}
            </div>
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-400 mb-3">2. Prompt (Optional)</label>
            <textarea
              value={prompt}
              onChange={(e) => setPrompt(e.target.value)}
              placeholder="Describe the motion..."
              className="w-full bg-gray-950 border border-gray-700 rounded-lg p-3 text-white h-24 resize-none focus:outline-none focus:border-emerald-500"
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-400 mb-3">3. Aspect Ratio</label>
            <div className="grid grid-cols-2 gap-2">
              <button
                onClick={() => setAspectRatio('16:9')}
                className={`p-2 rounded-lg border ${aspectRatio === '16:9' ? 'bg-emerald-600/20 border-emerald-500 text-emerald-400' : 'border-gray-700 text-gray-500'}`}
              >
                16:9 Landscape
              </button>
              <button
                onClick={() => setAspectRatio('9:16')}
                className={`p-2 rounded-lg border ${aspectRatio === '9:16' ? 'bg-emerald-600/20 border-emerald-500 text-emerald-400' : 'border-gray-700 text-gray-500'}`}
              >
                9:16 Portrait
              </button>
            </div>
          </div>

          <button
            onClick={handleGenerate}
            disabled={loading || !selectedFile}
            className="w-full bg-emerald-600 hover:bg-emerald-500 disabled:bg-gray-700 text-white font-bold py-4 rounded-xl transition-all shadow-lg shadow-emerald-900/20"
          >
            {loading ? 'Processing...' : 'Generate Video'}
          </button>

          {loading && (
            <div className="text-xs text-center text-emerald-400 animate-pulse">
              {status}
            </div>
          )}
        </div>

        {/* Output */}
        <div className="lg:col-span-2 bg-black rounded-2xl border border-gray-800 flex items-center justify-center overflow-hidden relative">
          {videoUrl ? (
            <video
              src={videoUrl}
              controls
              autoPlay
              loop
              className="max-h-full max-w-full"
            />
          ) : (
            <div className="text-center text-gray-600">
              {loading ? (
                <div className="space-y-4">
                  <div className="w-16 h-16 border-4 border-emerald-500 border-t-transparent rounded-full animate-spin mx-auto"></div>
                  <p className="text-emerald-500/80">Generating video... sit tight!</p>
                </div>
              ) : (
                <p>Video output will appear here</p>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
};