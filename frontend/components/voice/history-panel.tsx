import { useState, useEffect } from "react";
import { History } from "lucide-react";

export interface VoiceTurn {
  id: number;
  transcript: string;
  reply: string;
  created_at: string;
}

export function VoiceHistory({ turns }: { turns: VoiceTurn[] }) {
  return (
    <div className="space-y-2 max-h-80 overflow-y-auto">
      {turns.map((turn) => (
        <div
          key={turn.id}
          className="p-3 rounded-md border border-border hover:bg-accent/50 transition-colors"
        >
          <p className="font-medium text-sm truncate">
            {turn.transcript.substring(0, 50)}...
          </p>
          <p className="text-xs text-muted-foreground">
            {turn.reply.substring(0, 30)}...
          </p>
        </div>
      ))}
      {turns.length === 0 && (
        <p className="text-sm text-muted-foreground">No voice history yet</p>
      )}
    </div>
  );
}