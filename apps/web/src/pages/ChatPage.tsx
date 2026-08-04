import { useState, type FormEvent } from "react";
import { Alert, Badge, Button, Card, EmptyState, Field, Heading, Spinner, Text, Textarea } from "@anansi/ui";
import { consoleApi, type ChatReply } from "../lib/api.js";

export default function ChatPage() {
  const [message, setMessage] = useState("");
  const [reply, setReply] = useState<ChatReply | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function ask(event: FormEvent) {
    event.preventDefault();
    const question = message.trim();
    if (!question) return;
    setLoading(true);
    setError(null);
    try {
      setReply(await consoleApi.chat(question));
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="mx-auto max-w-4xl p-6 sm:p-8">
      <Heading level={2}>Chat</Heading>
      <Text muted className="mt-1">
        Ask your workspace a question. Answers are evidence-first: every result is a source excerpt you can inspect.
      </Text>

      <form onSubmit={ask} className="mt-6 space-y-3">
        <Field label="Question">
          <Textarea
            value={message}
            onChange={(event) => setMessage(event.target.value)}
            placeholder="What do we know about the incident response owner?"
            autoFocus
          />
        </Field>
        <Button type="submit" loading={loading}>Find grounded evidence</Button>
      </form>

      {error && <Alert variant="danger" className="mt-6">{error}</Alert>}

      <section className="mt-8" aria-live="polite">
        {loading ? (
          <div className="flex justify-center py-8"><Spinner className="text-muted-foreground" /></div>
        ) : reply === null ? (
          <EmptyState title="Start with a question" description="We will return only material found in your organization’s ingested memory." />
        ) : (
          <div className="space-y-4">
            <Card className="p-5"><p className="text-sm">{reply.answer}</p></Card>
            {reply.evidence.map((item) => (
              <Card key={item.id} className="p-5">
                <div className="mb-2 flex items-center gap-2">
                  <Badge>{item.sourceType}</Badge>
                  <span className="text-xs text-muted-foreground">relevance {item.score.toFixed(3)}</span>
                </div>
                <p className="whitespace-pre-wrap text-sm">{item.content}</p>
                <p className="mt-3 text-xs text-muted-foreground">Captured {new Date(item.createdAt).toLocaleString()}</p>
              </Card>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
