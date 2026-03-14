// Vercel Edge Middleware for custom domain routing
// This runs at the edge before the request reaches the origin

// List of known app domains to skip middleware processing
// IMPORTANT: Add your production domain here if not using .vercel.app
const APP_DOMAINS = [
    'localhost',
    'vercel.app',      // Matches *.vercel.app (preview deploys)
    'freshfront.co',  // Production domain (update this to your actual domain)
    'ffresearchr.vercel.app',
    'ffexcel.vercel.app',
];

// Check if the host is a known app domain (not a custom domain)
function isAppDomain(host: string): boolean {
    const hostname = host.split(':')[0]; // Remove port if present
    return APP_DOMAINS.some(domain =>
        hostname === domain || hostname.endsWith('.' + domain)
    );
}

export const config = {
    matcher: [
        /*
         * Match all request paths except:
         * - /api/* (API routes)
         * - /w/* (already handled website serve routes)
         * - /_next/* (Next.js internals)
         * - /_vercel/* (Vercel internals)
         * - Static files with extensions
         */
        '/((?!api/|w/|_next/|_vercel/|.*\\.[^/]+$).*)',
    ],
};

export default async function middleware(request: Request) {
    const url = new URL(request.url);
    const host = request.headers.get('host') || '';

    // Skip if this is a known app domain
    if (isAppDomain(host)) {
        return undefined; // Continue to origin
    }

    // Skip if not the root path (custom domains should serve at root)
    // Allow paths like / or /favicon.ico
    if (url.pathname !== '/' && !url.pathname.match(/^\/(favicon\.ico|robots\.txt)$/)) {
        return undefined; // Continue to origin
    }

    // This is a custom domain request - look up the slug
    try {
        // Call our API to get the slug for this domain
        const lookupUrl = new URL('/api/websites', url.origin);
        lookupUrl.searchParams.set('op', 'domain-lookup');
        lookupUrl.searchParams.set('domain', host.split(':')[0]);

        const response = await fetch(lookupUrl.toString());

        if (!response.ok) {
            // Domain not found or error - serve the app
            return undefined;
        }

        const data = await response.json();

        if (data.slug) {
            // Rewrite to serve the website/form content
            const serveUrl = new URL('/api/websites', url.origin);
            serveUrl.searchParams.set('op', 'serve');
            serveUrl.searchParams.set('slug', data.slug);

            // Fetch the content and return it
            const contentResponse = await fetch(serveUrl.toString());

            if (contentResponse.ok) {
                const html = await contentResponse.text();
                return new Response(html, {
                    status: 200,
                    headers: {
                        'Content-Type': 'text/html',
                        'Cache-Control': 's-maxage=60, stale-while-revalidate=300',
                    },
                });
            }
        }

        // No slug found or content fetch failed - serve the app
        return undefined;
    } catch (error) {
        console.error('Custom domain lookup error:', error);
        return undefined;
    }
}
