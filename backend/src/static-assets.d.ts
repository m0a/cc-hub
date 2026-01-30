// Type definitions for generated static-assets module
export function getStaticAsset(path: string): { content: Buffer; contentType: string } | null;
export function hasStaticAsset(path: string): boolean;
export const STATIC_ASSETS: Record<string, { content: string; contentType: string }>;
