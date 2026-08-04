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
    <div className="lab-page lab-page--narrow lab-chat">
      <header className="lab-page-header">
        <p className="lab-page-overline">Evidence workspace</p>
        <Heading level={2}>Chat</Heading>
        <Text muted className="mt-1">Ask your workspace a question. Answers are evidence-first: every result is a source excerpt you can inspect.</Text>
      </header>

      <form onSubmit={ask} className="lab-chat-composer space-y-3">
        <Field label="Question">
          <Textarea
            value={message}
            onChange={(event) => setMessage(event.target.value)}
            placeholder="What do we know about the incident response owner?"
            autoFocus
          />
        </Field>
        <div className="flex items-center justify-between gap-3"><p className="font-mono text-[10px] uppercase tracking-[.1em] text-muted-foreground">Source-grounded response</p><Button type="submit" loading={loading}>Find grounded evidence</Button></div>
      </form>

      {error && <Alert variant="danger" className="mt-6">{error}</Alert>}

      <section className="mt-8" aria-live="polite">
        {loading ? (
          <div className="flex justify-center py-8"><Spinner className="text-muted-foreground" /></div>
        ) : reply === null ? (
          <EmptyState className="lab-empty" title="Start with a question" description="We will return only material found in your organization’s ingested memory." />
        ) : (
          <div className="space-y-4">
            <Card className="lab-chat-answer p-6"><p className="lab-page-overline">Response</p><p className="mt-3 text-sm leading-7">{reply.answer}</p></Card>
            {reply.evidence.map((item) => (
              <Card key={item.id} className="lab-evidence-card p-5">
                <div className="mb-2 flex items-center gap-2">
                  <Badge>{item.sourceType}</Badge>
                  <span className="text-xs text-muted-foreground">relevance {item.score.toFixed(3)}</span>
                </div>
                <p className="whitespace-pre-wrap text-sm">{item.content}</p>
                <p className="mt-4 border-t border-border pt-3 font-mono text-[10px] uppercase tracking-[.06em] text-muted-foreground">Captured {new Date(item.createdAt).toLocaleString()}</p>
              </Card>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
