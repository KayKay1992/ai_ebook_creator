// Distinguishes "request never reached the server" (offline / no connection)
// from a real server-returned error, so callers can show a clear "you're
// offline" message instead of a generic/confusing network error.
const getErrorMessage = (error, fallback) => {
  if (!navigator.onLine || error?.code === "ERR_NETWORK" || !error?.response) {
    return "You're offline — check your connection and try again.";
  }
  return error.response?.data?.message || fallback;
};

export default getErrorMessage;
