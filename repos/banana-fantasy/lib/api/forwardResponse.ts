import { NextResponse } from 'next/server';

/**
 * Proxy an upstream fetch Response through a Next.js route handler.
 * Preserves status code and content-type; does not forward hop-by-hop headers.
 */
export async function forwardResponse(upstream: Response): Promise<NextResponse> {
  const headers = new Headers();
  const contentType = upstream.headers.get('content-type');
  if (contentType) headers.set('content-type', contentType);

  const body = await upstream.arrayBuffer();
  return new NextResponse(body, {
    status: upstream.status,
    statusText: upstream.statusText,
    headers,
  });
}
