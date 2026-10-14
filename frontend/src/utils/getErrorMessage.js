// Distinguishes "request never reached the server" (offline / no connection)
// from a real server-returned error, so callers can show a clear "you're
// offline" message instead of a generic/confusing network error. Timeouts
// also have no response, but they aren't an offline problem, so they get
// their own message.
const getErrorMessage = (error, fallback) => {
  if (error?.code === "ECONNABORTED" || error?.code === "ETIMEDOUT") {
    return "The request timed out — please try again.";
  }
  if (!navigator.onLine || error?.code === "ERR_NETWORK" || !error?.response) {
    return "You're offline — check your connection and try again.";
  }
  return error.response?.data?.message || fallback;
};

export default getErrorMessage;
