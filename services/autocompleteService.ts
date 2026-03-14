import { authFetch } from '../services/authFetch.js';

export interface AutocompleteResult {
  query: string;
  suggestions: string[];
}

export async function fetchSuggestions(query: string): Promise<string[]> {
  const trimmed = query.trim();
  if (!trimmed || trimmed.length < 2) {
    return [];
  }

  try {
    const response = await authFetch(`/api/google?op=autocomplete&query=${encodeURIComponent(trimmed)}`);
    if (!response.ok) {
      console.error('[AutocompleteService] Failed to fetch suggestions:', response.status);
      return [];
    }

    const data: AutocompleteResult = await response.json();
    return data.suggestions || [];
  } catch (error) {
    console.error('[AutocompleteService] Error fetching suggestions:', error);
    return [];
  }
}
