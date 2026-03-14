import React, { useRef, useEffect, useState, useCallback, forwardRef, useImperativeHandle } from 'react';

type Tool = 'pencil' | 'line' | 'rectangle' | 'circle' | 'arrow' | 'text' | 'move' | 'erase';

interface Point {
    x: number;
    y: number;
}

interface Annotation {
    id: string;
    type: Tool;
    points: Point[];
    color: string;
    lineWidth: number;
    text?: string;
}

interface AnnotationCanvasProps {
    width: number;
    height: number;
    enabled: boolean;
    onToggle: (enabled: boolean) => void;
    onCapture: (dataUrl: string) => void;
}

export interface AnnotationCanvasHandle {
    toDataURL: (type?: string, quality?: any) => string;
}

const AnnotationCanvas = forwardRef<AnnotationCanvasHandle, AnnotationCanvasProps>(
    ({ width, height, enabled, onToggle, onCapture }, ref) => {
        const canvasRef = useRef<HTMLCanvasElement>(null);

        useImperativeHandle(ref, () => ({
            toDataURL: (type?: string, quality?: any) => {
                return canvasRef.current?.toDataURL(type, quality) || '';
            }
        }));
        const [tool, setTool] = useState<Tool>('pencil');
        const [color, setColor] = useState('#FF0000');
        const [lineWidth, setLineWidth] = useState(3);
        const [annotations, setAnnotations] = useState<Annotation[]>([]);
        const [currentAnnotation, setCurrentAnnotation] = useState<Annotation | null>(null);
        const [isDrawing, setIsDrawing] = useState(false);
        const [history, setHistory] = useState<Annotation[][]>([[]]);
        const [historyIndex, setHistoryIndex] = useState(0);

        // Redraw all annotations
        const redraw = useCallback(() => {
            const canvas = canvasRef.current;
            if (!canvas) return;

            const ctx = canvas.getContext('2d');
            if (!ctx) return;

            ctx.clearRect(0, 0, width, height);

            annotations.forEach(annotation => {
                ctx.strokeStyle = annotation.color;
                ctx.lineWidth = annotation.lineWidth;
                ctx.lineCap = 'round';
                ctx.lineJoin = 'round';

                const points = annotation.points;
                if (points.length === 0) return;

                switch (annotation.type) {
                    case 'pencil':
                        ctx.beginPath();
                        ctx.moveTo(points[0].x, points[0].y);
                        points.forEach(p => ctx.lineTo(p.x, p.y));
                        ctx.stroke();
                        break;

                    case 'line':
                        if (points.length >= 2) {
                            ctx.beginPath();
                            ctx.moveTo(points[0].x, points[0].y);
                            ctx.lineTo(points[points.length - 1].x, points[points.length - 1].y);
                            ctx.stroke();
                        }
                        break;

                    case 'rectangle':
                        if (points.length >= 2) {
                            const start = points[0];
                            const end = points[points.length - 1];
                            ctx.strokeRect(start.x, start.y, end.x - start.x, end.y - start.y);
                        }
                        break;

                    case 'circle':
                        if (points.length >= 2) {
                            const start = points[0];
                            const end = points[points.length - 1];
                            const radius = Math.sqrt(Math.pow(end.x - start.x, 2) + Math.pow(end.y - start.y, 2));
                            ctx.beginPath();
                            ctx.arc(start.x, start.y, radius, 0, 2 * Math.PI);
                            ctx.stroke();
                        }
                        break;

                    case 'arrow':
                        if (points.length >= 2) {
                            const start = points[0];
                            const end = points[points.length - 1];

                            // Draw line
                            ctx.beginPath();
                            ctx.moveTo(start.x, start.y);
                            ctx.lineTo(end.x, end.y);
                            ctx.stroke();

                            // Draw arrowhead
                            const angle = Math.atan2(end.y - start.y, end.x - start.x);
                            const headLength = 15;
                            ctx.beginPath();
                            ctx.moveTo(end.x, end.y);
                            ctx.lineTo(
                                end.x - headLength * Math.cos(angle - Math.PI / 6),
                                end.y - headLength * Math.sin(angle - Math.PI / 6)
                            );
                            ctx.moveTo(end.x, end.y);
                            ctx.lineTo(
                                end.x - headLength * Math.cos(angle + Math.PI / 6),
                                end.y - headLength * Math.sin(angle + Math.PI / 6)
                            );
                            ctx.stroke();
                        }
                        break;

                    case 'text':
                        if (annotation.text && points.length > 0) {
                            ctx.font = `${annotation.lineWidth * 8}px Arial`;
                            ctx.fillStyle = annotation.color;
                            ctx.fillText(annotation.text, points[0].x, points[0].y);
                        }
                        break;
                }
            });
        }, [annotations, width, height]);

        useEffect(() => {
            redraw();
        }, [redraw]);

        const getMousePos = (e: React.MouseEvent<HTMLCanvasElement>): Point => {
            const canvas = canvasRef.current;
            if (!canvas) return { x: 0, y: 0 };
            const rect = canvas.getBoundingClientRect();
            return {
                x: e.clientX - rect.left,
                y: e.clientY - rect.top
            };
        };

        const handleMouseDown = (e: React.MouseEvent<HTMLCanvasElement>) => {
            if (!enabled) return;

            const pos = getMousePos(e);
            setIsDrawing(true);

            if (tool === 'erase') {
                // Find and remove annotation at this position
                const newAnnotations = annotations.filter(ann => {
                    // Simple hit detection - check if click is near any point
                    return !ann.points.some(p =>
                        Math.sqrt(Math.pow(p.x - pos.x, 2) + Math.pow(p.y - pos.y, 2)) < 10
                    );
                });
                setAnnotations(newAnnotations);
                addToHistory(newAnnotations);
                return;
            }

            if (tool === 'text') {
                const text = prompt('Enter text:');
                if (text) {
                    const newAnnotation: Annotation = {
                        id: Date.now().toString(),
                        type: 'text',
                        points: [pos],
                        color,
                        lineWidth,
                        text
                    };
                    const newAnnotations = [...annotations, newAnnotation];
                    setAnnotations(newAnnotations);
                    addToHistory(newAnnotations);
                }
                setIsDrawing(false);
                return;
            }

            const newAnnotation: Annotation = {
                id: Date.now().toString(),
                type: tool,
                points: [pos],
                color,
                lineWidth
            };
            setCurrentAnnotation(newAnnotation);
        };

        const handleMouseMove = (e: React.MouseEvent<HTMLCanvasElement>) => {
            if (!enabled || !isDrawing || !currentAnnotation) return;

            const pos = getMousePos(e);

            if (tool === 'pencil') {
                setCurrentAnnotation({
                    ...currentAnnotation,
                    points: [...currentAnnotation.points, pos]
                });
            } else {
                setCurrentAnnotation({
                    ...currentAnnotation,
                    points: [currentAnnotation.points[0], pos]
                });
            }
        };

        const handleMouseUp = () => {
            if (!enabled || !currentAnnotation) return;

            setIsDrawing(false);
            const newAnnotations = [...annotations, currentAnnotation];
            setAnnotations(newAnnotations);
            setCurrentAnnotation(null);
            addToHistory(newAnnotations);
        };

        const addToHistory = (newAnnotations: Annotation[]) => {
            const newHistory = history.slice(0, historyIndex + 1);
            newHistory.push(newAnnotations);
            setHistory(newHistory);
            setHistoryIndex(newHistory.length - 1);
        };

        const undo = () => {
            if (historyIndex > 0) {
                setHistoryIndex(historyIndex - 1);
                setAnnotations(history[historyIndex - 1]);
            }
        };

        const redo = () => {
            if (historyIndex < history.length - 1) {
                setHistoryIndex(historyIndex + 1);
                setAnnotations(history[historyIndex + 1]);
            }
        };

        const clear = () => {
            setAnnotations([]);
            addToHistory([]);
        };

        const captureCanvas = () => {
            const canvas = canvasRef.current;
            if (!canvas) return;
            const dataUrl = canvas.toDataURL('image/png');
            onCapture(dataUrl);
        };

        // Draw current annotation in progress
        useEffect(() => {
            if (currentAnnotation) {
                const tempAnnotations = [...annotations, currentAnnotation];
                const canvas = canvasRef.current;
                if (!canvas) return;

                const ctx = canvas.getContext('2d');
                if (!ctx) return;

                ctx.clearRect(0, 0, width, height);

                tempAnnotations.forEach(annotation => {
                    ctx.strokeStyle = annotation.color;
                    ctx.lineWidth = annotation.lineWidth;
                    ctx.lineCap = 'round';
                    ctx.lineJoin = 'round';

                    const points = annotation.points;
                    if (points.length === 0) return;

                    switch (annotation.type) {
                        case 'pencil':
                            ctx.beginPath();
                            ctx.moveTo(points[0].x, points[0].y);
                            points.forEach(p => ctx.lineTo(p.x, p.y));
                            ctx.stroke();
                            break;

                        case 'line':
                            if (points.length >= 2) {
                                ctx.beginPath();
                                ctx.moveTo(points[0].x, points[0].y);
                                ctx.lineTo(points[points.length - 1].x, points[points.length - 1].y);
                                ctx.stroke();
                            }
                            break;

                        case 'rectangle':
                            if (points.length >= 2) {
                                const start = points[0];
                                const end = points[points.length - 1];
                                ctx.strokeRect(start.x, start.y, end.x - start.x, end.y - start.y);
                            }
                            break;

                        case 'circle':
                            if (points.length >= 2) {
                                const start = points[0];
                                const end = points[points.length - 1];
                                const radius = Math.sqrt(Math.pow(end.x - start.x, 2) + Math.pow(end.y - start.y, 2));
                                ctx.beginPath();
                                ctx.arc(start.x, start.y, radius, 0, 2 * Math.PI);
                                ctx.stroke();
                            }
                            break;

                        case 'arrow':
                            if (points.length >= 2) {
                                const start = points[0];
                                const end = points[points.length - 1];

                                ctx.beginPath();
                                ctx.moveTo(start.x, start.y);
                                ctx.lineTo(end.x, end.y);
                                ctx.stroke();

                                const angle = Math.atan2(end.y - start.y, end.x - start.x);
                                const headLength = 15;
                                ctx.beginPath();
                                ctx.moveTo(end.x, end.y);
                                ctx.lineTo(
                                    end.x - headLength * Math.cos(angle - Math.PI / 6),
                                    end.y - headLength * Math.sin(angle - Math.PI / 6)
                                );
                                ctx.moveTo(end.x, end.y);
                                ctx.lineTo(
                                    end.x - headLength * Math.cos(angle + Math.PI / 6),
                                    end.y - headLength * Math.sin(angle + Math.PI / 6)
                                );
                                ctx.stroke();
                            }
                            break;
                    }
                });
            }
        }, [currentAnnotation, annotations, width, height]);

        if (!enabled) return null;

        return (
            <div className="absolute inset-0 z-30">
                {/* Annotation Canvas */}
                <canvas
                    ref={canvasRef}
                    width={width}
                    height={height}
                    className="absolute inset-0 cursor-crosshair"
                    onMouseDown={handleMouseDown}
                    onMouseMove={handleMouseMove}
                    onMouseUp={handleMouseUp}
                    onMouseLeave={handleMouseUp}
                />

                {/* Toolbar */}
                <div className="absolute top-4 left-4 bg-gray-900/90 backdrop-blur-sm rounded-xl p-3 shadow-xl border border-white/10">
                    <div className="flex flex-col gap-3">
                        {/* Tools */}
                        <div className="flex gap-2 flex-wrap max-w-xs">
                            <button
                                onClick={() => setTool('pencil')}
                                className={`p-2 rounded-lg transition-colors ${tool === 'pencil' ? 'bg-indigo-600' : 'bg-white/10 hover:bg-white/20'}`}
                                title="Pencil"
                            >
                                ✏️
                            </button>
                            <button
                                onClick={() => setTool('line')}
                                className={`p-2 rounded-lg transition-colors ${tool === 'line' ? 'bg-indigo-600' : 'bg-white/10 hover:bg-white/20'}`}
                                title="Line"
                            >
                                📏
                            </button>
                            <button
                                onClick={() => setTool('rectangle')}
                                className={`p-2 rounded-lg transition-colors ${tool === 'rectangle' ? 'bg-indigo-600' : 'bg-white/10 hover:bg-white/20'}`}
                                title="Rectangle"
                            >
                                ▭
                            </button>
                            <button
                                onClick={() => setTool('circle')}
                                className={`p-2 rounded-lg transition-colors ${tool === 'circle' ? 'bg-indigo-600' : 'bg-white/10 hover:bg-white/20'}`}
                                title="Circle"
                            >
                                ⭕
                            </button>
                            <button
                                onClick={() => setTool('arrow')}
                                className={`p-2 rounded-lg transition-colors ${tool === 'arrow' ? 'bg-indigo-600' : 'bg-white/10 hover:bg-white/20'}`}
                                title="Arrow"
                            >
                                ➡️
                            </button>
                            <button
                                onClick={() => setTool('text')}
                                className={`p-2 rounded-lg transition-colors ${tool === 'text' ? 'bg-indigo-600' : 'bg-white/10 hover:bg-white/20'}`}
                                title="Text"
                            >
                                T
                            </button>
                            <button
                                onClick={() => setTool('erase')}
                                className={`p-2 rounded-lg transition-colors ${tool === 'erase' ? 'bg-red-600' : 'bg-white/10 hover:bg-white/20'}`}
                                title="Erase"
                            >
                                🗑️
                            </button>
                        </div>

                        {/* Color & Width */}
                        <div className="flex gap-2 items-center">
                            <input
                                type="color"
                                value={color}
                                onChange={(e) => setColor(e.target.value)}
                                className="w-10 h-10 rounded-lg cursor-pointer"
                                title="Color"
                            />
                            <input
                                type="range"
                                min="1"
                                max="20"
                                value={lineWidth}
                                onChange={(e) => setLineWidth(Number(e.target.value))}
                                className="flex-1"
                                title="Line Width"
                            />
                            <span className="text-white text-sm w-8">{lineWidth}px</span>
                        </div>

                        {/* Actions */}
                        <div className="flex gap-2">
                            <button
                                onClick={undo}
                                disabled={historyIndex <= 0}
                                className="px-3 py-1 bg-white/10 hover:bg-white/20 disabled:opacity-50 disabled:cursor-not-allowed rounded-lg text-white text-sm transition-colors"
                                title="Undo"
                            >
                                ↶ Undo
                            </button>
                            <button
                                onClick={redo}
                                disabled={historyIndex >= history.length - 1}
                                className="px-3 py-1 bg-white/10 hover:bg-white/20 disabled:opacity-50 disabled:cursor-not-allowed rounded-lg text-white text-sm transition-colors"
                                title="Redo"
                            >
                                ↷ Redo
                            </button>
                            <button
                                onClick={clear}
                                className="px-3 py-1 bg-red-600/80 hover:bg-red-600 rounded-lg text-white text-sm transition-colors"
                                title="Clear All"
                            >
                                Clear
                            </button>
                        </div>
                    </div>
                </div>
            </div>
        );
    }
);

export default AnnotationCanvas;
