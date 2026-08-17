export class AppError extends Error {
  constructor(
    public readonly status: 400 | 401 | 403 | 404 | 409 | 413 | 415,
    public readonly code: string,
    message: string,
  ) {
    super(message);
  }
}

export const notFound = () => new AppError(404, "PACK_NOT_FOUND", "Pack not found");
