import React, { useState, useRef } from 'react';
import { editImage } from '../services/geminiService';

export const ImageStudio: React.FC = () => {
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [prompt, setPrompt] = useState('');
  const [generatedImage, setGeneratedImage] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files[0]) {
      const file = e.target.files[0];
      setSelectedFile(file);
      setPreviewUrl(URL.createObjectURL(file));
      setGeneratedImage(null);
    }
  };

  const getBase64 = (file: File): Promise<string> => {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.readAsDataURL(file);
      reader.onload = () => {
        const result = reader.result as string;
        // Remove data URL prefix for API if needed, but SDK usually handles standard parts
        // However, SDK inlineData.data requires clean base64.
        const base64 = result.split(',')[1];
        resolve(base64);
      };
      reader.onerror = error => reject(error);
    });
  };

  const handleGenerate = async () => {
    if (!selectedFile || !prompt) return;

    setLoading(true);
    try {
      const base64 = await getBase64(selectedFile);
      const resultUrl = await editImage(base64, selectedFile.type, prompt);
      setGeneratedImage(resultUrl);
    } catch (err) {
      console.error(err);
      alert('Failed to edit image. Ensure prompt is valid.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="h-full flex flex-col gap-6">
      <div className="bg-gradient-to-r from-purple-900/40 to-indigo-900/40 border border-purple-500/20 rounded-2xl p-6">
        <h2 className="text-3xl font-bold text-white mb-2">Image Studio</h2>
        <p className="text-purple-200">
          Upload an image and use natural language to edit it with Gemini 2.5 Flash.
        </p>
      </div>

      <div className="flex-1 grid grid-cols-1 md:grid-cols-2 gap-8 min-h-0">
        {/* Left: Input */}
        <div className="flex flex-col gap-6 h-full">
          <div 
            onClick={() => fileInputRef.current?.click()}
            className={`flex-1 border-2 border-dashed rounded-2xl flex flex-col items-center justify-center p-8 cursor-pointer transition-all ${
              previewUrl 
                ? 'border-gray-600 bg-gray-900' 
                : 'border-gray-700 hover:border-purple-500 hover:bg-gray-800'
            }`}
          >
            <input 
              type="file" 
              ref={fileInputRef} 
              onChange={handleFileChange} 
              className="hidden" 
              accept="image/png, image/jpeg, image/webp" 
            />
            {previewUrl ? (
              <img 
                src={previewUrl} 
                alt="Original" 
                className="max-h-full max-w-full object-contain rounded-lg shadow-lg" 
              />
            ) : (
              <div className="text-center text-gray-500">
                <span className="text-4xl block mb-4">🖼️</span>
                <p>Click to upload source image</p>
                <p className="text-xs mt-2">PNG, JPG, WEBP</p>
              </div>
            )}
          </div>

          <div className="bg-gray-900 p-4 rounded-xl border border-gray-800">
            <label className="block text-sm font-medium text-gray-400 mb-2">Edit Instruction</label>
            <div className="flex gap-2">
              <input
                type="text"
                value={prompt}
                onChange={(e) => setPrompt(e.target.value)}
                placeholder="e.g., Make it look like a pencil sketch"
                className="flex-1 bg-gray-950 border border-gray-700 rounded-lg px-4 py-2 text-white focus:outline-none focus:border-purple-500"
              />
              <button
                onClick={handleGenerate}
                disabled={loading || !selectedFile || !prompt}
                className="bg-purple-600 hover:bg-purple-500 disabled:bg-gray-700 text-white px-6 py-2 rounded-lg font-medium transition-colors"
              >
                {loading ? 'Magic...' : 'Generate'}
              </button>
            </div>
          </div>
        </div>

        {/* Right: Output */}
        <div className="bg-gray-900 border border-gray-800 rounded-2xl p-1 flex items-center justify-center relative overflow-hidden">
          {generatedImage ? (
            <img 
              src={generatedImage} 
              alt="Generated" 
              className="max-h-full max-w-full object-contain rounded-xl shadow-2xl"
            />
          ) : (
            <div className="text-center text-gray-600">
              {loading ? (
                <div className="flex flex-col items-center gap-4">
                  <div className="w-12 h-12 border-4 border-purple-500 border-t-transparent rounded-full animate-spin"></div>
                  <p className="animate-pulse">Gemini is reimagining your image...</p>
                </div>
              ) : (
                <p>Generated result will appear here</p>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
};