// Tiny, dependency-free passkey checks used to decide whether to show
// passkey buttons at all. The actual WebAuthn code (@simplewebauthn/browser,
// utils/passkeyClient.js) is only downloaded when someone uses a passkey.

// The browser can create/use passkeys (WebAuthn). False in old browsers,
// some in-app browsers, and on plain-http pages other than localhost.
export const isPasskeySupported = () => {
  try {
    return (
      typeof window !== "undefined" &&
      window.isSecureContext !== false &&
      typeof window.PublicKeyCredential === "function" &&
      typeof navigator !== "undefined" &&
      typeof navigator.credentials?.create === "function" &&
      typeof navigator.credentials?.get === "function"
    );
  } catch {
    return false;
  }
};

// This device has a built-in fingerprint / face / screen-lock authenticator.
export const hasPlatformAuthenticator = async () => {
  if (!isPasskeySupported()) return false;
  try {
    return Boolean(await window.PublicKeyCredential.isUserVerifyingPlatformAuthenticatorAvailable?.());
  } catch {
    return false;
  }
};

// A sensible default name for a new passkey, e.g. "Android phone".
export const guessDeviceName = (userAgent = typeof navigator === "undefined" ? "" : navigator.userAgent) => {
  const ua = String(userAgent);
  if (/iPhone/i.test(ua)) return "iPhone";
  if (/iPad/i.test(ua)) return "iPad";
  if (/Android/i.test(ua)) return /Mobile/i.test(ua) ? "Android phone" : "Android tablet";
  if (/Windows/i.test(ua)) return "Windows PC";
  if (/Macintosh|Mac OS X/i.test(ua)) return "Mac";
  if (/CrOS/i.test(ua)) return "Chromebook";
  if (/Linux/i.test(ua)) return "Linux computer";
  return "My device";
};

// Shown once after a password sign-in: "Sign in faster with your fingerprint".
const PROMPT_FLAG = "kenlibs_passkey_prompt";
const promptDoneKey = (userId) => `kenlibs_passkey_prompt_done_${userId}`;

export const flagPasskeyPrompt = () => {
  try {
    if (isPasskeySupported()) sessionStorage.setItem(PROMPT_FLAG, "1");
  } catch {
    /* storage blocked: no prompt */
  }
};
export const takePasskeyPromptFlag = () => {
  try {
    const flagged = sessionStorage.getItem(PROMPT_FLAG) === "1";
    sessionStorage.removeItem(PROMPT_FLAG);
    return flagged;
  } catch {
    return false;
  }
};
export const peekPasskeyPromptFlag = () => {
  try {
    return sessionStorage.getItem(PROMPT_FLAG) === "1";
  } catch {
    return false;
  }
};
export const isPasskeyPromptDone = (userId) => {
  try {
    return localStorage.getItem(promptDoneKey(userId)) === "1";
  } catch {
    return true;
  }
};
export const markPasskeyPromptDone = (userId) => {
  try {
    localStorage.setItem(promptDoneKey(userId), "1");
  } catch {
    /* ignore */
  }
};
