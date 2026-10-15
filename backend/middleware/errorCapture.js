const { captureError } = require('../utils/errorLogger');
const { scrubPath } = require('../utils/errorScrubber');

// Request-side error capture (utils/errorLogger.js).
//
// captureServerErrors: mounted first in app.js. When any response finishes
// with a 5xx status it records it (4xx are the client's problem and are
// never logged). Controllers catch their own errors and reply 500
// themselves, so each such catch block sets `res.locals.error = error`
// first: that gives the log the real message and stack. Without it, the
// entry still says which route returned what status.
//
// errorHandler: mounted last. Anything thrown or passed to next(err)
// (Express 5 also forwards rejected async handlers here):
//   - CORS rejections → 403, not logged (any website can trigger them),
//   - client errors such as malformed JSON → their 4xx status as JSON,
//   - everything else → 500 JSON, recorded via captureServerErrors.

// The route as a pattern, never the raw URL: ids become ":id"; query
// strings and token-like segments are removed by scrubPath.
const routeOf = (req) => scrubPath(req.originalUrl || req.url || '').replace(/\/[a-f0-9]{24}(?=\/|$)/gi, '/:id');

const captureServerErrors = (req, res, next) => {
    try {
        res.on('finish', () => {
            try {
                if (res.statusCode < 500) return;
                const route = routeOf(req);
                const error = res.locals.error;
                captureError({
                    source: 'backend',
                    error,
                    message: error ? undefined : `HTTP ${res.statusCode} on ${req.method} ${route}`,
                    method: req.method,
                    route,
                    statusCode: res.statusCode,
                    userId: req.user?._id,
                });
            } catch {
                /* never let logging affect a response */
            }
        });
    } catch {
        /* same */
    }
    next();
};

// eslint-disable-next-line no-unused-vars
const errorHandler = (err, req, res, next) => {
    if (res.headersSent) return next(err);
    if (/Not allowed by CORS/.test(String(err?.message))) {
        return res.status(403).json({ message: 'Not allowed by CORS' });
    }
    const status = Number(err?.status || err?.statusCode);
    if (status >= 400 && status < 500) {
        return res.status(status).json({ message: err.expose && err.message ? err.message : 'Bad request' });
    }
    res.locals.error = err;
    res.status(500).json({ message: 'Server Error' });
};

module.exports = { captureServerErrors, errorHandler, routeOf };
