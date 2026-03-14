

const SHOTSTACK_BASE_URL = 'https://api.shotstack.io/edit/v1';

export interface ShotstackCaptionAsset {
    type: 'caption';
    src: string;
    font?: {
        family?: string;
        color?: string;
        size?: number;
        opacity?: number;
        lineHeight?: number;
    };
    background?: {
        color?: string;
        opacity?: number;
        padding?: number;
        borderRadius?: number;
    };
}

export type ShotstackAsset = {
    type: 'video' | 'image' | 'audio' | 'text' | 'html' | 'luma';
    src?: string;
    text?: string;
    voice?: string;
    html?: string;
    css?: string;
    volume?: number;
    loop?: boolean;
    trim?: number;
    transcode?: boolean;
    chromaKey?: {
        color: string;
        threshold?: number;
        halo?: number;
    };
    scale?: number;
    width?: number;
    height?: number;
} | ShotstackCaptionAsset;

export interface ShotstackClip {
    asset: ShotstackAsset;
    start: number;
    length: number | 'auto' | 'end';
    fit?: 'cover' | 'contain' | 'crop' | 'none';
    scale?: number;
    offset?: {
        x?: number;
        y?: number;
    };
    position?: 'top' | 'topRight' | 'right' | 'bottomRight' | 'bottom' | 'bottomLeft' | 'left' | 'topLeft' | 'center';
    opacity?: number;
    transition?: {
        in?: string;
        out?: string;
    };
    effect?: string;
    filter?: string;
    alias?: string;
}

export interface ShotstackTrack {
    clips: ShotstackClip[];
}

export interface ShotstackTimeline {
    soundtrack?: {
        src: string;
        effect?: string;
        volume?: number;
    };
    background?: string;
    tracks: ShotstackTrack[];
}

export interface ShotstackOutput {
    format: 'mp4' | 'gif' | 'jpg' | 'png' | 'bmp' | 'mp3';
    resolution: 'preview' | 'mobile' | 'sd' | 'hd' | '1080';
    aspectRatio?: string;
    size?: {
        width: number;
        height: number;
    };
    fps?: number;
    scaleTo?: 'preview' | 'mobile' | 'sd' | 'hd' | '1080';
    quality?: 'low' | 'medium' | 'high';
}

export interface ShotstackEdit {
    timeline: ShotstackTimeline;
    output: ShotstackOutput;
    callback?: string;
}

export interface ShotstackRenderResponse {
    success: boolean;
    message: string;
    response: {
        message: string;
        id: string;
    };
}

export interface ShotstackStatusResponse {
    success: boolean;
    message: string;
    response: {
        id: string;
        owner: string;
        status: 'queued' | 'fetching' | 'rendering' | 'saving' | 'done' | 'failed';
        error?: string;
        url?: string;
        poster?: string;
        thumbnail?: string;
        created: string;
        updated: string;
        outputs?: {
            transcription?: {
                url: string;
                type: 'vtt' | 'srt';
            }
        }[];
    };
}

export async function postShotstackRender(edit: ShotstackEdit): Promise<ShotstackRenderResponse> {
    const apiKey = process.env.SHOTSTACK_API_KEY;
    if (!apiKey) {
        throw new Error('Missing SHOTSTACK_API_KEY environment variable');
    }

    const res = await fetch(`${SHOTSTACK_BASE_URL}/render`, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'x-api-key': apiKey,
        },
        body: JSON.stringify(edit),
    });

    if (!res.ok) {
        const text = await res.text().catch(() => res.statusText);
        throw new Error(`Shotstack render failed: ${res.status} ${text}`);
    }

    return res.json();
}

export async function getShotstackRender(id: string): Promise<ShotstackStatusResponse> {
    const apiKey = process.env.SHOTSTACK_API_KEY;
    if (!apiKey) {
        throw new Error('Missing SHOTSTACK_API_KEY environment variable');
    }

    const res = await fetch(`${SHOTSTACK_BASE_URL}/render/${id}`, {
        method: 'GET',
        headers: {
            'x-api-key': apiKey,
        },
    });

    if (!res.ok) {
        const text = await res.text().catch(() => res.statusText);
        throw new Error(`Shotstack status check failed: ${res.status} ${text}`);
    }

    return res.json();
}
