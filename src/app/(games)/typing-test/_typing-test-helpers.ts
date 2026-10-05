export const getSubmitErrorMessage = (
  status: number,
  data: { error?: string; details?: string; retryAfterSec?: number } | null,
) => {
  if (status === 429) {
    const baseMessage = data?.error ?? data?.details ?? 'Too many score submissions.';
    return baseMessage
      .replace(/\s*try again in\s+\d+s\.?/i, '')
      .trim();
  }
  if (typeof data?.details === 'string' && data.details.trim()) {
    return data.details;
  }
  if (typeof data?.error === 'string' && data.error.trim()) {
    return data.error;
  }
  return 'Could not submit score. Please try again.';
};
