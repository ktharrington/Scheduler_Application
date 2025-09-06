// Minimal helper used by the pages to build route URLs.
export function createPageUrl(path) {
    return path.startsWith('/') ? path : `/${path}`;
  }
  