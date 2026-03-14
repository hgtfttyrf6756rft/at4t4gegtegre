import { put } from '@vercel/blob';
import { requireAuth } from './_auth.js';

export async function POST(request: Request) {
  try {
    const authResult = await requireAuth(request);
    if (authResult instanceof Response) {
      return authResult;
    }

    const url = new URL(request.url);
    const projectId = url.searchParams.get('projectId') || 'unknown-project';
    const filename = url.searchParams.get('filename') || 'file';
    const contentType = url.searchParams.get('contentType') || 'application/octet-stream';

    const arrayBuffer = await request.arrayBuffer();
    const data = new Blob([arrayBuffer], { type: contentType });

    const pathname = `projects/${projectId}/${filename}`;

    // Prefer an explicit token env var if configured, otherwise fall back to the
    // default store token env var that Vercel injects for the Blob store.
    const token =
      process.env.researcher_READ_WRITE_TOKEN ||
      process.env.BLOB_READ_WRITE_TOKEN ||
      undefined;

    const stored = await put(pathname, data, {
      access: 'public',
      addRandomSuffix: true,
      token,
    });

    return new Response(JSON.stringify(stored), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  } catch (error: any) {
    console.error('Vercel Blob upload failed:', error);
    return new Response(
      JSON.stringify({ error: error?.message || 'Blob upload failed' }),
      {
        status: 500,
        headers: { 'Content-Type': 'application/json' },
      },
    );
  }
}

export default {
  fetch: POST,
};
