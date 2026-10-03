/**
 * Errors thrown by services for expected situations. Actions translate them
 * into user-facing messages; anything else is a bug and propagates.
 */
export class DomainError extends Error {
  constructor(
    message: string,
    readonly code: "NOT_FOUND" | "CONFLICT" | "INVALID",
  ) {
    super(message);
    this.name = "DomainError";
  }
}

export class NotFoundError extends DomainError {
  constructor(what: string) {
    super(`${what} not found.`, "NOT_FOUND");
  }
}

/** The data changed underneath the request (e.g. a scene edited in another tab). */
export class ConflictError extends DomainError {
  constructor(message: string) {
    super(message, "CONFLICT");
  }
}

/** The request breaks a product rule (e.g. archiving the default pen name). */
export class RuleError extends DomainError {
  constructor(message: string) {
    super(message, "INVALID");
  }
}
