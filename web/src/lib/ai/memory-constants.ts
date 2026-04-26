// Tiny client-safe module: no DB imports. Both the API/repo layer and
// the browser-rendered Settings card import from here so the limit
// can't drift between client validation and server enforcement.
export const AI_MEMORY_MAX_CONTENT_LENGTH = 4000;
