import { Button } from "@/components/ui/button";
import { useQueryClient } from "@tanstack/react-query";
import { Loader2, LogIn, LogOut, User } from "lucide-react";
import { useInternetIdentity } from "../hooks/useInternetIdentity";

export default function LoginButton() {
  const { login, clear, loginStatus, identity } = useInternetIdentity();
  const queryClient = useQueryClient();
  const isAuthenticated = !!identity;
  const isLoggingIn = loginStatus === "logging-in";

  const handleAuth = async () => {
    if (isAuthenticated) {
      await clear();
      queryClient.clear();
    } else {
      try {
        await login();
      } catch (error: any) {
        console.error("Login error:", error);
        if (error?.message === "User is already authenticated") {
          await clear();
          setTimeout(() => login(), 300);
        }
      }
    }
  };

  if (isAuthenticated) {
    return (
      <Button
        variant="outline"
        size="sm"
        onClick={handleAuth}
        className="gap-2 border-border bg-card text-foreground hover:bg-secondary"
        data-ocid="auth.toggle"
      >
        <User className="h-3.5 w-3.5 text-accent" />
        <span className="hidden sm:inline text-xs text-muted-foreground font-mono">
          {identity.getPrincipal().toString().slice(0, 8)}…
        </span>
        <LogOut className="h-3.5 w-3.5" />
      </Button>
    );
  }

  return (
    <Button
      size="sm"
      onClick={handleAuth}
      disabled={isLoggingIn}
      className="gap-2 bg-accent text-accent-foreground hover:bg-accent/90 font-semibold"
      data-ocid="auth.toggle"
    >
      {isLoggingIn ? (
        <Loader2 className="h-3.5 w-3.5 animate-spin" />
      ) : (
        <LogIn className="h-3.5 w-3.5" />
      )}
      <span className="text-xs">{isLoggingIn ? "Connecting…" : "Login"}</span>
    </Button>
  );
}
