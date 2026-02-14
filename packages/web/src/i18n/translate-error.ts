import i18n from 'i18next';

const ERROR_CODE_MAP: Record<string, string> = {
  // Auth
  UNAUTHORIZED: 'serverError.unauthorized',
  INVALID_SESSION: 'serverError.invalidSession',
  INVALID_CHALLENGE: 'serverError.invalidChallenge',
  HANDLE_MISMATCH: 'serverError.handleMismatch',
  AUTH_VERIFICATION_FAILED: 'serverError.authVerificationFailed',
  AUTH_TIMEOUT: 'serverError.authTimeout',
  AUTH_REQUIRED: 'serverError.authRequired',
  // Access control
  FORBIDDEN: 'serverError.forbidden',
  BANNED: 'serverError.banned',
  ACCESS_DENIED: 'serverError.accessDenied',
  NOT_PARTICIPANT: 'serverError.notParticipant',
  BLOCKED_USER: 'serverError.blockedUser',
  SELF_DM: 'serverError.selfDm',
  // Validation
  INVALID_INPUT: 'serverError.invalidInput',
  INVALID_JSON: 'serverError.invalidInput',
  INVALID_MESSAGE_FORMAT: 'serverError.invalidInput',
  MESSAGE_TOO_LONG: 'serverError.messageTooLong',
  CONTENT_FILTERED: 'serverError.contentFiltered',
  // Resources
  NOT_FOUND: 'serverError.notFound',
  ALREADY_EXISTS: 'serverError.alreadyExists',
  // Rate limiting
  RATE_LIMITED: 'serverError.rateLimited',
  // Server
  SERVER_ERROR: 'serverError.serverError',
  NETWORK_ERROR: 'serverError.networkError',
};

export function translateServerError(errorCode?: string, fallbackMessage?: string): string {
  if (errorCode) {
    const key = ERROR_CODE_MAP[errorCode];
    if (key) return i18n.t(key as 'serverError.unknown', { ns: 'common' });
  }
  return fallbackMessage ?? i18n.t('common:serverError.unknown');
}
