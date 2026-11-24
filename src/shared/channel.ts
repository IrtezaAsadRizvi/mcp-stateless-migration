// Where published release notes go (Slack, email, ...).
// It's an interface so tests and demos can count how many times we posted.
// Counting matters: a duplicate post is the silent bug from the article.

export interface Channel {
  post(text: string): Promise<void>;
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
