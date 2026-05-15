// localStorage-backed bearer key storage. Single key, single org.
// Keep deliberately tiny — no jwt parsing, no session tracking; the API key
// IS the session identifier on the backend.

const KEY_STORAGE = 'getmcp.apiKey';
const ORG_NAME_STORAGE = 'getmcp.orgName';

export function getApiKey(): string | null {
  return localStorage.getItem(KEY_STORAGE);
}
export function setApiKey(key: string): void {
  localStorage.setItem(KEY_STORAGE, key);
}
export function clearApiKey(): void {
  localStorage.removeItem(KEY_STORAGE);
  localStorage.removeItem(ORG_NAME_STORAGE);
}
export function getOrgName(): string | null {
  return localStorage.getItem(ORG_NAME_STORAGE);
}
export function setOrgName(name: string): void {
  localStorage.setItem(ORG_NAME_STORAGE, name);
}
