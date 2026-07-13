import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';

const PUBLIC_FILE = /\.(.*)$/;
const EXCLUDED_PATH_PREFIXES = [
  '/maintenance',
  '/_next',
  '/api',
  '/images',
  '/assets',
];

function isMaintenanceModeEnabled() {
  return process.env.MAINTENANCE_MODE === 'true';
}

function shouldBypassMaintenance(pathname: string) {
  if (pathname === '/favicon.ico' || PUBLIC_FILE.test(pathname)) {
    return true;
  }

  return EXCLUDED_PATH_PREFIXES.some(
    (prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`),
  );
}

export function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;

  if (!isMaintenanceModeEnabled() || shouldBypassMaintenance(pathname)) {
    return NextResponse.next();
  }

  const maintenanceUrl = request.nextUrl.clone();
  maintenanceUrl.pathname = '/maintenance';
  maintenanceUrl.search = '';

  return NextResponse.redirect(maintenanceUrl);
}

export const config = {
  matcher: '/:path*',
};
