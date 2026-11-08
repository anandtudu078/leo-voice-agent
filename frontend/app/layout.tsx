import { useState, useEffect } from "react";
import { Collection } from "@radix-ui/react-collection";
import { Menu } from "@radix-ui/react-menu";
import { CodeEditor } from "react-simple-code-editor";
import "react-simple-code-editor/dist/styles/simple-code-editor.css";
import { CommandPalette } from "react-command-palette";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import { Moon, Sun, Settings, Mic, Ear, Code, History, Music, LogOut } from "lucide-react";

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en" className="h-full">
      <body className="h-full bg-background font-sans antialiased">
        <RootNavigator />
      </body>
    </html>
  );
}

function RootNavigator() {
  const [auth, setAuth] = useState<"logged-out" | "logging-in" | "logged-in">(
    "logged-out"
  );
  const [userEmail, setUserEmail] = useState<string>("");

  useEffect(() => {
    checkAuth();
  }, []);

  const checkAuth = async () => {
    try {
      const res = await fetch("/api/auth/me", {
        credentials: "include",
      });
      const data = await res.json();
      if (res.ok && data.user) {
        setAuth("logged-in");
        setUserEmail(data.user.email);
      } else {
        setAuth("logged-out");
      }
    } catch (e) {
      setAuth("logged-out");
    }
  };

  const login = async (email: string) => {
    setAuth("logging-in");
    const res = await fetch("/api/auth/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      credentials: "include",
      body: JSON.stringify({ email }),
    });
    const data = await res.json();
    if (res.ok) {
      setAuth("logged-in");
      setUserEmail(data.user?.email || email);
    } else {
      setAuth("logged-out");
    }
  };

  const logout = async () => {
    await fetch("/api/auth/login", { method: "POST", credentials: "include" });
    setAuth("logged-out");
    setUserEmail("");
  };

  if (auth === "logged-out") {
    return (
      <AuthPage
        onLogin={login}
        onSignup={() => setAuth("logging-in")}
        setAuth={setAuth}
      />
    );
  }

  return (
    <VoiceIDELayout userEmail={userEmail} onLogout={logout} />
  );
}
