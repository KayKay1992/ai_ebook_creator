// The password endpoints' brute-force limits (backend
// middleware/authRateLimits.js) answer 429 { code: "rate_limited",
// retryAfterSeconds, message }. Returns the text to show, or null when the
// error isn't a rate limit. Pure (npm test).
export const rateLimitMessage = (error) => {
  const response = error?.response;
  if (response?.status !== 429) return null;
  const serverMessage = typeof response.data?.message === "string" ? response.data.message.trim() : "";
  if (serverMessage) return serverMessage;
  const seconds = Number(response.data?.retryAfterSeconds || response.headers?.["retry-after"]) || 0;
  const minutes = Math.max(1, Math.ceil(seconds / 60));
  return seconds
    ? `Too many attempts. Please wait ${minutes} minute${minutes === 1 ? "" : "s"} and try again.`
    : "Too many attempts. Please wait a few minutes and try again.";
};
