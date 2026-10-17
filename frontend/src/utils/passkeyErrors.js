// Friendly messages for passkey failures. Pure (npm test).
// Browsers deliberately report "cancelled", "timed out" and "no passkey on
// this device" all as NotAllowedError (so sites can't probe which passkeys
// exist), so a timeout is recognised by how long it took, and the other two
// share one message.

const CEREMONY_TIMEOUT_MS = 2 * 60 * 1000;

// "cancelled" | "timeout" | "not_supported" | "already_added" | "wrong_site"
// | "password_required" | "wrong_password" | "limit" | "rate_limited"
// | "expired" | "network" | "failed"
export const passkeyErrorCode = (error, { elapsedMs = 0 } = {}) => {
  const serverCode = error?.response?.data?.code;
  if (error?.response?.status === 429) return "rate_limited";
  if (serverCode === "password_required" || serverCode === "wrong_password" || serverCode === "limit" || serverCode === "expired") return serverCode;
  if (serverCode === "duplicate") return "already_added";
  if (error?.response) return "failed";
  if (error?.code === "ERR_NETWORK" || error?.message === "Network Error") return "network";

  const name = error?.name || "";
  const code = error?.code || "";
  if (code === "ERROR_AUTHENTICATOR_PREVIOUSLY_REGISTERED" || name === "InvalidStateError") return "already_added";
  if (name === "SecurityError" || code === "ERROR_INVALID_DOMAIN" || code === "ERROR_INVALID_RP_ID") return "wrong_site";
  if (name === "NotSupportedError" || /not supported|does not support/i.test(error?.message || "")) return "not_supported";
  if (name === "NotAllowedError" || name === "AbortError" || code === "ERROR_CEREMONY_ABORTED") {
    return elapsedMs >= CEREMONY_TIMEOUT_MS - 5000 ? "timeout" : "cancelled";
  }
  return "failed";
};

const MESSAGES = {
  login: {
    cancelled: "Passkey sign-in was cancelled, or there's no Kenlibs passkey on this device. Sign in with your email and password, then add one in your profile.",
    timeout: "Passkey sign-in timed out. Please try again.",
    not_supported: "This browser can't use passkeys. Sign in with your email and password.",
    wrong_site: "Passkeys aren't available on this address. Sign in with your email and password.",
    rate_limited: "Too many attempts. Please wait a few minutes and try again.",
    expired: "That sign-in took too long. Please try again.",
    network: "Couldn't reach Kenlibs. Check your connection and try again.",
    failed: "Couldn't sign you in with that passkey. Try again, or use your email and password.",
  },
  register: {
    cancelled: "Adding the passkey was cancelled.",
    timeout: "Adding the passkey timed out. Please try again.",
    not_supported: "This browser or device can't create passkeys.",
    wrong_site: "Passkeys aren't available on this address.",
    already_added: "This device already has a passkey for your account.",
    password_required: "Enter your password to add a passkey.",
    wrong_password: "That password isn't right.",
    limit: "You can have up to 5 passkeys. Remove one first.",
    rate_limited: "Too many attempts. Please wait a few minutes and try again.",
    expired: "That took too long. Please try again.",
    network: "Couldn't reach Kenlibs. Check your connection and try again.",
    failed: "Couldn't add the passkey. Please try again.",
  },
};

export const passkeyErrorMessage = (error, { action = "login", elapsedMs = 0 } = {}) => {
  const code = passkeyErrorCode(error, { elapsedMs });
  const messages = MESSAGES[action] || MESSAGES.login;
  if (code === "rate_limited" && typeof error?.response?.data?.message === "string") return error.response.data.message;
  return messages[code] || messages.failed;
};
