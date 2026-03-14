
export interface ImageResult {
    type: string;
    title: string;
    url: string;
    source: string;
    thumbnail: {
        src: string;
        width: number;
        height: number;
    };
    properties: {
        url: string;
        placeholder: string;
        width: number;
        height: number;
    };
}

export interface ImageSearchResponse {
    type: string;
    query: {
        original: string;
        altered: string;
    };
    results: ImageResult[];
}

export const searchImages = async (query: string, count: number = 10): Promise<ImageResult[]> => {
    try {
        const { authFetch } = await import('./authFetch.js');
        const params = new URLSearchParams({
            q: query,
            count: count.toString(),
        });

        const response = await authFetch(`/api/brave-search?${params.toString()}`);

        if (!response.ok) {
            throw new Error(`Image search failed: ${response.statusText}`);
        }

        const data: ImageSearchResponse = await response.json();
        return data.results || [];
    } catch (error) {
        console.error('Error searching images:', error);
        return [];
    }
};
