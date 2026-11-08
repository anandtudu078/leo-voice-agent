import { useState } from "react";
import { Mic, Ear, Code, History, Music, LogOut } from "lucide-react";

export interface IdeLayoutProps {
  userEmail: string;
  onLogout: () => void;
}

export function IdeLayout({ userEmail, onLogout }: IdeLayoutProps) {
  const [isListening, setIsListening] = useState(false);
  const [transcript, setTranscript] = useState("");
  const [reply, setReply] = useState("");
  const [code, setCode] = useState("");
  const [history, setHistory] = useState<Array<{transcript: string; reply: string}>>([]);

  return (
    <div className="min-h-screen bg-background text-background font-sans">
      {/* Top bar */}
      <div className="border-b bg-card text-card-foreground flex items-center justify-between px-4 py-3">
        <div className="flex items-center gap-3">
          <Mic className="h-5 w-5" />
          <span className="font-semibold">Leo Voice IDE</span>
          <span className="text-sm text-muted-foreground">{userEmail}</span>
        </div>
        <Button onClick={onLogout} variant="ghost" size="sm">
          Logout
        </Button>
      </div>

      {/* Code display area */}
      <div className="p-4 space-y-4">
        {/* Transcript */}
        <div>
          <h3 className="text-sm font-medium text-muted-uppercase mb-2">Transcript</h3>
          <p className="text-sm text-muted-foreground whitespace-pre-wrap" id="transcript">
            {transcript || "Waiting for voice input..."}
          </p>
        </div>

        {/* Generated Code */}
        <div>
          <h3 className="text-sm font-medium text-muted-uppercase mb-2">Generated Code</h3>
          <CodeEditor
            value={code}
            onChange={(e) => setCode(e.target.value)}
            language="typescript"
            style={{ height: "300px" }}
          />
          {!code && <p className="text-xs text-muted-foreground">No code generated yet</p>}
        </section>

        {/* Reply & Audio */}
        {reply && (
          <div>
            <h3 className="text-sm font-medium text-muted-uppercase mb-2">Reply</h3>
            <div className="flex items-center gap-2">
              <Music className="h-4 w-4 text-primary" />
              <span className="font-medium">{reply}</span>
            </div>
            <audio controls className="w-full mt-2">
              <source
                src={`data:audio/webm;base64,${reply}`}
                type="audio/webm"
              />
            </audio>
          </div>
        )}

        {/* Voice History */}
        {history.length > 0 && (
          <div>
            <h3 className="text-sm font-medium text-muted-uppercase mb-2">History</h3>
            <div className="space-y-1">
              {history.map((turn, i) => (
                <div key={i} className="p-2 rounded-md bg-muted/30">
                  <p className="text-xs truncated">{turn.transcript}</p>
                  <p className="text-xs text-muted-foreground">{turn.reply}</p>
                </div>
              ))}
            </div>
          )}
        )}

        {/* Controls */}
        <div className="flex gap-2">
          <Button onClick={() => setIsListening(true)} disabled={isProcessing}>
            {isListening ? "Listening..." : "Hold to Record"}
          </Button>
          {isProcessing && <Button variant="outline" disabled>
            Processing...
          </Button>}
        </div>
      </div>
    </div>
  );
}
'''