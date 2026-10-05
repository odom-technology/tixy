type IdentityLike = {
  userId?: string | null;
  email?: string | null;
};

function requestContext(request?: Request) {
  if (!request) return {};
  return {
    method: request.method,
    url: request.url,
    userAgent: request.headers.get('user-agent'),
  };
}

export const logSecurityEvent = {
  async authenticationFailure(action: string, request?: Request) {
    console.warn('[security] authentication failure', {
      action,
      ...requestContext(request),
    });
  },

  async authorizationFailure(identity: IdentityLike | null | undefined, action: string, request?: Request) {
    console.warn('[security] authorization failure', {
      action,
      userId: identity?.userId ?? null,
      email: identity?.email ?? null,
      ...requestContext(request),
    });
  },

  async adminAction(identity: IdentityLike | null | undefined, action: string, request?: Request, data?: unknown) {
    console.info('[security] admin action', {
      action,
      userId: identity?.userId ?? null,
      email: identity?.email ?? null,
      data,
      ...requestContext(request),
    });
  },
};
