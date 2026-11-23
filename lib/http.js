// Small helpers shared by every API route.
export class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

// Wraps a route: checks the method, turns thrown HttpErrors into JSON errors,
// and never caches responses.
export function route(methods, fn) {
  return async (req, res) => {
    res.setHeader("Cache-Control", "no-store");
    try {
      if (!methods.includes(req.method)) throw new HttpError(405, "That request method isn't supported here.");
      const out = await fn(req, res);
      res.status(200).json(out ?? { ok: true });
    } catch (e) {
      const status = e instanceof HttpError ? e.status : 500;
      if (status === 500) console.error(e);
      res.status(status).json({
        error: status === 500 ? "Something went wrong on the server. Try again in a moment." : e.message,
      });
    }
  };
}
