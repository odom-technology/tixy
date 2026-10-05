type ChessMatchCompletedHandler = (matchId: string) => void | Promise<void>;

const chessMatchCompletedHandlers = new Set<ChessMatchCompletedHandler>();

export function registerChessMatchCompletedHandler(
  handler: ChessMatchCompletedHandler,
): void {
  chessMatchCompletedHandlers.add(handler);
}

export async function notifyChessMatchCompleted(matchId: string): Promise<void> {
  for (const handler of chessMatchCompletedHandlers) {
    await handler(matchId);
  }
}
