import { del } from '@vercel/blob';
import { requireAuth } from './_auth.js';

export async function POST(request: Request) {
  try {
    const authResult = await requireAuth(request);
    if (authResult instanceof Response) {
      return authResult;
    }

    const body = await request.json();
    const pathname = (body?.pathname || '').toString();

    if (!pathname) {
      return new Response(
        JSON.stringify({ error: 'Missing pathname' }),
        {
          status: 400,
          headers: { 'Content-Type': 'application/json' },
        },
      );
    }

    const token =
      process.env.researcher_READ_WRITE_TOKEN ||
      process.env.BLOB_READ_WRITE_TOKEN ||
      undefined;

    await del(pathname, { token });

    return new Response(JSON.stringify({ success: true }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  } catch (error: any) {
    console.error('Vercel Blob delete failed:', error);
    return new Response(
      JSON.stringify({ error: error?.message || 'Blob delete failed' }),
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
