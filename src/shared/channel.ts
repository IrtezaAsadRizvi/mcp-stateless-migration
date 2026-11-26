// Where published release notes go (Slack, email, ...).
// It's an interface so tests and demos can count how many times we posted.
// Counting matters: a duplicate post is the silent bug from the article.

export interface Channel {
  /**
   * Throw ChannelRejectedError only when you KNOW nothing was delivered.
   * Any other error (a timeout, a dropped connection) means "maybe delivered".
   */
  post(text: string): Promise<void>;
}

/**
 * The channel refused the message before sending it (e.g. a 4xx, connection refused).
 * Safe to retry. Contrast with a timeout, where the message may already have landed.
 */
export class ChannelRejectedError extends Error {
  override name = "ChannelRejectedError";
}

/** Prints to the console. Stand-in for a real Slack/email integration. */
export class ConsoleChannel implements Channel {
  async post(text: string): Promise<void> {
    console.log(`\n📣 Posted to channel:\n${text}\n`);
  }
}

/** Remembers every post. Handy in tests: `expect posts.length === 1`. */
export class RecordingChannel implements Channel {
  posts: string[] = [];
  async post(text: string): Promise<void> {
    this.posts.push(text);
  }
}
